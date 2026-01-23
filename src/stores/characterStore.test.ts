import { describe, it, expect, beforeEach } from 'vitest'
import { useCharacterStore } from './characterStore'
import type { Character } from '@/types'

function createTestCharacter(id: string, overrides: Partial<Character> = {}): Character {
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
    satiety: 80,
    energy: 80,
    hygiene: 80,
    mood: 80,
    bladder: 80,
    currentMapId: 'town',
    currentNodeId: 'node-0-0',
    position: { x: 100, y: 100 },
    direction: 'down',
    ...overrides,
  }
}

describe('characterStore', () => {
  beforeEach(() => {
    useCharacterStore.setState({
      characters: new Map(),
      activeCharacterId: null,
    })
  })

  describe('addCharacter', () => {
    it('should add a character to the store', () => {
      const char = createTestCharacter('c1')
      useCharacterStore.getState().addCharacter(char)
      expect(useCharacterStore.getState().characters.get('c1')).toEqual(char)
    })

    it('should preserve existing characters when adding', () => {
      const char1 = createTestCharacter('c1')
      const char2 = createTestCharacter('c2')
      useCharacterStore.getState().addCharacter(char1)
      useCharacterStore.getState().addCharacter(char2)
      expect(useCharacterStore.getState().characters.size).toBe(2)
    })
  })

  describe('removeCharacter', () => {
    it('should remove a character from the store', () => {
      const char = createTestCharacter('c1')
      useCharacterStore.getState().addCharacter(char)
      useCharacterStore.getState().removeCharacter('c1')
      expect(useCharacterStore.getState().characters.has('c1')).toBe(false)
    })

    it('should not affect other characters', () => {
      useCharacterStore.getState().addCharacter(createTestCharacter('c1'))
      useCharacterStore.getState().addCharacter(createTestCharacter('c2'))
      useCharacterStore.getState().removeCharacter('c1')
      expect(useCharacterStore.getState().characters.has('c2')).toBe(true)
    })
  })

  describe('updateCharacter', () => {
    it('should partially update a character', () => {
      useCharacterStore.getState().addCharacter(createTestCharacter('c1'))
      useCharacterStore.getState().updateCharacter('c1', { name: 'Updated' })
      expect(useCharacterStore.getState().characters.get('c1')?.name).toBe('Updated')
      expect(useCharacterStore.getState().characters.get('c1')?.money).toBe(100)
    })

    it('should not change state for non-existent id', () => {
      const before = useCharacterStore.getState().characters
      useCharacterStore.getState().updateCharacter('nonexistent', { name: 'X' })
      expect(useCharacterStore.getState().characters).toBe(before)
    })
  })

  describe('updatePosition', () => {
    it('should update character position', () => {
      useCharacterStore.getState().addCharacter(createTestCharacter('c1'))
      useCharacterStore.getState().updatePosition('c1', { x: 200, y: 300 })
      expect(useCharacterStore.getState().characters.get('c1')?.position).toEqual({ x: 200, y: 300 })
    })

    it('should not change state for non-existent id', () => {
      const before = useCharacterStore.getState().characters
      useCharacterStore.getState().updatePosition('nonexistent', { x: 0, y: 0 })
      expect(useCharacterStore.getState().characters).toBe(before)
    })
  })

  describe('updateDirection', () => {
    it('should update character direction', () => {
      useCharacterStore.getState().addCharacter(createTestCharacter('c1'))
      useCharacterStore.getState().updateDirection('c1', 'up')
      expect(useCharacterStore.getState().characters.get('c1')?.direction).toBe('up')
    })
  })

  describe('setActiveCharacter / getActiveCharacter', () => {
    it('should set and get active character', () => {
      const char = createTestCharacter('c1')
      useCharacterStore.getState().addCharacter(char)
      useCharacterStore.getState().setActiveCharacter('c1')
      expect(useCharacterStore.getState().activeCharacterId).toBe('c1')
      expect(useCharacterStore.getState().getActiveCharacter()).toEqual(char)
    })

    it('should return undefined when no active character', () => {
      expect(useCharacterStore.getState().getActiveCharacter()).toBeUndefined()
    })

    it('should allow setting null', () => {
      useCharacterStore.getState().setActiveCharacter('c1')
      useCharacterStore.getState().setActiveCharacter(null)
      expect(useCharacterStore.getState().activeCharacterId).toBeNull()
    })
  })

  describe('getCharacter', () => {
    it('should return character by id', () => {
      const char = createTestCharacter('c1')
      useCharacterStore.getState().addCharacter(char)
      expect(useCharacterStore.getState().getCharacter('c1')).toEqual(char)
    })

    it('should return undefined for non-existent id', () => {
      expect(useCharacterStore.getState().getCharacter('nonexistent')).toBeUndefined()
    })
  })

  describe('setCharacterMap', () => {
    it('should update mapId, nodeId, and position together', () => {
      useCharacterStore.getState().addCharacter(createTestCharacter('c1'))
      useCharacterStore.getState().setCharacterMap('c1', 'cafe', 'node-1-1', { x: 50, y: 50 })
      const char = useCharacterStore.getState().characters.get('c1')
      expect(char?.currentMapId).toBe('cafe')
      expect(char?.currentNodeId).toBe('node-1-1')
      expect(char?.position).toEqual({ x: 50, y: 50 })
    })

    it('should not change state for non-existent id', () => {
      const before = useCharacterStore.getState().characters
      useCharacterStore.getState().setCharacterMap('nonexistent', 'cafe', 'n', { x: 0, y: 0 })
      expect(useCharacterStore.getState().characters).toBe(before)
    })
  })

  describe('updateStat', () => {
    it('should add delta to stat value', () => {
      useCharacterStore.getState().addCharacter(createTestCharacter('c1', { satiety: 50 }))
      useCharacterStore.getState().updateStat('c1', 'satiety', 10)
      expect(useCharacterStore.getState().characters.get('c1')?.satiety).toBe(60)
    })

    it('should clamp to 0 minimum', () => {
      useCharacterStore.getState().addCharacter(createTestCharacter('c1', { energy: 10 }))
      useCharacterStore.getState().updateStat('c1', 'energy', -50)
      expect(useCharacterStore.getState().characters.get('c1')?.energy).toBe(0)
    })

    it('should clamp to 100 maximum', () => {
      useCharacterStore.getState().addCharacter(createTestCharacter('c1', { mood: 90 }))
      useCharacterStore.getState().updateStat('c1', 'mood', 50)
      expect(useCharacterStore.getState().characters.get('c1')?.mood).toBe(100)
    })

    it('should work with negative delta', () => {
      useCharacterStore.getState().addCharacter(createTestCharacter('c1', { hygiene: 80 }))
      useCharacterStore.getState().updateStat('c1', 'hygiene', -20)
      expect(useCharacterStore.getState().characters.get('c1')?.hygiene).toBe(60)
    })
  })

  describe('updateMoney', () => {
    it('should add positive delta', () => {
      useCharacterStore.getState().addCharacter(createTestCharacter('c1', { money: 100 }))
      useCharacterStore.getState().updateMoney('c1', 50)
      expect(useCharacterStore.getState().characters.get('c1')?.money).toBe(150)
    })

    it('should allow negative values (debt)', () => {
      useCharacterStore.getState().addCharacter(createTestCharacter('c1', { money: 10 }))
      useCharacterStore.getState().updateMoney('c1', -50)
      expect(useCharacterStore.getState().characters.get('c1')?.money).toBe(-40)
    })
  })

  describe('convenience stat methods', () => {
    it('updateSatiety should delegate to updateStat', () => {
      useCharacterStore.getState().addCharacter(createTestCharacter('c1', { satiety: 50 }))
      useCharacterStore.getState().updateSatiety('c1', 10)
      expect(useCharacterStore.getState().characters.get('c1')?.satiety).toBe(60)
    })

    it('updateEnergy should delegate to updateStat', () => {
      useCharacterStore.getState().addCharacter(createTestCharacter('c1', { energy: 50 }))
      useCharacterStore.getState().updateEnergy('c1', -10)
      expect(useCharacterStore.getState().characters.get('c1')?.energy).toBe(40)
    })

    it('updateBladder should delegate to updateStat', () => {
      useCharacterStore.getState().addCharacter(createTestCharacter('c1', { bladder: 50 }))
      useCharacterStore.getState().updateBladder('c1', 30)
      expect(useCharacterStore.getState().characters.get('c1')?.bladder).toBe(80)
    })

    it('updateHygiene should delegate to updateStat', () => {
      useCharacterStore.getState().addCharacter(createTestCharacter('c1', { hygiene: 70 }))
      useCharacterStore.getState().updateHygiene('c1', -20)
      expect(useCharacterStore.getState().characters.get('c1')?.hygiene).toBe(50)
    })

    it('updateMood should delegate to updateStat', () => {
      useCharacterStore.getState().addCharacter(createTestCharacter('c1', { mood: 60 }))
      useCharacterStore.getState().updateMood('c1', 15)
      expect(useCharacterStore.getState().characters.get('c1')?.mood).toBe(75)
    })
  })

  describe('non-existent character edge cases', () => {
    it('updateDirection should not throw for non-existent character', () => {
      const before = useCharacterStore.getState().characters.size
      useCharacterStore.getState().updateDirection('nonexistent', 'up')
      expect(useCharacterStore.getState().characters.size).toBe(before)
    })

    it('updateStat should not throw for non-existent character', () => {
      const before = useCharacterStore.getState().characters.size
      useCharacterStore.getState().updateStat('nonexistent', 'satiety', 10)
      expect(useCharacterStore.getState().characters.size).toBe(before)
    })

    it('updateMoney should not throw for non-existent character', () => {
      const before = useCharacterStore.getState().characters.size
      useCharacterStore.getState().updateMoney('nonexistent', 50)
      expect(useCharacterStore.getState().characters.size).toBe(before)
    })
  })
})
