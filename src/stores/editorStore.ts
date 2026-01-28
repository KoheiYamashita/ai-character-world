/**
 * マップエディタ用Zustandストア
 */

import { create } from 'zustand'
import type {
  EditorStore,
  EditorTool,
  EditorSelection,
  ResizeHandle,
  ValidationResult,
  EditorSettings,
} from '@/types/editor'
import type {
  MapConfigJson,
  ObstacleConfigJson,
  EntranceConfigJson,
} from '@/types/map'
import type { NPCConfigJson } from '@/types/npc'

const DEFAULT_SETTINGS: EditorSettings = {
  gridVisible: true,
  snapToGrid: true,
  showNodeIds: false,
  showFacilityTags: true,
}

// 履歴の最大数
const MAX_HISTORY = 50

// 現在の状態を履歴にプッシュするヘルパー
function pushToHistory(state: { maps: MapConfigJson[]; history: MapConfigJson[][] }): MapConfigJson[][] {
  const snapshot = JSON.parse(JSON.stringify(state.maps)) as MapConfigJson[]
  const newHistory = [...state.history, snapshot]
  // 履歴が最大数を超えたら古いものを削除
  if (newHistory.length > MAX_HISTORY) {
    newHistory.shift()
  }
  return newHistory
}

export const useEditorStore = create<EditorStore>((set, get) => ({
  // 初期状態
  maps: [],
  originalMaps: [],
  currentMapId: null,
  isDirty: false,

  // Undo/Redo履歴
  history: [],
  future: [],

  tool: 'select',
  selection: null,

  drag: {
    isDragging: false,
    startX: 0,
    startY: 0,
    startTileRow: 0,
    startTileCol: 0,
    currentX: 0,
    currentY: 0,
  },

  resize: {
    isResizing: false,
    handle: null,
    startWidth: 0,
    startHeight: 0,
    startRow: 0,
    startCol: 0,
  },

  settings: DEFAULT_SETTINGS,

  validationResult: null,
  isValidating: false,

  // マップデータ操作
  setMaps: (maps) => {
    const mapsCopy = JSON.parse(JSON.stringify(maps)) as MapConfigJson[]
    set({
      maps: mapsCopy,
      originalMaps: JSON.parse(JSON.stringify(maps)) as MapConfigJson[],
      isDirty: false,
      currentMapId: mapsCopy.length > 0 ? mapsCopy[0].id : null,
      history: [],
      future: [],
    })
  },

  setCurrentMap: (mapId) => set({ currentMapId: mapId, selection: null }),

  addMap: (map) => {
    set((state) => ({
      history: pushToHistory(state),
      future: [],
      maps: [...state.maps, map],
      currentMapId: map.id,
      isDirty: true,
    }))
  },

  updateMap: (mapId, updates) => {
    set((state) => ({
      history: pushToHistory(state),
      future: [],
      maps: state.maps.map((m) =>
        m.id === mapId ? { ...m, ...updates } : m
      ),
      isDirty: true,
    }))
  },

  deleteMap: (mapId) => {
    set((state) => {
      const newMaps = state.maps.filter((m) => m.id !== mapId)
      const newCurrentId =
        state.currentMapId === mapId
          ? newMaps.length > 0
            ? newMaps[0].id
            : null
          : state.currentMapId
      return {
        history: pushToHistory(state),
        future: [],
        maps: newMaps,
        currentMapId: newCurrentId,
        selection: state.currentMapId === mapId ? null : state.selection,
        isDirty: true,
      }
    })
  },

  duplicateMap: (mapId, newId) => {
    set((state) => {
      const sourceMap = state.maps.find((m) => m.id === mapId)
      if (!sourceMap) return state
      const newMap: MapConfigJson = {
        ...JSON.parse(JSON.stringify(sourceMap)),
        id: newId,
        name: `${sourceMap.name} (コピー)`,
        grid: {
          ...sourceMap.grid,
          prefix: newId,
        },
        spawnNodeId: `${newId}-4-4`,
      }
      return {
        history: pushToHistory(state),
        future: [],
        maps: [...state.maps, newMap],
        currentMapId: newId,
        isDirty: true,
      }
    })
  },

  // 障害物操作
  addObstacle: (mapId, obstacle) => {
    set((state) => ({
      history: pushToHistory(state),
      future: [],
      maps: state.maps.map((m) =>
        m.id === mapId
          ? { ...m, obstacles: [...(m.obstacles || []), obstacle] }
          : m
      ),
      isDirty: true,
    }))
  },

  updateObstacle: (mapId, index, updates) => {
    set((state) => ({
      history: pushToHistory(state),
      future: [],
      maps: state.maps.map((m) =>
        m.id === mapId
          ? {
              ...m,
              obstacles: (m.obstacles || []).map((obs, i) =>
                i === index ? { ...obs, ...updates } : obs
              ),
            }
          : m
      ),
      isDirty: true,
    }))
  },

  deleteObstacle: (mapId, index) => {
    set((state) => ({
      history: pushToHistory(state),
      future: [],
      maps: state.maps.map((m) =>
        m.id === mapId
          ? {
              ...m,
              obstacles: (m.obstacles || []).filter((_, i) => i !== index),
            }
          : m
      ),
      selection: null,
      isDirty: true,
    }))
  },

  // 入口操作
  addEntrance: (mapId, entrance) => {
    set((state) => ({
      history: pushToHistory(state),
      future: [],
      maps: state.maps.map((m) =>
        m.id === mapId
          ? { ...m, entrances: [...m.entrances, entrance] }
          : m
      ),
      isDirty: true,
    }))
  },

  updateEntrance: (mapId, index, updates) => {
    set((state) => ({
      history: pushToHistory(state),
      future: [],
      maps: state.maps.map((m) =>
        m.id === mapId
          ? {
              ...m,
              entrances: m.entrances.map((ent, i) =>
                i === index ? { ...ent, ...updates } : ent
              ),
            }
          : m
      ),
      isDirty: true,
    }))
  },

  deleteEntrance: (mapId, index) => {
    set((state) => ({
      history: pushToHistory(state),
      future: [],
      maps: state.maps.map((m) =>
        m.id === mapId
          ? {
              ...m,
              entrances: m.entrances.filter((_, i) => i !== index),
            }
          : m
      ),
      selection: null,
      isDirty: true,
    }))
  },

  // NPC操作
  addNPC: (mapId, npc) => {
    set((state) => ({
      history: pushToHistory(state),
      future: [],
      maps: state.maps.map((m) =>
        m.id === mapId
          ? { ...m, npcs: [...(m.npcs || []), npc] }
          : m
      ),
      isDirty: true,
    }))
  },

  updateNPC: (mapId, index, updates) => {
    set((state) => ({
      history: pushToHistory(state),
      future: [],
      maps: state.maps.map((m) =>
        m.id === mapId
          ? {
              ...m,
              npcs: (m.npcs || []).map((npc, i) =>
                i === index ? { ...npc, ...updates } : npc
              ),
            }
          : m
      ),
      isDirty: true,
    }))
  },

  deleteNPC: (mapId, index) => {
    set((state) => ({
      history: pushToHistory(state),
      future: [],
      maps: state.maps.map((m) =>
        m.id === mapId
          ? {
              ...m,
              npcs: (m.npcs || []).filter((_, i) => i !== index),
            }
          : m
      ),
      selection: null,
      isDirty: true,
    }))
  },

  // ツール・選択
  setTool: (tool: EditorTool) => set({ tool }),

  setSelection: (selection: EditorSelection | null) => set({ selection }),

  clearSelection: () => set({ selection: null }),

  // ドラッグ
  startDrag: (x, y, tileRow, tileCol) => {
    set({
      drag: {
        isDragging: true,
        startX: x,
        startY: y,
        startTileRow: tileRow,
        startTileCol: tileCol,
        currentX: x,
        currentY: y,
      },
    })
  },

  updateDrag: (x, y) => {
    set((state) => ({
      drag: { ...state.drag, currentX: x, currentY: y },
    }))
  },

  endDrag: () => {
    set((state) => ({
      drag: {
        ...state.drag,
        isDragging: false,
      },
    }))
  },

  // リサイズ
  startResize: (handle: ResizeHandle, width, height, row, col) => {
    set({
      resize: {
        isResizing: true,
        handle,
        startWidth: width,
        startHeight: height,
        startRow: row,
        startCol: col,
      },
    })
  },

  endResize: () => {
    set({
      resize: {
        isResizing: false,
        handle: null,
        startWidth: 0,
        startHeight: 0,
        startRow: 0,
        startCol: 0,
      },
    })
  },

  // 設定
  updateSettings: (settings) => {
    set((state) => ({
      settings: { ...state.settings, ...settings },
    }))
  },

  toggleGrid: () => {
    set((state) => ({
      settings: { ...state.settings, gridVisible: !state.settings.gridVisible },
    }))
  },

  // バリデーション
  setValidationResult: (result) => set({ validationResult: result }),
  setIsValidating: (isValidating) => set({ isValidating }),

  // 変更管理
  markDirty: () => set({ isDirty: true }),

  markClean: () => {
    set((state) => ({
      isDirty: false,
      originalMaps: JSON.parse(JSON.stringify(state.maps)) as MapConfigJson[],
    }))
  },

  resetToOriginal: () => {
    set((state) => ({
      maps: JSON.parse(JSON.stringify(state.originalMaps)) as MapConfigJson[],
      isDirty: false,
      selection: null,
      history: [],
      future: [],
    }))
  },

  // Undo/Redo
  undo: () => {
    const { history, maps } = get()
    if (history.length === 0) return

    const newHistory = [...history]
    const previousMaps = newHistory.pop()!
    const currentSnapshot = JSON.parse(JSON.stringify(maps)) as MapConfigJson[]

    set((state) => ({
      maps: previousMaps,
      history: newHistory,
      future: [currentSnapshot, ...state.future],
      isDirty: true,
      selection: null,
    }))
  },

  redo: () => {
    const { future, maps } = get()
    if (future.length === 0) return

    const newFuture = [...future]
    const nextMaps = newFuture.shift()!
    const currentSnapshot = JSON.parse(JSON.stringify(maps)) as MapConfigJson[]

    set((state) => ({
      maps: nextMaps,
      history: [...state.history, currentSnapshot],
      future: newFuture,
      isDirty: true,
      selection: null,
    }))
  },

  canUndo: () => get().history.length > 0,
  canRedo: () => get().future.length > 0,

  // 選択中の要素を削除
  deleteSelected: () => {
    const { selection, currentMapId } = get()
    if (!selection || !currentMapId) return

    const { type, index } = selection
    if (index === undefined) return

    switch (type) {
      case 'obstacle':
        get().deleteObstacle(currentMapId, index)
        break
      case 'entrance':
        get().deleteEntrance(currentMapId, index)
        break
      case 'npc':
        get().deleteNPC(currentMapId, index)
        break
    }
  },
}))

// セレクター（パフォーマンス最適化用）
export const selectCurrentMap = (state: EditorStore) => {
  return state.maps.find((m) => m.id === state.currentMapId) ?? null
}

export const selectCurrentObstacles = (state: EditorStore) => {
  const map = selectCurrentMap(state)
  return map?.obstacles ?? []
}

export const selectCurrentEntrances = (state: EditorStore) => {
  const map = selectCurrentMap(state)
  return map?.entrances ?? []
}

export const selectCurrentNPCs = (state: EditorStore) => {
  const map = selectCurrentMap(state)
  return map?.npcs ?? []
}

export const selectSelectedObstacle = (state: EditorStore): ObstacleConfigJson | null => {
  if (state.selection?.type !== 'obstacle' || state.selection.index === undefined) return null
  const obstacles = selectCurrentObstacles(state)
  return obstacles[state.selection.index] ?? null
}

export const selectSelectedEntrance = (state: EditorStore): EntranceConfigJson | null => {
  if (state.selection?.type !== 'entrance' || state.selection.index === undefined) return null
  const entrances = selectCurrentEntrances(state)
  return entrances[state.selection.index] ?? null
}

export const selectSelectedNPC = (state: EditorStore): NPCConfigJson | null => {
  if (state.selection?.type !== 'npc' || state.selection.index === undefined) return null
  const npcs = selectCurrentNPCs(state)
  return npcs[state.selection.index] ?? null
}
