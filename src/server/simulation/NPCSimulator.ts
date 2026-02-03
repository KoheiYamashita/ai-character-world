import type { Position, WorldMap, PathNode, RouteSegment } from '@/types'
import type { SimNPC, SimulationConfig, SimCrossMapNavState } from './types'
import type { WorldStateManager } from './WorldState'
import { findPathAvoidingNodes } from '@/lib/pathfinding'
import { lerpPosition, getDirection, getDistance } from '@/lib/movement'
import { planCrossMapRoute, hasMoreSegments } from '@/lib/crossMapNavigation'

export class NPCSimulator {
  private worldState: WorldStateManager
  private config: SimulationConfig
  private onNavigationComplete: ((npcId: string) => void) | null = null
  // Track navigation state from previous tick for completion detection
  private wasNavigatingLastTick: Set<string> = new Set()

  constructor(worldState: WorldStateManager, config: SimulationConfig) {
    this.worldState = worldState
    this.config = config
  }

  // Set callback for navigation complete
  setOnNavigationComplete(callback: (npcId: string) => void): void {
    this.onNavigationComplete = callback
  }

  // Update all NPCs for one tick
  tick(deltaTime: number): void {
    const npcs = this.worldState.getAllNPCs()

    for (const npc of npcs) {
      // Skip if in conversation
      if (npc.isInConversation) {
        continue
      }

      // Handle movement
      if (npc.navigation.isMoving) {
        this.updateMovement(npc, deltaTime)
      }
    }

    // Detect navigation completion
    this.detectNavigationCompletion()
  }

  // Check if NPC is in any navigation-related state
  private isNPCNavigating(npc: SimNPC): boolean {
    return npc.navigation.isMoving || npc.crossMapNavigation?.isActive === true
  }

  // Detect and handle navigation completion by comparing with previous tick
  private detectNavigationCompletion(): void {
    const currentlyNavigating = new Set<string>()

    // Collect current navigation states (after all processing)
    for (const npc of this.worldState.getAllNPCs()) {
      if (this.isNPCNavigating(npc)) {
        currentlyNavigating.add(npc.id)
      }
    }

    // Detect transitions from navigating to idle
    for (const npcId of this.wasNavigatingLastTick) {
      if (!currentlyNavigating.has(npcId)) {
        const npc = this.worldState.getNPC(npcId)
        if (npc && !npc.isInConversation) {
          if (this.onNavigationComplete) {
            this.onNavigationComplete(npcId)
          }
        }
      }
    }

    this.wasNavigatingLastTick = currentlyNavigating
  }

  private updateMovement(npc: SimNPC, deltaTime: number): void {
    const nav = npc.navigation
    if (!nav.startPosition || !nav.targetPosition) return

    const distance = getDistance(nav.startPosition, nav.targetPosition)
    const duration = distance / this.config.movementSpeed
    const newProgress = Math.min(1, nav.progress + deltaTime / duration)
    const newPosition = lerpPosition(nav.startPosition, nav.targetPosition, newProgress)

    // Update position
    this.worldState.updateNPCPosition(npc.id, newPosition)

    if (newProgress < 1) {
      this.worldState.updateNPCNavigationProgress(npc.id, newProgress)
      return
    }

    // Reached current target node
    const nextIndex = nav.currentPathIndex + 1

    if (nextIndex >= nav.path.length - 1) {
      // Arrived at final destination
      this.handleArrivalAtDestination(npc)
    } else {
      // Continue to next node
      this.handleContinueToNextNode(npc, nextIndex, newPosition)
    }
  }

  private handleArrivalAtDestination(npc: SimNPC): void {
    const nav = npc.navigation
    const finalNodeId = nav.path[nav.path.length - 1]
    const map = this.worldState.getMap(npc.mapId)
    const finalNode = map?.nodes.find((n) => n.id === finalNodeId)

    if (!nav.startPosition || !nav.targetPosition) return

    const finalDirection = getDirection(nav.startPosition, nav.targetPosition)

    // Update NPC state
    this.worldState.updateNPCPosition(npc.id, nav.targetPosition)
    this.worldState.updateNPCDirection(npc.id, finalDirection)
    this.worldState.updateNPCNode(npc.id, finalNodeId)
    this.worldState.completeNPCNavigation(npc.id)

    // Check cross-map navigation
    const crossNav = this.worldState.getNPCCrossMapNavigation(npc.id)
    if (crossNav?.isActive) {
      this.handleCrossMapArrival(npc, crossNav, finalNode)
      return
    }

    // Check for entrance (triggers map transition for cross-map only)
    // NPCs don't trigger map transitions unless in cross-map navigation
  }

  private handleCrossMapArrival(
    npc: SimNPC,
    crossNav: SimCrossMapNavState,
    finalNode: PathNode | undefined
  ): void {
    const route = crossNav.route
    const currentSegmentIndex = crossNav.currentSegmentIndex

    // If at entrance and more segments, transition to next map
    if (finalNode?.type === 'entrance' && finalNode.leadsTo && hasMoreSegments(route, currentSegmentIndex)) {
      this.worldState.advanceNPCCrossMapSegment(npc.id)
      this.handleMapTransition(npc.id, finalNode)
      return
    }

    // No more segments - reached final destination
    this.worldState.completeNPCCrossMapNavigation(npc.id)
  }

  private handleContinueToNextNode(npc: SimNPC, nextIndex: number, newPosition: Position): void {
    const nav = npc.navigation
    const currentNodeId = nav.path[nextIndex]
    const nextNodeId = nav.path[nextIndex + 1]
    const map = this.worldState.getMap(npc.mapId)
    const nextNode = map?.nodes.find((n) => n.id === nextNodeId)

    if (!nextNode) return

    const nextPosition: Position = { x: nextNode.x, y: nextNode.y }

    // Update NPC position and node
    this.worldState.updateNPCPosition(npc.id, newPosition)
    this.worldState.updateNPCNode(npc.id, currentNodeId)
    this.worldState.advanceNPCToNextNode(npc.id, nextPosition)
    this.worldState.updateNPCDirection(npc.id, getDirection(newPosition, nextPosition))
  }

  // ===== Public methods for external navigation control =====

  /**
   * Navigate NPC to a node within the same map
   * @returns true if navigation started successfully
   */
  public navigateToNode(npcId: string, targetNodeId: string): boolean {
    const npc = this.worldState.getNPC(npcId)
    if (!npc) return false

    const map = this.worldState.getMap(npc.mapId)
    if (!map) return false

    // Skip if already moving
    if (npc.navigation.isMoving) return false

    // Skip if in conversation
    if (npc.isInConversation) return false

    // Skip if same node
    if (npc.currentNodeId === targetNodeId) return true

    // Get blocked nodes (other NPCs + characters)
    const npcBlockedNodes = this.worldState.getNPCBlockedNodes(npc.mapId)
    const characterBlockedNodes = this.worldState.getCharacterBlockedNodes(npc.mapId)
    const allBlockedNodes = new Set([...npcBlockedNodes, ...characterBlockedNodes])
    // Remove self from blocked nodes
    allBlockedNodes.delete(npc.currentNodeId)

    const path = findPathAvoidingNodes(map, npc.currentNodeId, targetNodeId, allBlockedNodes)

    if (path.length <= 1) return false

    this.startNavigationOnPath(npc, path, map)
    return true
  }

  /**
   * Navigate NPC to a node on a different map (cross-map navigation)
   * @returns true if navigation started successfully
   */
  public navigateToMap(npcId: string, targetMapId: string, targetNodeId: string): boolean {
    const npc = this.worldState.getNPC(npcId)
    if (!npc) return false

    // Skip if already moving
    if (npc.navigation.isMoving) return false

    // Skip if in conversation
    if (npc.isInConversation) return false

    const maps = this.worldState.getMaps()

    // Build blocked nodes map for all maps
    const blockedNodesPerMap = new Map<string, Set<string>>()
    for (const mapId of Object.keys(maps)) {
      const npcBlockedNodes = this.worldState.getNPCBlockedNodes(mapId)
      const characterBlockedNodes = this.worldState.getCharacterBlockedNodes(mapId)
      const allBlocked = new Set([...npcBlockedNodes, ...characterBlockedNodes])
      // Remove self from blocked nodes
      if (mapId === npc.mapId) {
        allBlocked.delete(npc.currentNodeId)
      }
      if (allBlocked.size > 0) {
        blockedNodesPerMap.set(mapId, allBlocked)
      }
    }

    const route = planCrossMapRoute(
      maps,
      npc.mapId,
      npc.currentNodeId,
      targetMapId,
      targetNodeId,
      blockedNodesPerMap
    )

    if (!route || route.segments.length === 0) {
      return false
    }

    // Start cross-map navigation
    this.worldState.startNPCCrossMapNavigation(npcId, targetMapId, targetNodeId, route)

    // Start the first segment
    const firstSegment = route.segments[0]
    this.startCrossMapSegment(npc, firstSegment)
    return true
  }

  private startCrossMapSegment(npc: SimNPC, segment: RouteSegment): void {
    const map = this.worldState.getMap(segment.mapId)
    if (!map) return

    // Handle single-node segment
    if (segment.path.length < 2) {
      // Check if there are more segments
      const crossNav = this.worldState.getNPCCrossMapNavigation(npc.id)
      if (crossNav && hasMoreSegments(crossNav.route, crossNav.currentSegmentIndex)) {
        const entryNode = map.nodes.find((n) => n.id === segment.path[0])
        if (entryNode?.type === 'entrance' && entryNode.leadsTo) {
          this.worldState.advanceNPCCrossMapSegment(npc.id)
          this.handleMapTransition(npc.id, entryNode)
        }
      } else {
        this.worldState.completeNPCCrossMapNavigation(npc.id)
      }
      return
    }

    this.startNavigationOnPath(npc, segment.path, map)
  }

  private startNavigationOnPath(npc: SimNPC, path: string[], map: WorldMap): void {
    const firstTargetNode = map.nodes.find((n) => n.id === path[1])
    if (!firstTargetNode) return

    const currentPosition = npc.position
    const targetPosition = { x: firstTargetNode.x, y: firstTargetNode.y }

    this.worldState.startNPCNavigation(npc.id, path, currentPosition, targetPosition)
    this.worldState.updateNPCDirection(npc.id, getDirection(currentPosition, targetPosition))
  }

  // NPC map transition (instant, no fade)
  private handleMapTransition(npcId: string, entranceNode: PathNode): void {
    if (!entranceNode.leadsTo) return

    const npc = this.worldState.getNPC(npcId)
    if (!npc) return

    const { mapId, nodeId } = entranceNode.leadsTo
    const targetMap = this.worldState.getMap(mapId)
    const targetNode = targetMap?.nodes.find((n) => n.id === nodeId)

    if (!targetMap || !targetNode) return

    const targetPosition = { x: targetNode.x, y: targetNode.y }

    // Instant map transition for NPC (no fade animation)
    this.worldState.updateNPCMap(npcId, mapId, nodeId, targetPosition)

    // Continue cross-map navigation if active
    const crossNav = this.worldState.getNPCCrossMapNavigation(npcId)
    if (crossNav?.isActive) {
      const currentSegment = crossNav.route.segments[crossNav.currentSegmentIndex]
      if (currentSegment) {
        const updatedNpc = this.worldState.getNPC(npcId)
        if (updatedNpc) {
          this.startCrossMapSegment(updatedNpc, currentSegment)
        }
      }
    }
  }

  // Reset all NPCs to their home positions
  public resetAllToHome(): void {
    this.worldState.resetAllNPCsToHome()
    // Clear navigation tracking
    this.wasNavigatingLastTick.clear()
  }
}
