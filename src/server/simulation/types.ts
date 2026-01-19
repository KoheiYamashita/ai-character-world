import type {
  Position,
  Direction,
  WorldTime,
  Character,
  CrossMapRoute,
  SpriteConfig,
  NPC,
  ActionState,
  Employment,
} from '@/types'

// Conversation state for character-NPC dialogue
export interface ConversationState {
  isActive: boolean
  npcId: string
  startTime: number
  duration: number // ms
}

// Server-side character state (extends client Character with navigation)
export interface SimCharacter {
  id: string
  name: string
  sprite: SpriteConfig
  money: number
  hunger: number
  energy: number
  hygiene: number
  mood: number
  bladder: number
  currentMapId: string
  currentNodeId: string
  position: Position
  direction: Direction
  // Employment info (workplace reference)
  employment?: Employment
  // Navigation state embedded for server-side simulation
  navigation: SimNavigationState
  // Cross-map navigation state
  crossMapNavigation: SimCrossMapNavState | null
  // Conversation state
  conversation: ConversationState | null
  // Current action being performed
  currentAction: ActionState | null
  // Emoji to display above character's head (set by action/conversation)
  displayEmoji?: string
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

// Server-side NPC state
export interface SimNPC {
  id: string
  name: string
  mapId: string
  currentNodeId: string
  position: Position
  direction: Direction
  isInConversation: boolean
}

// World state broadcast to clients
export interface WorldState {
  characters: Map<string, SimCharacter>
  npcs: Map<string, SimNPC>
  currentMapId: string
  time: WorldTime
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
  npcs: Record<string, SimNPC>
  currentMapId: string
  time: WorldTime
  isPaused: boolean
  transition: SimTransitionState
  tick: number
}

// Convert Map-based state to serializable object
export function serializeWorldState(state: WorldState): SerializedWorldState {
  return {
    characters: Object.fromEntries(state.characters),
    npcs: Object.fromEntries(state.npcs),
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
    npcs: new Map(Object.entries(state.npcs)),
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
    sprite: { ...char.sprite },
    money: char.money,
    hunger: char.hunger,
    energy: char.energy,
    hygiene: char.hygiene,
    mood: char.mood,
    bladder: char.bladder,
    currentMapId: char.currentMapId,
    currentNodeId: char.currentNodeId,
    position: { ...char.position },
    direction: char.direction,
    employment: char.employment ? { ...char.employment } : undefined,
    navigation: {
      isMoving: false,
      path: [],
      currentPathIndex: 0,
      progress: 0,
      startPosition: null,
      targetPosition: null,
    },
    crossMapNavigation: null,
    conversation: null,
    currentAction: null,
  }
}

// Create SimNPC from client NPC
export function createSimNPC(npc: NPC): SimNPC {
  return {
    id: npc.id,
    name: npc.name,
    mapId: npc.mapId,
    currentNodeId: npc.currentNodeId,
    position: { ...npc.position },
    direction: npc.direction,
    isInConversation: false,
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
  conversationProbability: number // 0-1 (probability of starting a conversation)
  conversationDuration: number // ms (how long conversation lasts)
}

export const DEFAULT_SIMULATION_CONFIG: SimulationConfig = {
  tickRate: 20,
  movementSpeed: 150,
  idleTimeMin: 500,
  idleTimeMax: 1500,
  entranceProbability: 0.1,
  crossMapProbability: 0.5,
  conversationProbability: 0.3,
  conversationDuration: 5000,
}

// SSE event types
export type SimulationEvent =
  | { type: 'state'; data: SerializedWorldState }
  | { type: 'character_update'; data: { characterId: string; character: SimCharacter } }
  | { type: 'transition_start'; data: { characterId: string; fromMapId: string; toMapId: string } }
  | { type: 'transition_end'; data: { characterId: string; mapId: string } }

export type SimulationEventType = SimulationEvent['type']
