import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock LLM client
vi.mock('@/server/llm', () => ({
  llmGenerateObject: vi.fn().mockResolvedValue({
    action: 'idle',
    target: null,
    reason: 'default',
    durationMinutes: null,
    scheduleUpdate: null,
  }),
}))

import { LLMBehaviorDecider } from './LLMBehaviorDecider'
import type { BehaviorContext } from '@/types/behavior'
import type { FacilityTag } from '@/types/map'
import type { SimCharacter } from '@/server/simulation/types'

function createTestContext(overrides: Partial<BehaviorContext> = {}): BehaviorContext {
  const character: SimCharacter = {
    id: 'c1',
    name: 'TestChar',
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
    navigation: { isMoving: false, path: [], currentPathIndex: 0, progress: 0, startPosition: null, targetPosition: null },
    crossMapNavigation: null,
    conversation: null,
    currentAction: null,
    pendingAction: null,
    actionCounter: 0,
  }

  return {
    character,
    currentTime: { hour: 10, minute: 0, day: 1 },
    currentFacility: null,
    schedule: null,
    availableActions: ['rest', 'talk'],
    nearbyNPCs: [],
    currentMapFacilities: [],
    nearbyFacilities: [],
    nearbyMaps: [{ id: 'town', label: 'Town', distance: 0 }],
    ...overrides,
  }
}

describe('LLMBehaviorDecider', () => {
  let decider: LLMBehaviorDecider

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    decider = new LLMBehaviorDecider()
  })

  describe('decide', () => {
    it('should return idle decision from LLM', async () => {
      const { llmGenerateObject } = await import('@/server/llm')
      vi.mocked(llmGenerateObject).mockResolvedValueOnce({
        action: 'idle',
        target: null,
        reason: 'nothing to do',
        durationMinutes: null,
        scheduleUpdate: null,
      })

      const context = createTestContext()
      const decision = await decider.decide(context)
      expect(decision.type).toBe('idle')
      expect(decision.reason).toBe('nothing to do')
    })

    it('should return move decision when action is move', async () => {
      const { llmGenerateObject } = await import('@/server/llm')
      vi.mocked(llmGenerateObject).mockResolvedValueOnce({
        action: 'move',
        target: 'cafe',
        reason: 'going to cafe',
        durationMinutes: null,
        scheduleUpdate: null,
      })

      const context = createTestContext()
      const decision = await decider.decide(context)
      expect(decision.type).toBe('move')
      expect(decision.targetMapId).toBe('cafe')
    })

    it('should return action decision for talk with NPC', async () => {
      const { llmGenerateObject } = await import('@/server/llm')
      vi.mocked(llmGenerateObject).mockResolvedValueOnce({
        action: 'talk',
        target: 'npc-1',
        reason: 'want to chat',
        durationMinutes: null,
        scheduleUpdate: null,
      })

      const context = createTestContext({
        availableActions: ['talk', 'rest'],
      })
      const decision = await decider.decide(context)
      expect(decision.type).toBe('action')
      expect(decision.actionId).toBe('talk')
      expect(decision.targetNpcId).toBe('npc-1')
    })

    it('should handle facility action with single facility', async () => {
      const { llmGenerateObject } = await import('@/server/llm')
      vi.mocked(llmGenerateObject).mockResolvedValueOnce({
        action: 'toilet',
        target: null,
        reason: 'need to go',
        durationMinutes: 5,
        scheduleUpdate: null,
      })

      const context = createTestContext({
        currentMapFacilities: [{
          id: 'toilet-1',
          label: 'Toilet',
          tags: ['toilet'],
          availableActions: ['toilet'],
        }],
      })
      const decision = await decider.decide(context)
      expect(decision.type).toBe('action')
      expect(decision.actionId).toBe('toilet')
      expect(decision.targetFacilityId).toBe('toilet-1')
      expect(decision.durationMinutes).toBe(5)
    })

    it('should convert scheduleUpdate from LLM nullable to internal format', async () => {
      const { llmGenerateObject } = await import('@/server/llm')
      vi.mocked(llmGenerateObject).mockResolvedValueOnce({
        action: 'idle',
        target: null,
        reason: 'resting',
        durationMinutes: null,
        scheduleUpdate: {
          type: 'add',
          entry: { time: '12:00', activity: 'Lunch', location: null, note: null },
        },
      })

      const context = createTestContext()
      const decision = await decider.decide(context)
      expect(decision.scheduleUpdate).toBeDefined()
      expect(decision.scheduleUpdate!.type).toBe('add')
      expect(decision.scheduleUpdate!.entry.time).toBe('12:00')
      expect(decision.scheduleUpdate!.entry.location).toBeUndefined()
    })
  })

  describe('decideInterruptFacility', () => {
    it('should return idle when no facilities available', async () => {
      const context = createTestContext({
        currentMapFacilities: [],
        nearbyFacilities: [],
        nearbyMaps: [],
      })
      const decision = await decider.decideInterruptFacility('toilet', context)
      expect(decision.type).toBe('idle')
      expect(decision.reason).toContain('施設がない')
    })

    it('should auto-select single facility', async () => {
      const context = createTestContext({
        currentMapFacilities: [{
          id: 'toilet-1',
          label: 'Toilet',
          tags: ['toilet'],
          availableActions: ['toilet'],
        }],
      })
      const decision = await decider.decideInterruptFacility('toilet', context)
      expect(decision.type).toBe('action')
      expect(decision.actionId).toBe('toilet')
      expect(decision.targetFacilityId).toBe('toilet-1')
    })

    it('should use LLM for multiple facilities', async () => {
      const { llmGenerateObject } = await import('@/server/llm')
      vi.mocked(llmGenerateObject).mockResolvedValueOnce({
        facilityId: 'toilet-2',
        reason: 'closer',
      })

      const context = createTestContext({
        currentMapFacilities: [
          { id: 'toilet-1', label: 'Home Toilet', tags: ['toilet'], availableActions: ['toilet'] },
          { id: 'toilet-2', label: 'Public Toilet', tags: ['toilet'], availableActions: ['toilet'] },
        ],
      })
      const decision = await decider.decideInterruptFacility('toilet', context)
      expect(decision.type).toBe('action')
      expect(decision.targetFacilityId).toBe('toilet-2')
    })

    it('should suggest moving to home when no local facility', async () => {
      const context = createTestContext({
        currentMapFacilities: [],
        nearbyFacilities: [],
        nearbyMaps: [
          { id: 'town', label: 'Town', distance: 0 },
          { id: 'home', label: 'Home', distance: 1 },
        ],
      })
      const decision = await decider.decideInterruptFacility('bathe', context)
      expect(decision.type).toBe('move')
      expect(decision.targetMapId).toBe('home')
    })
  })

  describe('buildActionDescription', () => {
    it('should return base description without config', () => {
      const desc = decider.buildActionDescription('eat')
      expect(desc).toBe('食事')
    })

    it('should include duration range for variable-time actions', () => {
      decider.setActionConfigs({
        eat: {
          durationRange: { min: 15, max: 60, default: 30 },
          perMinute: { satiety: 2, mood: 0.5 },
        },
      })
      const desc = decider.buildActionDescription('eat')
      expect(desc).toContain('15〜60分')
      expect(desc).toContain('満腹度')
    })

    it('should format fixed-time actions', () => {
      decider.setActionConfigs({
        toilet: {
          fixed: true,
          duration: 5,
          effects: { bladder: 100 },
        },
      })
      const desc = decider.buildActionDescription('toilet')
      expect(desc).toContain('固定5分')
      expect(desc).toContain('膀胱')
    })

    it('should handle unknown action types', () => {
      const desc = decider.buildActionDescription('unknown_action')
      expect(desc).toBe('unknown_action')
    })
  })

  describe('setActionConfigs', () => {
    it('should store action configs', () => {
      decider.setActionConfigs({ eat: { durationRange: { min: 10, max: 60, default: 30 }, perMinute: { satiety: 2 } } })
      const desc = decider.buildActionDescription('eat')
      expect(desc).toContain('10〜60分')
    })
  })

  describe('two-stage facility selection', () => {
    it('should trigger facility selection when multiple facilities available', async () => {
      const { llmGenerateObject } = await import('@/server/llm')
      // First call: LLM decides to use toilet
      vi.mocked(llmGenerateObject).mockResolvedValueOnce({
        action: 'toilet',
        target: null,
        reason: 'need to go',
        durationMinutes: null,
        scheduleUpdate: null,
      })
      // Second call: LLM selects specific facility
      vi.mocked(llmGenerateObject).mockResolvedValueOnce({
        facilityId: 'toilet-2',
        reason: 'closer',
      })

      const context = createTestContext({
        currentMapFacilities: [
          { id: 'toilet-1', label: 'Home Toilet', tags: ['toilet'], availableActions: ['toilet'] },
          { id: 'toilet-2', label: 'Public Toilet', tags: ['toilet'], availableActions: ['toilet'] },
        ],
      })
      const decision = await decider.decide(context)
      expect(decision.type).toBe('action')
      expect(decision.targetFacilityId).toBe('toilet-2')
    })

    it('should skip two-stage selection when LLM specifies valid facility target', async () => {
      const { llmGenerateObject } = await import('@/server/llm')
      vi.mocked(llmGenerateObject).mockClear()
      vi.mocked(llmGenerateObject).mockResolvedValueOnce({
        action: 'toilet',
        target: 'toilet-1',
        reason: 'going home',
        durationMinutes: null,
        scheduleUpdate: null,
      })

      const context = createTestContext({
        currentMapFacilities: [
          { id: 'toilet-1', label: 'Home Toilet', tags: ['toilet'], availableActions: ['toilet'] },
          { id: 'toilet-2', label: 'Public Toilet', tags: ['toilet'], availableActions: ['toilet'] },
        ],
      })
      const decision = await decider.decide(context)
      expect(decision.type).toBe('action')
      expect(decision.targetFacilityId).toBe('toilet-1')
      // Should only call LLM once (no second facility selection call)
      expect(llmGenerateObject).toHaveBeenCalledTimes(1)
    })

    it('should inherit scheduleUpdate and durationMinutes in two-stage selection', async () => {
      const { llmGenerateObject } = await import('@/server/llm')
      vi.mocked(llmGenerateObject).mockResolvedValueOnce({
        action: 'toilet',
        target: null,
        reason: 'urgent',
        durationMinutes: 10,
        scheduleUpdate: {
          type: 'add',
          entry: { time: '14:00', activity: 'Rest', location: null, note: null },
        },
      })
      vi.mocked(llmGenerateObject).mockResolvedValueOnce({
        facilityId: 'toilet-1',
        reason: 'nearest',
      })

      const context = createTestContext({
        currentMapFacilities: [
          { id: 'toilet-1', label: 'Toilet A', tags: ['toilet'], availableActions: ['toilet'] },
          { id: 'toilet-2', label: 'Toilet B', tags: ['toilet'], availableActions: ['toilet'] },
        ],
      })
      const decision = await decider.decide(context)
      expect(decision.durationMinutes).toBe(10)
      expect(decision.scheduleUpdate).toBeDefined()
      expect(decision.scheduleUpdate!.type).toBe('add')
    })

    it('should handle nearby map facilities in two-stage selection', async () => {
      const { llmGenerateObject } = await import('@/server/llm')
      vi.mocked(llmGenerateObject).mockResolvedValueOnce({
        action: 'eat',
        target: null,
        reason: 'hungry',
        durationMinutes: 30,
        scheduleUpdate: null,
      })
      vi.mocked(llmGenerateObject).mockResolvedValueOnce({
        facilityId: 'cafe-restaurant',
        reason: 'good food',
      })

      const context = createTestContext({
        currentMapFacilities: [],
        nearbyFacilities: [
          { id: 'home-kitchen', label: 'Kitchen', tags: ['restaurant'], distance: 1, mapId: 'home' },
          { id: 'cafe-restaurant', label: 'Cafe', tags: ['restaurant'], cost: 500, distance: 2, mapId: 'cafe' },
        ],
      })
      const decision = await decider.decide(context)
      expect(decision.type).toBe('action')
      expect(decision.targetFacilityId).toBe('cafe-restaurant')
    })
  })

  describe('decide with rich context (prompt building coverage)', () => {
    it('should build prompt with schedule and action history', async () => {
      const { llmGenerateObject } = await import('@/server/llm')
      vi.mocked(llmGenerateObject).mockResolvedValueOnce({
        action: 'idle',
        target: null,
        reason: 'relaxing',
        durationMinutes: null,
        scheduleUpdate: null,
      })

      const context = createTestContext({
        schedule: [
          { time: '09:00', activity: '仕事', location: 'office' },
          { time: '12:00', activity: '昼食' },
          { time: '18:00', activity: '帰宅', location: 'home' },
        ],
        todayActions: [
          { time: '08:00', actionId: 'eat', target: 'kitchen-1', durationMinutes: 20, reason: '朝食' },
          { time: '08:30', actionId: 'toilet' },
        ],
      })
      const decision = await decider.decide(context)
      expect(decision.type).toBe('idle')
      // The prompt was built with schedule and history (covers formatSchedule, formatTodayActions)
    })

    it('should build prompt with NPCs and facilities', async () => {
      const { llmGenerateObject } = await import('@/server/llm')
      vi.mocked(llmGenerateObject).mockResolvedValueOnce({
        action: 'idle',
        target: null,
        reason: 'waiting',
        durationMinutes: null,
        scheduleUpdate: null,
      })

      const context = createTestContext({
        availableActions: ['eat', 'eat', 'bathe', 'talk', 'rest', 'toilet'],
        nearbyNPCs: [
          { id: 'npc-1', name: 'Shopkeeper', mapId: 'town', currentNodeId: 'town-2-2', position: { x: 200, y: 200 }, direction: 'down', isInConversation: false },
        ],
        currentMapFacilities: [
          { id: 'kitchen-1', label: '自宅キッチン', tags: ['kitchen'], availableActions: ['eat'] },
          { id: 'toilet-1', label: 'トイレ', tags: ['toilet'], availableActions: ['toilet'] },
        ],
        nearbyFacilities: [
          { id: 'cafe-1', label: 'カフェ', tags: ['restaurant'], cost: 500, quality: 4, distance: 1, mapId: 'cafe', availableActions: ['eat'] },
        ],
        nearbyMaps: [
          { id: 'town', label: '広場', distance: 0 },
          { id: 'cafe', label: 'カフェ', distance: 1 },
          { id: 'home', label: '自宅', distance: 2 },
        ],
      })
      const decision = await decider.decide(context)
      expect(decision.type).toBe('idle')
      // Covers formatAvailableActions, formatCurrentMapFacilities, formatNearbyFacilities, formatNearbyMaps
    })

    it('should include next schedule info in prompt', async () => {
      const { llmGenerateObject } = await import('@/server/llm')
      vi.mocked(llmGenerateObject).mockResolvedValueOnce({
        action: 'idle',
        target: null,
        reason: 'waiting for next event',
        durationMinutes: null,
        scheduleUpdate: null,
      })

      const context = createTestContext({
        currentTime: { hour: 11, minute: 30, day: 1 },
        schedule: [
          { time: '09:00', activity: '朝礼' },       // past
          { time: '12:00', activity: '昼食', location: 'cafe' }, // next (30 min)
          { time: '18:00', activity: '帰宅' },       // future
        ],
      })
      const decision = await decider.decide(context)
      expect(decision.type).toBe('idle')
      // Covers getNextScheduleInfo (schedule with past and future entries)
    })

    it('should handle personality and tendencies in prompt', async () => {
      const { llmGenerateObject } = await import('@/server/llm')
      vi.mocked(llmGenerateObject).mockResolvedValueOnce({
        action: 'idle',
        target: null,
        reason: 'thinking',
        durationMinutes: null,
        scheduleUpdate: null,
      })

      const context = createTestContext()
      context.character.personality = '明るくて社交的'
      context.character.tendencies = ['食べることが好き', '人と話すのが得意']
      context.character.customPrompt = 'いつも笑顔でいる'
      const decision = await decider.decide(context)
      expect(decision.type).toBe('idle')
    })

    it('should include action descriptions when actionConfigs are set', async () => {
      const { llmGenerateObject } = await import('@/server/llm')
      vi.mocked(llmGenerateObject).mockResolvedValueOnce({
        action: 'idle',
        target: null,
        reason: 'done',
        durationMinutes: null,
        scheduleUpdate: null,
      })

      decider.setActionConfigs({
        eat: { durationRange: { min: 15, max: 60, default: 30 }, perMinute: { satiety: 2, mood: 0.3 } },
        toilet: { fixed: true, duration: 5, effects: { bladder: 100 } },
        sleep: { durationRange: { min: 60, max: 480, default: 360 }, perMinute: { energy: 1 } },
      })

      const context = createTestContext({
        availableActions: ['eat', 'toilet', 'sleep', 'rest', 'talk'],
      })
      const decision = await decider.decide(context)
      expect(decision.type).toBe('idle')
    })
  })

  describe('private formatNearbyMaps', () => {
    it('should return "なし" for undefined maps', () => {
      const result = (decider as any).formatNearbyMaps(undefined)
      expect(result).toBe('なし')
    })

    it('should return "なし" for empty array', () => {
      const result = (decider as any).formatNearbyMaps([])
      expect(result).toBe('なし')
    })

    it('should format maps with distance', () => {
      const result = (decider as any).formatNearbyMaps([
        { id: 'cafe', label: 'カフェ', distance: 2 },
      ])
      expect(result).toContain('cafe')
      expect(result).toContain('カフェ')
      expect(result).toContain('距離: 2')
    })
  })

  describe('private formatFacilityForSelection', () => {
    it('should format basic facility', () => {
      const result = (decider as any).formatFacilityForSelection({ id: 'f1', label: '施設A' })
      expect(result).toBe('- f1: 施設A')
    })

    it('should include cost', () => {
      const result = (decider as any).formatFacilityForSelection({ id: 'f1', label: '施設A', cost: 500 })
      expect(result).toContain('料金: 500円')
    })

    it('should include quality', () => {
      const result = (decider as any).formatFacilityForSelection({ id: 'f1', label: '施設A', quality: 4 })
      expect(result).toContain('品質: 4')
    })

    it('should include distance', () => {
      const result = (decider as any).formatFacilityForSelection({ id: 'f1', label: '施設A', distance: 3 })
      expect(result).toContain('距離: 3')
    })

    it('should include all optional fields', () => {
      const result = (decider as any).formatFacilityForSelection({ id: 'f1', label: '施設A', cost: 300, quality: 5, distance: 1 })
      expect(result).toContain('料金: 300円')
      expect(result).toContain('品質: 5')
      expect(result).toContain('距離: 1')
    })
  })

  describe('private getNextScheduleInfo', () => {
    it('should return null for null schedule', () => {
      const result = (decider as any).getNextScheduleInfo(null, { hour: 10, minute: 0, day: 1 })
      expect(result).toBeNull()
    })

    it('should return null for empty schedule', () => {
      const result = (decider as any).getNextScheduleInfo([], { hour: 10, minute: 0, day: 1 })
      expect(result).toBeNull()
    })

    it('should return null when all schedules are past', () => {
      const schedule = [
        { time: '08:00', activity: '朝食' },
        { time: '09:00', activity: '散歩' },
      ]
      const result = (decider as any).getNextScheduleInfo(schedule, { hour: 12, minute: 0, day: 1 })
      expect(result).toBeNull()
    })

    it('should return next future schedule entry', () => {
      const schedule = [
        { time: '08:00', activity: '朝食' },
        { time: '12:00', activity: '昼食', location: 'cafe' },
        { time: '18:00', activity: '帰宅' },
      ]
      const result = (decider as any).getNextScheduleInfo(schedule, { hour: 10, minute: 30, day: 1 })
      expect(result).toEqual({
        activity: '昼食',
        location: 'cafe',
        minutesUntil: 90,
      })
    })

    it('should skip entries with invalid time format', () => {
      const schedule = [
        { time: 'invalid', activity: '不正' },
        { time: '14:00', activity: '午後の予定' },
      ]
      const result = (decider as any).getNextScheduleInfo(schedule, { hour: 10, minute: 0, day: 1 })
      expect(result?.activity).toBe('午後の予定')
    })
  })

  describe('buildActionDescription edge cases', () => {
    it('should return base when config exists but has neither fixed nor durationRange', () => {
      decider.setActionConfigs({
        eat: { duration: 30 }, // has config but not fixed and no durationRange
      })
      const desc = decider.buildActionDescription('eat')
      expect(desc).toBe('食事')
    })

    it('should format fixed action without effects', () => {
      decider.setActionConfigs({
        rest: { fixed: true, duration: 10 },
      })
      const desc = decider.buildActionDescription('rest')
      expect(desc).toContain('固定10分')
      expect(desc).not.toContain('undefined')
    })
  })

  // =========================================================================
  // Bug: マルチタグ施設でのアクションID解決バグ
  // 施設 ['bathroom', 'toilet'] でtoiletを要求すると、先頭の'bathroom'から
  // 'bathe'が返されてしまう問題の再現テスト
  // =========================================================================

  describe('getActionIdFromFacility with multi-tag facility', () => {
    it('should return toilet when facility has [bathroom, toilet] and requestedAction is toilet', () => {
      const facility = { id: 'home-obstacle-5', label: '浴室', tags: ['bathroom', 'toilet'] as FacilityTag[] }
      const result = (decider as any).getActionIdFromFacility(facility, 'toilet')
      expect(result).toBe('toilet')
    })

    it('should return bathe when facility has [bathroom, toilet] and requestedAction is bathe', () => {
      const facility = { id: 'home-obstacle-5', label: '浴室', tags: ['bathroom', 'toilet'] as FacilityTag[] }
      const result = (decider as any).getActionIdFromFacility(facility, 'bathe')
      expect(result).toBe('bathe')
    })

    it('should return first match when no requestedAction is specified (backward compat)', () => {
      const facility = { id: 'home-obstacle-5', label: '浴室', tags: ['bathroom', 'toilet'] as FacilityTag[] }
      const result = (decider as any).getActionIdFromFacility(facility)
      // Without requestedAction, returns first match (existing behavior)
      expect(result).toBe('bathe')
    })

    it('should return toilet when facility has [toilet] only', () => {
      const facility = { id: 'toilet-1', label: 'トイレ', tags: ['toilet'] as FacilityTag[] }
      const result = (decider as any).getActionIdFromFacility(facility, 'toilet')
      expect(result).toBe('toilet')
    })
  })

  describe('decideInterruptFacility with multi-tag facility (bug reproduction)', () => {
    it('should select toilet action (not bathe) when forcedAction is toilet and facility has [bathroom, toilet]', async () => {
      const context = createTestContext({
        currentMapFacilities: [{
          id: 'home-obstacle-5',
          label: '浴室',
          tags: ['bathroom', 'toilet'] as FacilityTag[],
          availableActions: ['bathe', 'toilet'],
        }],
      })
      const decision = await decider.decideInterruptFacility('toilet', context)
      expect(decision.type).toBe('action')
      expect(decision.actionId).toBe('toilet')  // NOT 'bathe'
      expect(decision.targetFacilityId).toBe('home-obstacle-5')
    })

    it('should select bathe when forcedAction is bathe and facility has [bathroom, toilet]', async () => {
      const context = createTestContext({
        currentMapFacilities: [{
          id: 'home-obstacle-5',
          label: '浴室',
          tags: ['bathroom', 'toilet'] as FacilityTag[],
          availableActions: ['bathe', 'toilet'],
        }],
      })
      const decision = await decider.decideInterruptFacility('bathe', context)
      expect(decision.type).toBe('action')
      expect(decision.actionId).toBe('bathe')
      expect(decision.targetFacilityId).toBe('home-obstacle-5')
    })
  })

  describe('convertToInternalFormat with multi-tag facility (normal flow)', () => {
    it('should return toilet actionId when LLM decides toilet and facility has [bathroom, toilet]', async () => {
      const { llmGenerateObject } = await import('@/server/llm')
      vi.mocked(llmGenerateObject).mockResolvedValueOnce({
        action: 'toilet',
        target: null,
        reason: 'bladder is low',
        durationMinutes: 5,
        scheduleUpdate: null,
      })

      const context = createTestContext({
        currentMapFacilities: [{
          id: 'home-obstacle-5',
          label: '浴室',
          tags: ['bathroom', 'toilet'] as FacilityTag[],
          availableActions: ['bathe', 'toilet'],
        }],
      })
      const decision = await decider.decide(context)
      expect(decision.type).toBe('action')
      expect(decision.actionId).toBe('toilet')  // NOT 'bathe'
      expect(decision.targetFacilityId).toBe('home-obstacle-5')
    })

    it('should return bathe actionId when LLM decides bathe and facility has [bathroom, toilet]', async () => {
      const { llmGenerateObject } = await import('@/server/llm')
      vi.mocked(llmGenerateObject).mockResolvedValueOnce({
        action: 'bathe',
        target: null,
        reason: 'want to take a bath',
        durationMinutes: 30,
        scheduleUpdate: null,
      })

      const context = createTestContext({
        currentMapFacilities: [{
          id: 'home-obstacle-5',
          label: '浴室',
          tags: ['bathroom', 'toilet'] as FacilityTag[],
          availableActions: ['bathe', 'toilet'],
        }],
      })
      const decision = await decider.decide(context)
      expect(decision.type).toBe('action')
      expect(decision.actionId).toBe('bathe')
      expect(decision.targetFacilityId).toBe('home-obstacle-5')
    })
  })

  // =========================================================================
  // 副作用テスト: マルチタグ施設バグによるステータス影響
  // =========================================================================

  describe('side effects of multi-tag facility bug', () => {
    it('bathe action has no bladder recovery in perMinute effects', () => {
      // bathe の perMinute には bladder が含まれないことを確認
      // これにより bathe をいくら繰り返しても bladder は回復しない
      decider.setActionConfigs({
        bathe: { durationRange: { min: 15, max: 60, default: 30 }, perMinute: { hygiene: 3.33, mood: 0.5 } },
        toilet: { fixed: true, duration: 5, effects: { bladder: 100 } },
      })
      const batheDesc = decider.buildActionDescription('bathe')
      // bathe の perMinute は hygiene と mood のみ、bladder(膀胱) は含まない
      expect(batheDesc).not.toContain('膀胱')

      const toiletDesc = decider.buildActionDescription('toilet')
      // toilet の effects には bladder(膀胱) が含まれる
      expect(toiletDesc).toContain('膀胱')
    })

    it('repeated interrupt with wrong action should keep selecting same facility (loop detection)', async () => {
      // 同じ状況で繰り返し呼ばれた場合、同じ誤ったアクションが選ばれ続ける
      const context = createTestContext({
        currentMapFacilities: [{
          id: 'home-obstacle-5',
          label: '浴室',
          tags: ['bathroom', 'toilet'] as FacilityTag[],
          availableActions: ['bathe', 'toilet'],
        }],
      })

      // 3回連続で呼び出し - 全て同じ結果になるべき（ループの証明）
      const decisions = await Promise.all([
        decider.decideInterruptFacility('toilet', context),
        decider.decideInterruptFacility('toilet', context),
        decider.decideInterruptFacility('toilet', context),
      ])

      // 修正後は全て 'toilet' になるべき
      for (const decision of decisions) {
        expect(decision.actionId).toBe('toilet')
      }
    })
  })

  describe('private formatFacilityEntry', () => {
    it('should format facility with all fields', () => {
      const result = (decider as any).formatFacilityEntry({
        id: 'cafe-1',
        label: 'カフェ',
        tags: ['restaurant'],
        availableActions: ['eat'],
        cost: 500,
        quality: 4,
        distance: 2,
      })
      expect(result).toContain('cafe-1')
      expect(result).toContain('カフェ')
      expect(result).toContain('restaurant')
      expect(result).toContain('アクション: eat')
      expect(result).toContain('料金: 500円')
      expect(result).toContain('品質: 4')
      expect(result).toContain('距離: 2')
    })

    it('should format facility without optional fields', () => {
      const result = (decider as any).formatFacilityEntry({
        id: 'toilet-1',
        label: 'トイレ',
        tags: ['toilet'],
      })
      expect(result).toContain('toilet-1')
      expect(result).toContain('トイレ')
      expect(result).not.toContain('料金')
      expect(result).not.toContain('品質')
      expect(result).not.toContain('距離')
    })
  })
})
