import type { GameMap } from '@/types'
import { loadMaps as loadMapsFromJson } from '@/lib/mapLoader'

// Mutable reference updated after JSON loading
let mapsRef: Record<string, GameMap> | null = null

// Async loader that fetches from JSON and caches result
export async function loadMaps(): Promise<Record<string, GameMap>> {
  if (mapsRef) {
    return mapsRef
  }
  const loadedMaps = await loadMapsFromJson()
  mapsRef = loadedMaps
  return loadedMaps
}

// Getter that returns loaded maps (throws if not loaded)
export function getMaps(): Record<string, GameMap> {
  if (!mapsRef) {
    throw new Error('Maps not loaded. Call loadMaps() first.')
  }
  return mapsRef
}

export function isMapsLoaded(): boolean {
  return mapsRef !== null
}

export function getMap(mapId: string): GameMap | undefined {
  return getMaps()[mapId]
}

export function getNode(mapId: string, nodeId: string) {
  const map = getMap(mapId)
  return map?.nodes.find((n) => n.id === nodeId)
}
