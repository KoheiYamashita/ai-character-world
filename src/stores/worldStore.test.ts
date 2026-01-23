import { describe, it, expect, beforeEach } from 'vitest'
import { useWorldStore } from './worldStore'

describe('worldStore', () => {
  beforeEach(() => {
    useWorldStore.setState({
      currentMapId: 'town',
      time: { hour: 8, minute: 0, day: 1 },
      isPaused: false,
      transition: {
        isTransitioning: false,
        fromMapId: null,
        toMapId: null,
        progress: 0,
      },
      mapsLoaded: false,
      serverCharacters: {},
    })
  })

  describe('setCurrentMap', () => {
    it('should update current map id', () => {
      useWorldStore.getState().setCurrentMap('cafe')
      expect(useWorldStore.getState().currentMapId).toBe('cafe')
    })
  })

  describe('setTime', () => {
    it('should set time directly', () => {
      useWorldStore.getState().setTime({ hour: 12, minute: 30, day: 2 })
      expect(useWorldStore.getState().time).toEqual({ hour: 12, minute: 30, day: 2 })
    })
  })

  describe('advanceTime', () => {
    it('should add minutes within same hour', () => {
      useWorldStore.getState().setTime({ hour: 8, minute: 0, day: 1 })
      useWorldStore.getState().advanceTime(30)
      expect(useWorldStore.getState().time).toEqual({ hour: 8, minute: 30, day: 1 })
    })

    it('should carry over to next hour', () => {
      useWorldStore.getState().setTime({ hour: 8, minute: 45, day: 1 })
      useWorldStore.getState().advanceTime(30)
      expect(useWorldStore.getState().time).toEqual({ hour: 9, minute: 15, day: 1 })
    })

    it('should carry over to next day', () => {
      useWorldStore.getState().setTime({ hour: 23, minute: 30, day: 1 })
      useWorldStore.getState().advanceTime(60)
      expect(useWorldStore.getState().time).toEqual({ hour: 0, minute: 30, day: 2 })
    })

    it('should handle multiple hour rollovers', () => {
      useWorldStore.getState().setTime({ hour: 22, minute: 0, day: 1 })
      useWorldStore.getState().advanceTime(180) // 3 hours
      expect(useWorldStore.getState().time).toEqual({ hour: 1, minute: 0, day: 2 })
    })
  })

  describe('togglePause', () => {
    it('should toggle isPaused from false to true', () => {
      useWorldStore.getState().togglePause()
      expect(useWorldStore.getState().isPaused).toBe(true)
    })

    it('should toggle isPaused from true to false', () => {
      useWorldStore.setState({ isPaused: true })
      useWorldStore.getState().togglePause()
      expect(useWorldStore.getState().isPaused).toBe(false)
    })
  })

  describe('startTransition', () => {
    it('should set transition state', () => {
      useWorldStore.getState().startTransition('town', 'cafe')
      expect(useWorldStore.getState().transition).toEqual({
        isTransitioning: true,
        fromMapId: 'town',
        toMapId: 'cafe',
        progress: 0,
      })
    })
  })

  describe('updateTransitionProgress', () => {
    it('should update progress value', () => {
      useWorldStore.getState().startTransition('town', 'cafe')
      useWorldStore.getState().updateTransitionProgress(0.5)
      expect(useWorldStore.getState().transition.progress).toBe(0.5)
    })
  })

  describe('endTransition', () => {
    it('should set currentMapId to toMapId and reset transition', () => {
      useWorldStore.getState().startTransition('town', 'cafe')
      useWorldStore.getState().endTransition()
      expect(useWorldStore.getState().currentMapId).toBe('cafe')
      expect(useWorldStore.getState().transition).toEqual({
        isTransitioning: false,
        fromMapId: null,
        toMapId: null,
        progress: 0,
      })
    })

    it('should not change state when toMapId is null', () => {
      // transition.toMapId is null by default
      const before = useWorldStore.getState().currentMapId
      useWorldStore.getState().endTransition()
      expect(useWorldStore.getState().currentMapId).toBe(before)
    })
  })

  describe('setMapsLoaded', () => {
    it('should set mapsLoaded flag', () => {
      useWorldStore.getState().setMapsLoaded(true)
      expect(useWorldStore.getState().mapsLoaded).toBe(true)
    })
  })

  describe('setServerCharacters', () => {
    it('should set server characters record', () => {
      const chars = { c1: {} as never }
      useWorldStore.getState().setServerCharacters(chars)
      expect(useWorldStore.getState().serverCharacters).toBe(chars)
    })
  })
})
