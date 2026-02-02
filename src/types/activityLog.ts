export interface ActionLogEntry {
  type: 'action'
  characterId: string
  characterName: string
  time: string              // "HH:MM"
  actionId: string
  target?: string
  durationMinutes?: number
  reason?: string
  /**
   * Action status: 'started' or 'completed'.
   * When undefined, treated as 'completed' (backward compatibility).
   */
  status?: 'started' | 'completed'
}

export interface ConversationLogEntry {
  type: 'conversation'
  characterId: string
  characterName: string
  time: string
  npcId: string
  npcName: string
  summary: string
  topics: string[]
  goalAchieved: boolean
  affinityChange?: number
  npcMood?: string
}

export interface ConversationMessageLogEntry {
  type: 'conversation_message'
  characterId: string
  characterName: string
  npcId: string
  npcName: string
  speaker: 'character' | 'npc'
  speakerName: string
  utterance: string
  time: string
}

export interface MiniEpisodeLogEntry {
  type: 'mini_episode'
  characterId: string
  characterName: string
  time: string
  actionId: string
  episode: string
  statChanges: Record<string, number>
}

/**
 * 外部チャットメッセージログエントリ
 * Discord/Slack/LINE等の外部チャットメッセージを記録
 */
export interface ChatMessageLogEntry {
  type: 'chat_message'
  characterId: string
  characterName: string
  providerId: string          // discord, slack, line
  channelId: string
  channelName: string
  senderName: string          // 外部ユーザー名 or キャラクター名
  content: string
  isFromCharacter: boolean    // キャラクターからの送信か
  time: string
}

// =============================================================================
// デバッグログエントリ型（DEBUG_MODE=true 時のみ使用）
// =============================================================================

/**
 * LLM行動決定デバッグログ
 * LLMBehaviorDecider の行動決定プロンプト・応答を記録
 */
export interface DebugLLMBehaviorLogEntry {
  type: 'debug_llm_behavior'
  characterId: string
  characterName: string
  time: string
  day: number
  stage: 'action_decision' | 'facility_selection' | 'interrupt_facility'
  prompt: string
  response: string
  /** 最終的な行動決定（JSON形式） */
  decision?: string
}

/**
 * 会話ターンデバッグログ
 * ConversationExecutor の各発話生成プロンプト・応答を記録
 */
export interface DebugConversationTurnLogEntry {
  type: 'debug_conversation_turn'
  characterId: string
  characterName: string
  npcId: string
  npcName: string
  time: string
  day: number
  turn: number
  speaker: 'character' | 'npc'
  prompt: string
  response: string
}

export type DebugLogEntry = DebugLLMBehaviorLogEntry | DebugConversationTurnLogEntry

export type ActivityLogEntry = ActionLogEntry | ConversationLogEntry | ConversationMessageLogEntry | MiniEpisodeLogEntry | ChatMessageLogEntry | DebugLogEntry
