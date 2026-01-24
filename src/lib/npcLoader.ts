import type { NPC, NPCConfigJson, Position, WorldMap } from '@/types'

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
    // プロフィール
    personality: config.personality,
    tendencies: config.tendencies,
    customPrompt: config.customPrompt,
    facts: config.facts,
    // 動的ステータス（初期値）
    affinity: 0,
    mood: 'neutral',
    conversationCount: 0,
    lastConversation: null,
  }
}

export function loadNPCsFromMapConfig(
  mapId: string,
  npcConfigs: NPCConfigJson[],
  map: WorldMap
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
