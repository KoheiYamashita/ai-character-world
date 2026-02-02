/**
 * ConversationExecutor プロンプト出力のスナップショットテスト
 * リファクタリング前後でプロンプト出力が変わらないことを保証する
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ConversationExecutor } from './ConversationExecutor'
import { ConversationManager } from './ConversationManager'
import { WorldStateManager } from '../simulation/WorldState'
import type { SimCharacter } from '../simulation/types'
import type { WorldMap, NPC, ConversationSession } from '@/types'
import type { ConversationContext } from './ConversationExecutor'

// Mock LLM client (not used in prompt building, but required for constructor)
vi.mock('@/server/llm', () => ({
  isLLMAvailable: vi.fn(() => true),
  llmGenerateObject: vi.fn(),
}))

// =============================================================================
// テストデータ作成ヘルパー
// =============================================================================

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

function createTestCharacter(overrides: Partial<SimCharacter> = {}): SimCharacter {
  return {
    id: 'char-1',
    name: '花子',
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
    personality: '明るく社交的な性格。好奇心旺盛で新しいことに挑戦するのが好き。',
    tendencies: ['朝型で早起きが得意', 'カフェで過ごすことが多い'],
    customPrompt: '一人称は「わたし」を使う',
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

function createTestNPC(overrides: Partial<NPC> = {}): NPC {
  return {
    id: 'npc-alice',
    name: 'Alice',
    sprite: { sheetUrl: 'npc.png', frameWidth: 96, frameHeight: 96, cols: 3, rows: 4, rowMapping: { down: 0, left: 1, right: 2, up: 3 } },
    mapId: 'town',
    currentNodeId: 'town-0-1',
    position: { x: 200, y: 100 },
    direction: 'down',
    personality: '温厚で優しい店主。お客さんとの会話を楽しむ。',
    tendencies: ['お客さんに親切', '料理の話が好き'],
    customPrompt: '丁寧語を使う',
    facts: [
      { content: 'この店は10年営業している', expiresDay: null },
      { content: '名物はカレーライス', expiresDay: null },
    ],
    affinity: 50,
    mood: 'happy',
    conversationCount: 3,
    lastConversation: null,
    ...overrides,
  }
}

function createTestSession(overrides: Partial<ConversationSession> = {}): ConversationSession {
  return {
    characterId: 'char-1',
    npcId: 'npc-alice',
    startTime: Date.now(),
    messages: [],
    goal: {
      goal: 'おすすめのメニューを聞く',
      successCriteria: 'Aliceからおすすめを教えてもらう',
    },
    status: 'active',
    currentTurn: 0,
    maxTurns: 5,
    ...overrides,
  }
}

function createTestContext(overrides: Partial<ConversationContext> = {}): ConversationContext {
  return {
    recentConversations: [],
    midTermMemories: [],
    todayActions: [],
    schedule: null,
    currentTime: { hour: 10, minute: 15, day: 1 },
    ...overrides,
  }
}

// =============================================================================
// フル情報のテストデータ
// =============================================================================

function createFullContext(): ConversationContext {
  return {
    recentConversations: [
      { npcId: 'npc-alice', npcName: 'Alice', summary: 'カフェでコーヒーを注文した', timestamp: 600 },
      { npcId: 'npc-bob', npcName: 'Bob', summary: '公園で会った', timestamp: 540 },
    ],
    midTermMemories: [
      { content: '明日は友達とランチの約束がある', importance: 'high', expiresDay: 2 },
      { content: 'Aliceはコーヒーに詳しい', importance: 'medium', expiresDay: 1 },
    ],
    todayActions: [
      { time: '08:00', actionId: 'eat', target: '自宅キッチン', reason: '朝ごはん' },
      { time: '09:30', actionId: 'walk', target: '公園', reason: '散歩したかった', episode: '綺麗な花を見つけた' },
      { time: '10:00', actionId: 'coffee', target: 'カフェ', reason: 'コーヒー飲みたい' },
    ],
    schedule: [
      { time: '12:00', activity: 'ランチ' },
      { time: '15:00', activity: '買い物' },
    ],
    currentTime: { hour: 10, minute: 15, day: 1 },
    nearbyMaps: [
      { mapId: 'cafe', label: 'カフェ', distance: 0 },
      { mapId: 'convenience', label: 'コンビニ', distance: 1 },
      { mapId: 'park', label: '公園', distance: 2 },
    ],
  }
}

function createSessionWithMessages(): ConversationSession {
  return {
    characterId: 'char-1',
    npcId: 'npc-alice',
    startTime: Date.now(),
    messages: [
      { speaker: 'character', speakerId: 'char-1', speakerName: '花子', utterance: 'こんにちは！', timestamp: Date.now() - 60000 },
      { speaker: 'npc', speakerId: 'npc-alice', speakerName: 'Alice', utterance: 'いらっしゃいませ！', timestamp: Date.now() - 30000 },
    ],
    goal: {
      goal: 'おすすめのメニューを聞く',
      successCriteria: 'Aliceからおすすめを教えてもらう',
    },
    status: 'active',
    currentTurn: 1,
    maxTurns: 5,
  }
}

// =============================================================================
// テスト
// =============================================================================

describe('ConversationExecutor prompt snapshots', () => {
  let worldState: WorldStateManager
  let conversationManager: ConversationManager
  let executor: ConversationExecutor

  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})

    worldState = new WorldStateManager()
    worldState.initialize({ town: createTestMap() }, 'town')
    conversationManager = new ConversationManager(worldState)
    executor = new ConversationExecutor(conversationManager)
  })

  describe('buildCharacterPrompt', () => {
    it('minimal context - should match snapshot', () => {
      const character = createTestCharacter()
      const npc = createTestNPC()
      const session = createTestSession()
      const context = createTestContext()

      // Access private method via 'as any'
      const prompt = (executor as any).buildCharacterPrompt(character, npc, session, context)
      expect(prompt).toMatchSnapshot()
    })

    it('full context - should match snapshot', () => {
      const character = createTestCharacter()
      const npc = createTestNPC()
      const session = createSessionWithMessages()
      const context = createFullContext()

      const prompt = (executor as any).buildCharacterPrompt(character, npc, session, context)
      expect(prompt).toMatchSnapshot()
    })

    it('character without optional fields - should match snapshot', () => {
      const character = createTestCharacter({
        tendencies: undefined,
        customPrompt: undefined,
      })
      const npc = createTestNPC()
      const session = createTestSession()
      const context = createTestContext()

      const prompt = (executor as any).buildCharacterPrompt(character, npc, session, context)
      expect(prompt).toMatchSnapshot()
    })

    it('context with empty arrays - should match snapshot', () => {
      const character = createTestCharacter()
      const npc = createTestNPC()
      const session = createTestSession()
      const context = createTestContext({
        recentConversations: [],
        midTermMemories: [],
        todayActions: [],
        schedule: [],
        nearbyMaps: [],
      })

      const prompt = (executor as any).buildCharacterPrompt(character, npc, session, context)
      expect(prompt).toMatchSnapshot()
    })
  })

  describe('buildNPCPrompt', () => {
    it('minimal context - should match snapshot', () => {
      const character = createTestCharacter()
      const npc = createTestNPC()
      const session = createTestSession()
      const context = createTestContext()

      const prompt = (executor as any).buildNPCPrompt(npc, character, session, context)
      expect(prompt).toMatchSnapshot()
    })

    it('full context - should match snapshot', () => {
      const character = createTestCharacter()
      const npc = createTestNPC()
      const session = createSessionWithMessages()
      const context = createFullContext()

      const prompt = (executor as any).buildNPCPrompt(npc, character, session, context)
      expect(prompt).toMatchSnapshot()
    })

    it('NPC without optional fields - should match snapshot', () => {
      const character = createTestCharacter()
      const npc = createTestNPC({
        tendencies: undefined,
        customPrompt: undefined,
        facts: [],
      })
      const session = createTestSession()
      const context = createTestContext()

      const prompt = (executor as any).buildNPCPrompt(npc, character, session, context)
      expect(prompt).toMatchSnapshot()
    })

    it('context with nearbyMaps - should match snapshot', () => {
      const character = createTestCharacter()
      const npc = createTestNPC()
      const session = createTestSession()
      const context = createTestContext({
        nearbyMaps: [
          { mapId: 'cafe', label: 'カフェ', distance: 0 },
          { mapId: 'park', label: '公園', distance: 1 },
        ],
      })

      const prompt = (executor as any).buildNPCPrompt(npc, character, session, context)
      expect(prompt).toMatchSnapshot()
    })
  })
})
