/**
 * TimeManager - 時刻管理とステータス減衰を担当
 * SimulationEngine から分離された責務
 */

import type { WorldTime, TimeConfig } from '@/types'
import type { WorldStateManager } from '../WorldState'
import type { ActionExecutor } from '../actions/ActionExecutor'
import type { SimCharacter } from '../types'
import { calculateStatChange } from '@/lib/statusUtils'

const DEFAULT_TIMEZONE = 'Asia/Tokyo'

// Status interrupt threshold (10%)
const INTERRUPT_THRESHOLD = 10

// Status type → forced action mapping
const STATUS_INTERRUPT_ACTIONS: Record<string, string> = {
  bladder: 'toilet',
  satiety: 'eat',
  energy: 'sleep',
  hygiene: 'bathe',
}

export interface TimeManagerDependencies {
  worldState: WorldStateManager
  actionExecutor: ActionExecutor
  onStatusInterrupt: (characterId: string, statusType: string) => void
}

export class TimeManager {
  private timeConfig: TimeConfig | null = null
  private serverStartTime: number = Date.now()
  private cachedFormatter: Intl.DateTimeFormat | null = null
  private cachedTimezone: string | null = null
  private lastDecayTime: number = 0
  private lastDay: number = 1

  private deps: TimeManagerDependencies

  constructor(deps: TimeManagerDependencies) {
    this.deps = deps
  }

  setTimeConfig(config: TimeConfig): void {
    this.timeConfig = config
    this.updateFormatterCache()
  }

  getTimeConfig(): TimeConfig | null {
    return this.timeConfig
  }

  setServerStartTime(time: number): void {
    this.serverStartTime = time
  }

  getServerStartTime(): number {
    return this.serverStartTime
  }

  getLastDecayTime(): number {
    return this.lastDecayTime
  }

  setLastDecayTime(time: number): void {
    this.lastDecayTime = time
  }

  getLastDay(): number {
    return this.lastDay
  }

  setLastDay(day: number): void {
    this.lastDay = day
  }

  initializeLastDay(): void {
    const currentTime = this.deps.worldState.getTime()
    this.lastDay = currentTime.day
  }

  /**
   * Update formatter cache when timezone changes
   */
  private updateFormatterCache(): void {
    const timezone = this.timeConfig?.timezone ?? DEFAULT_TIMEZONE

    if (this.cachedTimezone === timezone && this.cachedFormatter) {
      return
    }

    try {
      this.cachedFormatter = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        hour: 'numeric',
        minute: 'numeric',
        hour12: false,
      })
      this.cachedTimezone = timezone
    } catch {
      console.warn(`[TimeManager] Invalid timezone "${timezone}", falling back to ${DEFAULT_TIMEZONE}`)
      this.cachedFormatter = new Intl.DateTimeFormat('en-US', {
        timeZone: DEFAULT_TIMEZONE,
        hour: 'numeric',
        minute: 'numeric',
        hour12: false,
      })
      this.cachedTimezone = DEFAULT_TIMEZONE
    }
  }

  /**
   * Get current real time based on server timezone
   */
  getCurrentRealTime(): WorldTime {
    const now = new Date()

    if (!this.cachedFormatter) {
      this.updateFormatterCache()
    }

    const parts = this.cachedFormatter!.formatToParts(now)
    const hour = Number(parts.find(p => p.type === 'hour')?.value ?? 0)
    const minute = Number(parts.find(p => p.type === 'minute')?.value ?? 0)

    const msPerDay = 24 * 60 * 60 * 1000
    const day = Math.floor((now.getTime() - this.serverStartTime) / msPerDay) + 1

    return { hour, minute, day }
  }

  /**
   * Apply status decay scaled by elapsed minutes
   * All stats: 100 = good, 0 = bad. All decrease over time.
   */
  applyStatusDecay(elapsedMinutes: number): void {
    if (!this.timeConfig) return

    const { decayRates } = this.timeConfig
    const characters = this.deps.worldState.getAllCharacters()

    for (const char of characters) {
      const perMinuteEffects = this.deps.actionExecutor.getActivePerMinuteEffects(char.id)

      const newSatiety = calculateStatChange(
        char.satiety, decayRates.satietyPerMinute, elapsedMinutes, perMinuteEffects?.satiety
      )
      const newBladder = calculateStatChange(
        char.bladder, decayRates.bladderPerMinute, elapsedMinutes, perMinuteEffects?.bladder
      )
      const newEnergy = calculateStatChange(
        char.energy, decayRates.energyPerMinute, elapsedMinutes, perMinuteEffects?.energy
      )
      const newHygiene = calculateStatChange(
        char.hygiene, decayRates.hygienePerMinute, elapsedMinutes, perMinuteEffects?.hygiene
      )
      const newMood = calculateStatChange(
        char.mood, decayRates.moodPerMinute, elapsedMinutes, perMinuteEffects?.mood
      )

      this.deps.worldState.updateCharacter(char.id, {
        satiety: newSatiety,
        bladder: newBladder,
        energy: newEnergy,
        hygiene: newHygiene,
        mood: newMood,
      })

      // Check for status interrupts
      if (char.bladder >= INTERRUPT_THRESHOLD && newBladder < INTERRUPT_THRESHOLD) {
        this.deps.onStatusInterrupt(char.id, 'bladder')
      } else if (char.satiety >= INTERRUPT_THRESHOLD && newSatiety < INTERRUPT_THRESHOLD) {
        this.deps.onStatusInterrupt(char.id, 'satiety')
      } else if (char.energy >= INTERRUPT_THRESHOLD && newEnergy < INTERRUPT_THRESHOLD) {
        this.deps.onStatusInterrupt(char.id, 'energy')
      } else if (char.hygiene >= INTERRUPT_THRESHOLD && newHygiene < INTERRUPT_THRESHOLD) {
        this.deps.onStatusInterrupt(char.id, 'hygiene')
      }
    }

    console.log(`[TimeManager] Status decay applied (${elapsedMinutes.toFixed(2)} min elapsed)`)
  }

  /**
   * Check if character has any low status
   */
  hasLowStatus(character: SimCharacter): boolean {
    return character.satiety < INTERRUPT_THRESHOLD ||
           character.energy < INTERRUPT_THRESHOLD ||
           character.bladder < INTERRUPT_THRESHOLD ||
           character.hygiene < INTERRUPT_THRESHOLD
  }

  /**
   * Get the forced action for a status type
   */
  static getStatusInterruptAction(statusType: string): string | undefined {
    return STATUS_INTERRUPT_ACTIONS[statusType]
  }

  /**
   * Get interrupt threshold
   */
  static getInterruptThreshold(): number {
    return INTERRUPT_THRESHOLD
  }
}
