import { create } from 'zustand'
import type { NavigationState, Position, CrossMapRoute, CrossMapNavigationResult } from '@/types'

type NavigationEntry = NavigationState

interface CrossMapNavEntry {
  isActive: boolean
  targetMapId: string
  targetNodeId: string
  route: CrossMapRoute
  currentSegmentIndex: number
  resolvePromise: (result: CrossMapNavigationResult) => void
}

interface NavigationStore {
  navigations: Map<string, NavigationEntry>
  crossMapNavigations: Map<string, CrossMapNavEntry>

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

  // Cross-map navigation
  startCrossMapNavigation: (
    characterId: string,
    targetMapId: string,
    targetNodeId: string,
    route: CrossMapRoute,
    resolvePromise: (result: CrossMapNavigationResult) => void
  ) => void
  advanceCrossMapSegment: (characterId: string) => void
  completeCrossMapNavigation: (characterId: string) => void
  cancelCrossMapNavigation: (characterId: string) => void
  getCrossMapNavigation: (characterId: string) => CrossMapNavEntry | undefined
  isCrossMapNavigating: (characterId: string) => boolean
}

const createEmptyNavigation = (): NavigationEntry => ({
  isMoving: false,
  path: [],
  currentPathIndex: 0,
  progress: 0,
  targetPosition: null,
  startPosition: null,
})

// Helper: reset navigation to empty state
const resetNavigation = (state: NavigationStore, characterId: string) => {
  const newMap = new Map(state.navigations)
  newMap.set(characterId, createEmptyNavigation())
  return { navigations: newMap }
}

// Helper: update navigation entry
const updateNavigation = (
  state: NavigationStore,
  characterId: string,
  updater: (nav: NavigationEntry) => NavigationEntry
) => {
  const nav = state.navigations.get(characterId)
  if (!nav) return state
  const newMap = new Map(state.navigations)
  newMap.set(characterId, updater(nav))
  return { navigations: newMap }
}

export const useNavigationStore = create<NavigationStore>((set, get) => ({
  navigations: new Map(),
  crossMapNavigations: new Map(),

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
    set((state) => updateNavigation(state, characterId, (nav) => ({ ...nav, progress }))),

  advanceToNextNode: (characterId, newTargetPosition) =>
    set((state) => updateNavigation(state, characterId, (nav) => ({
      ...nav,
      currentPathIndex: nav.currentPathIndex + 1,
      progress: 0,
      startPosition: nav.targetPosition,
      targetPosition: newTargetPosition,
    }))),

  completeNavigation: (characterId) => set((state) => resetNavigation(state, characterId)),

  cancelNavigation: (characterId) => set((state) => resetNavigation(state, characterId)),

  getNavigation: (characterId) => {
    return get().navigations.get(characterId) ?? createEmptyNavigation()
  },

  isMoving: (characterId) => {
    const nav = get().navigations.get(characterId)
    return nav?.isMoving ?? false
  },

  // Cross-map navigation methods
  startCrossMapNavigation: (characterId, targetMapId, targetNodeId, route, resolvePromise) =>
    set((state) => {
      const newMap = new Map(state.crossMapNavigations)
      newMap.set(characterId, {
        isActive: true,
        targetMapId,
        targetNodeId,
        route,
        currentSegmentIndex: 0,
        resolvePromise,
      })
      return { crossMapNavigations: newMap }
    }),

  advanceCrossMapSegment: (characterId) =>
    set((state) => {
      const crossNav = state.crossMapNavigations.get(characterId)
      if (!crossNav) return state
      const newMap = new Map(state.crossMapNavigations)
      newMap.set(characterId, {
        ...crossNav,
        currentSegmentIndex: crossNav.currentSegmentIndex + 1,
      })
      return { crossMapNavigations: newMap }
    }),

  completeCrossMapNavigation: (characterId) =>
    set((state) => {
      const crossNav = state.crossMapNavigations.get(characterId)
      if (crossNav) {
        crossNav.resolvePromise({ success: true })
      }
      const newMap = new Map(state.crossMapNavigations)
      newMap.delete(characterId)
      return { crossMapNavigations: newMap }
    }),

  cancelCrossMapNavigation: (characterId) =>
    set((state) => {
      const crossNav = state.crossMapNavigations.get(characterId)
      if (crossNav) {
        crossNav.resolvePromise({ success: false, cancelled: true })
      }
      const newMap = new Map(state.crossMapNavigations)
      newMap.delete(characterId)
      return { crossMapNavigations: newMap }
    }),

  getCrossMapNavigation: (characterId) => {
    return get().crossMapNavigations.get(characterId)
  },

  isCrossMapNavigating: (characterId) => {
    const crossNav = get().crossMapNavigations.get(characterId)
    return crossNav?.isActive ?? false
  },
}))
