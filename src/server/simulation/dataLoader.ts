import { promises as fs } from 'fs'
import path from 'path'
import type {
  WorldMap,
  Character,
  WorldConfig,
  MapConfigJson,
  MapsDataJson,
  CharacterConfig,
  CharactersData,
  Obstacle,
  PathNode,
  NPC,
  ScheduleEntry,
} from '@/types'
import { createNPCFromConfig } from '@/lib/npcLoader'
import type { TileToPixelConfig, NodeLabel, EntranceConfig } from '@/data/maps/grid'
import { tileToPixelObstacle, tileToPixelEntrance } from '@/data/maps/grid'

// Get the path to public directory
function getPublicPath(): string {
  // In development and production, public files are at project root/public
  return path.join(process.cwd(), 'public')
}

// Parse color string to number
function parseColor(colorStr: string): number {
  if (colorStr.startsWith('0x')) {
    return parseInt(colorStr, 16)
  }
  return parseInt(colorStr.replace('#', ''), 16)
}

// Load world config
export async function loadWorldConfigServer(): Promise<WorldConfig> {
  const configPath = path.join(getPublicPath(), 'data', 'world-config.json')
  const content = await fs.readFile(configPath, 'utf-8')
  return JSON.parse(content)
}

// Generate grid nodes (server-side version that doesn't depend on cached config)
function generateGridNodesServer(
  config: {
    prefix: string
    cols: number
    rows: number
    width: number
    height: number
  },
  labels: NodeLabel[] = [],
  entrances: EntranceConfig[] = [],
  obstacles: Obstacle[] = []
): PathNode[] {
  const { prefix, cols, rows, width, height } = config

  const spacingX = width / (cols + 1)
  const spacingY = height / (rows + 1)

  const nodes: PathNode[] = []
  const nodeMap = new Map<string, PathNode>()

  // Helper functions
  const getNodeId = (row: number, col: number): string => `${prefix}-${row}-${col}`

  const isInsideBuildingObstacle = (x: number, y: number): boolean => {
    return obstacles
      .filter((obs) => obs.type === 'building')
      .some((obstacle) =>
        x >= obstacle.x &&
        x <= obstacle.x + obstacle.width &&
        y >= obstacle.y &&
        y <= obstacle.y + obstacle.height
      )
  }

  const isOnZoneWall = (nodeX: number, nodeY: number): boolean => {
    const TOLERANCE = 2

    for (const obs of obstacles) {
      if (obs.type !== 'zone' || !obs.wallSides || obs.wallSides.length === 0) continue

      const { x, y, width: obsW, height: obsH, wallSides, door, tileWidth, tileHeight } = obs
      const tileSizeX = obsW / tileWidth
      const tileSizeY = obsH / tileHeight

      for (const side of wallSides) {
        const outsetX = tileSizeX / 2
        const outsetY = tileSizeY / 2

        let fixedPos: number
        let rangeStart: number
        let rangeEnd: number
        let tileSize: number
        let isHorizontal: boolean

        switch (side) {
          case 'top':
            fixedPos = y - outsetY
            rangeStart = x - outsetX
            rangeEnd = x + obsW + outsetX
            tileSize = tileSizeX
            isHorizontal = true
            break
          case 'bottom':
            fixedPos = y + obsH + outsetY
            rangeStart = x - outsetX
            rangeEnd = x + obsW + outsetX
            tileSize = tileSizeX
            isHorizontal = true
            break
          case 'left':
            fixedPos = x - outsetX
            rangeStart = y - outsetY
            rangeEnd = y + obsH + outsetY
            tileSize = tileSizeY
            isHorizontal = false
            break
          case 'right':
            fixedPos = x + obsW + outsetX
            rangeStart = y - outsetY
            rangeEnd = y + obsH + outsetY
            tileSize = tileSizeY
            isHorizontal = false
            break
        }

        const fixedCoord = isHorizontal ? nodeY : nodeX
        const rangeCoord = isHorizontal ? nodeX : nodeY

        const onWallLine = Math.abs(fixedCoord - fixedPos) < TOLERANCE
        const inWallRange = rangeCoord >= rangeStart - TOLERANCE && rangeCoord <= rangeEnd + TOLERANCE

        if (!onWallLine || !inWallRange) continue

        // Skip if in door opening
        if (door && door.side === side) {
          const offsetUnits = Math.round((rangeCoord - rangeStart) / tileSize)
          if (offsetUnits > door.start && offsetUnits < door.end) continue
        }

        return true
      }
    }
    return false
  }

  const generateConnections = (row: number, col: number): string[] => {
    const connections: string[] = []

    // Cardinal directions
    if (col > 0) connections.push(getNodeId(row, col - 1))
    if (col < cols - 1) connections.push(getNodeId(row, col + 1))
    if (row > 0) connections.push(getNodeId(row - 1, col))
    if (row < rows - 1) connections.push(getNodeId(row + 1, col))

    // Diagonal directions
    if (row > 0 && col > 0) connections.push(getNodeId(row - 1, col - 1))
    if (row > 0 && col < cols - 1) connections.push(getNodeId(row - 1, col + 1))
    if (row < rows - 1 && col > 0) connections.push(getNodeId(row + 1, col - 1))
    if (row < rows - 1 && col < cols - 1) connections.push(getNodeId(row + 1, col + 1))

    return connections
  }

  // Generate grid nodes
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = Math.round(spacingX * (col + 1))
      const y = Math.round(spacingY * (row + 1))

      if (isInsideBuildingObstacle(x, y)) continue
      if (isOnZoneWall(x, y)) continue

      const id = getNodeId(row, col)
      const node: PathNode = {
        id,
        x,
        y,
        type: 'waypoint',
        connectedTo: generateConnections(row, col),
      }
      nodes.push(node)
      nodeMap.set(id, node)
    }
  }

  // Filter connections to only include existing nodes
  for (const node of nodes) {
    node.connectedTo = node.connectedTo.filter((id) => nodeMap.has(id))
  }

  // Apply labels
  for (const { nodeId, label } of labels) {
    const node = nodeMap.get(nodeId)
    if (node) {
      node.label = label
    }
  }

  // Add entrance nodes
  const gridConfigForConversion: TileToPixelConfig = { cols, rows, width, height }
  for (const entrance of entrances) {
    const { x, y } = tileToPixelEntrance(entrance, gridConfigForConversion)
    const entranceNode: PathNode = {
      id: entrance.id,
      x,
      y,
      type: 'entrance',
      connectedTo: [...entrance.connectedNodeIds].filter((id) => nodeMap.has(id)),
      leadsTo: entrance.leadsTo,
      label: entrance.label,
    }
    nodes.push(entranceNode)

    // Connect grid nodes to this entrance
    for (const connectedId of entrance.connectedNodeIds) {
      const gridNode = nodeMap.get(connectedId)
      if (gridNode) {
        gridNode.connectedTo.push(entrance.id)
      }
    }
  }

  return nodes
}

// Load and process maps
export async function loadMapsServer(config?: WorldConfig): Promise<Record<string, WorldMap>> {
  const cfg = config ?? (await loadWorldConfigServer())
  const mapsPath = path.join(getPublicPath(), cfg.paths.mapsJson.replace(/^\//, ''))
  const content = await fs.readFile(mapsPath, 'utf-8')
  const mapsData: MapsDataJson = JSON.parse(content)

  const maps: Record<string, WorldMap> = {}

  for (const mapConfig of mapsData.maps) {
    maps[mapConfig.id] = buildMapFromConfigServer(mapConfig, cfg)
  }

  return maps
}

// Build map from config (server-side version)
function buildMapFromConfigServer(mapConfig: MapConfigJson, config: WorldConfig): WorldMap {
  const gridDefaults = config.grid
  const cols = mapConfig.grid.cols ?? gridDefaults.defaultCols
  const rows = mapConfig.grid.rows ?? gridDefaults.defaultRows

  const gridConfigForConversion: TileToPixelConfig = {
    cols,
    rows,
    width: mapConfig.width,
    height: mapConfig.height,
  }

  // Convert obstacles from tile coordinates to pixel coordinates
  const obstacles: Obstacle[] = (mapConfig.obstacles ?? []).map((obs, index) => {
    const pixelCoords = tileToPixelObstacle(obs, gridConfigForConversion)
    return {
      id: obs.id ?? `${mapConfig.id}-obstacle-${index}`,
      x: pixelCoords.x,
      y: pixelCoords.y,
      width: pixelCoords.width,
      height: pixelCoords.height,
      label: obs.label,
      type: obs.type ?? 'building',
      wallSides: obs.wallSides,
      door: obs.door,
      facility: obs.facility,
      tileRow: obs.row,
      tileCol: obs.col,
      tileWidth: obs.tileWidth,
      tileHeight: obs.tileHeight,
    }
  })

  // Generate nodes
  const nodes = generateGridNodesServer(
    {
      prefix: mapConfig.grid.prefix,
      cols,
      rows,
      width: mapConfig.width,
      height: mapConfig.height,
    },
    mapConfig.labels as NodeLabel[],
    mapConfig.entrances as EntranceConfig[],
    obstacles
  )

  // Mark spawn node type from spawnNodeId
  const spawnNode = nodes.find((n) => n.id === mapConfig.spawnNodeId)
  if (spawnNode) {
    spawnNode.type = 'spawn'
  }

  return {
    id: mapConfig.id,
    name: mapConfig.name,
    width: mapConfig.width,
    height: mapConfig.height,
    backgroundColor: parseColor(mapConfig.backgroundColor),
    spawnNodeId: mapConfig.spawnNodeId,
    nodes,
    obstacles,
  }
}

// Load characters
export async function loadCharactersServer(config?: WorldConfig): Promise<Character[]> {
  const cfg = config ?? (await loadWorldConfigServer())
  const charactersPath = path.join(getPublicPath(), cfg.paths.charactersJson.replace(/^\//, ''))
  const content = await fs.readFile(charactersPath, 'utf-8')
  const charactersData: CharactersData = JSON.parse(content)

  // Get initial map and spawn position
  const maps = await loadMapsServer(cfg)
  const initialMap = maps[cfg.initialState.mapId]
  const spawnNode = initialMap?.nodes.find((n) => n.id === initialMap.spawnNodeId)

  const characters: Character[] = charactersData.characters.map((charConfig: CharacterConfig) => ({
    id: charConfig.id,
    name: charConfig.name,
    sprite: charConfig.sprite,
    money: charConfig.defaultStats.money,
    satiety: charConfig.defaultStats.satiety,
    energy: charConfig.defaultStats.energy,
    hygiene: charConfig.defaultStats.hygiene,
    mood: charConfig.defaultStats.mood,
    bladder: charConfig.defaultStats.bladder,
    currentMapId: cfg.initialState.mapId,
    currentNodeId: initialMap?.spawnNodeId ?? '',
    position: spawnNode
      ? { x: spawnNode.x, y: spawnNode.y }
      : { x: 0, y: 0 },
    direction: 'down' as const,
    employment: charConfig.employment,
    // LLM行動決定用のプロファイル情報
    personality: charConfig.personality,
    tendencies: charConfig.tendencies,
    customPrompt: charConfig.customPrompt,
  }))

  return characters
}

// Extract NPC blocked nodes from maps data
export async function loadNPCBlockedNodesServer(config?: WorldConfig): Promise<Map<string, Set<string>>> {
  const cfg = config ?? (await loadWorldConfigServer())
  const mapsPath = path.join(getPublicPath(), cfg.paths.mapsJson.replace(/^\//, ''))
  const content = await fs.readFile(mapsPath, 'utf-8')
  const mapsData: MapsDataJson = JSON.parse(content)

  const blockedNodesPerMap = new Map<string, Set<string>>()

  for (const mapConfig of mapsData.maps) {
    if (mapConfig.npcs && mapConfig.npcs.length > 0) {
      const blockedNodes = new Set<string>()
      for (const npc of mapConfig.npcs) {
        if (npc.spawnNodeId) {
          blockedNodes.add(npc.spawnNodeId)
        }
      }
      if (blockedNodes.size > 0) {
        blockedNodesPerMap.set(mapConfig.id, blockedNodes)
      }
    }
  }

  return blockedNodesPerMap
}

// Load NPCs from maps data
export async function loadNPCsServer(config?: WorldConfig): Promise<NPC[]> {
  const cfg = config ?? (await loadWorldConfigServer())
  const mapsPath = path.join(getPublicPath(), cfg.paths.mapsJson.replace(/^\//, ''))
  const content = await fs.readFile(mapsPath, 'utf-8')
  const mapsData: MapsDataJson = JSON.parse(content)

  // Get all maps to find node positions
  const maps = await loadMapsServer(cfg)
  const npcs: NPC[] = []

  for (const mapConfig of mapsData.maps) {
    if (!mapConfig.npcs || mapConfig.npcs.length === 0) continue

    const map = maps[mapConfig.id]
    if (!map) continue

    for (const npcConfig of mapConfig.npcs) {
      const node = map.nodes.find((n) => n.id === npcConfig.spawnNodeId)
      if (!node) {
        console.warn(`[NPC] Node ${npcConfig.spawnNodeId} not found for NPC ${npcConfig.id}`)
        continue
      }

      npcs.push(createNPCFromConfig(npcConfig, mapConfig.id, { x: node.x, y: node.y }))
    }
  }

  return npcs
}

// Load default schedules from characters.json
export async function loadDefaultSchedulesServer(config?: WorldConfig): Promise<Map<string, ScheduleEntry[]>> {
  const cfg = config ?? (await loadWorldConfigServer())
  const charactersPath = path.join(getPublicPath(), cfg.paths.charactersJson.replace(/^\//, ''))
  const content = await fs.readFile(charactersPath, 'utf-8')
  const charactersData: CharactersData = JSON.parse(content)

  const schedules = new Map<string, ScheduleEntry[]>()

  for (const charConfig of charactersData.characters) {
    if (charConfig.defaultSchedule && charConfig.defaultSchedule.length > 0) {
      schedules.set(charConfig.id, charConfig.defaultSchedule)
    }
  }

  return schedules
}

// Load all world data needed for simulation
export interface WorldData {
  config: WorldConfig
  maps: Record<string, WorldMap>
  characters: Character[]
  npcs: NPC[]
  npcBlockedNodes: Map<string, Set<string>>
  defaultSchedules: Map<string, ScheduleEntry[]>
  characterConfigs: CharacterConfig[]  // キャラクターのプロファイル情報（再起動後の補填用）
}

// Load character configs (for profile supplementation after restore)
export async function loadCharacterConfigsServer(config?: WorldConfig): Promise<CharacterConfig[]> {
  const cfg = config ?? (await loadWorldConfigServer())
  const charactersPath = path.join(getPublicPath(), cfg.paths.charactersJson.replace(/^\//, ''))
  const content = await fs.readFile(charactersPath, 'utf-8')
  const charactersData: CharactersData = JSON.parse(content)

  return charactersData.characters
}

export async function loadWorldDataServer(): Promise<WorldData> {
  const config = await loadWorldConfigServer()
  const maps = await loadMapsServer(config)
  const characters = await loadCharactersServer(config)
  const npcs = await loadNPCsServer(config)
  const npcBlockedNodes = await loadNPCBlockedNodesServer(config)
  const defaultSchedules = await loadDefaultSchedulesServer(config)
  const characterConfigs = await loadCharacterConfigsServer(config)

  return { config, maps, characters, npcs, npcBlockedNodes, defaultSchedules, characterConfigs }
}
