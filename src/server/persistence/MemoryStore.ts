import type { StateStore } from './StateStore'
import type { SerializedWorldState, SimCharacter } from '../simulation/types'
import type { WorldTime, DailySchedule, ConversationSummaryEntry, NPCDynamicState } from '@/types'
import type { ActionHistoryEntry, MidTermMemory } from '@/types/behavior'

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
  private actionHistory: Map<string, ActionHistoryEntry[]> = new Map() // key: `${characterId}:${day}`
  private npcSummaries: ConversationSummaryEntry[] = []
  private npcStates: Map<string, NPCDynamicState> = new Map()
  private midTermMemories: MidTermMemory[] = []

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

  // Common key generator for character-day based data
  private characterDayKey(characterId: string, day: number): string {
    return `${characterId}:${day}`
  }

  // Schedule CRUD methods

  async saveSchedule(schedule: DailySchedule): Promise<void> {
    const key = this.characterDayKey(schedule.characterId, schedule.day)
    this.schedules.set(key, JSON.parse(JSON.stringify(schedule)))
  }

  async loadSchedule(characterId: string, day: number): Promise<DailySchedule | null> {
    const key = this.characterDayKey(characterId, day)
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
    const key = this.characterDayKey(characterId, day)
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

  // Action history methods

  async addActionHistory(entry: {
    characterId: string
    day: number
    time: string
    actionId: string
    target?: string
    durationMinutes?: number
    reason?: string
  }): Promise<void> {
    const key = this.characterDayKey(entry.characterId, entry.day)
    const existing = this.actionHistory.get(key) ?? []
    existing.push({
      time: entry.time,
      actionId: entry.actionId,
      target: entry.target,
      durationMinutes: entry.durationMinutes,
      reason: entry.reason,
    })
    this.actionHistory.set(key, existing)
  }

  async loadActionHistoryForDay(characterId: string, day: number): Promise<ActionHistoryEntry[]> {
    const key = this.characterDayKey(characterId, day)
    const history = this.actionHistory.get(key)
    if (!history) return []
    return JSON.parse(JSON.stringify(history))
  }

  // NPC Summary methods

  async saveNPCSummary(entry: ConversationSummaryEntry): Promise<void> {
    this.npcSummaries.push({ ...entry })
  }

  async loadRecentNPCSummaries(characterId: string, npcId: string, limit: number = 5): Promise<ConversationSummaryEntry[]> {
    return this.npcSummaries
      .filter(e => e.characterId === characterId && e.npcId === npcId)
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit)
  }

  async loadNPCSummariesForDay(day: number): Promise<ConversationSummaryEntry[]> {
    return this.npcSummaries
      .filter(e => e.day === day)
      .sort((a, b) => {
        if (a.time && b.time) return a.time.localeCompare(b.time)
        return a.timestamp - b.timestamp
      })
  }

  // NPC State methods

  async saveNPCState(npcId: string, state: NPCDynamicState): Promise<void> {
    this.npcStates.set(npcId, { ...state, facts: [...state.facts] })
  }

  async loadNPCState(npcId: string): Promise<NPCDynamicState | null> {
    const state = this.npcStates.get(npcId)
    if (!state) return null
    return { ...state, facts: [...state.facts] }
  }

  async loadAllNPCStates(): Promise<Map<string, NPCDynamicState>> {
    const result = new Map<string, NPCDynamicState>()
    for (const [id, state] of this.npcStates) {
      result.set(id, { ...state, facts: [...state.facts] })
    }
    return result
  }

  // Mid-term memory methods

  async addMidTermMemory(memory: MidTermMemory): Promise<void> {
    this.midTermMemories.push({ ...memory })
  }

  async loadActiveMidTermMemories(characterId: string, currentDay: number): Promise<MidTermMemory[]> {
    return this.midTermMemories
      .filter(m => m.characterId === characterId && m.expiresDay >= currentDay)
      .sort((a, b) => b.createdDay - a.createdDay)
  }

  async deleteExpiredMidTermMemories(currentDay: number): Promise<number> {
    const before = this.midTermMemories.length
    this.midTermMemories = this.midTermMemories.filter(m => m.expiresDay >= currentDay)
    return before - this.midTermMemories.length
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
    this.actionHistory.clear()
    this.npcSummaries = []
    this.npcStates.clear()
    this.midTermMemories = []
  }

  async close(): Promise<void> {
    // Nothing to close for in-memory store
  }
}
