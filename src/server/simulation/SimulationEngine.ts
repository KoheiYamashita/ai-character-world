import type { GameMap, Character, WorldTime, NPC, TimeConfig } from '@/types'
import type {
  SimulationConfig,
  SerializedWorldState,
  SimCharacter,
} from './types'
import { DEFAULT_SIMULATION_CONFIG, createSimCharacter } from './types'
import { WorldStateManager } from './WorldState'
import { CharacterSimulator } from './CharacterSimulator'
import { ActionExecutor } from './actions/ActionExecutor'
import { SimpleActionTrigger } from './actions/SimpleActionTrigger'
import type { StateStore } from '../persistence/StateStore'

export type StateChangeCallback = (state: SerializedWorldState) => void

const DEFAULT_TIMEZONE = 'Asia/Tokyo'

// Persistence save interval (30 seconds)
const SAVE_INTERVAL_MS = 30000

export class SimulationEngine {
  private worldState: WorldStateManager
  private characterSimulator: CharacterSimulator
  private actionExecutor: ActionExecutor
  private simpleActionTrigger: SimpleActionTrigger
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

  constructor(config: Partial<SimulationConfig> = {}, stateStore?: StateStore) {
    this.config = { ...DEFAULT_SIMULATION_CONFIG, ...config }
    this.worldState = new WorldStateManager()
    this.characterSimulator = new CharacterSimulator(this.worldState, this.config)
    this.actionExecutor = new ActionExecutor(this.worldState)
    this.simpleActionTrigger = new SimpleActionTrigger(this.worldState, this.actionExecutor)
    this.stateStore = stateStore ?? null
  }

  // Initialize with world data
  async initialize(
    maps: Record<string, GameMap>,
    characters: Character[],
    initialMapId?: string,
    npcBlockedNodes?: Map<string, Set<string>>,
    npcs?: NPC[],
    timeConfig?: TimeConfig
  ): Promise<void> {
    this.worldState.initialize(maps, initialMapId)
    this.serverStartTime = Date.now()

    // Setup NPCs and time configuration
    this.setupNPCsAndTimeConfig(npcBlockedNodes, npcs, timeConfig)

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
    timeConfig?: TimeConfig
  ): void {
    this.setupNPCsAndTimeConfig(npcBlockedNodes, npcs, timeConfig)
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
    this.actionExecutor.tick(now)

    // Check and trigger automatic actions based on status thresholds (Step 6-5)
    this.simpleActionTrigger.tick()

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
  private applyStatusDecay(elapsedMinutes: number): void {
    if (!this.timeConfig) return

    const { decayRates } = this.timeConfig
    const characters = this.worldState.getAllCharacters()

    for (const char of characters) {
      this.worldState.updateCharacter(char.id, {
        // All stats decrease over time (100=good → 0=bad)
        hunger: Math.max(0, char.hunger - decayRates.hungerPerMinute * elapsedMinutes),
        bladder: Math.max(0, char.bladder - decayRates.bladderPerMinute * elapsedMinutes),
        energy: Math.max(0, char.energy - decayRates.energyPerMinute * elapsedMinutes),
        hygiene: Math.max(0, char.hygiene - decayRates.hygienePerMinute * elapsedMinutes),
        mood: Math.max(0, char.mood - decayRates.moodPerMinute * elapsedMinutes),
      })
    }

    console.log(`[SimulationEngine] Status decay applied (${elapsedMinutes.toFixed(2)} min elapsed)`)
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
      const { maps, characters, config, npcBlockedNodes, npcs } = await loadWorldData()

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
        engine.initializeNPCsAndConfig(npcBlockedNodes, npcs, config.time)
      } else {
        // Fresh initialization
        await engine.initialize(maps, characters, config.initialState.mapId, npcBlockedNodes, npcs, config.time)

        // Save server start time on fresh start
        await stateStore.saveServerStartTime(engine.getServerStartTime())
        console.log(`${logPrefix} Initialized with fresh state`)
      }

      engine.start()
      console.log(`${logPrefix} Simulation engine started`)
      return engine
    } finally {
      initializingPromise = null
    }
  })()

  return initializingPromise
}
