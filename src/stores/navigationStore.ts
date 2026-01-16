import { create } from 'zustand'
import type { NavigationState, Position } from '@/types'

interface NavigationEntry extends NavigationState {
  startPosition: Position | null
}

interface NavigationStore {
  navigations: Map<string, NavigationEntry>

  startNavigation: (
    characterId: string,
    path: string[],
    startPosition: Position,
    targetPosition: Position
  ) => void
  updateProgress: (characterId: string, progress: number) => void
  advanceToNextNode: (characterId: string, newTargetPosition: Position) => void
  completeNavigation: (characterId: string) => void
  cancelNavigation: (characterId: string) => void
  getNavigation: (characterId: string) => NavigationEntry | undefined
  isMoving: (characterId: string) => boolean
}

const createEmptyNavigation = (): NavigationEntry => ({
  isMoving: false,
  path: [],
  currentPathIndex: 0,
  progress: 0,
  targetPosition: null,
  startPosition: null,
})

export const useNavigationStore = create<NavigationStore>((set, get) => ({
  navigations: new Map(),

  startNavigation: (characterId, path, startPosition, targetPosition) =>
    set((state) => {
      const newMap = new Map(state.navigations)
      newMap.set(characterId, {
        isMoving: true,
        path,
        currentPathIndex: 0,
        progress: 0,
        targetPosition,
        startPosition,
      })
      return { navigations: newMap }
    }),

  updateProgress: (characterId, progress) =>
    set((state) => {
      const nav = state.navigations.get(characterId)
      if (!nav) return state
      const newMap = new Map(state.navigations)
      newMap.set(characterId, { ...nav, progress })
      return { navigations: newMap }
    }),

  advanceToNextNode: (characterId, newTargetPosition) =>
    set((state) => {
      const nav = state.navigations.get(characterId)
      if (!nav) return state
      const newMap = new Map(state.navigations)
      newMap.set(characterId, {
        ...nav,
        currentPathIndex: nav.currentPathIndex + 1,
        progress: 0,
        startPosition: nav.targetPosition,
        targetPosition: newTargetPosition,
      })
      return { navigations: newMap }
    }),

  completeNavigation: (characterId) =>
    set((state) => {
      const newMap = new Map(state.navigations)
      newMap.set(characterId, createEmptyNavigation())
      return { navigations: newMap }
    }),

  cancelNavigation: (characterId) =>
    set((state) => {
      const newMap = new Map(state.navigations)
      newMap.set(characterId, createEmptyNavigation())
      return { navigations: newMap }
    }),

  getNavigation: (characterId) => {
    return get().navigations.get(characterId) ?? createEmptyNavigation()
  },

  isMoving: (characterId) => {
    const nav = get().navigations.get(characterId)
    return nav?.isMoving ?? false
  },
}))
