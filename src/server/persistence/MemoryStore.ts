import type { StateStore } from './StateStore'
import type { SerializedWorldState, SimCharacter } from '../simulation/types'
import type { WorldTime, DailySchedule } from '@/types'

/**
 * In-memory implementation of StateStore.
 * Data is not persisted across server restarts.
 * Useful for development and testing.
 */
export class MemoryStore implements StateStore {
  private state: SerializedWorldState | null = null
  private characters: Map<string, SimCharacter> = new Map()
  private time: WorldTime | null = null
  private currentMapId: string | null = null
  private schedules: Map<string, DailySchedule> = new Map() // key: `${characterId}:${day}`

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

  async saveTime(time: WorldTime): Promise<void> {
    this.time = { ...time }
    if (this.state) {
      this.state.time = { ...time }
    }
  }

  async loadTime(): Promise<WorldTime | null> {
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

  // Schedule CRUD methods

  private scheduleKey(characterId: string, day: number): string {
    return `${characterId}:${day}`
  }

  async saveSchedule(schedule: DailySchedule): Promise<void> {
    const key = this.scheduleKey(schedule.characterId, schedule.day)
    this.schedules.set(key, JSON.parse(JSON.stringify(schedule)))
  }

  async loadSchedule(characterId: string, day: number): Promise<DailySchedule | null> {
    const key = this.scheduleKey(characterId, day)
    const schedule = this.schedules.get(key)
    if (!schedule) return null
    return JSON.parse(JSON.stringify(schedule))
  }

  async loadSchedulesForCharacter(characterId: string): Promise<DailySchedule[]> {
    const result: DailySchedule[] = []
    for (const [key, schedule] of this.schedules) {
      if (key.startsWith(`${characterId}:`)) {
        result.push(JSON.parse(JSON.stringify(schedule)))
      }
    }
    return result.sort((a, b) => a.day - b.day)
  }

  async deleteSchedule(characterId: string, day: number): Promise<void> {
    const key = this.scheduleKey(characterId, day)
    this.schedules.delete(key)
  }

  async deleteAllSchedulesForCharacter(characterId: string): Promise<void> {
    const prefix = `${characterId}:`
    for (const key of this.schedules.keys()) {
      if (key.startsWith(prefix)) {
        this.schedules.delete(key)
      }
    }
  }

  async hasData(): Promise<boolean> {
    return this.state !== null || this.characters.size > 0
  }

  async clear(): Promise<void> {
    this.state = null
    this.characters.clear()
    this.time = null
    this.currentMapId = null
    this.schedules.clear()
  }

  async close(): Promise<void> {
    // Nothing to close for in-memory store
  }
}
