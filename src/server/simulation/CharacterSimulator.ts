import type { Position, GameMap, PathNode, RouteSegment, Direction } from '@/types'
import type { SimCharacter, SimulationConfig, SimCrossMapNavState, ConversationState } from './types'
import type { WorldStateManager } from './WorldState'
import { findPathAvoidingNodes } from '@/lib/pathfinding'
import { lerpPosition, getDirection, getDistance } from '@/lib/movement'
import { planCrossMapRoute, hasMoreSegments } from '@/lib/crossMapNavigation'

interface IdleState {
  characterId: string
  nextMoveTime: number
}

// Track conversation destinations (which NPC the character is heading to)
interface ConversationDestination {
  npcId: string
  targetNodeId: string // Adjacent node to NPC
}

export class CharacterSimulator {
  private worldState: WorldStateManager
  private config: SimulationConfig
  private idleStates: Map<string, IdleState> = new Map()
  private transitionStates: Map<string, TransitionSimState> = new Map()
  private conversationDestinations: Map<string, ConversationDestination> = new Map()

  constructor(worldState: WorldStateManager, config: SimulationConfig) {
    this.worldState = worldState
    this.config = config
  }

  // Update all characters for one tick
  tick(deltaTime: number, currentTime: number): void {
    const characters = this.worldState.getAllCharacters()

    for (const character of characters) {
      // Handle transition animation
      if (this.transitionStates.has(character.id)) {
        this.updateTransition(character.id, deltaTime)
        continue
      }

      // Check for conversation timeout
      if (character.conversation?.isActive) {
        if (currentTime >= character.conversation.startTime + character.conversation.duration) {
          this.endConversation(character.id)
        }
        continue // Skip movement while in conversation
      }

      // Handle movement
      if (character.navigation.isMoving) {
        this.updateMovement(character, deltaTime)
      } else {
        // Check if it's time to start a new move
        this.checkIdleAndMove(character, currentTime)
      }
    }
  }

  private updateMovement(character: SimCharacter, deltaTime: number): void {
    const nav = character.navigation
    if (!nav.startPosition || !nav.targetPosition) return

    const distance = getDistance(nav.startPosition, nav.targetPosition)
    const duration = distance / this.config.movementSpeed
    const newProgress = Math.min(1, nav.progress + deltaTime / duration)
    const newPosition = lerpPosition(nav.startPosition, nav.targetPosition, newProgress)

    // Update position
    this.worldState.updateCharacterPosition(character.id, newPosition)

    if (newProgress < 1) {
      this.worldState.updateNavigationProgress(character.id, newProgress)
      return
    }

    // Reached current target node
    const nextIndex = nav.currentPathIndex + 1

    if (nextIndex >= nav.path.length - 1) {
      // Arrived at final destination
      this.handleArrivalAtDestination(character)
    } else {
      // Continue to next node
      this.handleContinueToNextNode(character, nextIndex, newPosition)
    }
  }

  private handleArrivalAtDestination(character: SimCharacter): void {
    const nav = character.navigation
    const finalNodeId = nav.path[nav.path.length - 1]
    const map = this.worldState.getMap(character.currentMapId)
    const finalNode = map?.nodes.find((n) => n.id === finalNodeId)

    if (!nav.startPosition || !nav.targetPosition) return

    const finalDirection = getDirection(nav.startPosition, nav.targetPosition)

    // Update character state
    this.worldState.updateCharacter(character.id, {
      position: { ...nav.targetPosition },
      direction: finalDirection,
      currentNodeId: finalNodeId,
    })
    this.worldState.completeNavigation(character.id)

    // Check for conversation arrival
    const conversationDest = this.conversationDestinations.get(character.id)
    if (conversationDest && finalNodeId === conversationDest.targetNodeId) {
      this.startConversation(character.id, conversationDest.npcId)
      this.conversationDestinations.delete(character.id)
      return
    }

    // Check cross-map navigation
    const crossNav = this.worldState.getCrossMapNavigation(character.id)
    if (crossNav?.isActive) {
      this.handleCrossMapArrival(character, crossNav, finalNode)
      return
    }

    // Normal navigation: check for entrance
    if (finalNode?.type === 'entrance' && finalNode.leadsTo) {
      this.startMapTransition(character.id, finalNode)
    } else {
      this.scheduleNextMove(character.id)
    }
  }

  private handleCrossMapArrival(
    character: SimCharacter,
    crossNav: SimCrossMapNavState,
    finalNode: PathNode | undefined
  ): void {
    const route = crossNav.route
    const currentSegmentIndex = crossNav.currentSegmentIndex

    // If at entrance and more segments, transition to next map
    if (finalNode?.type === 'entrance' && finalNode.leadsTo && hasMoreSegments(route, currentSegmentIndex)) {
      this.worldState.advanceCrossMapSegment(character.id)
      this.startMapTransition(character.id, finalNode)
      return
    }

    // No more segments - reached final destination
    this.worldState.completeCrossMapNavigation(character.id)
    this.scheduleNextMove(character.id)
  }

  private handleContinueToNextNode(character: SimCharacter, nextIndex: number, newPosition: Position): void {
    const nav = character.navigation
    const nextNodeId = nav.path[nextIndex + 1]
    const map = this.worldState.getMap(character.currentMapId)
    const nextNode = map?.nodes.find((n) => n.id === nextNodeId)

    if (!nextNode) return

    const currentNodeId = nav.path[nextIndex]
    const nextPosition: Position = { x: nextNode.x, y: nextNode.y }

    this.worldState.updateCharacter(character.id, {
      position: { ...newPosition },
      currentNodeId,
    })
    this.worldState.advanceToNextNode(character.id, nextPosition)
    this.worldState.updateCharacterDirection(character.id, getDirection(newPosition, nextPosition))
  }

  private checkIdleAndMove(character: SimCharacter, currentTime: number): void {
    // Skip if cross-map navigating (waiting for transition)
    if (this.worldState.isCrossMapNavigating(character.id)) {
      return
    }

    // Skip if in transition
    if (this.transitionStates.has(character.id)) {
      return
    }

    const idleState = this.idleStates.get(character.id)

    if (!idleState) {
      // Schedule initial move
      this.scheduleNextMove(character.id)
      return
    }

    if (currentTime >= idleState.nextMoveTime) {
      this.moveToRandomNode(character)
    }
  }

  private scheduleNextMove(characterId: string): void {
    const idleTime =
      this.config.idleTimeMin +
      Math.random() * (this.config.idleTimeMax - this.config.idleTimeMin)

    this.idleStates.set(characterId, {
      characterId,
      nextMoveTime: Date.now() + idleTime,
    })
  }

  private moveToRandomNode(character: SimCharacter): void {
    const maps = this.worldState.getMaps()
    const map = maps[character.currentMapId]
    if (!map) return

    const random = Math.random()

    // 30% chance of conversation (if NPCs available on current map)
    if (random < this.config.conversationProbability) {
      if (this.tryStartConversationMove(character)) {
        return
      }
    }

    // Remaining probability split between cross-map and same-map movement
    const adjustedRandom = (random - this.config.conversationProbability) / (1 - this.config.conversationProbability)
    const shouldCrossMap = adjustedRandom < this.config.crossMapProbability
    const allMapIds = Object.keys(maps)

    if (shouldCrossMap && allMapIds.length > 1) {
      // Select a random different map
      const otherMapIds = allMapIds.filter((id) => id !== character.currentMapId)
      const randomMapId = otherMapIds[Math.floor(Math.random() * otherMapIds.length)]
      const randomMap = maps[randomMapId]

      if (randomMap && randomMap.nodes.length > 0) {
        // Select a random non-entrance node in the target map
        const targetNodes = randomMap.nodes.filter((n) => n.type !== 'entrance')
        const randomNode =
          targetNodes.length > 0
            ? targetNodes[Math.floor(Math.random() * targetNodes.length)]
            : randomMap.nodes[Math.floor(Math.random() * randomMap.nodes.length)]

        this.initiateCrossMapNavigation(character, randomMapId, randomNode.id)
        return
      }
    }

    // Same-map movement
    this.moveToRandomNodeInMap(character, map)
  }

  private moveToRandomNodeInMap(character: SimCharacter, map: GameMap): void {
    const npcBlockedNodes = this.worldState.getNPCBlockedNodes(character.currentMapId)

    const shouldGoToEntrance = Math.random() < this.config.entranceProbability
    const otherNodes = map.nodes.filter((n) =>
      n.id !== character.currentNodeId && !npcBlockedNodes.has(n.id)
    )
    const nonEntranceNodes = otherNodes.filter((n) => n.type !== 'entrance')

    const availableNodes =
      shouldGoToEntrance || nonEntranceNodes.length === 0 ? otherNodes : nonEntranceNodes

    if (availableNodes.length === 0) {
      this.scheduleNextMove(character.id)
      return
    }

    const randomNode = availableNodes[Math.floor(Math.random() * availableNodes.length)]
    const path = findPathAvoidingNodes(map, character.currentNodeId, randomNode.id, npcBlockedNodes)

    if (path.length <= 1) {
      this.scheduleNextMove(character.id)
      return
    }

    this.startNavigationOnPath(character, path, map)
  }

  private initiateCrossMapNavigation(character: SimCharacter, targetMapId: string, targetNodeId: string): void {
    const maps = this.worldState.getMaps()

    // Build blocked nodes map for all maps
    const blockedNodesPerMap = new Map<string, Set<string>>()
    for (const mapId of Object.keys(maps)) {
      const blockedNodes = this.worldState.getNPCBlockedNodes(mapId)
      if (blockedNodes.size > 0) {
        blockedNodesPerMap.set(mapId, blockedNodes)
      }
    }

    const route = planCrossMapRoute(
      maps,
      character.currentMapId,
      character.currentNodeId,
      targetMapId,
      targetNodeId,
      blockedNodesPerMap
    )

    if (!route || route.segments.length === 0) {
      this.scheduleNextMove(character.id)
      return
    }

    // Start cross-map navigation
    this.worldState.startCrossMapNavigation(character.id, targetMapId, targetNodeId, route)

    // Start the first segment
    const firstSegment = route.segments[0]
    this.startCrossMapSegment(character, firstSegment)
  }

  private startCrossMapSegment(character: SimCharacter, segment: RouteSegment): void {
    const map = this.worldState.getMap(segment.mapId)
    if (!map) return

    // Handle single-node segment
    if (segment.path.length < 2) {
      // Check if there are more segments
      const crossNav = this.worldState.getCrossMapNavigation(character.id)
      if (crossNav && hasMoreSegments(crossNav.route, crossNav.currentSegmentIndex)) {
        const entryNode = map.nodes.find((n) => n.id === segment.path[0])
        if (entryNode?.type === 'entrance' && entryNode.leadsTo) {
          this.worldState.advanceCrossMapSegment(character.id)
          this.startMapTransition(character.id, entryNode)
        }
      } else {
        this.worldState.completeCrossMapNavigation(character.id)
        this.scheduleNextMove(character.id)
      }
      return
    }

    this.startNavigationOnPath(character, segment.path, map)
  }

  private startNavigationOnPath(character: SimCharacter, path: string[], map: GameMap): void {
    const firstTargetNode = map.nodes.find((n) => n.id === path[1])
    if (!firstTargetNode) return

    const currentPosition = character.position
    const targetPosition = { x: firstTargetNode.x, y: firstTargetNode.y }

    this.worldState.startNavigation(character.id, path, currentPosition, targetPosition)
    this.worldState.updateCharacterDirection(character.id, getDirection(currentPosition, targetPosition))

    // Clear idle state when starting movement
    this.idleStates.delete(character.id)
  }

  // Map transition handling
  private startMapTransition(characterId: string, entranceNode: PathNode): void {
    if (!entranceNode.leadsTo) return

    const character = this.worldState.getCharacter(characterId)
    if (!character) return

    const { mapId, nodeId } = entranceNode.leadsTo
    const targetMap = this.worldState.getMap(mapId)
    const targetNode = targetMap?.nodes.find((n) => n.id === nodeId)

    if (!targetMap || !targetNode) return

    this.worldState.startTransition(characterId, character.currentMapId, mapId)

    this.transitionStates.set(characterId, {
      phase: 'fadeOut',
      progress: 0,
      targetMapId: mapId,
      targetNodeId: nodeId,
      targetPosition: { x: targetNode.x, y: targetNode.y },
    })
  }

  private updateTransition(characterId: string, deltaTime: number): void {
    const state = this.transitionStates.get(characterId)
    if (!state) return

    // Fade speed: complete in ~0.5 seconds
    const fadeSpeed = 2.0 // progress per second
    state.progress += deltaTime * fadeSpeed

    if (state.phase === 'fadeOut') {
      this.worldState.updateTransitionProgress(Math.min(1, state.progress))

      if (state.progress >= 1) {
        // Complete fade out, switch to fade in
        this.worldState.setCharacterMap(
          characterId,
          state.targetMapId,
          state.targetNodeId,
          state.targetPosition
        )
        state.phase = 'fadeIn'
        state.progress = 0
      }
    } else {
      // fadeIn
      this.worldState.updateTransitionProgress(Math.max(0, 1 - state.progress))

      if (state.progress >= 1) {
        // Transition complete
        this.worldState.endTransition()
        this.transitionStates.delete(characterId)

        // Continue cross-map navigation if active
        const crossNav = this.worldState.getCrossMapNavigation(characterId)
        if (crossNav?.isActive) {
          const currentSegment = crossNav.route.segments[crossNav.currentSegmentIndex]
          if (currentSegment) {
            const character = this.worldState.getCharacter(characterId)
            if (character) {
              this.startCrossMapSegment(character, currentSegment)
            }
          }
        } else {
          this.scheduleNextMove(characterId)
        }
      }
    }
  }

  // Conversation methods

  // Try to start a conversation move to an available NPC
  private tryStartConversationMove(character: SimCharacter): boolean {
    const npcsOnMap = this.worldState.getNPCsOnMap(character.currentMapId)

    // Filter out NPCs already in conversation
    const availableNPCs = npcsOnMap.filter((npc) => !npc.isInConversation)
    if (availableNPCs.length === 0) {
      return false
    }

    // Select a random available NPC
    const targetNPC = availableNPCs[Math.floor(Math.random() * availableNPCs.length)]
    const map = this.worldState.getMap(character.currentMapId)
    if (!map) return false

    // Find adjacent nodes to the NPC (cardinal directions only - no diagonals)
    const adjacentNodeIds = this.getCardinalAdjacentNodes(targetNPC.currentNodeId, map)
    const npcBlockedNodes = this.worldState.getNPCBlockedNodes(character.currentMapId)

    // Filter to available (unblocked) adjacent nodes
    const availableAdjacent = adjacentNodeIds.filter((id) => !npcBlockedNodes.has(id))
    if (availableAdjacent.length === 0) {
      return false
    }

    // Check if character is already at an adjacent node - start conversation immediately
    if (availableAdjacent.includes(character.currentNodeId)) {
      this.startConversation(character.id, targetNPC.id)
      return true
    }

    // Select closest adjacent node to character
    const characterNode = map.nodes.find((n) => n.id === character.currentNodeId)
    if (!characterNode) return false

    let closestNode: PathNode | null = null
    let closestDistance = Infinity

    for (const nodeId of availableAdjacent) {
      const node = map.nodes.find((n) => n.id === nodeId)
      if (!node) continue

      const distance = getDistance(characterNode, node)
      if (distance < closestDistance) {
        closestDistance = distance
        closestNode = node
      }
    }

    if (!closestNode) return false

    // Find path to the closest adjacent node
    const path = findPathAvoidingNodes(map, character.currentNodeId, closestNode.id, npcBlockedNodes)
    if (path.length <= 1) {
      // Path too short (shouldn't happen if closestNode is different from current)
      return false
    }

    // Store conversation destination
    this.conversationDestinations.set(character.id, {
      npcId: targetNPC.id,
      targetNodeId: closestNode.id,
    })

    // Start navigation to the adjacent node
    this.startNavigationOnPath(character, path, map)
    return true
  }

  // Get adjacent (connected) nodes to a given node - cardinal directions only (no diagonals)
  private getCardinalAdjacentNodes(nodeId: string, map: GameMap): string[] {
    const node = map.nodes.find((n) => n.id === nodeId)
    if (!node) return []

    // Parse nodeId to get row/col (format: prefix-row-col)
    const parts = nodeId.split('-')
    if (parts.length < 3) return node.connectedTo // Fallback for non-grid nodes

    const prefix = parts.slice(0, -2).join('-')
    const row = parseInt(parts[parts.length - 2], 10)
    const col = parseInt(parts[parts.length - 1], 10)

    // Cardinal direction node IDs
    const cardinalIds = [
      `${prefix}-${row - 1}-${col}`, // up
      `${prefix}-${row + 1}-${col}`, // down
      `${prefix}-${row}-${col - 1}`, // left
      `${prefix}-${row}-${col + 1}`, // right
    ]

    // Filter connected nodes to only include cardinal directions
    return node.connectedTo.filter((connectedId) => cardinalIds.includes(connectedId))
  }

  // Start a conversation between character and NPC
  private startConversation(characterId: string, npcId: string): void {
    const character = this.worldState.getCharacter(characterId)
    const npc = this.worldState.getNPC(npcId)
    if (!character || !npc) return

    // Make character and NPC face each other
    const charToNpcDirection = this.getDirectionFromPositions(character.position, npc.position)
    this.worldState.updateCharacterDirection(characterId, charToNpcDirection)
    this.worldState.updateNPCDirection(npcId, this.getOppositeDirection(charToNpcDirection))

    // Set NPC conversation state
    this.worldState.setNPCConversationState(npcId, true)

    // Set character conversation state
    const conversationState: ConversationState = {
      isActive: true,
      npcId,
      startTime: Date.now(),
      duration: this.config.conversationDuration,
    }

    this.worldState.updateCharacter(characterId, {
      conversation: conversationState,
    })
  }

  // End a conversation
  private endConversation(characterId: string): void {
    const character = this.worldState.getCharacter(characterId)
    if (!character?.conversation) return

    const npcId = character.conversation.npcId
    const npc = this.worldState.getNPC(npcId)

    // Clear NPC conversation state
    if (npc) {
      this.worldState.setNPCConversationState(npcId, false)
    }

    // Clear character conversation state
    this.worldState.updateCharacter(characterId, {
      conversation: null,
    })

    // Schedule next move
    this.scheduleNextMove(characterId)
  }

  // Get direction from one position to another
  private getDirectionFromPositions(from: Position, to: Position): Direction {
    const dx = to.x - from.x
    const dy = to.y - from.y

    // Use the larger axis to determine primary direction
    if (Math.abs(dx) > Math.abs(dy)) {
      return dx > 0 ? 'right' : 'left'
    } else {
      return dy > 0 ? 'down' : 'up'
    }
  }

  // Get opposite direction
  private getOppositeDirection(direction: Direction): Direction {
    const opposites: Record<Direction, Direction> = {
      up: 'down',
      down: 'up',
      left: 'right',
      right: 'left',
    }
    return opposites[direction]
  }
}

interface TransitionSimState {
  phase: 'fadeOut' | 'fadeIn'
  progress: number
  targetMapId: string
  targetNodeId: string
  targetPosition: Position
}
