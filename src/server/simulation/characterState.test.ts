import { describe, it, expect } from 'vitest'
import {
  isCharacterIdle,
  isCharacterNavigating,
  isCharacterPerformingAction,
  isCharacterInConversation,
  canStartNewAction,
  needsBehaviorDecision,
} from './characterState'
import type { SimCharacter } from './types'

function createTestCharacter(overrides: Partial<SimCharacter> = {}): SimCharacter {
  return {
    id: 'char-1',
    name: 'Test',
    sprite: { sheetUrl: 'test.png', frameWidth: 96, frameHeight: 96, cols: 3, rows: 4, rowMapping: { down: 0, left: 1, right: 2, up: 3 } },
    money: 100,
    satiety: 80,
    energy: 80,
    hygiene: 80,
    mood: 80,
    bladder: 80,
    currentMapId: 'town',
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
    ...overrides,
  }
}

describe('characterState', () => {
  describe('isCharacterIdle', () => {
    it('should return true when character has no action, no conversation, and not moving', () => {
      const char = createTestCharacter()
      expect(isCharacterIdle(char)).toBe(true)
    })

    it('should return false when character has currentAction', () => {
      const char = createTestCharacter({
        currentAction: {
          actionId: 'eat',
          startTime: Date.now(),
          targetEndTime: Date.now() + 5000,
        },
      })
      expect(isCharacterIdle(char)).toBe(false)
    })

    it('should return false when character is in conversation', () => {
      const char = createTestCharacter({
        conversation: {
          id: 'conv-1',
          characterId: 'test',
          npcId: 'npc-1',
          goal: { goal: 'test', successCriteria: '' },
          messages: [],
          currentTurn: 0,
          maxTurns: 10,
          startTime: Date.now(),
          status: 'active',
          goalAchieved: false,
        },
      })
      expect(isCharacterIdle(char)).toBe(false)
    })

    it('should return false when character is moving', () => {
      const char = createTestCharacter({
        navigation: {
          isMoving: true,
          path: ['node-0-0', 'node-0-1'],
          currentPathIndex: 0,
          progress: 0.5,
          startPosition: { x: 0, y: 0 },
          targetPosition: { x: 100, y: 0 },
        },
      })
      expect(isCharacterIdle(char)).toBe(false)
    })

    it('should return true when conversation exists but is not active', () => {
      const char = createTestCharacter({
        conversation: {
          id: 'conv-1',
          characterId: 'test',
          npcId: 'npc-1',
          goal: { goal: 'test', successCriteria: '' },
          messages: [],
          currentTurn: 0,
          maxTurns: 10,
          startTime: Date.now(),
          status: 'completed',
          goalAchieved: true,
        },
      })
      expect(isCharacterIdle(char)).toBe(true)
    })
  })

  describe('isCharacterNavigating', () => {
    it('should return true when isMoving is true', () => {
      const char = createTestCharacter({
        navigation: {
          isMoving: true,
          path: [],
          currentPathIndex: 0,
          progress: 0,
          startPosition: null,
          targetPosition: null,
        },
      })
      expect(isCharacterNavigating(char)).toBe(true)
    })

    it('should return false when isMoving is false', () => {
      const char = createTestCharacter()
      expect(isCharacterNavigating(char)).toBe(false)
    })
  })

  describe('isCharacterPerformingAction', () => {
    it('should return true when currentAction is set', () => {
      const char = createTestCharacter({
        currentAction: {
          actionId: 'sleep',
          startTime: Date.now(),
          targetEndTime: Date.now() + 10000,
        },
      })
      expect(isCharacterPerformingAction(char)).toBe(true)
    })

    it('should return false when currentAction is null', () => {
      const char = createTestCharacter()
      expect(isCharacterPerformingAction(char)).toBe(false)
    })
  })

  describe('isCharacterInConversation', () => {
    it('should return true when conversation is active', () => {
      const char = createTestCharacter({
        conversation: {
          id: 'conv-1',
          characterId: 'test',
          npcId: 'npc-1',
          goal: { goal: 'test', successCriteria: '' },
          messages: [],
          currentTurn: 0,
          maxTurns: 10,
          startTime: Date.now(),
          status: 'active',
          goalAchieved: false,
        },
      })
      expect(isCharacterInConversation(char)).toBe(true)
    })

    it('should return false when conversation is null', () => {
      const char = createTestCharacter()
      expect(isCharacterInConversation(char)).toBe(false)
    })

    it('should return false when conversation is not active', () => {
      const char = createTestCharacter({
        conversation: {
          id: 'conv-1',
          characterId: 'test',
          npcId: 'npc-1',
          goal: { goal: 'test', successCriteria: '' },
          messages: [],
          currentTurn: 0,
          maxTurns: 10,
          startTime: Date.now(),
          status: 'completed',
          goalAchieved: true,
        },
      })
      expect(isCharacterInConversation(char)).toBe(false)
    })
  })

  describe('canStartNewAction', () => {
    it('should return true when idle and no pending action', () => {
      const char = createTestCharacter()
      expect(canStartNewAction(char)).toBe(true)
    })

    it('should return false when not idle', () => {
      const char = createTestCharacter({
        currentAction: {
          actionId: 'rest',
          startTime: Date.now(),
          targetEndTime: Date.now() + 5000,
        },
      })
      expect(canStartNewAction(char)).toBe(false)
    })

    it('should return false when has pending action', () => {
      const char = createTestCharacter({
        pendingAction: {
          actionId: 'eat',
          facilityMapId: 'home',
        },
      })
      expect(canStartNewAction(char)).toBe(false)
    })
  })

  describe('needsBehaviorDecision', () => {
    it('should return true when can start new action and no cross-map nav', () => {
      const char = createTestCharacter()
      expect(needsBehaviorDecision(char)).toBe(true)
    })

    it('should return false when cannot start new action', () => {
      const char = createTestCharacter({
        currentAction: {
          actionId: 'work',
          startTime: Date.now(),
          targetEndTime: Date.now() + 5000,
        },
      })
      expect(needsBehaviorDecision(char)).toBe(false)
    })

    it('should return false when cross-map navigation is active', () => {
      const char = createTestCharacter({
        crossMapNavigation: {
          isActive: true,
          targetMapId: 'cafe',
          targetNodeId: 'node-1-1',
          route: { segments: [] },
          currentSegmentIndex: 0,
        },
      })
      expect(needsBehaviorDecision(char)).toBe(false)
    })

    it('should return true when cross-map navigation is not active', () => {
      const char = createTestCharacter({
        crossMapNavigation: {
          isActive: false,
          targetMapId: 'cafe',
          targetNodeId: 'node-1-1',
          route: { segments: [] },
          currentSegmentIndex: 0,
        },
      })
      expect(needsBehaviorDecision(char)).toBe(true)
    })
  })
})
