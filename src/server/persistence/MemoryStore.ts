import type { StateStore } from './StateStore'
import type { SerializedWorldState, SimCharacter } from '../simulation/types'
import type { GameTime } from '@/types'

/**
 * In-memory implementation of StateStore.
 * Data is not persisted across server restarts.
 * Useful for development and testing.
 */
export class MemoryStore implements StateStore {
  private state: SerializedWorldState | null = null
  private characters: Map<string, SimCharacter> = new Map()
  private time: GameTime | null = null
  private currentMapId: string | null = null

  async saveState(state: SerializedWorldState): Promise<void> {
    // Deep clone to avoid reference issues
    this.state = JSON.parse(JSON.stringify(state))

    // Also update individual fields for partial loads
    this.characters.clear()
    for (const [id, char] of Object.entries(state.characters)) {
      this.characters.set(id, JSON.parse(JSON.stringify(char)))
    }
    this.time = { ...state.time }
    this.currentMapId = state.currentMapId
  }

  async loadState(): Promise<SerializedWorldState | null> {
    if (!this.state) return null
    // Return a deep clone to avoid external mutations
    return JSON.parse(JSON.stringify(this.state))
  }

  async saveCharacter(id: string, character: SimCharacter): Promise<void> {
    this.characters.set(id, JSON.parse(JSON.stringify(character)))

    // Update the full state if it exists
    if (this.state) {
      this.state.characters[id] = JSON.parse(JSON.stringify(character))
    }
  }

  async loadCharacter(id: string): Promise<SimCharacter | null> {
    const char = this.characters.get(id)
    if (!char) return null
    return JSON.parse(JSON.stringify(char))
  }

  async loadAllCharacters(): Promise<Record<string, SimCharacter>> {
    const result: Record<string, SimCharacter> = {}
    for (const [id, char] of this.characters) {
      result[id] = JSON.parse(JSON.stringify(char))
    }
    return result
  }

  async deleteCharacter(id: string): Promise<void> {
    this.characters.delete(id)
    if (this.state) {
      delete this.state.characters[id]
    }
  }

  async saveTime(time: GameTime): Promise<void> {
    this.time = { ...time }
    if (this.state) {
      this.state.time = { ...time }
    }
  }

  async loadTime(): Promise<GameTime | null> {
    if (!this.time) return null
    return { ...this.time }
  }

  async saveCurrentMapId(mapId: string): Promise<void> {
    this.currentMapId = mapId
    if (this.state) {
      this.state.currentMapId = mapId
    }
  }

  async loadCurrentMapId(): Promise<string | null> {
    return this.currentMapId
  }

  async hasData(): Promise<boolean> {
    return this.state !== null || this.characters.size > 0
  }

  async clear(): Promise<void> {
    this.state = null
    this.characters.clear()
    this.time = null
    this.currentMapId = null
  }

  async close(): Promise<void> {
    // Nothing to close for in-memory store
  }
}
