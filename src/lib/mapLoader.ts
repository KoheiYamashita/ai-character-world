import type { GameMap, MapConfigJson, MapsDataJson, Obstacle, ObstacleConfigJson, NPCConfigJson } from '@/types'
import type { NodeLabel, TileToPixelConfig } from '@/data/maps/grid'
import { generateGridNodes, isPointInsideObstacle, tileToPixelObstacle, getGridDefaults } from '@/data/maps/grid'
import { isConfigLoaded, getConfig, parseColor } from './gameConfigLoader'

const DEFAULT_MAPS_PATH = '/data/maps.json'

// Minimum obstacle size in tiles
const MIN_BUILDING_SIZE = 2
const MIN_ZONE_SIZE = 4

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
  const undersized: string[] = []

  for (const obs of obstacles) {
    const type = obs.type ?? 'building'
    const minSize = type === 'zone' ? MIN_ZONE_SIZE : MIN_BUILDING_SIZE

    if (obs.tileWidth < minSize || obs.tileHeight < minSize) {
      undersized.push(
        `  - "${obs.label ?? 'unnamed'}" (${type}: ${obs.tileWidth}x${obs.tileHeight}, minimum: ${minSize}x${minSize})`
      )
    }
  }

  if (undersized.length > 0) {
    throw new Error(
      `Map "${mapId}" has undersized obstacles:\n${undersized.join('\n')}`
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
  // Only check against building-type obstacles (zones allow nodes inside)
  const buildingObstacles = obstacles.filter((obs) => obs.type === 'building')
  if (labels.length === 0 || buildingObstacles.length === 0) return

  const conflicts: string[] = []

  for (const label of labels) {
    const coord = parseNodeIdToGridCoord(label.nodeId, gridPrefix)
    if (!coord) continue

    const { x, y } = gridCoordToPixel(coord, width, height, cols, rows)
    const obstacle = findObstacleContainingPoint(x, y, buildingObstacles)

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
      type: obs.type ?? 'building',
      wallSides: obs.wallSides,
      door: obs.door,
      // Preserve tile coordinates for wall collision calculations
      tileRow: obs.row,
      tileCol: obs.col,
      tileWidth: obs.tileWidth,
      tileHeight: obs.tileHeight,
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
    // Ensure NPC configs are also cached (might be cleared on HMR)
    if (!cachedMapConfigs) {
      cachedMapConfigs = await loadMapConfigs()
    }
    return cachedMaps
  }

  const configs = await loadMapConfigs()
  cachedMapConfigs = configs  // Cache configs for NPC loading
  const mapsRecord: Record<string, GameMap> = {}

  for (const config of configs) {
    mapsRecord[config.id] = buildMapFromConfig(config)
  }

  cachedMaps = mapsRecord
  return cachedMaps
}

export function clearMapCache(): void {
  cachedMaps = null
  cachedMapConfigs = null
}

export function getCachedMaps(): Record<string, GameMap> {
  if (!cachedMaps) {
    console.warn('Maps not loaded yet')
    return {}
  }
  return cachedMaps
}

export function isMapsLoaded(): boolean {
  return cachedMaps !== null
}

// NPC configs cache (separate from map cache since we need raw configs)
let cachedMapConfigs: MapConfigJson[] | null = null

export async function loadMapConfigsWithCache(): Promise<MapConfigJson[]> {
  if (cachedMapConfigs) {
    return cachedMapConfigs
  }
  cachedMapConfigs = await loadMapConfigs()
  return cachedMapConfigs
}

export function getNPCConfigsForMap(mapId: string): NPCConfigJson[] {
  if (!cachedMapConfigs) {
    return []
  }
  const mapConfig = cachedMapConfigs.find((m) => m.id === mapId)
  return mapConfig?.npcs ?? []
}

export function getAllNPCConfigs(): { mapId: string; npcs: NPCConfigJson[] }[] {
  if (!cachedMapConfigs) {
    return []
  }
  return cachedMapConfigs
    .filter((m) => m.npcs && m.npcs.length > 0)
    .map((m) => ({ mapId: m.id, npcs: m.npcs! }))
}

export function clearMapConfigCache(): void {
  cachedMapConfigs = null
}
