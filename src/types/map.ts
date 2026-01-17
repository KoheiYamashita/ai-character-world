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

export interface ObstacleConfigJson {
  id?: string
  row: number // タイル行（0-indexed）
  col: number // タイル列（0-indexed）
  tileWidth: number // タイル幅（何タイル分か）
  tileHeight: number // タイル高（何タイル分か）
  label?: string
}

export interface Obstacle {
  id: string
  x: number
  y: number
  width: number
  height: number
  label?: string
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
}

export interface MapsDataJson {
  maps: MapConfigJson[]
}
