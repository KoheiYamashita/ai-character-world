import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { createNPCFromConfig, loadNPCsFromMapConfig } from './npcLoader'
import type { NPCConfigJson, WorldMap } from '@/types'

describe('npcLoader', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('createNPCFromConfig', () => {
    const baseConfig: NPCConfigJson = {
      id: 'npc-1',
      name: 'Test NPC',
      sprite: {
        sheetUrl: 'npc.png',
        frameWidth: 96,
        frameHeight: 96,
        cols: 3,
        rows: 4,
        rowMapping: { down: 0, left: 1, right: 2, up: 3 },
      },
      spawnNodeId: 'node-0-0',
      personality: '明るく社交的',
      tendencies: ['話好き', '親切'],
      facts: ['花屋で働いている', '猫が好き'],
    }

    it('should create NPC from config', () => {
      const npc = createNPCFromConfig(baseConfig, 'test-map', { x: 100, y: 200 })

      expect(npc.id).toBe('npc-1')
      expect(npc.name).toBe('Test NPC')
      expect(npc.mapId).toBe('test-map')
      expect(npc.currentNodeId).toBe('node-0-0')
      expect(npc.position).toEqual({ x: 100, y: 200 })
      expect(npc.direction).toBe('down')
    })

    it('should preserve sprite config', () => {
      const config: NPCConfigJson = {
        ...baseConfig,
        sprite: {
          sheetUrl: 'custom-npc.png',
          frameWidth: 48,
          frameHeight: 48,
          cols: 3,
          rows: 4,
          rowMapping: { down: 0, left: 1, right: 2, up: 3 },
        },
      }

      const npc = createNPCFromConfig(config, 'map', { x: 0, y: 0 })

      expect(npc.sprite?.sheetUrl).toBe('custom-npc.png')
      expect(npc.sprite?.frameWidth).toBe(48)
    })

    it('should include personality from config', () => {
      const npc = createNPCFromConfig(baseConfig, 'test-map', { x: 0, y: 0 })
      expect(npc.personality).toBe('明るく社交的')
    })

    it('should include tendencies from config', () => {
      const npc = createNPCFromConfig(baseConfig, 'test-map', { x: 0, y: 0 })
      expect(npc.tendencies).toEqual(['話好き', '親切'])
    })

    it('should include customPrompt if provided', () => {
      const config: NPCConfigJson = {
        ...baseConfig,
        customPrompt: '特別な対応をする',
      }
      const npc = createNPCFromConfig(config, 'test-map', { x: 0, y: 0 })
      expect(npc.customPrompt).toBe('特別な対応をする')
    })

    it('should leave customPrompt undefined if not provided', () => {
      const npc = createNPCFromConfig(baseConfig, 'test-map', { x: 0, y: 0 })
      expect(npc.customPrompt).toBeUndefined()
    })

    it('should include facts from config', () => {
      const npc = createNPCFromConfig(baseConfig, 'test-map', { x: 0, y: 0 })
      expect(npc.facts).toEqual(['花屋で働いている', '猫が好き'])
    })

    it('should initialize dynamic status fields to defaults', () => {
      const npc = createNPCFromConfig(baseConfig, 'test-map', { x: 0, y: 0 })
      expect(npc.affinity).toBe(0)
      expect(npc.mood).toBe('neutral')
      expect(npc.conversationCount).toBe(0)
      expect(npc.lastConversation).toBeNull()
    })
  })

  describe('loadNPCsFromMapConfig', () => {
    const defaultNPCFields = {
      personality: 'テスト性格',
      tendencies: ['傾向1'],
      facts: ['事実1'],
    }

    it('should load NPCs from map config', () => {
      const map: WorldMap = {
        id: 'test-map',
        name: 'Test Map',
        width: 800,
        height: 600,
        backgroundColor: 0x000000,
        spawnNodeId: 'node-0-0',
        nodes: [
          { id: 'node-0-0', x: 100, y: 100, type: 'waypoint', connectedTo: [] },
          { id: 'node-1-1', x: 200, y: 200, type: 'waypoint', connectedTo: [] },
        ],
        obstacles: [],
      }
      const configs: NPCConfigJson[] = [
        {
          id: 'npc-1',
          name: 'NPC 1',
          sprite: { sheetUrl: 'npc.png', frameWidth: 96, frameHeight: 96, cols: 3, rows: 4, rowMapping: { down: 0, left: 1, right: 2, up: 3 } },
          spawnNodeId: 'node-0-0',
          ...defaultNPCFields,
        },
        {
          id: 'npc-2',
          name: 'NPC 2',
          sprite: { sheetUrl: 'npc.png', frameWidth: 96, frameHeight: 96, cols: 3, rows: 4, rowMapping: { down: 0, left: 1, right: 2, up: 3 } },
          spawnNodeId: 'node-1-1',
          ...defaultNPCFields,
        },
      ]

      const npcs = loadNPCsFromMapConfig('test-map', configs, map)

      expect(npcs).toHaveLength(2)
      expect(npcs[0].id).toBe('npc-1')
      expect(npcs[0].position).toEqual({ x: 100, y: 100 })
      expect(npcs[1].id).toBe('npc-2')
      expect(npcs[1].position).toEqual({ x: 200, y: 200 })
    })

    it('should skip NPCs with missing spawn nodes', () => {
      const map: WorldMap = {
        id: 'test-map',
        name: 'Test Map',
        width: 800,
        height: 600,
        backgroundColor: 0x000000,
        spawnNodeId: 'node-0-0',
        nodes: [
          { id: 'node-0-0', x: 100, y: 100, type: 'waypoint', connectedTo: [] },
        ],
        obstacles: [],
      }
      const configs: NPCConfigJson[] = [
        {
          id: 'npc-1',
          name: 'NPC 1',
          sprite: { sheetUrl: 'npc.png', frameWidth: 96, frameHeight: 96, cols: 3, rows: 4, rowMapping: { down: 0, left: 1, right: 2, up: 3 } },
          spawnNodeId: 'node-0-0',
          ...defaultNPCFields,
        },
        {
          id: 'npc-2',
          name: 'NPC 2',
          sprite: { sheetUrl: 'npc.png', frameWidth: 96, frameHeight: 96, cols: 3, rows: 4, rowMapping: { down: 0, left: 1, right: 2, up: 3 } },
          spawnNodeId: 'non-existent-node',
          ...defaultNPCFields,
        },
      ]

      const npcs = loadNPCsFromMapConfig('test-map', configs, map)

      expect(npcs).toHaveLength(1)
      expect(npcs[0].id).toBe('npc-1')
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('non-existent-node')
      )
    })

    it('should return empty array for null map', () => {
      const configs: NPCConfigJson[] = [
        {
          id: 'npc-1',
          name: 'NPC 1',
          sprite: { sheetUrl: 'npc.png', frameWidth: 96, frameHeight: 96, cols: 3, rows: 4, rowMapping: { down: 0, left: 1, right: 2, up: 3 } },
          spawnNodeId: 'node-0-0',
          ...defaultNPCFields,
        },
      ]

      const npcs = loadNPCsFromMapConfig('test-map', configs, null as unknown as WorldMap)

      expect(npcs).toHaveLength(0)
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('not found')
      )
    })

    it('should return empty array for empty config', () => {
      const map: WorldMap = {
        id: 'test-map',
        name: 'Test Map',
        width: 800,
        height: 600,
        backgroundColor: 0x000000,
        spawnNodeId: 'node-0-0',
        nodes: [],
        obstacles: [],
      }

      const npcs = loadNPCsFromMapConfig('test-map', [], map)

      expect(npcs).toHaveLength(0)
    })
  })

})
