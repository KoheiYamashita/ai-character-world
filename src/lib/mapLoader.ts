import type { GameMap, MapConfigJson, MapsDataJson, Obstacle, ObstacleConfigJson } from '@/types'
import type { NodeLabel, TileToPixelConfig } from '@/data/maps/grid'
import { generateGridNodes, isPointInsideObstacle, tileToPixelObstacle, getGridDefaults } from '@/data/maps/grid'
import { isConfigLoaded, getConfig, parseColor } from './gameConfigLoader'

const DEFAULT_MAPS_PATH = '/data/maps.json'

// Minimum obstacle size in tiles
const MIN_OBSTACLE_SIZE = 2

function isValidNumber(value: unknown): value is number {
  return typeof value === 'number' && !isNaN(value) && isFinite(value)
}

function validateObstacleFields(mapId: string, obstacles: ObstacleConfigJson[]): void {
  const invalid: string[] = []

  obstacles.forEach((obs, i) => {
    const name = obs.label ?? `obstacle[${i}]`
    const missing: string[] = []

    if (!isValidNumber(obs.row)) missing.push('row')
    if (!isValidNumber(obs.col)) missing.push('col')
    if (!isValidNumber(obs.tileWidth)) missing.push('tileWidth')
    if (!isValidNumber(obs.tileHeight)) missing.push('tileHeight')

    if (missing.length > 0) {
      invalid.push(`  - "${name}": missing/invalid fields: ${missing.join(', ')}`)
    }
  })

  if (invalid.length > 0) {
    throw new Error(`Map "${mapId}" has obstacles with invalid fields:\n${invalid.join('\n')}`)
  }
}

function validateObstacleMinSize(mapId: string, obstacles: ObstacleConfigJson[]): void {
  const undersized = obstacles.filter(
    (obs) => obs.tileWidth < MIN_OBSTACLE_SIZE || obs.tileHeight < MIN_OBSTACLE_SIZE
  )

  if (undersized.length > 0) {
    const details = undersized
      .map((obs) => `  - "${obs.label ?? 'unnamed'}" (${obs.tileWidth}x${obs.tileHeight})`)
      .join('\n')
    throw new Error(
      `Map "${mapId}" has undersized obstacles (minimum: ${MIN_OBSTACLE_SIZE}x${MIN_OBSTACLE_SIZE}):\n${details}`
    )
  }
}

interface GridCoordinate {
  row: number
  col: number
}

function parseNodeIdToGridCoord(nodeId: string, gridPrefix: string): GridCoordinate | null {
  const parts = nodeId.split('-')
  if (parts.length < 3 || parts[0] !== gridPrefix) return null

  const row = parseInt(parts[1], 10)
  const col = parseInt(parts[2], 10)

  if (isNaN(row) || isNaN(col)) return null
  return { row, col }
}

function gridCoordToPixel(
  coord: GridCoordinate,
  width: number,
  height: number,
  cols: number,
  rows: number
): { x: number; y: number } {
  const spacingX = width / (cols + 1)
  const spacingY = height / (rows + 1)
  return {
    x: Math.round(spacingX * (coord.col + 1)),
    y: Math.round(spacingY * (coord.row + 1)),
  }
}

function findObstacleContainingPoint(x: number, y: number, obstacles: Obstacle[]): Obstacle | undefined {
  return obstacles.find((obs) => isPointInsideObstacle(x, y, obs))
}

function validateLabelObstacleConflicts(
  mapId: string,
  labels: NodeLabel[],
  obstacles: Obstacle[],
  gridPrefix: string,
  cols: number,
  rows: number,
  width: number,
  height: number
): void {
  if (labels.length === 0 || obstacles.length === 0) return

  const conflicts: string[] = []

  for (const label of labels) {
    const coord = parseNodeIdToGridCoord(label.nodeId, gridPrefix)
    if (!coord) continue

    const { x, y } = gridCoordToPixel(coord, width, height, cols, rows)
    const obstacle = findObstacleContainingPoint(x, y, obstacles)

    if (obstacle) {
      conflicts.push(
        `  - Label "${label.label}" (${label.nodeId}) at (${x}, ${y}) is inside obstacle "${obstacle.label ?? obstacle.id}" at (${obstacle.x}, ${obstacle.y}, ${obstacle.width}x${obstacle.height})`
      )
    }
  }

  if (conflicts.length > 0) {
    throw new Error(
      `Map "${mapId}" has label-obstacle conflicts:\n${conflicts.join('\n')}\n` +
      `Please adjust obstacle positions or move labels to different nodes.`
    )
  }
}

let cachedMaps: Record<string, GameMap> | null = null

export async function loadMapConfigs(): Promise<MapConfigJson[]> {
  const mapsPath = isConfigLoaded() ? getConfig().paths.mapsJson : DEFAULT_MAPS_PATH
  const response = await fetch(mapsPath)
  if (!response.ok) {
    throw new Error(`Failed to load map configs: ${response.status} ${response.statusText}`)
  }
  const data: MapsDataJson = await response.json()
  return data.maps
}

export function buildMapFromConfig(config: MapConfigJson): GameMap {
  const defaults = getGridDefaults()
  const cols = config.grid.cols ?? defaults.cols
  const rows = config.grid.rows ?? defaults.rows

  // Validate obstacle fields (row, col, tileWidth, tileHeight must be valid numbers)
  validateObstacleFields(config.id, config.obstacles ?? [])

  // Validate minimum obstacle size
  validateObstacleMinSize(config.id, config.obstacles ?? [])

  // Convert obstacle configs from tile coordinates to pixel coordinates
  const gridConfigForConversion: TileToPixelConfig = {
    cols,
    rows,
    width: config.width,
    height: config.height,
  }
  const obstacles: Obstacle[] = (config.obstacles ?? []).map((obs, index) => {
    const pixelCoords = tileToPixelObstacle(obs, gridConfigForConversion)
    return {
      id: obs.id ?? `${config.id}-obstacle-${index}`,
      x: pixelCoords.x,
      y: pixelCoords.y,
      width: pixelCoords.width,
      height: pixelCoords.height,
      label: obs.label,
    }
  })

  // Validate that no labeled nodes fall inside obstacles
  validateLabelObstacleConflicts(
    config.id,
    config.labels ?? [],
    obstacles,
    config.grid.prefix,
    cols,
    rows,
    config.width,
    config.height
  )

  const nodes = generateGridNodes(
    {
      prefix: config.grid.prefix,
      cols: config.grid.cols,
      rows: config.grid.rows,
      width: config.width,
      height: config.height,
    },
    config.labels,
    config.entrances,
    obstacles
  )

  return {
    id: config.id,
    name: config.name,
    width: config.width,
    height: config.height,
    backgroundColor: parseColor(config.backgroundColor),
    spawnNodeId: config.spawnNodeId,
    nodes,
    obstacles,
  }
}

export async function loadMaps(): Promise<Record<string, GameMap>> {
  if (cachedMaps) {
    return cachedMaps
  }

  const configs = await loadMapConfigs()
  const mapsRecord: Record<string, GameMap> = {}

  for (const config of configs) {
    mapsRecord[config.id] = buildMapFromConfig(config)
  }

  cachedMaps = mapsRecord
  return cachedMaps
}

export function clearMapCache(): void {
  cachedMaps = null
}

export function getCachedMaps(): Record<string, GameMap> {
  if (!cachedMaps) {
    throw new Error('Maps not loaded. Call loadMaps() first.')
  }
  return cachedMaps
}

export function isMapsLoaded(): boolean {
  return cachedMaps !== null
}
