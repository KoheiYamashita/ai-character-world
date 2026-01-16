import type { GameMap, MapConfigJson, MapsDataJson } from '@/types'
import { generateGridNodes } from '@/data/maps/grid'
import { isConfigLoaded, getConfig, parseColor } from './gameConfigLoader'

const DEFAULT_MAPS_PATH = '/data/maps.json'

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
  const nodes = generateGridNodes(
    {
      prefix: config.grid.prefix,
      cols: config.grid.cols,
      rows: config.grid.rows,
      width: config.width,
      height: config.height,
    },
    config.labels,
    config.entrances
  )

  return {
    id: config.id,
    name: config.name,
    width: config.width,
    height: config.height,
    backgroundColor: parseColor(config.backgroundColor),
    spawnNodeId: config.spawnNodeId,
    nodes,
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
