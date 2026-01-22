import { describe, it, expect } from 'vitest'
import {
  getFacilityForNode,
  findZoneFacilityForNode,
  findBuildingFacilityNearNode,
  hasFacilityTag,
  findObstaclesWithFacilityTag,
  findObstaclesWithAnyFacilityTag,
  getAllFacilities,
  findObstacleById,
  isNodeAtFacility,
  getFacilityTargetNode,
} from './facilityUtils'
import type { PathNode, Obstacle, FacilityInfo } from '@/types'

// Helper to create a zone obstacle
function createZone(
  id: string,
  tileRow: number,
  tileCol: number,
  tileWidth: number,
  tileHeight: number,
  facility?: FacilityInfo
): Obstacle {
  return {
    id,
    x: (tileCol + 1) * 60, // Simplified pixel calculation
    y: (tileRow + 1) * 60,
    width: tileWidth * 60,
    height: tileHeight * 60,
    type: 'zone',
    tileRow,
    tileCol,
    tileWidth,
    tileHeight,
    facility,
  }
}

// Helper to create a building obstacle
function createBuilding(
  id: string,
  tileRow: number,
  tileCol: number,
  tileWidth: number,
  tileHeight: number,
  facility?: FacilityInfo
): Obstacle {
  return {
    id,
    x: (tileCol + 1) * 60,
    y: (tileRow + 1) * 60,
    width: tileWidth * 60,
    height: tileHeight * 60,
    type: 'building',
    tileRow,
    tileCol,
    tileWidth,
    tileHeight,
    facility,
  }
}

// Helper to create a path node
function createNode(id: string, x: number, y: number): PathNode {
  return {
    id,
    x,
    y,
    type: 'waypoint',
    connectedTo: [],
  }
}

describe('facilityUtils', () => {
  describe('getFacilityForNode', () => {
    it('should return facility for node inside zone', () => {
      const facility: FacilityInfo = { tags: ['bedroom'], owner: 'player' }
      const zones = [createZone('bedroom', 0, 0, 4, 4, facility)]
      const node = createNode('test-2-2', 180, 180) // Inside zone

      const result = getFacilityForNode(node, zones, 'test')

      expect(result).toEqual(facility)
    })

    it('should return null for node outside zone', () => {
      const facility: FacilityInfo = { tags: ['bedroom'], owner: 'player' }
      const zones = [createZone('bedroom', 0, 0, 4, 4, facility)]
      const node = createNode('test-10-10', 600, 600) // Outside zone

      const result = getFacilityForNode(node, zones, 'test')

      expect(result).toBeNull()
    })

    it('should return null for invalid node id format', () => {
      const facility: FacilityInfo = { tags: ['bedroom'], owner: 'player' }
      const zones = [createZone('bedroom', 0, 0, 4, 4, facility)]
      const node = createNode('invalid-node-id', 180, 180)

      const result = getFacilityForNode(node, zones, 'test')

      expect(result).toBeNull()
    })
  })

  describe('findZoneFacilityForNode', () => {
    it('should return facility when inside zone', () => {
      const facility: FacilityInfo = { tags: ['kitchen'], owner: 'player' }
      const zones = [createZone('kitchen', 0, 0, 4, 4, facility)]

      // Row 2, Col 2 is inside zone (0,0) to (4,4)
      const result = findZoneFacilityForNode(2, 2, zones)

      expect(result).toEqual(facility)
    })

    it('should return null when on zone boundary', () => {
      const facility: FacilityInfo = { tags: ['kitchen'], owner: 'player' }
      const zones = [createZone('kitchen', 0, 0, 4, 4, facility)]

      // Row 0, Col 0 is on the boundary
      const result = findZoneFacilityForNode(0, 0, zones)

      expect(result).toBeNull()
    })

    it('should return null when outside all zones', () => {
      const facility: FacilityInfo = { tags: ['kitchen'], owner: 'player' }
      const zones = [createZone('kitchen', 0, 0, 4, 4, facility)]

      const result = findZoneFacilityForNode(10, 10, zones)

      expect(result).toBeNull()
    })

    it('should handle zones without facility', () => {
      const zones = [createZone('empty-zone', 0, 0, 4, 4, undefined)]

      const result = findZoneFacilityForNode(2, 2, zones)

      expect(result).toBeNull()
    })
  })

  describe('findBuildingFacilityNearNode', () => {
    it('should return facility when adjacent to building', () => {
      const facility: FacilityInfo = { tags: ['restaurant'], cost: 500 }
      const buildings = [createBuilding('restaurant', 2, 2, 2, 2, facility)]

      // Adjacent to building (row 1 is above building at row 2)
      const result = findBuildingFacilityNearNode(1, 2, buildings, 1)

      expect(result).toEqual(facility)
    })

    it('should return null when too far from building', () => {
      const facility: FacilityInfo = { tags: ['restaurant'], cost: 500 }
      const buildings = [createBuilding('restaurant', 2, 2, 2, 2, facility)]

      // Too far from building
      const result = findBuildingFacilityNearNode(0, 0, buildings, 1)

      expect(result).toBeNull()
    })

    it('should respect custom proximity', () => {
      const facility: FacilityInfo = { tags: ['restaurant'], cost: 500 }
      const buildings = [createBuilding('restaurant', 5, 5, 2, 2, facility)]

      // Within proximity of 2
      const result = findBuildingFacilityNearNode(3, 5, buildings, 2)

      expect(result).toEqual(facility)
    })

    it('should return null for buildings without facility', () => {
      const buildings = [createBuilding('empty-building', 2, 2, 2, 2, undefined)]

      const result = findBuildingFacilityNearNode(2, 2, buildings, 1)

      expect(result).toBeNull()
    })
  })

  describe('hasFacilityTag', () => {
    it('should return true if facility has the tag', () => {
      const facility: FacilityInfo = { tags: ['kitchen', 'bedroom'] }

      expect(hasFacilityTag(facility, 'kitchen')).toBe(true)
      expect(hasFacilityTag(facility, 'bedroom')).toBe(true)
    })

    it('should return false if facility does not have the tag', () => {
      const facility: FacilityInfo = { tags: ['kitchen'] }

      expect(hasFacilityTag(facility, 'bedroom')).toBe(false)
    })

    it('should return false for null facility', () => {
      expect(hasFacilityTag(null, 'kitchen')).toBe(false)
    })

    it('should return false for undefined facility', () => {
      expect(hasFacilityTag(undefined, 'kitchen')).toBe(false)
    })
  })

  describe('findObstaclesWithFacilityTag', () => {
    it('should return obstacles with the specified tag', () => {
      const obstacles = [
        createZone('zone1', 0, 0, 4, 4, { tags: ['bedroom'] }),
        createBuilding('building1', 5, 5, 2, 2, { tags: ['kitchen'] }),
        createZone('zone2', 0, 8, 4, 4, { tags: ['bedroom', 'bathroom'] }),
      ]

      const result = findObstaclesWithFacilityTag(obstacles, 'bedroom')

      expect(result).toHaveLength(2)
      expect(result.map((o) => o.id)).toContain('zone1')
      expect(result.map((o) => o.id)).toContain('zone2')
    })

    it('should return empty array when no obstacles match', () => {
      const obstacles = [
        createZone('zone1', 0, 0, 4, 4, { tags: ['bedroom'] }),
      ]

      const result = findObstaclesWithFacilityTag(obstacles, 'restaurant')

      expect(result).toHaveLength(0)
    })
  })

  describe('findObstaclesWithAnyFacilityTag', () => {
    it('should return obstacles with any of the specified tags', () => {
      const obstacles = [
        createZone('zone1', 0, 0, 4, 4, { tags: ['bedroom'] }),
        createBuilding('building1', 5, 5, 2, 2, { tags: ['kitchen'] }),
        createZone('zone2', 0, 8, 4, 4, { tags: ['bathroom'] }),
      ]

      const result = findObstaclesWithAnyFacilityTag(obstacles, ['bedroom', 'bathroom'])

      expect(result).toHaveLength(2)
      expect(result.map((o) => o.id)).toContain('zone1')
      expect(result.map((o) => o.id)).toContain('zone2')
    })
  })

  describe('getAllFacilities', () => {
    it('should return all obstacles with facilities', () => {
      const obstacles = [
        createZone('zone1', 0, 0, 4, 4, { tags: ['bedroom'] }),
        createBuilding('building1', 5, 5, 2, 2, undefined),
        createZone('zone2', 0, 8, 4, 4, { tags: ['bathroom'] }),
      ]

      const result = getAllFacilities(obstacles)

      expect(result).toHaveLength(2)
      expect(result[0].obstacle.id).toBe('zone1')
      expect(result[1].obstacle.id).toBe('zone2')
    })
  })

  describe('findObstacleById', () => {
    it('should return obstacle with matching id', () => {
      const obstacles = [
        createZone('zone1', 0, 0, 4, 4),
        createBuilding('building1', 5, 5, 2, 2),
      ]

      const result = findObstacleById(obstacles, 'building1')

      expect(result?.id).toBe('building1')
    })

    it('should return null for non-existent id', () => {
      const obstacles = [createZone('zone1', 0, 0, 4, 4)]

      const result = findObstacleById(obstacles, 'non-existent')

      expect(result).toBeNull()
    })
  })

  describe('isNodeAtFacility', () => {
    it('should return true for node inside zone', () => {
      const zone = createZone('bedroom', 0, 0, 4, 4)

      // Node at row 2, col 2 is inside zone
      expect(isNodeAtFacility('test-2-2', zone, 'test')).toBe(true)
    })

    it('should return false for node outside zone', () => {
      const zone = createZone('bedroom', 0, 0, 4, 4)

      // Node at row 10, col 10 is outside zone
      expect(isNodeAtFacility('test-10-10', zone, 'test')).toBe(false)
    })

    it('should return true for node adjacent to building', () => {
      const building = createBuilding('counter', 2, 2, 2, 2)

      // Node at row 1, col 2 is adjacent (above) to building
      expect(isNodeAtFacility('test-1-2', building, 'test')).toBe(true)
    })

    it('should return false for node far from building', () => {
      const building = createBuilding('counter', 2, 2, 2, 2)

      // Node at row 10, col 10 is far from building
      expect(isNodeAtFacility('test-10-10', building, 'test')).toBe(false)
    })

    it('should return false for invalid node id', () => {
      const zone = createZone('bedroom', 0, 0, 4, 4)

      expect(isNodeAtFacility('invalid-id', zone, 'test')).toBe(false)
    })
  })

  describe('getFacilityTargetNode', () => {
    it('should return node inside zone', () => {
      const zone = createZone('bedroom', 0, 0, 4, 4)
      const nodes = [
        createNode('test-2-2', 180, 180),
        createNode('test-10-10', 600, 600),
      ]

      const result = getFacilityTargetNode(zone, nodes, 'test')

      expect(result).toBe('test-2-2')
    })

    it('should return node adjacent to building', () => {
      const building = createBuilding('counter', 2, 2, 2, 2)
      const nodes = [
        createNode('test-1-2', 180, 120), // Adjacent
        createNode('test-10-10', 600, 600), // Far away
      ]

      const result = getFacilityTargetNode(building, nodes, 'test')

      expect(result).toBe('test-1-2')
    })

    it('should return null when no valid node found', () => {
      const zone = createZone('bedroom', 0, 0, 4, 4)
      const nodes = [
        createNode('test-10-10', 600, 600),
      ]

      const result = getFacilityTargetNode(zone, nodes, 'test')

      expect(result).toBeNull()
    })
  })

  // =====================
  // docs/action-system.md:183 施設検索範囲仕様
  // 「検索範囲: 現在地から3マップ以内（entrance経由のホップ数でカウント）」
  // 現在は単一マップ内のみ検索。クロスマップ検索は未実装。
  // =====================

  describe('cross-map facility search (docs/action-system.md:183 - not yet implemented)', () => {
    it.todo('should search facilities within 3 maps distance')

    it.todo('should count distance by entrance hops')

    it.todo('should return facilities sorted by distance')

    it.todo('should fallback to home facility when no match found within range')
  })
})
