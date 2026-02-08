/**
 * チャット後処理クラス
 * サマリー生成・記憶更新などの後処理を行う
 */

import { z } from 'zod'
import type { SimCharacter } from '@/server/simulation/types'
import type { ChatSession, ChatMessageRecord, ChatSummary } from '@/types/chat'
import type { StateStore } from '@/server/persistence/StateStore'
import type { MidTermMemory } from '@/types/behavior'
import { llmGenerateObject, isLLMAvailable } from '@/server/llm'
import { v4 as uuidv4 } from 'uuid'

// =============================================================================
// Zod スキーマ
// =============================================================================

const ChatSummaryUpdateSchema = z.object({
  summary: z.string().describe('チャットの要約（100文字程度）'),
  importantMemory: z.string().describe('中期記憶に追加すべき重要な情報（なければ空文字列""）'),
  memoryImportance: z.enum(['low', 'medium', 'high', 'none']).describe('記憶の重要度（なければnone）'),
})

// =============================================================================
// コールバック型
// =============================================================================

export type OnSummaryPersistCallback = (summary: ChatSummary) => Promise<void>
export type OnMemoryAddCallback = (memory: MidTermMemory) => Promise<void>

// =============================================================================
// ChatPostProcessor
// =============================================================================

export class ChatPostProcessor {
  private onSummaryPersist: OnSummaryPersistCallback | null = null
  private onMemoryAdd: OnMemoryAddCallback | null = null

  setOnSummaryPersist(callback: OnSummaryPersistCallback): void {
    this.onSummaryPersist = callback
  }

  setOnMemoryAdd(callback: OnMemoryAddCallback): void {
    this.onMemoryAdd = callback
  }

  /**
   * チャットアクション完了後の後処理
   */
  async process(
    character: SimCharacter,
    session: ChatSession,
    recentMessages: ChatMessageRecord[],
    stateStore: StateStore | null
  ): Promise<void> {
    if (!stateStore) return

    try {
      // 既存サマリーを取得
      const existingSummary = await stateStore.loadChatSummary(
        character.id,
        session.providerId,
        session.channelId
      )

      // LLMでサマリー更新を生成
      const updateResult = await this.generateSummaryUpdate(
        character,
        session,
        recentMessages,
        existingSummary
      )

      if (!updateResult) {
        console.log(`[ChatPostProcessor] No summary update generated`)
        return
      }

      // サマリーを更新
      const now = Date.now()
      const newSummary: ChatSummary = {
        characterId: character.id,
        providerId: session.providerId,
        channelId: session.channelId,
        channelName: session.channelName,
        summary: updateResult.summary,
        lastInteractionAt: now,
        totalMessages: (existingSummary?.totalMessages ?? 0) + this.countNewMessages(recentMessages, existingSummary),
        updatedAt: now,
      }

      await stateStore.saveChatSummary(newSummary)
      console.log(`[ChatPostProcessor] Updated chat summary for ${character.name} on ${session.channelName}`)

      // コールバック通知
      if (this.onSummaryPersist) {
        await this.onSummaryPersist(newSummary)
      }

      // 重要な情報があれば中期記憶に追加
      if (updateResult.importantMemory && updateResult.memoryImportance) {
        await this.addMemory(
          character,
          session,
          updateResult.importantMemory,
          updateResult.memoryImportance,
          stateStore
        )
      }
    } catch (error) {
      console.error(`[ChatPostProcessor] Error in process:`, error)
    }
  }

  /**
   * LLMでサマリー更新を生成
   */
  private async generateSummaryUpdate(
    character: SimCharacter,
    session: ChatSession,
    recentMessages: ChatMessageRecord[],
    existingSummary: ChatSummary | null
  ): Promise<{
    summary: string
    importantMemory?: string
    memoryImportance?: 'low' | 'medium' | 'high'
  } | null> {
    if (!isLLMAvailable()) {
      // LLMが使えない場合はシンプルなサマリー
      return {
        summary: existingSummary?.summary ?? `${session.channelName}でのやりとり`,
      }
    }

    const prompt = this.buildSummaryPrompt(character, session, recentMessages, existingSummary)

    try {
      const result = await llmGenerateObject(
        prompt,
        ChatSummaryUpdateSchema,
        { system: 'チャットの会話をサマリーしてください。' }
      )
      return {
        summary: result.summary,
        // 空文字列または'none'は「なし」を意味するので undefined に変換
        importantMemory: result.importantMemory === '' ? undefined : result.importantMemory,
        memoryImportance: result.memoryImportance === 'none' ? undefined : result.memoryImportance,
      }
    } catch (error) {
      console.error(`[ChatPostProcessor] LLM error in generateSummaryUpdate:`, error)
      return null
    }
  }

  /**
   * サマリー生成プロンプト
   */
  private buildSummaryPrompt(
    character: SimCharacter,
    session: ChatSession,
    recentMessages: ChatMessageRecord[],
    existingSummary: ChatSummary | null
  ): string {
    const parts: string[] = []

    parts.push(`${character.name}のチャット「${session.channelName}」の要約を更新してください。`)
    parts.push('')

    // 既存サマリー
    if (existingSummary) {
      parts.push('【既存の要約】')
      parts.push(existingSummary.summary)
      parts.push('')
    }

    // 直近メッセージ
    if (recentMessages.length > 0) {
      parts.push('【今回のやりとり】')
      for (const msg of recentMessages) {
        const sender = msg.isFromCharacter ? `[${character.name}]` : msg.senderName
        parts.push(`${sender}: ${msg.content}`)
      }
      parts.push('')
    }

    parts.push('【指示】')
    parts.push('上記を踏まえて、このチャンネルでの関係性・話題・重要な情報を100文字程度でサマリーしてください。')
    parts.push('')
    parts.push('- summary: 新しいサマリー')
    parts.push('- importantMemory: 行動に影響する重要な情報があれば（例: 予定、約束、重要な事実）')
    parts.push('- memoryImportance: 記憶の重要度（low/medium/high）')

    return parts.join('\n')
  }

  /**
   * 中期記憶に追加
   */
  private async addMemory(
    character: SimCharacter,
    session: ChatSession,
    content: string,
    importance: 'low' | 'medium' | 'high',
    _stateStore: StateStore
  ): Promise<void> {
    // 重要度に応じた有効期限を計算
    // Note: 現在のワールド日数が必要だが、ここでは取得できないので
    // コールバックで処理する
    const memory: MidTermMemory = {
      id: uuidv4(),
      characterId: character.id,
      content: `[${session.channelName}] ${content}`,
      importance,
      createdDay: 0, // コールバック側で設定
      expiresDay: 0, // コールバック側で設定
      sourceNpcId: undefined, // チャットはNPCではないのでundefined
    }

    if (this.onMemoryAdd) {
      await this.onMemoryAdd(memory)
    } else {
      // コールバックがない場合は直接保存（日付はダミー）
      console.warn(`[ChatPostProcessor] onMemoryAdd callback not set, skipping memory persistence`)
    }

    console.log(`[ChatPostProcessor] Added memory for ${character.name}: ${content}`)
  }

  /**
   * 新規メッセージ数をカウント
   */
  private countNewMessages(
    recentMessages: ChatMessageRecord[],
    existingSummary: ChatSummary | null
  ): number {
    if (!existingSummary) {
      return recentMessages.length
    }

    // 最終インタラクション以降のメッセージをカウント
    return recentMessages.filter(
      msg => msg.timestamp > existingSummary.lastInteractionAt
    ).length
  }
}
