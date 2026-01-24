import { create } from 'zustand'
import type { ActivityLogEntry } from '@/types'

interface ActivityLogStore {
  entries: ActivityLogEntry[]
  currentDay: number
  addEntry: (entry: ActivityLogEntry) => void
  setEntries: (entries: ActivityLogEntry[], day: number) => void
  clearIfDayChanged: (newDay: number) => void
}

export const useActivityLogStore = create<ActivityLogStore>((set, get) => ({
  entries: [],
  currentDay: 0,

  addEntry: (entry) => {
    set((state) => ({
      entries: [...state.entries, entry],
    }))
  },

  setEntries: (entries, day) => {
    set({ entries, currentDay: day })
  },

  clearIfDayChanged: (newDay) => {
    if (get().currentDay !== 0 && get().currentDay !== newDay) {
      set({ entries: [], currentDay: newDay })
    }
  },
}))
