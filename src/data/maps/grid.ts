import type { PathNode, Obstacle } from '@/types'
import { isConfigLoaded, getConfig } from '@/lib/gameConfigLoader'

export interface GridConfig {
  prefix: string
  cols?: number
  rows?: number
  width?: number
  height?: number
}

export interface NodeLabel {
  nodeId: string
  label: string
  type?: 'spawn' | 'waypoint'
}

export interface EntranceConfig {
  id: string
  x: number
  y: number
  connectedNodeIds: string[]
  leadsTo: { mapId: string; nodeId: string }
  label: string
}

export function isPointInsideObstacle(x: number, y: number, obstacle: Obstacle): boolean {
  return (
    x >= obstacle.x &&
    x <= obstacle.x + obstacle.width &&
    y >= obstacle.y &&
    y <= obstacle.y + obstacle.height
  )
}

function isInsideAnyObstacle(x: number, y: number, obstacles: Obstacle[]): boolean {
  return obstacles.some((obstacle) => isPointInsideObstacle(x, y, obstacle))
}

// Defaults matching game-config.json
const FALLBACK_DEFAULTS = {
  cols: 12,
  rows: 9,
  width: 800,
  height: 600,
}

function getGridDefaults() {
  if (isConfigLoaded()) {
    const config = getConfig()
    return {
      cols: config.grid.defaultCols,
      rows: config.grid.defaultRows,
      width: config.grid.defaultWidth,
      height: config.grid.defaultHeight,
    }
  }
  return FALLBACK_DEFAULTS
}

function getNodeId(prefix: string, row: number, col: number): string {
  return `${prefix}-${row}-${col}`
}

function generateConnections(
  prefix: string,
  row: number,
  col: number,
  rows: number,
  cols: number
): string[] {
  const connections: string[] = []

  // Cardinal directions
  if (col > 0) connections.push(getNodeId(prefix, row, col - 1))
  if (col < cols - 1) connections.push(getNodeId(prefix, row, col + 1))
  if (row > 0) connections.push(getNodeId(prefix, row - 1, col))
  if (row < rows - 1) connections.push(getNodeId(prefix, row + 1, col))

  // Diagonal directions
  if (row > 0 && col > 0) connections.push(getNodeId(prefix, row - 1, col - 1))
  if (row > 0 && col < cols - 1) connections.push(getNodeId(prefix, row - 1, col + 1))
  if (row < rows - 1 && col > 0) connections.push(getNodeId(prefix, row + 1, col - 1))
  if (row < rows - 1 && col < cols - 1) connections.push(getNodeId(prefix, row + 1, col + 1))

  return connections
}

export function generateGridNodes(
  config: GridConfig,
  labels: NodeLabel[] = [],
  entrances: EntranceConfig[] = [],
  obstacles: Obstacle[] = []
): PathNode[] {
  const defaults = getGridDefaults()
  const {
    prefix,
    cols = defaults.cols,
    rows = defaults.rows,
    width = defaults.width,
    height = defaults.height,
  } = config

  const spacingX = width / (cols + 1)
  const spacingY = height / (rows + 1)

  const nodes: PathNode[] = []
  const nodeMap = new Map<string, PathNode>()

  // Generate grid nodes, skipping those inside obstacles
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = Math.round(spacingX * (col + 1))
      const y = Math.round(spacingY * (row + 1))

      // Skip nodes inside obstacles
      if (isInsideAnyObstacle(x, y, obstacles)) {
        continue
      }

      const id = getNodeId(prefix, row, col)
      const node: PathNode = {
        id,
        x,
        y,
        type: 'waypoint',
        connectedTo: generateConnections(prefix, row, col, rows, cols),
      }
      nodes.push(node)
      nodeMap.set(id, node)
    }
  }

  // Filter connections to only include nodes that exist
  for (const node of nodes) {
    node.connectedTo = node.connectedTo.filter((id) => nodeMap.has(id))
  }

  // Apply labels and type overrides
  for (const { nodeId, label, type } of labels) {
    const node = nodeMap.get(nodeId)
    if (node) {
      node.label = label
      if (type) node.type = type
    }
  }

  // Add entrance nodes and connect them to the grid
  for (const entrance of entrances) {
    const entranceNode: PathNode = {
      id: entrance.id,
      x: entrance.x,
      y: entrance.y,
      type: 'entrance',
      connectedTo: [...entrance.connectedNodeIds].filter((id) => nodeMap.has(id)),
      leadsTo: entrance.leadsTo,
      label: entrance.label,
    }
    nodes.push(entranceNode)

    // Connect grid nodes to this entrance
    for (const connectedId of entrance.connectedNodeIds) {
      const gridNode = nodeMap.get(connectedId)
      if (gridNode) {
        gridNode.connectedTo.push(entrance.id)
      }
    }
  }

  return nodes
}
