import type { Position, Direction, SpriteConfig } from './character'

// Maps.json NPC config (simplified - static only)
export interface NPCConfigJson {
  id: string
  name: string
  sprite: SpriteConfig
  spawnNodeId: string  // Node where NPC is placed (blocks pathfinding)
}

// Runtime NPC (simplified - static only)
export interface NPC {
  id: string
  name: string
  sprite: SpriteConfig
  mapId: string
  currentNodeId: string  // Node occupied by NPC (blocks pathfinding)
  position: Position
  direction: Direction
  isInConversation?: boolean  // Whether NPC is currently in conversation
}
