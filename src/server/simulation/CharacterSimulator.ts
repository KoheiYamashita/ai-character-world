import type { Position, GameMap, PathNode, RouteSegment } from '@/types'
import type { SimCharacter, SimulationConfig, SimCrossMapNavState } from './types'
import type { WorldStateManager } from './WorldState'
import { findPathAvoidingNodes } from '@/lib/pathfinding'
import { lerpPosition, getDirection, getDistance } from '@/lib/movement'
import { planCrossMapRoute, hasMoreSegments } from '@/lib/crossMapNavigation'

interface IdleState {
  characterId: string
  nextMoveTime: number
}

export class CharacterSimulator {
  private worldState: WorldStateManager
  private config: SimulationConfig
  private idleStates: Map<string, IdleState> = new Map()
  private transitionStates: Map<string, TransitionSimState> = new Map()

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
      console.log(`[CrossMap] Completed segment ${currentSegmentIndex}, transitioning to next map`)
      this.worldState.advanceCrossMapSegment(character.id)
      this.startMapTransition(character.id, finalNode)
      return
    }

    // No more segments - reached final destination
    console.log(`[CrossMap] Reached final destination: ${finalNode?.id}`)
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

    // 50% chance of cross-map movement
    const shouldCrossMap = Math.random() < this.config.crossMapProbability
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

        console.log(`[RandomMove] Initiating cross-map navigation to ${randomMapId}:${randomNode.id}`)
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
      console.log(`[CrossMap] Could not find route to ${targetMapId}:${targetNodeId}`)
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
      console.log(`[CrossMap] Single-node segment in map "${segment.mapId}"`)
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
    console.log(`[CrossMap] Starting segment in map "${segment.mapId}", path: [${segment.path.join(' -> ')}]`)
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

    console.log(`[Transition] Starting transition from ${character.currentMapId} to ${mapId}`)

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
}

interface TransitionSimState {
  phase: 'fadeOut' | 'fadeIn'
  progress: number
  targetMapId: string
  targetNodeId: string
  targetPosition: Position
}
