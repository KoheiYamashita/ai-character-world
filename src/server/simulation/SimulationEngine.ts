import type { WorldMap, Character, WorldTime, NPC, TimeConfig, ScheduleEntry, DailySchedule, CharacterConfig, ConversationGoal, NPCDynamicState, ActivityLogEntry, ConversationSummaryEntry, MiniEpisodeConfig } from '@/types'
import type { BehaviorContext, BehaviorDecision, NearbyFacility, NearbyMap, ScheduleUpdate, CurrentMapFacility, ActionHistoryEntry, MidTermMemory, RecentConversation } from '@/types/behavior'
import type { ChatIncomingMessage, ChatSummary, ChatContext, PendingNotification } from '@/types/chat'
import type {
  SimulationConfig,
  SerializedWorldState,
  SimCharacter,
  PendingAction,
} from './types'
import { DEFAULT_SIMULATION_CONFIG, createSimCharacter } from './types'
import { WorldStateManager } from './WorldState'
import { CharacterSimulator } from './CharacterSimulator'
import { NPCSimulator } from './NPCSimulator'
import { ActionExecutor } from './actions/ActionExecutor'
import type { ActionId } from './actions/definitions'
import type { StateStore } from '../persistence/StateStore'
import type { BehaviorDecider } from '../behavior/BehaviorDecider'
import { LLMBehaviorDecider } from '../behavior/LLMBehaviorDecider'
import { ConversationManager } from '../conversation/ConversationManager'
import { ConversationExecutor } from '../conversation/ConversationExecutor'
import type { ConversationContext } from '../conversation/ConversationExecutor'
import { ConversationPostProcessor } from '../conversation/ConversationPostProcessor'
import { CommitmentManager } from '../commitment/CommitmentManager'
import type { MiniEpisodeGenerator } from '../episode/MiniEpisodeGenerator'
import { StubMiniEpisodeGenerator } from '../episode/StubMiniEpisodeGenerator'
import { findObstacleById, getFacilityTargetNode, isNodeAtFacility } from '@/lib/facilityUtils'
import { calculateStatChange } from '@/lib/statusUtils'
import { getDirection } from '@/lib/movement'
import { filterForBehaviorDecision, filterForConversation, filterLatestPerNPC, addCooldownInfoToNPCs } from '@/lib/conversationFilters'
import { SPECIAL_EMOJI, getActionEmoji } from '@/lib/uiLabels'
import { isDebugMode } from '@/lib/debugConfig'
import { ChatManager, ChatExecutor, ChatPostProcessor as ChatPostProc, isChatEnabled, getCharactersForChannel, initializeChatProviders } from '../chat'

export type StateChangeCallback = (state: SerializedWorldState) => void
export type LogEventCallback = (entry: ActivityLogEntry) => void

const DEFAULT_TIMEZONE = 'Asia/Tokyo'

// Persistence save interval (30 seconds)
const SAVE_INTERVAL_MS = 30000

export class SimulationEngine {
  private worldState: WorldStateManager
  private characterSimulator: CharacterSimulator
  private npcSimulator: NPCSimulator
  private actionExecutor: ActionExecutor
  private conversationManager: ConversationManager
  private conversationExecutor: ConversationExecutor
  private conversationPostProcessor: ConversationPostProcessor
  private commitmentManager: CommitmentManager
  private behaviorDecider: BehaviorDecider
  // Full NPC data (with personality, facts, etc.) for conversation LLM
  private fullNPCs: Map<string, NPC> = new Map()
  private config: SimulationConfig
  private subscribers: Set<StateChangeCallback> = new Set()
  private logSubscribers: Set<LogEventCallback> = new Set()
  private tickInterval: ReturnType<typeof setInterval> | null = null
  private lastTickTime: number = 0
  private isRunning: boolean = false
  private initialized: boolean = false
  private timeConfig: TimeConfig | null = null
  private lastDecayTime: number = 0
  private serverStartTime: number = Date.now()
  private serverStartMidnight: number = 0
  private cachedFormatter: Intl.DateTimeFormat | null = null
  private cachedTimezone: string | null = null
  private stateStore: StateStore | null = null
  private lastSaveTime: number = 0
  private defaultSchedules: Map<string, ScheduleEntry[]> = new Map()
  // Mini episode generator
  private miniEpisodeGenerator: MiniEpisodeGenerator = new StubMiniEpisodeGenerator()
  // Track characters with pending behavior decisions (prevents duplicate LLM calls)
  private pendingDecisions: Set<string> = new Set()
  // Track active action rowIds for DB persistence (characterId -> rowId)
  private activeActionRowIds: Map<string, number> = new Map()
  // Track last day for day-change detection (schedule cache refresh)
  private lastDay: number = 1
  // Action restrictions (consecutive action limit)
  private maxConsecutiveSameAction: number = 3
  // Memory config (prompt size limits)
  private todayActionsLimit: number = 10
  // Status interrupt threshold (design: 10%)
  private static readonly INTERRUPT_THRESHOLD = 10
  // System auto-action interval (every N actions)
  private static readonly SYSTEM_AUTO_ACTION_INTERVAL = 3
  // Status type → forced action mapping (Step 14)
  private static readonly STATUS_INTERRUPT_ACTIONS: Record<string, string> = {
    bladder: 'toilet',
    satiety: 'eat',
    energy: 'sleep',  // Could also be 'rest', but sleep is more effective
    hygiene: 'bathe',
  }
  // Chat system
  private chatManager: ChatManager | null = null
  private chatExecutor: ChatExecutor | null = null
  private chatPostProcessor: ChatPostProc | null = null
  private chatEnabled: boolean = false

  constructor(config: Partial<SimulationConfig> = {}, stateStore?: StateStore) {
    this.config = { ...DEFAULT_SIMULATION_CONFIG, ...config }
    this.worldState = new WorldStateManager()
    this.characterSimulator = new CharacterSimulator(this.worldState, this.config)
    this.npcSimulator = new NPCSimulator(this.worldState, this.config)
    this.actionExecutor = new ActionExecutor(this.worldState)
    this.conversationManager = new ConversationManager(this.worldState)
    this.conversationExecutor = new ConversationExecutor(this.conversationManager)
    this.conversationPostProcessor = new ConversationPostProcessor()
    this.commitmentManager = new CommitmentManager()
    this.behaviorDecider = new LLMBehaviorDecider()
    this.stateStore = stateStore ?? null

    // Set up PostProcessor callbacks and inject into executor
    this.conversationPostProcessor.setOnNPCUpdate((npcId, updates) => {
      this.updateFullNPC(npcId, updates)
    })
    this.conversationPostProcessor.setOnSummaryPersist(async (entry) => {
      // Add day and time for activity log queries
      const currentTime = this.worldState.getTime()
      entry.day = currentTime.day
      entry.time = this.formatTimeString(currentTime)
      if (this.stateStore) await this.stateStore.saveNPCSummary(entry)
      // Notify log subscribers
      this.notifyLogSubscribersConversation(entry)
    })
    this.conversationPostProcessor.setOnNPCStatePersist(async (npcId, state) => {
      if (this.stateStore) await this.stateStore.saveNPCState(npcId, state)
    })
    this.conversationPostProcessor.setOnMemoryReplace(async (characterId, memories) => {
      // Persist to DB (replace all memories for this character)
      if (this.stateStore) {
        await this.stateStore.replaceMidTermMemories(characterId, memories)
      }
    })
    this.conversationPostProcessor.setOnCommitmentCreate(async (params) => {
      // Resolve location text to mapId and create commitment
      await this.commitmentManager.createCommitmentFromLocation({
        npcId: params.npcId,
        characterId: params.characterId,
        locationText: params.targetMapId, // targetMapId contains location text from LLM
        targetTime: params.targetTime,
        targetDay: params.targetDay,
        description: params.description,
      })
    })
    this.conversationExecutor.setPostProcessor(this.conversationPostProcessor)

    // Set message emit callback for realtime log delivery
    this.conversationExecutor.setOnMessageEmit((characterId, npcId, speaker, speakerName, utterance) => {
      this.notifyLogSubscribersMessage(characterId, npcId, speaker, speakerName, utterance)
    })

    // Set conversation complete callback
    this.conversationExecutor.setOnConversationComplete((characterId) => {
      // Complete the existing in_progress talk action record (don't create a new one)
      const action = this.worldState.getCharacter(characterId)?.currentAction
      if (action?.actionId === 'talk') {
        this.completeActionHistoryRecord({
          characterId,
          actionId: 'talk',
          targetNpcId: action.targetNpcId,
          reason: action.reason,
        })
      }
      // Clear action state and trigger next behavior decision
      this.actionExecutor.forceCompleteAction(characterId)
      this.onActionComplete(characterId)
    })

    // Set action completion callback for behavior decision trigger
    this.actionExecutor.setOnActionComplete((characterId, actionId) => {
      console.log(`[SimulationEngine] Action complete callback: ${characterId} finished ${actionId}`)
      // Note: talk action is completed by ConversationExecutor, not by timer
      this.onActionComplete(characterId)
    })

    // Set navigation completion callback for behavior decision trigger
    this.characterSimulator.setOnNavigationComplete((characterId) => {
      console.log(`[SimulationEngine] Navigation complete callback: ${characterId}`)
      this.onNavigationComplete(characterId)
    })

    // Set action history recording callback (for completion)
    this.actionExecutor.setOnRecordHistory((entry) => {
      this.completeActionHistoryRecord(entry)
    })

    // Set action start callback (for new action persistence system)
    this.actionExecutor.setOnActionStart((entry) => {
      this.startActionHistoryRecord(entry)
    })

    // Set debug log callbacks (DEBUG_MODE=true 時のみ有効)
    if (this.behaviorDecider instanceof LLMBehaviorDecider) {
      this.behaviorDecider.setOnDebugLog((entry) => {
        this.saveAndEmitDebugLog('llm_behavior', entry.characterId, {
          characterName: entry.characterName,
          stage: entry.stage,
          prompt: entry.prompt,
          response: entry.response,
          decision: entry.decision,
        })
      })
    }

    this.conversationExecutor.setOnDebugLog((entry) => {
      this.saveAndEmitDebugLog('conversation_turn', entry.characterId, {
        characterName: entry.characterName,
        npcId: entry.npcId,
        npcName: entry.npcName,
        turn: entry.turn,
        speaker: entry.speaker,
        prompt: entry.prompt,
        response: entry.response,
      })
    })

    // Initialize chat system (async, continues in background)
    this.initializeChatSystem()
  }

  // Initialize chat system asynchronously
  private async initializeChatSystem(): Promise<void> {
    try {
      await initializeChatProviders()
      this.chatEnabled = isChatEnabled()

      if (!this.chatEnabled) {
        console.log('[SimulationEngine] Chat system disabled (no providers configured)')
        return
      }

      this.chatManager = new ChatManager()
      this.chatExecutor = new ChatExecutor(this.chatManager)
      this.chatPostProcessor = new ChatPostProc()

      // Wire up executor callbacks
      this.chatExecutor.setOnChatComplete((characterId, success) => {
        this.onChatActionComplete(characterId, success)
      })

      this.chatExecutor.setOnMessageEmit((characterId, providerId, channelId, channelName, content, isFromCharacter) => {
        const character = this.worldState.getCharacter(characterId)
        const currentTime = this.worldState.getTime()
        this.notifyLogSubscribersChatMessage(
          characterId,
          character?.name ?? characterId,
          providerId,
          channelId,
          channelName,
          isFromCharacter ? character?.name ?? characterId : channelName,
          content,
          isFromCharacter,
          currentTime
        )
      })

      // Wire up post processor callbacks
      this.chatPostProcessor.setOnSummaryPersist(async (summary) => {
        if (this.stateStore) {
          await this.stateStore.saveChatSummary(summary)
        }
      })

      this.chatPostProcessor.setOnMemoryAdd(async (memory) => {
        if (this.stateStore) {
          const currentDay = this.worldState.getTime().day
          // Set day-based fields
          memory.createdDay = currentDay
          // Importance-based expiration
          const expirationDays = { low: 0, medium: 1, high: 2 }
          memory.expiresDay = currentDay + expirationDays[memory.importance]
          await this.stateStore.addMidTermMemory(memory)
        }
      })

      // Wire up ChatManager persistence callbacks
      this.chatManager.setOnNotificationSave(async (characterId, notification) => {
        if (this.stateStore) {
          await this.stateStore.savePendingNotification(characterId, notification)
        }
      })

      this.chatManager.setOnNotificationDelete(async (notificationId) => {
        if (this.stateStore) {
          await this.stateStore.deletePendingNotification(notificationId)
        }
      })

      this.chatManager.setOnNotificationsClear(async (characterId) => {
        if (this.stateStore) {
          await this.stateStore.clearPendingNotifications(characterId)
        }
      })

      // Restore pending notifications from DB
      if (this.stateStore) {
        const notifications = await this.stateStore.loadAllPendingNotifications()
        this.chatManager.restoreNotifications(notifications)
      }

      console.log('[SimulationEngine] Chat system initialized')
    } catch (error) {
      console.error('[SimulationEngine] Failed to initialize chat system:', error)
      this.chatEnabled = false
    }
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

    // Initialize CommitmentManager with WorldState and StateStore
    this.commitmentManager.setWorldState(this.worldState)
    if (this.stateStore) {
      this.commitmentManager.setStateStore(this.stateStore)
    }

    // Load commitments for current day
    const currentDay = this.worldState.getTime().day
    this.commitmentManager.loadCommitmentsForDay(currentDay).catch(err => {
      console.error('[SimulationEngine] Error loading commitments:', err)
    })

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

  // Save all NPC positions to persistent storage
  private async saveNPCPositions(): Promise<void> {
    if (!this.stateStore) return

    for (const [npcId, npc] of this.fullNPCs) {
      const simNPC = this.worldState.getNPC(npcId)
      if (!simNPC) continue

      const state: NPCDynamicState = {
        affinity: npc.affinity,
        mood: npc.mood,
        facts: npc.facts,
        conversationCount: npc.conversationCount,
        lastConversation: npc.lastConversation,
        mapId: simNPC.mapId,
        currentNodeId: simNPC.currentNodeId,
        positionX: simNPC.position.x,
        positionY: simNPC.position.y,
        direction: simNPC.direction,
      }
      await this.stateStore.saveNPCState(npcId, state)
    }
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

    // Initialize formatter cache, recompute midnight, and sync time
    this.updateFormatterCache()
    this.serverStartMidnight = this.computeServerStartMidnight()
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

    // Add NPCs to world state and store full NPC data
    if (npcs && npcs.length > 0) {
      this.worldState.initializeNPCs(npcs)
      this.fullNPCs.clear()
      for (const npc of npcs) {
        this.fullNPCs.set(npc.id, npc)
      }
      console.log(`[SimulationEngine] Loaded ${npcs.length} NPCs`)
    }
  }

  // Update NPC dynamic state in-memory
  private updateFullNPC(npcId: string, updates: Partial<NPCDynamicState>): void {
    const npc = this.fullNPCs.get(npcId)
    if (!npc) return
    if (updates.affinity !== undefined) npc.affinity = updates.affinity
    if (updates.mood !== undefined) npc.mood = updates.mood
    if (updates.facts !== undefined) npc.facts = updates.facts
    if (updates.conversationCount !== undefined) npc.conversationCount = updates.conversationCount
    if (updates.lastConversation !== undefined) npc.lastConversation = updates.lastConversation
  }

  // Restore NPC dynamic state from persistent storage
  restoreNPCState(npcId: string, state: NPCDynamicState): void {
    const npc = this.fullNPCs.get(npcId)
    if (!npc) return
    npc.facts = state.facts
    npc.affinity = state.affinity
    npc.mood = state.mood
    npc.conversationCount = state.conversationCount
    npc.lastConversation = state.lastConversation

    // 位置情報の復元（永続化されている場合）
    if (state.mapId && state.currentNodeId && state.positionX != null && state.positionY != null) {
      this.worldState.updateNPCMap(npcId, state.mapId, state.currentNodeId, {
        x: state.positionX,
        y: state.positionY,
      })
      if (state.direction) {
        this.worldState.updateNPCDirection(npcId, state.direction)
      }
      // fullNPCsの位置も更新
      npc.mapId = state.mapId
      npc.currentNodeId = state.currentNodeId
      npc.position = { x: state.positionX, y: state.positionY }
      if (state.direction) {
        npc.direction = state.direction
      }
    }
  }

  // Clean up expired NPC facts on day change
  private cleanupExpiredNPCFacts(currentDay: number): void {
    let totalRemoved = 0
    for (const [npcId, npc] of this.fullNPCs) {
      const beforeCount = npc.facts.length
      // Filter out expired facts (keep those with null expiresDay or expiresDay >= currentDay)
      npc.facts = npc.facts.filter(f => f.expiresDay === null || f.expiresDay >= currentDay)
      const removed = beforeCount - npc.facts.length
      if (removed > 0) {
        totalRemoved += removed
        // Persist updated NPC state
        if (this.stateStore) {
          const simNPC = this.worldState.getNPC(npcId)
          const state: NPCDynamicState = {
            affinity: npc.affinity,
            mood: npc.mood,
            facts: npc.facts,
            conversationCount: npc.conversationCount,
            lastConversation: npc.lastConversation,
            // 位置情報
            mapId: simNPC?.mapId,
            currentNodeId: simNPC?.currentNodeId,
            positionX: simNPC?.position.x,
            positionY: simNPC?.position.y,
            direction: simNPC?.direction,
          }
          this.stateStore.saveNPCState(npcId, state).catch(err => {
            console.error(`[SimulationEngine] Error saving NPC state after facts cleanup:`, err)
          })
        }
      }
    }
    if (totalRemoved > 0) {
      console.log(`[SimulationEngine] Cleaned up ${totalRemoved} expired NPC facts`)
    }
  }

  // Process NPC commitments - trigger NPC movement to meeting locations
  private processCommitments(): void {
    const currentTime = this.worldState.getTime()
    const triggered = this.commitmentManager.getTriggeredCommitments(currentTime)

    for (const commitment of triggered) {
      const npc = this.worldState.getNPC(commitment.npcId)
      if (!npc || npc.isInConversation) continue

      // Resolve commitment to specific node
      const resolved = this.commitmentManager.resolveCommitmentToNode(commitment)
      if (!resolved) {
        console.warn(`[SimulationEngine] Could not resolve commitment location for ${commitment.id}`)
        continue
      }

      // Navigate NPC to commitment location
      let started = false
      if (npc.mapId === resolved.mapId) {
        // Same map - direct navigation
        started = this.npcSimulator.navigateToNode(commitment.npcId, resolved.nodeId)
      } else {
        // Different map - cross-map navigation
        started = this.npcSimulator.navigateToMap(commitment.npcId, resolved.mapId, resolved.nodeId)
      }

      if (started) {
        this.commitmentManager.markTriggered(commitment.id).catch(err => {
          console.error(`[SimulationEngine] Error marking commitment as triggered:`, err)
        })
        console.log(`[SimulationEngine] NPC ${npc.name} started moving to commitment location (${resolved.mapId}/${resolved.nodeId})`)
      }
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
      this.notifySubscribers()
      return
    }

    // Check for day change
    const currentDay = realTime.day
    if (currentDay !== this.lastDay) {
      console.log(`[SimulationEngine] Day changed: ${this.lastDay} -> ${currentDay}`)
      this.lastDay = currentDay
      // Seed default schedules for new day (DB reads are done on-demand)
      this.seedDefaultSchedules().catch(err => {
        console.error('[SimulationEngine] Error seeding default schedules:', err)
      })
      // Clean up expired NPC facts
      this.cleanupExpiredNPCFacts(currentDay)
      // Reset all NPCs to home positions
      this.npcSimulator.resetAllToHome()
      console.log('[SimulationEngine] NPCs reset to home positions')

      // Expire old commitments and load new day's commitments
      this.commitmentManager.expireOldCommitments(currentDay).catch(err => {
        console.error('[SimulationEngine] Error expiring commitments:', err)
      })
      this.commitmentManager.loadCommitmentsForDay(currentDay).catch(err => {
        console.error('[SimulationEngine] Error loading commitments:', err)
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

    // Update NPC simulations (movement)
    this.npcSimulator.tick(deltaTime)

    // Process NPC commitments (trigger NPC movement to meeting locations)
    this.processCommitments()

    // Check for pending actions after movement completes
    this.checkPendingActions()

    // Increment tick counter
    this.worldState.incrementTick()

    // Periodic state persistence (every 30 seconds)
    if (this.stateStore && now - this.lastSaveTime >= SAVE_INTERVAL_MS) {
      this.saveState().catch(err => {
        console.error('[SimulationEngine] Error saving state:', err)
      })
      // Update active action progress (stats snapshot)
      this.updateActiveActionsProgress().catch(err => {
        console.error('[SimulationEngine] Error updating active actions:', err)
      })
      // Delete expired mid-term memories from DB
      this.cleanupExpiredMidTermMemories(realTime.day).catch(err => {
        console.error('[SimulationEngine] Error cleaning up mid-term memories:', err)
      })
      // Delete old chat messages (7 days retention)
      this.cleanupOldChatMessages().catch(err => {
        console.error('[SimulationEngine] Error cleaning up old chat messages:', err)
      })
      // Save NPC positions
      this.saveNPCPositions().catch(err => {
        console.error('[SimulationEngine] Error saving NPC positions:', err)
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

  // Compute midnight (0:00) of server start date in configured timezone
  private computeServerStartMidnight(): number {
    if (!this.cachedFormatter) {
      this.updateFormatterCache()
    }
    const startDate = new Date(this.serverStartTime)
    const parts = this.cachedFormatter!.formatToParts(startDate)
    const hour = Number(parts.find(p => p.type === 'hour')?.value ?? 0)
    const minute = Number(parts.find(p => p.type === 'minute')?.value ?? 0)
    return this.serverStartTime - (hour * 60 + minute) * 60 * 1000
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

    // Calculate days since midnight of server start date (timezone-aware)
    const msPerDay = 24 * 60 * 60 * 1000
    const day = Math.floor((now.getTime() - this.serverStartMidnight) / msPerDay) + 1

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
      const newFitness = calculateStatChange(
        char.fitness, decayRates.fitnessPerMinute, elapsedMinutes, perMinuteEffects?.fitness
      )

      // お金の計算（perMinuteEffects.money がある場合）
      const newMoney = perMinuteEffects?.money !== undefined
        ? char.money + Math.floor(perMinuteEffects.money * elapsedMinutes)
        : char.money

      // Update character stats
      this.worldState.updateCharacter(char.id, {
        satiety: newSatiety,
        bladder: newBladder,
        energy: newEnergy,
        hygiene: newHygiene,
        mood: newMood,
        fitness: newFitness,
        ...(newMoney !== char.money ? { money: newMoney } : {}),
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
           character.conversation?.status !== 'active' &&
           !character.navigation.isMoving
  }

  // Helper: Increment action counter and check for system auto-action
  // Returns true if auto-action was triggered (caller should skip normal decision)
  private incrementActionCounterAndCheck(character: SimCharacter): boolean {
    const newCounter = character.actionCounter + 1
    this.worldState.updateCharacter(character.id, { actionCounter: newCounter })

    // Check for system auto-action (every N actions)
    if (this.checkSystemAutoAction(character, newCounter)) {
      return true // auto-action triggered
    }
    return false
  }

  // Callback when action completes (triggers next behavior decision)
  private onActionComplete(characterId: string): void {
    const character = this.worldState.getCharacter(characterId)
    if (!character) return
    if (this.pendingDecisions.has(characterId)) return
    if (!this.isCharacterIdle(character)) return

    // Use helper method to increment counter and check auto-action
    if (this.incrementActionCounterAndCheck(character)) {
      return // auto-action triggered
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

    // Pure move completed - increment counter and check auto-action
    if (this.incrementActionCounterAndCheck(character)) {
      return // auto-action triggered
    }

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

  // Start system auto-action (move to a target map)
  private startSystemAutoAction(character: SimCharacter, targetMapId: string): boolean {
    const targetMap = this.worldState.getMap(targetMapId)
    if (!targetMap?.spawnNodeId) {
      console.log(`[SimulationEngine] System auto-action failed: no spawn node for map ${targetMapId}`)
      return false
    }

    const success = this.characterSimulator.navigateToMap(
      character.id,
      targetMapId,
      targetMap.spawnNodeId
    )

    if (success) {
      // Set flag to disable 'talk' action after system auto-action completes
      this.worldState.updateCharacter(character.id, { afterSystemAutoAction: true })
      console.log(`[SimulationEngine] System auto-action: ${character.name} -> ${targetMapId}`)
    } else {
      console.log(`[SimulationEngine] System auto-action failed: ${character.name} -> ${targetMapId}`)
    }

    return success
  }

  // Check and execute system auto-action (called after action/move/idle completion)
  private checkSystemAutoAction(character: SimCharacter, actionCounter: number): boolean {
    // Not yet at interval threshold
    if (actionCounter < SimulationEngine.SYSTEM_AUTO_ACTION_INTERVAL) {
      return false
    }

    // Status interrupt active (any status < 10%) - skip auto-action but count progresses
    // Don't reset counter - will check again after interrupt is resolved
    if (this.hasLowStatus(character)) {
      console.log(`[SimulationEngine] System auto-action skipped (status interrupt): ${character.name}`)
      return false
    }

    // Reset counter (regardless of whether auto-action succeeds)
    this.worldState.updateCharacter(character.id, { actionCounter: 0 })

    // Select random nearby map (within 3 hops)
    const targetMapId = this.selectRandomNearbyMap(character.currentMapId)
    if (!targetMapId) {
      console.log(`[SimulationEngine] System auto-action skipped (no nearby maps): ${character.name}`)
      return false
    }

    // Start navigation to target map
    return this.startSystemAutoAction(character, targetMapId)
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
  private async buildBehaviorContext(character: SimCharacter, includeTodayActions: boolean = true): Promise<BehaviorContext> {
    const currentTime = this.worldState.getTime()

    // Calculate current world time in minutes for cooldown calculation
    const currentTimeMinutes = currentTime.day * 24 * 60 + currentTime.hour * 60 + currentTime.minute

    // Load data from DB (parallel for performance)
    const [recentConversations, todayActions, schedule, midTermMemories, chatSummaries] = await Promise.all([
      this.getRecentConversationsFromDB(character.id),
      this.getActionHistoryFromDB(character.id),
      this.getScheduleFromDB(character.id),
      this.getMidTermMemoriesFromDB(character.id),
      this.chatEnabled && this.stateStore
        ? this.stateStore.loadChatSummariesForCharacter(character.id)
        : Promise.resolve(undefined),
    ])

    // Get NPCs on current map with cooldown info
    const allNPCs = this.worldState.getNPCsOnMap(character.currentMapId)
    const npcsWithCooldown = addCooldownInfoToNPCs(allNPCs, recentConversations, currentTimeMinutes)

    // Get available actions, remove 'talk' if no NPCs on current map
    let availableActions = this.actionExecutor.getAvailableActions(character.id)
    if (npcsWithCooldown.length === 0) {
      availableActions = availableActions.filter(action => action !== 'talk')
    }

    // Chat context (calculated before filter so chat actions can be included in filter)
    const hasPendingChat = this.hasPendingChatNotifications(character.id)
    const pendingChatNotifications = hasPendingChat
      ? this.getPendingChatNotifications(character.id)
      : undefined

    // Add chat actions to available actions (before filter so consecutive limit applies)
    if (this.chatEnabled) {
      if (hasPendingChat) {
        availableActions.push('reply_chat')
      } else {
        // 未読通知がない場合のみcheck_chatを提示
        availableActions.push('check_chat')
      }
      // send_chat requires more context, add only if there are chat summaries
      if (chatSummaries && chatSummaries.length > 0) {
        availableActions.push('send_chat')
      }
    }

    // Apply consecutive action limit filter (now includes chat actions)
    availableActions = this.filterActionsByConsecutiveLimit(availableActions, todayActions)

    // After system auto-action, don't allow pure 'move' action (which would trigger another behavior decision)
    // But allow nearbyFacilities (action + move is atomic, no talk can occur in between)
    const nearbyMaps = character.afterSystemAutoAction ? [] : this.buildNearbyMaps(character.currentMapId)

    return {
      character,
      currentTime,
      currentFacility: this.actionExecutor.getCurrentFacility(character.id),
      schedule,
      availableActions,
      nearbyNPCs: npcsWithCooldown,
      currentMapFacilities: this.buildCurrentMapFacilities(character.currentMapId),
      nearbyFacilities: this.buildNearbyFacilities(character.currentMapId),
      nearbyMaps,
      recentConversations: filterForBehaviorDecision(recentConversations),
      midTermMemories,
      todayActions: includeTodayActions ? todayActions : undefined,
      // Chat context
      hasPendingChat,
      pendingChatNotifications,
      chatSummaries,
    }
  }

  /**
   * Apply a behavior decision (shared logic for normal and interrupt decisions)
   */
  private async applyBehaviorDecision(
    character: SimCharacter,
    decision: BehaviorDecision,
    logContext: string
  ): Promise<void> {
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
        if (moveSuccess) {
          this.recordActionHistory({
            characterId: character.id,
            actionId: 'move',
            reason: decision.reason,
            target: decision.targetMapId ?? decision.targetNodeId,
          })
        } else {
          this.scheduleNextDecision(character.id, 1000)
        }
        break
      }

      case 'idle': {
        // Different emoji for interrupt vs normal idle
        const isInterrupt = logContext === 'interrupt'
        this.worldState.updateCharacter(character.id, {
          displayEmoji: isInterrupt ? SPECIAL_EMOJI.interrupt : SPECIAL_EMOJI.idle,
        })
        // Check if this is a new idle (not a retry)
        const history = await this.getActionHistoryFromDB(character.id)
        const lastEntry = history[history.length - 1]
        const isNewIdle = !lastEntry || lastEntry.actionId !== 'idle'

        if (isNewIdle) {
          // Record idle only on first occurrence (prevents spam from 2s retry)
          this.recordActionHistory({
            characterId: character.id,
            actionId: 'idle',
            reason: decision.reason,
          })
          // Increment counter for new idle (counts as a "cycle")
          if (this.incrementActionCounterAndCheck(character)) {
            return // auto-action triggered
          }
        }
        // Longer retry for interrupt (emergency with no solution)
        this.scheduleNextDecision(character.id, isInterrupt ? 5000 : 2000)
        break
      }
    }
  }

  // Make interrupt behavior decision (forced action, LLM selects facility only)
  private async makeInterruptBehaviorDecision(character: SimCharacter, forcedAction: string): Promise<void> {
    this.pendingDecisions.add(character.id)
    this.actionExecutor.startAction(character.id, 'thinking')

    const context = await this.buildBehaviorContext(character, false)

    this.behaviorDecider.decideInterruptFacility(forcedAction, context).then(async (decision) => {
      this.actionExecutor.forceCompleteAction(character.id)

      const currentChar = this.worldState.getCharacter(character.id)
      if (!currentChar || !this.isCharacterIdle(currentChar)) return

      console.log(`[SimulationEngine] Interrupt decision for ${character.name}: ${decision.type} (${decision.reason})`)
      await this.applyBehaviorDecision(currentChar, decision, 'interrupt')

      // Reset afterSystemAutoAction flag after decision is applied
      if (currentChar.afterSystemAutoAction) {
        this.worldState.updateCharacter(character.id, { afterSystemAutoAction: false })
      }
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
  private async makeBehaviorDecision(character: SimCharacter, _currentTime: WorldTime): Promise<void> {
    this.pendingDecisions.add(character.id)
    this.actionExecutor.startAction(character.id, 'thinking')

    const context = await this.buildBehaviorContext(character, true)

    this.behaviorDecider.decide(context).then(async (decision) => {
      this.actionExecutor.forceCompleteAction(character.id)

      const currentChar = this.worldState.getCharacter(character.id)
      if (!currentChar || !this.isCharacterIdle(currentChar)) return

      await this.applyBehaviorDecision(currentChar, decision, 'normal')

      // Reset afterSystemAutoAction flag after decision is applied
      if (currentChar.afterSystemAutoAction) {
        this.worldState.updateCharacter(character.id, { afterSystemAutoAction: false })
      }

      // Apply schedule update if LLM proposed one
      if (decision.scheduleUpdate) {
        await this.applyScheduleUpdate(character.id, decision.scheduleUpdate)
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
      const { actionId, facilityId, targetNpcId, reason, durationMinutes, conversationGoal } = character.pendingAction

      // Clear pending action first
      this.worldState.updateCharacter(character.id, { pendingAction: null })

      // Try to execute the action
      const success = this.actionExecutor.startAction(character.id, actionId, facilityId, targetNpcId, durationMinutes, reason)
      if (success) {
        const durationStr = durationMinutes !== undefined ? ` (${durationMinutes}min)` : ''
        if (targetNpcId) {
          this.faceEachOtherForTalk(character.id, targetNpcId)
          if (actionId === 'talk') {
            const goal = conversationGoal ?? { goal: reason ?? '会話する', successCriteria: '' }
            this.startConversationWithExecutor(character.id, targetNpcId, goal)
          }
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

    // Handle chat actions (async, fire-and-forget with error handling)
    // send_chat の場合、targetFacilityId はチャンネル名として使われる
    if (actionId === 'reply_chat' || actionId === 'check_chat' || actionId === 'send_chat') {
      this.handleChatAction(character, actionId, reason, targetFacilityId).catch(error => {
        console.error(`[SimulationEngine] Chat action error for ${character.name}:`, error)
        this.actionExecutor.forceCompleteAction(character.id)
        this.triggerActionDecision(character)
      })
      return
    }

    // Handle talk action with NPC target
    if (actionId === 'talk' && targetNpcId) {
      this.handleTalkAction(character, targetNpcId, reason, decision.conversationGoal)
      return
    }

    // Handle facility-based actions
    this.handleFacilityAction(character, actionId, targetFacilityId, reason, durationMinutes)
  }

  // Handle chat actions: reply_chat, check_chat, send_chat
  private async handleChatAction(character: SimCharacter, actionId: ActionId, reason?: string, targetChannelName?: string): Promise<void> {
    if (!this.chatEnabled || !this.chatManager || !this.chatExecutor) {
      console.log(`[SimulationEngine] Chat system not available for ${character.name}`)
      this.triggerActionDecision(character)
      return
    }

    // Start the action (thinking-like: fixed duration 0, manually completed)
    // skipCanExecuteCheck=true: チャットアクションの利用可否はSimulationEngineが管理するため
    const success = this.actionExecutor.startAction(character.id, actionId, undefined, undefined, undefined, reason, true)
    if (!success) {
      console.log(`[SimulationEngine] ${character.name} failed to start ${actionId}`)
      this.triggerActionDecision(character)
      return
    }

    // Set up state store for executor
    if (this.stateStore) {
      this.chatExecutor.setStateStore(this.stateStore)
    }
    if (this.chatPostProcessor) {
      this.chatExecutor.setPostProcessor(this.chatPostProcessor)
    }

    // Load context data from DB (parallel for performance)
    const [recentConversations, midTermMemories, todayActions, schedule, chatSummaries] = await Promise.all([
      this.getRecentConversationsFromDB(character.id),
      this.getMidTermMemoriesFromDB(character.id),
      this.getActionHistoryFromDB(character.id),
      this.getScheduleFromDB(character.id),
      this.stateStore?.loadChatSummariesForCharacter(character.id) ?? Promise.resolve(undefined),
    ])

    // Build chat context (NPC conversations use filterLatestPerNPC - all NPCs with 1 message each)
    const chatContext: ChatContext = {
      currentTime: this.worldState.getTime(),
      todayActions,
      schedule,
      midTermMemories,
      recentConversations: filterLatestPerNPC(recentConversations),
      chatSummaries,
      nearbyMaps: this.buildNearbyMaps(character.currentMapId),
    }

    // Handle each chat action type
    if (actionId === 'reply_chat') {
      // Get the oldest pending notification
      const notification = this.chatManager.getOldestNotification(character.id)
      if (!notification) {
        console.log(`[SimulationEngine] ${character.name} no pending chat to reply`)
        this.actionExecutor.forceCompleteAction(character.id)
        this.triggerActionDecision(character)
        return
      }

      // Start reply session
      const session = this.chatManager.startReplySession(character.id, notification)
      console.log(`[SimulationEngine] ${character.name} replying to chat from ${notification.senderName}`)

      // Execute asynchronously with context
      this.chatExecutor.executeReply(character, session, chatContext)

    } else if (actionId === 'check_chat') {
      // For check_chat, we need a target channel
      // For now, use the first pending notification's channel or skip
      const notifications = this.chatManager.getPendingNotifications(character.id)
      if (notifications.length === 0) {
        console.log(`[SimulationEngine] ${character.name} no chat to check`)
        this.actionExecutor.forceCompleteAction(character.id)
        this.triggerActionDecision(character)
        return
      }

      const firstNotification = notifications[0]
      const session = this.chatManager.startCheckSession(
        character.id,
        firstNotification.providerId,
        firstNotification.channelId,
        firstNotification.channelName
      )
      console.log(`[SimulationEngine] ${character.name} checking chat on ${firstNotification.channelName}`)

      // Execute asynchronously with context
      this.chatExecutor.executeCheck(character, session, chatContext)

    } else if (actionId === 'send_chat') {
      // send_chat: LLMが指定したチャンネルに自発的にメッセージを送信
      if (!reason) {
        console.log(`[SimulationEngine] ${character.name} send_chat requires reason as intent`)
        this.actionExecutor.forceCompleteAction(character.id)
        this.triggerActionDecision(character)
        return
      }

      if (!targetChannelName) {
        console.log(`[SimulationEngine] ${character.name} send_chat requires target channel name`)
        this.actionExecutor.forceCompleteAction(character.id)
        this.triggerActionDecision(character)
        return
      }

      // chatSummaries からチャンネル情報を検索
      const targetChannel = chatSummaries?.find(s => s.channelName === targetChannelName)
      if (!targetChannel) {
        console.log(`[SimulationEngine] ${character.name} channel not found: ${targetChannelName}`)
        this.actionExecutor.forceCompleteAction(character.id)
        this.triggerActionDecision(character)
        return
      }

      const session = this.chatManager.startSendSession(
        character.id,
        targetChannel.providerId,
        targetChannel.channelId,
        targetChannel.channelName,
        reason  // intent
      )
      console.log(`[SimulationEngine] ${character.name} sending to ${targetChannel.channelName}: ${reason}`)

      // Execute asynchronously with context
      this.chatExecutor.executeSend(character, session, chatContext)
    }
  }

  // Callback when chat action completes
  private onChatActionComplete(characterId: string, _success: boolean): void {
    // Force complete the action and trigger next decision
    this.actionExecutor.forceCompleteAction(characterId)
    this.onActionComplete(characterId)
  }

  // Receive chat message from external webhook
  receiveExternalChatMessage(message: ChatIncomingMessage): void {
    if (!this.chatEnabled || !this.chatManager) {
      console.log('[SimulationEngine] Chat system not available, ignoring message')
      return
    }

    // Save message to DB
    if (this.stateStore) {
      this.stateStore.saveChatMessage({
        providerId: message.providerId,
        channelId: message.channelId,
        channelName: message.channelName,
        messageId: message.messageId,
        senderId: message.senderId,
        senderName: message.senderName,
        content: message.content,
        isFromCharacter: false,
        timestamp: message.timestamp,
        createdAt: Date.now(),
      }).catch(err => {
        console.error('[SimulationEngine] Failed to save chat message:', err)
      })
    }

    // Get characters for this channel
    const characterIds = getCharactersForChannel(message.providerId, message.channelId)

    // Queue notification if this is a mention or DM
    if (message.isMention || message.isDM) {
      for (const characterId of characterIds) {
        // Check if character exists
        const character = this.worldState.getCharacter(characterId)
        if (!character) {
          console.log(`[SimulationEngine] Character ${characterId} not found for chat notification`)
          continue
        }

        this.chatManager.queueNotification(characterId, message)
        console.log(`[SimulationEngine] Queued chat notification for ${character.name} from ${message.senderName}`)
      }
    }
  }

  // Check if character has pending chat notifications
  hasPendingChatNotifications(characterId: string): boolean {
    if (!this.chatEnabled || !this.chatManager) return false
    return this.chatManager.hasPendingNotifications(characterId)
  }

  // Get pending chat notifications for a character
  getPendingChatNotifications(characterId: string): PendingNotification[] {
    if (!this.chatEnabled || !this.chatManager) return []
    return this.chatManager.getPendingNotifications(characterId)
  }

  // Get chat summaries for a character (for LLM context)
  async getChatSummariesForCharacter(characterId: string): Promise<ChatSummary[]> {
    if (!this.stateStore) return []
    return await this.stateStore.loadChatSummariesForCharacter(characterId)
  }

  // Check if chat feature is enabled
  isChatFeatureEnabled(): boolean {
    return this.chatEnabled
  }

  // Handle talk action: move to NPC if not adjacent, then start talk
  private handleTalkAction(character: SimCharacter, targetNpcId: string, reason?: string, conversationGoal?: ConversationGoal): void {
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
        this.faceEachOtherForTalk(character.id, targetNpcId)
        const goal = conversationGoal ?? { goal: reason ?? '会話する', successCriteria: '' }
        this.startConversationWithExecutor(character.id, targetNpcId, goal)
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
      conversationGoal,
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

  // Make character and NPC face each other when starting a talk action
  private faceEachOtherForTalk(characterId: string, npcId: string): void {
    const character = this.worldState.getCharacter(characterId)
    const npc = this.worldState.getNPC(npcId)
    if (!character || !npc) return

    const charToNpcDirection = getDirection(character.position, npc.position)
    this.worldState.updateCharacterDirection(characterId, charToNpcDirection)

    const opposites = { up: 'down', down: 'up', left: 'right', right: 'left' } as const
    this.worldState.updateNPCDirection(npcId, opposites[charToNpcDirection])
  }

  // Start conversation session and execute conversation loop
  private async startConversationWithExecutor(characterId: string, npcId: string, goal: ConversationGoal): Promise<void> {
    const session = this.conversationManager.startConversation(characterId, npcId, goal)
    if (!session) {
      console.log(`[SimulationEngine] Failed to start conversation for ${characterId}`)
      // Force complete the talk action since conversation couldn't start
      this.actionExecutor.forceCompleteAction(characterId)
      this.onActionComplete(characterId)
      return
    }

    const character = this.worldState.getCharacter(characterId)
    const npc = this.fullNPCs.get(npcId)
    if (!character || !npc) {
      console.log(`[SimulationEngine] Character or NPC not found for conversation`)
      this.conversationManager.endConversation(characterId, false)
      this.actionExecutor.forceCompleteAction(characterId)
      this.onActionComplete(characterId)
      return
    }

    // Load context data from DB (parallel for performance)
    const [recentConversations, midTermMemories, todayActions, schedule, chatSummaries] = await Promise.all([
      this.getRecentConversationsFromDB(characterId),
      this.getMidTermMemoriesFromDB(characterId),
      this.getActionHistoryFromDB(characterId),
      this.getScheduleFromDB(characterId),
      this.chatEnabled && this.stateStore
        ? this.stateStore.loadChatSummariesForCharacter(characterId)
        : Promise.resolve(undefined),
    ])

    // Build conversation context
    const context: ConversationContext = {
      recentConversations: filterForConversation(recentConversations, npcId),
      midTermMemories,
      todayActions,
      schedule,
      currentTime: this.worldState.getTime(),
      nearbyMaps: this.buildNearbyMaps(character.currentMapId),
      chatSummaries,
    }

    // Start async conversation loop (fire and forget)
    this.conversationExecutor.executeConversation(character, npc, session, context)
      .catch(error => {
        console.error(`[SimulationEngine] Conversation execution error:`, error)
      })
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

  // === DB Direct Access Methods ===

  // Get schedule directly from DB
  private async getScheduleFromDB(characterId: string): Promise<ScheduleEntry[] | null> {
    if (!this.stateStore) return null
    const currentDay = this.worldState.getTime().day
    const schedule = await this.stateStore.loadSchedule(characterId, currentDay)
    return schedule?.entries ?? null
  }

  // Get action history directly from DB with limit
  private async getActionHistoryFromDB(characterId: string): Promise<ActionHistoryEntry[]> {
    if (!this.stateStore) return []
    const currentDay = this.worldState.getTime().day
    return await this.stateStore.loadActionHistoryForDay(characterId, currentDay, this.todayActionsLimit)
  }

  // Get mid-term memories directly from DB (expired ones filtered by loadActiveMidTermMemories)
  private async getMidTermMemoriesFromDB(characterId: string): Promise<MidTermMemory[]> {
    if (!this.stateStore) return []
    const currentDay = this.worldState.getTime().day
    return await this.stateStore.loadActiveMidTermMemories(characterId, currentDay)
  }

  // Get recent conversations directly from DB
  private async getRecentConversationsFromDB(characterId: string): Promise<RecentConversation[]> {
    if (!this.stateStore) return []
    const currentDay = this.worldState.getTime().day
    const summaries = await this.stateStore.loadNPCSummariesForDay(currentDay)

    // Filter by character and convert time string to worldTimeMinutes
    return summaries
      .filter(s => s.characterId === characterId)
      .map(entry => {
        let worldTimeMinutes = currentDay * 24 * 60
        if (entry.time) {
          const [hours, minutes] = entry.time.split(':').map(Number)
          worldTimeMinutes = currentDay * 24 * 60 + hours * 60 + minutes
        }
        return {
          npcId: entry.npcId,
          npcName: entry.npcName,
          summary: entry.summary,
          timestamp: worldTimeMinutes,
        }
      })
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
      if (obstacle.facility.actionIds.length === 0) continue

      facilities.push({
        id: obstacle.id,
        label: obstacle.label || obstacle.id,
        actionIds: obstacle.facility.actionIds,
        cost: obstacle.facility.cost,
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
   * マップから施設情報を抽出（共通ヘルパー）
   */
  private extractFacilitiesFromMap(map: WorldMap, mapId: string, distance: number): NearbyFacility[] {
    const facilities: NearbyFacility[] = []
    for (const obstacle of map.obstacles) {
      if (!obstacle.facility) continue
      if (obstacle.facility.actionIds.length === 0) continue

      facilities.push({
        id: obstacle.id,
        label: obstacle.label || obstacle.id,
        actionIds: obstacle.facility.actionIds,
        cost: obstacle.facility.cost,
        quality: obstacle.facility.quality,
        distance,
        mapId,
      })
    }
    return facilities
  }

  /**
   * 他マップの施設を収集（現在マップは除外、distance > 0 のみ）
   * homeマップの施設は、現在位置に関わらず常に含める
   */
  private buildNearbyFacilities(currentMapId: string): NearbyFacility[] {
    const facilities = this.traverseNearbyMaps(currentMapId, (map, mapId, distance) => {
      // 現在マップの施設は除外
      if (distance === 0) return []
      return this.extractFacilitiesFromMap(map, mapId, distance)
    })

    // homeマップの施設を常に含める（現在マップがhomeでなく、BFS結果に含まれていない場合）
    if (currentMapId !== 'home') {
      const homeAlreadyIncluded = facilities.some(f => f.mapId === 'home')
      if (!homeAlreadyIncluded) {
        const homeMap = this.worldState.getMap('home')
        if (homeMap) {
          // distance: 10 - 3ホップより遠いが常に利用可能
          facilities.push(...this.extractFacilitiesFromMap(homeMap, 'home', 10))
        }
      }
    }

    return facilities
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
  private async applyScheduleUpdate(characterId: string, update: ScheduleUpdate): Promise<void> {
    const currentDay = this.worldState.getTime().day

    // Load current schedule from DB
    const schedule = await this.stateStore?.loadSchedule(characterId, currentDay)
    const entries = [...(schedule?.entries ?? [])]

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

    // Persist to DB
    if (this.stateStore) {
      const updatedSchedule: DailySchedule = {
        characterId,
        day: currentDay,
        entries,
      }
      await this.stateStore.saveSchedule(updatedSchedule)
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

  // Record action history (for instant actions: move, idle, talk summary)
  private recordActionHistory(entry: {
    characterId: string
    actionId: string
    facilityId?: string
    targetNpcId?: string
    target?: string
    durationMinutes?: number
    reason?: string
  }): void {
    const currentTime = this.worldState.getTime()
    const currentDay = currentTime.day
    const timeStr = this.formatTimeString(currentTime)
    const target = entry.target ?? entry.facilityId ?? entry.targetNpcId

    // Persist to DB (async, non-blocking) - these are instant actions
    if (this.stateStore) {
      this.stateStore.addActionHistory({
        characterId: entry.characterId,
        day: currentDay,
        time: timeStr,
        actionId: entry.actionId,
        target,
        durationMinutes: entry.durationMinutes,
        reason: entry.reason,
      }).catch(error => {
        console.error(`[SimulationEngine] Error saving action history:`, error)
      })
    }

    console.log(`[SimulationEngine] Recorded action history: ${entry.characterId} ${timeStr} ${entry.actionId}${target ? ` → ${target}` : ''}`)

    // Notify log subscribers (completed status for instant actions)
    this.notifyLogSubscribersAction({
      characterId: entry.characterId,
      actionId: entry.actionId,
      target,
      durationMinutes: entry.durationMinutes,
      reason: entry.reason,
      time: timeStr,
      status: 'completed',
    })
  }

  // Start action history record (for timed actions: eat, sleep, work, etc.)
  private startActionHistoryRecord(entry: {
    characterId: string
    actionId: string
    facilityId?: string
    targetNpcId?: string
    durationMinutes?: number
    reason?: string
    startTimeReal: number
  }): void {
    const currentTime = this.worldState.getTime()
    const currentDay = currentTime.day
    const timeStr = this.formatTimeString(currentTime)
    const target = entry.facilityId ?? entry.targetNpcId

    // Persist to DB (async, non-blocking)
    if (this.stateStore) {
      this.stateStore.startActionHistory({
        characterId: entry.characterId,
        day: currentDay,
        time: timeStr,
        actionId: entry.actionId,
        target,
        durationMinutes: entry.durationMinutes,
        reason: entry.reason,
        startTimeReal: entry.startTimeReal,
      }).then(rowId => {
        // Store rowId for later completion
        this.activeActionRowIds.set(entry.characterId, rowId)
        console.log(`[SimulationEngine] Action started (rowId=${rowId}): ${entry.characterId} ${timeStr} ${entry.actionId}`)
      }).catch(error => {
        console.error(`[SimulationEngine] Error starting action history:`, error)
      })
    }

    // Notify log subscribers (started status)
    this.notifyLogSubscribersAction({
      characterId: entry.characterId,
      actionId: entry.actionId,
      target,
      durationMinutes: entry.durationMinutes,
      reason: entry.reason,
      time: timeStr,
      status: 'started',
    })
  }

  // Complete action history record (for timed actions)
  private completeActionHistoryRecord(entry: {
    characterId: string
    actionId: string
    facilityId?: string
    targetNpcId?: string
    durationMinutes?: number
    reason?: string
  }): void {
    const currentTime = this.worldState.getTime()
    const currentDay = currentTime.day
    const timeStr = this.formatTimeString(currentTime)
    const target = entry.facilityId ?? entry.targetNpcId

    // Complete in DB using stored rowId
    const rowId = this.activeActionRowIds.get(entry.characterId)
    if (rowId && this.stateStore) {
      this.stateStore.completeActionHistory(rowId, timeStr)
        .then(() => {
          this.activeActionRowIds.delete(entry.characterId)
          console.log(`[SimulationEngine] Action completed (rowId=${rowId}): ${entry.characterId} ${timeStr} ${entry.actionId}`)
        })
        .catch(error => {
          console.error(`[SimulationEngine] Error completing action history:`, error)
        })
    } else {
      // Fallback: if no rowId (e.g., restored action), use legacy API
      if (this.stateStore) {
        this.stateStore.addActionHistory({
          characterId: entry.characterId,
          day: currentDay,
          time: timeStr,
          actionId: entry.actionId,
          target,
          durationMinutes: entry.durationMinutes,
          reason: entry.reason,
        }).catch(error => {
          console.error(`[SimulationEngine] Error saving action history (fallback):`, error)
        })
      }
    }

    // Notify log subscribers (completed status)
    this.notifyLogSubscribersAction({
      characterId: entry.characterId,
      actionId: entry.actionId,
      target,
      durationMinutes: entry.durationMinutes,
      reason: entry.reason,
      time: timeStr,
      status: 'completed',
    })

    // Trigger mini episode generation (async, non-blocking)
    const facility = this.actionExecutor.getCurrentFacility(entry.characterId)
    this.generateMiniEpisode(entry.characterId, entry.actionId as ActionId, facility, timeStr, currentDay)
      .catch(error => {
        console.error('[SimulationEngine] Error in generateMiniEpisode:', error)
      })
  }

  // Generate mini episode after action completion (async)
  private async generateMiniEpisode(
    characterId: string,
    actionId: ActionId,
    facility: import('@/types').FacilityInfo | null,
    time: string,
    day: number
  ): Promise<void> {
    const character = this.worldState.getCharacter(characterId)
    if (!character) return

    const result = await this.miniEpisodeGenerator.generate(character, actionId, facility)
    if (!result) return

    // Apply stat changes (clamp each to 0-100)
    if (Object.keys(result.statChanges).length > 0) {
      const currentChar = this.worldState.getCharacter(characterId)
      if (!currentChar) return

      const statUpdates: Partial<Record<'satiety' | 'energy' | 'hygiene' | 'mood' | 'bladder', number>> = {}
      for (const [key, value] of Object.entries(result.statChanges)) {
        const stat = key as keyof typeof statUpdates
        statUpdates[stat] = Math.max(0, Math.min(100, currentChar[stat] + value))
      }
      this.worldState.updateCharacter(characterId, statUpdates)
    }

    // Update DB
    if (this.stateStore) {
      this.stateStore.updateActionHistoryEpisode(characterId, day, time, result.episode)
        .catch(error => {
          console.error('[SimulationEngine] Error updating episode in DB:', error)
        })
    }

    // Notify log subscribers
    this.notifyLogSubscribersMiniEpisode(characterId, actionId, result.episode, result.statChanges, time)
  }

  // Notify log subscribers with mini episode
  private notifyLogSubscribersMiniEpisode(
    characterId: string,
    actionId: string,
    episode: string,
    statChanges: Record<string, number>,
    time: string
  ): void {
    const character = this.worldState.getCharacter(characterId)
    this.emitLogEntry({
      type: 'mini_episode',
      characterId,
      characterName: character?.name ?? characterId,
      time,
      actionId,
      episode,
      statChanges,
    })
  }

  /**
   * Count consecutive trailing occurrences of a specific action from the end of history
   */
  private countConsecutiveTrailingAction(
    actions: ActionHistoryEntry[],
    actionId: string
  ): number {
    let count = 0
    for (let i = actions.length - 1; i >= 0; i--) {
      if (actions[i].actionId === actionId) {
        count++
      } else {
        break
      }
    }
    return count
  }

  /**
   * Filter available actions based on consecutive execution limit
   */
  private filterActionsByConsecutiveLimit(
    availableActions: ActionId[],
    todayActions: ActionHistoryEntry[]
  ): ActionId[] {
    return availableActions.filter(action => {
      const consecutiveCount = this.countConsecutiveTrailingAction(todayActions, action)
      return consecutiveCount < this.maxConsecutiveSameAction
    })
  }

  // Update active action progress in DB (30秒ごと)
  private async updateActiveActionsProgress(): Promise<void> {
    if (!this.stateStore) return

    for (const [characterId, rowId] of this.activeActionRowIds) {
      const character = this.worldState.getCharacter(characterId)
      if (!character) continue

      const statsSnapshot = {
        satiety: character.satiety,
        energy: character.energy,
        hygiene: character.hygiene,
        mood: character.mood,
        bladder: character.bladder,
        fitness: character.fitness,
        money: character.money,
      }

      try {
        await this.stateStore.updateActiveActionProgress(rowId, statsSnapshot)
      } catch (error) {
        console.error(`[SimulationEngine] Error updating active action progress for ${characterId}:`, error)
      }
    }
  }

  // Delete expired mid-term memories from DB
  private async cleanupExpiredMidTermMemories(currentDay: number): Promise<void> {
    if (!this.stateStore) return

    const deleted = await this.stateStore.deleteExpiredMidTermMemories(currentDay)
    if (deleted > 0) {
      console.log(`[SimulationEngine] Deleted ${deleted} expired mid-term memories`)
    }
  }

  // Delete old chat messages from DB (7 days retention)
  private async cleanupOldChatMessages(): Promise<void> {
    if (!this.stateStore) return

    const deleted = await this.stateStore.deleteOldChatMessages(7)
    if (deleted > 0) {
      console.log(`[SimulationEngine] Deleted ${deleted} old chat messages`)
    }
  }

  // Restore active actions from DB (called on startup)
  async restoreActiveActions(): Promise<void> {
    if (!this.stateStore) return

    const activeActions = await this.stateStore.loadActiveActions()
    const now = Date.now()

    for (const entry of activeActions) {
      const character = this.worldState.getCharacter(entry.characterId)
      if (!character) {
        // Character doesn't exist anymore, complete the action
        await this.stateStore.completeActionHistory(entry.rowId, entry.time, undefined)
        console.log(`[SimulationEngine] Orphan active action completed: rowId=${entry.rowId}`)
        continue
      }

      // Calculate target end time based on duration
      const durationMs = (entry.durationMinutes ?? 0) * 60 * 1000
      const targetEndTime = entry.startTimeReal + durationMs

      if (now >= targetEndTime) {
        // Action should have ended - complete it
        const currentTime = this.worldState.getTime()
        const endTimeStr = this.formatTimeString(currentTime)
        await this.stateStore.completeActionHistory(entry.rowId, endTimeStr, undefined)
        console.log(`[SimulationEngine] Expired active action completed: ${character.name} ${entry.actionId} (rowId=${entry.rowId})`)

        // Notify log subscribers (completed status)
        this.notifyLogSubscribersAction({
          characterId: entry.characterId,
          actionId: entry.actionId,
          target: entry.target,
          durationMinutes: entry.durationMinutes,
          reason: entry.reason,
          time: endTimeStr,
          status: 'completed',
        })
      } else {
        // Action still in progress - restore it
        const actionState = {
          actionId: entry.actionId as ActionId,
          startTime: entry.startTimeReal,
          targetEndTime,
          facilityId: entry.target,
          durationMinutes: entry.durationMinutes,
          reason: entry.reason,
        }

        // displayEmoji も復元
        const emoji = getActionEmoji(entry.actionId as ActionId)

        this.worldState.updateCharacter(entry.characterId, {
          currentAction: actionState,
          displayEmoji: emoji || undefined,
        })
        this.activeActionRowIds.set(entry.characterId, entry.rowId)

        const remainingMs = targetEndTime - now
        const remainingMin = Math.ceil(remainingMs / 60000)
        console.log(`[SimulationEngine] Restored active action: ${character.name} ${entry.actionId} (${remainingMin}min remaining, rowId=${entry.rowId})`)
        // Note: Log notification not needed here - getTodayLogs() includes in-progress actions
      }
    }
  }

  // Get today's logs from DB (for initial load)
  async getTodayLogs(): Promise<ActivityLogEntry[]> {
    const currentDay = this.worldState.getTime().day
    const logs: ActivityLogEntry[] = []

    // Collect action logs from DB (completed actions)
    if (this.stateStore) {
      const characters = this.worldState.getAllCharacters()
      for (const character of characters) {
        try {
          const history = await this.stateStore.loadActionHistoryForDay(character.id, currentDay)
          for (const entry of history) {
            logs.push({
              type: 'action',
              characterId: character.id,
              characterName: character.name,
              time: entry.time,
              actionId: entry.actionId,
              target: entry.target,
              durationMinutes: entry.durationMinutes,
              reason: entry.reason,
            })
          }
        } catch (error) {
          console.error(`[SimulationEngine] Error loading action history for ${character.id}:`, error)
        }
      }
    }

    // Collect in-progress actions from current character state
    for (const character of this.worldState.getAllCharacters()) {
      if (character.currentAction) {
        const action = character.currentAction
        logs.push({
          type: 'action',
          characterId: character.id,
          characterName: character.name,
          time: this.formatTimeString(this.worldState.getTime()),
          actionId: action.actionId,
          target: action.facilityId,
          durationMinutes: action.durationMinutes,
          reason: action.reason,
          status: 'started',
        })
      }
    }

    // Collect conversation logs from DB
    if (this.stateStore) {
      try {
        const summaries = await this.stateStore.loadNPCSummariesForDay(currentDay)
        for (const s of summaries) {
          const character = this.worldState.getCharacter(s.characterId)
          logs.push({
            type: 'conversation',
            characterId: s.characterId,
            characterName: character?.name ?? s.characterId,
            time: s.time ?? '',
            npcId: s.npcId,
            npcName: s.npcName,
            summary: s.summary,
            topics: s.topics,
            goalAchieved: s.goalAchieved,
            affinityChange: s.affinityChange,
            npcMood: s.mood,
          })
        }
      } catch (error) {
        console.error('[SimulationEngine] Error loading NPC summaries for today:', error)
      }
    }

    // Sort by time
    logs.sort((a, b) => a.time.localeCompare(b.time))
    return logs
  }

  // Format WorldTime as "HH:MM" string
  private formatTimeString(time: WorldTime): string {
    return `${String(time.hour).padStart(2, '0')}:${String(time.minute).padStart(2, '0')}`
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

  // Subscribe to log events
  subscribeToLogs(callback: LogEventCallback): () => void {
    this.logSubscribers.add(callback)
    return () => {
      this.logSubscribers.delete(callback)
    }
  }

  // Dispatch a log entry to all log subscribers
  private emitLogEntry(logEntry: ActivityLogEntry): void {
    if (this.logSubscribers.size === 0) return
    for (const callback of this.logSubscribers) {
      try { callback(logEntry) } catch { /* ignore */ }
    }
  }

  // Notify log subscribers with action log entry
  private notifyLogSubscribersAction(entry: {
    characterId: string
    actionId: string
    target?: string
    durationMinutes?: number
    reason?: string
    time: string
    status?: 'started' | 'completed'
  }): void {
    const character = this.worldState.getCharacter(entry.characterId)
    this.emitLogEntry({
      type: 'action',
      characterId: entry.characterId,
      characterName: character?.name ?? entry.characterId,
      time: entry.time,
      actionId: entry.actionId,
      target: entry.target,
      durationMinutes: entry.durationMinutes,
      reason: entry.reason,
      status: entry.status,
    })
  }

  // Notify log subscribers with conversation summary
  private notifyLogSubscribersConversation(entry: ConversationSummaryEntry): void {
    const character = this.worldState.getCharacter(entry.characterId)
    this.emitLogEntry({
      type: 'conversation',
      characterId: entry.characterId,
      characterName: character?.name ?? entry.characterId,
      time: entry.time ?? '',
      npcId: entry.npcId,
      npcName: entry.npcName,
      summary: entry.summary,
      topics: entry.topics,
      goalAchieved: entry.goalAchieved,
      affinityChange: entry.affinityChange,
      npcMood: entry.mood,
    })
  }

  // Notify log subscribers with conversation message (realtime only)
  private notifyLogSubscribersMessage(
    characterId: string,
    npcId: string,
    speaker: 'character' | 'npc',
    speakerName: string,
    utterance: string
  ): void {
    const character = this.worldState.getCharacter(characterId)
    const npc = this.fullNPCs.get(npcId)
    this.emitLogEntry({
      type: 'conversation_message',
      characterId,
      characterName: character?.name ?? characterId,
      npcId,
      npcName: npc?.name ?? npcId,
      speaker,
      speakerName,
      utterance,
      time: this.formatTimeString(this.worldState.getTime()),
    })
  }

  // Notify log subscribers of a chat message
  private notifyLogSubscribersChatMessage(
    characterId: string,
    characterName: string,
    providerId: string,
    channelId: string,
    channelName: string,
    senderName: string,
    content: string,
    isFromCharacter: boolean,
    currentTime: WorldTime
  ): void {
    this.emitLogEntry({
      type: 'chat_message',
      characterId,
      characterName,
      providerId,
      channelId,
      channelName,
      senderName,
      content,
      isFromCharacter,
      time: this.formatTimeString(currentTime),
    })
  }

  // Save debug log to DB and emit to subscribers (DEBUG_MODE only)
  private saveAndEmitDebugLog(
    type: 'llm_behavior' | 'conversation_turn',
    characterId: string,
    data: Record<string, unknown>
  ): void {
    if (!isDebugMode()) return

    const currentTime = this.worldState.getTime()
    const time = this.formatTimeString(currentTime)
    const day = currentTime.day

    // Save to DB
    if (this.stateStore) {
      this.stateStore.addDebugLog({
        type,
        characterId,
        day,
        time,
        data,
      }).catch(err => {
        console.error('[SimulationEngine] Error saving debug log:', err)
      })
    }

    // Emit to log subscribers
    const character = this.worldState.getCharacter(characterId)
    if (type === 'llm_behavior') {
      this.emitLogEntry({
        type: 'debug_llm_behavior',
        characterId,
        characterName: character?.name ?? characterId,
        time,
        day,
        stage: data.stage as 'action_decision' | 'facility_selection' | 'interrupt_facility',
        prompt: data.prompt as string,
        response: data.response as string,
        decision: data.decision as string | undefined,
      })
    } else if (type === 'conversation_turn') {
      this.emitLogEntry({
        type: 'debug_conversation_turn',
        characterId,
        characterName: character?.name ?? characterId,
        npcId: data.npcId as string,
        npcName: data.npcName as string,
        time,
        day,
        turn: data.turn as number,
        speaker: data.speaker as 'character' | 'npc',
        prompt: data.prompt as string,
        response: data.response as string,
      })
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
    this.serverStartMidnight = this.computeServerStartMidnight()
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
    // Set turnIntervalMs for ConversationExecutor from talk config
    const talkConfig = configs['talk']
    if (talkConfig?.turnIntervalMs !== undefined) {
      this.conversationExecutor.setTurnIntervalMs(talkConfig.turnIntervalMs)
    }
    console.log(`[SimulationEngine] Action configs set`)
  }

  // Set action restrictions config
  setActionRestrictions(restrictions: import('@/types').ActionRestrictions): void {
    this.maxConsecutiveSameAction = restrictions.maxConsecutiveSameAction
    console.log(`[SimulationEngine] Action restrictions set (maxConsecutiveSameAction: ${this.maxConsecutiveSameAction})`)
  }

  // Set memory config (prompt size limits)
  setMemoryConfig(config: import('@/types').MemoryConfig): void {
    this.todayActionsLimit = config.todayActionsLimit
    this.conversationPostProcessor.setMidTermLimit(config.midTermLimit)
    this.conversationPostProcessor.setFactsLimit(config.factsLimit)
    console.log(`[SimulationEngine] Memory config set (todayActionsLimit: ${this.todayActionsLimit}, midTermLimit: ${config.midTermLimit}, factsLimit: ${config.factsLimit})`)
  }

  // Set mini episode config (creates LLMMiniEpisodeGenerator if LLM is available)
  async setMiniEpisodeConfig(config: MiniEpisodeConfig): Promise<void> {
    const { isLLMAvailable } = await import('../llm')
    if (!isLLMAvailable()) {
      console.log(`[SimulationEngine] LLM not available, using StubMiniEpisodeGenerator`)
      return
    }

    const { LLMMiniEpisodeGenerator } = await import('../episode/LLMMiniEpisodeGenerator')
    this.miniEpisodeGenerator = new LLMMiniEpisodeGenerator(config.probability)
    console.log(`[SimulationEngine] MiniEpisodeGenerator set (probability: ${config.probability})`)
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
        // Fresh initialization - home map is always the initial map
        await engine.initialize(maps, characters, 'home', npcBlockedNodes, npcs, config.time, defaultSchedules)

        // Save server start time on fresh start
        await stateStore.saveServerStartTime(engine.getServerStartTime())
        console.log(`${logPrefix} Initialized with fresh state`)
      }

      // Restore NPC dynamic states from DB
      const npcStates = await stateStore.loadAllNPCStates()
      if (npcStates.size > 0) {
        for (const [npcId, state] of npcStates) {
          engine.restoreNPCState(npcId, state)
        }
        console.log(`${logPrefix} Restored ${npcStates.size} NPC dynamic states`)
      }

      // Set action configs for ActionExecutor and LLMBehaviorDecider
      if (config.actions) {
        engine.setActionConfigs(config.actions)
      }

      // Set action restrictions
      if (config.actionRestrictions) {
        engine.setActionRestrictions(config.actionRestrictions)
      }

      // Set memory config
      if (config.memory) {
        engine.setMemoryConfig(config.memory)
      }

      // Set mini episode config
      if (config.miniEpisode) {
        await engine.setMiniEpisodeConfig(config.miniEpisode)
      }

      // Seed default schedules to DB BEFORE starting engine
      // (DB reads are done on-demand, no cache loading needed)
      await engine.seedDefaultSchedules()
      engine.initializeLastDay()

      // Restore active actions from DB (actions in progress when server stopped)
      await engine.restoreActiveActions()

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
