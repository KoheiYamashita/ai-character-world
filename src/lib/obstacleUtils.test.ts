import { describe, it, expect } from 'vitest'
import {
  getObstaclesByType,
  getZones,
  getBuildings,
  getObstaclesWithFacility,
  hasFacility,
} from './obstacleUtils'
import type { Obstacle } from '@/types'

function createObstacle(overrides: Partial<Obstacle> = {}): Obstacle {
  return {
    id: 'obs-1',
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    type: 'building',
    tileRow: 0,
    tileCol: 0,
    tileWidth: 2,
    tileHeight: 2,
    ...overrides,
  }
}

describe('obstacleUtils', () => {
  const building1 = createObstacle({ id: 'b1', type: 'building' })
  const building2 = createObstacle({ id: 'b2', type: 'building' })
  const zone1 = createObstacle({ id: 'z1', type: 'zone' })
  const zone2 = createObstacle({ id: 'z2', type: 'zone' })
  const withFacility = createObstacle({
    id: 'f1',
    facility: { tags: ['kitchen'] },
  })
  const withoutFacility = createObstacle({ id: 'nf1' })

  describe('getObstaclesByType', () => {
    it('should filter building type obstacles', () => {
      const result = getObstaclesByType([building1, zone1, building2], 'building')
      expect(result).toEqual([building1, building2])
    })

    it('should filter zone type obstacles', () => {
      const result = getObstaclesByType([building1, zone1, zone2], 'zone')
      expect(result).toEqual([zone1, zone2])
    })

    it('should return empty array when no matches', () => {
      expect(getObstaclesByType([building1], 'zone')).toEqual([])
    })

    it('should return empty array for empty input', () => {
      expect(getObstaclesByType([], 'building')).toEqual([])
    })
  })

  describe('getZones', () => {
    it('should return only zone type obstacles', () => {
      expect(getZones([building1, zone1, zone2])).toEqual([zone1, zone2])
    })
  })

  describe('getBuildings', () => {
    it('should return only building type obstacles', () => {
      expect(getBuildings([building1, zone1, building2])).toEqual([building1, building2])
    })
  })

  describe('getObstaclesWithFacility', () => {
    it('should return obstacles with facility defined', () => {
      const result = getObstaclesWithFacility([withFacility, withoutFacility])
      expect(result).toEqual([withFacility])
    })

    it('should return empty array when none have facility', () => {
      expect(getObstaclesWithFacility([withoutFacility])).toEqual([])
    })

    it('should return empty array for empty input', () => {
      expect(getObstaclesWithFacility([])).toEqual([])
    })
  })

  describe('hasFacility', () => {
    it('should return true when obstacle has facility', () => {
      expect(hasFacility(withFacility)).toBe(true)
    })

    it('should return false when obstacle has no facility', () => {
      expect(hasFacility(withoutFacility)).toBe(false)
    })
  })
})
