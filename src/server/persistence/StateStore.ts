import type { SerializedWorldState, SimCharacter } from '../simulation/types'
import type { WorldTime } from '@/types'

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
   * Save game time
   */
  saveTime(time: WorldTime): Promise<void>

  /**
   * Load game time
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
