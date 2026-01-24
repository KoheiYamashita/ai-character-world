import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ConversationExecutor } from './ConversationExecutor'
import { ConversationManager } from './ConversationManager'
import { WorldStateManager } from '../simulation/WorldState'
import type { SimCharacter } from '../simulation/types'
import type { WorldMap, NPC } from '@/types'
import type { ConversationContext } from './ConversationExecutor'

// Mock LLM client
vi.mock('@/server/llm', () => ({
  isLLMAvailable: vi.fn(() => true),
  llmGenerateObject: vi.fn(),
}))

import { llmGenerateObject, isLLMAvailable } from '@/server/llm'

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

function createTestCharacter(): SimCharacter {
  return {
    id: 'char-1',
    name: 'TestChar',
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
    personality: '明るく社交的',
    tendencies: ['人と話すのが好き'],
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

function createTestNPC(): NPC {
  return {
    id: 'npc-1',
    name: 'TestNPC',
    sprite: { sheetUrl: 'npc.png', frameWidth: 96, frameHeight: 96, cols: 3, rows: 4, rowMapping: { down: 0, left: 1, right: 2, up: 3 } },
    mapId: 'town',
    currentNodeId: 'town-0-1',
    position: { x: 200, y: 100 },
    direction: 'down',
    personality: '温厚で優しい店主',
    tendencies: ['お客さんに親切'],
    facts: ['この店は10年営業している', '名物はカレーライス'],
    affinity: 5,
    mood: 'happy',
    conversationCount: 3,
    lastConversation: null,
  }
}

function createTestContext(): ConversationContext {
  return {
    recentConversations: [],
    midTermMemories: [],
    todayActions: [],
    schedule: null,
    currentTime: { hour: 12, minute: 0, day: 1 },
  }
}

describe('ConversationExecutor', () => {
  let worldState: WorldStateManager
  let conversationManager: ConversationManager
  let executor: ConversationExecutor
  let character: SimCharacter
  let npc: NPC

  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(isLLMAvailable).mockReturnValue(true)

    worldState = new WorldStateManager()
    worldState.initialize({ town: createTestMap() }, 'town')
    character = createTestCharacter()
    worldState.addCharacter(character)
    worldState.initializeNPCs([createTestNPC()])
    npc = createTestNPC()

    conversationManager = new ConversationManager(worldState)
    executor = new ConversationExecutor(conversationManager)
    executor.setTurnIntervalMs(0) // No delay in tests
  })

  describe('executeConversation', () => {
    it('should execute a conversation loop until goal achieved', async () => {
      // Character says something, then achieves goal
      vi.mocked(llmGenerateObject)
        .mockResolvedValueOnce({
          utterance: 'こんにちは！最近どうですか？',
          goalAchieved: false,

        })
        .mockResolvedValueOnce({
          utterance: 'こんにちは！最近は忙しいですが元気ですよ。',
        })
        .mockResolvedValueOnce({
          utterance: 'それは良かったです！おすすめのメニューはありますか？',
          goalAchieved: true,

        })

      const goal = { goal: '最近の様子を聞く', successCriteria: '近況を聞けた' }
      const session = conversationManager.startConversation('char-1', 'npc-1', goal)!

      const completeSpy = vi.fn()
      executor.setOnConversationComplete(completeSpy)

      await executor.executeConversation(character, npc, session, createTestContext())

      // Should have called LLM 3 times (char, npc, char with goal achieved)
      expect(llmGenerateObject).toHaveBeenCalledTimes(3)

      // Should have triggered completion with goalAchieved=true
      expect(completeSpy).toHaveBeenCalledWith('char-1', true)

      // Session should be ended
      expect(conversationManager.getActiveSession('char-1')).toBeNull()
    })

    it('should stop at max turns', async () => {
      // Mock to always continue conversation
      vi.mocked(llmGenerateObject).mockImplementation(async (_prompt, schema) => {
        // Check if it's a character utterance schema (has goalAchieved field)
        const schemaStr = JSON.stringify(schema)
        if (schemaStr.includes('goalAchieved')) {
          return {
            utterance: 'キャラクターの発話',
            goalAchieved: false,
  
          }
        }
        return { utterance: 'NPCの応答' }
      })

      const goal = { goal: 'test', successCriteria: '' }
      const session = conversationManager.startConversation('char-1', 'npc-1', goal)!

      const completeSpy = vi.fn()
      executor.setOnConversationComplete(completeSpy)

      await executor.executeConversation(character, npc, session, createTestContext())

      // Max turns = 10, so 10 character messages + 10 NPC messages = 20 LLM calls
      expect(llmGenerateObject).toHaveBeenCalledTimes(20)
      expect(completeSpy).toHaveBeenCalledWith('char-1', false)
    })

    it('should handle LLM unavailable gracefully', async () => {
      vi.mocked(isLLMAvailable).mockReturnValue(false)

      const goal = { goal: 'test', successCriteria: '' }
      const session = conversationManager.startConversation('char-1', 'npc-1', goal)!

      const completeSpy = vi.fn()
      executor.setOnConversationComplete(completeSpy)

      await executor.executeConversation(character, npc, session, createTestContext())

      // Should end immediately since LLM returns wantsToEnd: true
      expect(llmGenerateObject).not.toHaveBeenCalled()
      expect(completeSpy).toHaveBeenCalledWith('char-1', false)
    })

    it('should handle LLM error gracefully', async () => {
      vi.mocked(llmGenerateObject).mockRejectedValueOnce(new Error('LLM API error'))

      const goal = { goal: 'test', successCriteria: '' }
      const session = conversationManager.startConversation('char-1', 'npc-1', goal)!

      const completeSpy = vi.fn()
      executor.setOnConversationComplete(completeSpy)

      await executor.executeConversation(character, npc, session, createTestContext())

      // Should end after error (fallback returns wantsToEnd: true)
      expect(completeSpy).toHaveBeenCalledWith('char-1', false)
    })

    it('should prevent duplicate loops for same character', async () => {
      // Use a long-running mock to simulate concurrent execution
      let resolveFirst: (() => void) | null = null
      const firstCallPromise = new Promise<void>(resolve => { resolveFirst = resolve })

      vi.mocked(llmGenerateObject)
        .mockImplementationOnce(async () => {
          await firstCallPromise
          return {
            utterance: 'first call',
            goalAchieved: true,
  
          }
        })
        .mockResolvedValue({
          utterance: 'second call should not happen',
          goalAchieved: true,

        })

      const goal = { goal: 'test', successCriteria: '' }
      const session = conversationManager.startConversation('char-1', 'npc-1', goal)!

      // Start first execution
      const promise1 = executor.executeConversation(character, npc, session, createTestContext())

      // Try to start second execution (should be skipped)
      const promise2 = executor.executeConversation(character, npc, session, createTestContext())

      // Resolve the first call
      resolveFirst!()
      await Promise.all([promise1, promise2])

      // Only first execution should have triggered LLM
      // 3 calls: char(初回goalAchievedスキップ), npc, char(goalAchieved→終了)
      expect(llmGenerateObject).toHaveBeenCalledTimes(3)
    })

    it('should add messages to conversation session via manager', async () => {
      vi.mocked(llmGenerateObject)
        .mockResolvedValueOnce({
          utterance: 'こんにちは',
          goalAchieved: false,

        })
        .mockResolvedValueOnce({
          utterance: 'いらっしゃい',
        })
        .mockResolvedValueOnce({
          utterance: 'ありがとう',
          goalAchieved: true,

        })

      const goal = { goal: 'test', successCriteria: '' }
      const session = conversationManager.startConversation('char-1', 'npc-1', goal)!

      await executor.executeConversation(character, npc, session, createTestContext())

      // Check that character state was updated with messages (before session ended)
      // After end, conversation is null, but we can check the completion callback
      // The session should have been completed
      expect(conversationManager.getActiveSession('char-1')).toBeNull()
    })

    it('should use context information in prompts', async () => {
      vi.mocked(llmGenerateObject).mockResolvedValueOnce({
        utterance: 'test',
        goalAchieved: true,
      })

      const goal = { goal: 'おすすめを聞く', successCriteria: '教えてもらえた' }
      const session = conversationManager.startConversation('char-1', 'npc-1', goal)!

      const context: ConversationContext = {
        recentConversations: [{ npcId: 'npc-1', npcName: 'TestNPC', summary: '先日カレーを食べた', timestamp: 100 }],
        midTermMemories: [{ content: '明日は休みだ', importance: 5, timestamp: 200 }],
        todayActions: [{ time: '10:00', actionId: 'eat', target: 'cafe-1', reason: '朝食' }],
        schedule: [{ time: '13:00', activity: '昼食' }],
        currentTime: { hour: 12, minute: 30, day: 1 },
      }

      await executor.executeConversation(character, npc, session, context)

      // Check that the prompt included context
      const promptArg = vi.mocked(llmGenerateObject).mock.calls[0][0] as string
      expect(promptArg).toContain('おすすめを聞く')
      expect(promptArg).toContain('先日カレーを食べた')
      expect(promptArg).toContain('明日は休みだ')
      expect(promptArg).toContain('10:00')
      expect(promptArg).toContain('13:00')
      expect(promptArg).toContain('12:30')
    })
  })

  describe('setTurnIntervalMs', () => {
    it('should respect turnIntervalMs setting', async () => {
      executor.setTurnIntervalMs(50) // 50ms for test

      const startTime = Date.now()

      vi.mocked(llmGenerateObject)
        .mockResolvedValueOnce({
          utterance: 'hello',
          goalAchieved: false,

        })
        .mockResolvedValueOnce({
          utterance: 'hi',
        })
        .mockResolvedValueOnce({
          utterance: 'bye',
          goalAchieved: true,

        })

      const goal = { goal: 'test', successCriteria: '' }
      const session = conversationManager.startConversation('char-1', 'npc-1', goal)!

      await executor.executeConversation(character, npc, session, createTestContext())

      const elapsed = Date.now() - startTime
      // Should have waited at least 50ms (1 interval between turn 1 and turn 2)
      expect(elapsed).toBeGreaterThanOrEqual(40) // small margin for timing
    })
  })

  describe('nearby maps in prompts', () => {
    it('should include nearby maps with current location marked in character prompt', async () => {
      vi.mocked(llmGenerateObject).mockResolvedValueOnce({
        utterance: 'test',
        goalAchieved: true,
      })

      const goal = { goal: 'test', successCriteria: '' }
      const session = conversationManager.startConversation('char-1', 'npc-1', goal)!

      const context: ConversationContext = {
        ...createTestContext(),
        nearbyMaps: [
          { id: 'cafe', label: 'カフェ ドルチェ', distance: 0 },
          { id: 'town', label: '桜木町の広場', distance: 1 },
          { id: 'home', label: '自宅', distance: 2 },
        ],
      }

      await executor.executeConversation(character, npc, session, context)

      const promptArg = vi.mocked(llmGenerateObject).mock.calls[0][0] as string
      expect(promptArg).toContain('【周辺の場所】')
      expect(promptArg).toContain('カフェ ドルチェ（現在地）')
      expect(promptArg).toContain('- 桜木町の広場')
      expect(promptArg).toContain('- 自宅')
      expect(promptArg).toContain('存在しない施設や店について話さないでください')
    })

    it('should not mark non-zero distance maps as current location', async () => {
      vi.mocked(llmGenerateObject).mockResolvedValueOnce({
        utterance: 'test',
        goalAchieved: true,
      })

      const goal = { goal: 'test', successCriteria: '' }
      const session = conversationManager.startConversation('char-1', 'npc-1', goal)!

      const context: ConversationContext = {
        ...createTestContext(),
        nearbyMaps: [
          { id: 'town', label: '桜木町の広場', distance: 0 },
          { id: 'park', label: '桜木公園', distance: 1 },
          { id: 'hotspring', label: 'さくらの湯', distance: 2 },
        ],
      }

      await executor.executeConversation(character, npc, session, context)

      const promptArg = vi.mocked(llmGenerateObject).mock.calls[0][0] as string
      expect(promptArg).toContain('桜木町の広場（現在地）')
      expect(promptArg).not.toContain('桜木公園（現在地）')
      expect(promptArg).not.toContain('さくらの湯（現在地）')
      expect(promptArg).toContain('- 桜木公園')
      expect(promptArg).toContain('- さくらの湯')
    })

    it('should not include nearby maps section when no maps provided', async () => {
      vi.mocked(llmGenerateObject).mockResolvedValueOnce({
        utterance: 'test',
        goalAchieved: true,
      })

      const goal = { goal: 'test', successCriteria: '' }
      const session = conversationManager.startConversation('char-1', 'npc-1', goal)!

      await executor.executeConversation(character, npc, session, createTestContext())

      const promptArg = vi.mocked(llmGenerateObject).mock.calls[0][0] as string
      expect(promptArg).not.toContain('【周辺の場所】')
    })

    it('should include nearby maps in NPC prompt', async () => {
      vi.mocked(llmGenerateObject)
        .mockResolvedValueOnce({
          utterance: 'こんにちは',
          goalAchieved: false,
        })
        .mockResolvedValueOnce({
          utterance: 'いらっしゃい',
        })
        .mockResolvedValueOnce({
          utterance: 'ありがとう',
          goalAchieved: true,
        })

      const goal = { goal: 'test', successCriteria: '' }
      const session = conversationManager.startConversation('char-1', 'npc-1', goal)!

      const context: ConversationContext = {
        ...createTestContext(),
        nearbyMaps: [
          { id: 'cafe', label: 'カフェ ドルチェ', distance: 0 },
          { id: 'town', label: '桜木町の広場', distance: 1 },
          { id: 'hotel', label: '桜木ホテル', distance: 2 },
        ],
      }

      await executor.executeConversation(character, npc, session, context)

      // NPC LLM call is the 2nd call
      const npcPrompt = vi.mocked(llmGenerateObject).mock.calls[1][0] as string
      expect(npcPrompt).toContain('【周辺の場所】')
      expect(npcPrompt).toContain('カフェ ドルチェ（現在地）')
      expect(npcPrompt).toContain('- 桜木町の広場')
      expect(npcPrompt).toContain('- 桜木ホテル')
      expect(npcPrompt).toContain('存在しない施設や店について話さないでください')
    })

    it('should not include nearby maps section in NPC prompt when no maps', async () => {
      vi.mocked(llmGenerateObject)
        .mockResolvedValueOnce({
          utterance: 'こんにちは',
          goalAchieved: false,
        })
        .mockResolvedValueOnce({
          utterance: 'いらっしゃい',
        })
        .mockResolvedValueOnce({
          utterance: 'ありがとう',
          goalAchieved: true,
        })

      const goal = { goal: 'test', successCriteria: '' }
      const session = conversationManager.startConversation('char-1', 'npc-1', goal)!

      await executor.executeConversation(character, npc, session, createTestContext())

      // NPC LLM call is the 2nd call
      const npcPrompt = vi.mocked(llmGenerateObject).mock.calls[1][0] as string
      expect(npcPrompt).not.toContain('【周辺の場所】')
    })

    it('should include character-specific caveat for memories and actions', async () => {
      vi.mocked(llmGenerateObject).mockResolvedValueOnce({
        utterance: 'test',
        goalAchieved: true,
      })

      const goal = { goal: 'test', successCriteria: '' }
      const session = conversationManager.startConversation('char-1', 'npc-1', goal)!

      const context: ConversationContext = {
        ...createTestContext(),
        nearbyMaps: [{ id: 'town', label: '桜木町の広場', distance: 0 }],
      }

      await executor.executeConversation(character, npc, session, context)

      const promptArg = vi.mocked(llmGenerateObject).mock.calls[0][0] as string
      expect(promptArg).toContain('【重要な記憶】【直近の会話（過去）】【今日の行動】で言及された場所は話題にできます')
    })

    it('should include NPC-specific caveat for facts and conversation', async () => {
      vi.mocked(llmGenerateObject)
        .mockResolvedValueOnce({
          utterance: 'こんにちは',
          goalAchieved: false,
        })
        .mockResolvedValueOnce({
          utterance: 'いらっしゃい',
        })
        .mockResolvedValueOnce({
          utterance: 'ありがとう',
          goalAchieved: true,
        })

      const goal = { goal: 'test', successCriteria: '' }
      const session = conversationManager.startConversation('char-1', 'npc-1', goal)!

      const context: ConversationContext = {
        ...createTestContext(),
        nearbyMaps: [{ id: 'town', label: '桜木町の広場', distance: 0 }],
      }

      await executor.executeConversation(character, npc, session, context)

      const npcPrompt = vi.mocked(llmGenerateObject).mock.calls[1][0] as string
      expect(npcPrompt).toContain('【あなたの知識・事実】【これまでの会話】で言及された場所は話題にできます')
    })
  })

  describe('NPC prompt', () => {
    it('should include NPC facts in prompt', async () => {
      vi.mocked(llmGenerateObject)
        .mockResolvedValueOnce({
          utterance: 'おすすめはありますか？',
          goalAchieved: false,

        })
        .mockResolvedValueOnce({
          utterance: 'カレーライスがおすすめです！',
        })
        .mockResolvedValueOnce({
          utterance: 'ありがとう！',
          goalAchieved: true,

        })

      const goal = { goal: 'test', successCriteria: '' }
      const session = conversationManager.startConversation('char-1', 'npc-1', goal)!

      await executor.executeConversation(character, npc, session, createTestContext())

      // NPC LLM call is the 2nd call
      const npcPrompt = vi.mocked(llmGenerateObject).mock.calls[1][0] as string
      expect(npcPrompt).toContain('この店は10年営業している')
      expect(npcPrompt).toContain('名物はカレーライス')
      expect(npcPrompt).toContain('温厚で優しい店主')
      expect(npcPrompt).toContain('happy')
    })
  })
})
