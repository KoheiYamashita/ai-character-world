import type { Character } from '@/types'
import { defaultSprite } from './sprites'

export const defaultCharacter: Character = {
  id: 'player',
  name: 'Alex',
  sprite: defaultSprite,
  money: 100,
  hunger: 100,
  currentMapId: 'town',
  currentNodeId: 'town-4-5',
  position: { x: 369, y: 300 },
  direction: 'down',
}

export function createCharacter(
  id: string,
  name: string,
  mapId: string = 'town',
  nodeId: string = 'town-center',
  position: { x: number; y: number } = { x: 400, y: 300 }
): Character {
  return {
    id,
    name,
    sprite: defaultSprite,
    money: 100,
    hunger: 100,
    currentMapId: mapId,
    currentNodeId: nodeId,
    position,
    direction: 'down',
  }
}
