import type { WorldMap, WorldTime, Position, Direction, CrossMapRoute, NPC } from '@/types'
import type {
  WorldState,
  SimCharacter,
  SimNPC,
  SimTransitionState,
  SimNavigationState,
  SimCrossMapNavState,
  SerializedWorldState,
} from './types'
import { serializeWorldState, createSimNPC } from './types'

const INITIAL_TIME: WorldTime = { hour: 8, minute: 0, day: 1 }
const INITIAL_MAP_ID = 'home'

export class WorldStateManager {
  private state: WorldState
  private maps: Record<string, WorldMap> = {}
  // mapId -> (nodeId -> npcId) for tracking which NPC is at which node
  private npcBlockedNodes: Map<string, Map<string, string>> = new Map()

  constructor() {
    this.state = {
      characters: new Map(),
      npcs: new Map(),
      currentMapId: INITIAL_MAP_ID,
      time: { ...INITIAL_TIME },
      isPaused: false,
      transition: {
        isTransitioning: false,
        characterId: null,
        fromMapId: null,
        toMapId: null,
        progress: 0,
      },
      tick: 0,
    }
  }

  // Initialize with maps and characters
  initialize(maps: Record<string, WorldMap>, initialMapId?: string): void {
    this.maps = maps
    if (initialMapId) {
      this.state.currentMapId = initialMapId
    }
  }

  getMaps(): Record<string, WorldMap> {
    return this.maps
  }

  getMap(mapId: string): WorldMap | undefined {
    return this.maps[mapId]
  }

  // NPC blocked nodes management
  // Initialize blocked nodes from NPC list (called at startup)
  initializeNPCBlockedNodes(npcs: NPC[]): void {
    this.npcBlockedNodes.clear()
    for (const npc of npcs) {
      const mapNodes = this.npcBlockedNodes.get(npc.mapId) ?? new Map<string, string>()
      mapNodes.set(npc.currentNodeId, npc.id)
      this.npcBlockedNodes.set(npc.mapId, mapNodes)
    }
  }

  // Legacy compatibility: set blocked nodes as Set (for external callers)
  setNPCBlockedNodes(mapId: string, nodeIds: Set<string>): void {
    const mapNodes = new Map<string, string>()
    for (const nodeId of nodeIds) {
      mapNodes.set(nodeId, 'unknown')
    }
    this.npcBlockedNodes.set(mapId, mapNodes)
  }

  // Get blocked node IDs as Set (for pathfinding)
  getNPCBlockedNodes(mapId: string): Set<string> {
    const mapNodes = this.npcBlockedNodes.get(mapId)
    return mapNodes ? new Set(mapNodes.keys()) : new Set()
  }

  // Get all blocked nodes across all maps (for pathfinding)
  getAllNPCBlockedNodes(): Map<string, Set<string>> {
    const result = new Map<string, Set<string>>()
    for (const [mapId, nodeMap] of this.npcBlockedNodes) {
      result.set(mapId, new Set(nodeMap.keys()))
    }
    return result
  }

  clearNPCBlockedNodes(): void {
    this.npcBlockedNodes.clear()
  }

  // Update NPC blocked node when NPC moves
  updateNPCBlockedNode(
    npcId: string,
    oldMapId: string,
    oldNodeId: string,
    newMapId: string,
    newNodeId: string
  ): void {
    // Remove from old position
    const oldMapNodes = this.npcBlockedNodes.get(oldMapId)
    if (oldMapNodes) {
      oldMapNodes.delete(oldNodeId)
      if (oldMapNodes.size === 0) {
        this.npcBlockedNodes.delete(oldMapId)
      }
    }

    // Add to new position
    const newMapNodes = this.npcBlockedNodes.get(newMapId) ?? new Map<string, string>()
    newMapNodes.set(newNodeId, npcId)
    this.npcBlockedNodes.set(newMapId, newMapNodes)
  }

  // Get character blocked nodes for NPC pathfinding
  getCharacterBlockedNodes(mapId: string): Set<string> {
    const blocked = new Set<string>()
    for (const char of this.state.characters.values()) {
      if (char.currentMapId === mapId) {
        blocked.add(char.currentNodeId)
      }
    }
    return blocked
  }

  // NPC management
  initializeNPCs(npcs: NPC[]): void {
    this.state.npcs.clear()
    for (const npc of npcs) {
      const simNPC = createSimNPC(npc)
      this.state.npcs.set(npc.id, simNPC)
    }
  }

  addNPC(npc: NPC): void {
    const simNPC = createSimNPC(npc)
    this.state.npcs.set(npc.id, simNPC)
  }

  getNPC(id: string): SimNPC | undefined {
    return this.state.npcs.get(id)
  }

  getAllNPCs(): SimNPC[] {
    return Array.from(this.state.npcs.values())
  }

  getNPCsOnMap(mapId: string): SimNPC[] {
    return Array.from(this.state.npcs.values()).filter((npc) => npc.mapId === mapId)
  }

  updateNPCDirection(id: string, direction: Direction): void {
    const npc = this.state.npcs.get(id)
    if (npc) {
      npc.direction = direction
    }
  }

  setNPCConversationState(id: string, isInConversation: boolean): void {
    const npc = this.state.npcs.get(id)
    if (npc) {
      npc.isInConversation = isInConversation
    }
  }

  // NPC position update
  updateNPCPosition(id: string, position: Position): void {
    const npc = this.state.npcs.get(id)
    if (npc) {
      npc.position = { ...position }
    }
  }

  // NPC node update (when arriving at a new node)
  updateNPCNode(id: string, nodeId: string): void {
    const npc = this.state.npcs.get(id)
    if (npc) {
      const oldNodeId = npc.currentNodeId
      npc.currentNodeId = nodeId
      // Update blocked nodes
      this.updateNPCBlockedNode(id, npc.mapId, oldNodeId, npc.mapId, nodeId)
    }
  }

  // NPC navigation state management
  startNPCNavigation(
    npcId: string,
    path: string[],
    startPosition: Position,
    targetPosition: Position
  ): void {
    const npc = this.state.npcs.get(npcId)
    if (npc) {
      npc.navigation = {
        isMoving: true,
        path,
        currentPathIndex: 0,
        progress: 0,
        startPosition: { ...startPosition },
        targetPosition: { ...targetPosition },
      }
    }
  }

  updateNPCNavigationProgress(npcId: string, progress: number): void {
    const npc = this.state.npcs.get(npcId)
    if (npc?.navigation) {
      npc.navigation.progress = progress
    }
  }

  advanceNPCToNextNode(npcId: string, newTargetPosition: Position): void {
    const npc = this.state.npcs.get(npcId)
    if (npc?.navigation) {
      npc.navigation.currentPathIndex++
      npc.navigation.progress = 0
      npc.navigation.startPosition = npc.navigation.targetPosition
      npc.navigation.targetPosition = { ...newTargetPosition }
    }
  }

  completeNPCNavigation(npcId: string): void {
    const npc = this.state.npcs.get(npcId)
    if (npc) {
      npc.navigation = {
        isMoving: false,
        path: [],
        currentPathIndex: 0,
        progress: 0,
        startPosition: null,
        targetPosition: null,
      }
    }
  }

  isNPCMoving(npcId: string): boolean {
    return this.state.npcs.get(npcId)?.navigation.isMoving ?? false
  }

  // NPC cross-map navigation
  getNPCCrossMapNavigation(npcId: string): SimCrossMapNavState | null {
    return this.state.npcs.get(npcId)?.crossMapNavigation ?? null
  }

  startNPCCrossMapNavigation(
    npcId: string,
    targetMapId: string,
    targetNodeId: string,
    route: CrossMapRoute
  ): void {
    const npc = this.state.npcs.get(npcId)
    if (npc) {
      npc.crossMapNavigation = {
        isActive: true,
        targetMapId,
        targetNodeId,
        route,
        currentSegmentIndex: 0,
      }
    }
  }

  advanceNPCCrossMapSegment(npcId: string): void {
    const npc = this.state.npcs.get(npcId)
    if (npc?.crossMapNavigation) {
      npc.crossMapNavigation.currentSegmentIndex++
    }
  }

  completeNPCCrossMapNavigation(npcId: string): void {
    const npc = this.state.npcs.get(npcId)
    if (npc) {
      npc.crossMapNavigation = null
    }
  }

  isNPCCrossMapNavigating(npcId: string): boolean {
    return this.state.npcs.get(npcId)?.crossMapNavigation?.isActive ?? false
  }

  // Update NPC map (when transitioning between maps)
  updateNPCMap(npcId: string, mapId: string, nodeId: string, position: Position): void {
    const npc = this.state.npcs.get(npcId)
    if (npc) {
      const oldMapId = npc.mapId
      const oldNodeId = npc.currentNodeId
      npc.mapId = mapId
      npc.currentNodeId = nodeId
      npc.position = { ...position }
      // Update blocked nodes
      this.updateNPCBlockedNode(npcId, oldMapId, oldNodeId, mapId, nodeId)
    }
  }

  // Reset NPC to home position (for day reset)
  resetNPCToHome(npcId: string): void {
    const npc = this.state.npcs.get(npcId)
    if (npc) {
      const oldMapId = npc.mapId
      const oldNodeId = npc.currentNodeId

      // Stop any ongoing navigation
      npc.navigation = {
        isMoving: false,
        path: [],
        currentPathIndex: 0,
        progress: 0,
        startPosition: null,
        targetPosition: null,
      }
      npc.crossMapNavigation = null

      // Reset to home
      npc.mapId = npc.homeMapId
      npc.currentNodeId = npc.homeNodeId
      npc.position = { ...npc.homePosition }

      // Update blocked nodes
      this.updateNPCBlockedNode(npcId, oldMapId, oldNodeId, npc.homeMapId, npc.homeNodeId)
    }
  }

  // Reset all NPCs to home positions
  resetAllNPCsToHome(): void {
    for (const npcId of this.state.npcs.keys()) {
      this.resetNPCToHome(npcId)
    }
  }

  // Get current state (for read-only access)
  getState(): WorldState {
    return this.state
  }

  // Get serialized state for SSE/API
  getSerializedState(): SerializedWorldState {
    return serializeWorldState(this.state)
  }

  // Increment tick counter
  incrementTick(): void {
    this.state.tick++
  }

  getTick(): number {
    return this.state.tick
  }

  // Character management
  addCharacter(character: SimCharacter): void {
    this.state.characters.set(character.id, character)
  }

  getCharacter(id: string): SimCharacter | undefined {
    return this.state.characters.get(id)
  }

  getAllCharacters(): SimCharacter[] {
    return Array.from(this.state.characters.values())
  }

  updateCharacter(id: string, updates: Partial<SimCharacter>): void {
    const char = this.state.characters.get(id)
    if (char) {
      this.state.characters.set(id, { ...char, ...updates })
    }
  }

  // Supplement character profile (personality, tendencies, customPrompt) from config
  // Used after restoring from persistence where profile fields are not saved
  supplementCharacterProfile(characterId: string, profile: {
    personality?: string
    tendencies?: string[]
    customPrompt?: string
  }): void {
    const char = this.state.characters.get(characterId)
    if (char) {
      char.personality = profile.personality
      char.tendencies = profile.tendencies ? [...profile.tendencies] : undefined
      char.customPrompt = profile.customPrompt
    }
  }

  updateCharacterPosition(id: string, position: Position): void {
    const char = this.state.characters.get(id)
    if (char) {
      char.position = { ...position }
    }
  }

  updateCharacterDirection(id: string, direction: Direction): void {
    const char = this.state.characters.get(id)
    if (char) {
      char.direction = direction
    }
  }

  setCharacterMap(id: string, mapId: string, nodeId: string, position: Position): void {
    const char = this.state.characters.get(id)
    if (char) {
      char.currentMapId = mapId
      char.currentNodeId = nodeId
      char.position = { ...position }
    }
  }

  // Navigation state management
  getNavigation(characterId: string): SimNavigationState | undefined {
    return this.state.characters.get(characterId)?.navigation
  }

  startNavigation(
    characterId: string,
    path: string[],
    startPosition: Position,
    targetPosition: Position
  ): void {
    const char = this.state.characters.get(characterId)
    if (char) {
      char.navigation = {
        isMoving: true,
        path,
        currentPathIndex: 0,
        progress: 0,
        startPosition: { ...startPosition },
        targetPosition: { ...targetPosition },
      }
    }
  }

  updateNavigationProgress(characterId: string, progress: number): void {
    const char = this.state.characters.get(characterId)
    if (char?.navigation) {
      char.navigation.progress = progress
    }
  }

  advanceToNextNode(characterId: string, newTargetPosition: Position): void {
    const char = this.state.characters.get(characterId)
    if (char?.navigation) {
      char.navigation.currentPathIndex++
      char.navigation.progress = 0
      char.navigation.startPosition = char.navigation.targetPosition
      char.navigation.targetPosition = { ...newTargetPosition }
    }
  }

  completeNavigation(characterId: string): void {
    const char = this.state.characters.get(characterId)
    if (char) {
      char.navigation = {
        isMoving: false,
        path: [],
        currentPathIndex: 0,
        progress: 0,
        startPosition: null,
        targetPosition: null,
      }
    }
  }

  isCharacterMoving(characterId: string): boolean {
    return this.state.characters.get(characterId)?.navigation.isMoving ?? false
  }

  // Cross-map navigation
  getCrossMapNavigation(characterId: string): SimCrossMapNavState | null {
    return this.state.characters.get(characterId)?.crossMapNavigation ?? null
  }

  startCrossMapNavigation(
    characterId: string,
    targetMapId: string,
    targetNodeId: string,
    route: CrossMapRoute
  ): void {
    const char = this.state.characters.get(characterId)
    if (char) {
      char.crossMapNavigation = {
        isActive: true,
        targetMapId,
        targetNodeId,
        route,
        currentSegmentIndex: 0,
      }
    }
  }

  advanceCrossMapSegment(characterId: string): void {
    const char = this.state.characters.get(characterId)
    if (char?.crossMapNavigation) {
      char.crossMapNavigation.currentSegmentIndex++
    }
  }

  completeCrossMapNavigation(characterId: string): void {
    const char = this.state.characters.get(characterId)
    if (char) {
      char.crossMapNavigation = null
    }
  }

  isCrossMapNavigating(characterId: string): boolean {
    return this.state.characters.get(characterId)?.crossMapNavigation?.isActive ?? false
  }

  // Transition state management
  getTransition(): SimTransitionState {
    return this.state.transition
  }

  startTransition(characterId: string, fromMapId: string, toMapId: string): void {
    this.state.transition = {
      isTransitioning: true,
      characterId,
      fromMapId,
      toMapId,
      progress: 0,
    }
  }

  updateTransitionProgress(progress: number): void {
    this.state.transition.progress = progress
  }

  endTransition(): void {
    const { toMapId } = this.state.transition
    if (toMapId) {
      this.state.currentMapId = toMapId
    }
    this.state.transition = {
      isTransitioning: false,
      characterId: null,
      fromMapId: null,
      toMapId: null,
      progress: 0,
    }
  }

  // Time management
  getTime(): WorldTime {
    return this.state.time
  }

  getCurrentHour(): number {
    return this.state.time.hour
  }

  setTime(time: WorldTime): void {
    this.state.time = { ...time }
  }

  advanceTime(minutes: number): void {
    let newMinute = this.state.time.minute + minutes
    let newHour = this.state.time.hour
    let newDay = this.state.time.day

    while (newMinute >= 60) {
      newMinute -= 60
      newHour++
    }

    while (newHour >= 24) {
      newHour -= 24
      newDay++
    }

    this.state.time = { hour: newHour, minute: newMinute, day: newDay }
  }

  // Pause control
  isPaused(): boolean {
    return this.state.isPaused
  }

  setPaused(paused: boolean): void {
    this.state.isPaused = paused
  }

  togglePause(): void {
    this.state.isPaused = !this.state.isPaused
  }
}
