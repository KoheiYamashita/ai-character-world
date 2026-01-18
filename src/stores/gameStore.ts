import { create } from 'zustand'
import type { GameTime, TransitionState } from '@/types'

// Initial state defaults (will be overridden when config loads in PixiAppSync)
const INITIAL_MAP_ID = 'town'
const INITIAL_TIME: GameTime = { hour: 8, minute: 0, day: 1 }

interface GameStore {
  currentMapId: string
  time: GameTime
  isPaused: boolean
  transition: TransitionState
  mapsLoaded: boolean

  setCurrentMap: (mapId: string) => void
  setTime: (time: GameTime) => void
  advanceTime: (minutes: number) => void
  togglePause: () => void
  startTransition: (fromMapId: string, toMapId: string) => void
  updateTransitionProgress: (progress: number) => void
  endTransition: () => void
  setMapsLoaded: (loaded: boolean) => void
}

export const useGameStore = create<GameStore>((set, get) => ({
  currentMapId: INITIAL_MAP_ID,
  time: INITIAL_TIME,
  isPaused: false,
  transition: {
    isTransitioning: false,
    fromMapId: null,
    toMapId: null,
    progress: 0,
  },
  mapsLoaded: false,

  setCurrentMap: (mapId) => set({ currentMapId: mapId }),
  setMapsLoaded: (loaded) => set({ mapsLoaded: loaded }),

  setTime: (time) => set({ time }),

  advanceTime: (minutes) => {
    const { time } = get()
    let newMinute = time.minute + minutes
    let newHour = time.hour
    let newDay = time.day

    while (newMinute >= 60) {
      newMinute -= 60
      newHour++
    }

    while (newHour >= 24) {
      newHour -= 24
      newDay++
    }

    set({ time: { hour: newHour, minute: newMinute, day: newDay } })
  },

  togglePause: () => set((state) => ({ isPaused: !state.isPaused })),

  startTransition: (fromMapId, toMapId) =>
    set({
      transition: {
        isTransitioning: true,
        fromMapId,
        toMapId,
        progress: 0,
      },
    }),

  updateTransitionProgress: (progress) =>
    set((state) => ({
      transition: { ...state.transition, progress },
    })),

  endTransition: () => {
    const { toMapId } = get().transition
    if (!toMapId) return

    set({
      currentMapId: toMapId,
      transition: {
        isTransitioning: false,
        fromMapId: null,
        toMapId: null,
        progress: 0,
      },
    })
  },
}))
