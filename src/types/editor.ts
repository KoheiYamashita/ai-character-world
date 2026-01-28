/**
 * マップエディタ専用型定義
 */

import type {
  MapConfigJson,
  ObstacleConfigJson,
  EntranceConfigJson,
} from './map'
import type { NPCConfigJson } from './npc'

// エディタツール種別
export type EditorTool = 'select' | 'building' | 'zone' | 'entrance' | 'npc' | 'pan'

// 選択対象の種別
export type SelectionType = 'obstacle' | 'entrance' | 'npc' | 'label' | 'spawn'

// 選択状態
export interface EditorSelection {
  type: SelectionType
  id?: string        // obstacle.id, entrance.id, npc.id など
  index?: number     // 配列インデックス（id がない場合のフォールバック）
}

// ドラッグ状態
export interface DragState {
  isDragging: boolean
  // ドラッグ開始位置（ピクセル）
  startX: number
  startY: number
  // ドラッグ開始時のタイル位置
  startTileRow: number
  startTileCol: number
  // 現在のドラッグ位置
  currentX: number
  currentY: number
}

// リサイズハンドル位置
export type ResizeHandle =
  | 'top-left'
  | 'top'
  | 'top-right'
  | 'left'
  | 'right'
  | 'bottom-left'
  | 'bottom'
  | 'bottom-right'

// リサイズ状態
export interface ResizeState {
  isResizing: boolean
  handle: ResizeHandle | null
  startWidth: number
  startHeight: number
  startRow: number
  startCol: number
}

// バリデーション結果
export interface ValidationError {
  mapId: string
  message: string
  elementType?: SelectionType
  elementId?: string
  elementIndex?: number
}

export interface MapValidationResult {
  mapId: string
  mapName: string
  valid: boolean
  errors: string[]
  warnings: string[]
}

export interface ValidationResult {
  valid: boolean
  results: MapValidationResult[]
}

// エディタの設定
export interface EditorSettings {
  gridVisible: boolean
  snapToGrid: boolean
  showNodeIds: boolean
  showFacilityTags: boolean
}

// エディタ状態（Zustand用）
export interface EditorState {
  // マップデータ
  maps: MapConfigJson[]
  originalMaps: MapConfigJson[] // 変更検出用
  currentMapId: string | null
  isDirty: boolean

  // Undo/Redo履歴
  history: MapConfigJson[][]  // 過去の状態
  future: MapConfigJson[][]   // Undo後の状態（Redo用）

  // ツール・選択
  tool: EditorTool
  selection: EditorSelection | null

  // ドラッグ・リサイズ
  drag: DragState
  resize: ResizeState

  // 設定
  settings: EditorSettings

  // バリデーション
  validationResult: ValidationResult | null
  isValidating: boolean
}

// エディタアクション（Zustand用）
export interface EditorActions {
  // マップデータ操作
  setMaps: (maps: MapConfigJson[]) => void
  setCurrentMap: (mapId: string) => void
  addMap: (map: MapConfigJson) => void
  updateMap: (mapId: string, updates: Partial<MapConfigJson>) => void
  deleteMap: (mapId: string) => void
  duplicateMap: (mapId: string, newId: string) => void

  // 障害物操作
  addObstacle: (mapId: string, obstacle: ObstacleConfigJson) => void
  updateObstacle: (mapId: string, index: number, updates: Partial<ObstacleConfigJson>) => void
  deleteObstacle: (mapId: string, index: number) => void

  // 入口操作
  addEntrance: (mapId: string, entrance: EntranceConfigJson) => void
  updateEntrance: (mapId: string, index: number, updates: Partial<EntranceConfigJson>) => void
  deleteEntrance: (mapId: string, index: number) => void

  // NPC操作
  addNPC: (mapId: string, npc: NPCConfigJson) => void
  updateNPC: (mapId: string, index: number, updates: Partial<NPCConfigJson>) => void
  deleteNPC: (mapId: string, index: number) => void

  // ツール・選択
  setTool: (tool: EditorTool) => void
  setSelection: (selection: EditorSelection | null) => void
  clearSelection: () => void

  // ドラッグ
  startDrag: (x: number, y: number, tileRow: number, tileCol: number) => void
  updateDrag: (x: number, y: number) => void
  endDrag: () => void

  // リサイズ
  startResize: (handle: ResizeHandle, width: number, height: number, row: number, col: number) => void
  endResize: () => void

  // 設定
  updateSettings: (settings: Partial<EditorSettings>) => void
  toggleGrid: () => void

  // バリデーション
  setValidationResult: (result: ValidationResult | null) => void
  setIsValidating: (isValidating: boolean) => void

  // 変更管理
  markDirty: () => void
  markClean: () => void
  resetToOriginal: () => void

  // Undo/Redo
  undo: () => void
  redo: () => void
  canUndo: () => boolean
  canRedo: () => boolean

  // 選択中の要素を削除
  deleteSelected: () => void
}

export type EditorStore = EditorState & EditorActions

// ヘルパー関数の型
export interface GridPosition {
  row: number
  col: number
}

export interface PixelPosition {
  x: number
  y: number
}
