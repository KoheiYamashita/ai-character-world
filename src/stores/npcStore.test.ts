import { describe, it, expect, beforeEach } from 'vitest'
import { useNPCStore } from './npcStore'
import type { NPC } from '@/types'

function createTestNPC(id: string, overrides: Partial<NPC> = {}): NPC {
  return {
    id,
    name: `NPC ${id}`,
    sprite: {
      sheetUrl: 'npc.png',
      frameWidth: 96,
      frameHeight: 96,
      cols: 3,
      rows: 4,
      rowMapping: { down: 0, left: 1, right: 2, up: 3 },
    },
    mapId: 'town',
    currentNodeId: 'node-0-0',
    position: { x: 100, y: 100 },
    direction: 'down',
    ...overrides,
  }
}

describe('npcStore', () => {
  beforeEach(() => {
    useNPCStore.setState({ npcs: new Map() })
  })

  describe('addNPC', () => {
    it('should add an NPC to the store', () => {
      const npc = createTestNPC('npc1')
      useNPCStore.getState().addNPC(npc)
      expect(useNPCStore.getState().npcs.get('npc1')).toEqual(npc)
    })

    it('should preserve existing NPCs', () => {
      useNPCStore.getState().addNPC(createTestNPC('npc1'))
      useNPCStore.getState().addNPC(createTestNPC('npc2'))
      expect(useNPCStore.getState().npcs.size).toBe(2)
    })
  })

  describe('removeNPC', () => {
    it('should remove an NPC from the store', () => {
      useNPCStore.getState().addNPC(createTestNPC('npc1'))
      useNPCStore.getState().removeNPC('npc1')
      expect(useNPCStore.getState().npcs.has('npc1')).toBe(false)
    })

    it('should not affect other NPCs', () => {
      useNPCStore.getState().addNPC(createTestNPC('npc1'))
      useNPCStore.getState().addNPC(createTestNPC('npc2'))
      useNPCStore.getState().removeNPC('npc1')
      expect(useNPCStore.getState().npcs.has('npc2')).toBe(true)
    })
  })

  describe('updateNPC', () => {
    it('should partially update an NPC', () => {
      useNPCStore.getState().addNPC(createTestNPC('npc1'))
      useNPCStore.getState().updateNPC('npc1', { name: 'Updated NPC' })
      expect(useNPCStore.getState().npcs.get('npc1')?.name).toBe('Updated NPC')
    })

    it('should not change state for non-existent id', () => {
      const before = useNPCStore.getState().npcs
      useNPCStore.getState().updateNPC('nonexistent', { name: 'X' })
      expect(useNPCStore.getState().npcs).toBe(before)
    })
  })

  describe('getNPC', () => {
    it('should return NPC by id', () => {
      const npc = createTestNPC('npc1')
      useNPCStore.getState().addNPC(npc)
      expect(useNPCStore.getState().getNPC('npc1')).toEqual(npc)
    })

    it('should return undefined for non-existent id', () => {
      expect(useNPCStore.getState().getNPC('nonexistent')).toBeUndefined()
    })
  })

  describe('getNPCsByMap', () => {
    it('should return NPCs for the given map', () => {
      useNPCStore.getState().addNPC(createTestNPC('npc1', { mapId: 'town' }))
      useNPCStore.getState().addNPC(createTestNPC('npc2', { mapId: 'cafe' }))
      useNPCStore.getState().addNPC(createTestNPC('npc3', { mapId: 'town' }))

      const townNPCs = useNPCStore.getState().getNPCsByMap('town')
      expect(townNPCs).toHaveLength(2)
      expect(townNPCs.map((n) => n.id)).toContain('npc1')
      expect(townNPCs.map((n) => n.id)).toContain('npc3')
    })

    it('should return empty array when no NPCs in map', () => {
      useNPCStore.getState().addNPC(createTestNPC('npc1', { mapId: 'town' }))
      expect(useNPCStore.getState().getNPCsByMap('cafe')).toEqual([])
    })
  })

  describe('clearNPCs', () => {
    it('should remove all NPCs', () => {
      useNPCStore.getState().addNPC(createTestNPC('npc1'))
      useNPCStore.getState().addNPC(createTestNPC('npc2'))
      useNPCStore.getState().clearNPCs()
      expect(useNPCStore.getState().npcs.size).toBe(0)
    })
  })
})
