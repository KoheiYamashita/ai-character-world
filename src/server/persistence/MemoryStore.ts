import type { StateStore, ActiveActionEntry } from './StateStore'
import type { SerializedWorldState, SimCharacter } from '../simulation/types'
import type { WorldTime, DailySchedule, ConversationSummaryEntry, NPCDynamicState, CharacterStats } from '@/types'
import type { ActionHistoryEntry, MidTermMemory } from '@/types/behavior'
import type { ChatMessageRecord, ChatSummary, ChatProviderId } from '@/types/chat'

/**
 * In-memory implementation of StateStore.
 * Data is not persisted across server restarts.
 * Useful for development and testing.
 */
interface InMemoryActiveAction extends ActiveActionEntry {
  status: 'in_progress' | 'completed'
}

interface DebugLogEntry {
  id: number
  type: string
  characterId: string
  day: number
  time: string
  data: Record<string, unknown>
  createdAt: number
}

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
  private activeActions: Map<number, InMemoryActiveAction> = new Map() // key: rowId
  private nextRowId: number = 1
  private debugLogs: DebugLogEntry[] = []
  private nextDebugLogId: number = 1
  private chatMessages: ChatMessageRecord[] = []
  private chatSummaries: Map<string, ChatSummary> = new Map() // key: `${characterId}:${providerId}:${channelId}`

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

  async loadActionHistoryForDay(characterId: string, day: number, limit?: number): Promise<ActionHistoryEntry[]> {
    const key = this.characterDayKey(characterId, day)
    const history = this.actionHistory.get(key)
    if (!history) return []
    // If limit specified, return only the most recent N entries
    const result = limit ? history.slice(-limit) : history
    return JSON.parse(JSON.stringify(result))
  }

  async updateActionHistoryEpisode(characterId: string, day: number, time: string, episode: string): Promise<void> {
    const key = this.characterDayKey(characterId, day)
    const history = this.actionHistory.get(key)
    if (!history) return
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].time === time) {
        history[i].episode = episode
        break
      }
    }
  }

  // New action persistence methods (for in-progress action tracking)

  async startActionHistory(entry: {
    characterId: string
    day: number
    time: string
    actionId: string
    target?: string
    durationMinutes?: number
    reason?: string
    startTimeReal: number
  }): Promise<number> {
    const rowId = this.nextRowId++
    const activeAction: InMemoryActiveAction = {
      rowId,
      characterId: entry.characterId,
      day: entry.day,
      time: entry.time,
      actionId: entry.actionId,
      target: entry.target,
      durationMinutes: entry.durationMinutes,
      reason: entry.reason,
      startTimeReal: entry.startTimeReal,
      lastUpdateTime: Date.now(),
      status: 'in_progress',
    }
    this.activeActions.set(rowId, activeAction)
    return rowId
  }

  async updateActiveActionProgress(
    rowId: number,
    statsSnapshot: CharacterStats
  ): Promise<void> {
    const action = this.activeActions.get(rowId)
    if (!action || action.status !== 'in_progress') return
    action.statsSnapshot = statsSnapshot
    action.lastUpdateTime = Date.now()
  }

  async completeActionHistory(
    rowId: number,
    endTime: string,
    episode?: string
  ): Promise<void> {
    const action = this.activeActions.get(rowId)
    if (!action) return

    action.status = 'completed'

    // Add to actionHistory cache
    const key = this.characterDayKey(action.characterId, action.day)
    const existing = this.actionHistory.get(key) ?? []
    existing.push({
      time: endTime,
      actionId: action.actionId,
      target: action.target,
      durationMinutes: action.durationMinutes,
      reason: action.reason,
      episode,
    })
    this.actionHistory.set(key, existing)
  }

  async loadActiveActions(): Promise<ActiveActionEntry[]> {
    return Array.from(this.activeActions.values())
      .filter(action => action.status === 'in_progress')
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
    // Deep copy facts (now NPCFact[] objects)
    this.npcStates.set(npcId, { ...state, facts: state.facts.map(f => ({ ...f })) })
  }

  async loadNPCState(npcId: string): Promise<NPCDynamicState | null> {
    const state = this.npcStates.get(npcId)
    if (!state) return null
    return { ...state, facts: state.facts.map(f => ({ ...f })) }
  }

  async loadAllNPCStates(): Promise<Map<string, NPCDynamicState>> {
    const result = new Map<string, NPCDynamicState>()
    for (const [id, state] of this.npcStates) {
      result.set(id, { ...state, facts: state.facts.map(f => ({ ...f })) })
    }
    return result
  }

  // Mid-term memory methods

  async addMidTermMemory(memory: MidTermMemory): Promise<void> {
    this.midTermMemories.push({ ...memory })
  }

  async replaceMidTermMemories(characterId: string, memories: MidTermMemory[]): Promise<void> {
    // Remove all existing memories for this character
    this.midTermMemories = this.midTermMemories.filter(m => m.characterId !== characterId)
    // Add new consolidated memories
    this.midTermMemories.push(...memories.map(m => ({ ...m })))
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
    this.activeActions.clear()
    this.nextRowId = 1
    this.debugLogs = []
    this.nextDebugLogId = 1
    this.chatMessages = []
    this.chatSummaries.clear()
  }

  // Debug log methods

  async addDebugLog(entry: {
    type: 'llm_behavior' | 'conversation_turn'
    characterId: string
    day: number
    time: string
    data: Record<string, unknown>
  }): Promise<void> {
    this.debugLogs.push({
      id: this.nextDebugLogId++,
      type: entry.type,
      characterId: entry.characterId,
      day: entry.day,
      time: entry.time,
      data: { ...entry.data },
      createdAt: Date.now(),
    })
  }

  async loadDebugLogsForDay(day: number): Promise<Array<{
    id: number
    type: string
    characterId: string
    day: number
    time: string
    data: Record<string, unknown>
    createdAt: number
  }>> {
    return this.debugLogs
      .filter(d => d.day === day)
      .sort((a, b) => a.time.localeCompare(b.time) || a.createdAt - b.createdAt)
  }

  async loadDebugLogsForCharacter(characterId: string, day?: number): Promise<Array<{
    id: number
    type: string
    characterId: string
    day: number
    time: string
    data: Record<string, unknown>
    createdAt: number
  }>> {
    let logs = this.debugLogs.filter(d => d.characterId === characterId)
    if (day !== undefined) {
      logs = logs.filter(d => d.day === day)
    }
    return logs
      .sort((a, b) => {
        if (day !== undefined) {
          return a.time.localeCompare(b.time) || a.createdAt - b.createdAt
        }
        return b.day - a.day || b.time.localeCompare(a.time) || b.createdAt - a.createdAt
      })
      .slice(0, day !== undefined ? logs.length : 100)
  }

  async deleteOldDebugLogs(keepDays: number): Promise<number> {
    const before = this.debugLogs.length
    this.debugLogs = this.debugLogs.filter(d => d.day >= keepDays)
    return before - this.debugLogs.length
  }

  // ==========================================================================
  // Chat message methods
  // ==========================================================================

  async saveChatMessage(message: ChatMessageRecord): Promise<void> {
    // Check for duplicate by provider+messageId
    const exists = this.chatMessages.some(
      m => m.providerId === message.providerId && m.messageId === message.messageId
    )
    if (!exists) {
      this.chatMessages.push({ ...message })
    }
  }

  async loadRecentChatMessages(
    providerId: ChatProviderId,
    channelId: string,
    limit: number = 10
  ): Promise<ChatMessageRecord[]> {
    return this.chatMessages
      .filter(m => m.providerId === providerId && m.channelId === channelId)
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit)
      .reverse() // Return in chronological order
  }

  async deleteOldChatMessages(retentionDays: number): Promise<number> {
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000
    const before = this.chatMessages.length
    this.chatMessages = this.chatMessages.filter(m => m.createdAt >= cutoff)
    return before - this.chatMessages.length
  }

  // ==========================================================================
  // Chat summary methods
  // ==========================================================================

  private chatSummaryKey(characterId: string, providerId: ChatProviderId, channelId: string): string {
    return `${characterId}:${providerId}:${channelId}`
  }

  async saveChatSummary(summary: ChatSummary): Promise<void> {
    const key = this.chatSummaryKey(summary.characterId, summary.providerId, summary.channelId)
    this.chatSummaries.set(key, { ...summary })
  }

  async loadChatSummary(
    characterId: string,
    providerId: ChatProviderId,
    channelId: string
  ): Promise<ChatSummary | null> {
    const key = this.chatSummaryKey(characterId, providerId, channelId)
    const summary = this.chatSummaries.get(key)
    return summary ? { ...summary } : null
  }

  async loadChatSummariesForCharacter(characterId: string): Promise<ChatSummary[]> {
    return Array.from(this.chatSummaries.values())
      .filter(s => s.characterId === characterId)
      .sort((a, b) => b.lastInteractionAt - a.lastInteractionAt)
  }

  async close(): Promise<void> {
    // Nothing to close for in-memory store
  }
}
