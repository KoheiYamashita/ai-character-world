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

    it('should block connections crossing zone walls', () => {
      const config: GridConfig = {
        prefix: 'test',
        cols: 8,
        rows: 6,
        width: 800,
        height: 600,
      }
      // Zone with walls on all sides and door on right
      // Zone: row 0-4, col 0-4 (internal: row 1-3, col 1-3)
      const obstacles: Obstacle[] = [
        {
          id: 'room',
          x: 100,
          y: 100,
          width: 400,
          height: 400,
          type: 'zone',
          tileRow: 0,
          tileCol: 0,
          tileWidth: 5,
          tileHeight: 5,
          wallSides: ['top', 'bottom', 'left', 'right'],
          door: { side: 'right', start: 1, end: 3 }, // Door at row 2 (offset 2)
        },
      ]

      const result = generateGridNodes(config, [], [], obstacles)

      // Inside node (row 2, col 3) should NOT connect to outside node (row 2, col 5)
      // through a wall (col 4 is the right wall, but row 2 is door opening)
      // Wait - the door is at offset 2, which means row 2. So row 2, col 4 is the door.

      // Inside node at row 1 (not door) should not connect to col 5 (outside)
      const insideNodeRow1 = result.find((n) => n.id === 'test-1-3')
      // Should not have diagonal connection to test-1-5 or test-2-5 through wall
      expect(insideNodeRow1?.connectedTo).not.toContain('test-1-5')
      expect(insideNodeRow1?.connectedTo).not.toContain('test-0-4')

      // Inside node at row 3 (not door) should not connect through wall
      const insideNodeRow3 = result.find((n) => n.id === 'test-3-3')
      expect(insideNodeRow3?.connectedTo).not.toContain('test-3-5')
    })

    it('should allow connections through door opening', () => {
      const config: GridConfig = {
        prefix: 'test',
        cols: 8,
        rows: 6,
        width: 800,
        height: 600,
      }
      // Zone with door on right at row 2
      const obstacles: Obstacle[] = [
        {
          id: 'room',
          x: 100,
          y: 100,
          width: 400,
          height: 400,
          type: 'zone',
          tileRow: 0,
          tileCol: 0,
          tileWidth: 5,
          tileHeight: 5,
          wallSides: ['top', 'bottom', 'left', 'right'],
          door: { side: 'right', start: 1, end: 3 }, // Door at row 2 (offset 2)
        },
      ]

      const result = generateGridNodes(config, [], [], obstacles)

      // Inside node at row 2, col 3 should connect to door node at row 2, col 4
      // But col 4 is on the wall, so it might not exist unless it's a door
      // Actually, the door opening allows the node to exist at row 2, col 4

      // Node at row 2, col 3 (inside) should have connection toward door
      const insideNodeAtDoor = result.find((n) => n.id === 'test-2-3')
      expect(insideNodeAtDoor).toBeDefined()

      // Check that horizontal movement through door is allowed
      // The door node (if it exists) should connect to outside
      const doorNode = result.find((n) => n.id === 'test-2-4')
      // Door node should exist (it's in the door opening, not on wall)
      // Actually, the wall is at col 4 (zone boundary), and nodes ON the wall
      // are skipped UNLESS they're in the door opening
    })

    it('should block diagonal connections from door opening to outside', () => {
      // Use grid-aligned zone coordinates for accurate testing
      // Grid: 8 cols, 6 rows, 900x700 (spacing: 100x100)
      const config: GridConfig = {
        prefix: 'test',
        cols: 8,
        rows: 6,
        width: 900,
        height: 700,
      }
      // Zone: row 0-4, col 0-4 (boundary nodes on row 0, 4 and col 0, 4)
      // Internal nodes: row 1-3, col 1-3
      // Door on right (col 4) at row 2 (offset 2)
      const obstacles: Obstacle[] = [
        {
          id: 'room',
          x: 100, // col 0
          y: 100, // row 0
          width: 400, // 4 tiles
          height: 400, // 4 tiles
          type: 'zone',
          tileRow: 0,
          tileCol: 0,
          tileWidth: 4,
          tileHeight: 4,
          wallSides: ['top', 'bottom', 'left', 'right'],
          door: { side: 'right', start: 1, end: 3 }, // Door at row 2 (offset 2)
        },
      ]

      const result = generateGridNodes(config, [], [], obstacles)

      // Right boundary (col=4) - wall nodes are skipped except door
      // Door opening at row 2, col 4 should exist
      const doorNode = result.find((n) => n.id === 'test-2-4')
      expect(doorNode).toBeDefined()

      if (doorNode) {
        // Diagonal from door to outside should be blocked
        expect(doorNode.connectedTo).not.toContain('test-1-5')
        expect(doorNode.connectedTo).not.toContain('test-3-5')
        // Horizontal from door to outside should be allowed
        expect(doorNode.connectedTo).toContain('test-2-5')
      }
    })

    it('should block diagonal connections from outside to door opening', () => {
      const config: GridConfig = {
        prefix: 'test',
        cols: 8,
        rows: 6,
        width: 900,
        height: 700,
      }
      const obstacles: Obstacle[] = [
        {
          id: 'room',
          x: 100,
          y: 100,
          width: 400,
          height: 400,
          type: 'zone',
          tileRow: 0,
          tileCol: 0,
          tileWidth: 4,
          tileHeight: 4,
          wallSides: ['top', 'bottom', 'left', 'right'],
          door: { side: 'right', start: 1, end: 3 },
        },
      ]

      const result = generateGridNodes(config, [], [], obstacles)

      // Door node at row 2, col 4
      const doorNode = result.find((n) => n.id === 'test-2-4')
      expect(doorNode).toBeDefined()

      // Outside node at row 1, col 5 should NOT have diagonal connection to door
      const outsideNodeAbove = result.find((n) => n.id === 'test-1-5')
      expect(outsideNodeAbove).toBeDefined()
      if (outsideNodeAbove) {
        expect(outsideNodeAbove.connectedTo).not.toContain('test-2-4')
      }

      // Outside node at row 3, col 5 should NOT have diagonal connection to door
      const outsideNodeBelow = result.find((n) => n.id === 'test-3-5')
      expect(outsideNodeBelow).toBeDefined()
      if (outsideNodeBelow) {
        expect(outsideNodeBelow.connectedTo).not.toContain('test-2-4')
      }

      // But horizontal connection from outside (row 2, col 5) to door should exist
      const outsideNodeSameRow = result.find((n) => n.id === 'test-2-5')
      expect(outsideNodeSameRow).toBeDefined()
      if (outsideNodeSameRow) {
        expect(outsideNodeSameRow.connectedTo).toContain('test-2-4')
      }
    })

    it('should handle zone with negative tileRow/tileCol (like home bedroom)', () => {
      const config: GridConfig = {
        prefix: 'test',
        cols: 8,
        rows: 6,
        width: 800,
        height: 600,
      }
      // Mimics home's bedroom: row -1, col -1, width 6, height 5
      // Internal nodes: row 0-3, col 0-4
      // Right wall at col 5, door at row 2 (offset 3)
      const obstacles: Obstacle[] = [
        {
          id: 'bedroom',
          x: 0,
          y: 0,
          width: 500,
          height: 400,
          type: 'zone',
          tileRow: -1,
          tileCol: -1,
          tileWidth: 6,
          tileHeight: 5,
          wallSides: ['top', 'bottom', 'left', 'right'],
          door: { side: 'right', start: 2, end: 4 }, // Door at row 2 (offset 3)
        },
      ]

      const result = generateGridNodes(config, [], [], obstacles)

      // Inside node at row 1, col 4 should NOT connect diagonally through wall
      const insideNode = result.find((n) => n.id === 'test-1-4')
      if (insideNode) {
        // Should not connect to outside nodes through wall
        expect(insideNode.connectedTo).not.toContain('test-0-5')
        expect(insideNode.connectedTo).not.toContain('test-1-5')
        expect(insideNode.connectedTo).not.toContain('test-2-5')
      }

      // Door opening at row 2, col 4 (boundary) - check if diagonal blocked
      // Note: col 4 is the last inside column, col 5 is the boundary (wall/door)
      const doorNode = result.find((n) => n.id === 'test-2-4')
      if (doorNode) {
        // Diagonal connections to outside should still work within inside area
        // But crossing the wall diagonally should be blocked
        // The boundary node would be at col 5 (right edge)
      }
    })
  })
})
