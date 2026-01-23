import type { PathNode, Obstacle, WallSide, DoorConfig } from '@/types'
import { isConfigLoaded, getConfig } from '@/lib/worldConfigLoader'

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
  row: number // タイル行（グリッド範囲外も許容）
  col: number // タイル列（グリッド範囲外も許容）
  connectedNodeIds: string[]
  leadsTo: { mapId: string; nodeId: string }
  label: string
}

export interface TileToPixelConfig {
  cols: number
  rows: number
  width: number
  height: number
}

interface GridSpacing {
  x: number
  y: number
}

function getGridSpacing(gridConfig: TileToPixelConfig): GridSpacing {
  return {
    x: gridConfig.width / (gridConfig.cols + 1),
    y: gridConfig.height / (gridConfig.rows + 1),
  }
}

function tileToPixelPosition(row: number, col: number, spacing: GridSpacing): { x: number; y: number } {
  return {
    x: Math.round(spacing.x * (col + 1)),
    y: Math.round(spacing.y * (row + 1)),
  }
}

export function tileToPixelObstacle(
  obsConfig: { row: number; col: number; tileWidth: number; tileHeight: number },
  gridConfig: TileToPixelConfig
): { x: number; y: number; width: number; height: number } {
  const spacing = getGridSpacing(gridConfig)

  // row/col = 起点ノード位置（左上角）
  // ピクセル座標はそのノードの位置
  const x = spacing.x * (obsConfig.col + 1)
  const y = spacing.y * (obsConfig.row + 1)
  const pixelWidth = spacing.x * obsConfig.tileWidth
  const pixelHeight = spacing.y * obsConfig.tileHeight

  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(pixelWidth),
    height: Math.round(pixelHeight),
  }
}

export function tileToPixelEntrance(
  entranceConfig: { row: number; col: number },
  gridConfig: TileToPixelConfig
): { x: number; y: number } {
  const spacing = getGridSpacing(gridConfig)
  return tileToPixelPosition(entranceConfig.row, entranceConfig.col, spacing)
}

export function isPointInsideObstacle(x: number, y: number, obstacle: Obstacle): boolean {
  return (
    x >= obstacle.x &&
    x < obstacle.x + obstacle.width &&
    y >= obstacle.y &&
    y < obstacle.y + obstacle.height
  )
}

function isInsideAnyBuildingObstacle(x: number, y: number, obstacles: Obstacle[]): boolean {
  return obstacles
    .filter((obs) => obs.type === 'building')
    .some((obs) => (
      x >= obs.x &&
      x <= obs.x + obs.width &&
      y >= obs.y &&
      y <= obs.y + obs.height
    ))
}

interface WallGeometry {
  fixedPos: number      // Wall position on the fixed axis (Y for horizontal, X for vertical)
  rangeStart: number    // Start of wall range on the variable axis
  rangeEnd: number      // End of wall range on the variable axis
  tileSize: number      // Tile size along the wall
}

/**
 * Calculate wall geometry for a given side.
 * 壁はノード位置に直接描画（outset不要）
 */
function getWallGeometry(
  side: WallSide,
  x: number,
  y: number,
  width: number,
  height: number,
  tileSizeX: number,
  tileSizeY: number
): WallGeometry {
  switch (side) {
    case 'top':
      return { fixedPos: y, rangeStart: x, rangeEnd: x + width, tileSize: tileSizeX }
    case 'bottom':
      return { fixedPos: y + height, rangeStart: x, rangeEnd: x + width, tileSize: tileSizeX }
    case 'left':
      return { fixedPos: x, rangeStart: y, rangeEnd: y + height, tileSize: tileSizeY }
    case 'right':
      return { fixedPos: x + width, rangeStart: y, rangeEnd: y + height, tileSize: tileSizeY }
  }
}

function isHorizontalWall(side: WallSide): boolean {
  return side === 'top' || side === 'bottom'
}

/**
 * Check if an offset position along a wall edge is within the door opening.
 *
 * - offset is 0-indexed (first node on wall = 0)
 * - Opening is between start and end (exclusive: start < offset < end)
 * - Example: start=2, end=4 -> offset 0,1,2 are wall, offset 3 is opening, offset 4+ are wall
 */
function isOffsetInDoor(offset: number, side: WallSide, door: DoorConfig | undefined): boolean {
  if (!door || door.side !== side) return false
  return offset > door.start && offset < door.end
}

/**
 * Check if a node at (row, col) is inside a zone's boundary.
 * zone.tileRow/tileCol = 起点ノード位置
 * 内部ノード = 壁の内側（壁上は含まない）
 */
export function isNodeInsideZone(row: number, col: number, zone: Obstacle): boolean {
  return (
    row > zone.tileRow &&
    row < zone.tileRow + zone.tileHeight &&
    col > zone.tileCol &&
    col < zone.tileCol + zone.tileWidth
  )
}

/**
 * Check if a node at (row, col) is on the zone boundary (wall edge or door opening).
 * Returns the side(s) the node is on, or empty array if not on boundary.
 */
function getNodeBoundarySides(row: number, col: number, zone: Obstacle): WallSide[] {
  const sides: WallSide[] = []

  const topEdge = zone.tileRow
  const bottomEdge = zone.tileRow + zone.tileHeight
  const leftEdge = zone.tileCol
  const rightEdge = zone.tileCol + zone.tileWidth

  // Check if within zone's column range for top/bottom edges
  const inColRange = col > leftEdge && col < rightEdge
  // Check if within zone's row range for left/right edges
  const inRowRange = row > topEdge && row < bottomEdge

  if (row === topEdge && inColRange) sides.push('top')
  if (row === bottomEdge && inColRange) sides.push('bottom')
  if (col === leftEdge && inRowRange) sides.push('left')
  if (col === rightEdge && inRowRange) sides.push('right')

  return sides
}

/**
 * Check if a node at pixel position (x, y) is on a zone wall.
 * This is the source of truth - PixiAppSync.tsx renders all nodes returned by generateGridNodes.
 */
function isOnZoneWall(nodeX: number, nodeY: number, obstacles: Obstacle[]): boolean {
  const TOLERANCE = 2

  for (const obs of obstacles) {
    if (obs.type !== 'zone' || !obs.wallSides || obs.wallSides.length === 0) continue

    const { x, y, width, height, wallSides, door, tileWidth, tileHeight } = obs
    const tileSizeX = width / tileWidth
    const tileSizeY = height / tileHeight

    for (const side of wallSides) {
      const wall = getWallGeometry(side, x, y, width, height, tileSizeX, tileSizeY)
      const horizontal = isHorizontalWall(side)

      const fixedCoord = horizontal ? nodeY : nodeX
      const rangeCoord = horizontal ? nodeX : nodeY

      const onWallLine = Math.abs(fixedCoord - wall.fixedPos) < TOLERANCE
      const inWallRange = rangeCoord >= wall.rangeStart - TOLERANCE && rangeCoord <= wall.rangeEnd + TOLERANCE

      if (!onWallLine || !inWallRange) continue

      // Skip if in door opening
      if (door && door.side === side) {
        const offsetUnits = Math.round((rangeCoord - wall.rangeStart) / wall.tileSize)
        if (isOffsetInDoor(offsetUnits, side, door)) continue
      }

      return true
    }
  }
  return false
}

/**
 * Check if a node is completely outside a zone (not inside and not on boundary).
 */
function isNodeCompletelyOutside(row: number, col: number, zone: Obstacle): boolean {
  const topEdge = zone.tileRow
  const bottomEdge = zone.tileRow + zone.tileHeight
  const leftEdge = zone.tileCol
  const rightEdge = zone.tileCol + zone.tileWidth

  return row < topEdge || row > bottomEdge || col < leftEdge || col > rightEdge
}

/**
 * Check if a connection between two nodes crosses a zone wall (and not through a door).
 * Returns true if the connection should be blocked.
 * zone.tileRow/tileCol = 起点ノード位置
 */
function connectionCrossesZoneWall(
  fromRow: number,
  fromCol: number,
  toRow: number,
  toCol: number,
  zone: Obstacle
): boolean {
  if (!zone.wallSides || zone.wallSides.length === 0) return false

  const fromInside = isNodeInsideZone(fromRow, fromCol, zone)
  const toInside = isNodeInsideZone(toRow, toCol, zone)

  // Check if connection is diagonal
  const isDiagonal = fromRow !== toRow && fromCol !== toCol

  // Check boundary status for both nodes
  const fromBoundary = getNodeBoundarySides(fromRow, fromCol, zone)
  const toBoundary = getNodeBoundarySides(toRow, toCol, zone)

  // Special case: diagonal connections from/to door opening
  // If one node is on a boundary (including door opening) and the other is completely outside,
  // diagonal connections should be blocked as they cross the wall
  if (isDiagonal) {
    const fromOnBoundary = fromBoundary.length > 0
    const toOnBoundary = toBoundary.length > 0
    const fromOutside = isNodeCompletelyOutside(fromRow, fromCol, zone)
    const toOutside = isNodeCompletelyOutside(toRow, toCol, zone)

    // Block diagonal from boundary to completely outside (or vice versa)
    if ((fromOnBoundary && toOutside) || (toOnBoundary && fromOutside)) {
      // Check if the wall on the crossed side exists
      for (const side of fromOnBoundary ? fromBoundary : toBoundary) {
        if (zone.wallSides?.includes(side)) {
          return true
        }
      }
    }
  }

  // Both inside or both outside (and not boundary case): no wall crossing
  if (fromInside === toInside) return false

  // One inside, one outside: determine which wall is crossed
  const [insideRow, insideCol] = fromInside ? [fromRow, fromCol] : [toRow, toCol]
  const [outsideRow, outsideCol] = fromInside ? [toRow, toCol] : [fromRow, fromCol]

  // Zone edges (起点ベース)
  const topEdge = zone.tileRow
  const bottomEdge = zone.tileRow + zone.tileHeight
  const leftEdge = zone.tileCol
  const rightEdge = zone.tileCol + zone.tileWidth

  // Door offset calculation: 0-indexed from zone origin
  // Top wall: outside node is above the zone's top edge
  if (outsideRow <= topEdge && zone.wallSides?.includes('top')) {
    const offset = insideCol - zone.tileCol
    if (!isOffsetInDoor(offset, 'top', zone.door)) return true
  }

  // Bottom wall: outside node is below the zone's bottom edge
  if (outsideRow >= bottomEdge && zone.wallSides?.includes('bottom')) {
    const offset = insideCol - zone.tileCol
    if (!isOffsetInDoor(offset, 'bottom', zone.door)) return true
  }

  // Left wall: outside node is to the left of the zone's left edge
  if (outsideCol <= leftEdge && zone.wallSides?.includes('left')) {
    const offset = insideRow - zone.tileRow
    if (!isOffsetInDoor(offset, 'left', zone.door)) return true
  }

  // Right wall: outside node is to the right of the zone's right edge
  if (outsideCol >= rightEdge && zone.wallSides?.includes('right')) {
    const offset = insideRow - zone.tileRow
    if (!isOffsetInDoor(offset, 'right', zone.door)) return true
  }

  return false
}

/**
 * Filter connections that cross zone walls (respecting doors).
 */
function filterConnectionsByZoneWalls(
  connections: string[],
  fromRow: number,
  fromCol: number,
  prefix: string,
  zones: Obstacle[]
): string[] {
  return connections.filter((connId) => {
    const parts = connId.split('-')
    if (parts.length < 3 || parts[0] !== prefix) return true

    const toRow = parseInt(parts[1], 10)
    const toCol = parseInt(parts[2], 10)
    if (isNaN(toRow) || isNaN(toCol)) return true

    // Check if any zone wall blocks this connection
    for (const zone of zones) {
      if (connectionCrossesZoneWall(fromRow, fromCol, toRow, toCol, zone)) {
        return false
      }
    }
    return true
  })
}

// Defaults matching world-config.json
const FALLBACK_DEFAULTS = {
  cols: 12,
  rows: 9,
  width: 800,
  height: 600,
}

interface GridDefaults {
  cols: number
  rows: number
  width: number
  height: number
}

export function getGridDefaults(): GridDefaults {
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

  // Separate obstacles by type
  const zones = obstacles.filter((obs) => obs.type === 'zone')

  const nodes: PathNode[] = []
  const nodeMap = new Map<string, PathNode>()
  const nodeRowColMap = new Map<string, { row: number; col: number }>()

  // Generate grid nodes, skipping those inside building obstacles (zones allow nodes)
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = Math.round(spacingX * (col + 1))
      const y = Math.round(spacingY * (row + 1))

      // Skip nodes inside building obstacles (not zones)
      if (isInsideAnyBuildingObstacle(x, y, obstacles)) {
        continue
      }

      // Skip nodes on zone walls (unless in door opening)
      if (isOnZoneWall(x, y, obstacles)) {
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
      nodeRowColMap.set(id, { row, col })
    }
  }

  // Filter connections:
  // 1. Only include nodes that exist
  // 2. Remove connections that cross zone walls (unless through doors)
  for (const node of nodes) {
    const coords = nodeRowColMap.get(node.id)
    if (!coords) continue

    node.connectedTo = node.connectedTo.filter((id) => nodeMap.has(id))
    node.connectedTo = filterConnectionsByZoneWalls(
      node.connectedTo,
      coords.row,
      coords.col,
      prefix,
      zones
    )
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
  const gridConfigForConversion: TileToPixelConfig = { cols, rows, width, height }
  for (const entrance of entrances) {
    const { x, y } = tileToPixelEntrance(entrance, gridConfigForConversion)
    const entranceNode: PathNode = {
      id: entrance.id,
      x,
      y,
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
