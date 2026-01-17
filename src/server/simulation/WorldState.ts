import type { GameMap, GameTime, Position, Direction, CrossMapRoute } from '@/types'
import type {
  WorldState,
  SimCharacter,
  SimTransitionState,
  SimNavigationState,
  SimCrossMapNavState,
  SerializedWorldState,
} from './types'
import { serializeWorldState } from './types'

const INITIAL_TIME: GameTime = { hour: 8, minute: 0, day: 1 }
const INITIAL_MAP_ID = 'home'

export class WorldStateManager {
  private state: WorldState
  private maps: Record<string, GameMap> = {}

  constructor() {
    this.state = {
      characters: new Map(),
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
  initialize(maps: Record<string, GameMap>, initialMapId?: string): void {
    this.maps = maps
    if (initialMapId) {
      this.state.currentMapId = initialMapId
    }
  }

  getMaps(): Record<string, GameMap> {
    return this.maps
  }

  getMap(mapId: string): GameMap | undefined {
    return this.maps[mapId]
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
  getTime(): GameTime {
    return this.state.time
  }

  setTime(time: GameTime): void {
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
