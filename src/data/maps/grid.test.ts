import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  generateGridNodes,
  tileToPixelObstacle,
  tileToPixelEntrance,
  isPointInsideObstacle,
  isNodeInsideZone,
  getGridDefaults,
  type GridConfig,
  type TileToPixelConfig,
  type EntranceConfig,
} from './grid'
import type { Obstacle } from '@/types'
import * as worldConfigLoader from '@/lib/worldConfigLoader'

describe('grid', () => {
  describe('getGridDefaults', () => {
    beforeEach(() => {
      vi.restoreAllMocks()
    })

    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('should return fallback defaults when config is not loaded', () => {
      vi.spyOn(worldConfigLoader, 'isConfigLoaded').mockReturnValue(false)

      const result = getGridDefaults()

      expect(result).toEqual({
        cols: 12,
        rows: 9,
        width: 800,
        height: 600,
      })
    })

    it('should return config defaults when loaded', () => {
      vi.spyOn(worldConfigLoader, 'isConfigLoaded').mockReturnValue(true)
      vi.spyOn(worldConfigLoader, 'getConfig').mockReturnValue({
        grid: {
          defaultCols: 16,
          defaultRows: 12,
          defaultWidth: 1024,
          defaultHeight: 768,
        },
      } as ReturnType<typeof worldConfigLoader.getConfig>)

      const result = getGridDefaults()

      expect(result).toEqual({
        cols: 16,
        rows: 12,
        width: 1024,
        height: 768,
      })
    })
  })

  describe('tileToPixelObstacle', () => {
    it('should convert tile coordinates to pixel coordinates', () => {
      const obsConfig = { row: 1, col: 2, tileWidth: 3, tileHeight: 2 }
      const gridConfig: TileToPixelConfig = {
        cols: 12,
        rows: 9,
        width: 800,
        height: 600,
      }

      const result = tileToPixelObstacle(obsConfig, gridConfig)

      // spacing.x = 800 / 13 ≈ 61.54
      // spacing.y = 600 / 10 = 60
      // x = 61.54 * (2 + 1) ≈ 185
      // y = 60 * (1 + 1) = 120
      expect(result.x).toBeGreaterThan(0)
      expect(result.y).toBeGreaterThan(0)
      expect(result.width).toBeGreaterThan(0)
      expect(result.height).toBeGreaterThan(0)
    })

    it('should handle zero row and col', () => {
      const obsConfig = { row: 0, col: 0, tileWidth: 2, tileHeight: 2 }
      const gridConfig: TileToPixelConfig = {
        cols: 10,
        rows: 10,
        width: 1100,
        height: 1100,
      }

      const result = tileToPixelObstacle(obsConfig, gridConfig)

      // spacing = 1100 / 11 = 100
      // x = 100 * (0 + 1) = 100
      expect(result.x).toBe(100)
      expect(result.y).toBe(100)
      expect(result.width).toBe(200)
      expect(result.height).toBe(200)
    })
  })

  describe('tileToPixelEntrance', () => {
    it('should convert entrance tile coordinates to pixel coordinates', () => {
      const entranceConfig = { row: 0, col: 5 }
      const gridConfig: TileToPixelConfig = {
        cols: 10,
        rows: 10,
        width: 1100,
        height: 1100,
      }

      const result = tileToPixelEntrance(entranceConfig, gridConfig)

      // spacing = 1100 / 11 = 100
      // x = 100 * (5 + 1) = 600
      // y = 100 * (0 + 1) = 100
      expect(result.x).toBe(600)
      expect(result.y).toBe(100)
    })

    it('should handle negative coordinates (off-grid entrances)', () => {
      const entranceConfig = { row: -1, col: 5 }
      const gridConfig: TileToPixelConfig = {
        cols: 10,
        rows: 10,
        width: 1100,
        height: 1100,
      }

      const result = tileToPixelEntrance(entranceConfig, gridConfig)

      // spacing = 1100 / 11 = 100
      // y = 100 * (-1 + 1) = 0
      expect(result.y).toBe(0)
    })
  })

  describe('isPointInsideObstacle', () => {
    it('should return true for point inside obstacle', () => {
      const obstacle: Obstacle = {
        id: 'test',
        x: 100,
        y: 100,
        width: 200,
        height: 200,
        type: 'building',
        tileRow: 1,
        tileCol: 1,
        tileWidth: 2,
        tileHeight: 2,
      }

      expect(isPointInsideObstacle(150, 150, obstacle)).toBe(true)
      expect(isPointInsideObstacle(100, 100, obstacle)).toBe(true) // At origin
    })

    it('should return false for point outside obstacle', () => {
      const obstacle: Obstacle = {
        id: 'test',
        x: 100,
        y: 100,
        width: 200,
        height: 200,
        type: 'building',
        tileRow: 1,
        tileCol: 1,
        tileWidth: 2,
        tileHeight: 2,
      }

      expect(isPointInsideObstacle(50, 50, obstacle)).toBe(false) // Before
      expect(isPointInsideObstacle(350, 350, obstacle)).toBe(false) // After
    })

    it('should return false for point on right/bottom edge (exclusive)', () => {
      const obstacle: Obstacle = {
        id: 'test',
        x: 100,
        y: 100,
        width: 200,
        height: 200,
        type: 'building',
        tileRow: 1,
        tileCol: 1,
        tileWidth: 2,
        tileHeight: 2,
      }

      expect(isPointInsideObstacle(300, 150, obstacle)).toBe(false) // Right edge
      expect(isPointInsideObstacle(150, 300, obstacle)).toBe(false) // Bottom edge
    })
  })

  describe('isNodeInsideZone', () => {
    it('should return true for node inside zone', () => {
      const zone: Obstacle = {
        id: 'zone',
        x: 100,
        y: 100,
        width: 300,
        height: 300,
        type: 'zone',
        tileRow: 1,
        tileCol: 1,
        tileWidth: 4,
        tileHeight: 4,
      }

      expect(isNodeInsideZone(3, 3, zone)).toBe(true) // Center
      expect(isNodeInsideZone(2, 2, zone)).toBe(true) // Inner corner
    })

    it('should return false for node on zone boundary', () => {
      const zone: Obstacle = {
        id: 'zone',
        x: 100,
        y: 100,
        width: 300,
        height: 300,
        type: 'zone',
        tileRow: 1,
        tileCol: 1,
        tileWidth: 4,
        tileHeight: 4,
      }

      expect(isNodeInsideZone(1, 1, zone)).toBe(false) // Top-left corner
      expect(isNodeInsideZone(5, 5, zone)).toBe(false) // Bottom-right corner
      expect(isNodeInsideZone(1, 3, zone)).toBe(false) // Top edge
    })

    it('should return false for node outside zone', () => {
      const zone: Obstacle = {
        id: 'zone',
        x: 100,
        y: 100,
        width: 300,
        height: 300,
        type: 'zone',
        tileRow: 1,
        tileCol: 1,
        tileWidth: 4,
        tileHeight: 4,
      }

      expect(isNodeInsideZone(0, 0, zone)).toBe(false)
      expect(isNodeInsideZone(10, 10, zone)).toBe(false)
    })
  })

  describe('generateGridNodes', () => {
    beforeEach(() => {
      vi.spyOn(worldConfigLoader, 'isConfigLoaded').mockReturnValue(false)
    })

    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('should generate nodes for a basic grid', () => {
      const config: GridConfig = {
        prefix: 'test',
        cols: 3,
        rows: 3,
        width: 400,
        height: 400,
      }

      const result = generateGridNodes(config)

      expect(result).toHaveLength(9) // 3x3 grid
      expect(result[0].id).toBe('test-0-0')
      expect(result[8].id).toBe('test-2-2')
    })

    it('should generate correct connections for corner nodes', () => {
      const config: GridConfig = {
        prefix: 'test',
        cols: 3,
        rows: 3,
        width: 400,
        height: 400,
      }

      const result = generateGridNodes(config)

      // Top-left corner should have 3 connections (right, down, diagonal)
      const topLeft = result.find((n) => n.id === 'test-0-0')
      expect(topLeft?.connectedTo).toHaveLength(3)
      expect(topLeft?.connectedTo).toContain('test-0-1') // right
      expect(topLeft?.connectedTo).toContain('test-1-0') // down
      expect(topLeft?.connectedTo).toContain('test-1-1') // diagonal
    })

    it('should generate correct connections for center nodes', () => {
      const config: GridConfig = {
        prefix: 'test',
        cols: 3,
        rows: 3,
        width: 400,
        height: 400,
      }

      const result = generateGridNodes(config)

      // Center node should have 8 connections
      const center = result.find((n) => n.id === 'test-1-1')
      expect(center?.connectedTo).toHaveLength(8)
    })

    it('should apply labels to nodes', () => {
      const config: GridConfig = {
        prefix: 'test',
        cols: 3,
        rows: 3,
        width: 400,
        height: 400,
      }
      const labels = [
        { nodeId: 'test-1-1', label: 'Center' },
        { nodeId: 'test-0-0', label: 'Start', type: 'spawn' as const },
      ]

      const result = generateGridNodes(config, labels)

      const center = result.find((n) => n.id === 'test-1-1')
      expect(center?.label).toBe('Center')

      const start = result.find((n) => n.id === 'test-0-0')
      expect(start?.label).toBe('Start')
      expect(start?.type).toBe('spawn')
    })

    it('should add entrance nodes', () => {
      const config: GridConfig = {
        prefix: 'test',
        cols: 3,
        rows: 3,
        width: 400,
        height: 400,
      }
      const entrances: EntranceConfig[] = [
        {
          id: 'entrance-north',
          row: -1,
          col: 1,
          connectedNodeIds: ['test-0-1'],
          leadsTo: { mapId: 'other-map', nodeId: 'entrance-south' },
          label: 'North Exit',
        },
      ]

      const result = generateGridNodes(config, [], entrances)

      const entranceNode = result.find((n) => n.id === 'entrance-north')
      expect(entranceNode).toBeDefined()
      expect(entranceNode?.type).toBe('entrance')
      expect(entranceNode?.leadsTo).toEqual({ mapId: 'other-map', nodeId: 'entrance-south' })

      // Grid node should be connected to entrance
      const connectedNode = result.find((n) => n.id === 'test-0-1')
      expect(connectedNode?.connectedTo).toContain('entrance-north')
    })

    it('should skip nodes inside building obstacles', () => {
      const config: GridConfig = {
        prefix: 'test',
        cols: 5,
        rows: 5,
        width: 600,
        height: 600,
      }
      // Building at row 1-2, col 1-2
      const obstacles: Obstacle[] = [
        {
          id: 'building',
          x: 200,
          y: 200,
          width: 200,
          height: 200,
          type: 'building',
          tileRow: 1,
          tileCol: 1,
          tileWidth: 2,
          tileHeight: 2,
        },
      ]

      const result = generateGridNodes(config, [], [], obstacles)

      // Nodes inside building should not exist
      const nodeInBuilding = result.find((n) => n.id === 'test-1-1')
      expect(nodeInBuilding).toBeUndefined()
    })

    it('should keep nodes inside zone obstacles', () => {
      const config: GridConfig = {
        prefix: 'test',
        cols: 5,
        rows: 5,
        width: 600,
        height: 600,
      }
      // Zone at row 0-3, col 0-3 (but no walls means nodes are preserved)
      const obstacles: Obstacle[] = [
        {
          id: 'zone',
          x: 100,
          y: 100,
          width: 300,
          height: 300,
          type: 'zone',
          tileRow: 0,
          tileCol: 0,
          tileWidth: 4,
          tileHeight: 4,
          wallSides: [],
        },
      ]

      const result = generateGridNodes(config, [], [], obstacles)

      // Nodes inside zone (without walls) should exist
      const nodeInZone = result.find((n) => n.id === 'test-2-2')
      expect(nodeInZone).toBeDefined()
    })

    it('should filter connections to non-existent nodes', () => {
      const config: GridConfig = {
        prefix: 'test',
        cols: 3,
        rows: 3,
        width: 300,
        height: 300,
      }
      // Building removing center node
      const obstacles: Obstacle[] = [
        {
          id: 'building',
          x: 100,
          y: 100,
          width: 100,
          height: 100,
          type: 'building',
          tileRow: 1,
          tileCol: 1,
          tileWidth: 1,
          tileHeight: 1,
        },
      ]

      const result = generateGridNodes(config, [], [], obstacles)

      // Adjacent nodes should not connect to the removed center node
      const topLeftNode = result.find((n) => n.id === 'test-0-0')
      expect(topLeftNode?.connectedTo).not.toContain('test-1-1')
    })
  })
})
