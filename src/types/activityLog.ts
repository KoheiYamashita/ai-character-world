export interface ActionLogEntry {
  type: 'action'
  characterId: string
  characterName: string
  time: string              // "HH:MM"
  actionId: string
  target?: string
  durationMinutes?: number
  reason?: string
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

export type ActivityLogEntry = ActionLogEntry | ConversationLogEntry | ConversationMessageLogEntry
