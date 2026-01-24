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
    facts: ['この店は10年営業している', '名物はカレーライス'],
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
    vi.mocked(llmGenerateObject).mockResolvedValueOnce({
      summary: '店主と挨拶を交わした',
      affinityChange: 5,
      updatedFacts: ['この店は10年営業している', '名物はカレーライス', 'TestCharは常連客'],
      mood: 'happy',
      topicsDiscussed: ['挨拶', '店の雰囲気'],
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
      facts: ['この店は10年営業している', '名物はカレーライス', 'TestCharは常連客'],
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
      facts: ['この店は10年営業している', '名物はカレーライス', 'TestCharは常連客'],
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
    vi.mocked(llmGenerateObject).mockResolvedValueOnce({
      summary: '新しい情報を得た',
      affinityChange: 0,
      updatedFacts: ['全く新しいfact1', '全く新しいfact2'],
      mood: 'neutral',
      topicsDiscussed: ['新情報'],
    })

    const session = createTestSession()
    const npc = createTestNPC({ facts: ['古いfact1', '古いfact2', '古いfact3'] })
    const character = createTestCharacter()

    await processor.process(session, npc, character)

    // Facts should be entirely replaced
    expect(npcUpdateSpy).toHaveBeenCalledWith('npc-1', expect.objectContaining({
      facts: ['全く新しいfact1', '全く新しいfact2'],
    }))
  })

  it('should clamp affinity within -100 to 100', async () => {
    vi.mocked(llmGenerateObject).mockResolvedValueOnce({
      summary: 'とても良い会話',
      affinityChange: 20,
      updatedFacts: [],
      mood: 'happy',
      topicsDiscussed: [],
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
      updatedFacts: ['fact'],
      mood: 'happy',
      topicsDiscussed: ['test'],
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
      updatedFacts: ['fact1', 'fact2'],
      mood: 'neutral',
      topicsDiscussed: [],
    })

    const session = createTestSession()
    const npc = createTestNPC({ facts: ['特別なfact'] })
    const character = createTestCharacter()

    await processor.process(session, npc, character)

    const prompt = vi.mocked(llmGenerateObject).mock.calls[0][0] as string
    expect(prompt).toContain('特別なfact')
    expect(prompt).toContain('TestNPC')
    expect(prompt).toContain('TestChar')
    expect(prompt).toContain('最近の様子を聞く')
  })
})
