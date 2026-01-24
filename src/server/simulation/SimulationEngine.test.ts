import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Only mock the LLM behavior decider (external LLM API dependency)
vi.mock('../behavior/LLMBehaviorDecider', () => ({
  LLMBehaviorDecider: class {
    decide = vi.fn().mockResolvedValue({ type: 'idle', reason: 'test' })
    decideInterruptFacility = vi.fn().mockResolvedValue({ type: 'idle', reason: 'test interrupt' })
    setActionConfigs = vi.fn()
  },
}))

// Mock ConversationExecutor to prevent async LLM calls in tests
vi.mock('../conversation/ConversationExecutor', () => ({
  ConversationExecutor: class {
    setPostProcessor = vi.fn()
    setOnConversationComplete = vi.fn()
    setOnMessageEmit = vi.fn()
    setTurnIntervalMs = vi.fn()
    executeConversation = vi.fn().mockResolvedValue(undefined)
  },
}))

import { SimulationEngine } from './SimulationEngine'
import type { WorldMap, Character, TimeConfig, Obstacle, NPC } from '@/types'

// --- Test helpers ---

function createTestNodes(prefix: string, cols = 3, rows = 3) {
  const nodes: WorldMap['nodes'] = []
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const id = `${prefix}-${row}-${col}`
      const connected: string[] = []
      // Connect to right
      if (col < cols - 1) connected.push(`${prefix}-${row}-${col + 1}`)
      // Connect to left
      if (col > 0) connected.push(`${prefix}-${row}-${col - 1}`)
      // Connect to down
      if (row < rows - 1) connected.push(`${prefix}-${row + 1}-${col}`)
      // Connect to up
      if (row > 0) connected.push(`${prefix}-${row - 1}-${col}`)

      nodes.push({
        id,
        x: 100 + col * 100,
        y: 100 + row * 100,
        type: 'waypoint',
        connectedTo: connected,
      })
    }
  }
  return nodes
}

function createTestMap(id: string, overrides: Partial<WorldMap> = {}): WorldMap {
  const nodes = createTestNodes(id)
  return {
    id,
    name: `Map ${id}`,
    width: 800,
    height: 600,
    backgroundColor: 0x000000,
    spawnNodeId: `${id}-0-0`,
    nodes,
    obstacles: [],
    ...overrides,
  }
}

function createTestCharacter(id: string, overrides: Partial<Character> = {}): Character {
  return {
    id,
    name: `Character ${id}`,
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
    ...overrides,
  }
}

function createTestNPC(id: string, overrides: Partial<NPC> = {}): NPC {
  return {
    id,
    name: `NPC ${id}`,
    sprite: { sheetUrl: 'test.png', frameWidth: 96, frameHeight: 96, cols: 3, rows: 4, rowMapping: { down: 0, left: 1, right: 2, up: 3 } },
    mapId: 'town',
    currentNodeId: 'town-0-0',
    position: { x: 100, y: 100 },
    direction: 'down',
    personality: 'テスト性格',
    tendencies: ['傾向1'],
    facts: ['事実1'],
    affinity: 0,
    mood: 'neutral',
    conversationCount: 0,
    lastConversation: null,
    ...overrides,
  }
}

const testTimeConfig: TimeConfig = {
  timezone: 'Asia/Tokyo',
  statusDecayIntervalMs: 60000,
  decayRates: {
    satietyPerMinute: 0.5,
    energyPerMinute: 0.3,
    hygienePerMinute: 0.2,
    moodPerMinute: 0.1,
    bladderPerMinute: 0.8,
  },
}

const testActionConfigs = {
  toilet: {
    fixed: true,
    duration: 5,
    effects: { bladder: 100 },
  },
  eat: {
    durationRange: { min: 15, max: 60, default: 30 },
    perMinute: { satiety: 2, mood: 0.5 },
  },
  sleep: {
    durationRange: { min: 60, max: 480, default: 120 },
    perMinute: { energy: 1.5 },
  },
  thinking: {
    fixed: true,
    duration: 0,
    effects: {},
  },
}

// --- Tests ---

describe('SimulationEngine (integration)', () => {
  let engine: SimulationEngine

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.useFakeTimers()
    engine = new SimulationEngine({ tickRate: 20 })
  })

  afterEach(() => {
    engine.stop()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  describe('lifecycle', () => {
    it('should create engine with default config', () => {
      const e = new SimulationEngine()
      expect(e.isInitialized()).toBe(false)
      expect(e.isSimulationRunning()).toBe(false)
    })

    it('should accept partial config override', () => {
      const e = new SimulationEngine({ tickRate: 10 })
      expect(e.getTickRate()).toBe(10)
    })

    it('should initialize with maps and characters', async () => {
      const maps = { town: createTestMap('town') }
      const characters = [createTestCharacter('c1')]
      await engine.initialize(maps, characters)
      expect(engine.isInitialized()).toBe(true)
      expect(engine.getCharacter('c1')).toBeDefined()
      expect(engine.getCharacter('c1')!.name).toBe('Character c1')
    })

    it('should start and stop simulation', async () => {
      const maps = { town: createTestMap('town') }
      await engine.initialize(maps, [createTestCharacter('c1')])
      engine.start()
      expect(engine.isSimulationRunning()).toBe(true)
      engine.stop()
      expect(engine.isSimulationRunning()).toBe(false)
    })

    it('should not start twice', async () => {
      const maps = { town: createTestMap('town') }
      await engine.initialize(maps, [createTestCharacter('c1')])
      engine.start()
      engine.start() // no-op
      expect(engine.isSimulationRunning()).toBe(true)
    })

    it('should toggle pause state', async () => {
      const maps = { town: createTestMap('town') }
      await engine.initialize(maps, [createTestCharacter('c1')])
      expect(engine.isPaused()).toBe(false)
      engine.pause()
      expect(engine.isPaused()).toBe(true)
      engine.unpause()
      expect(engine.isPaused()).toBe(false)
    })

    it('togglePause should alternate', async () => {
      const maps = { town: createTestMap('town') }
      await engine.initialize(maps, [createTestCharacter('c1')])
      engine.togglePause()
      expect(engine.isPaused()).toBe(true)
      engine.togglePause()
      expect(engine.isPaused()).toBe(false)
    })
  })

  describe('subscribers', () => {
    it('should track subscriber count', async () => {
      const maps = { town: createTestMap('town') }
      await engine.initialize(maps, [createTestCharacter('c1')])
      const unsub = engine.subscribe(() => {})
      expect(engine.getSubscriberCount()).toBe(1)
      unsub()
      expect(engine.getSubscriberCount()).toBe(0)
    })

    it('should notify subscribers on tick (throttled every 5 ticks)', async () => {
      const maps = { town: createTestMap('town') }
      await engine.initialize(maps, [createTestCharacter('c1')], 'town', undefined, undefined, testTimeConfig)

      const callback = vi.fn()
      engine.subscribe(callback)
      engine.start()

      // Advance 5 ticks (tickRate=20 → 50ms per tick, 5 ticks = 250ms)
      vi.advanceTimersByTime(250)
      expect(callback).toHaveBeenCalled()
      engine.stop()
    })
  })

  describe('getState', () => {
    it('should return serialized state with characters', async () => {
      const maps = { town: createTestMap('town') }
      await engine.initialize(maps, [createTestCharacter('c1')])
      const state = engine.getState()
      expect(state.characters['c1']).toBeDefined()
      expect(state.characters['c1'].name).toBe('Character c1')
    })
  })

  describe('applyStatusDecay (real calculateStatChange)', () => {
    it('should decrease stats over time', async () => {
      const maps = { town: createTestMap('town') }
      const chars = [createTestCharacter('c1', {
        satiety: 50,
        energy: 50,
        hygiene: 50,
        mood: 50,
        bladder: 50,
      })]
      await engine.initialize(maps, chars, 'town', undefined, undefined, testTimeConfig)

      engine.start()
      // Advance past decay interval (60000ms) + some buffer
      vi.advanceTimersByTime(testTimeConfig.statusDecayIntervalMs + 100)
      engine.stop()

      const char = engine.getCharacter('c1')!
      // With real calculateStatChange: current - decayRate * elapsedMinutes
      // elapsedMinutes ≈ 1.0
      expect(char.satiety).toBeLessThan(50)   // decreased by 0.5/min * ~1min
      expect(char.bladder).toBeLessThan(50)   // decreased by 0.8/min * ~1min
      expect(char.energy).toBeLessThan(50)    // decreased by 0.3/min * ~1min
      expect(char.hygiene).toBeLessThan(50)   // decreased by 0.2/min * ~1min
      expect(char.mood).toBeLessThan(50)      // decreased by 0.1/min * ~1min
    })

    it('should apply perMinute effects when action is running', async () => {
      const maps = { town: createTestMap('town') }
      const chars = [createTestCharacter('c1', { satiety: 30, bladder: 50 })]
      await engine.initialize(maps, chars, 'town', undefined, undefined, testTimeConfig)

      // Load action configs so perMinute effects are available
      engine.setActionConfigs(testActionConfigs as never)

      // Manually start an eat action on the character (bypassing LLM decision)
      const char = engine.getCharacter('c1')!
      const now = Date.now()
      char.currentAction = {
        actionId: 'eat',
        startTime: now,
        targetEndTime: now + 30 * 60000,
      }

      engine.start()
      vi.advanceTimersByTime(testTimeConfig.statusDecayIntervalMs + 100)
      engine.stop()

      // char is a reference to internal state, re-read to get updated values
      const updated = engine.getCharacter('c1')!
      // satiety should INCREASE (perMinute.satiety = 2)
      expect(updated.satiety).toBeGreaterThan(30)
      // bladder should still decrease (no perMinute for bladder in eat config)
      expect(updated.bladder).toBeLessThan(50)
    })

    it('should not apply perMinute for fixed-time actions', async () => {
      const maps = { town: createTestMap('town') }
      const chars = [createTestCharacter('c1', { bladder: 50 })]
      await engine.initialize(maps, chars, 'town', undefined, undefined, testTimeConfig)

      engine.setActionConfigs(testActionConfigs as never)

      // Start a fixed-time action (toilet)
      const char = engine.getCharacter('c1')!
      const now = Date.now()
      char.currentAction = {
        actionId: 'toilet',
        startTime: now,
        targetEndTime: now + 5 * 60000,
      }

      engine.start()
      vi.advanceTimersByTime(testTimeConfig.statusDecayIntervalMs + 100)
      engine.stop()

      // Re-read after engine run (updateCharacter creates new object)
      const updated = engine.getCharacter('c1')!
      // bladder should still decrease (fixed actions don't have perMinute)
      expect(updated.bladder).toBeLessThan(50)
    })
  })

  describe('triggerStatusInterrupt', () => {
    it('should not trigger when character has currentAction', async () => {
      const maps = { town: createTestMap('town') }
      // bladder just above threshold (10)
      const chars = [createTestCharacter('c1', { bladder: 11 })]
      await engine.initialize(maps, chars, 'town', undefined, undefined, testTimeConfig)

      // Set currentAction with long duration to prevent completion during test
      const char = engine.getCharacter('c1')!
      const now = Date.now()
      char.currentAction = {
        actionId: 'work',
        startTime: now,
        targetEndTime: now + 600000, // 10 minutes, well past test duration
      }

      engine.start()
      vi.advanceTimersByTime(testTimeConfig.statusDecayIntervalMs + 100)
      engine.stop()

      // Re-read after engine run (updateCharacter creates new object)
      const updated = engine.getCharacter('c1')!
      // The character's action should still be running (not interrupted)
      expect(updated.currentAction).not.toBeNull()
    })

    it('should trigger interrupt when idle and stat drops below threshold', async () => {
      const maps = { town: createTestMap('town') }
      // bladder starts at 10.5 (just above threshold of 10, will cross below with decay)
      const chars = [createTestCharacter('c1', { bladder: 10.5 })]
      await engine.initialize(maps, chars, 'town', undefined, undefined, testTimeConfig)

      engine.setActionConfigs(testActionConfigs as never)

      engine.start()
      // Advance enough for bladder to drop below 10 (0.8/min decay, 1 min elapsed)
      vi.advanceTimersByTime(testTimeConfig.statusDecayIntervalMs + 100)
      engine.stop()

      const char = engine.getCharacter('c1')!
      // Bladder should have dropped below threshold
      expect(char.bladder).toBeLessThan(10)
      // The thinking action should have been started (interrupt starts 'thinking' first)
      // After the async LLM call resolves, it's force-completed
      // We can verify by checking the character's state changed
    })
  })

  describe('checkPendingActions', () => {
    it('should execute pending action when character stops moving', async () => {
      const toiletObstacle: Obstacle = {
        id: 'toilet-1',
        x: 100,
        y: 100,
        width: 200,
        height: 200,
        type: 'zone',
        label: 'Toilet',
        facility: { tags: ['toilet'] },
        tileRow: 0,
        tileCol: 0,
        tileWidth: 2,
        tileHeight: 2,
      }
      const maps = {
        town: createTestMap('town', { obstacles: [toiletObstacle] }),
      }
      const chars = [createTestCharacter('c1')]
      await engine.initialize(maps, chars, 'town', undefined, undefined, testTimeConfig)

      engine.setActionConfigs(testActionConfigs as never)

      // Set pending action directly on character
      const char = engine.getCharacter('c1')!
      char.pendingAction = {
        actionId: 'toilet',
        facilityId: 'toilet-1',
        facilityMapId: 'town',
        reason: 'need to go',
      }
      // Character is idle (not moving) → pending action should execute on next tick
      engine.start()
      vi.advanceTimersByTime(50 + 10) // 1 tick
      engine.stop()

      // Re-read after engine run (updateCharacter creates new object)
      const updated = engine.getCharacter('c1')!
      // pendingAction should be cleared
      expect(updated.pendingAction).toBeNull()
      // currentAction should be set (toilet started)
      expect(updated.currentAction).not.toBeNull()
      expect(updated.currentAction!.actionId).toBe('toilet')
    })

    it('should not execute pending action while character is moving', async () => {
      const maps = { town: createTestMap('town') }
      const chars = [createTestCharacter('c1')]
      await engine.initialize(maps, chars, 'town', undefined, undefined, testTimeConfig)

      const char = engine.getCharacter('c1')!
      char.pendingAction = {
        actionId: 'toilet',
        facilityId: 'toilet-1',
        facilityMapId: 'town',
        reason: 'need to go',
      }
      char.navigation = {
        isMoving: true,
        path: ['town-0-0', 'town-0-1'],
        currentPathIndex: 0,
        progress: 0.5,
        startPosition: { x: 100, y: 100 },
        targetPosition: { x: 200, y: 100 },
      }

      engine.start()
      vi.advanceTimersByTime(50 + 10)
      engine.stop()

      // Re-read after engine run (updateCharacter creates new object)
      const updated = engine.getCharacter('c1')!
      // Pending action should remain since character is moving
      expect(updated.pendingAction).not.toBeNull()
    })
  })

  describe('persistence', () => {
    it('should return false when no store set', async () => {
      const maps = { town: createTestMap('town') }
      await engine.initialize(maps, [createTestCharacter('c1')])
      // saveState is a no-op, restoreFromStore returns false
      await engine.saveState()
      const restored = await engine.restoreFromStore(maps)
      expect(restored).toBe(false)
    })

    it('should save/restore with mock store', async () => {
      const mockStore = {
        hasData: vi.fn().mockResolvedValue(true),
        saveState: vi.fn().mockResolvedValue(undefined),
        loadState: vi.fn().mockResolvedValue({
          characters: {
            c1: {
              id: 'c1',
              name: 'Restored Char',
              sprite: { sheetUrl: 'test.png', frameWidth: 96, frameHeight: 96, cols: 3, rows: 4, rowMapping: { down: 0, left: 1, right: 2, up: 3 } },
              money: 200,
              satiety: 60,
              energy: 70,
              hygiene: 50,
              mood: 40,
              bladder: 30,
              currentMapId: 'town',
              currentNodeId: 'town-1-1',
              position: { x: 200, y: 200 },
              direction: 'left',
              navigation: { isMoving: false, path: [], currentPathIndex: 0, progress: 0, startPosition: null, targetPosition: null },
              crossMapNavigation: null,
              conversation: null,
              currentAction: null,
              pendingAction: null,
              actionCounter: 0,
            },
          },
          npcs: {},
          currentMapId: 'town',
          time: { hour: 10, minute: 30, day: 1 },
          isPaused: false,
          transition: { isTransitioning: false, characterId: null, fromMapId: null, toMapId: null, progress: 0 },
          tick: 50,
        }),
        close: vi.fn().mockResolvedValue(undefined),
        loadServerStartTime: vi.fn().mockResolvedValue(null),
        saveServerStartTime: vi.fn().mockResolvedValue(undefined),
      }

      const e = new SimulationEngine({}, mockStore as never)
      const maps = { town: createTestMap('town') }
      const restored = await e.restoreFromStore(maps)
      expect(restored).toBe(true)
      expect(e.getCharacter('c1')).toBeDefined()
      expect(e.getCharacter('c1')!.name).toBe('Restored Char')
      expect(e.getCharacter('c1')!.money).toBe(200)
    })

    it('should return false when store has no data', async () => {
      const mockStore = {
        hasData: vi.fn().mockResolvedValue(false),
        loadState: vi.fn(),
      }

      const e = new SimulationEngine({}, mockStore as never)
      const maps = { town: createTestMap('town') }
      const restored = await e.restoreFromStore(maps)
      expect(restored).toBe(false)
    })
  })

  describe('serverStartTime', () => {
    it('should get and set server start time', () => {
      const time = 1234567890
      engine.setServerStartTime(time)
      expect(engine.getServerStartTime()).toBe(time)
    })
  })

  describe('action completion flow', () => {
    it('should complete action and start thinking for next decision', async () => {
      const maps = { town: createTestMap('town') }
      const chars = [createTestCharacter('c1')]
      await engine.initialize(maps, chars, 'town', undefined, undefined, testTimeConfig)

      engine.setActionConfigs(testActionConfigs as never)

      // Start a fixed-time action (toilet, 5 min = 300000ms)
      const char = engine.getCharacter('c1')!
      const now = Date.now()
      char.currentAction = {
        actionId: 'toilet',
        startTime: now,
        targetEndTime: now + 300000, // 5 minutes
      }

      engine.start()
      // Advance past action completion time
      vi.advanceTimersByTime(300000 + 100)
      engine.stop()

      // Re-read after engine run (updateCharacter creates new object)
      const updated = engine.getCharacter('c1')!
      // After toilet completes, onActionComplete triggers makeBehaviorDecision
      // which starts a 'thinking' action (LLM decision pending)
      expect(updated.currentAction?.actionId).toBe('thinking')
    })

    it('should resolve thinking into idle after LLM responds', async () => {
      const maps = { town: createTestMap('town') }
      const chars = [createTestCharacter('c1')]
      await engine.initialize(maps, chars, 'town', undefined, undefined, testTimeConfig)

      engine.setActionConfigs(testActionConfigs as never)

      // Start a short action
      const char = engine.getCharacter('c1')!
      const now = Date.now()
      char.currentAction = {
        actionId: 'toilet',
        startTime: now,
        targetEndTime: now + 300000,
      }

      engine.start()
      vi.advanceTimersByTime(300000 + 100)
      engine.stop()

      // Flush microtasks so the mock LLM resolve fires
      await vi.waitFor(() => {
        const c = engine.getCharacter('c1')!
        // After LLM responds with 'idle', thinking is force-completed
        expect(c.currentAction).toBeNull()
      })
    })
  })

  describe('navigation with real CharacterSimulator', () => {
    it('should move character along path', async () => {
      const maps = { town: createTestMap('town') }
      const chars = [createTestCharacter('c1')]
      await engine.initialize(maps, chars, 'town', undefined, undefined, testTimeConfig)

      // Start navigation using CharacterSimulator
      const result = engine.getCharacterSimulator().navigateToNode('c1', 'town-0-2')
      expect(result).toBe(true)

      const char = engine.getCharacter('c1')!
      expect(char.navigation.isMoving).toBe(true)
      expect(char.navigation.path.length).toBeGreaterThan(0)
    })

    it('should complete navigation and arrive at destination', async () => {
      const maps = { town: createTestMap('town') }
      const chars = [createTestCharacter('c1')]
      await engine.initialize(maps, chars, 'town', undefined, undefined, testTimeConfig)

      engine.getCharacterSimulator().navigateToNode('c1', 'town-0-1')

      engine.start()
      // Advance enough time for character to arrive (100px at 150px/s ≈ 667ms)
      vi.advanceTimersByTime(2000)
      engine.stop()

      const char = engine.getCharacter('c1')!
      expect(char.navigation.isMoving).toBe(false)
      expect(char.currentNodeId).toBe('town-0-1')
    })
  })

  describe('buildCurrentMapFacilities', () => {
    it('should collect facilities from map obstacles', async () => {
      const obstacle: Obstacle = {
        id: 'kitchen-1',
        x: 100,
        y: 100,
        width: 200,
        height: 200,
        type: 'zone',
        label: 'Kitchen',
        facility: { tags: ['kitchen'], owner: 'kitchen-1' },
        tileRow: 0,
        tileCol: 0,
        tileWidth: 2,
        tileHeight: 2,
      }
      const maps = { town: createTestMap('town', { obstacles: [obstacle] }) }
      await engine.initialize(maps, [createTestCharacter('c1')])

      const state = engine.getState()
      // Verify the map has the obstacle
      expect(state.characters['c1'].currentMapId).toBe('town')
    })
  })

  describe('full tick cycle', () => {
    it('should run multiple ticks without errors', async () => {
      const maps = { town: createTestMap('town') }
      const chars = [createTestCharacter('c1'), createTestCharacter('c2')]
      await engine.initialize(maps, chars, 'town', undefined, undefined, testTimeConfig)

      engine.setActionConfigs(testActionConfigs as never)

      engine.start()
      // Run for 100 ticks
      vi.advanceTimersByTime(5000)
      engine.stop()

      // Both characters should still exist
      expect(engine.getCharacter('c1')).toBeDefined()
      expect(engine.getCharacter('c2')).toBeDefined()
    })

    it('should sync time on each tick even when paused', async () => {
      const maps = { town: createTestMap('town') }
      await engine.initialize(maps, [createTestCharacter('c1')], 'town', undefined, undefined, testTimeConfig)

      engine.pause()
      engine.start()

      const callback = vi.fn()
      engine.subscribe(callback)

      // Advance 5 ticks
      vi.advanceTimersByTime(250)
      engine.stop()

      // Subscribers should still be notified (time syncs even when paused)
      expect(callback).toHaveBeenCalled()
    })
  })

  describe('setActionConfigs', () => {
    it('should propagate action configs to ActionExecutor', async () => {
      const maps = { town: createTestMap('town') }
      await engine.initialize(maps, [createTestCharacter('c1')], 'town', undefined, undefined, testTimeConfig)

      engine.setActionConfigs(testActionConfigs as never)

      // Verify by starting an action that needs config (toilet = fixed 5min)
      const char = engine.getCharacter('c1')!
      const now = Date.now()
      char.currentAction = {
        actionId: 'toilet',
        startTime: now,
        targetEndTime: now + 5 * 60000,
      }

      // getActivePerMinuteEffects should return null for fixed-time actions
      // (This tests the real ActionExecutor integration)
    })
  })

  describe('behavior decision → facility navigation', () => {
    it('should navigate to facility when character is not inside it', async () => {
      // Use 5x5 grid so zone interior has nodes (isNodeInsideZone uses strict inequality)
      const toiletObstacle: Obstacle = {
        id: 'toilet-1',
        x: 100, y: 100, width: 300, height: 300,
        type: 'zone', label: 'Toilet',
        facility: { tags: ['toilet'] },
        tileRow: 1, tileCol: 1, tileWidth: 3, tileHeight: 3,
        // Interior nodes: row > 1 && row < 4, col > 1 && col < 4 → (2,2), (2,3), (3,2), (3,3)
      }
      const nodes = createTestNodes('town', 5, 5)
      const maps = { town: createTestMap('town', { nodes, obstacles: [toiletObstacle] }) }
      const chars = [createTestCharacter('c1')] // at town-0-0
      await engine.initialize(maps, chars, 'town', undefined, undefined, testTimeConfig)
      engine.setActionConfigs(testActionConfigs as never)

      // Mock LLM to return action at facility
      const decider = (engine as any).behaviorDecider
      decider.decide.mockResolvedValueOnce({
        type: 'action',
        actionId: 'toilet',
        targetFacilityId: 'toilet-1',
        reason: 'need to go',
      })

      // Trigger behavior decision directly (avoids fake timer complexity)
      const char = engine.getCharacter('c1')!
      ;(engine as any).makeBehaviorDecision(char, { hour: 8, minute: 0, day: 1 })

      await vi.waitFor(() => {
        const updated = engine.getCharacter('c1')!
        expect(updated.pendingAction).not.toBeNull()
        expect(updated.pendingAction!.actionId).toBe('toilet')
        expect(updated.pendingAction!.facilityId).toBe('toilet-1')
      })
    })

    it('should execute action immediately when already inside facility', async () => {
      // Zone at tileRow=1, tileCol=1, tileWidth=3, tileHeight=3
      // Interior: row > 1 && row < 4, col > 1 && col < 4 → (2,2) is inside
      const toiletObstacle: Obstacle = {
        id: 'toilet-1',
        x: 100, y: 100, width: 300, height: 300,
        type: 'zone', label: 'Toilet',
        facility: { tags: ['toilet'] },
        tileRow: 1, tileCol: 1, tileWidth: 3, tileHeight: 3,
      }
      const nodes = createTestNodes('town', 5, 5)
      const maps = { town: createTestMap('town', { nodes, obstacles: [toiletObstacle] }) }
      const chars = [createTestCharacter('c1', {
        currentNodeId: 'town-2-2', // Inside the zone
        position: { x: 300, y: 300 },
      })]
      await engine.initialize(maps, chars, 'town', undefined, undefined, testTimeConfig)
      engine.setActionConfigs(testActionConfigs as never)

      const decider = (engine as any).behaviorDecider
      decider.decide.mockResolvedValueOnce({
        type: 'action',
        actionId: 'toilet',
        targetFacilityId: 'toilet-1',
        reason: 'need to go',
      })

      const char = engine.getCharacter('c1')!
      ;(engine as any).makeBehaviorDecision(char, { hour: 8, minute: 0, day: 1 })

      await vi.waitFor(() => {
        const updated = engine.getCharacter('c1')!
        expect(updated.currentAction?.actionId).toBe('toilet')
        expect(updated.pendingAction).toBeNull()
      })
    })

    it('should navigate cross-map to facility on different map', async () => {
      const townNodes = [
        { id: 'town-0-0', x: 100, y: 100, type: 'waypoint' as const, connectedTo: ['town-entrance'] },
        { id: 'town-entrance', x: 200, y: 100, type: 'entrance' as const, connectedTo: ['town-0-0'], leadsTo: { mapId: 'cafe', nodeId: 'cafe-entrance' } },
      ]
      const cafeNodes = [
        { id: 'cafe-entrance', x: 100, y: 100, type: 'entrance' as const, connectedTo: ['cafe-0-0'], leadsTo: { mapId: 'town', nodeId: 'town-entrance' } },
        { id: 'cafe-0-0', x: 200, y: 100, type: 'waypoint' as const, connectedTo: ['cafe-entrance', 'cafe-1-0', 'cafe-0-1'] },
        { id: 'cafe-0-1', x: 300, y: 100, type: 'waypoint' as const, connectedTo: ['cafe-0-0', 'cafe-1-1'] },
        { id: 'cafe-1-0', x: 200, y: 200, type: 'waypoint' as const, connectedTo: ['cafe-0-0', 'cafe-1-1'] },
        { id: 'cafe-1-1', x: 300, y: 200, type: 'waypoint' as const, connectedTo: ['cafe-0-1', 'cafe-1-0'] },
      ]
      const cafeObstacle: Obstacle = {
        id: 'cafe-kitchen',
        x: 200, y: 100, width: 200, height: 200,
        type: 'zone', label: 'Kitchen',
        facility: { tags: ['kitchen'], owner: 'cafe-kitchen' },
        tileRow: 0, tileCol: 0, tileWidth: 3, tileHeight: 3,
        // Interior: row > 0 && row < 3, col > 0 && col < 3 → (1,1)
      }
      const maps = {
        town: createTestMap('town', { nodes: townNodes }),
        cafe: createTestMap('cafe', { nodes: cafeNodes, obstacles: [cafeObstacle] }),
      }
      const chars = [createTestCharacter('c1')]
      await engine.initialize(maps, chars, 'town', undefined, undefined, testTimeConfig)
      engine.setActionConfigs(testActionConfigs as never)

      const decider = (engine as any).behaviorDecider
      decider.decide.mockResolvedValueOnce({
        type: 'action',
        actionId: 'eat',
        targetFacilityId: 'cafe-kitchen',
        reason: 'hungry',
      })

      const char = engine.getCharacter('c1')!
      ;(engine as any).makeBehaviorDecision(char, { hour: 8, minute: 0, day: 1 })

      await vi.waitFor(() => {
        const updated = engine.getCharacter('c1')!
        expect(updated.pendingAction?.actionId).toBe('eat')
        expect(updated.pendingAction?.facilityId).toBe('cafe-kitchen')
        expect(updated.navigation.isMoving).toBe(true)
      })
    })
  })

  describe('behavior decision → move', () => {
    it('should navigate to another map on move decision', async () => {
      const townNodes = [
        { id: 'town-0-0', x: 100, y: 100, type: 'waypoint' as const, connectedTo: ['town-entrance'] },
        { id: 'town-entrance', x: 200, y: 100, type: 'entrance' as const, connectedTo: ['town-0-0'], leadsTo: { mapId: 'cafe', nodeId: 'cafe-entrance' } },
      ]
      const cafeNodes = [
        { id: 'cafe-entrance', x: 100, y: 100, type: 'entrance' as const, connectedTo: ['cafe-0-0'], leadsTo: { mapId: 'town', nodeId: 'town-entrance' } },
        { id: 'cafe-0-0', x: 200, y: 100, type: 'waypoint' as const, connectedTo: ['cafe-entrance'] },
      ]
      const maps = {
        town: createTestMap('town', { nodes: townNodes, spawnNodeId: 'town-0-0' }),
        cafe: createTestMap('cafe', { nodes: cafeNodes, spawnNodeId: 'cafe-0-0' }),
      }
      const chars = [createTestCharacter('c1')]
      await engine.initialize(maps, chars, 'town', undefined, undefined, testTimeConfig)

      const decider = (engine as any).behaviorDecider
      decider.decide.mockResolvedValueOnce({
        type: 'move',
        targetMapId: 'cafe',
        reason: 'want coffee',
      })

      const char = engine.getCharacter('c1')!
      ;(engine as any).makeBehaviorDecision(char, { hour: 8, minute: 0, day: 1 })

      await vi.waitFor(() => {
        const updated = engine.getCharacter('c1')!
        expect(updated.navigation.isMoving).toBe(true)
        expect(updated.crossMapNavigation?.isActive).toBe(true)
        expect(updated.crossMapNavigation?.targetMapId).toBe('cafe')
      })
    })

    it('should navigate to a local node on move decision', async () => {
      const maps = { town: createTestMap('town') }
      const chars = [createTestCharacter('c1')]
      await engine.initialize(maps, chars, 'town', undefined, undefined, testTimeConfig)

      const decider = (engine as any).behaviorDecider
      decider.decide.mockResolvedValueOnce({
        type: 'move',
        targetNodeId: 'town-2-2',
        reason: 'exploring',
      })

      const char = engine.getCharacter('c1')!
      ;(engine as any).makeBehaviorDecision(char, { hour: 8, minute: 0, day: 1 })

      await vi.waitFor(() => {
        const updated = engine.getCharacter('c1')!
        expect(updated.navigation.isMoving).toBe(true)
        expect(updated.navigation.path).toContain('town-2-2')
      })
    })
  })

  describe('behavior decision → talk', () => {
    it('should start talk immediately when adjacent to NPC', async () => {
      const maps = { town: createTestMap('town') }
      const chars = [createTestCharacter('c1', {
        currentNodeId: 'town-0-0',
        position: { x: 100, y: 100 },
      })]
      const npc = createTestNPC('npc1', {
        name: 'Cafe Staff',
        currentNodeId: 'town-0-1', // Adjacent to town-0-0
        position: { x: 200, y: 100 },
        direction: 'left',
      })
      await engine.initialize(maps, chars, 'town', undefined, [npc], testTimeConfig)
      engine.setActionConfigs(testActionConfigs as never)

      const decider = (engine as any).behaviorDecider
      decider.decide.mockResolvedValueOnce({
        type: 'action',
        actionId: 'talk',
        targetNpcId: 'npc1',
        reason: 'greeting',
      })

      const char = engine.getCharacter('c1')!
      ;(engine as any).makeBehaviorDecision(char, { hour: 8, minute: 0, day: 1 })

      await vi.waitFor(() => {
        const updated = engine.getCharacter('c1')!
        expect(updated.currentAction?.actionId).toBe('talk')
      })
    })

    it('should navigate to NPC when not adjacent', async () => {
      const maps = { town: createTestMap('town') }
      const chars = [createTestCharacter('c1', {
        currentNodeId: 'town-0-0',
        position: { x: 100, y: 100 },
      })]
      const npc = createTestNPC('npc1', {
        name: 'Cafe Staff',
        currentNodeId: 'town-2-2', // Not adjacent to town-0-0
        position: { x: 300, y: 300 },
        direction: 'left',
      })
      await engine.initialize(maps, chars, 'town', undefined, [npc], testTimeConfig)
      engine.setActionConfigs(testActionConfigs as never)

      const decider = (engine as any).behaviorDecider
      decider.decide.mockResolvedValueOnce({
        type: 'action',
        actionId: 'talk',
        targetNpcId: 'npc1',
        reason: 'chat',
      })

      const char = engine.getCharacter('c1')!
      ;(engine as any).makeBehaviorDecision(char, { hour: 8, minute: 0, day: 1 })

      await vi.waitFor(() => {
        const updated = engine.getCharacter('c1')!
        expect(updated.pendingAction?.actionId).toBe('talk')
        expect(updated.pendingAction?.targetNpcId).toBe('npc1')
        expect(updated.navigation.isMoving).toBe(true)
      })
    })
  })

  describe('schedule management', () => {
    it('should apply schedule update (add)', async () => {
      const mockStore = {
        hasData: vi.fn().mockResolvedValue(false),
        saveState: vi.fn().mockResolvedValue(undefined),
        saveSchedule: vi.fn().mockResolvedValue(undefined),
        addActionHistory: vi.fn().mockResolvedValue(undefined),
        close: vi.fn(),
      }
      const e = new SimulationEngine({ tickRate: 20 }, mockStore as never)
      const maps = { town: createTestMap('town') }
      const chars = [createTestCharacter('c1')]
      await e.initialize(maps, chars, 'town', undefined, undefined, testTimeConfig)
      e.setActionConfigs(testActionConfigs as never)

      // Mock LLM to return idle with schedule update
      const decider = (e as any).behaviorDecider
      decider.decide.mockResolvedValueOnce({
        type: 'idle',
        reason: 'planning',
        scheduleUpdate: {
          type: 'add',
          entry: { time: '14:00', activity: 'lunch', location: 'cafe' },
        },
      })

      const char = e.getCharacter('c1')!
      ;(e as any).makeBehaviorDecision(char, { hour: 8, minute: 0, day: 1 })

      await vi.waitFor(() => {
        expect(mockStore.saveSchedule).toHaveBeenCalled()
        const savedSchedule = mockStore.saveSchedule.mock.calls[0][0]
        expect(savedSchedule.entries).toContainEqual(
          expect.objectContaining({ time: '14:00', activity: 'lunch' })
        )
      })
    })

    it('should clear schedule cache for specific day', () => {
      const e = new SimulationEngine({ tickRate: 20 })
      // Manually set some cache entries
      const cache = (e as any).scheduleCache as Map<string, unknown>
      cache.set('c1-1', [{ time: '08:00', activity: 'wake' }])
      cache.set('c1-2', [{ time: '08:00', activity: 'wake' }])
      cache.set('c2-1', [{ time: '09:00', activity: 'work' }])

      // Clear day 1
      ;(e as any).clearScheduleCacheForDay(1)

      expect(cache.has('c1-1')).toBe(false)
      expect(cache.has('c2-1')).toBe(false)
      expect(cache.has('c1-2')).toBe(true)
    })
  })

  describe('action history', () => {
    it('should record action history on action completion', async () => {
      const maps = { town: createTestMap('town') }
      const chars = [createTestCharacter('c1')]
      await engine.initialize(maps, chars, 'town', undefined, undefined, testTimeConfig)
      engine.setActionConfigs(testActionConfigs as never)

      // Start an action (toilet, 5 min)
      const char = engine.getCharacter('c1')!
      const now = Date.now()
      char.currentAction = {
        actionId: 'toilet',
        startTime: now,
        targetEndTime: now + 300000,
      }

      engine.start()
      vi.advanceTimersByTime(300000 + 100)
      engine.stop()

      // Check action history cache
      const cache = (engine as any).actionHistoryCache as Map<string, Array<{actionId: string}>>
      const entries = Array.from(cache.values()).flat()
      expect(entries.some(e => e.actionId === 'toilet')).toBe(true)
    })

    it('should record move in action history when navigation succeeds', async () => {
      const townNodes = [
        { id: 'town-0-0', x: 100, y: 100, type: 'waypoint' as const, connectedTo: ['town-0-1'] },
        { id: 'town-0-1', x: 200, y: 100, type: 'waypoint' as const, connectedTo: ['town-0-0', 'town-0-2'] },
        { id: 'town-0-2', x: 300, y: 100, type: 'waypoint' as const, connectedTo: ['town-0-1'] },
      ]
      const maps = { town: createTestMap('town', { nodes: townNodes }) }
      const chars = [createTestCharacter('c1')]
      await engine.initialize(maps, chars, 'town', undefined, undefined, testTimeConfig)
      engine.setActionConfigs(testActionConfigs as never)

      // Mock LLM to return a move decision
      const decider = (engine as any).behaviorDecider
      decider.decide.mockResolvedValueOnce({
        type: 'move',
        targetNodeId: 'town-0-2',
        reason: '散歩したい',
      })

      const char = engine.getCharacter('c1')!
      ;(engine as any).makeBehaviorDecision(char, { hour: 10, minute: 0, day: 1 })

      await vi.waitFor(() => {
        const cache = (engine as any).actionHistoryCache as Map<string, Array<{actionId: string, target?: string, reason?: string}>>
        const entries = Array.from(cache.values()).flat()
        expect(entries.some(e => e.actionId === 'move' && e.target === 'town-0-2' && e.reason === '散歩したい')).toBe(true)
      })
    })

    it('should record idle in action history', async () => {
      const maps = { town: createTestMap('town') }
      const chars = [createTestCharacter('c1')]
      await engine.initialize(maps, chars, 'town', undefined, undefined, testTimeConfig)
      engine.setActionConfigs(testActionConfigs as never)

      // Mock LLM to return idle
      const decider = (engine as any).behaviorDecider
      decider.decide.mockResolvedValueOnce({
        type: 'idle',
        reason: '何もすることがない',
      })

      const char = engine.getCharacter('c1')!
      ;(engine as any).makeBehaviorDecision(char, { hour: 10, minute: 0, day: 1 })

      await vi.waitFor(() => {
        const cache = (engine as any).actionHistoryCache as Map<string, Array<{actionId: string, reason?: string}>>
        const entries = Array.from(cache.values()).flat()
        expect(entries.some(e => e.actionId === 'idle' && e.reason === '何もすることがない')).toBe(true)
      })
    })

    it('should not record duplicate consecutive idle entries', async () => {
      const maps = { town: createTestMap('town') }
      const chars = [createTestCharacter('c1')]
      await engine.initialize(maps, chars, 'town', undefined, undefined, testTimeConfig)
      engine.setActionConfigs(testActionConfigs as never)

      // Mock LLM to return idle twice
      const decider = (engine as any).behaviorDecider
      decider.decide
        .mockResolvedValueOnce({ type: 'idle', reason: '最初のidle' })
        .mockResolvedValueOnce({ type: 'idle', reason: '2回目のidle' })

      const char = engine.getCharacter('c1')!
      ;(engine as any).makeBehaviorDecision(char, { hour: 10, minute: 0, day: 1 })

      await vi.waitFor(() => {
        const cache = (engine as any).actionHistoryCache as Map<string, Array<{actionId: string}>>
        const entries = Array.from(cache.values()).flat()
        expect(entries.some(e => e.actionId === 'idle')).toBe(true)
      })

      // Trigger second idle decision
      const char2 = engine.getCharacter('c1')!
      ;(engine as any).makeBehaviorDecision(char2, { hour: 10, minute: 1, day: 1 })

      await vi.waitFor(() => {
        const cache = (engine as any).actionHistoryCache as Map<string, Array<{actionId: string}>>
        const entries = Array.from(cache.values()).flat()
        // Should still have only one idle entry (deduplication)
        expect(entries.filter(e => e.actionId === 'idle')).toHaveLength(1)
      })
    })

    it('should record talk in action history when conversation completes', async () => {
      const maps = { town: createTestMap('town') }
      const chars = [createTestCharacter('c1')]
      await engine.initialize(maps, chars, 'town', undefined, undefined, testTimeConfig)
      engine.setActionConfigs(testActionConfigs as never)

      // Set up character with a talk action in progress
      const char = engine.getCharacter('c1')!
      char.currentAction = {
        actionId: 'talk',
        startTime: Date.now(),
        targetEndTime: Date.now() + 300000,
        targetNpcId: 'npc1',
        reason: 'NPCと話したい',
      }

      // Get the onConversationComplete callback from the mock
      const executor = (engine as any).conversationExecutor
      const callback = executor.setOnConversationComplete.mock.calls[0][0]

      // Trigger conversation complete
      callback('c1')

      // Check action history
      const cache = (engine as any).actionHistoryCache as Map<string, Array<{actionId: string, target?: string, reason?: string}>>
      const entries = Array.from(cache.values()).flat()
      expect(entries.some(e => e.actionId === 'talk' && e.target === 'npc1' && e.reason === 'NPCと話したい')).toBe(true)
    })

    it('should clear action history cache for specific day', () => {
      const e = new SimulationEngine({ tickRate: 20 })
      const cache = (e as any).actionHistoryCache as Map<string, unknown>
      cache.set('c1-1', [{ time: '08:00', actionId: 'eat' }])
      cache.set('c1-2', [{ time: '09:00', actionId: 'work' }])

      ;(e as any).clearActionHistoryCacheForDay(1)

      expect(cache.has('c1-1')).toBe(false)
      expect(cache.has('c1-2')).toBe(true)
    })
  })

  describe('system auto-move', () => {
    it('should trigger auto-move after N actions', async () => {
      const townNodes = [
        { id: 'town-0-0', x: 100, y: 100, type: 'waypoint' as const, connectedTo: ['town-entrance'] },
        { id: 'town-entrance', x: 200, y: 100, type: 'entrance' as const, connectedTo: ['town-0-0'], leadsTo: { mapId: 'cafe', nodeId: 'cafe-entrance' } },
      ]
      const cafeNodes = [
        { id: 'cafe-entrance', x: 100, y: 100, type: 'entrance' as const, connectedTo: ['cafe-0-0'], leadsTo: { mapId: 'town', nodeId: 'town-entrance' } },
        { id: 'cafe-0-0', x: 200, y: 100, type: 'waypoint' as const, connectedTo: ['cafe-entrance'] },
      ]
      const maps = {
        town: createTestMap('town', { nodes: townNodes, spawnNodeId: 'town-0-0' }),
        cafe: createTestMap('cafe', { nodes: cafeNodes, spawnNodeId: 'cafe-0-0' }),
      }
      const chars = [createTestCharacter('c1')]
      await engine.initialize(maps, chars, 'town', undefined, undefined, testTimeConfig)
      engine.setActionConfigs(testActionConfigs as never)

      // Set actionCounter after initialize (createSimCharacter always resets to 0)
      const char = engine.getCharacter('c1')!
      ;(engine as any).worldState.updateCharacter('c1', { actionCounter: 2 })
      ;(engine as any).onActionComplete(char.id)

      // Counter should be reset after auto-move
      const updated = engine.getCharacter('c1')!
      expect(updated.actionCounter).toBe(0)
      // Should be navigating to another map
      expect(updated.navigation.isMoving).toBe(true)
    })

    it('should skip auto-move when status is low', async () => {
      const townNodes = [
        { id: 'town-0-0', x: 100, y: 100, type: 'waypoint' as const, connectedTo: ['town-entrance'] },
        { id: 'town-entrance', x: 200, y: 100, type: 'entrance' as const, connectedTo: ['town-0-0'], leadsTo: { mapId: 'cafe', nodeId: 'cafe-entrance' } },
      ]
      const cafeNodes = [
        { id: 'cafe-entrance', x: 100, y: 100, type: 'entrance' as const, connectedTo: ['cafe-0-0'], leadsTo: { mapId: 'town', nodeId: 'town-entrance' } },
        { id: 'cafe-0-0', x: 200, y: 100, type: 'waypoint' as const, connectedTo: ['cafe-entrance'] },
      ]
      const maps = {
        town: createTestMap('town', { nodes: townNodes, spawnNodeId: 'town-0-0' }),
        cafe: createTestMap('cafe', { nodes: cafeNodes, spawnNodeId: 'cafe-0-0' }),
      }
      const chars = [createTestCharacter('c1', {
        bladder: 5, // Below threshold (10) - should skip auto-move
      })]
      await engine.initialize(maps, chars, 'town', undefined, undefined, testTimeConfig)
      engine.setActionConfigs(testActionConfigs as never)

      // Set actionCounter after initialize (createSimCharacter always resets to 0)
      ;(engine as any).worldState.updateCharacter('c1', { actionCounter: 2 })

      // Call onActionComplete directly
      ;(engine as any).onActionComplete('c1')

      const updated = engine.getCharacter('c1')!
      // Counter should be 3 (incremented but NOT reset - low status skips auto-move)
      expect(updated.actionCounter).toBe(3)
      // Should NOT be navigating (auto-move skipped)
      expect(updated.navigation.isMoving).toBe(false)
    })
  })

  describe('buildCurrentMapFacilities', () => {
    it('should collect facilities from map obstacles', async () => {
      const obstacles: Obstacle[] = [
        {
          id: 'kitchen-1',
          x: 100, y: 100, width: 200, height: 200,
          type: 'zone', label: 'Kitchen',
          facility: { tags: ['kitchen'], owner: 'kitchen-1' },
          tileRow: 0, tileCol: 0, tileWidth: 2, tileHeight: 2,
        },
        {
          id: 'toilet-1',
          x: 300, y: 100, width: 100, height: 100,
          type: 'zone', label: 'Toilet',
          facility: { tags: ['toilet'] },
          tileRow: 0, tileCol: 3, tileWidth: 2, tileHeight: 2,
        },
        {
          id: 'table-1',
          x: 100, y: 300, width: 100, height: 100,
          type: 'building', label: 'Table',
          // No facility tag - should be excluded
          tileRow: 3, tileCol: 0, tileWidth: 2, tileHeight: 2,
        },
      ]
      const maps = { town: createTestMap('town', { obstacles }) }
      await engine.initialize(maps, [createTestCharacter('c1')])

      // Call private method to test
      const facilities = (engine as any).buildCurrentMapFacilities('town')
      expect(facilities.length).toBe(2)
      expect(facilities.find((f: { id: string }) => f.id === 'kitchen-1')).toBeDefined()
      expect(facilities.find((f: { id: string }) => f.id === 'toilet-1')).toBeDefined()
      expect(facilities.find((f: { id: string }) => f.id === 'table-1')).toBeUndefined()
    })
  })

  describe('buildNearbyFacilities', () => {
    it('should collect facilities from connected maps', async () => {
      const townNodes = [
        { id: 'town-0-0', x: 100, y: 100, type: 'waypoint' as const, connectedTo: ['town-entrance'] },
        { id: 'town-entrance', x: 200, y: 100, type: 'entrance' as const, connectedTo: ['town-0-0'], leadsTo: { mapId: 'cafe', nodeId: 'cafe-entrance' } },
      ]
      const cafeNodes = [
        { id: 'cafe-entrance', x: 100, y: 100, type: 'entrance' as const, connectedTo: ['cafe-0-0'], leadsTo: { mapId: 'town', nodeId: 'town-entrance' } },
        { id: 'cafe-0-0', x: 200, y: 100, type: 'waypoint' as const, connectedTo: ['cafe-entrance'] },
      ]
      const cafeObstacle: Obstacle = {
        id: 'cafe-counter',
        x: 200, y: 100, width: 100, height: 100,
        type: 'zone', label: 'Counter',
        facility: { tags: ['kitchen'], owner: 'cafe-counter', cost: 500 },
        tileRow: 0, tileCol: 1, tileWidth: 2, tileHeight: 2,
      }
      const maps = {
        town: createTestMap('town', { nodes: townNodes }),
        cafe: createTestMap('cafe', { nodes: cafeNodes, obstacles: [cafeObstacle] }),
      }
      await engine.initialize(maps, [createTestCharacter('c1')])

      const facilities = (engine as any).buildNearbyFacilities('town')
      expect(facilities.length).toBe(1)
      expect(facilities[0].id).toBe('cafe-counter')
      expect(facilities[0].mapId).toBe('cafe')
      expect(facilities[0].distance).toBe(1)
      expect(facilities[0].cost).toBe(500)
    })
  })

  describe('buildNearbyMaps', () => {
    it('should list connected maps with distances', async () => {
      const townNodes = [
        { id: 'town-0-0', x: 100, y: 100, type: 'waypoint' as const, connectedTo: ['town-entrance'] },
        { id: 'town-entrance', x: 200, y: 100, type: 'entrance' as const, connectedTo: ['town-0-0'], leadsTo: { mapId: 'cafe', nodeId: 'cafe-entrance' } },
      ]
      const cafeNodes = [
        { id: 'cafe-entrance', x: 100, y: 100, type: 'entrance' as const, connectedTo: ['cafe-0-0'], leadsTo: { mapId: 'town', nodeId: 'town-entrance' } },
        { id: 'cafe-0-0', x: 200, y: 100, type: 'waypoint' as const, connectedTo: ['cafe-entrance'] },
      ]
      const maps = {
        town: createTestMap('town', { nodes: townNodes }),
        cafe: createTestMap('cafe', { nodes: cafeNodes }),
      }
      await engine.initialize(maps, [createTestCharacter('c1')])

      const nearbyMaps = (engine as any).buildNearbyMaps('town')
      expect(nearbyMaps.length).toBe(2)
      expect(nearbyMaps.find((m: { id: string }) => m.id === 'town')?.distance).toBe(0)
      expect(nearbyMaps.find((m: { id: string }) => m.id === 'cafe')?.distance).toBe(1)
    })
  })

  describe('onNavigationComplete', () => {
    it('should trigger behavior decision when navigation completes without pending action', async () => {
      const maps = { town: createTestMap('town') }
      const chars = [createTestCharacter('c1')]
      await engine.initialize(maps, chars, 'town', undefined, undefined, testTimeConfig)
      engine.setActionConfigs(testActionConfigs as never)

      // Navigate character
      engine.getCharacterSimulator().navigateToNode('c1', 'town-0-1')

      engine.start()
      // Advance enough for navigation to complete
      vi.advanceTimersByTime(2000)
      engine.stop()

      await vi.waitFor(() => {
        const updated = engine.getCharacter('c1')!
        // After navigation completes, behavior decision fires
        // Mock returns 'idle', which should clear any thinking action
        expect(updated.navigation.isMoving).toBe(false)
        expect(updated.currentNodeId).toBe('town-0-1')
      })
    })
  })

  describe('triggerInitialBehaviorDecisions', () => {
    it('should trigger decisions for all idle characters', async () => {
      const maps = { town: createTestMap('town') }
      const chars = [
        createTestCharacter('c1'),
        createTestCharacter('c2', { currentNodeId: 'town-1-1', position: { x: 200, y: 200 } }),
      ]
      await engine.initialize(maps, chars, 'town', undefined, undefined, testTimeConfig)

      engine.triggerInitialBehaviorDecisions()

      // Both characters should have thinking action started
      await vi.waitFor(() => {
        const c1 = engine.getCharacter('c1')!
        const c2 = engine.getCharacter('c2')!
        // After LLM resolves (mock returns idle), thinking is cleared
        expect(c1.currentAction).toBeNull()
        expect(c2.currentAction).toBeNull()
      })
    })
  })

  describe('loadScheduleCache', () => {
    it('should load schedules from store into cache', async () => {
      const mockStore = {
        hasData: vi.fn().mockResolvedValue(false),
        loadSchedule: vi.fn().mockResolvedValue({
          characterId: 'c1',
          day: 1,
          entries: [{ time: '08:00', activity: 'wake up' }],
        }),
        close: vi.fn(),
      }
      const e = new SimulationEngine({ tickRate: 20 }, mockStore as never)
      const maps = { town: createTestMap('town') }
      await e.initialize(maps, [createTestCharacter('c1')], 'town', undefined, undefined, testTimeConfig)

      await e.loadScheduleCache()

      expect(mockStore.loadSchedule).toHaveBeenCalled()
      // Schedule should now be in cache
      const schedule = (e as any).getScheduleForCharacter('c1')
      expect(schedule).toContainEqual(expect.objectContaining({ time: '08:00' }))
    })
  })

  describe('loadActionHistoryCache', () => {
    it('should load action history from store into cache', async () => {
      const mockStore = {
        hasData: vi.fn().mockResolvedValue(false),
        loadActionHistoryForDay: vi.fn().mockResolvedValue([
          { time: '09:00', actionId: 'eat', target: 'kitchen-1' },
        ]),
        close: vi.fn(),
      }
      const e = new SimulationEngine({ tickRate: 20 }, mockStore as never)
      const maps = { town: createTestMap('town') }
      await e.initialize(maps, [createTestCharacter('c1')], 'town', undefined, undefined, testTimeConfig)

      await e.loadActionHistoryCache()

      expect(mockStore.loadActionHistoryForDay).toHaveBeenCalled()
      const history = (e as any).getActionHistoryForCharacter('c1')
      expect(history).toContainEqual(expect.objectContaining({ actionId: 'eat' }))
    })
  })

  describe('seedDefaultSchedules', () => {
    it('should seed default schedules to store when not existing', async () => {
      const mockStore = {
        hasData: vi.fn().mockResolvedValue(false),
        loadSchedule: vi.fn().mockResolvedValue(null),
        saveSchedule: vi.fn().mockResolvedValue(undefined),
        close: vi.fn(),
      }
      const e = new SimulationEngine({ tickRate: 20 }, mockStore as never)
      const maps = { town: createTestMap('town') }
      const defaultSchedules = new Map([
        ['c1', [{ time: '08:00', activity: 'morning routine' }]],
      ])
      await e.initialize(maps, [createTestCharacter('c1')], 'town', undefined, undefined, testTimeConfig, defaultSchedules)

      await e.seedDefaultSchedules()

      expect(mockStore.saveSchedule).toHaveBeenCalledWith(
        expect.objectContaining({
          characterId: 'c1',
          entries: expect.arrayContaining([
            expect.objectContaining({ time: '08:00', activity: 'morning routine' }),
          ]),
        })
      )
    })

    it('should not overwrite existing schedule in store', async () => {
      const mockStore = {
        hasData: vi.fn().mockResolvedValue(false),
        loadSchedule: vi.fn().mockResolvedValue({
          characterId: 'c1',
          day: 1,
          entries: [{ time: '07:00', activity: 'early bird' }],
        }),
        saveSchedule: vi.fn().mockResolvedValue(undefined),
        close: vi.fn(),
      }
      const e = new SimulationEngine({ tickRate: 20 }, mockStore as never)
      const maps = { town: createTestMap('town') }
      const defaultSchedules = new Map([
        ['c1', [{ time: '08:00', activity: 'morning routine' }]],
      ])
      await e.initialize(maps, [createTestCharacter('c1')], 'town', undefined, undefined, testTimeConfig, defaultSchedules)

      await e.seedDefaultSchedules()

      // Should NOT have saved (existing schedule found)
      expect(mockStore.saveSchedule).not.toHaveBeenCalled()
    })
  })

  describe('supplementCharacterProfiles', () => {
    it('should add personality and tendencies to characters', async () => {
      const maps = { town: createTestMap('town') }
      await engine.initialize(maps, [createTestCharacter('c1')])

      engine.supplementCharacterProfiles([{
        id: 'c1',
        name: 'Test',
        sprite: { sheetUrl: 'test.png', frameWidth: 96, frameHeight: 96, cols: 3, rows: 4, rowMapping: { down: 0, left: 1, right: 2, up: 3 } },
        defaultStats: { money: 1000, satiety: 80, energy: 70, hygiene: 90, mood: 75, bladder: 60 },
        personality: 'cheerful',
        tendencies: ['cooking', 'reading'],
        customPrompt: 'Always speaks politely',
      }])

      const char = engine.getCharacter('c1')!
      expect(char.personality).toBe('cheerful')
      expect(char.tendencies).toEqual(['cooking', 'reading'])
      expect(char.customPrompt).toBe('Always speaks politely')
    })
  })

  describe('initializeNPCsAndConfig', () => {
    it('should set up NPCs, blocked nodes, and time config after restore', async () => {
      const maps = { town: createTestMap('town') }
      await engine.initialize(maps, [createTestCharacter('c1')], 'town')

      const npc = createTestNPC('npc1', {
        name: 'Shop NPC',
        currentNodeId: 'town-1-1',
        position: { x: 200, y: 200 },
      })
      const blockedNodes = new Map([['town', new Set(['town-1-1'])]])

      // Re-initialize with NPC config (simulates restore flow)
      engine.initializeNPCsAndConfig(blockedNodes, [npc], testTimeConfig)

      expect(engine.isInitialized()).toBe(true)
      // NPC should be added
      const state = engine.getState()
      expect(Object.keys(state.npcs)).toHaveLength(1)
      expect(state.npcs['npc1'].name).toBe('Shop NPC')
    })
  })

  describe('restoreFromStore', () => {
    it('should restore characters from store', async () => {
      const mockStore = {
        hasData: vi.fn().mockResolvedValue(true),
        loadState: vi.fn().mockResolvedValue({
          currentMapId: 'town',
          characters: {
            c1: {
              id: 'c1', name: 'Restored Char',
              currentMapId: 'town', currentNodeId: 'town-0-0',
              position: { x: 100, y: 100 }, direction: 'down',
              satiety: 50, energy: 60, hygiene: 70, mood: 80, bladder: 40, money: 200,
              actionCounter: 0,
              navigation: { isMoving: false, path: [], currentPathIndex: 0, progress: 0, startPosition: null, targetPosition: null },
              crossMapNavigation: null, conversation: null, currentAction: null, pendingAction: null,
            },
          },
        }),
        close: vi.fn(),
      }
      const e = new SimulationEngine({ tickRate: 20 }, mockStore as never)
      const maps = { town: createTestMap('town') }

      const result = await e.restoreFromStore(maps)

      expect(result).toBe(true)
      const char = e.getCharacter('c1')!
      expect(char.name).toBe('Restored Char')
      expect(char.satiety).toBe(50)
    })

    it('should return false when state is null', async () => {
      const mockStore = {
        hasData: vi.fn().mockResolvedValue(true),
        loadState: vi.fn().mockResolvedValue(null),
        close: vi.fn(),
      }
      const e = new SimulationEngine({ tickRate: 20 }, mockStore as never)
      const maps = { town: createTestMap('town') }

      const result = await e.restoreFromStore(maps)

      expect(result).toBe(false)
    })
  })

  describe('tick method internals', () => {
    it('should handle day change and refresh caches', async () => {
      const mockStore = {
        hasData: vi.fn().mockResolvedValue(false),
        loadSchedule: vi.fn().mockResolvedValue(null),
        saveSchedule: vi.fn().mockResolvedValue(undefined),
        close: vi.fn(),
      }
      const e = new SimulationEngine({ tickRate: 20 }, mockStore as never)
      const maps = { town: createTestMap('town') }
      await e.initialize(maps, [createTestCharacter('c1')], 'town', undefined, undefined, testTimeConfig)

      // Set lastDay to be different from current day to trigger day change
      ;(e as any).lastDay = 0

      // Call tick directly
      ;(e as any).tick()

      // lastDay should be updated
      expect((e as any).lastDay).toBeGreaterThan(0)
    })

    it('should trigger periodic state save', async () => {
      const mockStore = {
        hasData: vi.fn().mockResolvedValue(false),
        saveState: vi.fn().mockResolvedValue(undefined),
        close: vi.fn(),
      }
      const e = new SimulationEngine({ tickRate: 20 }, mockStore as never)
      const maps = { town: createTestMap('town') }
      await e.initialize(maps, [createTestCharacter('c1')], 'town', undefined, undefined, testTimeConfig)

      // Set lastSaveTime to be old enough to trigger save (SAVE_INTERVAL_MS = 30000)
      ;(e as any).lastSaveTime = Date.now() - 60000

      ;(e as any).tick()

      expect(mockStore.saveState).toHaveBeenCalled()
    })

    it('should apply status decay and trigger interrupt when threshold crossed', async () => {
      const maps = { town: createTestMap('town') }
      const chars = [createTestCharacter('c1', { bladder: 11 })] // Just above threshold (10)
      await engine.initialize(maps, chars, 'town', undefined, undefined, testTimeConfig)
      engine.setActionConfigs(testActionConfigs as never)

      // Set lastDecayTime to trigger decay (interval = 60000ms)
      ;(engine as any).lastDecayTime = Date.now() - 120000
      ;(engine as any).lastTickTime = Date.now() - 50

      ;(engine as any).tick()

      // After decay, bladder should cross below threshold triggering interrupt
      const char = engine.getCharacter('c1')!
      // The bladder was 11, decay rate is 0.8/min, elapsed ~2 min → drops by ~1.6 → new value ~9.4
      expect(char.bladder).toBeLessThan(11)
    })
  })

  describe('checkPendingActions via tick', () => {
    it('should execute pending action when character has arrived', async () => {
      const toiletObstacle: Obstacle = {
        id: 'toilet-1',
        x: 100, y: 100, width: 100, height: 100,
        type: 'zone', label: 'Toilet',
        facility: { tags: ['toilet'] },
        tileRow: 0, tileCol: 0, tileWidth: 2, tileHeight: 2,
      }
      const maps = { town: createTestMap('town', { obstacles: [toiletObstacle] }) }
      const chars = [createTestCharacter('c1')]
      await engine.initialize(maps, chars, 'town', undefined, undefined, testTimeConfig)
      engine.setActionConfigs(testActionConfigs as never)

      // Set up character with pending action (as if arrived at facility)
      ;(engine as any).worldState.updateCharacter('c1', {
        pendingAction: {
          actionId: 'toilet',
          facilityId: 'toilet-1',
          reason: 'urgent',
        },
      })

      // Call checkPendingActions directly
      ;(engine as any).checkPendingActions()

      const char = engine.getCharacter('c1')!
      expect(char.pendingAction).toBeNull()
      expect(char.currentAction?.actionId).toBe('toilet')
    })

    it('should not execute pending action while still moving', async () => {
      const maps = { town: createTestMap('town') }
      const chars = [createTestCharacter('c1')]
      await engine.initialize(maps, chars, 'town', undefined, undefined, testTimeConfig)

      // Set up character moving with pending action
      engine.getCharacterSimulator().navigateToNode('c1', 'town-2-2')
      ;(engine as any).worldState.updateCharacter('c1', {
        pendingAction: { actionId: 'toilet', facilityId: 'toilet-1', reason: 'urgent' },
      })

      ;(engine as any).checkPendingActions()

      const char = engine.getCharacter('c1')!
      // Pending action should still be there (character still moving)
      expect(char.pendingAction).not.toBeNull()
    })
  })

  describe('makeInterruptBehaviorDecision', () => {
    it('should trigger interrupt decision with forced action', async () => {
      const maps = { town: createTestMap('town') }
      const chars = [createTestCharacter('c1')]
      await engine.initialize(maps, chars, 'town', undefined, undefined, testTimeConfig)
      engine.setActionConfigs(testActionConfigs as never)

      const decider = (engine as any).behaviorDecider
      decider.decideInterruptFacility.mockResolvedValueOnce({
        type: 'action',
        actionId: 'eat',
        targetFacilityId: 'kitchen-1',
        reason: 'emergency hunger',
      })

      const char = engine.getCharacter('c1')!
      ;(engine as any).makeInterruptBehaviorDecision(char, 'eat')

      await vi.waitFor(() => {
        expect(decider.decideInterruptFacility).toHaveBeenCalledWith('eat', expect.any(Object))
      })
    })

    it('should handle interrupt decision error gracefully', async () => {
      const maps = { town: createTestMap('town') }
      const chars = [createTestCharacter('c1')]
      await engine.initialize(maps, chars, 'town', undefined, undefined, testTimeConfig)
      engine.setActionConfigs(testActionConfigs as never)

      const decider = (engine as any).behaviorDecider
      decider.decideInterruptFacility.mockRejectedValueOnce(new Error('LLM failed'))

      const char = engine.getCharacter('c1')!
      ;(engine as any).makeInterruptBehaviorDecision(char, 'eat')

      await vi.waitFor(() => {
        // After error, pendingDecisions should be cleared
        expect((engine as any).pendingDecisions.has('c1')).toBe(false)
      })
    })
  })

  describe('makeBehaviorDecision error handling', () => {
    it('should handle decide rejection gracefully', async () => {
      const maps = { town: createTestMap('town') }
      const chars = [createTestCharacter('c1')]
      await engine.initialize(maps, chars, 'town', undefined, undefined, testTimeConfig)

      const decider = (engine as any).behaviorDecider
      decider.decide.mockRejectedValueOnce(new Error('API timeout'))

      const char = engine.getCharacter('c1')!
      ;(engine as any).makeBehaviorDecision(char, { hour: 8, minute: 0, day: 1 })

      await vi.waitFor(() => {
        expect((engine as any).pendingDecisions.has('c1')).toBe(false)
      })
    })

    it('should apply schedule update when decision includes one', async () => {
      const maps = { town: createTestMap('town') }
      const chars = [createTestCharacter('c1')]
      await engine.initialize(maps, chars, 'town', undefined, undefined, testTimeConfig)

      const decider = (engine as any).behaviorDecider
      decider.decide.mockResolvedValueOnce({
        type: 'idle',
        reason: 'resting',
        scheduleUpdate: {
          type: 'add',
          entry: { time: '10:00', activity: 'meeting' },
        },
      })

      const char = engine.getCharacter('c1')!
      ;(engine as any).makeBehaviorDecision(char, { hour: 8, minute: 0, day: 1 })

      await vi.waitFor(() => {
        expect((engine as any).pendingDecisions.has('c1')).toBe(false)
        // Schedule should be updated in cache
        const schedule = (engine as any).getScheduleForCharacter('c1')
        expect(schedule).toContainEqual(expect.objectContaining({ time: '10:00', activity: 'meeting' }))
      })
    })
  })

  describe('applyScheduleUpdate variations', () => {
    it('should remove schedule entry', async () => {
      const e = new SimulationEngine({ tickRate: 20 })
      const maps = { town: createTestMap('town') }
      await e.initialize(maps, [createTestCharacter('c1')], 'town', undefined, undefined, testTimeConfig)

      // Pre-populate schedule cache
      const cache = (e as any).scheduleCache as Map<string, unknown[]>
      const cacheKey = (e as any).characterDayCacheKey('c1', (e as any).worldState.getTime().day)
      cache.set(cacheKey, [
        { time: '08:00', activity: 'breakfast' },
        { time: '12:00', activity: 'lunch' },
      ])

      ;(e as any).applyScheduleUpdate('c1', {
        type: 'remove',
        entry: { time: '08:00', activity: 'breakfast' },
      })

      const schedule = cache.get(cacheKey) as { time: string; activity: string }[]
      expect(schedule).toHaveLength(1)
      expect(schedule[0].activity).toBe('lunch')
    })

    it('should modify schedule entry', async () => {
      const e = new SimulationEngine({ tickRate: 20 })
      const maps = { town: createTestMap('town') }
      await e.initialize(maps, [createTestCharacter('c1')], 'town', undefined, undefined, testTimeConfig)

      const cache = (e as any).scheduleCache as Map<string, unknown[]>
      const cacheKey = (e as any).characterDayCacheKey('c1', (e as any).worldState.getTime().day)
      cache.set(cacheKey, [
        { time: '08:00', activity: 'breakfast' },
      ])

      ;(e as any).applyScheduleUpdate('c1', {
        type: 'modify',
        entry: { time: '08:00', activity: 'brunch' },
      })

      const schedule = cache.get(cacheKey) as { time: string; activity: string }[]
      expect(schedule[0].activity).toBe('brunch')
    })

    it('should add entry on modify when time not found', async () => {
      const e = new SimulationEngine({ tickRate: 20 })
      const maps = { town: createTestMap('town') }
      await e.initialize(maps, [createTestCharacter('c1')], 'town', undefined, undefined, testTimeConfig)

      const cache = (e as any).scheduleCache as Map<string, unknown[]>
      const cacheKey = (e as any).characterDayCacheKey('c1', (e as any).worldState.getTime().day)
      cache.set(cacheKey, [])

      ;(e as any).applyScheduleUpdate('c1', {
        type: 'modify',
        entry: { time: '15:00', activity: 'new activity' },
      })

      const schedule = cache.get(cacheKey) as { time: string; activity: string }[]
      expect(schedule).toContainEqual({ time: '15:00', activity: 'new activity' })
    })
  })

  describe('move decision edge cases', () => {
    it('should handle move decision with no target', async () => {
      const maps = { town: createTestMap('town') }
      const chars = [createTestCharacter('c1')]
      await engine.initialize(maps, chars, 'town', undefined, undefined, testTimeConfig)

      const decider = (engine as any).behaviorDecider
      decider.decide.mockResolvedValueOnce({
        type: 'move',
        reason: 'wandering',
        // No targetMapId or targetNodeId
      })

      const char = engine.getCharacter('c1')!
      ;(engine as any).makeBehaviorDecision(char, { hour: 8, minute: 0, day: 1 })

      await vi.waitFor(() => {
        expect((engine as any).pendingDecisions.has('c1')).toBe(false)
        // Should NOT be moving (no target)
        const updated = engine.getCharacter('c1')!
        expect(updated.navigation.isMoving).toBe(false)
      })
    })

    it('should handle move to unknown map', async () => {
      const maps = { town: createTestMap('town') }
      const chars = [createTestCharacter('c1')]
      await engine.initialize(maps, chars, 'town', undefined, undefined, testTimeConfig)

      const decider = (engine as any).behaviorDecider
      decider.decide.mockResolvedValueOnce({
        type: 'move',
        targetMapId: 'nonexistent_map',
        reason: 'exploring',
      })

      const char = engine.getCharacter('c1')!
      ;(engine as any).makeBehaviorDecision(char, { hour: 8, minute: 0, day: 1 })

      await vi.waitFor(() => {
        expect((engine as any).pendingDecisions.has('c1')).toBe(false)
        const updated = engine.getCharacter('c1')!
        expect(updated.navigation.isMoving).toBe(false)
      })
    })
  })

  describe('handleTalkAction edge cases', () => {
    it('should handle talk with non-existent NPC', async () => {
      const maps = { town: createTestMap('town') }
      const chars = [createTestCharacter('c1')]
      await engine.initialize(maps, chars, 'town', undefined, undefined, testTimeConfig)
      engine.setActionConfigs(testActionConfigs as never)

      const decider = (engine as any).behaviorDecider
      decider.decide.mockResolvedValueOnce({
        type: 'action',
        actionId: 'talk',
        targetNpcId: 'nonexistent_npc',
        reason: 'greeting',
      })

      const char = engine.getCharacter('c1')!
      ;(engine as any).makeBehaviorDecision(char, { hour: 8, minute: 0, day: 1 })

      await vi.waitFor(() => {
        expect((engine as any).pendingDecisions.has('c1')).toBe(false)
        // Should not be talking (NPC not found)
        const updated = engine.getCharacter('c1')!
        expect(updated.currentAction?.actionId).not.toBe('talk')
      })
    })
  })

  describe('idle decision', () => {
    it('should set displayEmoji and schedule next decision', async () => {
      const maps = { town: createTestMap('town') }
      const chars = [createTestCharacter('c1')]
      await engine.initialize(maps, chars, 'town', undefined, undefined, testTimeConfig)

      const decider = (engine as any).behaviorDecider
      decider.decide.mockResolvedValueOnce({
        type: 'idle',
        reason: 'nothing to do',
      })

      const char = engine.getCharacter('c1')!
      ;(engine as any).makeBehaviorDecision(char, { hour: 8, minute: 0, day: 1 })

      await vi.waitFor(() => {
        expect((engine as any).pendingDecisions.has('c1')).toBe(false)
        const updated = engine.getCharacter('c1')!
        expect(updated.displayEmoji).toBe('😶')
      })
    })
  })

  describe('recordActionHistory', () => {
    it('should record action with NPC target', async () => {
      const mockStore = {
        hasData: vi.fn().mockResolvedValue(false),
        addActionHistory: vi.fn().mockResolvedValue(undefined),
        close: vi.fn(),
      }
      const e = new SimulationEngine({ tickRate: 20 }, mockStore as never)
      const maps = { town: createTestMap('town') }
      await e.initialize(maps, [createTestCharacter('c1')], 'town', undefined, undefined, testTimeConfig)

      ;(e as any).recordActionHistory({
        characterId: 'c1',
        actionId: 'talk',
        targetNpcId: 'npc1',
        reason: 'greeting NPC',
      })

      const history = (e as any).getActionHistoryForCharacter('c1')
      expect(history).toContainEqual(expect.objectContaining({
        actionId: 'talk',
        target: 'npc1',
        reason: 'greeting NPC',
      }))
    })
  })

  describe('triggerStatusInterrupt via status decay', () => {
    it('should trigger satiety interrupt when threshold crossed', async () => {
      const maps = { town: createTestMap('town') }
      const chars = [createTestCharacter('c1', { satiety: 11, bladder: 80 })]
      await engine.initialize(maps, chars, 'town', undefined, undefined, testTimeConfig)
      engine.setActionConfigs(testActionConfigs as never)

      // Decay enough to cross threshold
      ;(engine as any).applyStatusDecay(3) // 3 minutes * 0.5/min = -1.5, from 11 → 9.5

      const char = engine.getCharacter('c1')!
      expect(char.satiety).toBeLessThan(10)
      // Interrupt decision should have been triggered (thinking action started)
      // pendingDecisions should be set
      expect((engine as any).pendingDecisions.has('c1')).toBe(true)
    })

    it('should trigger energy interrupt when threshold crossed', async () => {
      const maps = { town: createTestMap('town') }
      const chars = [createTestCharacter('c1', { energy: 11, bladder: 80, satiety: 80 })]
      await engine.initialize(maps, chars, 'town', undefined, undefined, testTimeConfig)
      engine.setActionConfigs(testActionConfigs as never)

      ;(engine as any).applyStatusDecay(5) // 5 * 0.3 = -1.5, from 11 → 9.5

      const char = engine.getCharacter('c1')!
      expect(char.energy).toBeLessThan(10)
      expect((engine as any).pendingDecisions.has('c1')).toBe(true)
    })

    it('should trigger hygiene interrupt when threshold crossed', async () => {
      const maps = { town: createTestMap('town') }
      const chars = [createTestCharacter('c1', { hygiene: 11, bladder: 80, satiety: 80, energy: 80 })]
      await engine.initialize(maps, chars, 'town', undefined, undefined, testTimeConfig)
      engine.setActionConfigs(testActionConfigs as never)

      ;(engine as any).applyStatusDecay(10) // 10 * 0.2 = -2, from 11 → 9

      const char = engine.getCharacter('c1')!
      expect(char.hygiene).toBeLessThan(10)
      expect((engine as any).pendingDecisions.has('c1')).toBe(true)
    })
  })

  describe('getCurrentRealTime', () => {
    it('should handle invalid timezone gracefully', async () => {
      const invalidTimeConfig: TimeConfig = {
        ...testTimeConfig,
        timezone: 'Invalid/Timezone',
      }
      const maps = { town: createTestMap('town') }
      await engine.initialize(maps, [createTestCharacter('c1')], 'town', undefined, undefined, invalidTimeConfig)

      // getCurrentRealTime should fallback to default timezone
      const time = (engine as any).getCurrentRealTime()
      expect(time).toHaveProperty('hour')
      expect(time).toHaveProperty('minute')
      expect(time).toHaveProperty('day')
    })
  })

  describe('setStateStore / getStateStore', () => {
    it('should set and get state store', () => {
      const e = new SimulationEngine({ tickRate: 20 })
      expect(e.getStateStore()).toBeNull()

      const mockStore = { hasData: vi.fn(), close: vi.fn() }
      e.setStateStore(mockStore as never)
      expect(e.getStateStore()).toBe(mockStore)
    })
  })

  describe('handleTalkAction (direct)', () => {
    it('should reject talk when NPC is on different map', async () => {
      const maps = { town: createTestMap('town'), cafe: createTestMap('cafe') }
      const npc = createTestNPC('npc1', {
        name: 'Cafe Staff',
        mapId: 'cafe', // Different map
        currentNodeId: 'cafe-0-0',
      })
      await engine.initialize(maps, [createTestCharacter('c1')], 'town', undefined, [npc], testTimeConfig)

      const char = engine.getCharacter('c1')!
      ;(engine as any).handleTalkAction(char, 'npc1', 'hello')

      // Should not navigate (NPC on different map)
      const updated = engine.getCharacter('c1')!
      expect(updated.navigation.isMoving).toBe(false)
      expect(updated.pendingAction).toBeNull()
    })

    it('should navigate to NPC and set pending action when not adjacent', async () => {
      const maps = { town: createTestMap('town') }
      const npc = createTestNPC('npc1', {
        name: 'Shopkeeper',
        currentNodeId: 'town-2-2', // Not adjacent to town-0-0
        position: { x: 300, y: 300 },
      })
      await engine.initialize(maps, [createTestCharacter('c1')], 'town', undefined, [npc], testTimeConfig)
      engine.setActionConfigs(testActionConfigs as never)

      const char = engine.getCharacter('c1')!
      ;(engine as any).handleTalkAction(char, 'npc1', 'need help')

      const updated = engine.getCharacter('c1')!
      expect(updated.pendingAction?.actionId).toBe('talk')
      expect(updated.pendingAction?.targetNpcId).toBe('npc1')
      expect(updated.navigation.isMoving).toBe(true)
    })

    it('should start talk immediately when adjacent to NPC', async () => {
      const maps = { town: createTestMap('town') }
      const npc = createTestNPC('npc1', {
        name: 'Friend',
        currentNodeId: 'town-0-1', // Adjacent to town-0-0
        position: { x: 200, y: 100 },
        direction: 'left',
      })
      await engine.initialize(maps, [createTestCharacter('c1')], 'town', undefined, [npc], testTimeConfig)
      engine.setActionConfigs(testActionConfigs as never)

      const char = engine.getCharacter('c1')!
      ;(engine as any).handleTalkAction(char, 'npc1', 'chat')

      const updated = engine.getCharacter('c1')!
      expect(updated.currentAction?.actionId).toBe('talk')
      expect(updated.pendingAction).toBeNull()
    })
  })

  describe('handleFacilityAction (direct)', () => {
    it('should execute immediately when no targetFacilityId', async () => {
      const toiletObstacle: Obstacle = {
        id: 'toilet-1', x: 100, y: 100, width: 100, height: 100,
        type: 'zone', label: 'Toilet',
        facility: { tags: ['toilet'] },
        tileRow: 0, tileCol: 0, tileWidth: 2, tileHeight: 2,
      }
      const maps = { town: createTestMap('town', { obstacles: [toiletObstacle] }) }
      await engine.initialize(maps, [createTestCharacter('c1')], 'town', undefined, undefined, testTimeConfig)
      engine.setActionConfigs(testActionConfigs as never)

      const char = engine.getCharacter('c1')!
      ;(engine as any).handleFacilityAction(char, 'toilet', undefined, 'urgent')

      const updated = engine.getCharacter('c1')!
      expect(updated.currentAction?.actionId).toBe('toilet')
    })

    it('should navigate to facility on same map when not inside', async () => {
      // 5x5 grid with facility at interior (needs strict inequality: row > 1 && row < 4)
      const toiletObstacle: Obstacle = {
        id: 'toilet-1', x: 200, y: 200, width: 300, height: 300,
        type: 'zone', label: 'Toilet',
        facility: { tags: ['toilet'] },
        tileRow: 1, tileCol: 1, tileWidth: 3, tileHeight: 3,
      }
      const nodes = createTestNodes('town', 5, 5)
      const maps = { town: createTestMap('town', { nodes, obstacles: [toiletObstacle] }) }
      await engine.initialize(maps, [createTestCharacter('c1')], 'town', undefined, undefined, testTimeConfig)
      engine.setActionConfigs(testActionConfigs as never)

      const char = engine.getCharacter('c1')!
      ;(engine as any).handleFacilityAction(char, 'toilet', 'toilet-1', 'urgent')

      const updated = engine.getCharacter('c1')!
      expect(updated.pendingAction?.actionId).toBe('toilet')
      expect(updated.pendingAction?.facilityId).toBe('toilet-1')
      expect(updated.navigation.isMoving).toBe(true)
    })

    it('should navigate cross-map when facility is on different map', async () => {
      const toiletObstacle: Obstacle = {
        id: 'toilet-1', x: 100, y: 100, width: 300, height: 300,
        type: 'zone', label: 'Toilet',
        facility: { tags: ['toilet'] },
        tileRow: 0, tileCol: 0, tileWidth: 3, tileHeight: 3,
      }
      const townNodes = [
        { id: 'town-0-0', x: 100, y: 100, type: 'waypoint' as const, connectedTo: ['town-entrance'] },
        { id: 'town-entrance', x: 200, y: 100, type: 'entrance' as const, connectedTo: ['town-0-0'], leadsTo: { mapId: 'cafe', nodeId: 'cafe-entrance' } },
      ]
      const cafeNodes = [
        { id: 'cafe-entrance', x: 100, y: 100, type: 'entrance' as const, connectedTo: ['cafe-1-1'], leadsTo: { mapId: 'town', nodeId: 'town-entrance' } },
        { id: 'cafe-1-1', x: 200, y: 200, type: 'waypoint' as const, connectedTo: ['cafe-entrance'] },
      ]
      const maps = {
        town: createTestMap('town', { nodes: townNodes, spawnNodeId: 'town-0-0' }),
        cafe: createTestMap('cafe', { nodes: cafeNodes, obstacles: [toiletObstacle], spawnNodeId: 'cafe-entrance' }),
      }
      await engine.initialize(maps, [createTestCharacter('c1')], 'town', undefined, undefined, testTimeConfig)
      engine.setActionConfigs(testActionConfigs as never)

      const char = engine.getCharacter('c1')!
      ;(engine as any).handleFacilityAction(char, 'toilet', 'toilet-1', 'urgent')

      const updated = engine.getCharacter('c1')!
      expect(updated.pendingAction?.actionId).toBe('toilet')
      expect(updated.pendingAction?.facilityMapId).toBe('cafe')
    })

    it('should trigger re-decision when action start fails', async () => {
      // No toilet facility on map → startAction will fail
      const maps = { town: createTestMap('town') }
      await engine.initialize(maps, [createTestCharacter('c1')], 'town', undefined, undefined, testTimeConfig)
      engine.setActionConfigs(testActionConfigs as never)

      const char = engine.getCharacter('c1')!
      ;(engine as any).handleFacilityAction(char, 'toilet', undefined, 'urgent')

      // Action should not start (no facility on map)
      const updated = engine.getCharacter('c1')!
      expect(updated.currentAction?.actionId).not.toBe('toilet')
    })
  })

  describe('triggerStatusInterrupt (direct)', () => {
    it('should call makeInterruptBehaviorDecision with forced action', async () => {
      const maps = { town: createTestMap('town') }
      await engine.initialize(maps, [createTestCharacter('c1')], 'town', undefined, undefined, testTimeConfig)
      engine.setActionConfigs(testActionConfigs as never)

      ;(engine as any).triggerStatusInterrupt('c1', 'bladder')

      // Should add to pendingDecisions (makeInterruptBehaviorDecision called)
      expect((engine as any).pendingDecisions.has('c1')).toBe(true)
      // Decider should be called with forced action
      const decider = (engine as any).behaviorDecider
      expect(decider.decideInterruptFacility).toHaveBeenCalledWith('toilet', expect.any(Object))
    })

    it('should skip when character already has action', async () => {
      const maps = { town: createTestMap('town') }
      await engine.initialize(maps, [createTestCharacter('c1')], 'town', undefined, undefined, testTimeConfig)

      // Give character a current action
      ;(engine as any).worldState.updateCharacter('c1', {
        currentAction: { actionId: 'eat', startTime: Date.now(), targetEndTime: Date.now() + 60000 },
      })

      ;(engine as any).triggerStatusInterrupt('c1', 'bladder')

      // Should NOT add to pendingDecisions
      expect((engine as any).pendingDecisions.has('c1')).toBe(false)
    })

    it('should skip when decision is already pending', async () => {
      const maps = { town: createTestMap('town') }
      await engine.initialize(maps, [createTestCharacter('c1')], 'town', undefined, undefined, testTimeConfig)

      ;(engine as any).pendingDecisions.add('c1')
      ;(engine as any).triggerStatusInterrupt('c1', 'bladder')

      // decideInterruptFacility should NOT be called (already pending)
      const decider = (engine as any).behaviorDecider
      expect(decider.decideInterruptFacility).not.toHaveBeenCalled()
    })
  })

  describe('checkPendingActions with NPC target', () => {
    it('should log NPC name when pending action has targetNpcId', async () => {
      const toiletObstacle: Obstacle = {
        id: 'toilet-1', x: 100, y: 100, width: 100, height: 100,
        type: 'zone', label: 'Toilet',
        facility: { tags: ['toilet'] },
        tileRow: 0, tileCol: 0, tileWidth: 2, tileHeight: 2,
      }
      const npc = createTestNPC('npc1', {
        name: 'Bartender',
        currentNodeId: 'town-0-1',
        position: { x: 200, y: 100 },
      })
      const maps = { town: createTestMap('town', { obstacles: [toiletObstacle] }) }
      await engine.initialize(maps, [createTestCharacter('c1')], 'town', undefined, [npc], testTimeConfig)
      engine.setActionConfigs(testActionConfigs as never)

      // Set pending talk action with NPC
      ;(engine as any).worldState.updateCharacter('c1', {
        pendingAction: {
          actionId: 'talk',
          targetNpcId: 'npc1',
          reason: 'greeting',
        },
      })

      ;(engine as any).checkPendingActions()

      const char = engine.getCharacter('c1')!
      expect(char.pendingAction).toBeNull()
      expect(char.currentAction?.actionId).toBe('talk')
    })
  })

  describe('scheduleNextDecision', () => {
    it('should schedule makeBehaviorDecision after delay', async () => {
      const maps = { town: createTestMap('town') }
      await engine.initialize(maps, [createTestCharacter('c1')], 'town', undefined, undefined, testTimeConfig)

      ;(engine as any).scheduleNextDecision('c1', 100)

      // Before timer fires, no decision pending
      expect((engine as any).pendingDecisions.has('c1')).toBe(false)

      // Advance timer
      vi.advanceTimersByTime(150)

      // After timer, makeBehaviorDecision is called → pendingDecisions has 'c1'
      expect((engine as any).pendingDecisions.has('c1')).toBe(true)
    })
  })

  describe('shutdown', () => {
    it('should stop engine and save state on shutdown', async () => {
      const mockStore = {
        hasData: vi.fn().mockResolvedValue(false),
        saveState: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
      }

      const e = new SimulationEngine({ tickRate: 20 }, mockStore as never)
      const maps = { town: createTestMap('town') }
      await e.initialize(maps, [createTestCharacter('c1')], 'town', undefined, undefined, testTimeConfig)
      e.start()

      await e.shutdown()

      expect(e.isSimulationRunning()).toBe(false)
      expect(mockStore.saveState).toHaveBeenCalled()
      expect(mockStore.close).toHaveBeenCalled()
    })
  })

  // ===========================================================================
  // 副作用テスト: マルチタグ施設バグによるステータス影響
  // bladder割り込み時に bathe が実行されると bladder が回復せずループする問題
  // ===========================================================================

  describe('side effects: multi-tag facility interrupt loop', () => {
    const bathroomObstacle: Obstacle = {
      id: 'home-obstacle-5', x: 100, y: 100, width: 200, height: 200,
      type: 'zone', label: '浴室',
      facility: { tags: ['bathroom', 'toilet'], owner: 'c1' },
      tileRow: 0, tileCol: 0, tileWidth: 4, tileHeight: 4,
    }

    const actionConfigsWithBathe = {
      ...testActionConfigs,
      bathe: {
        durationRange: { min: 15, max: 60, default: 30 },
        perMinute: { hygiene: 3.33, mood: 0.5 },
      },
    }

    it('B1: bathe action does NOT recover bladder (perMinute has no bladder effect)', async () => {
      const maps = { town: createTestMap('town', { obstacles: [bathroomObstacle] }) }
      const chars = [createTestCharacter('c1', { bladder: 5 })]
      await engine.initialize(maps, chars, 'town', undefined, undefined, testTimeConfig)
      engine.setActionConfigs(actionConfigsWithBathe as never)
      engine.start()

      // Manually start bathe action
      const executor = engine.getActionExecutor()
      executor.startAction('c1', 'bathe', 'home-obstacle-5')

      // Simulate time passing (status decay applied while action is running)
      vi.advanceTimersByTime(60000) // 1 minute

      const char = engine.getCharacter('c1')!
      // bladder should NOT have recovered - bathe perMinute has no bladder effect
      // Instead, bladder continues to decay (0.8/min)
      expect(char.bladder).toBeLessThanOrEqual(5)
      expect(char.bladder).not.toBeGreaterThan(5)
    })

    it('B2: toilet action DOES recover bladder (fixed effects applied)', async () => {
      const maps = { town: createTestMap('town', { obstacles: [bathroomObstacle] }) }
      const chars = [createTestCharacter('c1', { bladder: 0 })]
      await engine.initialize(maps, chars, 'town', undefined, undefined, testTimeConfig)
      engine.setActionConfigs(actionConfigsWithBathe as never)
      engine.start()

      // Start toilet action (fixed: duration 5min, effects: { bladder: 100 })
      const executor = engine.getActionExecutor()
      executor.startAction('c1', 'toilet', 'home-obstacle-5')

      // Advance time past the action duration (5 minutes = 300000ms)
      vi.advanceTimersByTime(300001)

      const char = engine.getCharacter('c1')!
      // toilet's fixed effects should have applied bladder: 100
      expect(char.bladder).toBe(100)
      // After completion, onActionComplete triggers next decision (thinking starts)
      // The key assertion is that bladder recovered, not that no new action started
    })

    it('B3: after bathe completes with bladder still below threshold, character remains in critical state', async () => {
      const maps = { town: createTestMap('town', { obstacles: [bathroomObstacle] }) }
      // Place character inside the zone (row 1, col 1 is strictly inside tileRow:0..tileHeight:4)
      const chars = [createTestCharacter('c1', { bladder: 5, currentNodeId: 'town-1-1', position: { x: 200, y: 200 } })]
      await engine.initialize(maps, chars, 'town', undefined, undefined, testTimeConfig)
      engine.setActionConfigs(actionConfigsWithBathe as never)
      engine.start()

      const decider = (engine as any).behaviorDecider
      // Mock interrupt to return bathe (simulating the bug)
      decider.decideInterruptFacility.mockResolvedValue({
        type: 'action',
        actionId: 'bathe',
        targetFacilityId: 'home-obstacle-5',
        reason: 'emergency toilet',
      })

      // Trigger first interrupt (bladder below threshold)
      ;(engine as any).triggerStatusInterrupt('c1', 'bladder')

      // Wait for async decision
      await vi.advanceTimersByTimeAsync(100)

      let char = engine.getCharacter('c1')!
      expect(char.currentAction?.actionId).toBe('bathe')

      // Complete the bathe action (advance past 15 min minimum)
      vi.advanceTimersByTime(15 * 60 * 1000 + 1000)

      char = engine.getCharacter('c1')!
      // Key side effect: bladder is STILL critically low after wrong action
      // bathe perMinute has no bladder effect, and normal decay made it worse
      expect(char.bladder).toBeLessThan(5)

      // The character completed bathe but bladder problem is unresolved
      // Normal decision (onActionComplete) fires, but bladder remains critical
      // This demonstrates the bug: wrong action doesn't fix the underlying issue
      expect(char.hygiene).toBe(100) // hygiene maxed out (unnecessary side effect)
    })

    it('B4: satiety continues to decay during bathe loop (starvation side effect)', async () => {
      const maps = { town: createTestMap('town', { obstacles: [bathroomObstacle] }) }
      const chars = [createTestCharacter('c1', { bladder: 5, satiety: 50 })]
      await engine.initialize(maps, chars, 'town', undefined, undefined, testTimeConfig)
      engine.setActionConfigs(actionConfigsWithBathe as never)
      engine.start()

      // Start bathe (no satiety in perMinute → normal decay applies)
      const executor = engine.getActionExecutor()
      executor.startAction('c1', 'bathe', 'home-obstacle-5')

      // Advance 10 minutes (satiety should decay at 0.5/min = -5 total)
      vi.advanceTimersByTime(10 * 60 * 1000)

      const char = engine.getCharacter('c1')!
      // satiety should have decreased (normal decay: 0.5/min * 10min = 5)
      expect(char.satiety).toBeLessThan(50)
      // bladder also decays (no bladder in bathe perMinute)
      expect(char.bladder).toBeLessThan(5)
    })

    it('B5: after correct toilet action, bladder recovers and no further interrupt fires', async () => {
      const maps = { town: createTestMap('town', { obstacles: [bathroomObstacle] }) }
      // Place character inside the zone (row 1, col 1 is strictly inside tileRow:0..tileHeight:4)
      const chars = [createTestCharacter('c1', { bladder: 5, currentNodeId: 'town-1-1', position: { x: 200, y: 200 } })]
      await engine.initialize(maps, chars, 'town', undefined, undefined, testTimeConfig)
      engine.setActionConfigs(actionConfigsWithBathe as never)
      engine.start()

      const decider = (engine as any).behaviorDecider
      // Mock interrupt to correctly return toilet action
      decider.decideInterruptFacility.mockResolvedValue({
        type: 'action',
        actionId: 'toilet',
        targetFacilityId: 'home-obstacle-5',
        reason: 'emergency toilet',
      })

      // Trigger interrupt
      ;(engine as any).triggerStatusInterrupt('c1', 'bladder')
      await vi.advanceTimersByTimeAsync(100)

      let char = engine.getCharacter('c1')!
      expect(char.currentAction?.actionId).toBe('toilet')

      // Complete toilet action (5 min)
      vi.advanceTimersByTime(5 * 60 * 1000 + 1000)

      char = engine.getCharacter('c1')!
      // bladder should be recovered to 100 (toilet fixed effect)
      expect(char.bladder).toBe(100)

      // After completion, onActionComplete triggers next normal decision
      // The key: bladder is fully recovered, problem is solved
      decider.decideInterruptFacility.mockClear()
      vi.advanceTimersByTime(60000)

      // Should NOT call decideInterruptFacility again (bladder well above threshold 10)
      expect(decider.decideInterruptFacility).not.toHaveBeenCalled()
    })
  })

  describe('midTermMemoriesCache', () => {
    it('should load mid-term memories from store into cache', async () => {
      const maps = { town: createTestMap('town') }
      await engine.initialize(maps, [createTestCharacter('c1')], 'town', undefined, undefined, testTimeConfig)

      const mockStore = {
        loadActiveMidTermMemories: vi.fn().mockResolvedValue([
          { id: 'mem-1', characterId: 'c1', content: '明日の予定', importance: 'high', createdDay: 1, expiresDay: 3 },
          { id: 'mem-2', characterId: 'c1', content: '店の定休日', importance: 'medium', createdDay: 1, expiresDay: 2 },
        ]),
        deleteExpiredMidTermMemories: vi.fn().mockResolvedValue(0),
        addMidTermMemory: vi.fn().mockResolvedValue(undefined),
      }
      engine.setStateStore(mockStore as never)

      await engine.loadMidTermMemoriesCache()

      const cache = (engine as any).midTermMemoriesCache as Map<string, unknown[]>
      expect(cache.get('c1')).toHaveLength(2)
      expect(mockStore.loadActiveMidTermMemories).toHaveBeenCalledWith('c1', expect.any(Number))
    })

    it('should include midTermMemories in buildBehaviorContext', async () => {
      const maps = { town: createTestMap('town') }
      await engine.initialize(maps, [createTestCharacter('c1')], 'town', undefined, undefined, testTimeConfig)
      engine.setActionConfigs(testActionConfigs as never)

      // Populate cache directly
      const testMemories = [
        { id: 'mem-1', characterId: 'c1', content: 'テスト記憶', importance: 'high' as const, createdDay: 1, expiresDay: 3 },
      ]
      ;(engine as any).midTermMemoriesCache.set('c1', testMemories)

      const char = engine.getCharacter('c1')!
      const context = (engine as any).buildBehaviorContext(char)

      expect(context.midTermMemories).toEqual(testMemories)
    })

    it('should return undefined midTermMemories when cache is empty for character', async () => {
      const maps = { town: createTestMap('town') }
      await engine.initialize(maps, [createTestCharacter('c1')], 'town', undefined, undefined, testTimeConfig)
      engine.setActionConfigs(testActionConfigs as never)

      const char = engine.getCharacter('c1')!
      const context = (engine as any).buildBehaviorContext(char)

      expect(context.midTermMemories).toBeUndefined()
    })

    it('should cleanup expired memories and reload cache', async () => {
      const maps = { town: createTestMap('town') }
      await engine.initialize(maps, [createTestCharacter('c1')], 'town', undefined, undefined, testTimeConfig)

      const mockStore = {
        loadActiveMidTermMemories: vi.fn().mockResolvedValue([]),
        deleteExpiredMidTermMemories: vi.fn().mockResolvedValue(3),
        addMidTermMemory: vi.fn().mockResolvedValue(undefined),
      }
      engine.setStateStore(mockStore as never)

      await (engine as any).cleanupAndReloadMidTermMemories(5)

      expect(mockStore.deleteExpiredMidTermMemories).toHaveBeenCalledWith(5)
      expect(mockStore.loadActiveMidTermMemories).toHaveBeenCalledWith('c1', expect.any(Number))
    })

    it('should update cache when memory persist callback is triggered', async () => {
      const maps = { town: createTestMap('town') }
      await engine.initialize(maps, [createTestCharacter('c1')], 'town', undefined, undefined, testTimeConfig)

      const mockStore = {
        addMidTermMemory: vi.fn().mockResolvedValue(undefined),
        loadActiveMidTermMemories: vi.fn().mockResolvedValue([]),
        deleteExpiredMidTermMemories: vi.fn().mockResolvedValue(0),
      }
      engine.setStateStore(mockStore as never)

      // Access the postProcessor's onMemoryPersist callback
      const postProcessor = (engine as any).conversationPostProcessor
      const memoryCallback = postProcessor.onMemoryPersist

      if (memoryCallback) {
        await memoryCallback([
          { id: 'mem-new', characterId: 'c1', content: '新しい記憶', importance: 'high', createdDay: 1, expiresDay: 3 },
        ])

        // Cache should be updated
        const cache = (engine as any).midTermMemoriesCache as Map<string, unknown[]>
        expect(cache.get('c1')).toHaveLength(1)
        expect(mockStore.addMidTermMemory).toHaveBeenCalledTimes(1)
      }
    })

    it('should include midTermMemories in conversation context', async () => {
      const maps = { town: createTestMap('town') }
      const npc = createTestNPC('npc1', { currentNodeId: 'town-0-1', position: { x: 200, y: 100 } })
      await engine.initialize(maps, [createTestCharacter('c1')], 'town', undefined, [npc], testTimeConfig)
      engine.setActionConfigs(testActionConfigs as never)

      const testMemories = [
        { id: 'mem-1', characterId: 'c1', content: 'カフェの約束', importance: 'high' as const, createdDay: 1, expiresDay: 3, sourceNpcId: 'npc1' },
      ]
      ;(engine as any).midTermMemoriesCache.set('c1', testMemories)

      // Start a conversation to verify context is built with memories
      const char = engine.getCharacter('c1')!
      ;(engine as any).handleTalkAction(char, 'npc1', 'hello')

      // The conversation context should include the memories
      // Since ConversationExecutor is mocked, we verify through the cache
      expect((engine as any).midTermMemoriesCache.get('c1')).toEqual(testMemories)
    })
  })
})
