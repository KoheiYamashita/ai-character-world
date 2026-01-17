import type { GameMap, MapConfigJson, MapsDataJson, Obstacle } from '@/types'
import type { NodeLabel } from '@/data/maps/grid'
import { generateGridNodes, isPointInsideObstacle } from '@/data/maps/grid'
import { isConfigLoaded, getConfig, parseColor } from './gameConfigLoader'

const DEFAULT_MAPS_PATH = '/data/maps.json'

// Default grid dimensions matching game-config.json
const DEFAULT_COLS = 12
const DEFAULT_ROWS = 9

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

  const spacingX = width / (cols + 1)
  const spacingY = height / (rows + 1)

  const conflicts: string[] = []

  for (const label of labels) {
    // Parse nodeId to get row and col (format: prefix-row-col)
    const parts = label.nodeId.split('-')
    if (parts.length < 3 || parts[0] !== gridPrefix) continue

    const row = parseInt(parts[1], 10)
    const col = parseInt(parts[2], 10)
    if (isNaN(row) || isNaN(col)) continue

    const x = Math.round(spacingX * (col + 1))
    const y = Math.round(spacingY * (row + 1))

    for (const obstacle of obstacles) {
      if (isPointInsideObstacle(x, y, obstacle)) {
        conflicts.push(
          `  - Label "${label.label}" (${label.nodeId}) at (${x}, ${y}) is inside obstacle "${obstacle.label ?? obstacle.id}" at (${obstacle.x}, ${obstacle.y}, ${obstacle.width}x${obstacle.height})`
        )
        break
      }
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
  // Convert obstacle configs to obstacles with generated IDs
  const obstacles: Obstacle[] = (config.obstacles ?? []).map((obs, index) => ({
    id: obs.id ?? `${config.id}-obstacle-${index}`,
    x: obs.x,
    y: obs.y,
    width: obs.width,
    height: obs.height,
    label: obs.label,
  }))

  const cols = config.grid.cols ?? DEFAULT_COLS
  const rows = config.grid.rows ?? DEFAULT_ROWS

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
