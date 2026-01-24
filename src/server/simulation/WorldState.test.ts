import { describe, it, expect, beforeEach } from 'vitest'
import { WorldStateManager } from './WorldState'
import type { WorldMap, NPC, CrossMapRoute } from '@/types'
import type { SimCharacter } from './types'

// Helper to create a test character
function createTestCharacter(id: string, mapId: string = 'test-map'): SimCharacter {
  return {
    id,
    name: `Character ${id}`,
    sprite: { sheetUrl: 'test.png', frameWidth: 96, frameHeight: 96, cols: 3, rows: 4, rowMapping: { down: 0, left: 1, right: 2, up: 3 } },
    money: 1000,
    satiety: 80,
    energy: 70,
    hygiene: 90,
    mood: 75,
    bladder: 60,
    currentMapId: mapId,
    currentNodeId: 'node-0-0',
    position: { x: 100, y: 100 },
    direction: 'down',
    navigation: {
      isMoving: false,
      path: [],
      currentPathIndex: 0,
      progress: 0,
      startPosition: null,
      targetPosition: null,
    },
    crossMapNavigation: null,
    conversation: null,
    currentAction: null,
    pendingAction: null,
    actionCounter: 0,
  }
}

// Helper to create a test map
function createTestMap(id: string): WorldMap {
  return {
    id,
    name: `Test ${id}`,
    width: 800,
    height: 600,
    backgroundColor: 0x000000,
    spawnNodeId: 'node-0-0',
    nodes: [
      { id: 'node-0-0', x: 100, y: 100, type: 'waypoint', connectedTo: ['node-0-1'] },
      { id: 'node-0-1', x: 200, y: 100, type: 'waypoint', connectedTo: ['node-0-0'] },
    ],
    obstacles: [],
  }
}

// Helper to create a test NPC
function createTestNPC(id: string, mapId: string): NPC {
  return {
    id,
    name: `NPC ${id}`,
    sprite: { sheetUrl: 'npc.png', frameWidth: 96, frameHeight: 96, cols: 3, rows: 4, rowMapping: { down: 0, left: 1, right: 2, up: 3 } },
    mapId,
    currentNodeId: 'node-0-0',
    position: { x: 100, y: 100 },
    direction: 'down',
    personality: 'テスト性格',
    tendencies: ['傾向1'],
    facts: ['事実1'],
    affinity: 0,
    mood: 'neutral',
    conversationCount: 0,
    lastConversation: null,
  }
}

describe('WorldStateManager', () => {
  let manager: WorldStateManager

  beforeEach(() => {
    manager = new WorldStateManager()
  })

  describe('initialization', () => {
    it('should initialize with default state', () => {
      const state = manager.getState()

      expect(state.currentMapId).toBe('home')
      expect(state.time).toEqual({ hour: 8, minute: 0, day: 1 })
      expect(state.isPaused).toBe(false)
      expect(state.characters.size).toBe(0)
      expect(state.npcs.size).toBe(0)
    })

    it('should initialize with maps', () => {
      const maps = {
        'map-a': createTestMap('map-a'),
        'map-b': createTestMap('map-b'),
      }

      manager.initialize(maps, 'map-a')

      expect(manager.getMaps()).toEqual(maps)
      expect(manager.getState().currentMapId).toBe('map-a')
    })
  })

  describe('character management', () => {
    it('should add and retrieve character', () => {
      const char = createTestCharacter('char-1')
      manager.addCharacter(char)

      const result = manager.getCharacter('char-1')
      expect(result).toEqual(char)
    })

    it('should return undefined for non-existent character', () => {
      const result = manager.getCharacter('non-existent')
      expect(result).toBeUndefined()
    })

    it('should get all characters', () => {
      manager.addCharacter(createTestCharacter('char-1'))
      manager.addCharacter(createTestCharacter('char-2'))

      const result = manager.getAllCharacters()
      expect(result).toHaveLength(2)
    })

    it('should update character', () => {
      manager.addCharacter(createTestCharacter('char-1'))
      manager.updateCharacter('char-1', { money: 500 })

      const result = manager.getCharacter('char-1')
      expect(result?.money).toBe(500)
    })

    it('should update character position', () => {
      manager.addCharacter(createTestCharacter('char-1'))
      manager.updateCharacterPosition('char-1', { x: 200, y: 300 })

      const result = manager.getCharacter('char-1')
      expect(result?.position).toEqual({ x: 200, y: 300 })
    })

    it('should update character direction', () => {
      manager.addCharacter(createTestCharacter('char-1'))
      manager.updateCharacterDirection('char-1', 'left')

      const result = manager.getCharacter('char-1')
      expect(result?.direction).toBe('left')
    })

    it('should set character map', () => {
      manager.addCharacter(createTestCharacter('char-1'))
      manager.setCharacterMap('char-1', 'new-map', 'node-1-1', { x: 300, y: 400 })

      const result = manager.getCharacter('char-1')
      expect(result?.currentMapId).toBe('new-map')
      expect(result?.currentNodeId).toBe('node-1-1')
      expect(result?.position).toEqual({ x: 300, y: 400 })
    })

    it('should supplement character profile', () => {
      manager.addCharacter(createTestCharacter('char-1'))
      manager.supplementCharacterProfile('char-1', {
        personality: 'friendly',
        tendencies: ['social', 'curious'],
        customPrompt: 'Test prompt',
      })

      const result = manager.getCharacter('char-1')
      expect(result?.personality).toBe('friendly')
      expect(result?.tendencies).toEqual(['social', 'curious'])
      expect(result?.customPrompt).toBe('Test prompt')
    })
  })

  describe('NPC management', () => {
    it('should initialize NPCs', () => {
      const npcs = [
        createTestNPC('npc-1', 'map-a'),
        createTestNPC('npc-2', 'map-a'),
      ]
      manager.initializeNPCs(npcs)

      expect(manager.getAllNPCs()).toHaveLength(2)
    })

    it('should add NPC', () => {
      manager.addNPC(createTestNPC('npc-1', 'map-a'))

      expect(manager.getNPC('npc-1')).toBeDefined()
    })

    it('should get NPCs on specific map', () => {
      manager.initializeNPCs([
        createTestNPC('npc-1', 'map-a'),
        createTestNPC('npc-2', 'map-b'),
        createTestNPC('npc-3', 'map-a'),
      ])

      const result = manager.getNPCsOnMap('map-a')
      expect(result).toHaveLength(2)
    })

    it('should update NPC direction', () => {
      manager.addNPC(createTestNPC('npc-1', 'map-a'))
      manager.updateNPCDirection('npc-1', 'up')

      const result = manager.getNPC('npc-1')
      expect(result?.direction).toBe('up')
    })

    it('should set NPC conversation state', () => {
      manager.addNPC(createTestNPC('npc-1', 'map-a'))
      manager.setNPCConversationState('npc-1', true)

      const result = manager.getNPC('npc-1')
      expect(result?.isInConversation).toBe(true)
    })
  })

  describe('navigation state', () => {
    beforeEach(() => {
      manager.addCharacter(createTestCharacter('char-1'))
    })

    it('should start navigation', () => {
      manager.startNavigation(
        'char-1',
        ['node-0-0', 'node-0-1'],
        { x: 100, y: 100 },
        { x: 200, y: 100 }
      )

      const nav = manager.getNavigation('char-1')
      expect(nav?.isMoving).toBe(true)
      expect(nav?.path).toEqual(['node-0-0', 'node-0-1'])
      expect(nav?.currentPathIndex).toBe(0)
      expect(nav?.progress).toBe(0)
    })

    it('should update navigation progress', () => {
      manager.startNavigation(
        'char-1',
        ['node-0-0', 'node-0-1'],
        { x: 100, y: 100 },
        { x: 200, y: 100 }
      )
      manager.updateNavigationProgress('char-1', 0.5)

      const nav = manager.getNavigation('char-1')
      expect(nav?.progress).toBe(0.5)
    })

    it('should advance to next node', () => {
      manager.startNavigation(
        'char-1',
        ['node-0-0', 'node-0-1', 'node-1-1'],
        { x: 100, y: 100 },
        { x: 200, y: 100 }
      )
      manager.advanceToNextNode('char-1', { x: 300, y: 200 })

      const nav = manager.getNavigation('char-1')
      expect(nav?.currentPathIndex).toBe(1)
      expect(nav?.progress).toBe(0)
      expect(nav?.targetPosition).toEqual({ x: 300, y: 200 })
    })

    it('should complete navigation', () => {
      manager.startNavigation(
        'char-1',
        ['node-0-0', 'node-0-1'],
        { x: 100, y: 100 },
        { x: 200, y: 100 }
      )
      manager.completeNavigation('char-1')

      const nav = manager.getNavigation('char-1')
      expect(nav?.isMoving).toBe(false)
      expect(nav?.path).toEqual([])
    })

    it('should check if character is moving', () => {
      expect(manager.isCharacterMoving('char-1')).toBe(false)

      manager.startNavigation(
        'char-1',
        ['node-0-0', 'node-0-1'],
        { x: 100, y: 100 },
        { x: 200, y: 100 }
      )

      expect(manager.isCharacterMoving('char-1')).toBe(true)
    })
  })

  describe('cross-map navigation', () => {
    beforeEach(() => {
      manager.addCharacter(createTestCharacter('char-1'))
    })

    it('should start cross-map navigation', () => {
      const route: CrossMapRoute = {
        segments: [
          { mapId: 'map-a', path: ['node-0-0'] },
          { mapId: 'map-b', path: ['node-1-1'] },
        ],
      }
      manager.startCrossMapNavigation('char-1', 'map-b', 'node-1-1', route)

      const crossNav = manager.getCrossMapNavigation('char-1')
      expect(crossNav?.isActive).toBe(true)
      expect(crossNav?.targetMapId).toBe('map-b')
      expect(crossNav?.currentSegmentIndex).toBe(0)
    })

    it('should advance cross-map segment', () => {
      const route: CrossMapRoute = {
        segments: [
          { mapId: 'map-a', path: ['node-0-0'] },
          { mapId: 'map-b', path: ['node-1-1'] },
        ],
      }
      manager.startCrossMapNavigation('char-1', 'map-b', 'node-1-1', route)
      manager.advanceCrossMapSegment('char-1')

      const crossNav = manager.getCrossMapNavigation('char-1')
      expect(crossNav?.currentSegmentIndex).toBe(1)
    })

    it('should complete cross-map navigation', () => {
      const route: CrossMapRoute = {
        segments: [{ mapId: 'map-a', path: ['node-0-0'] }],
      }
      manager.startCrossMapNavigation('char-1', 'map-a', 'node-0-0', route)
      manager.completeCrossMapNavigation('char-1')

      expect(manager.getCrossMapNavigation('char-1')).toBeNull()
    })

    it('should check if cross-map navigating', () => {
      expect(manager.isCrossMapNavigating('char-1')).toBe(false)

      const route: CrossMapRoute = {
        segments: [{ mapId: 'map-a', path: ['node-0-0'] }],
      }
      manager.startCrossMapNavigation('char-1', 'map-a', 'node-0-0', route)

      expect(manager.isCrossMapNavigating('char-1')).toBe(true)
    })
  })

  describe('transition state', () => {
    it('should start transition', () => {
      manager.startTransition('char-1', 'map-a', 'map-b')

      const transition = manager.getTransition()
      expect(transition.isTransitioning).toBe(true)
      expect(transition.characterId).toBe('char-1')
      expect(transition.fromMapId).toBe('map-a')
      expect(transition.toMapId).toBe('map-b')
    })

    it('should update transition progress', () => {
      manager.startTransition('char-1', 'map-a', 'map-b')
      manager.updateTransitionProgress(0.7)

      const transition = manager.getTransition()
      expect(transition.progress).toBe(0.7)
    })

    it('should end transition', () => {
      manager.startTransition('char-1', 'map-a', 'map-b')
      manager.endTransition()

      const transition = manager.getTransition()
      expect(transition.isTransitioning).toBe(false)
      expect(manager.getState().currentMapId).toBe('map-b')
    })
  })

  describe('time management', () => {
    it('should get time', () => {
      const time = manager.getTime()
      expect(time).toEqual({ hour: 8, minute: 0, day: 1 })
    })

    it('should set time', () => {
      manager.setTime({ hour: 12, minute: 30, day: 2 })

      const time = manager.getTime()
      expect(time).toEqual({ hour: 12, minute: 30, day: 2 })
    })

    it('should advance time by minutes', () => {
      manager.advanceTime(45)

      const time = manager.getTime()
      expect(time.hour).toBe(8)
      expect(time.minute).toBe(45)
    })

    it('should handle hour overflow', () => {
      manager.advanceTime(75) // 1 hour 15 minutes

      const time = manager.getTime()
      expect(time.hour).toBe(9)
      expect(time.minute).toBe(15)
    })

    it('should handle day overflow', () => {
      manager.setTime({ hour: 23, minute: 30, day: 1 })
      manager.advanceTime(60) // 1 hour

      const time = manager.getTime()
      expect(time.hour).toBe(0)
      expect(time.minute).toBe(30)
      expect(time.day).toBe(2)
    })

    it('should get current hour', () => {
      expect(manager.getCurrentHour()).toBe(8)
    })
  })

  describe('pause control', () => {
    it('should check pause state', () => {
      expect(manager.isPaused()).toBe(false)
    })

    it('should set pause state', () => {
      manager.setPaused(true)
      expect(manager.isPaused()).toBe(true)
    })

    it('should toggle pause', () => {
      manager.togglePause()
      expect(manager.isPaused()).toBe(true)

      manager.togglePause()
      expect(manager.isPaused()).toBe(false)
    })
  })

  describe('tick management', () => {
    it('should start with tick 0', () => {
      expect(manager.getTick()).toBe(0)
    })

    it('should increment tick', () => {
      manager.incrementTick()
      expect(manager.getTick()).toBe(1)

      manager.incrementTick()
      expect(manager.getTick()).toBe(2)
    })
  })

  describe('NPC blocked nodes', () => {
    it('should set and get NPC blocked nodes', () => {
      const blockedNodes = new Set(['node-0-0', 'node-0-1'])
      manager.setNPCBlockedNodes('map-a', blockedNodes)

      const result = manager.getNPCBlockedNodes('map-a')
      expect(result).toEqual(blockedNodes)
    })

    it('should return empty set for unset map', () => {
      const result = manager.getNPCBlockedNodes('unknown-map')
      expect(result.size).toBe(0)
    })

    it('should clear NPC blocked nodes', () => {
      manager.setNPCBlockedNodes('map-a', new Set(['node-0-0']))
      manager.clearNPCBlockedNodes()

      const result = manager.getNPCBlockedNodes('map-a')
      expect(result.size).toBe(0)
    })
  })

  describe('serialization', () => {
    it('should serialize state', () => {
      manager.addCharacter(createTestCharacter('char-1'))
      manager.addNPC(createTestNPC('npc-1', 'map-a'))

      const serialized = manager.getSerializedState()

      expect(serialized.characters).toHaveProperty('char-1')
      expect(serialized.npcs).toHaveProperty('npc-1')
      expect(serialized.currentMapId).toBe('home')
      expect(serialized.tick).toBe(0)
    })
  })

  describe('map access', () => {
    it('should get map by id', () => {
      const maps = { 'map-a': createTestMap('map-a') }
      manager.initialize(maps)

      const result = manager.getMap('map-a')
      expect(result?.id).toBe('map-a')
    })

    it('should return undefined for unknown map', () => {
      const result = manager.getMap('unknown')
      expect(result).toBeUndefined()
    })
  })
})
