import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { SqliteStore } from './SqliteStore'
import type { SimCharacter } from '../simulation/types'
import type { SerializedWorldState } from '../simulation/types'
// Mock fs.existsSync and mkdirSync to avoid file system operations
vi.mock('fs', () => ({
  existsSync: vi.fn(() => true),
  mkdirSync: vi.fn(),
}))

describe('SqliteStore', () => {
  let store: SqliteStore

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    // Use in-memory database for testing
    store = new SqliteStore(':memory:')
  })

  afterEach(async () => {
    await store.close()
    vi.restoreAllMocks()
  })

  function createTestSimCharacter(id: string, overrides: Partial<SimCharacter> = {}): SimCharacter {
    return {
      id,
      name: `Character ${id}`,
      sprite: {
        sheetUrl: 'test.png',
        frameWidth: 96,
        frameHeight: 96,
        cols: 3,
        rows: 4,
        rowMapping: { down: 0, left: 1, right: 2, up: 3 },
      },
      money: 100,
      satiety: 80.5,
      energy: 75.33,
      hygiene: 60.999,
      mood: 90,
      bladder: 50,
      currentMapId: 'town',
      currentNodeId: 'node-0-0',
      position: { x: 100.5, y: 200.3 },
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

  describe('hasData', () => {
    it('should return false when empty', async () => {
      expect(await store.hasData()).toBe(false)
    })

    it('should return true after saving a character', async () => {
      await store.saveCharacter('c1', createTestSimCharacter('c1'))
      expect(await store.hasData()).toBe(true)
    })
  })

  describe('saveCharacter / loadCharacter', () => {
    it('should save and load a character', async () => {
      const char = createTestSimCharacter('c1')
      await store.saveCharacter('c1', char)
      const loaded = await store.loadCharacter('c1')
      expect(loaded).not.toBeNull()
      expect(loaded!.id).toBe('c1')
      expect(loaded!.name).toBe('Character c1')
      expect(loaded!.money).toBe(100)
      expect(loaded!.currentMapId).toBe('town')
      expect(loaded!.position.x).toBe(100.5)
      expect(loaded!.direction).toBe('down')
    })

    it('should round status values to 2 decimal places', async () => {
      const char = createTestSimCharacter('c1', { hygiene: 60.999 })
      await store.saveCharacter('c1', char)
      const loaded = await store.loadCharacter('c1')
      expect(loaded!.hygiene).toBe(61) // round2(60.999) = 61.00
    })

    it('should return null for non-existent character', async () => {
      const loaded = await store.loadCharacter('nonexistent')
      expect(loaded).toBeNull()
    })

    it('should initialize runtime state on load', async () => {
      await store.saveCharacter('c1', createTestSimCharacter('c1'))
      const loaded = await store.loadCharacter('c1')
      expect(loaded!.navigation.isMoving).toBe(false)
      expect(loaded!.crossMapNavigation).toBeNull()
      expect(loaded!.conversation).toBeNull()
      expect(loaded!.currentAction).toBeNull()
      expect(loaded!.pendingAction).toBeNull()
      expect(loaded!.actionCounter).toBe(0)
    })

    it('should handle employment field', async () => {
      const char = createTestSimCharacter('c1', {
        employment: { jobId: 'cook', workplaces: [{ workplaceLabel: 'キッチン', mapId: 'cafe' }] },
      })
      await store.saveCharacter('c1', char)
      const loaded = await store.loadCharacter('c1')
      expect(loaded!.employment).toEqual({ jobId: 'cook', workplaces: [{ workplaceLabel: 'キッチン', mapId: 'cafe' }] })
    })
  })

  describe('loadAllCharacters', () => {
    it('should load all saved characters', async () => {
      await store.saveCharacter('c1', createTestSimCharacter('c1'))
      await store.saveCharacter('c2', createTestSimCharacter('c2'))
      const all = await store.loadAllCharacters()
      expect(Object.keys(all)).toHaveLength(2)
      expect(all['c1'].id).toBe('c1')
      expect(all['c2'].id).toBe('c2')
    })

    it('should return empty object when no characters', async () => {
      const all = await store.loadAllCharacters()
      expect(Object.keys(all)).toHaveLength(0)
    })
  })

  describe('deleteCharacter', () => {
    it('should delete a character', async () => {
      await store.saveCharacter('c1', createTestSimCharacter('c1'))
      await store.deleteCharacter('c1')
      expect(await store.loadCharacter('c1')).toBeNull()
    })
  })

  describe('saveState / loadState', () => {
    it('should save and load complete state', async () => {
      const state: SerializedWorldState = {
        characters: { c1: createTestSimCharacter('c1') },
        npcs: {},
        currentMapId: 'cafe',
        time: { hour: 12, minute: 30, day: 2 },
        isPaused: false,
        transition: { isTransitioning: false, characterId: null, fromMapId: null, toMapId: null, progress: 0 },
        tick: 100,
      }
      await store.saveState(state)
      const loaded = await store.loadState()
      expect(loaded).not.toBeNull()
      expect(loaded!.characters['c1'].name).toBe('Character c1')
      expect(loaded!.time).toEqual({ hour: 12, minute: 30, day: 2 })
      expect(loaded!.currentMapId).toBe('cafe')
    })

    it('should return null when no data exists', async () => {
      const loaded = await store.loadState()
      expect(loaded).toBeNull()
    })

    it('should remove characters not in new state', async () => {
      await store.saveCharacter('c1', createTestSimCharacter('c1'))
      await store.saveCharacter('c2', createTestSimCharacter('c2'))

      const state: SerializedWorldState = {
        characters: { c1: createTestSimCharacter('c1') },
        npcs: {},
        currentMapId: 'town',
        time: { hour: 8, minute: 0, day: 1 },
        isPaused: false,
        transition: { isTransitioning: false, characterId: null, fromMapId: null, toMapId: null, progress: 0 },
        tick: 0,
      }
      await store.saveState(state)
      const loaded = await store.loadState()
      expect(Object.keys(loaded!.characters)).toEqual(['c1'])
    })
  })

  describe('saveTime / loadTime', () => {
    it('should save and load time', async () => {
      await store.saveTime({ hour: 15, minute: 45, day: 3 })
      const time = await store.loadTime()
      expect(time).toEqual({ hour: 15, minute: 45, day: 3 })
    })

    it('should return null when no time saved', async () => {
      expect(await store.loadTime()).toBeNull()
    })

    it('should overwrite previous time', async () => {
      await store.saveTime({ hour: 8, minute: 0, day: 1 })
      await store.saveTime({ hour: 12, minute: 30, day: 2 })
      const time = await store.loadTime()
      expect(time).toEqual({ hour: 12, minute: 30, day: 2 })
    })
  })

  describe('saveSchedule / loadSchedule', () => {
    it('should save and load a schedule', async () => {
      const schedule = {
        characterId: 'c1',
        day: 1,
        entries: [
          { time: '09:00', activity: '仕事' },
          { time: '12:00', activity: '昼食' },
        ],
      }
      await store.saveSchedule(schedule)
      const loaded = await store.loadSchedule('c1', 1)
      expect(loaded).not.toBeNull()
      expect(loaded!.entries).toHaveLength(2)
      expect(loaded!.entries[0].time).toBe('09:00')
    })

    it('should return null for non-existent schedule', async () => {
      expect(await store.loadSchedule('c1', 99)).toBeNull()
    })

    it('should update existing schedule (upsert)', async () => {
      await store.saveSchedule({ characterId: 'c1', day: 1, entries: [{ time: '09:00', activity: 'A' }] })
      await store.saveSchedule({ characterId: 'c1', day: 1, entries: [{ time: '10:00', activity: 'B' }] })
      const loaded = await store.loadSchedule('c1', 1)
      expect(loaded!.entries[0].activity).toBe('B')
    })
  })

  describe('loadSchedulesForCharacter', () => {
    it('should load all schedules for a character', async () => {
      await store.saveSchedule({ characterId: 'c1', day: 1, entries: [{ time: '09:00', activity: 'A' }] })
      await store.saveSchedule({ characterId: 'c1', day: 2, entries: [{ time: '10:00', activity: 'B' }] })
      await store.saveSchedule({ characterId: 'c2', day: 1, entries: [{ time: '11:00', activity: 'C' }] })
      const schedules = await store.loadSchedulesForCharacter('c1')
      expect(schedules).toHaveLength(2)
    })
  })

  describe('deleteSchedule / deleteAllSchedulesForCharacter', () => {
    it('should delete a specific schedule', async () => {
      await store.saveSchedule({ characterId: 'c1', day: 1, entries: [] })
      await store.deleteSchedule('c1', 1)
      expect(await store.loadSchedule('c1', 1)).toBeNull()
    })

    it('should delete all schedules for a character', async () => {
      await store.saveSchedule({ characterId: 'c1', day: 1, entries: [] })
      await store.saveSchedule({ characterId: 'c1', day: 2, entries: [] })
      await store.deleteAllSchedulesForCharacter('c1')
      const schedules = await store.loadSchedulesForCharacter('c1')
      expect(schedules).toHaveLength(0)
    })
  })

  describe('addActionHistory / loadActionHistoryForDay', () => {
    it('should save and load action history', async () => {
      await store.addActionHistory({
        characterId: 'c1',
        day: 1,
        time: '09:30',
        actionId: 'eat',
        target: 'kitchen-1',
        durationMinutes: 30,
        reason: 'おなかが空いた',
      })
      const history = await store.loadActionHistoryForDay('c1', 1)
      expect(history).toHaveLength(1)
      expect(history[0].actionId).toBe('eat')
      expect(history[0].target).toBe('kitchen-1')
      expect(history[0].durationMinutes).toBe(30)
      expect(history[0].reason).toBe('おなかが空いた')
    })

    it('should handle optional fields', async () => {
      await store.addActionHistory({
        characterId: 'c1',
        day: 1,
        time: '10:00',
        actionId: 'rest',
      })
      const history = await store.loadActionHistoryForDay('c1', 1)
      expect(history[0].target).toBeUndefined()
      expect(history[0].durationMinutes).toBeUndefined()
      expect(history[0].reason).toBeUndefined()
    })

    it('should return entries ordered by time', async () => {
      await store.addActionHistory({ characterId: 'c1', day: 1, time: '12:00', actionId: 'eat' })
      await store.addActionHistory({ characterId: 'c1', day: 1, time: '09:00', actionId: 'work' })
      const history = await store.loadActionHistoryForDay('c1', 1)
      expect(history[0].time).toBe('09:00')
      expect(history[1].time).toBe('12:00')
    })

    it('should return empty array for no history', async () => {
      const history = await store.loadActionHistoryForDay('c1', 99)
      expect(history).toEqual([])
    })
  })

  describe('clear', () => {
    it('should clear all data', async () => {
      await store.saveCharacter('c1', createTestSimCharacter('c1'))
      await store.saveTime({ hour: 8, minute: 0, day: 1 })
      await store.saveSchedule({ characterId: 'c1', day: 1, entries: [] })
      await store.clear()
      expect(await store.hasData()).toBe(false)
      expect(await store.loadTime()).toBeNull()
    })
  })

  describe('saveCurrentMapId / loadCurrentMapId', () => {
    it('should save and load current map id', async () => {
      await store.saveCurrentMapId('cafe')
      const mapId = await store.loadCurrentMapId()
      expect(mapId).toBe('cafe')
    })

    it('should return null when not set', async () => {
      expect(await store.loadCurrentMapId()).toBeNull()
    })
  })

  describe('saveServerStartTime / loadServerStartTime', () => {
    it('should save and load server start time', async () => {
      const time = Date.now()
      await store.saveServerStartTime(time)
      const loaded = await store.loadServerStartTime()
      expect(loaded).toBe(time)
    })
  })
})
