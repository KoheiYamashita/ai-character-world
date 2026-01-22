import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { lerp, lerpPosition, getDirection, getDistance, getMovementSpeed } from './movement'
import * as worldConfigLoader from './worldConfigLoader'

describe('movement', () => {
  describe('lerp', () => {
    it('should return start when t is 0', () => {
      expect(lerp(0, 100, 0)).toBe(0)
      expect(lerp(50, 150, 0)).toBe(50)
    })

    it('should return end when t is 1', () => {
      expect(lerp(0, 100, 1)).toBe(100)
      expect(lerp(50, 150, 1)).toBe(150)
    })

    it('should return midpoint when t is 0.5', () => {
      expect(lerp(0, 100, 0.5)).toBe(50)
      expect(lerp(50, 150, 0.5)).toBe(100)
    })

    it('should handle negative values', () => {
      expect(lerp(-100, 100, 0.5)).toBe(0)
      expect(lerp(-50, -10, 0.5)).toBe(-30)
    })

    it('should extrapolate beyond 0-1 range', () => {
      expect(lerp(0, 100, 1.5)).toBe(150)
      expect(lerp(0, 100, -0.5)).toBe(-50)
    })
  })

  describe('lerpPosition', () => {
    it('should interpolate both x and y', () => {
      const start = { x: 0, y: 0 }
      const end = { x: 100, y: 200 }

      const result = lerpPosition(start, end, 0.5)

      expect(result.x).toBe(50)
      expect(result.y).toBe(100)
    })

    it('should return start position when t is 0', () => {
      const start = { x: 10, y: 20 }
      const end = { x: 100, y: 200 }

      const result = lerpPosition(start, end, 0)

      expect(result.x).toBe(10)
      expect(result.y).toBe(20)
    })

    it('should return end position when t is 1', () => {
      const start = { x: 10, y: 20 }
      const end = { x: 100, y: 200 }

      const result = lerpPosition(start, end, 1)

      expect(result.x).toBe(100)
      expect(result.y).toBe(200)
    })
  })

  describe('getDirection', () => {
    it('should return "right" when moving right', () => {
      expect(getDirection({ x: 0, y: 0 }, { x: 100, y: 0 })).toBe('right')
      expect(getDirection({ x: 0, y: 0 }, { x: 100, y: 50 })).toBe('right')
    })

    it('should return "left" when moving left', () => {
      expect(getDirection({ x: 100, y: 0 }, { x: 0, y: 0 })).toBe('left')
      expect(getDirection({ x: 100, y: 0 }, { x: 0, y: 50 })).toBe('left')
    })

    it('should return "down" when moving down', () => {
      expect(getDirection({ x: 0, y: 0 }, { x: 0, y: 100 })).toBe('down')
      expect(getDirection({ x: 0, y: 0 }, { x: 50, y: 100 })).toBe('down')
    })

    it('should return "up" when moving up', () => {
      expect(getDirection({ x: 0, y: 100 }, { x: 0, y: 0 })).toBe('up')
      expect(getDirection({ x: 0, y: 100 }, { x: 50, y: 0 })).toBe('up')
    })

    it('should prioritize horizontal when dx equals dy', () => {
      // When abs(dx) == abs(dy), the condition Math.abs(dx) > Math.abs(dy) is false
      // So it returns vertical direction
      expect(getDirection({ x: 0, y: 0 }, { x: 100, y: 100 })).toBe('down')
      expect(getDirection({ x: 100, y: 100 }, { x: 0, y: 0 })).toBe('up')
    })

    it('should handle same position', () => {
      // When dx and dy are both 0, returns vertical direction (down or up based on sign)
      const result = getDirection({ x: 50, y: 50 }, { x: 50, y: 50 })
      // dy = 0, so returns 'up' (0 > 0 is false, so 'up')
      expect(result).toBe('up')
    })
  })

  describe('getDistance', () => {
    it('should return 0 for same position', () => {
      expect(getDistance({ x: 50, y: 50 }, { x: 50, y: 50 })).toBe(0)
    })

    it('should return correct distance for horizontal movement', () => {
      expect(getDistance({ x: 0, y: 0 }, { x: 100, y: 0 })).toBe(100)
    })

    it('should return correct distance for vertical movement', () => {
      expect(getDistance({ x: 0, y: 0 }, { x: 0, y: 100 })).toBe(100)
    })

    it('should return correct distance for diagonal movement', () => {
      // 3-4-5 triangle
      expect(getDistance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5)
    })

    it('should handle negative coordinates', () => {
      expect(getDistance({ x: -50, y: -50 }, { x: 50, y: 50 })).toBeCloseTo(141.42, 1)
    })
  })

  describe('getMovementSpeed', () => {
    beforeEach(() => {
      vi.restoreAllMocks()
    })

    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('should return default speed when config is not loaded', () => {
      vi.spyOn(worldConfigLoader, 'isConfigLoaded').mockReturnValue(false)

      const result = getMovementSpeed()

      expect(result).toBe(150)
    })

    it('should return config speed when loaded', () => {
      vi.spyOn(worldConfigLoader, 'isConfigLoaded').mockReturnValue(true)
      vi.spyOn(worldConfigLoader, 'getConfig').mockReturnValue({
        movement: { speed: 200 },
      } as ReturnType<typeof worldConfigLoader.getConfig>)

      const result = getMovementSpeed()

      expect(result).toBe(200)
    })
  })
})
