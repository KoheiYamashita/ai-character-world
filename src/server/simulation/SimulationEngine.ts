import type { WorldMap, Character, WorldTime, NPC, TimeConfig, ScheduleEntry, DailySchedule, CharacterConfig } from '@/types'
import type { BehaviorContext, BehaviorDecision, NearbyFacility, NearbyMap, ScheduleUpdate, CurrentMapFacility, ActionHistoryEntry } from '@/types/behavior'
import type {
  SimulationConfig,
  SerializedWorldState,
  SimCharacter,
  PendingAction,
} from './types'
import { DEFAULT_SIMULATION_CONFIG, createSimCharacter } from './types'
import { WorldStateManager } from './WorldState'
import { CharacterSimulator } from './CharacterSimulator'
import { ActionExecutor } from './actions/ActionExecutor'
import type { ActionId } from './actions/definitions'
import type { StateStore } from '../persistence/StateStore'
import type { BehaviorDecider } from '../behavior/BehaviorDecider'
import { LLMBehaviorDecider } from '../behavior/LLMBehaviorDecider'
import { findObstacleById, getFacilityTargetNode, isNodeAtFacility } from '@/lib/facilityUtils'
import { calculateStatChange } from '@/lib/statusUtils'
import { getAbstractActionsForTags } from '@/lib/facilityMapping'

export type StateChangeCallback = (state: SerializedWorldState) => void

const DEFAULT_TIMEZONE = 'Asia/Tokyo'

// Persistence save interval (30 seconds)
const SAVE_INTERVAL_MS = 30000

export class SimulationEngine {
  private worldState: WorldStateManager
  private characterSimulator: CharacterSimulator
  private actionExecutor: ActionExecutor
  private behaviorDecider: BehaviorDecider
  private config: SimulationConfig
  private subscribers: Set<StateChangeCallback> = new Set()
  private tickInterval: ReturnType<typeof setInterval> | null = null
  private lastTickTime: number = 0
  private isRunning: boolean = false
  private initialized: boolean = false
  private timeConfig: TimeConfig | null = null
  private lastDecayTime: number = 0
  private serverStartTime: number = Date.now()
  private cachedFormatter: Intl.DateTimeFormat | null = null
  private cachedTimezone: string | null = null
  private stateStore: StateStore | null = null
  private lastSaveTime: number = 0
  private defaultSchedules: Map<string, ScheduleEntry[]> = new Map()
  // Schedule cache: key = `${characterId}-${day}`, loaded from DB
  private scheduleCache: Map<string, ScheduleEntry[]> = new Map()
  // Action history cache: key = `${characterId}-${day}`, loaded from DB
  private actionHistoryCache: Map<string, ActionHistoryEntry[]> = new Map()
  // Track characters with pending behavior decisions (prevents duplicate LLM calls)
  private pendingDecisions: Set<string> = new Set()
  // Track last day for day-change detection (schedule cache refresh)
  private lastDay: number = 1
  // Status interrupt threshold (design: 10%)
  private static readonly INTERRUPT_THRESHOLD = 10
  // System auto-move interval (every N actions)
  private static readonly SYSTEM_AUTO_MOVE_INTERVAL = 3
  // SSE notification throttle (every N ticks instead of every tick)
  private static readonly NOTIFICATION_THROTTLE_TICKS = 5
  private notificationTickCounter = 0
  // Status type → forced action mapping (Step 14)
  private static readonly STATUS_INTERRUPT_ACTIONS: Record<string, string> = {
    bladder: 'toilet',
    satiety: 'eat',
    energy: 'sleep',  // Could also be 'rest', but sleep is more effective
    hygiene: 'bathe',
  }

  constructor(config: Partial<SimulationConfig> = {}, stateStore?: StateStore) {
    this.config = { ...DEFAULT_SIMULATION_CONFIG, ...config }
    this.worldState = new WorldStateManager()
    this.characterSimulator = new CharacterSimulator(this.worldState, this.config)
    this.actionExecutor = new ActionExecutor(this.worldState)
    this.behaviorDecider = new LLMBehaviorDecider()
    this.stateStore = stateStore ?? null

    // Set action completion callback for behavior decision trigger
    this.actionExecutor.setOnActionComplete((characterId, actionId) => {
      console.log(`[SimulationEngine] Action complete callback: ${characterId} finished ${actionId}`)
      this.onActionComplete(characterId)
    })

    // Set navigation completion callback for behavior decision trigger
    this.characterSimulator.setOnNavigationComplete((characterId) => {
      console.log(`[SimulationEngine] Navigation complete callback: ${characterId}`)
      this.onNavigationComplete(characterId)
    })

    // Set action history recording callback
    this.actionExecutor.setOnRecordHistory((entry) => {
      this.recordActionHistory(entry)
    })
  }

  // Initialize with world data
  async initialize(
    maps: Record<string, WorldMap>,
    characters: Character[],
    initialMapId?: string,
    npcBlockedNodes?: Map<string, Set<string>>,
    npcs?: NPC[],
    timeConfig?: TimeConfig,
    defaultSchedules?: Map<string, ScheduleEntry[]>
  ): Promise<void> {
    this.worldState.initialize(maps, initialMapId)
    this.serverStartTime = Date.now()

    // Setup NPCs and time configuration
    this.setupNPCsAndTimeConfig(npcBlockedNodes, npcs, timeConfig)

    // Store default schedules
    if (defaultSchedules) {
      this.defaultSchedules = defaultSchedules
    }

    // Add characters to world state
    for (const char of characters) {
      const simChar = createSimCharacter(char)
      this.worldState.addCharacter(simChar)
    }

    this.initialized = true
    console.log(`[SimulationEngine] Initialized with ${characters.length} characters and ${Object.keys(maps).length} maps`)
  }

  // Check if engine has been initialized
  isInitialized(): boolean {
    return this.initialized
  }

  // Start the simulation loop
  start(): void {
    if (this.isRunning) {
      console.log('[SimulationEngine] Already running')
      return
    }

    this.isRunning = true
    this.lastTickTime = Date.now()
    this.lastDecayTime = Date.now() // Reset to avoid decay spike after stop
    const tickMs = 1000 / this.config.tickRate

    console.log(`[SimulationEngine] Starting at ${this.config.tickRate} ticks/second`)

    this.tickInterval = setInterval(() => {
      this.tick()
    }, tickMs)
  }

  // Stop the simulation loop
  stop(): void {
    if (!this.isRunning) return

    this.isRunning = false

    if (this.tickInterval) {
      clearInterval(this.tickInterval)
      this.tickInterval = null
    }

    console.log('[SimulationEngine] Stopped')
  }

  // Save current state to persistent storage
  async saveState(): Promise<void> {
    if (!this.stateStore) return

    const state = this.worldState.getSerializedState()
    await this.stateStore.saveState(state)
    console.log('[SimulationEngine] State saved to persistent storage')
  }

  // Shutdown the engine and save state
  async shutdown(): Promise<void> {
    console.log('[SimulationEngine] Shutting down...')
    this.stop()

    if (this.stateStore) {
      await this.saveState()
      await this.stateStore.close()
    }

    console.log('[SimulationEngine] Shutdown complete')
  }

  // Restore characters from persistent storage
  async restoreFromStore(maps: Record<string, WorldMap>): Promise<boolean> {
    if (!this.stateStore) return false

    const hasData = await this.stateStore.hasData()
    if (!hasData) {
      console.log('[SimulationEngine] No persisted data found')
      return false
    }

    const state = await this.stateStore.loadState()
    if (!state) {
      console.log('[SimulationEngine] Failed to load persisted state')
      return false
    }

    // Initialize world state with maps
    this.worldState.initialize(maps, state.currentMapId)

    // Restore characters
    for (const [, char] of Object.entries(state.characters)) {
      this.worldState.addCharacter(char)
    }

    console.log(`[SimulationEngine] Restored ${Object.keys(state.characters).length} characters from persistent storage`)
    return true
  }

  // Set state store (for late binding)
  setStateStore(store: StateStore): void {
    this.stateStore = store
  }

  // Get state store
  getStateStore(): StateStore | null {
    return this.stateStore
  }

  // Initialize NPCs and config (for use after restore)
  initializeNPCsAndConfig(
    npcBlockedNodes?: Map<string, Set<string>>,
    npcs?: NPC[],
    timeConfig?: TimeConfig,
    defaultSchedules?: Map<string, ScheduleEntry[]>
  ): void {
    this.setupNPCsAndTimeConfig(npcBlockedNodes, npcs, timeConfig)
    if (defaultSchedules) {
      this.defaultSchedules = defaultSchedules
    }
    this.initialized = true
  }

  // Shared setup for NPC blocked nodes, NPCs, and time configuration
  private setupNPCsAndTimeConfig(
    npcBlockedNodes?: Map<string, Set<string>>,
    npcs?: NPC[],
    timeConfig?: TimeConfig
  ): void {
    this.timeConfig = timeConfig ?? null

    // Initialize formatter cache and sync time
    this.updateFormatterCache()
    const realTime = this.getCurrentRealTime()
    this.worldState.setTime(realTime)
    this.lastDecayTime = Date.now()

    // Set NPC blocked nodes for pathfinding
    if (npcBlockedNodes) {
      for (const [mapId, nodeIds] of npcBlockedNodes) {
        this.worldState.setNPCBlockedNodes(mapId, nodeIds)
      }
      console.log(`[SimulationEngine] Loaded NPC blocked nodes for ${npcBlockedNodes.size} maps`)
    }

    // Add NPCs to world state
    if (npcs && npcs.length > 0) {
      this.worldState.initializeNPCs(npcs)
      console.log(`[SimulationEngine] Loaded ${npcs.length} NPCs`)
    }
  }

  // Main tick function
  private tick(): void {
    const now = Date.now()
    const deltaTime = (now - this.lastTickTime) / 1000 // Convert to seconds
    this.lastTickTime = now

    // Always sync with real time (even when paused)
    const realTime = this.getCurrentRealTime()
    this.worldState.setTime(realTime)

    // Skip simulation updates if paused (but time still syncs)
    if (this.worldState.isPaused()) {
      // Still notify subscribers so UI updates time (throttled)
      this.notificationTickCounter++
      if (this.notificationTickCounter >= SimulationEngine.NOTIFICATION_THROTTLE_TICKS) {
        this.notificationTickCounter = 0
        this.notifySubscribers()
      }
      return
    }

    // Check for day change and refresh caches
    const currentDay = realTime.day
    if (currentDay !== this.lastDay) {
      console.log(`[SimulationEngine] Day changed: ${this.lastDay} -> ${currentDay}`)
      const previousDay = this.lastDay
      this.lastDay = currentDay
      // Async seed + reload, then clear old entries
      // Note: Don't clear cache before loading - this causes race condition
      // where getScheduleForCharacter() returns null during async operation
      this.seedDefaultSchedules()
        .then(() => this.loadScheduleCache())
        .then(() => {
          // Clear only previous day's entries (new day's data is already loaded)
          this.clearScheduleCacheForDay(previousDay)
          this.clearActionHistoryCacheForDay(previousDay)
        })
        .catch(err => {
          console.error('[SimulationEngine] Error seeding/reloading schedule cache:', err)
        })
    }

    // Check for status decay with elapsed time scaling
    if (this.timeConfig) {
      const elapsed = now - this.lastDecayTime
      if (elapsed >= this.timeConfig.statusDecayIntervalMs) {
        const elapsedMinutes = elapsed / 60000 // Convert ms to minutes
        this.applyStatusDecay(elapsedMinutes)
        this.lastDecayTime = now
      }
    }

    // Update action execution (checks for completion)
    // Note: Action completion triggers behavior decision via callback (design-compliant)
    this.actionExecutor.tick(now)

    // Update character simulations (movement, transitions)
    this.characterSimulator.tick(deltaTime, now)

    // Check for pending actions after movement completes
    this.checkPendingActions()

    // Increment tick counter
    this.worldState.incrementTick()

    // Periodic state persistence (every 30 seconds)
    if (this.stateStore && now - this.lastSaveTime >= SAVE_INTERVAL_MS) {
      this.saveState().catch(err => {
        console.error('[SimulationEngine] Error saving state:', err)
      })
      this.lastSaveTime = now
    }

    // Notify subscribers (throttled to reduce SSE traffic)
    this.notificationTickCounter++
    if (this.notificationTickCounter >= SimulationEngine.NOTIFICATION_THROTTLE_TICKS) {
      this.notificationTickCounter = 0
      this.notifySubscribers()
    }
  }

  // Update formatter cache when timezone changes
  private updateFormatterCache(): void {
    const timezone = this.timeConfig?.timezone ?? DEFAULT_TIMEZONE

    // Only recreate if timezone changed
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
      console.warn(`[SimulationEngine] Invalid timezone "${timezone}", falling back to ${DEFAULT_TIMEZONE}`)
      this.cachedFormatter = new Intl.DateTimeFormat('en-US', {
        timeZone: DEFAULT_TIMEZONE,
        hour: 'numeric',
        minute: 'numeric',
        hour12: false,
      })
      this.cachedTimezone = DEFAULT_TIMEZONE
    }
  }

  private getCurrentRealTime(): WorldTime {
    const now = new Date()

    // Use cached formatter
    if (!this.cachedFormatter) {
      this.updateFormatterCache()
    }

    const parts = this.cachedFormatter!.formatToParts(now)
    const hour = Number(parts.find(p => p.type === 'hour')?.value ?? 0)
    const minute = Number(parts.find(p => p.type === 'minute')?.value ?? 0)

    // Calculate days since server start
    const msPerDay = 24 * 60 * 60 * 1000
    const day = Math.floor((now.getTime() - this.serverStartTime) / msPerDay) + 1

    return { hour, minute, day }
  }

  // Apply status decay scaled by elapsed minutes
  // All stats: 100 = good, 0 = bad. All decrease over time.
  // Also checks for status interrupts (when stat drops below threshold)
  //
  // アクション実行中の場合:
  // - perMinute で定義されたステータスは減少を停止し、perMinute の値で「置き換え」
  // - perMinute で定義されていないステータスは通常通り減少
  private applyStatusDecay(elapsedMinutes: number): void {
    if (!this.timeConfig) return

    const { decayRates } = this.timeConfig
    const characters = this.worldState.getAllCharacters()
    const threshold = SimulationEngine.INTERRUPT_THRESHOLD

    for (const char of characters) {
      // アクション実行中の場合、perMinute 効果を取得
      const perMinuteEffects = this.actionExecutor.getActivePerMinuteEffects(char.id)

      // 各ステータスの新しい値を計算
      // perMinute で定義されている場合は perMinute の値で置き換え、
      // そうでない場合は通常の減少を適用
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

      // Update character stats
      this.worldState.updateCharacter(char.id, {
        satiety: newSatiety,
        bladder: newBladder,
        energy: newEnergy,
        hygiene: newHygiene,
        mood: newMood,
      })

      // Check for status interrupts (when stat crosses below threshold)
      // Priority order: bladder > satiety > energy > hygiene (mood doesn't trigger interrupt)
      if (char.bladder >= threshold && newBladder < threshold) {
        this.triggerStatusInterrupt(char.id, 'bladder')
      } else if (char.satiety >= threshold && newSatiety < threshold) {
        this.triggerStatusInterrupt(char.id, 'satiety')
      } else if (char.energy >= threshold && newEnergy < threshold) {
        this.triggerStatusInterrupt(char.id, 'energy')
      } else if (char.hygiene >= threshold && newHygiene < threshold) {
        this.triggerStatusInterrupt(char.id, 'hygiene')
      }
    }

    console.log(`[SimulationEngine] Status decay applied (${elapsedMinutes.toFixed(2)} min elapsed)`)
  }

  // Check if character is idle (not executing action, conversation, or movement)
  private isCharacterIdle(character: SimCharacter): boolean {
    return !character.currentAction &&
           !character.conversation?.isActive &&
           !character.navigation.isMoving
  }

  // Callback when action completes (triggers next behavior decision)
  private onActionComplete(characterId: string): void {
    const character = this.worldState.getCharacter(characterId)
    if (!character) return
    if (this.pendingDecisions.has(characterId)) return
    if (!this.isCharacterIdle(character)) return

    // Increment action counter
    const newCounter = character.actionCounter + 1
    this.worldState.updateCharacter(characterId, { actionCounter: newCounter })

    // Check for system auto-move (every 5 actions)
    // If triggered, skip normal behavior decision
    if (this.checkSystemAutoMove(character, newCounter)) {
      return
    }

    const currentTime = this.worldState.getTime()
    this.makeBehaviorDecision(character, currentTime)
  }

  // Callback when navigation completes (triggers next behavior decision)
  private onNavigationComplete(characterId: string): void {
    const character = this.worldState.getCharacter(characterId)
    if (!character) return
    if (this.pendingDecisions.has(characterId)) return
    if (!this.isCharacterIdle(character)) return

    // Skip if pending action exists (will be handled by checkPendingActions)
    if (character.pendingAction) return

    const currentTime = this.worldState.getTime()
    this.makeBehaviorDecision(character, currentTime)
  }

  // Trigger initial behavior decisions for all idle characters (called on engine start)
  triggerInitialBehaviorDecisions(): void {
    const characters = this.worldState.getAllCharacters()
    const currentTime = this.worldState.getTime()

    console.log('[SimulationEngine] Triggering initial behavior decisions for all idle characters')

    for (const character of characters) {
      if (this.pendingDecisions.has(character.id)) continue
      if (!this.isCharacterIdle(character)) continue

      this.makeBehaviorDecision(character, currentTime)
    }
  }

  // Check if character has any status below threshold (for system auto-move skip)
  private hasLowStatus(character: SimCharacter): boolean {
    const threshold = SimulationEngine.INTERRUPT_THRESHOLD
    return character.bladder < threshold ||
           character.satiety < threshold ||
           character.energy < threshold ||
           character.hygiene < threshold
  }

  // Select a random map within 3 hops (excluding current map)
  private selectRandomNearbyMap(currentMapId: string): string | null {
    // Collect all nearby map IDs (excluding current map)
    const nearbyMapIds = this.traverseNearbyMaps(currentMapId, (_map, mapId, distance) =>
      distance > 0 ? [mapId] : []
    )

    if (nearbyMapIds.length === 0) {
      return null
    }

    // Random selection
    const randomIndex = Math.floor(Math.random() * nearbyMapIds.length)
    return nearbyMapIds[randomIndex]
  }

  // Start system auto-move to a target map
  private startSystemAutoMove(character: SimCharacter, targetMapId: string): boolean {
    const targetMap = this.worldState.getMap(targetMapId)
    if (!targetMap?.spawnNodeId) {
      console.log(`[SimulationEngine] System auto-move failed: no spawn node for map ${targetMapId}`)
      return false
    }

    const success = this.characterSimulator.navigateToMap(
      character.id,
      targetMapId,
      targetMap.spawnNodeId
    )

    if (success) {
      console.log(`[SimulationEngine] System auto-move: ${character.name} -> ${targetMapId}`)
    } else {
      console.log(`[SimulationEngine] System auto-move failed: ${character.name} -> ${targetMapId}`)
    }

    return success
  }

  // Check and execute system auto-move (called after action completion)
  private checkSystemAutoMove(character: SimCharacter, actionCounter: number): boolean {
    // Not yet at interval threshold
    if (actionCounter < SimulationEngine.SYSTEM_AUTO_MOVE_INTERVAL) {
      return false
    }

    // Status interrupt active (any status < 10%) - skip auto-move but count progresses
    // Don't reset counter - will check again after interrupt is resolved
    if (this.hasLowStatus(character)) {
      console.log(`[SimulationEngine] System auto-move skipped (status interrupt): ${character.name}`)
      return false
    }

    // Reset counter (regardless of whether auto-move succeeds)
    this.worldState.updateCharacter(character.id, { actionCounter: 0 })

    // Select random nearby map (within 3 hops)
    const targetMapId = this.selectRandomNearbyMap(character.currentMapId)
    if (!targetMapId) {
      console.log(`[SimulationEngine] System auto-move skipped (no nearby maps): ${character.name}`)
      return false
    }

    // Start navigation to target map
    return this.startSystemAutoMove(character, targetMapId)
  }

  // Trigger status interrupt for a character (called when status drops below threshold)
  private triggerStatusInterrupt(characterId: string, statusType: string): void {
    const character = this.worldState.getCharacter(characterId)
    if (!character) return

    // Skip if decision is already pending
    if (this.pendingDecisions.has(characterId)) return

    // Skip if already executing action (don't interrupt current action)
    if (character.currentAction) return

    console.log(`[SimulationEngine] Status interrupt: ${character.name} ${statusType} < ${SimulationEngine.INTERRUPT_THRESHOLD}%`)

    // Get forced action for this status type
    const forcedAction = SimulationEngine.STATUS_INTERRUPT_ACTIONS[statusType]
    if (!forcedAction) {
      // Fallback to normal behavior decision if no mapping
      const currentTime = this.worldState.getTime()
      this.makeBehaviorDecision(character, currentTime)
      return
    }

    // Trigger interrupt behavior decision with forced action
    this.makeInterruptBehaviorDecision(character, forcedAction)
  }

  /**
   * Build behavior context for a character
   * @param character The character to build context for
   * @param includeTodayActions Whether to include today's action history (for normal decisions)
   */
  private buildBehaviorContext(character: SimCharacter, includeTodayActions: boolean = true): BehaviorContext {
    const currentTime = this.worldState.getTime()

    return {
      character,
      currentTime,
      currentFacility: this.actionExecutor.getCurrentFacility(character.id),
      schedule: this.getScheduleForCharacter(character.id),
      availableActions: this.actionExecutor.getAvailableActions(character.id),
      nearbyNPCs: this.worldState.getNPCsOnMap(character.currentMapId),
      currentMapFacilities: this.buildCurrentMapFacilities(character.currentMapId),
      nearbyFacilities: this.buildNearbyFacilities(character.currentMapId),
      nearbyMaps: this.buildNearbyMaps(character.currentMapId),
      todayActions: includeTodayActions ? this.getActionHistoryForCharacter(character.id) : undefined,
    }
  }

  /**
   * Apply a behavior decision (shared logic for normal and interrupt decisions)
   */
  private applyBehaviorDecision(
    character: SimCharacter,
    decision: BehaviorDecision,
    logContext: string
  ): void {
    switch (decision.type) {
      case 'action':
        if (decision.actionId) {
          this.handleActionDecision(character, decision)
        }
        break

      case 'move': {
        let moveSuccess = false
        if (decision.targetMapId && decision.targetMapId !== character.currentMapId) {
          const targetMap = this.worldState.getMap(decision.targetMapId)
          if (targetMap?.spawnNodeId) {
            moveSuccess = this.characterSimulator.navigateToMap(
              character.id,
              decision.targetMapId,
              targetMap.spawnNodeId
            )
            if (moveSuccess) {
              console.log(`[SimulationEngine] ${character.name} moving to map ${decision.targetMapId} (${logContext}: ${decision.reason})`)
            } else {
              console.log(`[SimulationEngine] ${character.name} failed to start navigation to map ${decision.targetMapId}`)
            }
          } else {
            console.log(`[SimulationEngine] ${character.name} cannot find map ${decision.targetMapId}`)
          }
        } else if (decision.targetNodeId) {
          moveSuccess = this.characterSimulator.navigateToNode(character.id, decision.targetNodeId)
          if (moveSuccess) {
            console.log(`[SimulationEngine] ${character.name} moving to node ${decision.targetNodeId} (${logContext}: ${decision.reason})`)
          } else {
            console.log(`[SimulationEngine] ${character.name} failed to start navigation to node ${decision.targetNodeId}`)
          }
        } else {
          console.log(`[SimulationEngine] ${character.name} move decision has no target`)
        }
        if (!moveSuccess) {
          this.scheduleNextDecision(character.id, 1000)
        }
        break
      }

      case 'idle': {
        // Different emoji for interrupt vs normal idle
        const isInterrupt = logContext === 'interrupt'
        this.worldState.updateCharacter(character.id, {
          displayEmoji: isInterrupt ? '😰' : '😶',
        })
        // Longer retry for interrupt (emergency with no solution)
        this.scheduleNextDecision(character.id, isInterrupt ? 5000 : 2000)
        break
      }
    }
  }

  // Make interrupt behavior decision (forced action, LLM selects facility only)
  private makeInterruptBehaviorDecision(character: SimCharacter, forcedAction: string): void {
    this.pendingDecisions.add(character.id)
    this.actionExecutor.startAction(character.id, 'thinking')

    const context = this.buildBehaviorContext(character, false)

    this.behaviorDecider.decideInterruptFacility(forcedAction, context).then((decision) => {
      this.actionExecutor.forceCompleteAction(character.id)

      const currentChar = this.worldState.getCharacter(character.id)
      if (!currentChar || !this.isCharacterIdle(currentChar)) return

      console.log(`[SimulationEngine] Interrupt decision for ${character.name}: ${decision.type} (${decision.reason})`)
      this.applyBehaviorDecision(currentChar, decision, 'interrupt')
    }).catch((error) => {
      this.actionExecutor.forceCompleteAction(character.id)
      console.error(`[SimulationEngine] Error in interrupt decision for ${character.name}:`, error)
      const currentChar = this.worldState.getCharacter(character.id)
      if (currentChar && this.isCharacterIdle(currentChar)) {
        this.makeBehaviorDecision(currentChar, this.worldState.getTime())
      }
    }).finally(() => {
      this.pendingDecisions.delete(character.id)
    })
  }

  // Make behavior decision for a single character
  private makeBehaviorDecision(character: SimCharacter, currentTime: WorldTime): void {
    this.pendingDecisions.add(character.id)
    this.actionExecutor.startAction(character.id, 'thinking')

    const context = this.buildBehaviorContext(character, true)

    this.behaviorDecider.decide(context).then((decision) => {
      this.actionExecutor.forceCompleteAction(character.id)

      const currentChar = this.worldState.getCharacter(character.id)
      if (!currentChar || !this.isCharacterIdle(currentChar)) return

      this.applyBehaviorDecision(currentChar, decision, 'normal')

      // Apply schedule update if LLM proposed one
      if (decision.scheduleUpdate) {
        this.applyScheduleUpdate(character.id, decision.scheduleUpdate)
      }
    }).catch((error) => {
      this.actionExecutor.forceCompleteAction(character.id)
      console.error(`[SimulationEngine] Error making behavior decision for ${character.name}:`, error)
    }).finally(() => {
      this.pendingDecisions.delete(character.id)
    })
  }

  // Check for pending actions after movement completes
  private checkPendingActions(): void {
    const characters = this.worldState.getAllCharacters()

    for (const character of characters) {
      // Skip if no pending action
      if (!character.pendingAction) continue

      // Skip if still moving or in transition
      if (character.navigation.isMoving) continue
      if (character.crossMapNavigation?.isActive) continue

      // Skip if already executing an action
      if (character.currentAction) continue

      // Character has arrived - execute pending action
      const { actionId, facilityId, targetNpcId, reason, durationMinutes } = character.pendingAction

      // Clear pending action first
      this.worldState.updateCharacter(character.id, { pendingAction: null })

      // Try to execute the action
      const success = this.actionExecutor.startAction(character.id, actionId, facilityId, targetNpcId, durationMinutes, reason)
      if (success) {
        const durationStr = durationMinutes !== undefined ? ` (${durationMinutes}min)` : ''
        if (targetNpcId) {
          const npc = this.worldState.getNPC(targetNpcId)
          console.log(`[SimulationEngine] ${character.name} arrived and started action: ${actionId}${durationStr} with ${npc?.name ?? targetNpcId} (${reason})`)
        } else {
          console.log(`[SimulationEngine] ${character.name} arrived and started action: ${actionId}${durationStr} at facility: ${facilityId} (${reason})`)
        }
      } else {
        console.log(`[SimulationEngine] ${character.name} arrived but failed to start action: ${actionId}`)
        // Trigger new behavior decision since action failed
        const currentTime = this.worldState.getTime()
        this.makeBehaviorDecision(character, currentTime)
      }
    }
  }

  // Handle action decision: execute immediately or move to facility/NPC first
  private handleActionDecision(character: SimCharacter, decision: BehaviorDecision): void {
    const { actionId, targetFacilityId, targetNpcId, reason, durationMinutes } = decision
    if (!actionId) return

    // Handle talk action with NPC target
    if (actionId === 'talk' && targetNpcId) {
      this.handleTalkAction(character, targetNpcId, reason)
      return
    }

    // Handle facility-based actions
    this.handleFacilityAction(character, actionId, targetFacilityId, reason, durationMinutes)
  }

  // Handle talk action: move to NPC if not adjacent, then start talk
  private handleTalkAction(character: SimCharacter, targetNpcId: string, reason?: string): void {
    const npc = this.worldState.getNPC(targetNpcId)
    if (!npc) {
      console.log(`[SimulationEngine] ${character.name} target NPC ${targetNpcId} not found`)
      this.triggerActionDecision(character)
      return
    }

    // Check if NPC is on the same map
    if (npc.mapId !== character.currentMapId) {
      console.log(`[SimulationEngine] ${character.name} target NPC ${npc.name} is on different map`)
      this.triggerActionDecision(character)
      return
    }

    const currentMap = this.worldState.getMap(character.currentMapId)
    if (!currentMap) {
      console.log(`[SimulationEngine] ${character.name} cannot find current map`)
      this.triggerActionDecision(character)
      return
    }

    // Check if character is already adjacent to NPC (on a connected node)
    const npcNode = currentMap.nodes.find(n => n.id === npc.currentNodeId)
    if (!npcNode) {
      console.log(`[SimulationEngine] ${character.name} cannot find NPC node ${npc.currentNodeId}`)
      this.triggerActionDecision(character)
      return
    }

    const isAdjacent = npcNode.connectedTo.includes(character.currentNodeId) ||
                       character.currentNodeId === npc.currentNodeId

    if (isAdjacent) {
      // Already adjacent - execute talk immediately
      const success = this.actionExecutor.startAction(character.id, 'talk', undefined, targetNpcId, undefined, reason)
      if (success) {
        console.log(`[SimulationEngine] ${character.name} started talk with ${npc.name} (${reason})`)
      } else {
        console.log(`[SimulationEngine] ${character.name} failed to start talk with ${npc.name}`)
        this.triggerActionDecision(character)
      }
      return
    }

    // Not adjacent - need to navigate to an adjacent node
    // Find a walkable adjacent node
    const adjacentNodeId = npcNode.connectedTo.find(nodeId => {
      const node = currentMap.nodes.find(n => n.id === nodeId)
      return node && node.type !== 'entrance' // Avoid entrance nodes
    })

    if (!adjacentNodeId) {
      console.log(`[SimulationEngine] ${character.name} cannot find adjacent node to NPC ${npc.name}`)
      this.triggerActionDecision(character)
      return
    }

    // Set pending action for talk
    const pendingAction: PendingAction = {
      actionId: 'talk',
      targetNpcId,
      facilityMapId: character.currentMapId,
      reason,
    }

    this.worldState.updateCharacter(character.id, { pendingAction })

    // Start navigation to adjacent node
    const startResult = this.characterSimulator.navigateToNode(character.id, adjacentNodeId)
    if (startResult) {
      console.log(`[SimulationEngine] ${character.name} moving to talk with ${npc.name} (${reason})`)
    } else {
      this.worldState.updateCharacter(character.id, { pendingAction: null })
      console.log(`[SimulationEngine] ${character.name} failed to start navigation to NPC ${npc.name}`)
      this.triggerActionDecision(character)
    }
  }

  // Handle facility-based action: move to facility if not inside, then execute
  private handleFacilityAction(
    character: SimCharacter,
    actionId: ActionId,
    targetFacilityId?: string,
    reason?: string,
    durationMinutes?: number
  ): void {
    const currentMap = this.worldState.getMap(character.currentMapId)

    // Find facility: check current map first, then nearby maps
    let facilityMapId = character.currentMapId
    let obstacle: ReturnType<typeof findObstacleById> | null = null

    if (targetFacilityId && currentMap) {
      // Check current map first
      obstacle = findObstacleById(currentMap.obstacles, targetFacilityId)
      if (obstacle) {
        facilityMapId = character.currentMapId
      } else {
        // Check nearby maps
        const nearbyFacilities = this.buildNearbyFacilities(character.currentMapId)
        const targetFacility = nearbyFacilities.find(f => f.id === targetFacilityId)
        if (targetFacility) {
          facilityMapId = targetFacility.mapId
          const facilityMap = this.worldState.getMap(facilityMapId)
          if (facilityMap) {
            obstacle = findObstacleById(facilityMap.obstacles, targetFacilityId)
          }
        }
      }
    }

    // Check if character is currently inside the target facility
    let isInsideTargetFacility = false
    if (targetFacilityId && obstacle && facilityMapId === character.currentMapId && currentMap) {
      const gridPrefix = currentMap.nodes[0]?.id.split('-')[0] || character.currentMapId
      isInsideTargetFacility = isNodeAtFacility(character.currentNodeId, obstacle, gridPrefix)
    }

    // Execute immediately if: no specific facility OR already inside target facility
    if (!targetFacilityId || isInsideTargetFacility) {
      const success = this.actionExecutor.startAction(character.id, actionId, targetFacilityId, undefined, durationMinutes, reason)
      if (success) {
        const durationStr = durationMinutes !== undefined ? ` (${durationMinutes}min)` : ''
        console.log(`[SimulationEngine] ${character.name} started action: ${actionId}${durationStr} (${reason})${targetFacilityId ? ` at facility: ${targetFacilityId}` : ''}`)
      } else {
        console.log(`[SimulationEngine] ${character.name} failed to start action: ${actionId}, triggering re-decision`)
        this.triggerActionDecision(character)
      }
      return
    }

    // Not inside target facility - need to navigate first
    if (!obstacle) {
      console.log(`[SimulationEngine] ${character.name} target facility ${targetFacilityId} not found`)
      this.triggerActionDecision(character)
      return
    }

    const facilityMap = this.worldState.getMap(facilityMapId)
    if (!facilityMap) {
      console.log(`[SimulationEngine] ${character.name} cannot find map ${facilityMapId} for facility ${targetFacilityId}`)
      this.triggerActionDecision(character)
      return
    }

    // Extract grid prefix from first node ID (format: {prefix}-{row}-{col})
    const gridPrefix = facilityMap.nodes[0]?.id.split('-')[0] || facilityMapId
    const targetNodeId = getFacilityTargetNode(obstacle, facilityMap.nodes, gridPrefix)
    if (!targetNodeId) {
      console.log(`[SimulationEngine] ${character.name} cannot find target node for facility ${targetFacilityId}`)
      this.triggerActionDecision(character)
      return
    }

    // Set pending action
    const pendingAction: PendingAction = {
      actionId,
      facilityId: targetFacilityId,
      facilityMapId,
      reason,
      durationMinutes,
    }

    this.worldState.updateCharacter(character.id, { pendingAction })

    // Start navigation
    if (facilityMapId === character.currentMapId) {
      // Same map: start local navigation
      const startResult = this.characterSimulator.navigateToNode(character.id, targetNodeId)
      if (startResult) {
        console.log(`[SimulationEngine] ${character.name} moving to facility ${targetFacilityId} (${reason})`)
      } else {
        this.worldState.updateCharacter(character.id, { pendingAction: null })
        console.log(`[SimulationEngine] ${character.name} failed to start navigation to facility ${targetFacilityId}`)
        this.triggerActionDecision(character)
      }
    } else {
      // Different map: start cross-map navigation
      const crossMapResult = this.characterSimulator.navigateToMap(
        character.id,
        facilityMapId,
        targetNodeId
      )
      if (crossMapResult) {
        console.log(`[SimulationEngine] ${character.name} moving to facility ${targetFacilityId} on map ${facilityMapId} (${reason})`)
      } else {
        this.worldState.updateCharacter(character.id, { pendingAction: null })
        console.log(`[SimulationEngine] ${character.name} failed to start cross-map navigation to facility ${targetFacilityId}`)
        this.triggerActionDecision(character)
      }
    }
  }

  // Trigger a new action decision for a character (used after action/navigation failure)
  private triggerActionDecision(character: SimCharacter): void {
    // Schedule for next event loop tick to ensure pendingDecisions is cleared.
    // This is called from within makeBehaviorDecision's .then() block,
    // where pendingDecisions is still set until .finally() runs.
    this.scheduleNextDecision(character.id, 0)
  }

  // Schedule next behavior decision after a delay (used for idle state and re-trigger)
  private scheduleNextDecision(characterId: string, delayMs: number): void {
    setTimeout(() => {
      if (this.pendingDecisions.has(characterId)) return

      const character = this.worldState.getCharacter(characterId)
      if (!character) return
      if (!this.isCharacterIdle(character)) return

      const currentTime = this.worldState.getTime()
      this.makeBehaviorDecision(character, currentTime)
    }, delayMs)
  }

  // Generate cache key for character-day based data
  private characterDayCacheKey(characterId: string, day: number): string {
    return `${characterId}-${day}`
  }

  // Get schedule for a character (DB cache only, seeded on startup)
  private getScheduleForCharacter(characterId: string): ScheduleEntry[] | null {
    const currentDay = this.worldState.getTime().day
    const cacheKey = this.characterDayCacheKey(characterId, currentDay)

    // Return from DB cache (seeded on startup/day-change)
    return this.scheduleCache.get(cacheKey) ?? null
  }

  /**
   * 現在マップの施設情報を収集（アクション表示用）
   */
  private buildCurrentMapFacilities(mapId: string): CurrentMapFacility[] {
    const map = this.worldState.getMap(mapId)
    if (!map) return []

    const facilities: CurrentMapFacility[] = []

    for (const obstacle of map.obstacles) {
      if (!obstacle.facility) continue

      const availableActions = getAbstractActionsForTags(obstacle.facility.tags)
      if (availableActions.length === 0) continue

      facilities.push({
        id: obstacle.id,
        label: obstacle.label || obstacle.id,
        tags: obstacle.facility.tags,
        cost: obstacle.facility.cost,
        availableActions,
      })
    }

    return facilities
  }

  /**
   * BFSで3ホップ以内のマップを探索し、各マップに対してコールバックを呼び出す
   */
  private traverseNearbyMaps<T>(
    currentMapId: string,
    callback: (map: WorldMap, mapId: string, distance: number) => T[]
  ): T[] {
    const results: T[] = []
    const visited = new Set<string>()
    const queue: { mapId: string; distance: number }[] = [{ mapId: currentMapId, distance: 0 }]

    while (queue.length > 0) {
      const { mapId, distance } = queue.shift()!

      if (visited.has(mapId)) continue
      visited.add(mapId)

      const map = this.worldState.getMap(mapId)
      if (!map) continue

      // Call the callback to collect results for this map
      results.push(...callback(map, mapId, distance))

      // If within 3 hops, explore connected maps via entrance nodes
      if (distance < 3) {
        for (const node of map.nodes) {
          if (node.type === 'entrance' && node.leadsTo && !visited.has(node.leadsTo.mapId)) {
            queue.push({ mapId: node.leadsTo.mapId, distance: distance + 1 })
          }
        }
      }
    }

    return results
  }

  /**
   * 他マップの施設を収集（現在マップは除外、distance > 0 のみ）
   */
  private buildNearbyFacilities(currentMapId: string): NearbyFacility[] {
    return this.traverseNearbyMaps(currentMapId, (map, mapId, distance) => {
      // 現在マップの施設は除外
      if (distance === 0) return []

      const facilities: NearbyFacility[] = []
      for (const obstacle of map.obstacles) {
        if (!obstacle.facility) continue

        // Calculate available actions from facility tags
        const availableActions = getAbstractActionsForTags(obstacle.facility.tags)

        facilities.push({
          id: obstacle.id,
          label: obstacle.label || obstacle.id,
          tags: obstacle.facility.tags,
          cost: obstacle.facility.cost,
          quality: obstacle.facility.quality,
          distance,
          mapId,
          availableActions: availableActions.length > 0 ? availableActions : undefined,
        })
      }
      return facilities
    })
  }

  /**
   * 移動可能なマップ情報を収集（現在マップも含む）
   */
  private buildNearbyMaps(currentMapId: string): NearbyMap[] {
    return this.traverseNearbyMaps(currentMapId, (map, mapId, distance) => [{
      id: mapId,
      label: map.name || mapId,
      distance,
    }])
  }

  // Apply schedule update proposed by LLM
  private applyScheduleUpdate(characterId: string, update: ScheduleUpdate): void {
    const currentDay = this.worldState.getTime().day
    const cacheKey = this.characterDayCacheKey(characterId, currentDay)

    // Clone entries from DB cache (seeded on startup/day-change)
    const entries = [...(this.scheduleCache.get(cacheKey) ?? [])]

    const { type, entry } = update

    switch (type) {
      case 'add':
        // Add new entry and sort by time
        entries.push(entry)
        entries.sort((a, b) => a.time.localeCompare(b.time))
        console.log(`[SimulationEngine] Schedule add: ${entry.time} ${entry.activity}`)
        break

      case 'remove':
        // Remove entry matching time and activity
        const removeIndex = entries.findIndex(
          e => e.time === entry.time && e.activity === entry.activity
        )
        if (removeIndex >= 0) {
          entries.splice(removeIndex, 1)
          console.log(`[SimulationEngine] Schedule remove: ${entry.time} ${entry.activity}`)
        } else {
          console.log(`[SimulationEngine] Schedule remove: entry not found (${entry.time} ${entry.activity})`)
        }
        break

      case 'modify':
        // Find entry by time and replace it
        const modifyIndex = entries.findIndex(e => e.time === entry.time)
        if (modifyIndex >= 0) {
          entries[modifyIndex] = entry
          console.log(`[SimulationEngine] Schedule modify: ${entry.time} -> ${entry.activity}`)
        } else {
          // If not found, add as new entry
          entries.push(entry)
          entries.sort((a, b) => a.time.localeCompare(b.time))
          console.log(`[SimulationEngine] Schedule modify (not found, added): ${entry.time} ${entry.activity}`)
        }
        break
    }

    // Update cache
    this.scheduleCache.set(cacheKey, entries)

    // Persist to DB (async, non-blocking)
    if (this.stateStore) {
      const schedule: DailySchedule = {
        characterId,
        day: currentDay,
        entries,
      }
      this.stateStore.saveSchedule(schedule).catch(error => {
        console.error(`[SimulationEngine] Error saving schedule update:`, error)
      })
    }
  }

  // Seed default schedules to DB for all characters on current day (if not exists)
  async seedDefaultSchedules(): Promise<void> {
    if (!this.stateStore) return

    const currentDay = this.worldState.getTime().day

    for (const [characterId, entries] of this.defaultSchedules) {
      try {
        // Check if schedule already exists in DB
        const existing = await this.stateStore.loadSchedule(characterId, currentDay)
        if (!existing) {
          // Seed from default schedules
          await this.stateStore.saveSchedule({ characterId, day: currentDay, entries })
          console.log(`[SimulationEngine] Seeded default schedule for ${characterId} (day ${currentDay})`)
        }
      } catch (error) {
        console.error(`[SimulationEngine] Error seeding schedule for ${characterId}:`, error)
      }
    }
  }

  // Load schedules from DB into cache for all characters on current day
  async loadScheduleCache(): Promise<void> {
    if (!this.stateStore) return

    const currentDay = this.worldState.getTime().day
    const characters = this.worldState.getAllCharacters()

    for (const char of characters) {
      try {
        const schedule = await this.stateStore.loadSchedule(char.id, currentDay)
        if (schedule) {
          const cacheKey = this.characterDayCacheKey(char.id, currentDay)
          this.scheduleCache.set(cacheKey, schedule.entries)
          console.log(`[SimulationEngine] Loaded schedule for ${char.name} (day ${currentDay}) from DB`)
        }
      } catch (error) {
        console.error(`[SimulationEngine] Error loading schedule for ${char.id}:`, error)
      }
    }
  }

  // Clear schedule cache (called when day changes)
  clearScheduleCache(): void {
    this.scheduleCache.clear()
  }

  // Clear schedule cache entries for a specific day only
  private clearScheduleCacheForDay(day: number): void {
    const suffix = `-${day}`
    for (const key of this.scheduleCache.keys()) {
      if (key.endsWith(suffix)) {
        this.scheduleCache.delete(key)
      }
    }
  }

  // Clear action history cache (called when day changes)
  clearActionHistoryCache(): void {
    this.actionHistoryCache.clear()
  }

  // Clear action history cache entries for a specific day only
  private clearActionHistoryCacheForDay(day: number): void {
    const suffix = `-${day}`
    for (const key of this.actionHistoryCache.keys()) {
      if (key.endsWith(suffix)) {
        this.actionHistoryCache.delete(key)
      }
    }
  }

  // Record action history (called from ActionExecutor callback)
  private recordActionHistory(entry: {
    characterId: string
    actionId: ActionId
    facilityId?: string
    targetNpcId?: string
    durationMinutes?: number
    reason?: string
  }): void {
    const currentTime = this.worldState.getTime()
    const currentDay = currentTime.day
    const timeStr = `${String(currentTime.hour).padStart(2, '0')}:${String(currentTime.minute).padStart(2, '0')}`

    // Determine target (facility or NPC)
    const target = entry.facilityId ?? entry.targetNpcId

    // Get reason from entry (passed from ActionExecutor via ActionState)
    const reason = entry.reason

    // Update cache
    const cacheKey = this.characterDayCacheKey(entry.characterId, currentDay)
    const cached = this.actionHistoryCache.get(cacheKey) ?? []
    cached.push({
      time: timeStr,
      actionId: entry.actionId,
      target,
      durationMinutes: entry.durationMinutes,
      reason,
    })
    this.actionHistoryCache.set(cacheKey, cached)

    // Persist to DB (async, non-blocking)
    if (this.stateStore) {
      this.stateStore.addActionHistory({
        characterId: entry.characterId,
        day: currentDay,
        time: timeStr,
        actionId: entry.actionId,
        target,
        durationMinutes: entry.durationMinutes,
        reason,
      }).catch(error => {
        console.error(`[SimulationEngine] Error saving action history:`, error)
      })
    }

    console.log(`[SimulationEngine] Recorded action history: ${entry.characterId} ${timeStr} ${entry.actionId}${target ? ` → ${target}` : ''}`)
  }

  // Get action history for a character (cache priority, fallback to empty)
  private getActionHistoryForCharacter(characterId: string): ActionHistoryEntry[] {
    const currentDay = this.worldState.getTime().day
    const cacheKey = this.characterDayCacheKey(characterId, currentDay)
    return this.actionHistoryCache.get(cacheKey) ?? []
  }

  // Load action history from DB into cache for all characters on current day
  async loadActionHistoryCache(): Promise<void> {
    if (!this.stateStore) return

    const currentDay = this.worldState.getTime().day
    const characters = this.worldState.getAllCharacters()

    for (const char of characters) {
      try {
        const history = await this.stateStore.loadActionHistoryForDay(char.id, currentDay)
        if (history.length > 0) {
          const cacheKey = this.characterDayCacheKey(char.id, currentDay)
          this.actionHistoryCache.set(cacheKey, history)
          console.log(`[SimulationEngine] Loaded ${history.length} action history entries for ${char.name} (day ${currentDay})`)
        }
      } catch (error) {
        console.error(`[SimulationEngine] Error loading action history for ${char.id}:`, error)
      }
    }
  }

  // Initialize lastDay from current time (called after engine start)
  initializeLastDay(): void {
    this.lastDay = this.worldState.getTime().day
    console.log(`[SimulationEngine] Initialized lastDay: ${this.lastDay}`)
  }

  // Subscribe to state changes
  subscribe(callback: StateChangeCallback): () => void {
    this.subscribers.add(callback)
    return () => {
      this.subscribers.delete(callback)
    }
  }

  // Notify all subscribers of state change
  private notifySubscribers(): void {
    const state = this.worldState.getSerializedState()
    for (const callback of this.subscribers) {
      try {
        callback(state)
      } catch (error) {
        console.error('[SimulationEngine] Error in subscriber callback:', error)
      }
    }
  }

  // Get current state (for initial sync)
  getState(): SerializedWorldState {
    return this.worldState.getSerializedState()
  }

  // Get specific character
  getCharacter(id: string): SimCharacter | undefined {
    return this.worldState.getCharacter(id)
  }

  // Pause/unpause
  pause(): void {
    this.worldState.setPaused(true)
    console.log('[SimulationEngine] Paused')
  }

  unpause(): void {
    this.worldState.setPaused(false)
    // Reset decay time to avoid applying accumulated decay during pause
    this.lastDecayTime = Date.now()
    this.lastTickTime = Date.now() // Reset tick time to avoid large delta
    console.log('[SimulationEngine] Unpaused')
  }

  togglePause(): void {
    if (this.worldState.isPaused()) {
      this.unpause()
    } else {
      this.pause()
    }
  }

  isPaused(): boolean {
    return this.worldState.isPaused()
  }

  isSimulationRunning(): boolean {
    return this.isRunning
  }

  // Get tick rate
  getTickRate(): number {
    return this.config.tickRate
  }

  // Get subscriber count (for monitoring)
  getSubscriberCount(): number {
    return this.subscribers.size
  }

  // Get server start time (for persistence)
  getServerStartTime(): number {
    return this.serverStartTime
  }

  // Set server start time (for restoration from persistence)
  setServerStartTime(time: number): void {
    this.serverStartTime = time
  }

  // Get action executor (for external action control)
  getActionExecutor(): ActionExecutor {
    return this.actionExecutor
  }

  // Get character simulator (for external navigation control)
  getCharacterSimulator(): CharacterSimulator {
    return this.characterSimulator
  }

  // Supplement character profiles with personality, tendencies, customPrompt from config
  // Called after restoring from persistence where these fields are not saved
  supplementCharacterProfiles(characterConfigs: CharacterConfig[]): void {
    const configMap = new Map(characterConfigs.map(c => [c.id, c]))

    for (const char of this.worldState.getAllCharacters()) {
      const config = configMap.get(char.id)
      if (config) {
        this.worldState.supplementCharacterProfile(char.id, {
          personality: config.personality,
          tendencies: config.tendencies,
          customPrompt: config.customPrompt,
        })
      }
    }

    console.log(`[SimulationEngine] Supplemented character profiles for ${characterConfigs.length} characters`)
  }

  // Set action configs for ActionExecutor and LLMBehaviorDecider
  setActionConfigs(configs: Record<string, import('@/types').ActionConfig>): void {
    this.actionExecutor.setActionConfigs(configs)
    // Cast to access setActionConfigs on LLMBehaviorDecider
    if ('setActionConfigs' in this.behaviorDecider) {
      (this.behaviorDecider as LLMBehaviorDecider).setActionConfigs(configs)
    }
    console.log(`[SimulationEngine] Action configs set`)
  }
}

// Singleton instance for the server
let globalEngine: SimulationEngine | null = null

export function getSimulationEngine(): SimulationEngine {
  if (!globalEngine) {
    globalEngine = new SimulationEngine()
  }
  return globalEngine
}

export function setSimulationEngine(engine: SimulationEngine): void {
  globalEngine = engine
}

export function resetSimulationEngine(): void {
  if (globalEngine) {
    globalEngine.stop()
    globalEngine = null
  }
  // Reset error handler to clear consecutive failure count
  import('../llm').then(({ resetLLMErrorHandler }) => {
    resetLLMErrorHandler()
  }).catch(() => {
    // Ignore import errors during reset
  })
}

// Lazy imports to avoid circular dependencies
const lazyImports = {
  loadWorldDataServer: null as typeof import('./dataLoader').loadWorldDataServer | null,
  SqliteStore: null as typeof import('../persistence/SqliteStore').SqliteStore | null,
  initializeLLMClient: null as typeof import('../llm').initializeLLMClient | null,
  initializeLLMErrorHandler: null as typeof import('../llm').initializeLLMErrorHandler | null,
}

async function getWorldDataLoader(): Promise<typeof import('./dataLoader').loadWorldDataServer> {
  if (!lazyImports.loadWorldDataServer) {
    const imported = await import('./dataLoader')
    lazyImports.loadWorldDataServer = imported.loadWorldDataServer
  }
  return lazyImports.loadWorldDataServer
}

async function getSqliteStore(): Promise<typeof import('../persistence/SqliteStore').SqliteStore> {
  if (!lazyImports.SqliteStore) {
    const imported = await import('../persistence/SqliteStore')
    lazyImports.SqliteStore = imported.SqliteStore
  }
  return lazyImports.SqliteStore
}

async function getInitializeLLMClient(): Promise<typeof import('../llm').initializeLLMClient> {
  if (!lazyImports.initializeLLMClient) {
    const imported = await import('../llm')
    lazyImports.initializeLLMClient = imported.initializeLLMClient
  }
  return lazyImports.initializeLLMClient
}

async function getInitializeLLMErrorHandler(): Promise<typeof import('../llm').initializeLLMErrorHandler> {
  if (!lazyImports.initializeLLMErrorHandler) {
    const imported = await import('../llm')
    lazyImports.initializeLLMErrorHandler = imported.initializeLLMErrorHandler
  }
  return lazyImports.initializeLLMErrorHandler
}

// Shared promise to prevent parallel initialization race condition
let initializingPromise: Promise<SimulationEngine> | null = null

/**
 * Ensures the simulation engine is initialized and running.
 * Safe to call multiple times - will only initialize once.
 * Uses a shared promise to prevent race conditions from parallel requests.
 * Restores state from SQLite if available.
 */
export async function ensureEngineInitialized(logPrefix: string = '[Engine]'): Promise<SimulationEngine> {
  const engine = getSimulationEngine()

  // Already initialized
  if (engine.isInitialized()) {
    return engine
  }

  // Initialization in progress - wait for it
  if (initializingPromise) {
    return initializingPromise
  }

  // Start initialization with shared promise
  initializingPromise = (async () => {
    try {
      console.log(`${logPrefix} Initializing simulation engine...`)

      // Load world data (maps, characters, config)
      const loadWorldData = await getWorldDataLoader()
      const { maps, characters, config, npcBlockedNodes, npcs, defaultSchedules, characterConfigs } = await loadWorldData()

      // Initialize LLM client (reads from environment variables)
      const initializeLLMClient = await getInitializeLLMClient()
      initializeLLMClient()

      // Initialize LLM error handler with config
      const initializeLLMErrorHandler = await getInitializeLLMErrorHandler()
      initializeLLMErrorHandler(config.error)

      // Create SQLite store for persistence
      const SqliteStore = await getSqliteStore()
      const stateStore = new SqliteStore('data/state.db')
      engine.setStateStore(stateStore)

      // Try to restore from persistent storage
      const restored = await engine.restoreFromStore(maps)

      if (restored) {
        console.log(`${logPrefix} Restored state from persistent storage`)

        // Restore server start time if available
        const savedStartTime = await stateStore.loadServerStartTime()
        if (savedStartTime) {
          engine.setServerStartTime(savedStartTime)
        } else {
          // serverStartTime not found in DB (legacy data) - save current time
          // This ensures day counting works correctly from this point forward
          console.log(`${logPrefix} serverStartTime not found in DB, saving current time`)
          await stateStore.saveServerStartTime(engine.getServerStartTime())
        }

        // Supplement character profiles (personality, tendencies, customPrompt)
        // These fields are not persisted in DB, so we need to load them from config
        engine.supplementCharacterProfiles(characterConfigs)

        // Set NPC blocked nodes (not persisted, loaded fresh)
        engine.initializeNPCsAndConfig(npcBlockedNodes, npcs, config.time, defaultSchedules)
      } else {
        // Fresh initialization
        await engine.initialize(maps, characters, config.initialState.mapId, npcBlockedNodes, npcs, config.time, defaultSchedules)

        // Save server start time on fresh start
        await stateStore.saveServerStartTime(engine.getServerStartTime())
        console.log(`${logPrefix} Initialized with fresh state`)
      }

      // Set action configs for ActionExecutor and LLMBehaviorDecider
      if (config.actions) {
        engine.setActionConfigs(config.actions)
      }

      // Load schedules and action history BEFORE starting engine
      // This prevents race condition where ticks fire before data is loaded
      await engine.seedDefaultSchedules()
      await engine.loadScheduleCache()
      await engine.loadActionHistoryCache()
      engine.initializeLastDay()

      engine.start()
      console.log(`${logPrefix} Simulation engine started`)

      // Trigger initial behavior decisions for all idle characters
      engine.triggerInitialBehaviorDecisions()

      return engine
    } finally {
      initializingPromise = null
    }
  })()

  return initializingPromise
}
