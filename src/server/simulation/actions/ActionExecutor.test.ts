import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { ActionExecutor } from './ActionExecutor'
import { WorldStateManager } from '../WorldState'
import type { SimCharacter } from '../types'
import type { WorldMap, ActionConfig, FacilityInfo, Obstacle } from '@/types'

// Helper to create a test character
function createTestCharacter(
  id: string,
  overrides: Partial<SimCharacter> = {}
): SimCharacter {
  return {
    id,
    name: `Character ${id}`,
    sprite: { sheet: 'test.png', frameWidth: 32, frameHeight: 32 },
    money: 1000,
    satiety: 50,
    energy: 50,
    hygiene: 50,
    mood: 50,
    bladder: 50,
    currentMapId: 'test-map',
    currentNodeId: 'test-2-2',
    position: { x: 200, y: 200 },
    direction: 'down',
    navigation: {
      isMoving: false,
      path: [],
      currentPathIndex: 0,
      progress: 0,
      startPosition: null,
      targetPosition: null,
    },
    crossMapNavigation: null,
    conversation: null,
    currentAction: null,
    pendingAction: null,
    actionCounter: 0,
    ...overrides,
  }
}

// Helper to create a test map with facilities
function createTestMap(
  id: string,
  obstacles: Obstacle[] = []
): WorldMap {
  return {
    id,
    name: `Test ${id}`,
    width: 800,
    height: 600,
    backgroundColor: 0x000000,
    spawnNodeId: 'test-0-0',
    nodes: [
      { id: 'test-0-0', x: 100, y: 100, type: 'waypoint', connectedTo: ['test-1-1'] },
      { id: 'test-1-1', x: 200, y: 200, type: 'waypoint', connectedTo: ['test-0-0', 'test-2-2'] },
      { id: 'test-2-2', x: 300, y: 300, type: 'waypoint', connectedTo: ['test-1-1'] },
    ],
    obstacles,
  }
}

// Helper to create zone obstacle with facility
function createZoneWithFacility(
  id: string,
  row: number,
  col: number,
  facility: FacilityInfo
): Obstacle {
  return {
    id,
    x: (col + 1) * 60,
    y: (row + 1) * 60,
    width: 240,
    height: 240,
    type: 'zone',
    tileRow: row,
    tileCol: col,
    tileWidth: 4,
    tileHeight: 4,
    facility,
  }
}

describe('ActionExecutor', () => {
  let worldState: WorldStateManager
  let executor: ActionExecutor

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {})

    worldState = new WorldStateManager()
    executor = new ActionExecutor(worldState)

    // Initialize action configs
    executor.setActionConfigs({
      eat: {
        durationRange: { min: 15, max: 60, default: 30 },
        perMinute: { satiety: 2, mood: 0.5 },
      },
      sleep: {
        durationRange: { min: 60, max: 480, default: 360 },
        perMinute: { energy: 0.5, mood: 0.1 },
      },
      toilet: {
        fixed: true,
        duration: 5,
        effects: { bladder: 100 },
      },
      bathe: {
        durationRange: { min: 15, max: 60, default: 30 },
        perMinute: { hygiene: 2, mood: 0.5 },
      },
      rest: {
        fixed: true,
        duration: 15,
        effects: { energy: 10, mood: 5 },
      },
      talk: {
        fixed: true,
        duration: 0,
        effects: { mood: 10 },
      },
      work: {
        durationRange: { min: 60, max: 480, default: 240 },
        perMinute: { energy: -0.3, mood: -0.1 },
      },
      thinking: {
        fixed: true,
        duration: 0,
      },
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('setActionConfigs', () => {
    it('should store action configs', () => {
      const config = executor.getActionConfig('eat')
      expect(config).toBeDefined()
      expect(config?.durationRange).toEqual({ min: 15, max: 60, default: 30 })
    })
  })

  describe('startAction', () => {
    beforeEach(() => {
      const map = createTestMap('test-map', [
        createZoneWithFacility('kitchen', 0, 0, { tags: ['kitchen'], owner: 'char-1' }),
      ])
      worldState.initialize({ 'test-map': map })
      worldState.addCharacter(createTestCharacter('char-1', {
        currentNodeId: 'test-2-2', // Inside kitchen zone
      }))
    })

    it('should start action successfully', () => {
      const result = executor.startAction('char-1', 'eat_home')

      expect(result).toBe(true)
      const char = worldState.getCharacter('char-1')
      expect(char?.currentAction).not.toBeNull()
      expect(char?.currentAction?.actionId).toBe('eat_home')
    })

    it('should set display emoji', () => {
      executor.startAction('char-1', 'eat_home')

      const char = worldState.getCharacter('char-1')
      expect(char?.displayEmoji).toBe('🍳')
    })

    it('should fail when already executing action', () => {
      executor.startAction('char-1', 'eat_home')
      const result = executor.startAction('char-1', 'sleep')

      expect(result).toBe(false)
    })

    it('should fail for non-existent character', () => {
      const result = executor.startAction('non-existent', 'eat_home')
      expect(result).toBe(false)
    })

    it('should accept custom duration for variable actions', () => {
      executor.startAction('char-1', 'eat_home', undefined, undefined, 45)

      const char = worldState.getCharacter('char-1')
      expect(char?.currentAction?.durationMinutes).toBe(45)
    })

    it('should clamp duration to range', () => {
      executor.startAction('char-1', 'eat_home', undefined, undefined, 120)

      const char = worldState.getCharacter('char-1')
      expect(char?.currentAction?.durationMinutes).toBe(60) // max is 60
    })

    it('should deduct facility cost', () => {
      const map = createTestMap('test-map', [
        createZoneWithFacility('restaurant', 0, 0, {
          tags: ['restaurant'],
          cost: 500,
        }),
      ])
      worldState.initialize({ 'test-map': map })
      worldState.addCharacter(createTestCharacter('char-1', {
        money: 1000,
        currentNodeId: 'test-2-2',
      }))

      executor.startAction('char-1', 'eat_restaurant')

      const char = worldState.getCharacter('char-1')
      expect(char?.money).toBe(500)
    })
  })

  describe('cancelAction', () => {
    beforeEach(() => {
      const map = createTestMap('test-map', [
        createZoneWithFacility('kitchen', 0, 0, { tags: ['kitchen'], owner: 'char-1' }),
      ])
      worldState.initialize({ 'test-map': map })
      worldState.addCharacter(createTestCharacter('char-1', {
        currentNodeId: 'test-2-2',
      }))
    })

    it('should cancel active action', () => {
      executor.startAction('char-1', 'eat_home')
      executor.cancelAction('char-1')

      const char = worldState.getCharacter('char-1')
      expect(char?.currentAction).toBeNull()
      expect(char?.displayEmoji).toBeUndefined()
    })

    it('should do nothing when no action active', () => {
      executor.cancelAction('char-1')

      const char = worldState.getCharacter('char-1')
      expect(char?.currentAction).toBeNull()
    })
  })

  describe('isExecutingAction', () => {
    beforeEach(() => {
      const map = createTestMap('test-map', [
        createZoneWithFacility('kitchen', 0, 0, { tags: ['kitchen'], owner: 'char-1' }),
      ])
      worldState.initialize({ 'test-map': map })
      worldState.addCharacter(createTestCharacter('char-1', {
        currentNodeId: 'test-2-2',
      }))
    })

    it('should return false when no action', () => {
      expect(executor.isExecutingAction('char-1')).toBe(false)
    })

    it('should return true when action active', () => {
      executor.startAction('char-1', 'eat_home')
      expect(executor.isExecutingAction('char-1')).toBe(true)
    })
  })

  describe('forceCompleteAction', () => {
    beforeEach(() => {
      const map = createTestMap('test-map', [
        createZoneWithFacility('kitchen', 0, 0, { tags: ['kitchen'], owner: 'char-1' }),
      ])
      worldState.initialize({ 'test-map': map })
      worldState.addCharacter(createTestCharacter('char-1', {
        currentNodeId: 'test-2-2',
      }))
    })

    it('should complete action without applying effects', () => {
      const charBefore = worldState.getCharacter('char-1')!
      const energyBefore = charBefore.energy

      executor.startAction('char-1', 'thinking')
      executor.forceCompleteAction('char-1')

      const char = worldState.getCharacter('char-1')
      expect(char?.currentAction).toBeNull()
      expect(char?.energy).toBe(energyBefore) // No effects applied
    })
  })

  describe('tick', () => {
    beforeEach(() => {
      const map = createTestMap('test-map', [
        createZoneWithFacility('bathroom', 0, 0, { tags: ['toilet'], owner: 'char-1' }),
      ])
      worldState.initialize({ 'test-map': map })
      worldState.addCharacter(createTestCharacter('char-1', {
        currentNodeId: 'test-2-2',
        bladder: 0,
      }))
    })

    it('should complete action when time elapsed', () => {
      executor.startAction('char-1', 'toilet')

      const char = worldState.getCharacter('char-1')
      const targetEndTime = char!.currentAction!.targetEndTime

      // Advance past target end time
      executor.tick(targetEndTime + 1000)

      const updatedChar = worldState.getCharacter('char-1')
      expect(updatedChar?.currentAction).toBeNull()
      expect(updatedChar?.bladder).toBe(100) // Effect applied
    })

    it('should not complete thinking action automatically', () => {
      executor.startAction('char-1', 'thinking')

      // Advance time significantly
      executor.tick(Date.now() + 60000)

      const char = worldState.getCharacter('char-1')
      expect(char?.currentAction?.actionId).toBe('thinking')
    })

    it('should call completion callback', () => {
      const callback = vi.fn()
      executor.setOnActionComplete(callback)
      executor.startAction('char-1', 'toilet')

      const char = worldState.getCharacter('char-1')
      executor.tick(char!.currentAction!.targetEndTime + 1000)

      expect(callback).toHaveBeenCalledWith('char-1', 'toilet')
    })

    it('should call history callback', () => {
      const callback = vi.fn()
      executor.setOnRecordHistory(callback)
      executor.startAction('char-1', 'toilet')

      const char = worldState.getCharacter('char-1')
      executor.tick(char!.currentAction!.targetEndTime + 1000)

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          characterId: 'char-1',
          actionId: 'toilet',
        })
      )
    })
  })

  describe('canExecuteAction', () => {
    it('should fail when character not found', () => {
      const result = executor.canExecuteAction('non-existent', 'eat_home')
      expect(result.canExecute).toBe(false)
      expect(result.reason).toContain('not found')
    })

    it('should fail when action not found', () => {
      worldState.addCharacter(createTestCharacter('char-1'))

      const result = executor.canExecuteAction('char-1', 'invalid_action' as never)
      expect(result.canExecute).toBe(false)
    })

    it('should fail when already executing', () => {
      const map = createTestMap('test-map', [
        createZoneWithFacility('kitchen', 0, 0, { tags: ['kitchen'], owner: 'char-1' }),
      ])
      worldState.initialize({ 'test-map': map })
      worldState.addCharacter(createTestCharacter('char-1', {
        currentNodeId: 'test-2-2',
        currentAction: {
          actionId: 'eat_home',
          startTime: Date.now(),
          targetEndTime: Date.now() + 60000,
        },
      }))

      const result = executor.canExecuteAction('char-1', 'sleep')
      expect(result.canExecute).toBe(false)
      expect(result.reason).toContain('Already executing')
    })

    it('should allow when ignoreCurrentAction is true', () => {
      const map = createTestMap('test-map', [
        createZoneWithFacility('kitchen', 0, 0, { tags: ['kitchen'], owner: 'char-1' }),
      ])
      worldState.initialize({ 'test-map': map })
      worldState.addCharacter(createTestCharacter('char-1', {
        currentNodeId: 'test-2-2',
        currentAction: {
          actionId: 'thinking',
          startTime: Date.now(),
          targetEndTime: Date.now(),
        },
      }))

      const result = executor.canExecuteAction('char-1', 'eat_home', {
        ignoreCurrentAction: true,
      })
      expect(result.canExecute).toBe(true)
    })

    it('should fail when map lacks required facility', () => {
      const map = createTestMap('test-map', []) // No facilities
      worldState.initialize({ 'test-map': map })
      worldState.addCharacter(createTestCharacter('char-1'))

      const result = executor.canExecuteAction('char-1', 'eat_home')
      expect(result.canExecute).toBe(false)
      expect(result.reason).toContain('no facility')
    })

    it('should fail when ownership requirement not met', () => {
      const map = createTestMap('test-map', [
        createZoneWithFacility('kitchen', 0, 0, {
          tags: ['kitchen'],
          owner: 'someone-else',
        }),
      ])
      worldState.initialize({ 'test-map': map })
      worldState.addCharacter(createTestCharacter('char-1', {
        currentNodeId: 'test-2-2',
      }))

      const result = executor.canExecuteAction('char-1', 'eat_home')
      expect(result.canExecute).toBe(false)
      expect(result.reason).toContain('self-owned')
    })

    it('should fail when not enough money for cost', () => {
      const map = createTestMap('test-map', [
        createZoneWithFacility('restaurant', 0, 0, {
          tags: ['restaurant'],
          cost: 2000,
        }),
      ])
      worldState.initialize({ 'test-map': map })
      worldState.addCharacter(createTestCharacter('char-1', {
        money: 500,
        currentNodeId: 'test-2-2',
      }))

      const result = executor.canExecuteAction('char-1', 'eat_restaurant')
      expect(result.canExecute).toBe(false)
      expect(result.reason).toContain('Not enough money')
    })
  })

  describe('getAvailableActions', () => {
    it('should return actions character can execute', () => {
      const map = createTestMap('test-map', [
        createZoneWithFacility('kitchen', 0, 0, { tags: ['kitchen'], owner: 'char-1' }),
        createZoneWithFacility('bedroom', 0, 4, { tags: ['bedroom'], owner: 'char-1' }),
      ])
      worldState.initialize({ 'test-map': map })
      worldState.addCharacter(createTestCharacter('char-1', {
        currentNodeId: 'test-2-2',
      }))

      const actions = executor.getAvailableActions('char-1')

      expect(actions).toContain('eat_home')
      expect(actions).toContain('sleep')
      expect(actions).not.toContain('thinking') // System action excluded
    })

    it('should allow actions when thinking', () => {
      const map = createTestMap('test-map', [
        createZoneWithFacility('kitchen', 0, 0, { tags: ['kitchen'], owner: 'char-1' }),
      ])
      worldState.initialize({ 'test-map': map })
      worldState.addCharacter(createTestCharacter('char-1', {
        currentNodeId: 'test-2-2',
        currentAction: {
          actionId: 'thinking',
          startTime: Date.now(),
          targetEndTime: Date.now(),
        },
      }))

      const actions = executor.getAvailableActions('char-1')

      expect(actions).toContain('eat_home')
    })
  })

  describe('getCurrentFacility', () => {
    it('should return facility for current position', () => {
      const map = createTestMap('test-map', [
        createZoneWithFacility('kitchen', 0, 0, {
          tags: ['kitchen'],
          owner: 'char-1',
        }),
      ])
      worldState.initialize({ 'test-map': map })
      worldState.addCharacter(createTestCharacter('char-1', {
        currentNodeId: 'test-2-2',
      }))

      const facility = executor.getCurrentFacility('char-1')

      expect(facility).not.toBeNull()
      expect(facility?.tags).toContain('kitchen')
    })

    it('should return null when not at facility', () => {
      const map = createTestMap('test-map', [])
      worldState.initialize({ 'test-map': map })
      worldState.addCharacter(createTestCharacter('char-1'))

      const facility = executor.getCurrentFacility('char-1')

      expect(facility).toBeNull()
    })
  })

  // =====================
  // docs/action-system.md 仕様に基づくテスト
  // =====================

  describe('work action - employment requirement (docs/action-system.md:323)', () => {
    it('should fail when character has no employment', () => {
      const map = createTestMap('test-map', [
        createZoneWithFacility('workspace', 0, 0, {
          tags: ['workspace'],
          job: {
            jobId: 'writer',
            title: 'ライター',
            hourlyWage: 1500,
            workHours: { start: 9, end: 18 },
          },
        }),
      ])
      worldState.initialize({ 'test-map': map })
      worldState.addCharacter(createTestCharacter('char-1', {
        currentNodeId: 'test-2-2',
        employment: undefined, // 雇用なし
      }))

      const result = executor.canExecuteAction('char-1', 'work')
      expect(result.canExecute).toBe(false)
      expect(result.reason).toContain('employment')
    })

    it('should fail when job ID does not match employment', () => {
      const map = createTestMap('test-map', [
        createZoneWithFacility('workspace', 0, 0, {
          tags: ['workspace'],
          job: {
            jobId: 'chef',
            title: 'シェフ',
            hourlyWage: 1200,
            workHours: { start: 9, end: 18 },
          },
        }),
      ])
      worldState.initialize({ 'test-map': map })
      worldState.addCharacter(createTestCharacter('char-1', {
        currentNodeId: 'test-2-2',
        employment: {
          jobId: 'writer', // 異なるjobId
          workplaces: [{ workplaceLabel: 'オフィス', mapId: 'test-map' }],
        },
      }))

      const result = executor.canExecuteAction('char-1', 'work')
      expect(result.canExecute).toBe(false)
      expect(result.reason).toContain('mismatch')
    })
  })

  describe('work action - work hours check (docs/action-system.md:232-236)', () => {
    it('should succeed when within work hours', () => {
      const map = createTestMap('test-map', [
        createZoneWithFacility('workspace', 0, 0, {
          tags: ['workspace'],
          job: {
            jobId: 'writer',
            title: 'ライター',
            hourlyWage: 1500,
            workHours: { start: 9, end: 18 },
          },
        }),
      ])
      worldState.initialize({ 'test-map': map })
      worldState.addCharacter(createTestCharacter('char-1', {
        currentNodeId: 'test-2-2',
        employment: {
          jobId: 'writer',
          workplaces: [{ workplaceLabel: 'workspace', mapId: 'test-map' }],
        },
      }))

      // 現在時刻を営業時間内に設定
      worldState.setTime({ hour: 10, minute: 0, day: 1 })

      const result = executor.canExecuteAction('char-1', 'work')
      expect(result.canExecute).toBe(true)
    })

    it('should fail when outside work hours', () => {
      const map = createTestMap('test-map', [
        createZoneWithFacility('workspace', 0, 0, {
          tags: ['workspace'],
          job: {
            jobId: 'writer',
            title: 'ライター',
            hourlyWage: 1500,
            workHours: { start: 9, end: 18 },
          },
        }),
      ])
      worldState.initialize({ 'test-map': map })
      worldState.addCharacter(createTestCharacter('char-1', {
        currentNodeId: 'test-2-2',
        employment: {
          jobId: 'writer',
          workplaces: [{ workplaceLabel: 'workspace', mapId: 'test-map' }],
        },
      }))

      // 現在時刻を営業時間外に設定
      worldState.setTime({ hour: 20, minute: 0, day: 1 })

      const result = executor.canExecuteAction('char-1', 'work')
      expect(result.canExecute).toBe(false)
      expect(result.reason).toContain('work hours')
    })

    it('should handle overnight shifts correctly', () => {
      const map = createTestMap('test-map', [
        createZoneWithFacility('workspace', 0, 0, {
          tags: ['workspace'],
          job: {
            jobId: 'nightworker',
            title: '夜勤',
            hourlyWage: 1800,
            workHours: { start: 22, end: 6 }, // 深夜シフト
          },
        }),
      ])
      worldState.initialize({ 'test-map': map })
      worldState.addCharacter(createTestCharacter('char-1', {
        currentNodeId: 'test-2-2',
        employment: {
          jobId: 'nightworker',
          workplaces: [{ workplaceLabel: 'workspace', mapId: 'test-map' }],
        },
      }))

      // 23時は営業時間内
      worldState.setTime({ hour: 23, minute: 0, day: 1 })
      expect(executor.canExecuteAction('char-1', 'work').canExecute).toBe(true)

      // 3時も営業時間内
      worldState.setTime({ hour: 3, minute: 0, day: 1 })
      expect(executor.canExecuteAction('char-1', 'work').canExecute).toBe(true)

      // 12時は営業時間外
      worldState.setTime({ hour: 12, minute: 0, day: 1 })
      expect(executor.canExecuteAction('char-1', 'work').canExecute).toBe(false)
    })
  })

  describe('work action - salary calculation (docs/action-system.md:293-298)', () => {
    it('should add hourly wage to money after work completion', () => {
      const map = createTestMap('test-map', [
        createZoneWithFacility('workspace', 0, 0, {
          tags: ['workspace'],
          job: {
            jobId: 'writer',
            title: 'ライター',
            hourlyWage: 1500,
            workHours: { start: 9, end: 18 },
          },
        }),
      ])
      worldState.initialize({ 'test-map': map })
      worldState.addCharacter(createTestCharacter('char-1', {
        currentNodeId: 'test-2-2',
        money: 1000,
        employment: {
          jobId: 'writer',
          workplaces: [{ workplaceLabel: 'workspace', mapId: 'test-map' }],
        },
      }))

      worldState.setTime({ hour: 10, minute: 0, day: 1 })

      // 60分間の仕事を開始
      executor.startAction('char-1', 'work', undefined, undefined, 60)

      const char = worldState.getCharacter('char-1')
      const targetEndTime = char!.currentAction!.targetEndTime

      // 完了時刻まで進める
      executor.tick(targetEndTime + 1000)

      const updatedChar = worldState.getCharacter('char-1')
      // 1500円/時 × 1時間 = 1500円増加
      expect(updatedChar?.money).toBe(2500)
    })
  })

  describe('getActivePerMinuteEffects', () => {
    it('should return perMinute effects for variable action', () => {
      const map = createTestMap('test-map', [
        createZoneWithFacility('kitchen', 0, 0, { tags: ['kitchen'], owner: 'char-1' }),
      ])
      worldState.initialize({ 'test-map': map })
      worldState.addCharacter(createTestCharacter('char-1', {
        currentNodeId: 'test-2-2',
      }))

      executor.startAction('char-1', 'eat_home', undefined, undefined, 30)

      const perMinute = executor.getActivePerMinuteEffects('char-1')

      expect(perMinute).not.toBeNull()
      expect(perMinute?.satiety).toBe(2) // テストの actionConfigs で設定した値
      expect(perMinute?.mood).toBe(0.5)
    })

    it('should return null for fixed-time action', () => {
      const map = createTestMap('test-map', [
        createZoneWithFacility('bathroom', 0, 0, { tags: ['toilet'], owner: 'char-1' }),
      ])
      worldState.initialize({ 'test-map': map })
      worldState.addCharacter(createTestCharacter('char-1', {
        currentNodeId: 'test-2-2',
      }))

      executor.startAction('char-1', 'toilet')

      const perMinute = executor.getActivePerMinuteEffects('char-1')

      expect(perMinute).toBeNull()
    })

    it('should return null when no action is active', () => {
      worldState.addCharacter(createTestCharacter('char-1'))

      const perMinute = executor.getActivePerMinuteEffects('char-1')

      expect(perMinute).toBeNull()
    })
  })

  describe('perMinute effect - completeAction behavior (docs/action-system.md:368)', () => {
    // perMinute 効果は SimulationEngine.applyStatusDecay でリアルタイム適用されるため、
    // completeAction では適用されない
    it('should NOT apply perMinute effects on completion (applied in real-time by SimulationEngine)', () => {
      const map = createTestMap('test-map', [
        createZoneWithFacility('kitchen', 0, 0, { tags: ['kitchen'], owner: 'char-1' }),
      ])
      worldState.initialize({ 'test-map': map })
      worldState.addCharacter(createTestCharacter('char-1', {
        currentNodeId: 'test-2-2',
        satiety: 0,
        mood: 50,
      }))

      // 30分の食事を開始
      executor.startAction('char-1', 'eat_home', undefined, undefined, 30)

      const char = worldState.getCharacter('char-1')
      executor.tick(char!.currentAction!.targetEndTime + 1000)

      const updatedChar = worldState.getCharacter('char-1')
      // completeAction では perMinute 効果が適用されない（値は変化しない）
      expect(updatedChar?.satiety).toBe(0)
      expect(updatedChar?.mood).toBe(50)
    })

    it('should still apply fixed effects for fixed-time actions', () => {
      const map = createTestMap('test-map', [
        createZoneWithFacility('bathroom', 0, 0, { tags: ['toilet'], owner: 'char-1' }),
      ])
      worldState.initialize({ 'test-map': map })
      worldState.addCharacter(createTestCharacter('char-1', {
        currentNodeId: 'test-2-2',
        bladder: 0,
      }))

      executor.startAction('char-1', 'toilet')

      const char = worldState.getCharacter('char-1')
      executor.tick(char!.currentAction!.targetEndTime + 1000)

      const updatedChar = worldState.getCharacter('char-1')
      // 固定時間アクションの効果は完了時に適用される
      expect(updatedChar?.bladder).toBe(100)
    })
  })
})
