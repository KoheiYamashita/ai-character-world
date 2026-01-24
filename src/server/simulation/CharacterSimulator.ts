import type { Position, WorldMap, PathNode, RouteSegment } from '@/types'
import type { SimCharacter, SimulationConfig, SimCrossMapNavState } from './types'
import type { WorldStateManager } from './WorldState'
import { findPathAvoidingNodes } from '@/lib/pathfinding'
import { lerpPosition, getDirection, getDistance } from '@/lib/movement'
import { planCrossMapRoute, hasMoreSegments } from '@/lib/crossMapNavigation'

export class CharacterSimulator {
  private worldState: WorldStateManager
  private config: SimulationConfig
  private transitionStates: Map<string, TransitionSimState> = new Map()
  private onNavigationComplete: ((characterId: string) => void) | null = null
  // Track navigation state from previous tick for completion detection
  private wasNavigatingLastTick: Set<string> = new Set()

  constructor(worldState: WorldStateManager, config: SimulationConfig) {
    this.worldState = worldState
    this.config = config
  }

  // Set callback for navigation complete (triggers next behavior decision)
  setOnNavigationComplete(callback: (characterId: string) => void): void {
    this.onNavigationComplete = callback
  }

  // Update all characters for one tick
  tick(deltaTime: number, _currentTime: number): void {
    const characters = this.worldState.getAllCharacters()

    for (const character of characters) {
      // Skip if executing action (ActionExecutor handles this)
      if (character.currentAction) {
        continue
      }

      // Handle transition animation
      if (this.transitionStates.has(character.id)) {
        this.updateTransition(character.id, deltaTime)
        continue
      }

      // Skip movement while in active conversation
      if (character.conversation?.status === 'active') {
        continue
      }

      // Handle movement (idle state handled by BehaviorDecider in future)
      if (character.navigation.isMoving) {
        this.updateMovement(character, deltaTime)
      }
    }

    // Detect navigation completion (navigating last tick → idle this tick)
    this.detectNavigationCompletion()
  }

  // Check if character is in any navigation-related state
  private isCharacterNavigating(character: SimCharacter): boolean {
    return character.navigation.isMoving ||
           this.transitionStates.has(character.id) ||
           character.crossMapNavigation?.isActive === true
  }

  // Detect and handle navigation completion by comparing with previous tick
  private detectNavigationCompletion(): void {
    const currentlyNavigating = new Set<string>()

    // Collect current navigation states (after all processing)
    for (const character of this.worldState.getAllCharacters()) {
      if (this.isCharacterNavigating(character)) {
        currentlyNavigating.add(character.id)
      }
    }

    // Detect transitions from navigating to idle
    for (const characterId of this.wasNavigatingLastTick) {
      if (!currentlyNavigating.has(characterId)) {
        const character = this.worldState.getCharacter(characterId)
        // Only trigger if truly idle (not started action or conversation)
        if (character && !character.currentAction && character.conversation?.status !== 'active') {
          if (this.onNavigationComplete) {
            this.onNavigationComplete(characterId)
          }
        }
      }
    }

    this.wasNavigatingLastTick = currentlyNavigating
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

    // Check for entrance (triggers map transition)
    if (finalNode?.type === 'entrance' && finalNode.leadsTo) {
      this.startMapTransition(character.id, finalNode)
      return
    }

    // Navigation completion is now detected in detectNavigationCompletion()
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

    // Navigation completion is now detected in detectNavigationCompletion()
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

  // ===== Public methods for external navigation control =====

  /**
   * 外部から経路移動を指示（Step 6連携用）
   * @returns 移動開始成功時true
   */
  public navigateToNode(characterId: string, targetNodeId: string): boolean {
    const character = this.worldState.getCharacter(characterId)
    if (!character) return false

    const map = this.worldState.getMap(character.currentMapId)
    if (!map) return false

    // 既に移動中ならスキップ
    if (character.navigation.isMoving) return false

    // 同じノードならスキップ
    if (character.currentNodeId === targetNodeId) return true

    const npcBlockedNodes = this.worldState.getNPCBlockedNodes(character.currentMapId)
    const path = findPathAvoidingNodes(map, character.currentNodeId, targetNodeId, npcBlockedNodes)

    if (path.length <= 1) return false

    this.startNavigationOnPath(character, path, map)
    return true
  }

  /**
   * クロスマップ移動を開始（Step 6連携用）
   * @returns 移動開始成功時true
   */
  public navigateToMap(characterId: string, targetMapId: string, targetNodeId: string): boolean {
    const character = this.worldState.getCharacter(characterId)
    if (!character) return false

    // 既に移動中ならスキップ
    if (character.navigation.isMoving) return false

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
      return false
    }

    // Start cross-map navigation
    this.worldState.startCrossMapNavigation(characterId, targetMapId, targetNodeId, route)

    // Start the first segment
    const firstSegment = route.segments[0]
    this.startCrossMapSegment(character, firstSegment)
    return true
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
      }
      return
    }

    this.startNavigationOnPath(character, segment.path, map)
  }

  private startNavigationOnPath(character: SimCharacter, path: string[], map: WorldMap): void {
    const firstTargetNode = map.nodes.find((n) => n.id === path[1])
    if (!firstTargetNode) return

    const currentPosition = character.position
    const targetPosition = { x: firstTargetNode.x, y: firstTargetNode.y }

    this.worldState.startNavigation(character.id, path, currentPosition, targetPosition)
    this.worldState.updateCharacterDirection(character.id, getDirection(currentPosition, targetPosition))
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
