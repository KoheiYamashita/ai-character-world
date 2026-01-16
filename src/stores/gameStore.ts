import { create } from 'zustand'
import type { GameTime, TransitionState } from '@/types'

interface GameStore {
  currentMapId: string
  time: GameTime
  isPaused: boolean
  transition: TransitionState

  setCurrentMap: (mapId: string) => void
  setTime: (time: GameTime) => void
  advanceTime: (minutes: number) => void
  togglePause: () => void
  startTransition: (fromMapId: string, toMapId: string) => void
  updateTransitionProgress: (progress: number) => void
  endTransition: () => void
}

export const useGameStore = create<GameStore>((set, get) => ({
  currentMapId: 'town',
  time: { hour: 8, minute: 0, day: 1 },
  isPaused: false,
  transition: {
    isTransitioning: false,
    fromMapId: null,
    toMapId: null,
    progress: 0,
  },

  setCurrentMap: (mapId) => set({ currentMapId: mapId }),

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
    const { transition } = get()
    if (transition.toMapId) {
      set({
        currentMapId: transition.toMapId,
        transition: {
          isTransitioning: false,
          fromMapId: null,
          toMapId: null,
          progress: 0,
        },
      })
    }
  },
}))
