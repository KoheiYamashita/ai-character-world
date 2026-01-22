import type { CharacterConfig, CharactersData, Character, Position } from '@/types'
import { isConfigLoaded, getConfig } from './worldConfigLoader'

const DEFAULT_CHARACTERS_PATH = '/data/characters.json'

let cachedConfigs: CharacterConfig[] | null = null

export async function loadCharacterConfigs(): Promise<CharacterConfig[]> {
  if (cachedConfigs) {
    return cachedConfigs
  }

  const charactersPath = isConfigLoaded() ? getConfig().paths.charactersJson : DEFAULT_CHARACTERS_PATH
  const response = await fetch(charactersPath)
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
    satiety: config.defaultStats.satiety,
    energy: config.defaultStats.energy,
    hygiene: config.defaultStats.hygiene,
    mood: config.defaultStats.mood,
    bladder: config.defaultStats.bladder,
    currentMapId: mapId,
    currentNodeId: nodeId,
    position,
    direction: 'down',
    employment: config.employment,
    // LLM行動決定用のプロファイル情報 (docs/llm-behavior-system.md:144-150)
    personality: config.personality,
    tendencies: config.tendencies,
    customPrompt: config.customPrompt,
  }
}
