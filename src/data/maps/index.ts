import type { GameMap } from '@/types'
import { townMap } from './town'
import { homeMap } from './home'
import { cafeMap } from './cafe'

export const maps: Record<string, GameMap> = {
  town: townMap,
  home: homeMap,
  cafe: cafeMap,
}

export function getMap(mapId: string): GameMap | undefined {
  return maps[mapId]
}

export function getNode(mapId: string, nodeId: string) {
  const map = getMap(mapId)
  return map?.nodes.find((n) => n.id === nodeId)
}

export { townMap, homeMap, cafeMap }
