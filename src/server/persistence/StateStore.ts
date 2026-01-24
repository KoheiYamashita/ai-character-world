import type { SerializedWorldState, SimCharacter } from '../simulation/types'
import type { WorldTime, DailySchedule, ConversationSummaryEntry, NPCDynamicState } from '@/types'
import type { ActionHistoryEntry, MidTermMemory } from '@/types/behavior'

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
   * Add an action history entry
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
   * Load action history for a character on a specific day
   */
  loadActionHistoryForDay(characterId: string, day: number): Promise<ActionHistoryEntry[]>

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
   * Load active mid-term memories for a character (not expired)
   */
  loadActiveMidTermMemories(characterId: string, currentDay: number): Promise<MidTermMemory[]>

  /**
   * Delete expired mid-term memories
   * Returns number of deleted records
   */
  deleteExpiredMidTermMemories(currentDay: number): Promise<number>

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
}

/**
 * Factory type for creating StateStore instances
 */
export type StateStoreFactory = () => StateStore | Promise<StateStore>
