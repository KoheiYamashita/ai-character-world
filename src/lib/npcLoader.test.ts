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
    it('should create NPC from config', () => {
      const config: NPCConfigJson = {
        id: 'npc-1',
        name: 'Test NPC',
        sprite: {
          sheet: 'npc.png',
          frameWidth: 32,
          frameHeight: 32,
        },
        spawnNodeId: 'node-0-0',
      }

      const npc = createNPCFromConfig(config, 'test-map', { x: 100, y: 200 })

      expect(npc.id).toBe('npc-1')
      expect(npc.name).toBe('Test NPC')
      expect(npc.mapId).toBe('test-map')
      expect(npc.currentNodeId).toBe('node-0-0')
      expect(npc.position).toEqual({ x: 100, y: 200 })
      expect(npc.direction).toBe('down')
    })

    it('should preserve sprite config', () => {
      const config: NPCConfigJson = {
        id: 'npc-1',
        name: 'Test NPC',
        sprite: {
          sheet: 'custom-npc.png',
          frameWidth: 48,
          frameHeight: 48,
        },
        spawnNodeId: 'node-0-0',
      }

      const npc = createNPCFromConfig(config, 'map', { x: 0, y: 0 })

      expect(npc.sprite?.sheet).toBe('custom-npc.png')
      expect(npc.sprite?.frameWidth).toBe(48)
    })
  })

  describe('loadNPCsFromMapConfig', () => {
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
          sprite: { sheet: 'npc.png', frameWidth: 32, frameHeight: 32 },
          spawnNodeId: 'node-0-0',
        },
        {
          id: 'npc-2',
          name: 'NPC 2',
          sprite: { sheet: 'npc.png', frameWidth: 32, frameHeight: 32 },
          spawnNodeId: 'node-1-1',
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
          sprite: { sheet: 'npc.png', frameWidth: 32, frameHeight: 32 },
          spawnNodeId: 'node-0-0',
        },
        {
          id: 'npc-2',
          name: 'NPC 2',
          sprite: { sheet: 'npc.png', frameWidth: 32, frameHeight: 32 },
          spawnNodeId: 'non-existent-node',
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
          sprite: { sheet: 'npc.png', frameWidth: 32, frameHeight: 32 },
          spawnNodeId: 'node-0-0',
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

  // =====================
  // docs/memory-and-conversation-system.md:166-175 NPCProfile仕様
  // Step 16で実装予定 (implementation-plan.md)
  // =====================

  describe('NPC extended fields (Step 16 - not yet implemented)', () => {
    it.todo('should include personality if provided (docs/memory-and-conversation-system.md:170)')

    it.todo('should include tendencies if provided (docs/memory-and-conversation-system.md:171)')

    it.todo('should include customPrompt if provided (docs/memory-and-conversation-system.md:172)')

    it.todo('should include facts if provided (docs/memory-and-conversation-system.md:173)')

    // docs/memory-and-conversation-system.md:50-55 NPC status fields
    it.todo('should initialize affinity to 0 (docs/memory-and-conversation-system.md:52)')

    it.todo('should initialize mood to neutral (docs/memory-and-conversation-system.md:53)')

    it.todo('should initialize conversationCount to 0 (docs/memory-and-conversation-system.md:54)')

    it.todo('should initialize lastConversation to null (docs/memory-and-conversation-system.md:55)')
  })
})
