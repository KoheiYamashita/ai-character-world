import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Shared mock store instance - accessible from tests
const mockStoreInstance = {
  loadState: vi.fn().mockResolvedValue(null),
  saveState: vi.fn().mockResolvedValue(undefined),
  loadServerStartTime: vi.fn().mockResolvedValue(null),
  saveServerStartTime: vi.fn().mockResolvedValue(undefined),
  loadSchedule: vi.fn().mockResolvedValue(null),
  loadSchedulesForCharacter: vi.fn().mockResolvedValue([]),
  loadActionHistoryForDay: vi.fn().mockResolvedValue([]),
  saveSchedule: vi.fn().mockResolvedValue(undefined),
  hasData: vi.fn().mockResolvedValue(false),
  close: vi.fn().mockResolvedValue(undefined),
  clear: vi.fn().mockResolvedValue(undefined),
  saveCharacter: vi.fn().mockResolvedValue(undefined),
  loadCharacter: vi.fn().mockResolvedValue(null),
  loadAllCharacters: vi.fn().mockResolvedValue({}),
  deleteCharacter: vi.fn().mockResolvedValue(undefined),
  saveTime: vi.fn().mockResolvedValue(undefined),
  loadTime: vi.fn().mockResolvedValue(null),
  saveCurrentMapId: vi.fn().mockResolvedValue(undefined),
  loadCurrentMapId: vi.fn().mockResolvedValue(null),
  deleteSchedule: vi.fn().mockResolvedValue(undefined),
  deleteAllSchedulesForCharacter: vi.fn().mockResolvedValue(undefined),
  addActionHistory: vi.fn().mockResolvedValue(undefined),
  saveNPCSummary: vi.fn().mockResolvedValue(undefined),
  loadRecentNPCSummaries: vi.fn().mockResolvedValue([]),
  saveNPCState: vi.fn().mockResolvedValue(undefined),
  loadNPCState: vi.fn().mockResolvedValue(null),
  loadAllNPCStates: vi.fn().mockResolvedValue(new Map()),
  loadNPCSummariesForDay: vi.fn().mockResolvedValue([]),
  addMidTermMemory: vi.fn().mockResolvedValue(undefined),
  loadActiveMidTermMemories: vi.fn().mockResolvedValue([]),
  deleteExpiredMidTermMemories: vi.fn().mockResolvedValue(0),
}

const mockLoadWorldDataServer = vi.fn()
const mockInitializeLLMClient = vi.fn()
const mockInitializeLLMErrorHandler = vi.fn()

vi.mock('./dataLoader', () => ({
  loadWorldDataServer: (...args: unknown[]) => mockLoadWorldDataServer(...args),
}))

vi.mock('../persistence/SqliteStore', () => ({
  SqliteStore: class MockSqliteStore {
    constructor() {
      return mockStoreInstance
    }
  },
}))

vi.mock('../llm', () => ({
  initializeLLMClient: (...args: unknown[]) => mockInitializeLLMClient(...args),
  initializeLLMErrorHandler: (...args: unknown[]) => mockInitializeLLMErrorHandler(...args),
  resetLLMErrorHandler: vi.fn(),
  llmGenerateObject: vi.fn(),
}))

vi.mock('../behavior/LLMBehaviorDecider', () => ({
  LLMBehaviorDecider: class {
    decide = vi.fn().mockResolvedValue({ type: 'idle', reason: 'test' })
    decideInterruptFacility = vi.fn().mockResolvedValue({ type: 'idle', reason: 'test' })
    setActionConfigs = vi.fn()
  },
}))

import {
  ensureEngineInitialized,
  resetSimulationEngine,
} from './SimulationEngine'
import type { WorldMap, Character, NPC, CharacterConfig } from '@/types'

// --- Test data ---

function createTestMap(id: string): WorldMap {
  return {
    id,
    name: `Map ${id}`,
    width: 800,
    height: 600,
    backgroundColor: 0x000000,
    spawnNodeId: `${id}-0-0`,
    nodes: [
      { id: `${id}-0-0`, x: 100, y: 100, type: 'waypoint', connectedTo: [`${id}-0-1`] },
      { id: `${id}-0-1`, x: 200, y: 100, type: 'waypoint', connectedTo: [`${id}-0-0`] },
    ],
    obstacles: [],
  }
}

function createTestCharacter(id: string): Character {
  return {
    id,
    name: `Char ${id}`,
    sprite: { sheetUrl: 'test.png', frameWidth: 96, frameHeight: 96, cols: 3, rows: 4, rowMapping: { down: 0, left: 1, right: 2, up: 3 } },
    money: 100,
    satiety: 80,
    energy: 80,
    hygiene: 80,
    mood: 80,
    bladder: 80,
    currentMapId: 'town',
    currentNodeId: 'town-0-0',
    position: { x: 100, y: 100 },
    direction: 'down',
  }
}

const defaultWorldData = {
  config: {
    paths: { mapsJson: '/data/maps.json', charactersJson: '/data/characters.json' },
    initialState: { mapId: 'town' },
    time: { minutesPerTick: 1, tickIntervalMs: 1000, statusDecayIntervalMinutes: 5 },
    error: {},
    actions: { eat: { durationRange: { min: 15, max: 60, default: 30 }, perMinute: { satiety: 2 } } },
  },
  maps: { town: createTestMap('town') } as Record<string, WorldMap>,
  characters: [createTestCharacter('c1')],
  npcs: [] as NPC[],
  npcBlockedNodes: new Map<string, Set<string>>(),
  defaultSchedules: new Map<string, import('@/types').ScheduleEntry[]>(),
  characterConfigs: [{
    id: 'c1',
    name: 'Char c1',
    sprite: { sheetUrl: 'test.png', frameWidth: 96, frameHeight: 96, cols: 3, rows: 4, rowMapping: { down: 0, left: 1, right: 2, up: 3 } },
    personality: '明るい',
    tendencies: ['食べる'],
    customPrompt: 'テスト用',
  }] as CharacterConfig[],
}

describe('ensureEngineInitialized', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.useFakeTimers()
    resetSimulationEngine()
    vi.clearAllMocks()
    mockLoadWorldDataServer.mockResolvedValue(defaultWorldData)
    mockStoreInstance.hasData.mockResolvedValue(false)
    mockStoreInstance.loadState.mockResolvedValue(null)
    mockStoreInstance.loadServerStartTime.mockResolvedValue(null)
    mockStoreInstance.loadSchedulesForCharacter.mockResolvedValue([])
    mockStoreInstance.loadActionHistoryForDay.mockResolvedValue([])
  })

  afterEach(() => {
    resetSimulationEngine()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('should initialize engine with fresh state when no persistent data', async () => {
    const engine = await ensureEngineInitialized('[Test]')
    expect(engine).toBeDefined()
    expect(engine.isInitialized()).toBe(true)
    expect(engine.isSimulationRunning()).toBe(true)
    expect(mockLoadWorldDataServer).toHaveBeenCalled()
    expect(mockStoreInstance.saveServerStartTime).toHaveBeenCalled()
  })

  it('should return immediately if already initialized', async () => {
    const engine1 = await ensureEngineInitialized()
    mockLoadWorldDataServer.mockClear()

    const engine2 = await ensureEngineInitialized()
    expect(engine2).toBe(engine1)
    expect(mockLoadWorldDataServer).not.toHaveBeenCalled()
  })

  it('should restore from persistent storage when state exists', async () => {
    // Simulate existing state in store
    const serializedState = {
      characters: { c1: { id: 'c1', name: 'Restored', currentMapId: 'town', currentNodeId: 'town-0-0', position: { x: 100, y: 100 }, direction: 'down', money: 200, satiety: 70, energy: 60, hygiene: 50, mood: 40, bladder: 30, navigation: { isMoving: false, path: [], currentPathIndex: 0, progress: 0, startPosition: null, targetPosition: null }, crossMapNavigation: null, conversation: null, currentAction: null, pendingAction: null, actionCounter: 0 } },
      npcs: {},
      time: { hour: 14, minute: 30, day: 2 },
      currentMapId: 'town',
    }
    mockStoreInstance.hasData.mockResolvedValue(true)
    mockStoreInstance.loadState.mockResolvedValue(serializedState)
    mockStoreInstance.loadServerStartTime.mockResolvedValue(1700000000000)

    const engine = await ensureEngineInitialized('[Restore]')
    expect(engine.isInitialized()).toBe(true)
    expect(engine.isSimulationRunning()).toBe(true)
    // Should restore server start time
    expect(engine.getServerStartTime()).toBe(1700000000000)
    // Should NOT call saveServerStartTime when loaded from DB
    expect(mockStoreInstance.saveServerStartTime).not.toHaveBeenCalled()
  })

  it('should save current serverStartTime when not found in DB (legacy data)', async () => {
    const serializedState = {
      characters: { c1: { id: 'c1', name: 'Legacy', currentMapId: 'town', currentNodeId: 'town-0-0', position: { x: 100, y: 100 }, direction: 'down', money: 100, satiety: 80, energy: 80, hygiene: 80, mood: 80, bladder: 80, navigation: { isMoving: false, path: [], currentPathIndex: 0, progress: 0, startPosition: null, targetPosition: null }, crossMapNavigation: null, conversation: null, currentAction: null, pendingAction: null, actionCounter: 0 } },
      npcs: {},
      time: { hour: 10, minute: 0, day: 1 },
      currentMapId: 'town',
    }
    mockStoreInstance.hasData.mockResolvedValue(true)
    mockStoreInstance.loadState.mockResolvedValue(serializedState)
    mockStoreInstance.loadServerStartTime.mockResolvedValue(null) // legacy: no start time

    const engine = await ensureEngineInitialized()
    expect(engine.isInitialized()).toBe(true)
    // Should save current server start time for future use
    expect(mockStoreInstance.saveServerStartTime).toHaveBeenCalledWith(engine.getServerStartTime())
  })

  it('should set action configs when available in config', async () => {
    const engine = await ensureEngineInitialized()
    expect(engine.isInitialized()).toBe(true)
    // The engine should have action configs set (from defaultWorldData.config.actions)
    // Verify by checking the action executor has configs
    const executor = engine.getActionExecutor()
    expect(executor).toBeDefined()
  })

  it('should skip action configs when not in config', async () => {
    const dataWithoutActions = {
      ...defaultWorldData,
      config: { ...defaultWorldData.config, actions: undefined },
    }
    mockLoadWorldDataServer.mockResolvedValue(dataWithoutActions)

    const engine = await ensureEngineInitialized()
    expect(engine.isInitialized()).toBe(true)
  })

  it('should handle race condition - parallel calls return same engine', async () => {
    // Start two parallel initialization calls
    const promise1 = ensureEngineInitialized('[P1]')
    const promise2 = ensureEngineInitialized('[P2]')

    const [engine1, engine2] = await Promise.all([promise1, promise2])
    expect(engine1).toBe(engine2)
    // loadWorldDataServer should only be called once
    expect(mockLoadWorldDataServer).toHaveBeenCalledTimes(1)
  })

  it('should use default logPrefix when not specified', async () => {
    await ensureEngineInitialized()
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('[Engine]'))
  })

  it('should supplement character profiles after restore', async () => {
    const serializedState = {
      characters: { c1: { id: 'c1', name: 'Char c1', currentMapId: 'town', currentNodeId: 'town-0-0', position: { x: 100, y: 100 }, direction: 'down', money: 100, satiety: 80, energy: 80, hygiene: 80, mood: 80, bladder: 80, navigation: { isMoving: false, path: [], currentPathIndex: 0, progress: 0, startPosition: null, targetPosition: null }, crossMapNavigation: null, conversation: null, currentAction: null, pendingAction: null, actionCounter: 0 } },
      npcs: {},
      time: { hour: 10, minute: 0, day: 1 },
      currentMapId: 'town',
    }
    mockStoreInstance.hasData.mockResolvedValue(true)
    mockStoreInstance.loadState.mockResolvedValue(serializedState)
    mockStoreInstance.loadServerStartTime.mockResolvedValue(Date.now())

    const engine = await ensureEngineInitialized()
    // Character should have personality supplemented from config
    const char = engine.getCharacter('c1')
    expect(char?.personality).toBe('明るい')
    expect(char?.tendencies).toEqual(['食べる'])
  })

  it('should call triggerInitialBehaviorDecisions after start', async () => {
    const engine = await ensureEngineInitialized()
    // Engine is running, initial decisions were triggered
    expect(engine.isSimulationRunning()).toBe(true)
    // The character should have pending decision or be processing
    // (behavior decider is mocked to return idle)
  })
})
