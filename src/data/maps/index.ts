import type { WorldMap } from '@/types'
import {
  loadMaps as loadMapsFromLoader,
  clearMapCache as clearLoaderCache,
  getCachedMaps,
  isMapsLoaded as checkMapsLoaded,
} from '@/lib/mapLoader'

// Re-export async loader (mapLoader handles caching)
export async function loadMaps(): Promise<Record<string, WorldMap>> {
  return loadMapsFromLoader()
}

// Synchronous getter for already-loaded maps
export function getMaps(): Record<string, WorldMap> {
  return getCachedMaps()
}

export function isMapsLoaded(): boolean {
  return checkMapsLoaded()
}

export function clearMapsCache(): void {
  clearLoaderCache()
}

export function getMap(mapId: string): WorldMap | undefined {
  return getMaps()[mapId]
}

export function getNode(mapId: string, nodeId: string) {
  const map = getMap(mapId)
  return map?.nodes.find((n) => n.id === nodeId)
}
