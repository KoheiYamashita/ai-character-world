import type { CharacterConfig, CharactersData, Character, Position } from '@/types'

let cachedConfigs: CharacterConfig[] | null = null

export async function loadCharacterConfigs(): Promise<CharacterConfig[]> {
  if (cachedConfigs) {
    return cachedConfigs
  }

  const response = await fetch('/data/characters.json')
  if (!response.ok) {
    throw new Error(`Failed to load character configs: ${response.status} ${response.statusText}`)
  }
  const data: CharactersData = await response.json()
  cachedConfigs = data.characters
  return cachedConfigs
}

export function createCharacterFromConfig(
  config: CharacterConfig,
  mapId: string,
  nodeId: string,
  position: Position
): Character {
  return {
    id: config.id,
    name: config.name,
    sprite: config.sprite,
    money: config.defaultStats.money,
    hunger: config.defaultStats.hunger,
    currentMapId: mapId,
    currentNodeId: nodeId,
    position,
    direction: 'down',
  }
}
