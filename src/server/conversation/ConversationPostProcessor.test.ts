import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ConversationPostProcessor } from './ConversationPostProcessor'
import type { ConversationSession, NPC } from '@/types'
import type { SimCharacter } from '@/server/simulation/types'

// Mock LLM client
vi.mock('@/server/llm', () => ({
  isLLMAvailable: vi.fn(() => true),
  llmGenerateObject: vi.fn(),
}))

import { llmGenerateObject } from '@/server/llm'

function createTestSession(overrides?: Partial<ConversationSession>): ConversationSession {
  return {
    id: 'session-1',
    characterId: 'char-1',
    npcId: 'npc-1',
    goal: { goal: '最近の様子を聞く', successCriteria: '近況を聞けた' },
    messages: [
      { speaker: 'character', speakerId: 'char-1', speakerName: 'TestChar', utterance: 'こんにちは！', timestamp: 1000 },
      { speaker: 'npc', speakerId: 'npc-1', speakerName: 'TestNPC', utterance: 'いらっしゃい！', timestamp: 1001 },
    ],
    currentTurn: 1,
    maxTurns: 10,
    startTime: 1000,
    status: 'completed',
    goalAchieved: true,
    ...overrides,
  }
}

function createTestNPC(overrides?: Partial<NPC>): NPC {
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
    facts: [
      { content: 'この店は10年営業している', expiresDay: null },
      { content: '名物はカレーライス', expiresDay: null },
    ],
    affinity: 5,
    mood: 'neutral',
    conversationCount: 3,
    lastConversation: null,
    ...overrides,
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

describe('ConversationPostProcessor', () => {
  let processor: ConversationPostProcessor
  let npcUpdateSpy: ReturnType<typeof vi.fn>
  let summaryPersistSpy: ReturnType<typeof vi.fn>
  let npcStatePersistSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})

    processor = new ConversationPostProcessor()
    npcUpdateSpy = vi.fn()
    summaryPersistSpy = vi.fn().mockResolvedValue(undefined)
    npcStatePersistSpy = vi.fn().mockResolvedValue(undefined)

    processor.setOnNPCUpdate(npcUpdateSpy)
    processor.setOnSummaryPersist(summaryPersistSpy)
    processor.setOnNPCStatePersist(npcStatePersistSpy)
  })

  it('should extract summary and update NPC state on normal conversation', async () => {
    const updatedFactsFromLLM = [
      { content: 'この店は10年営業している', expiresDay: null },
      { content: '名物はカレーライス', expiresDay: null },
      { content: 'TestCharは常連客', expiresDay: null },
    ]
    vi.mocked(llmGenerateObject).mockResolvedValueOnce({
      summary: '店主と挨拶を交わした',
      affinityChange: 5,
      updatedFacts: updatedFactsFromLLM,
      mood: 'happy',
      topicsDiscussed: ['挨拶', '店の雰囲気'],
      consolidatedMemories: [],
    })

    const session = createTestSession()
    const npc = createTestNPC()
    const character = createTestCharacter()

    const result = await processor.process(session, npc, character)

    expect(result).not.toBeNull()
    expect(result!.summary).toBe('店主と挨拶を交わした')
    expect(result!.affinityChange).toBe(5)
    expect(result!.mood).toBe('happy')

    // NPC update callback
    expect(npcUpdateSpy).toHaveBeenCalledWith('npc-1', {
      facts: updatedFactsFromLLM,
      affinity: 10, // 5 + 5
      mood: 'happy',
      conversationCount: 4, // 3 + 1
      lastConversation: expect.any(Number),
    })

    // Summary persist callback
    expect(summaryPersistSpy).toHaveBeenCalledWith({
      characterId: 'char-1',
      npcId: 'npc-1',
      npcName: 'TestNPC',
      goal: '最近の様子を聞く',
      summary: '店主と挨拶を交わした',
      topics: ['挨拶', '店の雰囲気'],
      goalAchieved: true,
      timestamp: expect.any(Number),
      affinityChange: 5,
      mood: 'happy',
    })

    // NPC state persist callback
    expect(npcStatePersistSpy).toHaveBeenCalledWith('npc-1', {
      affinity: 10,
      mood: 'happy',
      facts: updatedFactsFromLLM,
      conversationCount: 4,
      lastConversation: expect.any(Number),
    })
  })

  it('should skip processing when no messages', async () => {
    const session = createTestSession({ messages: [] })
    const npc = createTestNPC()
    const character = createTestCharacter()

    const result = await processor.process(session, npc, character)

    expect(result).toBeNull()
    expect(llmGenerateObject).not.toHaveBeenCalled()
    expect(npcUpdateSpy).not.toHaveBeenCalled()
    expect(summaryPersistSpy).not.toHaveBeenCalled()
    expect(npcStatePersistSpy).not.toHaveBeenCalled()
  })

  it('should replace facts entirely with LLM output', async () => {
    const newFacts = [
      { content: '全く新しいfact1', expiresDay: null },
      { content: '全く新しいfact2', expiresDay: null },
    ]
    vi.mocked(llmGenerateObject).mockResolvedValueOnce({
      summary: '新しい情報を得た',
      affinityChange: 0,
      updatedFacts: newFacts,
      mood: 'neutral',
      topicsDiscussed: ['新情報'],
      consolidatedMemories: [],
    })

    const session = createTestSession()
    const npc = createTestNPC({
      facts: [
        { content: '古いfact1', expiresDay: null },
        { content: '古いfact2', expiresDay: null },
        { content: '古いfact3', expiresDay: null },
      ],
    })
    const character = createTestCharacter()

    await processor.process(session, npc, character)

    // Facts should be entirely replaced
    expect(npcUpdateSpy).toHaveBeenCalledWith('npc-1', expect.objectContaining({
      facts: newFacts,
    }))
  })

  it('should clamp affinity within -100 to 100', async () => {
    vi.mocked(llmGenerateObject).mockResolvedValueOnce({
      summary: 'とても良い会話',
      affinityChange: 20,
      updatedFacts: [],
      mood: 'happy',
      topicsDiscussed: [],
      consolidatedMemories: [],
    })

    const session = createTestSession()
    const npc = createTestNPC({ affinity: 90 }) // 90 + 20 = 110 → clamped to 100
    const character = createTestCharacter()

    await processor.process(session, npc, character)

    expect(npcUpdateSpy).toHaveBeenCalledWith('npc-1', expect.objectContaining({
      affinity: 100,
    }))
  })

  it('should clamp negative affinity within -100 to 100', async () => {
    vi.mocked(llmGenerateObject).mockResolvedValueOnce({
      summary: 'ひどい会話',
      affinityChange: -20,
      updatedFacts: [],
      mood: 'angry',
      topicsDiscussed: [],
      consolidatedMemories: [],
    })

    const session = createTestSession()
    const npc = createTestNPC({ affinity: -90 }) // -90 + (-20) = -110 → clamped to -100
    const character = createTestCharacter()

    await processor.process(session, npc, character)

    expect(npcUpdateSpy).toHaveBeenCalledWith('npc-1', expect.objectContaining({
      affinity: -100,
    }))
  })

  it('should accumulate affinity correctly', async () => {
    vi.mocked(llmGenerateObject).mockResolvedValueOnce({
      summary: '普通の会話',
      affinityChange: 10,
      updatedFacts: [],
      mood: 'neutral',
      topicsDiscussed: [],
      consolidatedMemories: [],
    })

    const session = createTestSession()
    const npc = createTestNPC({ affinity: 30 }) // 30 + 10 = 40
    const character = createTestCharacter()

    await processor.process(session, npc, character)

    expect(npcUpdateSpy).toHaveBeenCalledWith('npc-1', expect.objectContaining({
      affinity: 40,
    }))
  })

  it('should work without callbacks set', async () => {
    const processorNoCb = new ConversationPostProcessor()

    vi.mocked(llmGenerateObject).mockResolvedValueOnce({
      summary: 'テスト',
      affinityChange: 5,
      updatedFacts: [{ content: 'fact', expiresDay: null }],
      mood: 'happy',
      topicsDiscussed: ['test'],
      consolidatedMemories: [],
    })

    const session = createTestSession()
    const npc = createTestNPC()
    const character = createTestCharacter()

    const result = await processorNoCb.process(session, npc, character)

    expect(result).not.toBeNull()
    expect(result!.summary).toBe('テスト')
  })

  it('should include NPC facts in extraction prompt', async () => {
    vi.mocked(llmGenerateObject).mockResolvedValueOnce({
      summary: 'test',
      affinityChange: 0,
      updatedFacts: [{ content: 'fact1', expiresDay: null }, { content: 'fact2', expiresDay: null }],
      mood: 'neutral',
      topicsDiscussed: [],
      consolidatedMemories: [],
    })

    const session = createTestSession()
    const npc = createTestNPC({ facts: [{ content: '特別なfact', expiresDay: null }] })
    const character = createTestCharacter()

    await processor.process(session, npc, character)

    const prompt = vi.mocked(llmGenerateObject).mock.calls[0][0] as string
    expect(prompt).toContain('特別なfact')
    expect(prompt).toContain('TestNPC')
    expect(prompt).toContain('TestChar')
    expect(prompt).toContain('最近の様子を聞く')
  })

  describe('mid-term memory consolidation', () => {
    it('should call memory replace callback with consolidated memories', async () => {
      const memoryReplaceSpy = vi.fn().mockResolvedValue(undefined)
      processor.setOnMemoryReplace(memoryReplaceSpy)

      vi.mocked(llmGenerateObject).mockResolvedValueOnce({
        summary: 'カフェで待ち合わせの約束をした',
        affinityChange: 5,
        updatedFacts: [
          { content: 'この店は10年営業している', expiresDay: null },
          { content: '名物はカレーライス', expiresDay: null },
        ],
        mood: 'happy',
        topicsDiscussed: ['待ち合わせ'],
        consolidatedMemories: [
          { content: '明日14時にカフェで待ち合わせ', importance: 'high' },
          { content: 'NPCは水曜日が定休日', importance: 'medium' },
        ],
      })

      const session = createTestSession()
      const npc = createTestNPC()
      const character = createTestCharacter()
      const currentTime = { hour: 12, minute: 0, day: 5 }

      await processor.process(session, npc, character, currentTime)

      expect(memoryReplaceSpy).toHaveBeenCalledTimes(1)
      const [characterId, memories] = memoryReplaceSpy.mock.calls[0]
      expect(characterId).toBe('char-1')
      expect(memories).toHaveLength(2)

      expect(memories[0]).toEqual(expect.objectContaining({
        characterId: 'char-1',
        content: '明日14時にカフェで待ち合わせ',
        importance: 'high',
        createdDay: 5,
        expiresDay: 7, // high: +2
        sourceNpcId: 'npc-1',
      }))
      expect(memories[1]).toEqual(expect.objectContaining({
        characterId: 'char-1',
        content: 'NPCは水曜日が定休日',
        importance: 'medium',
        createdDay: 5,
        expiresDay: 6, // medium: +1
        sourceNpcId: 'npc-1',
      }))
    })

    it('should set expiresDay based on importance', async () => {
      const memoryReplaceSpy = vi.fn().mockResolvedValue(undefined)
      processor.setOnMemoryReplace(memoryReplaceSpy)

      vi.mocked(llmGenerateObject).mockResolvedValueOnce({
        summary: 'test',
        affinityChange: 0,
        updatedFacts: [],
        mood: 'neutral',
        topicsDiscussed: [],
        consolidatedMemories: [
          { content: 'low importance', importance: 'low' },
          { content: 'medium importance', importance: 'medium' },
          { content: 'high importance', importance: 'high' },
        ],
      })

      const session = createTestSession()
      const npc = createTestNPC()
      const character = createTestCharacter()
      const currentTime = { hour: 10, minute: 0, day: 3 }

      await processor.process(session, npc, character, currentTime)

      const [, memories] = memoryReplaceSpy.mock.calls[0]
      expect(memories[0].expiresDay).toBe(3) // low: +0
      expect(memories[1].expiresDay).toBe(4) // medium: +1
      expect(memories[2].expiresDay).toBe(5) // high: +2
    })

    it('should not call memory replace callback when consolidatedMemories array is empty', async () => {
      const memoryReplaceSpy = vi.fn().mockResolvedValue(undefined)
      processor.setOnMemoryReplace(memoryReplaceSpy)

      vi.mocked(llmGenerateObject).mockResolvedValueOnce({
        summary: '普通の挨拶',
        affinityChange: 2,
        updatedFacts: [
          { content: 'この店は10年営業している', expiresDay: null },
          { content: '名物はカレーライス', expiresDay: null },
        ],
        mood: 'neutral',
        topicsDiscussed: ['挨拶'],
        consolidatedMemories: [],
      })

      const session = createTestSession()
      const npc = createTestNPC()
      const character = createTestCharacter()
      const currentTime = { hour: 12, minute: 0, day: 1 }

      await processor.process(session, npc, character, currentTime)

      // Should still be called but with empty array (replace behavior)
      expect(memoryReplaceSpy).toHaveBeenCalledWith('char-1', [])
    })

    it('should not call memory replace callback when currentTime is not provided', async () => {
      const memoryReplaceSpy = vi.fn().mockResolvedValue(undefined)
      processor.setOnMemoryReplace(memoryReplaceSpy)

      vi.mocked(llmGenerateObject).mockResolvedValueOnce({
        summary: 'test',
        affinityChange: 0,
        updatedFacts: [],
        mood: 'neutral',
        topicsDiscussed: [],
        consolidatedMemories: [{ content: 'some memory', importance: 'high' }],
      })

      const session = createTestSession()
      const npc = createTestNPC()
      const character = createTestCharacter()

      // No currentTime provided
      await processor.process(session, npc, character)

      expect(memoryReplaceSpy).not.toHaveBeenCalled()
    })

    it('should generate unique memory ids', async () => {
      const memoryReplaceSpy = vi.fn().mockResolvedValue(undefined)
      processor.setOnMemoryReplace(memoryReplaceSpy)

      vi.mocked(llmGenerateObject).mockResolvedValueOnce({
        summary: 'test',
        affinityChange: 0,
        updatedFacts: [],
        mood: 'neutral',
        topicsDiscussed: [],
        consolidatedMemories: [
          { content: 'memory 1', importance: 'low' },
          { content: 'memory 2', importance: 'high' },
        ],
      })

      const session = createTestSession()
      const npc = createTestNPC()
      const character = createTestCharacter()
      const currentTime = { hour: 12, minute: 0, day: 1 }

      await processor.process(session, npc, character, currentTime)

      const [, memories] = memoryReplaceSpy.mock.calls[0]
      expect(memories[0].id).not.toBe(memories[1].id)
    })

    it('should include consolidatedMemories instruction in prompt', async () => {
      vi.mocked(llmGenerateObject).mockResolvedValueOnce({
        summary: 'test',
        affinityChange: 0,
        updatedFacts: [],
        mood: 'neutral',
        topicsDiscussed: [],
        consolidatedMemories: [],
      })

      const session = createTestSession()
      const npc = createTestNPC()
      const character = createTestCharacter()

      await processor.process(session, npc, character)

      const prompt = vi.mocked(llmGenerateObject).mock.calls[0][0] as string
      expect(prompt).toContain('consolidatedMemories')
      expect(prompt).toContain('統合')
    })
  })
})
