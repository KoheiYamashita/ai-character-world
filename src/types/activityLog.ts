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

export type ActivityLogEntry = ActionLogEntry | ConversationLogEntry | ConversationMessageLogEntry | MiniEpisodeLogEntry
