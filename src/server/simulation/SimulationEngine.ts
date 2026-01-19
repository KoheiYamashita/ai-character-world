import type { GameMap, Character, WorldTime, NPC, TimeConfig, ScheduleEntry } from '@/types'
import type { BehaviorContext } from '@/types/behavior'
import type {
  SimulationConfig,
  SerializedWorldState,
  SimCharacter,
} from './types'
import { DEFAULT_SIMULATION_CONFIG, createSimCharacter } from './types'
import { WorldStateManager } from './WorldState'
import { CharacterSimulator } from './CharacterSimulator'
import { ActionExecutor } from './actions/ActionExecutor'
import type { StateStore } from '../persistence/StateStore'
import type { BehaviorDecider } from '../behavior/BehaviorDecider'
import { StubBehaviorDecider } from '../behavior/StubBehaviorDecider'

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
  // Track characters with pending behavior decisions (prevents duplicate LLM calls)
  private pendingDecisions: Set<string> = new Set()
  // Track last day for day-change detection (schedule cache refresh)
  private lastDay: number = 1
  // Status interrupt threshold (design: 10%)
  private static readonly INTERRUPT_THRESHOLD = 10

  constructor(config: Partial<SimulationConfig> = {}, stateStore?: StateStore) {
    this.config = { ...DEFAULT_SIMULATION_CONFIG, ...config }
    this.worldState = new WorldStateManager()
    this.characterSimulator = new CharacterSimulator(this.worldState, this.config)
    this.actionExecutor = new ActionExecutor(this.worldState)
    this.behaviorDecider = new StubBehaviorDecider()
    this.stateStore = stateStore ?? null

    // Set action completion callback for behavior decision trigger
    this.actionExecutor.setOnActionComplete((characterId, actionId) => {
      console.log(`[SimulationEngine] Action complete callback: ${characterId} finished ${actionId}`)
      this.onActionComplete(characterId)
    })
  }

  // Initialize with world data
  async initialize(
    maps: Record<string, GameMap>,
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
  async restoreFromStore(maps: Record<string, GameMap>): Promise<boolean> {
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
      // Still notify subscribers so UI updates time
      this.notifySubscribers()
      return
    }

    // Check for day change and refresh schedule cache
    const currentDay = realTime.day
    if (currentDay !== this.lastDay) {
      console.log(`[SimulationEngine] Day changed: ${this.lastDay} -> ${currentDay}`)
      this.lastDay = currentDay
      this.clearScheduleCache()
      // Async reload schedule cache (non-blocking)
      this.loadScheduleCache().catch(err => {
        console.error('[SimulationEngine] Error reloading schedule cache:', err)
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

    // Increment tick counter
    this.worldState.incrementTick()

    // Periodic state persistence (every 30 seconds)
    if (this.stateStore && now - this.lastSaveTime >= SAVE_INTERVAL_MS) {
      this.saveState().catch(err => {
        console.error('[SimulationEngine] Error saving state:', err)
      })
      this.lastSaveTime = now
    }

    // Notify subscribers
    this.notifySubscribers()
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
  private applyStatusDecay(elapsedMinutes: number): void {
    if (!this.timeConfig) return

    const { decayRates } = this.timeConfig
    const characters = this.worldState.getAllCharacters()
    const threshold = SimulationEngine.INTERRUPT_THRESHOLD

    for (const char of characters) {
      // Calculate new values
      const newHunger = Math.max(0, char.hunger - decayRates.hungerPerMinute * elapsedMinutes)
      const newBladder = Math.max(0, char.bladder - decayRates.bladderPerMinute * elapsedMinutes)
      const newEnergy = Math.max(0, char.energy - decayRates.energyPerMinute * elapsedMinutes)
      const newHygiene = Math.max(0, char.hygiene - decayRates.hygienePerMinute * elapsedMinutes)
      const newMood = Math.max(0, char.mood - decayRates.moodPerMinute * elapsedMinutes)

      // Update character stats
      this.worldState.updateCharacter(char.id, {
        hunger: newHunger,
        bladder: newBladder,
        energy: newEnergy,
        hygiene: newHygiene,
        mood: newMood,
      })

      // Check for status interrupts (when stat crosses below threshold)
      // Priority order: bladder > hunger > energy > hygiene (mood doesn't trigger interrupt)
      if (char.bladder >= threshold && newBladder < threshold) {
        this.triggerStatusInterrupt(char.id, 'bladder')
      } else if (char.hunger >= threshold && newHunger < threshold) {
        this.triggerStatusInterrupt(char.id, 'hunger')
      } else if (char.energy >= threshold && newEnergy < threshold) {
        this.triggerStatusInterrupt(char.id, 'energy')
      } else if (char.hygiene >= threshold && newHygiene < threshold) {
        this.triggerStatusInterrupt(char.id, 'hygiene')
      }
    }

    console.log(`[SimulationEngine] Status decay applied (${elapsedMinutes.toFixed(2)} min elapsed)`)
  }

  // Callback when action completes (triggers next behavior decision)
  private onActionComplete(characterId: string): void {
    const character = this.worldState.getCharacter(characterId)
    if (!character) return

    // Skip if decision is already pending
    if (this.pendingDecisions.has(characterId)) return

    // Skip if not idle (might have started another action or conversation)
    if (character.currentAction) return
    if (character.conversation?.isActive) return
    if (character.navigation.isMoving) return

    const currentTime = this.worldState.getTime()
    this.makeBehaviorDecision(character, currentTime)
  }

  // Trigger initial behavior decisions for all idle characters (called on engine start)
  triggerInitialBehaviorDecisions(): void {
    const characters = this.worldState.getAllCharacters()
    const currentTime = this.worldState.getTime()

    console.log('[SimulationEngine] Triggering initial behavior decisions for all idle characters')

    for (const character of characters) {
      // Skip if already executing action
      if (character.currentAction) continue

      // Skip if in conversation
      if (character.conversation?.isActive) continue

      // Skip if moving
      if (character.navigation.isMoving) continue

      // Skip if decision is already pending
      if (this.pendingDecisions.has(character.id)) continue

      this.makeBehaviorDecision(character, currentTime)
    }
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

    const currentTime = this.worldState.getTime()
    this.makeBehaviorDecision(character, currentTime)
  }

  // Make behavior decision for a single character
  private makeBehaviorDecision(character: SimCharacter, currentTime: WorldTime): void {
    // Mark as pending to prevent duplicate calls
    this.pendingDecisions.add(character.id)

    // Build context
    const context: BehaviorContext = {
      character,
      currentTime,
      currentFacility: this.actionExecutor.getCurrentFacility(character.id),
      schedule: this.getScheduleForCharacter(character.id),
      availableActions: this.actionExecutor.getAvailableActions(character.id),
      nearbyNPCs: this.worldState.getNPCsOnMap(character.currentMapId),
    }

    // Make async decision
    this.behaviorDecider.decide(context).then((decision) => {
      // Re-check that character is still idle (state may have changed)
      const currentChar = this.worldState.getCharacter(character.id)
      if (!currentChar) return
      if (currentChar.currentAction) return
      if (currentChar.conversation?.isActive) return
      if (currentChar.navigation.isMoving) return

      // Apply decision
      switch (decision.type) {
        case 'action':
          if (decision.actionId) {
            const success = this.actionExecutor.startAction(character.id, decision.actionId)
            if (success) {
              console.log(`[SimulationEngine] ${character.name} started action: ${decision.actionId} (${decision.reason})`)
            }
          }
          break

        case 'move':
          // TODO: Implement navigation to targetNodeId/targetMapId (future enhancement)
          console.log(`[SimulationEngine] ${character.name} wants to move to ${decision.targetNodeId} (${decision.reason}) - not yet implemented`)
          break

        case 'idle':
          // Do nothing
          break
      }
    }).catch((error) => {
      console.error(`[SimulationEngine] Error making behavior decision for ${character.name}:`, error)
    }).finally(() => {
      // Clear pending flag when decision completes (success or failure)
      this.pendingDecisions.delete(character.id)
    })
  }

  // Get schedule for a character (DB cache priority, fallback to default)
  private getScheduleForCharacter(characterId: string): ScheduleEntry[] | null {
    const currentDay = this.worldState.getTime().day
    const cacheKey = `${characterId}-${currentDay}`

    // Try DB cache first
    const cachedSchedule = this.scheduleCache.get(cacheKey)
    if (cachedSchedule) {
      return cachedSchedule
    }

    // Fallback to default schedules from characters.json
    return this.defaultSchedules.get(characterId) ?? null
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
          const cacheKey = `${char.id}-${currentDay}`
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
    const module = await import('./dataLoader')
    lazyImports.loadWorldDataServer = module.loadWorldDataServer
  }
  return lazyImports.loadWorldDataServer
}

async function getSqliteStore(): Promise<typeof import('../persistence/SqliteStore').SqliteStore> {
  if (!lazyImports.SqliteStore) {
    const module = await import('../persistence/SqliteStore')
    lazyImports.SqliteStore = module.SqliteStore
  }
  return lazyImports.SqliteStore
}

async function getInitializeLLMClient(): Promise<typeof import('../llm').initializeLLMClient> {
  if (!lazyImports.initializeLLMClient) {
    const module = await import('../llm')
    lazyImports.initializeLLMClient = module.initializeLLMClient
  }
  return lazyImports.initializeLLMClient
}

async function getInitializeLLMErrorHandler(): Promise<typeof import('../llm').initializeLLMErrorHandler> {
  if (!lazyImports.initializeLLMErrorHandler) {
    const module = await import('../llm')
    lazyImports.initializeLLMErrorHandler = module.initializeLLMErrorHandler
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
      const { maps, characters, config, npcBlockedNodes, npcs, defaultSchedules } = await loadWorldData()

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
        }

        // Set NPC blocked nodes (not persisted, loaded fresh)
        engine.initializeNPCsAndConfig(npcBlockedNodes, npcs, config.time, defaultSchedules)
      } else {
        // Fresh initialization
        await engine.initialize(maps, characters, config.initialState.mapId, npcBlockedNodes, npcs, config.time, defaultSchedules)

        // Save server start time on fresh start
        await stateStore.saveServerStartTime(engine.getServerStartTime())
        console.log(`${logPrefix} Initialized with fresh state`)
      }

      engine.start()
      console.log(`${logPrefix} Simulation engine started`)

      // Load schedule cache from DB
      await engine.loadScheduleCache()

      // Initialize lastDay for day-change detection
      engine.initializeLastDay()

      // Trigger initial behavior decisions for all idle characters
      engine.triggerInitialBehaviorDecisions()

      return engine
    } finally {
      initializingPromise = null
    }
  })()

  return initializingPromise
}
