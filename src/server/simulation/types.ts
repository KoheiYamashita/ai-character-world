import type {
  Position,
  Direction,
  GameTime,
  Character,
  CrossMapRoute,
} from '@/types'

// Server-side character state (extends client Character with navigation)
export interface SimCharacter {
  id: string
  name: string
  money: number
  hunger: number
  currentMapId: string
  currentNodeId: string
  position: Position
  direction: Direction
  // Navigation state embedded for server-side simulation
  navigation: SimNavigationState
  // Cross-map navigation state
  crossMapNavigation: SimCrossMapNavState | null
}

export interface SimNavigationState {
  isMoving: boolean
  path: string[]
  currentPathIndex: number
  progress: number
  startPosition: Position | null
  targetPosition: Position | null
}

export interface SimCrossMapNavState {
  isActive: boolean
  targetMapId: string
  targetNodeId: string
  route: CrossMapRoute
  currentSegmentIndex: number
}

// World state broadcast to clients
export interface WorldState {
  characters: Map<string, SimCharacter>
  currentMapId: string
  time: GameTime
  isPaused: boolean
  transition: SimTransitionState
  tick: number // For client reconciliation
}

export interface SimTransitionState {
  isTransitioning: boolean
  characterId: string | null
  fromMapId: string | null
  toMapId: string | null
  progress: number
}

// Serializable world state for SSE/API
export interface SerializedWorldState {
  characters: Record<string, SimCharacter>
  currentMapId: string
  time: GameTime
  isPaused: boolean
  transition: SimTransitionState
  tick: number
}

// Convert Map-based state to serializable object
export function serializeWorldState(state: WorldState): SerializedWorldState {
  return {
    characters: Object.fromEntries(state.characters),
    currentMapId: state.currentMapId,
    time: { ...state.time },
    isPaused: state.isPaused,
    transition: { ...state.transition },
    tick: state.tick,
  }
}

// Convert serialized state back to Map-based state
export function deserializeWorldState(state: SerializedWorldState): WorldState {
  return {
    characters: new Map(Object.entries(state.characters)),
    currentMapId: state.currentMapId,
    time: { ...state.time },
    isPaused: state.isPaused,
    transition: { ...state.transition },
    tick: state.tick,
  }
}

// Create SimCharacter from client Character
export function createSimCharacter(char: Character): SimCharacter {
  return {
    id: char.id,
    name: char.name,
    money: char.money,
    hunger: char.hunger,
    currentMapId: char.currentMapId,
    currentNodeId: char.currentNodeId,
    position: { ...char.position },
    direction: char.direction,
    navigation: {
      isMoving: false,
      path: [],
      currentPathIndex: 0,
      progress: 0,
      startPosition: null,
      targetPosition: null,
    },
    crossMapNavigation: null,
  }
}

// Config for simulation engine
export interface SimulationConfig {
  tickRate: number // Ticks per second (e.g., 20)
  movementSpeed: number // Pixels per second
  idleTimeMin: number // ms
  idleTimeMax: number // ms
  entranceProbability: number // 0-1
  crossMapProbability: number // 0-1
}

export const DEFAULT_SIMULATION_CONFIG: SimulationConfig = {
  tickRate: 20,
  movementSpeed: 150,
  idleTimeMin: 500,
  idleTimeMax: 1500,
  entranceProbability: 0.1,
  crossMapProbability: 0.5,
}

// SSE event types
export type SimulationEvent =
  | { type: 'state'; data: SerializedWorldState }
  | { type: 'character_update'; data: { characterId: string; character: SimCharacter } }
  | { type: 'transition_start'; data: { characterId: string; fromMapId: string; toMapId: string } }
  | { type: 'transition_end'; data: { characterId: string; mapId: string } }

export type SimulationEventType = SimulationEvent['type']
