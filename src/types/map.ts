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

export interface GameMap {
  id: string
  name: string
  width: number
  height: number
  backgroundColor: number
  nodes: PathNode[]
  spawnNodeId: string
}
