import { describe, it, expect, beforeEach, vi } from 'vitest'
import * as fs from 'fs'

// Mock fs.promises
vi.mock('fs', () => ({
  promises: {
    readFile: vi.fn(),
  },
}))

// Mock grid module (matches real tileToPixelObstacle formula: row/col = top-left corner)
vi.mock('@/data/maps/grid', () => ({
  tileToPixelObstacle: vi.fn((obs: { row: number; col: number; tileWidth: number; tileHeight: number }, config: { cols: number; rows: number; width: number; height: number }) => {
    const spacingX = config.width / (config.cols + 1)
    const spacingY = config.height / (config.rows + 1)
    return {
      x: Math.round(spacingX * (obs.col + 1)),
      y: Math.round(spacingY * (obs.row + 1)),
      width: Math.round(spacingX * obs.tileWidth),
      height: Math.round(spacingY * obs.tileHeight),
    }
  }),
  tileToPixelEntrance: vi.fn((entrance: { row: number; col: number }, config: { cols: number; rows: number; width: number; height: number }) => {
    const spacingX = config.width / (config.cols + 1)
    const spacingY = config.height / (config.rows + 1)
    return {
      x: Math.round(spacingX * (entrance.col + 1)),
      y: Math.round(spacingY * (entrance.row + 1)),
    }
  }),
}))

const mockWorldConfig = {
  timing: { idleTimeMin: 500, idleTimeMax: 1500, fadeStep: 0.05, fadeIntervalMs: 50 },
  movement: { speed: 150, entranceProbability: 0.1 },
  character: { scale: 1, animationSpeed: 0.1 },
  sprite: { animationSequence: [0, 1, 2, 1], idleFrame: 1 },
  grid: { defaultCols: 12, defaultRows: 9, defaultWidth: 800, defaultHeight: 600 },
  canvas: { defaultWidth: 800, defaultHeight: 600, backgroundColor: '#333333' },
  theme: {
    nodes: { entrance: { fill: 'red', radius: 4 }, spawn: { fill: 'green', radius: 4 }, waypoint: { fill: 'blue', radius: 2 }, connectionLine: { color: 'gray', width: 1, alpha: 0.3 } },
    obstacle: { fill: 'yellow', alpha: 0.2, stroke: 'yellow', strokeWidth: 2 },
    characterFallback: { fill: 'white', stroke: 'black', strokeWidth: 2, radius: 16 },
    transition: { overlayColor: 'black' },
  },
  initialState: { mapId: 'town', time: { hour: 8, minute: 0, day: 1 } },
  paths: { mapsJson: '/data/maps.json', charactersJson: '/data/characters.json' },
  time: { timezone: 'Asia/Tokyo', statusDecayIntervalMs: 60000, decayRates: { satietyPerMinute: 0.1, energyPerMinute: 0.1, hygienePerMinute: 0.05, moodPerMinute: 0.05, bladderPerMinute: 0.15 } },
}

const mockMapsData = {
  maps: [
    {
      id: 'town',
      name: 'Town',
      width: 800,
      height: 600,
      backgroundColor: '0x333333',
      spawnNodeId: 'town-0-0',
      grid: { prefix: 'town', cols: 3, rows: 3 },
      labels: [],
      entrances: [],
      obstacles: [],
    },
  ],
}

const mockCharactersData = {
  characters: [
    {
      id: 'char1',
      name: 'Test Character',
      sprite: { sheetUrl: 'test.png', frameWidth: 96, frameHeight: 96, cols: 3, rows: 4, rowMapping: { down: 0, left: 1, right: 2, up: 3 } },
      defaultStats: { money: 100, satiety: 80, energy: 80, hygiene: 80, mood: 80, bladder: 80 },
    },
  ],
}

describe('dataLoader', () => {
  let dataLoader: typeof import('./dataLoader')

  beforeEach(async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.mocked(fs.promises.readFile).mockReset()
    vi.resetModules()
    dataLoader = await import('./dataLoader')
  })

  describe('loadWorldConfigServer', () => {
    it('should load and parse world config JSON', async () => {
      vi.mocked(fs.promises.readFile).mockResolvedValue(JSON.stringify(mockWorldConfig))
      const config = await dataLoader.loadWorldConfigServer()
      expect(config.initialState.mapId).toBe('town')
      expect(config.grid.defaultCols).toBe(12)
    })
  })

  describe('loadMapsServer', () => {
    it('should load maps and generate nodes', async () => {
      vi.mocked(fs.promises.readFile)
        .mockResolvedValueOnce(JSON.stringify(mockWorldConfig)) // config
        .mockResolvedValueOnce(JSON.stringify(mockMapsData))    // maps
      const maps = await dataLoader.loadMapsServer()
      expect(maps['town']).toBeDefined()
      expect(maps['town'].id).toBe('town')
      expect(maps['town'].nodes.length).toBeGreaterThan(0)
    })

    it('should parse backgroundColor from hex string', async () => {
      vi.mocked(fs.promises.readFile)
        .mockResolvedValueOnce(JSON.stringify(mockWorldConfig))
        .mockResolvedValueOnce(JSON.stringify(mockMapsData))
      const maps = await dataLoader.loadMapsServer()
      expect(maps['town'].backgroundColor).toBe(0x333333)
    })

    it('should handle # prefix in backgroundColor', async () => {
      const mapsWithHash = {
        maps: [{
          ...mockMapsData.maps[0],
          backgroundColor: '#FF0000',
        }],
      }
      vi.mocked(fs.promises.readFile)
        .mockResolvedValueOnce(JSON.stringify(mockWorldConfig))
        .mockResolvedValueOnce(JSON.stringify(mapsWithHash))
      const maps = await dataLoader.loadMapsServer()
      expect(maps['town'].backgroundColor).toBe(0xFF0000)
    })

    it('should convert obstacles from tile to pixel coordinates', async () => {
      const mapsWithObs = {
        maps: [{
          ...mockMapsData.maps[0],
          obstacles: [{ row: 1, col: 1, tileWidth: 2, tileHeight: 2, label: 'Table' }],
        }],
      }
      vi.mocked(fs.promises.readFile)
        .mockResolvedValueOnce(JSON.stringify(mockWorldConfig))
        .mockResolvedValueOnce(JSON.stringify(mapsWithObs))
      const maps = await dataLoader.loadMapsServer()
      expect(maps['town'].obstacles).toHaveLength(1)
      expect(maps['town'].obstacles[0].label).toBe('Table')
      expect(maps['town'].obstacles[0].type).toBe('building')
    })
  })

  describe('loadCharactersServer', () => {
    it('should load characters with initial position from spawn node', async () => {
      vi.mocked(fs.promises.readFile)
        .mockResolvedValueOnce(JSON.stringify(mockWorldConfig))    // 1. loadWorldConfigServer
        .mockResolvedValueOnce(JSON.stringify(mockCharactersData)) // 2. characters.json
        .mockResolvedValueOnce(JSON.stringify(mockMapsData))       // 3. maps.json (config passed)
      const characters = await dataLoader.loadCharactersServer()
      expect(characters).toHaveLength(1)
      expect(characters[0].id).toBe('char1')
      expect(characters[0].name).toBe('Test Character')
      expect(characters[0].money).toBe(100)
      expect(characters[0].currentMapId).toBe('town')
    })
  })

  describe('loadNPCBlockedNodesServer', () => {
    it('should extract NPC spawn nodes', async () => {
      const mapsWithNPCs = {
        maps: [{
          ...mockMapsData.maps[0],
          npcs: [{ id: 'npc1', name: 'NPC', sprite: {}, spawnNodeId: 'town-1-1' }],
        }],
      }
      vi.mocked(fs.promises.readFile)
        .mockResolvedValueOnce(JSON.stringify(mockWorldConfig))
        .mockResolvedValueOnce(JSON.stringify(mapsWithNPCs))
      const blocked = await dataLoader.loadNPCBlockedNodesServer()
      expect(blocked.get('town')).toBeDefined()
      expect(blocked.get('town')!.has('town-1-1')).toBe(true)
    })

    it('should return empty map when no NPCs', async () => {
      vi.mocked(fs.promises.readFile)
        .mockResolvedValueOnce(JSON.stringify(mockWorldConfig))
        .mockResolvedValueOnce(JSON.stringify(mockMapsData))
      const blocked = await dataLoader.loadNPCBlockedNodesServer()
      expect(blocked.size).toBe(0)
    })
  })

  describe('loadMapsServer - zone wall filtering', () => {
    it('should exclude nodes on zone walls (small grid where wall positions overlap node positions)', async () => {
      // Grid: 3x3, 12x12 canvas → spacing = 3px
      // Zone at (0,0, 2x2) with all walls:
      //   obstacle pixel: x=3, y=3, w=6, h=6
      //   tileSizeX=3, tileSizeY=3, outsetX=1.5, outsetY=1.5
      //   top wall fixedPos = 3 - 1.5 = 1.5
      //   node row=0: nodeY = 3, |3-1.5| = 1.5 < 2 → ON WALL
      //   With all walls, only center node (1,1) survives
      const mapsWithZone = {
        maps: [{
          id: 'small',
          name: 'Small',
          width: 12,
          height: 12,
          backgroundColor: '0x000000',
          spawnNodeId: 'small-1-1',
          grid: { prefix: 'small', cols: 3, rows: 3 },
          labels: [],
          entrances: [],
          obstacles: [{
            row: 0, col: 0, tileWidth: 2, tileHeight: 2,
            label: 'Walled Room',
            type: 'zone',
            wallSides: ['top', 'bottom', 'left', 'right'],
          }],
        }],
      }
      vi.mocked(fs.promises.readFile)
        .mockResolvedValueOnce(JSON.stringify(mockWorldConfig))
        .mockResolvedValueOnce(JSON.stringify(mapsWithZone))
      const maps = await dataLoader.loadMapsServer()
      const nodes = maps['small'].nodes
      // 9ノード中、壁上の8ノードが除外され、中心の(1,1)のみ残る
      expect(nodes.length).toBe(1)
      expect(nodes[0].id).toBe('small-1-1')
    })

    it('should keep nodes at door openings on zone walls', async () => {
      // Same small grid but with door on top wall
      // Door opening: start=-1, end=4 → offsets 0,1,2,3 are all door openings
      const mapsWithZoneDoor = {
        maps: [{
          id: 'small',
          name: 'Small',
          width: 12,
          height: 12,
          backgroundColor: '0x000000',
          spawnNodeId: 'small-1-1',
          grid: { prefix: 'small', cols: 3, rows: 3 },
          labels: [],
          entrances: [],
          obstacles: [{
            row: 0, col: 0, tileWidth: 2, tileHeight: 2,
            label: 'Room with Door',
            type: 'zone',
            wallSides: ['top'],
            door: { side: 'top', start: -1, end: 4 },
          }],
        }],
      }
      vi.mocked(fs.promises.readFile)
        .mockResolvedValueOnce(JSON.stringify(mockWorldConfig))
        .mockResolvedValueOnce(JSON.stringify(mapsWithZoneDoor))
      const maps = await dataLoader.loadMapsServer()
      const nodes = maps['small'].nodes
      // top wall exists but entire wall is door opening → all nodes survive
      expect(nodes.length).toBe(9)
    })

    it('should not exclude nodes when zone has no wallSides', async () => {
      const mapsWithZoneNoWalls = {
        maps: [{
          ...mockMapsData.maps[0],
          grid: { prefix: 'town', cols: 4, rows: 4 },
          obstacles: [{
            row: 1, col: 1, tileWidth: 2, tileHeight: 2,
            label: 'Open Area',
            type: 'zone',
            wallSides: [],
          }],
        }],
      }
      vi.mocked(fs.promises.readFile)
        .mockResolvedValueOnce(JSON.stringify(mockWorldConfig))
        .mockResolvedValueOnce(JSON.stringify(mapsWithZoneNoWalls))
      const maps = await dataLoader.loadMapsServer()
      // 壁なしzoneなら全ノード生成される（4x4 = 16ノード）
      expect(maps['town'].nodes.length).toBe(16)
    })
  })

  describe('loadNPCsServer', () => {
    it('should load NPCs with node positions and profile fields', async () => {
      const mapsWithNPCs = {
        maps: [{
          ...mockMapsData.maps[0],
          npcs: [{
            id: 'npc1',
            name: 'TestNPC',
            sprite: { sheetUrl: 'npc.png' },
            spawnNodeId: 'town-1-1',
            personality: '明るく社交的',
            tendencies: ['話好き', '親切'],
            facts: ['花屋で働いている'],
            customPrompt: 'テスト用プロンプト',
          }],
        }],
      }
      vi.mocked(fs.promises.readFile)
        .mockResolvedValueOnce(JSON.stringify(mockWorldConfig))  // 1. loadWorldConfigServer
        .mockResolvedValueOnce(JSON.stringify(mapsWithNPCs))     // 2. maps (NPC data)
        .mockResolvedValueOnce(JSON.stringify(mapsWithNPCs))     // 3. loadMapsServer(cfg) reads maps
      const npcs = await dataLoader.loadNPCsServer()
      expect(npcs).toHaveLength(1)
      expect(npcs[0].id).toBe('npc1')
      expect(npcs[0].name).toBe('TestNPC')
      expect(npcs[0].mapId).toBe('town')
      expect(npcs[0].currentNodeId).toBe('town-1-1')
      expect(npcs[0].direction).toBe('down')
      expect(npcs[0].position.x).toBeGreaterThan(0)
      expect(npcs[0].position.y).toBeGreaterThan(0)
      // プロフィールフィールド
      expect(npcs[0].personality).toBe('明るく社交的')
      expect(npcs[0].tendencies).toEqual(['話好き', '親切'])
      expect(npcs[0].facts).toEqual(['花屋で働いている'])
      expect(npcs[0].customPrompt).toBe('テスト用プロンプト')
      // 動的ステータス初期値
      expect(npcs[0].affinity).toBe(0)
      expect(npcs[0].mood).toBe('neutral')
      expect(npcs[0].conversationCount).toBe(0)
      expect(npcs[0].lastConversation).toBeNull()
    })

    it('should skip NPCs with non-existent spawn node', async () => {
      const mapsWithBadNPC = {
        maps: [{
          ...mockMapsData.maps[0],
          npcs: [{ id: 'npc1', name: 'BadNPC', sprite: {}, spawnNodeId: 'town-99-99' }],
        }],
      }
      vi.mocked(fs.promises.readFile)
        .mockResolvedValueOnce(JSON.stringify(mockWorldConfig))  // 1. loadWorldConfigServer
        .mockResolvedValueOnce(JSON.stringify(mapsWithBadNPC))   // 2. maps (NPC data)
        .mockResolvedValueOnce(JSON.stringify(mapsWithBadNPC))   // 3. loadMapsServer(cfg) reads maps
      const npcs = await dataLoader.loadNPCsServer()
      expect(npcs).toHaveLength(0)
    })

    it('should return empty array when no maps have NPCs', async () => {
      vi.mocked(fs.promises.readFile)
        .mockResolvedValueOnce(JSON.stringify(mockWorldConfig))  // 1. loadWorldConfigServer
        .mockResolvedValueOnce(JSON.stringify(mockMapsData))     // 2. maps (NPC data)
        .mockResolvedValueOnce(JSON.stringify(mockMapsData))     // 3. loadMapsServer(cfg) reads maps
      const npcs = await dataLoader.loadNPCsServer()
      expect(npcs).toHaveLength(0)
    })
  })

  describe('loadCharacterConfigsServer', () => {
    it('should load character configs', async () => {
      vi.mocked(fs.promises.readFile)
        .mockResolvedValueOnce(JSON.stringify(mockWorldConfig))
        .mockResolvedValueOnce(JSON.stringify(mockCharactersData))
      const configs = await dataLoader.loadCharacterConfigsServer()
      expect(configs).toHaveLength(1)
      expect(configs[0].id).toBe('char1')
      expect(configs[0].name).toBe('Test Character')
      expect(configs[0].defaultStats.money).toBe(100)
    })
  })

  describe('loadWorldDataServer', () => {
    it('should load all world data', async () => {
      const mapsWithNPCs = {
        maps: [{
          ...mockMapsData.maps[0],
          npcs: [{ id: 'npc1', name: 'NPC', sprite: {}, spawnNodeId: 'town-0-0' }],
        }],
      }
      const charsWithSchedule = {
        characters: [{
          ...mockCharactersData.characters[0],
          defaultSchedule: [{ time: '09:00', activity: '仕事' }],
        }],
      }

      // loadWorldDataServer read sequence:
      // 1. loadWorldConfigServer → config
      // 2. loadMapsServer(config) → maps
      // 3. loadCharactersServer(config) → characters
      // 4.   → loadMapsServer(cfg) → maps
      // 5. loadNPCsServer(config) → maps (NPC data)
      // 6.   → loadMapsServer(cfg) → maps
      // 7. loadNPCBlockedNodesServer(config) → maps
      // 8. loadDefaultSchedulesServer(config) → characters
      // 9. loadCharacterConfigsServer(config) → characters
      vi.mocked(fs.promises.readFile)
        .mockResolvedValueOnce(JSON.stringify(mockWorldConfig))      // 1. config
        .mockResolvedValueOnce(JSON.stringify(mapsWithNPCs))         // 2. maps
        .mockResolvedValueOnce(JSON.stringify(charsWithSchedule))    // 3. characters
        .mockResolvedValueOnce(JSON.stringify(mapsWithNPCs))         // 4. maps (for spawn)
        .mockResolvedValueOnce(JSON.stringify(mapsWithNPCs))         // 5. maps (NPC data)
        .mockResolvedValueOnce(JSON.stringify(mapsWithNPCs))         // 6. maps (loadMapsServer)
        .mockResolvedValueOnce(JSON.stringify(mapsWithNPCs))         // 7. maps (blocked nodes)
        .mockResolvedValueOnce(JSON.stringify(charsWithSchedule))    // 8. characters (schedules)
        .mockResolvedValueOnce(JSON.stringify(charsWithSchedule))    // 9. characters (configs)

      const data = await dataLoader.loadWorldDataServer()
      expect(data.config).toBeDefined()
      expect(data.maps['town']).toBeDefined()
      expect(data.characters).toHaveLength(1)
      expect(data.npcBlockedNodes).toBeInstanceOf(Map)
      expect(data.defaultSchedules).toBeInstanceOf(Map)
      expect(data.characterConfigs).toHaveLength(1)
    })
  })

  describe('loadDefaultSchedulesServer', () => {
    it('should load schedules from character configs', async () => {
      const charsWithSchedule = {
        characters: [{
          ...mockCharactersData.characters[0],
          defaultSchedule: [{ time: '09:00', activity: '仕事' }],
        }],
      }
      vi.mocked(fs.promises.readFile)
        .mockResolvedValueOnce(JSON.stringify(mockWorldConfig))
        .mockResolvedValueOnce(JSON.stringify(charsWithSchedule))
      const schedules = await dataLoader.loadDefaultSchedulesServer()
      expect(schedules.get('char1')).toBeDefined()
      expect(schedules.get('char1')![0].time).toBe('09:00')
    })

    it('should skip characters without schedule', async () => {
      vi.mocked(fs.promises.readFile)
        .mockResolvedValueOnce(JSON.stringify(mockWorldConfig))
        .mockResolvedValueOnce(JSON.stringify(mockCharactersData))
      const schedules = await dataLoader.loadDefaultSchedulesServer()
      expect(schedules.size).toBe(0)
    })
  })
})
