/**
 * ScheduleManager - スケジュール・行動履歴管理を担当
 * SimulationEngine から分離された責務
 */

import type { ScheduleEntry, DailySchedule } from '@/types'
import type { ScheduleUpdate, ActionHistoryEntry } from '@/types/behavior'
import type { ActionId } from '@/types/action'
import type { WorldStateManager } from '../WorldState'
import type { StateStore } from '../../persistence/StateStore'
import { formatTime } from '@/lib/timeUtils'

export interface ScheduleManagerDependencies {
  worldState: WorldStateManager
  stateStore: StateStore | null
}

export class ScheduleManager {
  private defaultSchedules: Map<string, ScheduleEntry[]> = new Map()
  private scheduleCache: Map<string, ScheduleEntry[]> = new Map()
  private actionHistoryCache: Map<string, ActionHistoryEntry[]> = new Map()

  private deps: ScheduleManagerDependencies

  constructor(deps: ScheduleManagerDependencies) {
    this.deps = deps
  }

  /**
   * Set default schedules (from characters.json)
   */
  setDefaultSchedules(schedules: Map<string, ScheduleEntry[]>): void {
    this.defaultSchedules = schedules
  }

  /**
   * Get default schedules
   */
  getDefaultSchedules(): Map<string, ScheduleEntry[]> {
    return this.defaultSchedules
  }

  /**
   * Generate cache key for character-day based data
   */
  private characterDayCacheKey(characterId: string, day: number): string {
    return `${characterId}-${day}`
  }

  /**
   * Get schedule for a character (DB cache priority, fallback to default)
   */
  getScheduleForCharacter(characterId: string): ScheduleEntry[] | null {
    const currentDay = this.deps.worldState.getTime().day
    const cacheKey = this.characterDayCacheKey(characterId, currentDay)

    // Try DB cache first
    const cachedSchedule = this.scheduleCache.get(cacheKey)
    if (cachedSchedule) {
      return cachedSchedule
    }

    // Fallback to default schedules from characters.json
    return this.defaultSchedules.get(characterId) ?? null
  }

  /**
   * Apply schedule update proposed by LLM
   */
  applyScheduleUpdate(characterId: string, update: ScheduleUpdate): void {
    const currentDay = this.deps.worldState.getTime().day
    const cacheKey = this.characterDayCacheKey(characterId, currentDay)

    // Get current schedule entries
    let entries = this.scheduleCache.get(cacheKey) ?? this.defaultSchedules.get(characterId) ?? []
    entries = [...entries] // Clone to avoid mutating original

    const { type, entry } = update

    switch (type) {
      case 'add':
        // Add new entry and sort by time
        entries.push(entry)
        entries.sort((a, b) => a.time.localeCompare(b.time))
        console.log(`[ScheduleManager] Schedule add: ${entry.time} ${entry.activity}`)
        break

      case 'remove':
        // Remove entry matching time and activity
        const removeIndex = entries.findIndex(
          e => e.time === entry.time && e.activity === entry.activity
        )
        if (removeIndex >= 0) {
          entries.splice(removeIndex, 1)
          console.log(`[ScheduleManager] Schedule remove: ${entry.time} ${entry.activity}`)
        } else {
          console.log(`[ScheduleManager] Schedule remove: entry not found (${entry.time} ${entry.activity})`)
        }
        break

      case 'modify':
        // Find entry by time and replace it
        const modifyIndex = entries.findIndex(e => e.time === entry.time)
        if (modifyIndex >= 0) {
          entries[modifyIndex] = entry
          console.log(`[ScheduleManager] Schedule modify: ${entry.time} -> ${entry.activity}`)
        } else {
          // If not found, add as new entry
          entries.push(entry)
          entries.sort((a, b) => a.time.localeCompare(b.time))
          console.log(`[ScheduleManager] Schedule modify (not found, added): ${entry.time} ${entry.activity}`)
        }
        break
    }

    // Update cache
    this.scheduleCache.set(cacheKey, entries)

    // Persist to DB (async, non-blocking)
    if (this.deps.stateStore) {
      const schedule: DailySchedule = {
        characterId,
        day: currentDay,
        entries,
      }
      this.deps.stateStore.saveSchedule(schedule).catch(error => {
        console.error(`[ScheduleManager] Error saving schedule update:`, error)
      })
    }
  }

  /**
   * Load schedules from DB into cache for all characters on current day
   */
  async loadScheduleCache(): Promise<void> {
    if (!this.deps.stateStore) return

    const currentDay = this.deps.worldState.getTime().day
    const characters = this.deps.worldState.getAllCharacters()

    for (const char of characters) {
      try {
        const schedule = await this.deps.stateStore.loadSchedule(char.id, currentDay)
        if (schedule) {
          const cacheKey = this.characterDayCacheKey(char.id, currentDay)
          this.scheduleCache.set(cacheKey, schedule.entries)
          console.log(`[ScheduleManager] Loaded schedule for ${char.name} (day ${currentDay}) from DB`)
        }
      } catch (error) {
        console.error(`[ScheduleManager] Error loading schedule for ${char.id}:`, error)
      }
    }
  }

  /**
   * Clear schedule cache (called when day changes)
   */
  clearScheduleCache(): void {
    this.scheduleCache.clear()
  }

  /**
   * Record action history
   */
  recordActionHistory(entry: {
    characterId: string
    actionId: ActionId
    facilityId?: string
    targetNpcId?: string
    durationMinutes?: number
    reason?: string
  }): void {
    const currentTime = this.deps.worldState.getTime()
    const currentDay = currentTime.day
    const timeStr = formatTime(currentTime)

    // Determine target (facility or NPC)
    const target = entry.facilityId ?? entry.targetNpcId

    // Update cache
    const cacheKey = this.characterDayCacheKey(entry.characterId, currentDay)
    const cached = this.actionHistoryCache.get(cacheKey) ?? []
    cached.push({
      time: timeStr,
      actionId: entry.actionId,
      target,
      durationMinutes: entry.durationMinutes,
      reason: entry.reason,
    })
    this.actionHistoryCache.set(cacheKey, cached)

    // Persist to DB (async, non-blocking)
    if (this.deps.stateStore) {
      this.deps.stateStore.addActionHistory({
        characterId: entry.characterId,
        day: currentDay,
        time: timeStr,
        actionId: entry.actionId,
        target,
        durationMinutes: entry.durationMinutes,
        reason: entry.reason,
      }).catch(error => {
        console.error(`[ScheduleManager] Error saving action history:`, error)
      })
    }

    console.log(`[ScheduleManager] Recorded action history: ${entry.characterId} ${timeStr} ${entry.actionId}${target ? ` → ${target}` : ''}`)
  }

  /**
   * Get action history for a character (cache priority, fallback to empty)
   */
  getActionHistoryForCharacter(characterId: string): ActionHistoryEntry[] {
    const currentDay = this.deps.worldState.getTime().day
    const cacheKey = this.characterDayCacheKey(characterId, currentDay)
    return this.actionHistoryCache.get(cacheKey) ?? []
  }

  /**
   * Load action history from DB into cache for all characters on current day
   */
  async loadActionHistoryCache(): Promise<void> {
    if (!this.deps.stateStore) return

    const currentDay = this.deps.worldState.getTime().day
    const characters = this.deps.worldState.getAllCharacters()

    for (const char of characters) {
      try {
        const history = await this.deps.stateStore.loadActionHistoryForDay(char.id, currentDay)
        if (history.length > 0) {
          const cacheKey = this.characterDayCacheKey(char.id, currentDay)
          this.actionHistoryCache.set(cacheKey, history)
          console.log(`[ScheduleManager] Loaded ${history.length} action history entries for ${char.name} (day ${currentDay})`)
        }
      } catch (error) {
        console.error(`[ScheduleManager] Error loading action history for ${char.id}:`, error)
      }
    }
  }

  /**
   * Clear action history cache (called when day changes)
   */
  clearActionHistoryCache(): void {
    this.actionHistoryCache.clear()
  }
}
