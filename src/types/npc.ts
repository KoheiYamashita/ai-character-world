import type { Position, Direction, SpriteConfig } from './character'

// Maps.json NPC config
export interface NPCConfigJson {
  id: string
  name: string
  sprite: SpriteConfig
  spawnNodeId: string  // Node where NPC is placed (blocks pathfinding)
  personality: string           // 性格描写
  tendencies: string[]          // 行動傾向
  customPrompt?: string         // 自由形式のプロンプト
  facts: string[]               // NPCが一貫して保つ事実
}

// Runtime NPC
export interface NPC {
  id: string
  name: string
  sprite: SpriteConfig
  mapId: string
  currentNodeId: string  // Node occupied by NPC (blocks pathfinding)
  position: Position
  direction: Direction
  isInConversation?: boolean  // Whether NPC is currently in conversation
  // プロフィール
  personality: string
  tendencies: string[]
  customPrompt?: string
  facts: string[]
  // 動的ステータス
  affinity: number              // 好感度（初期値0）
  mood: string                  // 気分（初期値"neutral"）
  conversationCount: number     // 累計会話回数（初期値0）
  lastConversation: number | null  // 最終会話時刻（ワールド時間timestamp、初期値null）
}
