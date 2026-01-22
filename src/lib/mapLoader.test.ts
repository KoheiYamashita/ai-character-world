import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  buildMapFromConfig,
  clearMapCache,
  getCachedMaps,
  isMapsLoaded,
  getNPCConfigsForMap,
  getAllNPCConfigs,
  clearMapConfigCache,
  loadMapConfigs,
  loadMaps,
  loadMapConfigsWithCache,
} from './mapLoader'
import type { MapConfigJson } from '@/types'
import * as worldConfigLoader from './worldConfigLoader'

// Mock worldConfigLoader
vi.mock('./worldConfigLoader', () => ({
  isConfigLoaded: vi.fn().mockReturnValue(false),
  getConfig: vi.fn().mockReturnValue({
    paths: { mapsJson: '/data/maps.json' },
  }),
  parseColor: vi.fn((color: string) => parseInt(color.replace('#', ''), 16)),
}))

// Mock fetch
const mockFetch = vi.fn()
global.fetch = mockFetch

describe('mapLoader', () => {
  beforeEach(() => {
    clearMapCache()
    clearMapConfigCache()
    vi.spyOn(worldConfigLoader, 'isConfigLoaded').mockReturnValue(false)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('buildMapFromConfig', () => {
    it('should build map from config', () => {
      const config: MapConfigJson = {
        id: 'test-map',
        name: 'Test Map',
        width: 800,
        height: 600,
        backgroundColor: '#336633',
        spawnNodeId: 'test-0-0',
        grid: {
          prefix: 'test',
          cols: 3,
          rows: 3,
        },
        labels: [],
        entrances: [],
        obstacles: [],
      }

      const map = buildMapFromConfig(config)

      expect(map.id).toBe('test-map')
      expect(map.name).toBe('Test Map')
      expect(map.width).toBe(800)
      expect(map.height).toBe(600)
      expect(map.nodes.length).toBeGreaterThan(0)
    })

    it('should convert obstacles from tile to pixel coordinates', () => {
      const config: MapConfigJson = {
        id: 'test-map',
        name: 'Test Map',
        width: 800,
        height: 600,
        backgroundColor: '#336633',
        spawnNodeId: 'test-0-0',
        grid: {
          prefix: 'test',
          cols: 12,
          rows: 9,
        },
        labels: [],
        entrances: [],
        obstacles: [
          {
            id: 'building-1',
            row: 2,
            col: 3,
            tileWidth: 2,
            tileHeight: 2,
            label: 'Test Building',
          },
        ],
      }

      const map = buildMapFromConfig(config)

      expect(map.obstacles).toHaveLength(1)
      expect(map.obstacles[0].id).toBe('building-1')
      expect(map.obstacles[0].x).toBeGreaterThan(0)
      expect(map.obstacles[0].y).toBeGreaterThan(0)
      expect(map.obstacles[0].width).toBeGreaterThan(0)
      expect(map.obstacles[0].height).toBeGreaterThan(0)
    })

    it('should set default type to building', () => {
      const config: MapConfigJson = {
        id: 'test-map',
        name: 'Test Map',
        width: 800,
        height: 600,
        backgroundColor: '#336633',
        spawnNodeId: 'test-0-0',
        grid: { prefix: 'test' },
        labels: [],
        entrances: [],
        obstacles: [
          {
            row: 2,
            col: 3,
            tileWidth: 2,
            tileHeight: 2,
          },
        ],
      }

      const map = buildMapFromConfig(config)

      expect(map.obstacles[0].type).toBe('building')
    })

    it('should preserve zone properties', () => {
      const config: MapConfigJson = {
        id: 'test-map',
        name: 'Test Map',
        width: 800,
        height: 600,
        backgroundColor: '#336633',
        spawnNodeId: 'test-0-0',
        grid: { prefix: 'test' },
        labels: [],
        entrances: [],
        obstacles: [
          {
            row: 0,
            col: 0,
            tileWidth: 4,
            tileHeight: 4,
            type: 'zone',
            wallSides: ['top', 'left'],
            door: { side: 'right', start: 1, end: 3 },
            facility: { tags: ['bedroom'], owner: 'player' },
          },
        ],
      }

      const map = buildMapFromConfig(config)

      expect(map.obstacles[0].type).toBe('zone')
      expect(map.obstacles[0].wallSides).toEqual(['top', 'left'])
      expect(map.obstacles[0].door).toEqual({ side: 'right', start: 1, end: 3 })
      expect(map.obstacles[0].facility?.tags).toContain('bedroom')
    })

    it('should throw for missing required obstacle fields', () => {
      const config: MapConfigJson = {
        id: 'test-map',
        name: 'Test Map',
        width: 800,
        height: 600,
        backgroundColor: '#336633',
        spawnNodeId: 'test-0-0',
        grid: { prefix: 'test' },
        labels: [],
        entrances: [],
        obstacles: [
          {
            row: NaN, // Invalid
            col: 3,
            tileWidth: 2,
            tileHeight: 2,
          },
        ],
      }

      expect(() => buildMapFromConfig(config)).toThrow('invalid fields')
    })

    it('should throw for undersized building', () => {
      const config: MapConfigJson = {
        id: 'test-map',
        name: 'Test Map',
        width: 800,
        height: 600,
        backgroundColor: '#336633',
        spawnNodeId: 'test-0-0',
        grid: { prefix: 'test' },
        labels: [],
        entrances: [],
        obstacles: [
          {
            row: 2,
            col: 3,
            tileWidth: 1, // Too small (minimum 2x2)
            tileHeight: 2,
            type: 'building',
          },
        ],
      }

      expect(() => buildMapFromConfig(config)).toThrow('undersized')
    })

    it('should throw for undersized zone', () => {
      const config: MapConfigJson = {
        id: 'test-map',
        name: 'Test Map',
        width: 800,
        height: 600,
        backgroundColor: '#336633',
        spawnNodeId: 'test-0-0',
        grid: { prefix: 'test' },
        labels: [],
        entrances: [],
        obstacles: [
          {
            row: 0,
            col: 0,
            tileWidth: 3, // Too small (minimum 4x4 for zones)
            tileHeight: 4,
            type: 'zone',
          },
        ],
      }

      expect(() => buildMapFromConfig(config)).toThrow('undersized')
    })

    it('should throw for label inside building', () => {
      const config: MapConfigJson = {
        id: 'test-map',
        name: 'Test Map',
        width: 800,
        height: 600,
        backgroundColor: '#336633',
        spawnNodeId: 'test-0-0',
        grid: {
          prefix: 'test',
          cols: 12,
          rows: 9,
        },
        labels: [
          { nodeId: 'test-3-4', label: 'Inside Building' },
        ],
        entrances: [],
        obstacles: [
          {
            row: 2,
            col: 3,
            tileWidth: 3,
            tileHeight: 3,
            type: 'building',
          },
        ],
      }

      expect(() => buildMapFromConfig(config)).toThrow('conflicts')
    })

    it('should generate entrance nodes', () => {
      const config: MapConfigJson = {
        id: 'test-map',
        name: 'Test Map',
        width: 800,
        height: 600,
        backgroundColor: '#336633',
        spawnNodeId: 'test-0-0',
        grid: {
          prefix: 'test',
          cols: 3,
          rows: 3,
        },
        labels: [],
        entrances: [
          {
            id: 'entrance-north',
            row: -1,
            col: 1,
            connectedNodeIds: ['test-0-1'],
            leadsTo: { mapId: 'other-map', nodeId: 'entrance-south' },
            label: 'North Exit',
          },
        ],
        obstacles: [],
      }

      const map = buildMapFromConfig(config)

      const entrance = map.nodes.find((n) => n.id === 'entrance-north')
      expect(entrance).toBeDefined()
      expect(entrance?.type).toBe('entrance')
      expect(entrance?.leadsTo).toEqual({ mapId: 'other-map', nodeId: 'entrance-south' })
    })
  })

  describe('cache management', () => {
    it('should report no maps loaded initially', () => {
      expect(isMapsLoaded()).toBe(false)
    })

    it('should return empty object when not loaded', () => {
      expect(getCachedMaps()).toEqual({})
    })

    it('should clear cache', () => {
      // Note: we can't directly test cache behavior without loading maps,
      // but we can test that clearMapCache doesn't throw
      expect(() => clearMapCache()).not.toThrow()
    })
  })

  describe('NPC config access', () => {
    it('should return empty array when no configs loaded', () => {
      expect(getNPCConfigsForMap('any-map')).toEqual([])
    })

    it('should return empty array for getAllNPCConfigs when not loaded', () => {
      expect(getAllNPCConfigs()).toEqual([])
    })
  })

  describe('loadMapConfigs', () => {
    it('should load map configs from server', async () => {
      const mockMaps = {
        maps: [
          {
            id: 'test-map',
            name: 'Test Map',
            width: 800,
            height: 600,
            backgroundColor: '#336633',
            spawnNodeId: 'test-0-0',
            grid: { prefix: 'test' },
            labels: [],
            entrances: [],
            obstacles: [],
          },
        ],
      }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockMaps),
      })

      const configs = await loadMapConfigs()

      expect(mockFetch).toHaveBeenCalledWith('/data/maps.json')
      expect(configs).toHaveLength(1)
      expect(configs[0].id).toBe('test-map')
    })

    it('should throw on fetch error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      })

      await expect(loadMapConfigs()).rejects.toThrow('Failed to load map configs')
    })
  })

  describe('loadMaps', () => {
    it('should load and build maps', async () => {
      const mockMaps = {
        maps: [
          {
            id: 'test-map',
            name: 'Test Map',
            width: 800,
            height: 600,
            backgroundColor: '#336633',
            spawnNodeId: 'test-0-0',
            grid: { prefix: 'test', cols: 3, rows: 3 },
            labels: [],
            entrances: [],
            obstacles: [],
          },
        ],
      }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockMaps),
      })

      const maps = await loadMaps()

      expect(maps['test-map']).toBeDefined()
      expect(maps['test-map'].id).toBe('test-map')
      expect(isMapsLoaded()).toBe(true)
    })

    it('should cache maps after loading', async () => {
      const mockMaps = {
        maps: [
          {
            id: 'cached-map',
            name: 'Cached Map',
            width: 800,
            height: 600,
            backgroundColor: '#336633',
            spawnNodeId: 'test-0-0',
            grid: { prefix: 'test' },
            labels: [],
            entrances: [],
            obstacles: [],
          },
        ],
      }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockMaps),
      })

      const maps = await loadMaps()

      // After loading, getCachedMaps should return the same maps
      const cached = getCachedMaps()
      expect(cached['cached-map']).toBeDefined()
      expect(cached).toEqual(maps)
    })
  })

  describe('loadMapConfigsWithCache', () => {
    it('should load and cache configs', async () => {
      const mockMaps = {
        maps: [
          {
            id: 'test-map',
            name: 'Test Map',
            width: 800,
            height: 600,
            backgroundColor: '#336633',
            spawnNodeId: 'test-0-0',
            grid: { prefix: 'test' },
            labels: [],
            entrances: [],
            obstacles: [],
            npcs: [{ id: 'npc-1', name: 'NPC', sprite: { sheet: 'npc.png', frameWidth: 32, frameHeight: 32 }, spawnNodeId: 'test-0-0' }],
          },
        ],
      }

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockMaps),
      })

      await loadMapConfigsWithCache()
      const npcs = getNPCConfigsForMap('test-map')

      expect(npcs).toHaveLength(1)
      expect(npcs[0].id).toBe('npc-1')
    })

    it('should return all NPC configs', async () => {
      const mockMaps = {
        maps: [
          {
            id: 'map-a',
            name: 'Map A',
            width: 800,
            height: 600,
            backgroundColor: '#336633',
            spawnNodeId: 'a-0-0',
            grid: { prefix: 'a' },
            labels: [],
            entrances: [],
            obstacles: [],
            npcs: [{ id: 'npc-a', name: 'NPC A', sprite: { sheet: 'npc.png', frameWidth: 32, frameHeight: 32 }, spawnNodeId: 'a-0-0' }],
          },
          {
            id: 'map-b',
            name: 'Map B',
            width: 800,
            height: 600,
            backgroundColor: '#336633',
            spawnNodeId: 'b-0-0',
            grid: { prefix: 'b' },
            labels: [],
            entrances: [],
            obstacles: [],
            npcs: [{ id: 'npc-b', name: 'NPC B', sprite: { sheet: 'npc.png', frameWidth: 32, frameHeight: 32 }, spawnNodeId: 'b-0-0' }],
          },
        ],
      }

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockMaps),
      })

      await loadMapConfigsWithCache()
      const allNpcs = getAllNPCConfigs()

      expect(allNpcs).toHaveLength(2)
    })
  })
})
