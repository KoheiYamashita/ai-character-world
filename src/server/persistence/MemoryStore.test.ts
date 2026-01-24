import { describe, it, expect, beforeEach } from 'vitest'
import { MemoryStore } from './MemoryStore'
import type { SerializedWorldState, SimCharacter } from '../simulation/types'
import type { WorldTime, DailySchedule } from '@/types'

// Helper to create a test character
function createTestCharacter(id: string): SimCharacter {
  return {
    id,
    name: `Character ${id}`,
    sprite: { sheetUrl: 'test.png', frameWidth: 96, frameHeight: 96, cols: 3, rows: 4, rowMapping: { down: 0, left: 1, right: 2, up: 3 } },
    money: 1000,
    satiety: 80,
    energy: 70,
    hygiene: 90,
    mood: 75,
    bladder: 60,
    currentMapId: 'test-map',
    currentNodeId: 'node-0-0',
    position: { x: 100, y: 100 },
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
  }
}

// Helper to create a test world state
function createTestWorldState(): SerializedWorldState {
  return {
    characters: {
      'char-1': createTestCharacter('char-1'),
    },
    npcs: {},
    currentMapId: 'test-map',
    time: { hour: 8, minute: 0, day: 1 },
    isPaused: false,
    transition: {
      isTransitioning: false,
      characterId: null,
      fromMapId: null,
      toMapId: null,
      progress: 0,
    },
    tick: 0,
  }
}

describe('MemoryStore', () => {
  let store: MemoryStore

  beforeEach(() => {
    store = new MemoryStore()
  })

  describe('state management', () => {
    it('should save and load state', async () => {
      const state = createTestWorldState()
      await store.saveState(state)

      const loaded = await store.loadState()

      expect(loaded).not.toBeNull()
      expect(loaded!.currentMapId).toBe('test-map')
      expect(loaded!.characters['char-1']).toBeDefined()
    })

    it('should return null when no state saved', async () => {
      const loaded = await store.loadState()
      expect(loaded).toBeNull()
    })

    it('should deep clone state to avoid mutations', async () => {
      const state = createTestWorldState()
      await store.saveState(state)

      // Mutate original
      state.currentMapId = 'mutated'

      const loaded = await store.loadState()
      expect(loaded!.currentMapId).toBe('test-map')
    })
  })

  describe('character management', () => {
    it('should save and load character', async () => {
      const char = createTestCharacter('char-1')
      await store.saveCharacter('char-1', char)

      const loaded = await store.loadCharacter('char-1')

      expect(loaded).not.toBeNull()
      expect(loaded!.id).toBe('char-1')
    })

    it('should return null for non-existent character', async () => {
      const loaded = await store.loadCharacter('non-existent')
      expect(loaded).toBeNull()
    })

    it('should load all characters', async () => {
      await store.saveCharacter('char-1', createTestCharacter('char-1'))
      await store.saveCharacter('char-2', createTestCharacter('char-2'))

      const all = await store.loadAllCharacters()

      expect(Object.keys(all)).toHaveLength(2)
      expect(all['char-1']).toBeDefined()
      expect(all['char-2']).toBeDefined()
    })

    it('should delete character', async () => {
      await store.saveCharacter('char-1', createTestCharacter('char-1'))
      await store.deleteCharacter('char-1')

      const loaded = await store.loadCharacter('char-1')
      expect(loaded).toBeNull()
    })

    it('should update full state when character saved', async () => {
      const state = createTestWorldState()
      await store.saveState(state)

      const updatedChar = createTestCharacter('char-1')
      updatedChar.money = 500
      await store.saveCharacter('char-1', updatedChar)

      const loaded = await store.loadState()
      expect(loaded!.characters['char-1'].money).toBe(500)
    })

    it('should deep clone character to avoid mutations', async () => {
      const char = createTestCharacter('char-1')
      await store.saveCharacter('char-1', char)

      // Mutate original
      char.money = 999

      const loaded = await store.loadCharacter('char-1')
      expect(loaded!.money).toBe(1000)
    })
  })

  describe('time management', () => {
    it('should save and load time', async () => {
      const time: WorldTime = { hour: 14, minute: 30, day: 3 }
      await store.saveTime(time)

      const loaded = await store.loadTime()

      expect(loaded).toEqual({ hour: 14, minute: 30, day: 3 })
    })

    it('should return null when no time saved', async () => {
      const loaded = await store.loadTime()
      expect(loaded).toBeNull()
    })

    it('should update full state when time saved', async () => {
      const state = createTestWorldState()
      await store.saveState(state)

      await store.saveTime({ hour: 12, minute: 0, day: 2 })

      const loaded = await store.loadState()
      expect(loaded!.time).toEqual({ hour: 12, minute: 0, day: 2 })
    })
  })

  describe('map management', () => {
    it('should save and load current map id', async () => {
      await store.saveCurrentMapId('new-map')

      const loaded = await store.loadCurrentMapId()

      expect(loaded).toBe('new-map')
    })

    it('should return null when no map id saved', async () => {
      const loaded = await store.loadCurrentMapId()
      expect(loaded).toBeNull()
    })

    it('should update full state when map id saved', async () => {
      const state = createTestWorldState()
      await store.saveState(state)

      await store.saveCurrentMapId('other-map')

      const loaded = await store.loadState()
      expect(loaded!.currentMapId).toBe('other-map')
    })
  })

  describe('schedule management', () => {
    it('should save and load schedule', async () => {
      const schedule: DailySchedule = {
        characterId: 'char-1',
        day: 1,
        entries: [
          { time: '08:00', activity: 'wake_up' },
          { time: '09:00', activity: 'work' },
        ],
      }
      await store.saveSchedule(schedule)

      const loaded = await store.loadSchedule('char-1', 1)

      expect(loaded).not.toBeNull()
      expect(loaded!.entries).toHaveLength(2)
    })

    it('should return null for non-existent schedule', async () => {
      const loaded = await store.loadSchedule('char-1', 99)
      expect(loaded).toBeNull()
    })

    it('should load schedules for character', async () => {
      await store.saveSchedule({
        characterId: 'char-1',
        day: 1,
        entries: [],
      })
      await store.saveSchedule({
        characterId: 'char-1',
        day: 2,
        entries: [],
      })
      await store.saveSchedule({
        characterId: 'char-2',
        day: 1,
        entries: [],
      })

      const result = await store.loadSchedulesForCharacter('char-1')

      expect(result).toHaveLength(2)
      expect(result[0].day).toBe(1)
      expect(result[1].day).toBe(2)
    })

    it('should delete schedule', async () => {
      await store.saveSchedule({
        characterId: 'char-1',
        day: 1,
        entries: [],
      })
      await store.deleteSchedule('char-1', 1)

      const loaded = await store.loadSchedule('char-1', 1)
      expect(loaded).toBeNull()
    })

    it('should delete all schedules for character', async () => {
      await store.saveSchedule({
        characterId: 'char-1',
        day: 1,
        entries: [],
      })
      await store.saveSchedule({
        characterId: 'char-1',
        day: 2,
        entries: [],
      })

      await store.deleteAllSchedulesForCharacter('char-1')

      const result = await store.loadSchedulesForCharacter('char-1')
      expect(result).toHaveLength(0)
    })
  })

  describe('action history management', () => {
    it('should add and load action history', async () => {
      await store.addActionHistory({
        characterId: 'char-1',
        day: 1,
        time: '08:00',
        actionId: 'eat',
        durationMinutes: 30,
      })

      const history = await store.loadActionHistoryForDay('char-1', 1)

      expect(history).toHaveLength(1)
      expect(history[0].actionId).toBe('eat')
      expect(history[0].time).toBe('08:00')
    })

    it('should accumulate action history', async () => {
      await store.addActionHistory({
        characterId: 'char-1',
        day: 1,
        time: '08:00',
        actionId: 'eat',
      })
      await store.addActionHistory({
        characterId: 'char-1',
        day: 1,
        time: '09:00',
        actionId: 'work',
      })

      const history = await store.loadActionHistoryForDay('char-1', 1)

      expect(history).toHaveLength(2)
    })

    it('should return empty array for non-existent history', async () => {
      const history = await store.loadActionHistoryForDay('char-1', 99)
      expect(history).toHaveLength(0)
    })

    it('should keep history separate by day', async () => {
      await store.addActionHistory({
        characterId: 'char-1',
        day: 1,
        time: '08:00',
        actionId: 'eat',
      })
      await store.addActionHistory({
        characterId: 'char-1',
        day: 2,
        time: '08:00',
        actionId: 'sleep',
      })

      const day1 = await store.loadActionHistoryForDay('char-1', 1)
      const day2 = await store.loadActionHistoryForDay('char-1', 2)

      expect(day1).toHaveLength(1)
      expect(day1[0].actionId).toBe('eat')
      expect(day2).toHaveLength(1)
      expect(day2[0].actionId).toBe('sleep')
    })

    it('should update episode on matching entry', async () => {
      await store.addActionHistory({
        characterId: 'char-1',
        day: 1,
        time: '08:00',
        actionId: 'eat',
      })
      await store.addActionHistory({
        characterId: 'char-1',
        day: 1,
        time: '10:00',
        actionId: 'work',
      })

      await store.updateActionHistoryEpisode('char-1', 1, '08:00', 'おいしかった')

      const history = await store.loadActionHistoryForDay('char-1', 1)
      expect(history[0].episode).toBe('おいしかった')
      expect(history[1].episode).toBeUndefined()
    })

    it('should update last matching entry when multiple have same time', async () => {
      await store.addActionHistory({
        characterId: 'char-1',
        day: 1,
        time: '08:00',
        actionId: 'eat',
      })
      await store.addActionHistory({
        characterId: 'char-1',
        day: 1,
        time: '08:00',
        actionId: 'rest',
      })

      await store.updateActionHistoryEpisode('char-1', 1, '08:00', 'エピソード')

      const history = await store.loadActionHistoryForDay('char-1', 1)
      expect(history[0].episode).toBeUndefined() // first entry unchanged
      expect(history[1].episode).toBe('エピソード') // last entry updated
    })

    it('should not update entries with non-matching time', async () => {
      await store.addActionHistory({
        characterId: 'char-1',
        day: 1,
        time: '08:00',
        actionId: 'eat',
      })

      await store.updateActionHistoryEpisode('char-1', 1, '09:00', 'エピソード')

      const history = await store.loadActionHistoryForDay('char-1', 1)
      expect(history[0].episode).toBeUndefined()
    })

    it('should not crash when no entries exist', async () => {
      await store.updateActionHistoryEpisode('char-1', 1, '08:00', 'エピソード')
      // Should not throw
    })
  })

  describe('mid-term memories', () => {
    it('should add and load active mid-term memories', async () => {
      await store.addMidTermMemory({
        id: 'mem-1',
        characterId: 'char-1',
        content: '明日カフェで待ち合わせ',
        importance: 'high',
        createdDay: 1,
        expiresDay: 3,
        sourceNpcId: 'npc-1',
      })

      const memories = await store.loadActiveMidTermMemories('char-1', 1)
      expect(memories).toHaveLength(1)
      expect(memories[0].content).toBe('明日カフェで待ち合わせ')
      expect(memories[0].importance).toBe('high')
      expect(memories[0].sourceNpcId).toBe('npc-1')
    })

    it('should filter by characterId', async () => {
      await store.addMidTermMemory({
        id: 'mem-1',
        characterId: 'char-1',
        content: 'memory for char-1',
        importance: 'medium',
        createdDay: 1,
        expiresDay: 2,
      })
      await store.addMidTermMemory({
        id: 'mem-2',
        characterId: 'char-2',
        content: 'memory for char-2',
        importance: 'low',
        createdDay: 1,
        expiresDay: 1,
      })

      const char1Memories = await store.loadActiveMidTermMemories('char-1', 1)
      const char2Memories = await store.loadActiveMidTermMemories('char-2', 1)

      expect(char1Memories).toHaveLength(1)
      expect(char1Memories[0].content).toBe('memory for char-1')
      expect(char2Memories).toHaveLength(1)
      expect(char2Memories[0].content).toBe('memory for char-2')
    })

    it('should not return expired memories', async () => {
      await store.addMidTermMemory({
        id: 'mem-1',
        characterId: 'char-1',
        content: 'expired memory',
        importance: 'low',
        createdDay: 1,
        expiresDay: 1, // expires on day 1
      })
      await store.addMidTermMemory({
        id: 'mem-2',
        characterId: 'char-1',
        content: 'active memory',
        importance: 'high',
        createdDay: 1,
        expiresDay: 3, // expires on day 3
      })

      // On day 2, mem-1 should be expired (expiresDay < currentDay)
      const memories = await store.loadActiveMidTermMemories('char-1', 2)
      expect(memories).toHaveLength(1)
      expect(memories[0].content).toBe('active memory')
    })

    it('should return memories sorted by createdDay descending', async () => {
      await store.addMidTermMemory({
        id: 'mem-1',
        characterId: 'char-1',
        content: 'older memory',
        importance: 'medium',
        createdDay: 1,
        expiresDay: 5,
      })
      await store.addMidTermMemory({
        id: 'mem-2',
        characterId: 'char-1',
        content: 'newer memory',
        importance: 'high',
        createdDay: 3,
        expiresDay: 5,
      })

      const memories = await store.loadActiveMidTermMemories('char-1', 1)
      expect(memories).toHaveLength(2)
      expect(memories[0].content).toBe('newer memory')
      expect(memories[1].content).toBe('older memory')
    })

    it('should delete expired memories', async () => {
      await store.addMidTermMemory({
        id: 'mem-1',
        characterId: 'char-1',
        content: 'low importance',
        importance: 'low',
        createdDay: 1,
        expiresDay: 1,
      })
      await store.addMidTermMemory({
        id: 'mem-2',
        characterId: 'char-1',
        content: 'medium importance',
        importance: 'medium',
        createdDay: 1,
        expiresDay: 2,
      })
      await store.addMidTermMemory({
        id: 'mem-3',
        characterId: 'char-1',
        content: 'high importance',
        importance: 'high',
        createdDay: 1,
        expiresDay: 3,
      })

      // On day 3, mem-1 and mem-2 should be expired
      const deleted = await store.deleteExpiredMidTermMemories(3)
      expect(deleted).toBe(2)

      // Only mem-3 should remain
      const remaining = await store.loadActiveMidTermMemories('char-1', 3)
      expect(remaining).toHaveLength(1)
      expect(remaining[0].content).toBe('high importance')
    })

    it('should return 0 when no memories to delete', async () => {
      const deleted = await store.deleteExpiredMidTermMemories(1)
      expect(deleted).toBe(0)
    })

    it('should be cleared with clear()', async () => {
      await store.addMidTermMemory({
        id: 'mem-1',
        characterId: 'char-1',
        content: 'test memory',
        importance: 'high',
        createdDay: 1,
        expiresDay: 5,
      })

      await store.clear()

      const memories = await store.loadActiveMidTermMemories('char-1', 1)
      expect(memories).toHaveLength(0)
    })
  })

  describe('hasData', () => {
    it('should return false when empty', async () => {
      const result = await store.hasData()
      expect(result).toBe(false)
    })

    it('should return true when state is saved', async () => {
      await store.saveState(createTestWorldState())
      const result = await store.hasData()
      expect(result).toBe(true)
    })

    it('should return true when characters exist', async () => {
      await store.saveCharacter('char-1', createTestCharacter('char-1'))
      const result = await store.hasData()
      expect(result).toBe(true)
    })
  })

  describe('clear', () => {
    it('should clear all data', async () => {
      await store.saveState(createTestWorldState())
      await store.saveCharacter('char-1', createTestCharacter('char-1'))
      await store.saveTime({ hour: 12, minute: 0, day: 1 })
      await store.saveSchedule({
        characterId: 'char-1',
        day: 1,
        entries: [],
      })
      await store.addActionHistory({
        characterId: 'char-1',
        day: 1,
        time: '08:00',
        actionId: 'eat',
      })

      await store.clear()

      expect(await store.loadState()).toBeNull()
      expect(await store.loadCharacter('char-1')).toBeNull()
      expect(await store.loadTime()).toBeNull()
      expect(await store.loadSchedule('char-1', 1)).toBeNull()
      expect(await store.loadActionHistoryForDay('char-1', 1)).toHaveLength(0)
    })
  })

  describe('close', () => {
    it('should complete without error', async () => {
      await expect(store.close()).resolves.not.toThrow()
    })
  })
})
