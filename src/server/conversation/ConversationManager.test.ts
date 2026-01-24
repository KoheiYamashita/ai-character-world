import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ConversationManager } from './ConversationManager'
import { WorldStateManager } from '../simulation/WorldState'
import type { SimCharacter } from '../simulation/types'
import type { WorldMap, NPC } from '@/types'

function createTestMap(): WorldMap {
  return {
    id: 'town',
    name: 'Town',
    width: 800,
    height: 600,
    backgroundColor: 0x000000,
    spawnNodeId: 'town-0-0',
    nodes: [
      { id: 'town-0-0', x: 100, y: 100, type: 'waypoint', connectedTo: ['town-0-1'] },
      { id: 'town-0-1', x: 200, y: 100, type: 'waypoint', connectedTo: ['town-0-0'] },
    ],
    obstacles: [],
  }
}

function createTestCharacter(id: string): SimCharacter {
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
    currentMapId: 'town',
    currentNodeId: 'town-0-0',
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

function createTestNPC(id: string): NPC {
  return {
    id,
    name: `NPC ${id}`,
    sprite: { sheetUrl: 'npc.png', frameWidth: 96, frameHeight: 96, cols: 3, rows: 4, rowMapping: { down: 0, left: 1, right: 2, up: 3 } },
    mapId: 'town',
    currentNodeId: 'town-0-1',
    position: { x: 200, y: 100 },
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

describe('ConversationManager', () => {
  let worldState: WorldStateManager
  let manager: ConversationManager

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    worldState = new WorldStateManager()
    worldState.initialize({ town: createTestMap() }, 'town')
    worldState.addCharacter(createTestCharacter('char-1'))
    worldState.initializeNPCs([createTestNPC('npc-1')])
    manager = new ConversationManager(worldState)
  })

  describe('startConversation', () => {
    it('should create a new session', () => {
      const goal = { goal: '最近の様子を聞く', successCriteria: '近況を1つ以上聞けた' }
      const session = manager.startConversation('char-1', 'npc-1', goal)

      expect(session).not.toBeNull()
      expect(session!.characterId).toBe('char-1')
      expect(session!.npcId).toBe('npc-1')
      expect(session!.goal).toEqual(goal)
      expect(session!.messages).toEqual([])
      expect(session!.currentTurn).toBe(0)
      expect(session!.maxTurns).toBe(10)
      expect(session!.status).toBe('active')
      expect(session!.goalAchieved).toBe(false)
    })

    it('should update NPC isInConversation state', () => {
      const goal = { goal: 'test', successCriteria: '' }
      manager.startConversation('char-1', 'npc-1', goal)

      const npc = worldState.getNPC('npc-1')!
      expect(npc.isInConversation).toBe(true)
    })

    it('should update character conversation and displayEmoji', () => {
      const goal = { goal: 'test', successCriteria: '' }
      manager.startConversation('char-1', 'npc-1', goal)

      const char = worldState.getCharacter('char-1')!
      expect(char.conversation).not.toBeNull()
      expect(char.conversation!.status).toBe('active')
      expect(char.displayEmoji).toBe('💬')
    })

    it('should fire onConversationStart callback', () => {
      const callback = vi.fn()
      manager.setOnConversationStart(callback)

      const goal = { goal: 'test', successCriteria: '' }
      manager.startConversation('char-1', 'npc-1', goal)

      expect(callback).toHaveBeenCalledTimes(1)
      expect(callback).toHaveBeenCalledWith(expect.objectContaining({
        characterId: 'char-1',
        npcId: 'npc-1',
        status: 'active',
      }))
    })

    it('should return null if character already has active session', () => {
      const goal = { goal: 'test', successCriteria: '' }
      manager.startConversation('char-1', 'npc-1', goal)

      const result = manager.startConversation('char-1', 'npc-1', goal)
      expect(result).toBeNull()
    })

    it('should return null if NPC is already in conversation', () => {
      worldState.setNPCConversationState('npc-1', true)

      const goal = { goal: 'test', successCriteria: '' }
      const result = manager.startConversation('char-1', 'npc-1', goal)
      expect(result).toBeNull()
    })

    it('should return null if NPC not found', () => {
      const goal = { goal: 'test', successCriteria: '' }
      const result = manager.startConversation('char-1', 'nonexistent', goal)
      expect(result).toBeNull()
    })
  })

  describe('addMessage', () => {
    it('should add message to session', () => {
      const goal = { goal: 'test', successCriteria: '' }
      manager.startConversation('char-1', 'npc-1', goal)

      manager.addMessage('char-1', {
        speaker: 'character',
        speakerId: 'char-1',
        speakerName: 'Character char-1',
        utterance: 'こんにちは',
        timestamp: 1000,
      })

      const session = manager.getActiveSession('char-1')!
      expect(session.messages).toHaveLength(1)
      expect(session.messages[0].utterance).toBe('こんにちは')
    })

    it('should update currentTurn (2 messages = 1 turn)', () => {
      const goal = { goal: 'test', successCriteria: '' }
      manager.startConversation('char-1', 'npc-1', goal)

      // First message (character) - turn = floor(1/2) = 0
      manager.addMessage('char-1', {
        speaker: 'character',
        speakerId: 'char-1',
        speakerName: 'Character',
        utterance: 'hello',
        timestamp: 1000,
      })
      expect(manager.getActiveSession('char-1')!.currentTurn).toBe(0)

      // Second message (NPC) - turn = floor(2/2) = 1
      manager.addMessage('char-1', {
        speaker: 'npc',
        speakerId: 'npc-1',
        speakerName: 'NPC',
        utterance: 'hi',
        timestamp: 1001,
      })
      expect(manager.getActiveSession('char-1')!.currentTurn).toBe(1)
    })

    it('should sync session to character state', () => {
      const goal = { goal: 'test', successCriteria: '' }
      manager.startConversation('char-1', 'npc-1', goal)

      manager.addMessage('char-1', {
        speaker: 'character',
        speakerId: 'char-1',
        speakerName: 'Character',
        utterance: 'test message',
        timestamp: 1000,
      })

      const char = worldState.getCharacter('char-1')!
      expect(char.conversation!.messages).toHaveLength(1)
    })

    it('should do nothing if no active session', () => {
      // Should not throw
      manager.addMessage('char-1', {
        speaker: 'character',
        speakerId: 'char-1',
        speakerName: 'Character',
        utterance: 'test',
        timestamp: 1000,
      })
    })
  })

  describe('endConversation', () => {
    it('should clear NPC conversation state', () => {
      const goal = { goal: 'test', successCriteria: '' }
      manager.startConversation('char-1', 'npc-1', goal)
      manager.endConversation('char-1', true)

      const npc = worldState.getNPC('npc-1')!
      expect(npc.isInConversation).toBe(false)
    })

    it('should clear character conversation and emoji', () => {
      const goal = { goal: 'test', successCriteria: '' }
      manager.startConversation('char-1', 'npc-1', goal)
      manager.endConversation('char-1', true)

      const char = worldState.getCharacter('char-1')!
      expect(char.conversation).toBeNull()
      expect(char.displayEmoji).toBeUndefined()
    })

    it('should set goalAchieved on returned session', () => {
      const goal = { goal: 'test', successCriteria: '' }
      manager.startConversation('char-1', 'npc-1', goal)

      const session = manager.endConversation('char-1', true)
      expect(session!.goalAchieved).toBe(true)
      expect(session!.status).toBe('completed')
    })

    it('should fire onConversationEnd callback', () => {
      const callback = vi.fn()
      manager.setOnConversationEnd(callback)

      const goal = { goal: 'test', successCriteria: '' }
      manager.startConversation('char-1', 'npc-1', goal)
      manager.endConversation('char-1', false)

      expect(callback).toHaveBeenCalledTimes(1)
      expect(callback).toHaveBeenCalledWith(expect.objectContaining({
        characterId: 'char-1',
        status: 'completed',
        goalAchieved: false,
      }))
    })

    it('should return null if no active session', () => {
      const result = manager.endConversation('char-1', true)
      expect(result).toBeNull()
    })

    it('should remove session from active sessions', () => {
      const goal = { goal: 'test', successCriteria: '' }
      manager.startConversation('char-1', 'npc-1', goal)
      manager.endConversation('char-1', true)

      expect(manager.getActiveSession('char-1')).toBeNull()
    })
  })

  describe('getActiveSession', () => {
    it('should return active session', () => {
      const goal = { goal: 'test', successCriteria: '' }
      manager.startConversation('char-1', 'npc-1', goal)

      const session = manager.getActiveSession('char-1')
      expect(session).not.toBeNull()
      expect(session!.characterId).toBe('char-1')
    })

    it('should return null when no session', () => {
      expect(manager.getActiveSession('char-1')).toBeNull()
    })
  })

  describe('isAtMaxTurns', () => {
    it('should return false when under maxTurns', () => {
      const goal = { goal: 'test', successCriteria: '' }
      manager.startConversation('char-1', 'npc-1', goal)

      expect(manager.isAtMaxTurns('char-1')).toBe(false)
    })

    it('should return true when at maxTurns', () => {
      const goal = { goal: 'test', successCriteria: '' }
      manager.startConversation('char-1', 'npc-1', goal)

      // Add 20 messages (10 turns)
      for (let i = 0; i < 20; i++) {
        manager.addMessage('char-1', {
          speaker: i % 2 === 0 ? 'character' : 'npc',
          speakerId: i % 2 === 0 ? 'char-1' : 'npc-1',
          speakerName: `Speaker ${i}`,
          utterance: `Message ${i}`,
          timestamp: 1000 + i,
        })
      }

      expect(manager.isAtMaxTurns('char-1')).toBe(true)
    })

    it('should return false when no session', () => {
      expect(manager.isAtMaxTurns('char-1')).toBe(false)
    })
  })
})
