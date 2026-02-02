import type { SerializedWorldState, SimCharacter } from '../simulation/types'
import type { WorldTime, DailySchedule, ConversationSummaryEntry, NPCDynamicState, CharacterStats } from '@/types'
import type { ActionHistoryEntry, MidTermMemory } from '@/types/behavior'
import type { ChatMessageRecord, ChatSummary, ChatProviderId } from '@/types/chat'

/**
 * Active action entry (for restoring in-progress actions on restart)
 */
export interface ActiveActionEntry {
  rowId: number
  characterId: string
  day: number
  time: string
  actionId: string
  target?: string
  durationMinutes?: number
  reason?: string
  startTimeReal: number        // 開始実時刻 (Date.now())
  lastUpdateTime: number       // 最終更新時刻
  statsSnapshot?: CharacterStats  // 更新時点のステータス
}

/**
 * Abstract interface for state persistence.
 * Implementations can be in-memory, SQLite, PostgreSQL, etc.
 */
export interface StateStore {
  /**
   * Save the complete world state
   */
  saveState(state: SerializedWorldState): Promise<void>

  /**
   * Load the complete world state
   * Returns null if no state exists
   */
  loadState(): Promise<SerializedWorldState | null>

  /**
   * Save a single character's state
   */
  saveCharacter(id: string, character: SimCharacter): Promise<void>

  /**
   * Load a single character's state
   * Returns null if character doesn't exist
   */
  loadCharacter(id: string): Promise<SimCharacter | null>

  /**
   * Load all characters
   */
  loadAllCharacters(): Promise<Record<string, SimCharacter>>

  /**
   * Delete a character
   */
  deleteCharacter(id: string): Promise<void>

  /**
   * Save world time
   */
  saveTime(time: WorldTime): Promise<void>

  /**
   * Load world time
   */
  loadTime(): Promise<WorldTime | null>

  /**
   * Save current map ID
   */
  saveCurrentMapId(mapId: string): Promise<void>

  /**
   * Load current map ID
   */
  loadCurrentMapId(): Promise<string | null>

  /**
   * Save a schedule for a character on a specific day
   */
  saveSchedule(schedule: DailySchedule): Promise<void>

  /**
   * Load a schedule for a character on a specific day
   */
  loadSchedule(characterId: string, day: number): Promise<DailySchedule | null>

  /**
   * Load all schedules for a character
   */
  loadSchedulesForCharacter(characterId: string): Promise<DailySchedule[]>

  /**
   * Delete a schedule for a character on a specific day
   */
  deleteSchedule(characterId: string, day: number): Promise<void>

  /**
   * Delete all schedules for a character
   */
  deleteAllSchedulesForCharacter(characterId: string): Promise<void>

  /**
   * Add an action history entry (legacy: completed action)
   */
  addActionHistory(entry: {
    characterId: string
    day: number
    time: string
    actionId: string
    target?: string
    durationMinutes?: number
    reason?: string
  }): Promise<void>

  /**
   * Start an action (INSERT with status='in_progress')
   * Returns the row ID for subsequent updates
   */
  startActionHistory(entry: {
    characterId: string
    day: number
    time: string
    actionId: string
    target?: string
    durationMinutes?: number
    reason?: string
    startTimeReal: number
  }): Promise<number>

  /**
   * Update active action progress (30秒ごとの中間更新)
   */
  updateActiveActionProgress(
    rowId: number,
    statsSnapshot: CharacterStats
  ): Promise<void>

  /**
   * Complete an action (UPDATE status='completed')
   */
  completeActionHistory(
    rowId: number,
    endTime: string,
    episode?: string
  ): Promise<void>

  /**
   * Load all in-progress actions (for restart recovery)
   */
  loadActiveActions(): Promise<ActiveActionEntry[]>

  /**
   * Load action history for a character on a specific day
   * @param limit Optional limit on number of results (default: no limit)
   */
  loadActionHistoryForDay(characterId: string, day: number, limit?: number): Promise<ActionHistoryEntry[]>

  /**
   * Update the episode field of the most recent action history entry
   */
  updateActionHistoryEpisode(characterId: string, day: number, time: string, episode: string): Promise<void>

  /**
   * Save an NPC conversation summary
   */
  saveNPCSummary(entry: ConversationSummaryEntry): Promise<void>

  /**
   * Load recent NPC conversation summaries
   */
  loadRecentNPCSummaries(characterId: string, npcId: string, limit?: number): Promise<ConversationSummaryEntry[]>

  /**
   * Load NPC conversation summaries for a specific day
   */
  loadNPCSummariesForDay(day: number): Promise<ConversationSummaryEntry[]>

  /**
   * Save NPC dynamic state
   */
  saveNPCState(npcId: string, state: NPCDynamicState): Promise<void>

  /**
   * Load NPC dynamic state
   */
  loadNPCState(npcId: string): Promise<NPCDynamicState | null>

  /**
   * Load all NPC dynamic states
   */
  loadAllNPCStates(): Promise<Map<string, NPCDynamicState>>

  /**
   * Add a mid-term memory
   */
  addMidTermMemory(memory: MidTermMemory): Promise<void>

  /**
   * Replace all mid-term memories for a character
   * (Used for memory consolidation after conversation)
   */
  replaceMidTermMemories(characterId: string, memories: MidTermMemory[]): Promise<void>

  /**
   * Load active mid-term memories for a character (not expired)
   */
  loadActiveMidTermMemories(characterId: string, currentDay: number): Promise<MidTermMemory[]>

  /**
   * Delete expired mid-term memories
   * Returns number of deleted records
   */
  deleteExpiredMidTermMemories(currentDay: number): Promise<number>

  // ==========================================================================
  // Debug log methods (DEBUG_MODE=true 時のみ使用)
  // ==========================================================================

  /**
   * Add a debug log entry
   */
  addDebugLog(entry: {
    type: 'llm_behavior' | 'conversation_turn'
    characterId: string
    day: number
    time: string
    data: Record<string, unknown>
  }): Promise<void>

  /**
   * Load debug logs for a specific day
   */
  loadDebugLogsForDay(day: number): Promise<Array<{
    id: number
    type: string
    characterId: string
    day: number
    time: string
    data: Record<string, unknown>
    createdAt: number
  }>>

  /**
   * Load debug logs for a character
   */
  loadDebugLogsForCharacter(characterId: string, day?: number): Promise<Array<{
    id: number
    type: string
    characterId: string
    day: number
    time: string
    data: Record<string, unknown>
    createdAt: number
  }>>

  /**
   * Delete old debug logs
   * @param keepDays Days to keep (delete older than this)
   * Returns number of deleted records
   */
  deleteOldDebugLogs(keepDays: number): Promise<number>

  /**
   * Check if store has been initialized with data
   */
  hasData(): Promise<boolean>

  /**
   * Clear all data
   */
  clear(): Promise<void>

  /**
   * Close the connection (for cleanup)
   */
  close(): Promise<void>

  // ==========================================================================
  // Chat message methods
  // ==========================================================================

  /**
   * Save a chat message
   */
  saveChatMessage(message: ChatMessageRecord): Promise<void>

  /**
   * Load recent chat messages for a channel
   * @param limit Number of messages to load (default: 10)
   */
  loadRecentChatMessages(
    providerId: ChatProviderId,
    channelId: string,
    limit?: number
  ): Promise<ChatMessageRecord[]>

  /**
   * Delete old chat messages
   * @param retentionDays Days to keep (delete older than this)
   * Returns number of deleted records
   */
  deleteOldChatMessages(retentionDays: number): Promise<number>

  // ==========================================================================
  // Chat summary methods
  // ==========================================================================

  /**
   * Save or update a chat summary
   */
  saveChatSummary(summary: ChatSummary): Promise<void>

  /**
   * Load a chat summary for a character and channel
   */
  loadChatSummary(
    characterId: string,
    providerId: ChatProviderId,
    channelId: string
  ): Promise<ChatSummary | null>

  /**
   * Load all chat summaries for a character
   */
  loadChatSummariesForCharacter(characterId: string): Promise<ChatSummary[]>
}

/**
 * Factory type for creating StateStore instances
 */
export type StateStoreFactory = () => StateStore | Promise<StateStore>
