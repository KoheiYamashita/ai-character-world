export interface ConversationGoal {
  goal: string              // "最近の様子を聞きたい"
  successCriteria: string   // "近況を1つ以上聞けたら達成"
  openingLine?: string      // "ねえ、最近どう？" (キャラクターの最初の一言)
}

export interface ConversationMessage {
  speaker: 'character' | 'npc'
  speakerId: string
  speakerName: string
  utterance: string
  timestamp: number         // ワールド内時間
}

export interface ConversationSession {
  id: string
  characterId: string
  npcId: string
  goal: ConversationGoal
  messages: ConversationMessage[]
  currentTurn: number       // 0始まり
  maxTurns: number          // 10
  startTime: number
  status: 'active' | 'completed' | 'aborted'
  goalAchieved: boolean
}

export interface ConversationSummaryEntry {
  characterId: string
  npcId: string
  npcName: string
  goal?: string
  summary: string
  topics: string[]
  goalAchieved: boolean
  timestamp: number
  day?: number
  time?: string
  affinityChange?: number
  mood?: string
}

import type { NPCFact } from './npc'
import type { Direction } from './character'

export interface NPCDynamicState {
  affinity: number
  mood: string
  facts: NPCFact[]
  conversationCount: number
  lastConversation: number | null
  // 位置情報（optional、undefinedは初期位置を使用）
  mapId?: string
  currentNodeId?: string
  positionX?: number
  positionY?: number
  direction?: Direction
}
