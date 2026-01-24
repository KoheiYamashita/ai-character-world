import { z } from 'zod'
import type { SimCharacter } from '@/server/simulation/types'
import type { NPC, ConversationSession, WorldTime, ScheduleEntry } from '@/types'
import type { ActionHistoryEntry, RecentConversation, MidTermMemory, NearbyMap } from '@/types/behavior'
import type { ConversationManager } from './ConversationManager'
import type { ConversationPostProcessor } from './ConversationPostProcessor'
import { llmGenerateObject, isLLMAvailable } from '@/server/llm'

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

  setTurnIntervalMs(ms: number): void {
    this.turnIntervalMs = ms
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
        await this.postProcessor.process(completedSession, npc, character, context.currentTime)
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
        { system: `あなたは${character.name}として会話してください。自然な日本語で話してください。` }
      )

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
        { system: `あなたは${npc.name}として会話してください。自然な日本語で話してください。` }
      )

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

    // 性格
    parts.push('【あなたの性格】')
    parts.push(character.personality || '（未設定）')
    parts.push('')

    // 行動傾向
    if (character.tendencies && character.tendencies.length > 0) {
      parts.push('【行動傾向】')
      parts.push(character.tendencies.map(t => `- ${t}`).join('\n'))
      parts.push('')
    }

    // カスタムプロンプト
    if (character.customPrompt) {
      parts.push('【その他の設定】')
      parts.push(character.customPrompt)
      parts.push('')
    }

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

    // 直近の会話サマリー
    if (context.recentConversations.length > 0) {
      parts.push('【直近の会話（過去）】')
      parts.push(context.recentConversations.map(c => `- ${c.npcName}: ${c.summary}`).join('\n'))
      parts.push('')
    }

    // 重要な記憶
    if (context.midTermMemories.length > 0) {
      parts.push('【重要な記憶】')
      parts.push(context.midTermMemories.map(m => `- ${m.content}`).join('\n'))
      parts.push('')
    }

    // 今日の行動
    if (context.todayActions.length > 0) {
      parts.push('【今日の行動】')
      parts.push(context.todayActions.map(a => {
        let line = `- ${a.time} ${a.actionId}`
        if (a.target) line += ` → ${a.target}`
        if (a.reason) line += ` [${a.reason}]`
        if (a.episode) line += `\n  ✨ ${a.episode}`
        return line
      }).join('\n'))
      parts.push('')
    }

    // 周辺の場所
    if (context.nearbyMaps && context.nearbyMaps.length > 0) {
      parts.push('【周辺の場所】')
      for (const m of context.nearbyMaps) {
        if (m.distance === 0) {
          parts.push(`- ${m.label}（現在地）`)
        } else {
          parts.push(`- ${m.label}`)
        }
      }
      parts.push('')
      parts.push('※上記以外にも、【重要な記憶】【直近の会話（過去）】【今日の行動】で言及された場所は話題にできます。')
      parts.push('  存在しない施設や店について話さないでください。')
      parts.push('')
    }

    // 現在のステータス
    parts.push('【現在のステータス】')
    parts.push(`- 時刻: ${context.currentTime.hour}:${String(context.currentTime.minute).padStart(2, '0')}`)
    parts.push(`- 満腹度: ${character.satiety.toFixed(0)}%`)
    parts.push(`- エネルギー: ${character.energy.toFixed(0)}%`)
    parts.push(`- 気分: ${character.mood.toFixed(0)}%`)
    parts.push('')

    // スケジュール
    if (context.schedule && context.schedule.length > 0) {
      parts.push('【今日のスケジュール】')
      parts.push(context.schedule.map(e => `- ${e.time}: ${e.activity}`).join('\n'))
      parts.push('')
    }

    // ターン情報
    parts.push(`【ターン】${session.currentTurn + 1}/${session.maxTurns}`)
    parts.push('')

    // 指示
    parts.push('【回答形式】')
    parts.push('JSON形式で回答してください。')
    parts.push('- utterance: あなたの発話')
    parts.push('- goalAchieved: 会話の目的を達成できたか（true/false）')
    parts.push('')
    parts.push('自然な会話になるよう心がけてください。目的を達成したら goalAchieved を true にしてください。')

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

    // NPC性格
    parts.push('【あなたの性格】')
    parts.push(npc.personality || '（未設定）')
    parts.push('')

    // 行動傾向
    if (npc.tendencies && npc.tendencies.length > 0) {
      parts.push('【行動傾向】')
      parts.push(npc.tendencies.map(t => `- ${t}`).join('\n'))
      parts.push('')
    }

    // カスタムプロンプト
    if (npc.customPrompt) {
      parts.push('【その他の設定】')
      parts.push(npc.customPrompt)
      parts.push('')
    }

    // NPCが保つ事実
    if (npc.facts && npc.facts.length > 0) {
      parts.push('【あなたの知識・事実】')
      parts.push(npc.facts.map(f => `- ${f}`).join('\n'))
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

    // 周辺の場所
    if (context.nearbyMaps && context.nearbyMaps.length > 0) {
      parts.push('【周辺の場所】')
      for (const m of context.nearbyMaps) {
        if (m.distance === 0) {
          parts.push(`- ${m.label}（現在地）`)
        } else {
          parts.push(`- ${m.label}`)
        }
      }
      parts.push('')
      parts.push('※上記以外にも、【あなたの知識・事実】【これまでの会話】で言及された場所は話題にできます。')
      parts.push('  存在しない施設や店について話さないでください。')
      parts.push('')
    }

    // 指示
    parts.push('【回答形式】')
    parts.push('JSON形式で回答してください。')
    parts.push('- utterance: あなたの応答')
    parts.push('')
    parts.push('自然な会話になるよう心がけてください。あなたの性格と知識に基づいて応答してください。')

    return parts.join('\n')
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}
