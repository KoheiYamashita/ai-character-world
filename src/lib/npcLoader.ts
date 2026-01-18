import type { NPC, NPCConfigJson, Position, GameMap } from '@/types'

export function createNPCFromConfig(
  config: NPCConfigJson,
  mapId: string,
  spawnPosition: Position
): NPC {
  return {
    id: config.id,
    name: config.name,
    sprite: config.sprite,
    mapId,
    currentNodeId: config.spawnNodeId,
    position: spawnPosition,
    direction: 'down',
  }
}

export function loadNPCsFromMapConfig(
  mapId: string,
  npcConfigs: NPCConfigJson[],
  map: GameMap
): NPC[] {
  if (!map) {
    console.warn(`Map "${mapId}" not found when loading NPCs`)
    return []
  }

  const npcs: NPC[] = []

  for (const config of npcConfigs) {
    const spawnNode = map.nodes.find((n) => n.id === config.spawnNodeId)
    if (!spawnNode) {
      console.warn(
        `Spawn node "${config.spawnNodeId}" not found for NPC "${config.id}" in map "${mapId}"`
      )
      continue
    }

    const npc = createNPCFromConfig(config, mapId, {
      x: spawnNode.x,
      y: spawnNode.y,
    })
    npcs.push(npc)
  }

  return npcs
}

export function validateNPCConfig(config: NPCConfigJson, mapId: string): string[] {
  const errors: string[] = []

  if (!config.id) {
    errors.push(`NPC in map "${mapId}" is missing required field: id`)
  }
  if (!config.name) {
    errors.push(`NPC "${config.id}" in map "${mapId}" is missing required field: name`)
  }
  if (!config.sprite) {
    errors.push(`NPC "${config.id}" in map "${mapId}" is missing required field: sprite`)
  }
  if (!config.spawnNodeId) {
    errors.push(`NPC "${config.id}" in map "${mapId}" is missing required field: spawnNodeId`)
  }

  return errors
}
