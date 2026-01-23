import { describe, it, expect } from 'vitest'
import {
  serializeWorldState,
  deserializeWorldState,
  createSimCharacter,
  createSimNPC,
  DEFAULT_SIMULATION_CONFIG,
} from './types'
import type { WorldState, SimCharacter, SimNPC } from './types'
import type { Character, NPC } from '@/types'

describe('simulation types', () => {
  describe('serializeWorldState', () => {
    it('should convert Map to object', () => {
      const state: WorldState = {
        characters: new Map([
          ['char-1', createTestSimCharacter('char-1')],
        ]),
        npcs: new Map([
          ['npc-1', createTestSimNPC('npc-1')],
        ]),
        currentMapId: 'test-map',
        time: { hour: 12, minute: 30, day: 1 },
        isPaused: false,
        transition: {
          isTransitioning: false,
          characterId: null,
          fromMapId: null,
          toMapId: null,
          progress: 0,
        },
        tick: 42,
      }

      const serialized = serializeWorldState(state)

      expect(serialized.characters).toHaveProperty('char-1')
      expect(serialized.npcs).toHaveProperty('npc-1')
      expect(serialized.currentMapId).toBe('test-map')
      expect(serialized.time).toEqual({ hour: 12, minute: 30, day: 1 })
      expect(serialized.tick).toBe(42)
    })

    it('should create deep copies', () => {
      const state: WorldState = {
        characters: new Map(),
        npcs: new Map(),
        currentMapId: 'test',
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

      const serialized = serializeWorldState(state)
      state.time.hour = 99

      expect(serialized.time.hour).toBe(8)
    })
  })

  describe('deserializeWorldState', () => {
    it('should convert object to Map', () => {
      const serialized = {
        characters: { 'char-1': createTestSimCharacter('char-1') },
        npcs: { 'npc-1': createTestSimNPC('npc-1') },
        currentMapId: 'test-map',
        time: { hour: 12, minute: 30, day: 1 },
        isPaused: true,
        transition: {
          isTransitioning: false,
          characterId: null,
          fromMapId: null,
          toMapId: null,
          progress: 0,
        },
        tick: 42,
      }

      const state = deserializeWorldState(serialized)

      expect(state.characters.get('char-1')).toBeDefined()
      expect(state.npcs.get('npc-1')).toBeDefined()
      expect(state.currentMapId).toBe('test-map')
      expect(state.isPaused).toBe(true)
    })
  })

  describe('createSimCharacter', () => {
    it('should create SimCharacter from Character', () => {
      const char: Character = {
        id: 'test-char',
        name: 'Test Character',
        sprite: { sheetUrl: 'test.png', frameWidth: 96, frameHeight: 96, cols: 3, rows: 4, rowMapping: { down: 0, left: 1, right: 2, up: 3 } },
        money: 1000,
        satiety: 80,
        energy: 70,
        hygiene: 90,
        mood: 75,
        bladder: 60,
        currentMapId: 'test-map',
        currentNodeId: 'node-0-0',
        position: { x: 100, y: 200 },
        direction: 'down',
        employment: {
          jobId: 'barista',
          workplaces: [{ workplaceLabel: 'カフェカウンター', mapId: 'cafe' }],
        },
        personality: 'friendly',
        tendencies: ['social', 'curious'],
        customPrompt: 'Custom prompt',
      }

      const simChar = createSimCharacter(char)

      expect(simChar.id).toBe('test-char')
      expect(simChar.name).toBe('Test Character')
      expect(simChar.money).toBe(1000)
      expect(simChar.position).toEqual({ x: 100, y: 200 })
      expect(simChar.navigation.isMoving).toBe(false)
      expect(simChar.crossMapNavigation).toBeNull()
      expect(simChar.conversation).toBeNull()
      expect(simChar.currentAction).toBeNull()
      expect(simChar.pendingAction).toBeNull()
      expect(simChar.actionCounter).toBe(0)
      expect(simChar.employment?.jobId).toBe('barista')
      expect(simChar.personality).toBe('friendly')
      expect(simChar.tendencies).toEqual(['social', 'curious'])
    })

    it('should create deep copies of objects', () => {
      const char: Character = {
        id: 'test-char',
        name: 'Test',
        sprite: { sheetUrl: 'test.png', frameWidth: 96, frameHeight: 96, cols: 3, rows: 4, rowMapping: { down: 0, left: 1, right: 2, up: 3 } },
        money: 100,
        satiety: 50,
        energy: 50,
        hygiene: 50,
        mood: 50,
        bladder: 50,
        currentMapId: 'test',
        currentNodeId: 'node',
        position: { x: 100, y: 100 },
        direction: 'down',
      }

      const simChar = createSimCharacter(char)
      char.position.x = 999

      expect(simChar.position.x).toBe(100)
    })

    it('should handle character without optional fields', () => {
      const char: Character = {
        id: 'test-char',
        name: 'Test',
        sprite: { sheetUrl: 'test.png', frameWidth: 96, frameHeight: 96, cols: 3, rows: 4, rowMapping: { down: 0, left: 1, right: 2, up: 3 } },
        money: 100,
        satiety: 50,
        energy: 50,
        hygiene: 50,
        mood: 50,
        bladder: 50,
        currentMapId: 'test',
        currentNodeId: 'node',
        position: { x: 100, y: 100 },
        direction: 'down',
      }

      const simChar = createSimCharacter(char)

      expect(simChar.employment).toBeUndefined()
      expect(simChar.personality).toBeUndefined()
      expect(simChar.tendencies).toBeUndefined()
    })
  })

  describe('createSimNPC', () => {
    it('should create SimNPC from NPC', () => {
      const npc: NPC = {
        id: 'test-npc',
        name: 'Test NPC',
        sprite: { sheetUrl: 'npc.png', frameWidth: 96, frameHeight: 96, cols: 3, rows: 4, rowMapping: { down: 0, left: 1, right: 2, up: 3 } },
        mapId: 'test-map',
        currentNodeId: 'node-0-0',
        position: { x: 100, y: 200 },
        direction: 'right',
      }

      const simNPC = createSimNPC(npc)

      expect(simNPC.id).toBe('test-npc')
      expect(simNPC.name).toBe('Test NPC')
      expect(simNPC.mapId).toBe('test-map')
      expect(simNPC.position).toEqual({ x: 100, y: 200 })
      expect(simNPC.direction).toBe('right')
      expect(simNPC.isInConversation).toBe(false)
    })

    it('should create deep copy of position', () => {
      const npc: NPC = {
        id: 'test-npc',
        name: 'Test',
        sprite: { sheetUrl: 'npc.png', frameWidth: 96, frameHeight: 96, cols: 3, rows: 4, rowMapping: { down: 0, left: 1, right: 2, up: 3 } },
        mapId: 'test',
        currentNodeId: 'node',
        position: { x: 100, y: 100 },
        direction: 'down',
      }

      const simNPC = createSimNPC(npc)
      npc.position.x = 999

      expect(simNPC.position.x).toBe(100)
    })
  })

  describe('DEFAULT_SIMULATION_CONFIG', () => {
    it('should have valid default values', () => {
      expect(DEFAULT_SIMULATION_CONFIG.tickRate).toBe(20)
      expect(DEFAULT_SIMULATION_CONFIG.movementSpeed).toBe(75)
      expect(DEFAULT_SIMULATION_CONFIG.idleTimeMin).toBeGreaterThan(0)
      expect(DEFAULT_SIMULATION_CONFIG.idleTimeMax).toBeGreaterThan(DEFAULT_SIMULATION_CONFIG.idleTimeMin)
      expect(DEFAULT_SIMULATION_CONFIG.entranceProbability).toBeGreaterThanOrEqual(0)
      expect(DEFAULT_SIMULATION_CONFIG.entranceProbability).toBeLessThanOrEqual(1)
    })
  })
})

// Helper functions
function createTestSimCharacter(id: string): SimCharacter {
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

function createTestSimNPC(id: string): SimNPC {
  return {
    id,
    name: `NPC ${id}`,
    mapId: 'test-map',
    currentNodeId: 'node-0-0',
    position: { x: 100, y: 100 },
    direction: 'down',
    isInConversation: false,
  }
}
