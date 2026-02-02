import { z } from 'zod'
import type { SimCharacter } from '@/server/simulation/types'
import type { NPC, ConversationSession, WorldTime, ScheduleEntry } from '@/types'
import type { ActionHistoryEntry, RecentConversation, MidTermMemory, NearbyMap } from '@/types/behavior'
import type { ChatSummary } from '@/types/chat'
import type { ConversationManager } from './ConversationManager'
import type { ConversationPostProcessor } from './ConversationPostProcessor'
import { llmGenerateObject, isLLMAvailable } from '@/server/llm'
import { isDebugMode } from '@/lib/debugConfig'
import {
  buildPersonalitySection,
  buildStatusSection,
  buildScheduleSection,
  buildActionHistorySection,
  buildMemoriesSection,
  buildRecentConversationsSection,
  buildChatSummariesSection,
  buildNearbyMapsSection,
  buildNearbyMapsNote,
} from '@/lib/prompts'

// =============================================================================
// デバッグログコールバック型
// =============================================================================

export type ConversationDebugLogCallback = (entry: {
  characterId: string
  characterName: string
  npcId: string
  npcName: string
  turn: number
  speaker: 'character' | 'npc'
  prompt: string
  response: string
}) => void

// =============================================================================
// Zod スキーマ
// =============================================================================

const CharacterUtteranceSchema = z.object({
  utterance: z.string().describe('発話内容'),
  goalAchieved: z.boolean().describe('会話の目的を達成したか'),
})

const NPCUtteranceSchema = z.object({
  utterance: z.string().describe('NPC発話内容'),
})

// =============================================================================
// Types
// =============================================================================

export interface ConversationContext {
  recentConversations: RecentConversation[]
  midTermMemories: MidTermMemory[]
  todayActions: ActionHistoryEntry[]
  schedule: ScheduleEntry[] | null
  currentTime: WorldTime
  nearbyMaps?: NearbyMap[]
  chatSummaries?: ChatSummary[]
}

export type ConversationCompleteCallback = (characterId: string, goalAchieved: boolean) => void
export type MessageEmitCallback = (
  characterId: string,
  npcId: string,
  speaker: 'character' | 'npc',
  speakerName: string,
  utterance: string
) => void

// =============================================================================
// ConversationExecutor
// =============================================================================

/**
 * LLM会話実行クラス
 * キャラクターとNPCの交互発話ループを管理する
 */
export class ConversationExecutor {
  private conversationManager: ConversationManager
  private postProcessor: ConversationPostProcessor | null = null
  private onConversationComplete: ConversationCompleteCallback | null = null
  private onMessageEmit: MessageEmitCallback | null = null
  private onDebugLog: ConversationDebugLogCallback | null = null
  private turnIntervalMs: number = 60000 // デフォルト1分
  // Track active conversation loops to prevent duplicates
  private activeLoops: Set<string> = new Set()

  constructor(conversationManager: ConversationManager) {
    this.conversationManager = conversationManager
  }

  setPostProcessor(postProcessor: ConversationPostProcessor): void {
    this.postProcessor = postProcessor
  }

  setOnConversationComplete(callback: ConversationCompleteCallback): void {
    this.onConversationComplete = callback
  }

  setOnMessageEmit(callback: MessageEmitCallback): void {
    this.onMessageEmit = callback
  }

  setOnDebugLog(callback: ConversationDebugLogCallback): void {
    this.onDebugLog = callback
  }

  setTurnIntervalMs(ms: number): void {
    this.turnIntervalMs = ms
  }

  /**
   * デバッグログを送信（DEBUG_MODE有効時のみ）
   */
  private emitDebugLog(entry: {
    characterId: string
    characterName: string
    npcId: string
    npcName: string
    turn: number
    speaker: 'character' | 'npc'
    prompt: string
    response: string
  }): void {
    if (!isDebugMode() || !this.onDebugLog) return
    try {
      this.onDebugLog(entry)
    } catch (error) {
      console.error('[ConversationExecutor] Error emitting debug log:', error)
    }
  }

  /**
   * 会話ループを非同期で実行
   * キャラクター→NPC→キャラクター→...と交互に発話し、
   * 目的達成またはターン上限で終了する
   */
  async executeConversation(
    character: SimCharacter,
    npc: NPC,
    session: ConversationSession,
    context: ConversationContext
  ): Promise<void> {
    const characterId = character.id

    // Prevent duplicate loops for same character
    if (this.activeLoops.has(characterId)) {
      console.log(`[ConversationExecutor] Loop already active for ${character.name}, skipping`)
      return
    }

    this.activeLoops.add(characterId)

    try {
      await this.runConversationLoop(character, npc, session, context)
    } catch (error) {
      console.error(`[ConversationExecutor] Error in conversation loop for ${character.name}:`, error)
    } finally {
      this.activeLoops.delete(characterId)
    }
  }

  private async runConversationLoop(
    character: SimCharacter,
    npc: NPC,
    session: ConversationSession,
    context: ConversationContext
  ): Promise<void> {
    let goalAchieved = false

    while (true) {
      // Check if session is still active
      const currentSession = this.conversationManager.getActiveSession(character.id)
      if (!currentSession || currentSession.status !== 'active') {
        console.log(`[ConversationExecutor] Session no longer active for ${character.name}`)
        break
      }

      // 1. キャラクターLLM呼び出し
      const messagesBeforeTurn = currentSession.messages.length
      const characterResult = await this.generateCharacterUtterance(character, npc, currentSession, context)

      // Add character message
      this.conversationManager.addMessage(character.id, {
        speaker: 'character',
        speakerId: character.id,
        speakerName: character.name,
        utterance: characterResult.utterance,
        timestamp: Date.now(),
      })

      // Emit message to log subscribers
      if (this.onMessageEmit) {
        this.onMessageEmit(character.id, npc.id, 'character', character.name, characterResult.utterance)
      }

      console.log(`[ConversationExecutor] ${character.name}: "${characterResult.utterance}"`)

      // 2. 終了判定（目的達成 or エラー）
      //    初回発話（NPC未応答）では goalAchieved を無視し、最低1往復は会話する
      if (messagesBeforeTurn > 0 && characterResult.goalAchieved) {
        goalAchieved = true
        console.log(`[ConversationExecutor] Goal achieved for ${character.name}`)
        break
      }
      if (characterResult.error) {
        console.log(`[ConversationExecutor] LLM error, ending conversation for ${character.name}`)
        break
      }

      // 3. NPC LLM呼び出し
      // Re-fetch session to get updated messages
      const sessionAfterChar = this.conversationManager.getActiveSession(character.id)
      if (!sessionAfterChar || sessionAfterChar.status !== 'active') break

      const npcUtterance = await this.generateNPCUtterance(npc, character, sessionAfterChar, context)

      // Add NPC message
      this.conversationManager.addMessage(character.id, {
        speaker: 'npc',
        speakerId: npc.id,
        speakerName: npc.name,
        utterance: npcUtterance,
        timestamp: Date.now(),
      })

      // Emit message to log subscribers
      if (this.onMessageEmit) {
        this.onMessageEmit(character.id, npc.id, 'npc', npc.name, npcUtterance)
      }

      console.log(`[ConversationExecutor] ${npc.name}: "${npcUtterance}"`)

      // 4. ターン上限チェック
      if (this.conversationManager.isAtMaxTurns(character.id)) {
        console.log(`[ConversationExecutor] Max turns reached for ${character.name}`)
        break
      }

      // 5. ターンインターバル待機
      if (this.turnIntervalMs > 0) {
        await this.sleep(this.turnIntervalMs)
      }

      // Check again if session is still active after sleep
      const sessionAfterSleep = this.conversationManager.getActiveSession(character.id)
      if (!sessionAfterSleep || sessionAfterSleep.status !== 'active') {
        console.log(`[ConversationExecutor] Session ended during interval for ${character.name}`)
        break
      }
    }

    // セッションのスナップショットを取得（endConversationで消える前に）
    const finalSession = this.conversationManager.getActiveSession(character.id)
    const completedSession: ConversationSession = finalSession
      ? { ...finalSession, status: 'completed' as const, goalAchieved }
      : { ...session, messages: [...session.messages], status: 'completed' as const, goalAchieved }

    // 終了処理
    this.conversationManager.endConversation(character.id, goalAchieved)

    // 同期で後処理（次の行動決定に必要な情報を更新）
    if (this.postProcessor) {
      try {
        // Pass existing memories for consolidation
        await this.postProcessor.process(
          completedSession,
          npc,
          character,
          context.currentTime,
          context.midTermMemories
        )
      } catch (error) {
        console.error(`[ConversationExecutor] PostProcessor error for ${character.name}:`, error)
      }
    }

    if (this.onConversationComplete) {
      this.onConversationComplete(character.id, goalAchieved)
    }
  }

  /**
   * キャラクター発話生成
   */
  private async generateCharacterUtterance(
    character: SimCharacter,
    npc: NPC,
    session: ConversationSession,
    context: ConversationContext
  ): Promise<{ utterance: string; goalAchieved: boolean; error?: boolean }> {
    if (!isLLMAvailable()) {
      return { utterance: '...', goalAchieved: false, error: true }
    }

    const prompt = this.buildCharacterPrompt(character, npc, session, context)

    try {
      const result = await llmGenerateObject(
        prompt,
        CharacterUtteranceSchema,
        { system: `あなたは${character.name}として会話してください。口頭で話しているような自然な口語調で、1〜3文程度の短い発話にしてください。` }
      )

      // デバッグログを送信
      this.emitDebugLog({
        characterId: character.id,
        characterName: character.name,
        npcId: npc.id,
        npcName: npc.name,
        turn: session.currentTurn + 1,
        speaker: 'character',
        prompt,
        response: JSON.stringify(result, null, 2),
      })

      return {
        utterance: result.utterance,
        goalAchieved: result.goalAchieved,
      }
    } catch (error) {
      console.error(`[ConversationExecutor] Character LLM error:`, error)
      return { utterance: 'えっと...', goalAchieved: false, error: true }
    }
  }

  /**
   * NPC発話生成
   */
  private async generateNPCUtterance(
    npc: NPC,
    character: SimCharacter,
    session: ConversationSession,
    context: ConversationContext
  ): Promise<string> {
    if (!isLLMAvailable()) {
      return '...'
    }

    const prompt = this.buildNPCPrompt(npc, character, session, context)

    try {
      const result = await llmGenerateObject(
        prompt,
        NPCUtteranceSchema,
        { system: `あなたは${npc.name}として会話してください。口頭で話しているような自然な口語調で、1〜3文程度の短い発話にしてください。` }
      )

      // デバッグログを送信
      this.emitDebugLog({
        characterId: character.id,
        characterName: character.name,
        npcId: npc.id,
        npcName: npc.name,
        turn: session.currentTurn + 1,
        speaker: 'npc',
        prompt,
        response: JSON.stringify(result, null, 2),
      })

      return result.utterance
    } catch (error) {
      console.error(`[ConversationExecutor] NPC LLM error:`, error)
      return 'そうですね...'
    }
  }

  // ===========================================================================
  // プロンプト構築
  // ===========================================================================

  private buildCharacterPrompt(
    character: SimCharacter,
    npc: NPC,
    session: ConversationSession,
    context: ConversationContext
  ): string {
    const parts: string[] = []

    parts.push(`あなたは${character.name}です。${npc.name}と会話しています。`)
    parts.push('')

    // 性格・行動傾向・カスタムプロンプト（共通ビルダー使用）
    parts.push(...buildPersonalitySection(character))

    // 会話の目的
    parts.push('【会話の目的】')
    parts.push(`- 目的: ${session.goal.goal}`)
    if (session.goal.successCriteria) {
      parts.push(`- 達成条件: ${session.goal.successCriteria}`)
    }
    parts.push('')

    // 相手NPC情報
    parts.push(`【相手: ${npc.name}】`)
    parts.push(`- 気分: ${npc.mood}`)
    parts.push(`- あなたへの好感度: ${npc.affinity}`)
    parts.push('')

    // 会話履歴
    if (session.messages.length > 0) {
      parts.push('【これまでの会話】')
      for (const msg of session.messages) {
        parts.push(`${msg.speakerName}: ${msg.utterance}`)
      }
      parts.push('')
    }

    // 直近のNPC会話サマリー（共通ビルダー使用）
    parts.push(...buildRecentConversationsSection(context.recentConversations))

    // チャットでの関係（共通ビルダー使用）
    parts.push(...buildChatSummariesSection(context.chatSummaries))

    // 重要な記憶（共通ビルダー使用）
    parts.push(...buildMemoriesSection(context.midTermMemories))

    // 今日の行動（共通ビルダー使用）
    parts.push(...buildActionHistorySection(context.todayActions))

    // 周辺の場所（共通ビルダー使用）
    parts.push(...buildNearbyMapsSection(context.nearbyMaps))
    if (context.nearbyMaps && context.nearbyMaps.length > 0) {
      parts.push(...buildNearbyMapsNote('character'))
    }

    // 現在のステータス（共通ビルダー使用）
    parts.push(...buildStatusSection(character, context.currentTime))

    // スケジュール（共通ビルダー使用）
    parts.push(...buildScheduleSection(context.schedule))

    // ターン情報
    parts.push(`【ターン】${session.currentTurn + 1}/${session.maxTurns}`)
    parts.push('')

    // 指示
    parts.push('【回答形式】')
    parts.push('JSON形式で回答してください。')
    parts.push('- utterance: あなたの発話（1〜3文程度。口頭で話すような短く自然な口語調で）')
    parts.push('- goalAchieved: 会話の目的を達成できたか（true/false）')
    parts.push('')
    parts.push('※発話は書き言葉ではなく、実際に口頭で話しているような短い文にしてください。')
    parts.push('目的を達成したら goalAchieved を true にしてください。')

    return parts.join('\n')
  }

  private buildNPCPrompt(
    npc: NPC,
    character: SimCharacter,
    session: ConversationSession,
    context: ConversationContext
  ): string {
    const parts: string[] = []

    parts.push(`あなたは${npc.name}です。${character.name}と会話しています。`)
    parts.push('')

    // 性格・行動傾向・カスタムプロンプト（共通ビルダー使用）
    parts.push(...buildPersonalitySection(npc))

    // NPCが保つ事実
    if (npc.facts && npc.facts.length > 0) {
      parts.push('【あなたの知識・事実】')
      parts.push(npc.facts.map(f => `- ${f.content}`).join('\n'))
      parts.push('')
    }

    // 動的ステータス
    parts.push('【あなたの状態】')
    parts.push(`- 気分: ${npc.mood}`)
    parts.push(`- ${character.name}への好感度: ${npc.affinity}`)
    parts.push(`- これまでの会話回数: ${npc.conversationCount}回`)
    parts.push('')

    // 会話履歴
    if (session.messages.length > 0) {
      parts.push('【これまでの会話】')
      for (const msg of session.messages) {
        parts.push(`${msg.speakerName}: ${msg.utterance}`)
      }
      parts.push('')
    }

    // 周辺の場所（共通ビルダー使用）
    parts.push(...buildNearbyMapsSection(context.nearbyMaps))
    if (context.nearbyMaps && context.nearbyMaps.length > 0) {
      parts.push(...buildNearbyMapsNote('npc'))
    }

    // 指示
    parts.push('【回答形式】')
    parts.push('JSON形式で回答してください。')
    parts.push('- utterance: あなたの応答（1〜3文程度。口頭で話すような短く自然な口語調で）')
    parts.push('')
    parts.push('※発話は書き言葉ではなく、実際に口頭で話しているような短い文にしてください。')
    parts.push('あなたの性格と知識に基づいて応答してください。')

    return parts.join('\n')
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}
