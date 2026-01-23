import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  parseColor,
  getObstacleTheme,
  getConfig,
  isConfigLoaded,
  clearConfigCache,
  loadWorldConfig,
} from './worldConfigLoader'
import type { WorldConfig } from '@/types'

// Mock fetch
const mockFetch = vi.fn()
global.fetch = mockFetch

describe('worldConfigLoader', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    clearConfigCache()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    clearConfigCache()
  })

  describe('loadWorldConfig', () => {
    it('should load config from server', async () => {
      const mockConfig = {
        grid: { defaultCols: 12, defaultRows: 9, defaultWidth: 800, defaultHeight: 600 },
        movement: { speed: 150 },
        paths: { mapsJson: '/data/maps.json' },
      }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockConfig),
      })

      const config = await loadWorldConfig()

      expect(mockFetch).toHaveBeenCalledWith('/data/world-config.json')
      expect(config.grid.defaultCols).toBe(12)
    })

    it('should return cached config on subsequent calls', async () => {
      const mockConfig = {
        grid: { defaultCols: 12, defaultRows: 9, defaultWidth: 800, defaultHeight: 600 },
      }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockConfig),
      })

      await loadWorldConfig()
      await loadWorldConfig()

      expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    it('should throw on fetch error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      })

      await expect(loadWorldConfig()).rejects.toThrow('Failed to load world config')
    })

    it('should allow getConfig after loading', async () => {
      const mockConfig = {
        grid: { defaultCols: 16, defaultRows: 12, defaultWidth: 1024, defaultHeight: 768 },
      }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockConfig),
      })

      await loadWorldConfig()
      const config = getConfig()

      expect(config.grid.defaultCols).toBe(16)
    })
  })

  describe('parseColor', () => {
    it('should parse hex color with # prefix', () => {
      expect(parseColor('#336633')).toBe(0x336633)
      expect(parseColor('#FFFFFF')).toBe(0xFFFFFF)
      expect(parseColor('#000000')).toBe(0x000000)
    })

    it('should parse hex color with 0x prefix', () => {
      expect(parseColor('0x336633')).toBe(0x336633)
      expect(parseColor('0xFFFFFF')).toBe(0xFFFFFF)
    })

    it('should handle lowercase hex', () => {
      expect(parseColor('#ffffff')).toBe(0xFFFFFF)
      expect(parseColor('0xffffff')).toBe(0xFFFFFF)
    })
  })

  describe('getObstacleTheme', () => {
    it('should return building theme from new format', () => {
      const config = {
        theme: {
          obstacle: {
            building: {
              fill: '#330000',
              alpha: 0.3,
              stroke: '#ff0000',
              strokeWidth: 2,
              labelColor: '#ffffff',
            },
            zone: {
              fill: '#003300',
              alpha: 0.3,
              stroke: '#00ff00',
              strokeWidth: 1,
              labelColor: '#000000',
            },
          },
        },
      } as unknown as WorldConfig

      const theme = getObstacleTheme(config, 'building')

      expect(theme.stroke).toBe('#ff0000')
    })

    it('should return zone theme from new format', () => {
      const config = {
        theme: {
          obstacle: {
            building: {
              fill: '#330000',
              alpha: 0.3,
              stroke: '#ff0000',
              strokeWidth: 2,
              labelColor: '#ffffff',
            },
            zone: {
              fill: '#003300',
              alpha: 0.3,
              stroke: '#00ff00',
              strokeWidth: 1,
              labelColor: '#000000',
            },
          },
        },
      } as unknown as WorldConfig

      const theme = getObstacleTheme(config, 'zone')

      expect(theme.stroke).toBe('#00ff00')
    })

    it('should return same theme for old format', () => {
      const oldTheme = {
        fill: '#888888',
        alpha: 0.3,
        stroke: '#888888',
        strokeWidth: 2,
        labelColor: '#ffffff',
      }
      const config = {
        theme: {
          obstacle: oldTheme,
        },
      } as unknown as WorldConfig

      const buildingTheme = getObstacleTheme(config, 'building')
      const zoneTheme = getObstacleTheme(config, 'zone')

      expect(buildingTheme).toEqual(oldTheme)
      expect(zoneTheme).toEqual(oldTheme)
    })
  })

  describe('isConfigLoaded', () => {
    it('should return false when not loaded', () => {
      expect(isConfigLoaded()).toBe(false)
    })
  })

  describe('getConfig', () => {
    it('should throw when config not loaded', () => {
      expect(() => getConfig()).toThrow('World config not loaded')
    })
  })

  describe('clearConfigCache', () => {
    it('should clear the cache', () => {
      // No direct way to test without loading, but ensure it doesn't throw
      expect(() => clearConfigCache()).not.toThrow()
      expect(isConfigLoaded()).toBe(false)
    })
  })
})
