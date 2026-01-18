import type { NPCConfigJson } from './npc'

export type NodeType = 'waypoint' | 'entrance' | 'spawn'

export interface PathNode {
  id: string
  x: number
  y: number
  type: NodeType
  connectedTo: string[]
  leadsTo?: {
    mapId: string
    nodeId: string
  }
  label?: string
}

export type ObstacleType = 'building' | 'zone'
export type WallSide = 'top' | 'bottom' | 'left' | 'right'

export interface DoorConfig {
  side: WallSide
  // 壁終端位置を指定（0-indexed、壁の最初のノード=0）
  // 開口部はstart〜endの間（exclusive: start < offset < end）
  // 例: start=2, end=4 → offset 0,1,2は壁、offset 3が開口部、offset 4以降は壁
  // 制約: end - start >= 2（間に最低1つの開口部が必要）
  start: number
  end: number
}

export interface ObstacleConfigJson {
  id?: string
  row: number // タイル行（0-indexed）
  col: number // タイル列（0-indexed）
  tileWidth: number // タイル幅（何タイル分か）
  tileHeight: number // タイル高（何タイル分か）
  label?: string
  type?: ObstacleType // デフォルト: 'building'
  wallSides?: WallSide[] // zone用: 壁のある辺
  door?: DoorConfig // zone用: 扉の位置範囲
}

export interface Obstacle {
  id: string
  x: number
  y: number
  width: number
  height: number
  label?: string
  type: ObstacleType
  wallSides?: WallSide[]
  door?: DoorConfig
  // タイルベースの座標情報（壁衝突計算用）
  tileRow: number
  tileCol: number
  tileWidth: number
  tileHeight: number
}

export interface GameMap {
  id: string
  name: string
  width: number
  height: number
  backgroundColor: number
  nodes: PathNode[]
  spawnNodeId: string
  obstacles: Obstacle[]
}

// JSON config types for map loading
export interface GridConfigJson {
  prefix: string
  cols?: number
  rows?: number
}

export interface NodeLabelJson {
  nodeId: string
  label: string
  type?: 'spawn' | 'waypoint'
}

export interface EntranceConfigJson {
  id: string
  row: number // タイル行（グリッド範囲外も許容）
  col: number // タイル列（グリッド範囲外も許容）
  connectedNodeIds: string[]
  leadsTo: { mapId: string; nodeId: string }
  label: string
}

export interface MapConfigJson {
  id: string
  name: string
  width: number
  height: number
  backgroundColor: string
  spawnNodeId: string
  grid: GridConfigJson
  labels: NodeLabelJson[]
  entrances: EntranceConfigJson[]
  obstacles?: ObstacleConfigJson[]
  npcs?: NPCConfigJson[]
}

export interface MapsDataJson {
  maps: MapConfigJson[]
}

// Cross-map navigation types
export interface RouteSegment {
  mapId: string
  path: string[]           // Node IDs within this map
  exitEntranceId?: string  // Entrance to next map (undefined for final segment)
}

export interface CrossMapRoute {
  segments: RouteSegment[]
}
