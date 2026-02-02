/**
 * チャットアクション実行クラス
 * reply_chat, check_chat, send_chat の実行ロジックを提供
 */

import { z } from 'zod'
import type { SimCharacter } from '@/server/simulation/types'
import type { ChatSession, ChatMessageRecord, ChatSummary, ChatContext } from '@/types/chat'
import type { StateStore } from '@/server/persistence/StateStore'
import type { ChatManager } from './ChatManager'
import type { ChatPostProcessor } from './ChatPostProcessor'
import { getChatProvider } from './client'
import { llmGenerateObject, isLLMAvailable } from '@/server/llm'
import {
  buildPersonalitySection,
  buildStatusSection,
  buildScheduleSection,
  buildActionHistorySection,
  buildMemoriesSection,
  buildRecentConversationsSection,
  buildChatSummariesSection,
  buildNearbyMapsSection,
} from '@/lib/prompts/characterContext'

// =============================================================================
// Zod スキーマ
// =============================================================================

const ChatReplySchema = z.object({
  reply: z.string().describe('チャットへの返信内容'),
  shouldContinue: z.boolean().describe('会話を続けるかどうか'),
})

const ChatSendSchema = z.object({
  message: z.string().describe('送信するメッセージ'),
})

const ChatCheckSummarySchema = z.object({
  summary: z.string().describe('チャットの要約（100文字程度）'),
  importantInfo: z.string().nullable().describe('行動に影響する重要な情報があれば（なければnull）'),
})

// =============================================================================
// コールバック型
// =============================================================================

export type ChatCompleteCallback = (characterId: string, success: boolean) => void
export type ChatMessageEmitCallback = (
  characterId: string,
  providerId: string,
  channelId: string,
  channelName: string,
  content: string,
  isFromCharacter: boolean
) => void

// =============================================================================
// ChatExecutor
// =============================================================================

export class ChatExecutor {
  private chatManager: ChatManager
  private stateStore: StateStore | null = null
  private postProcessor: ChatPostProcessor | null = null
  private onChatComplete: ChatCompleteCallback | null = null
  private onMessageEmit: ChatMessageEmitCallback | null = null

  constructor(chatManager: ChatManager) {
    this.chatManager = chatManager
  }

  setStateStore(store: StateStore): void {
    this.stateStore = store
  }

  setPostProcessor(postProcessor: ChatPostProcessor): void {
    this.postProcessor = postProcessor
  }

  setOnChatComplete(callback: ChatCompleteCallback): void {
    this.onChatComplete = callback
  }

  setOnMessageEmit(callback: ChatMessageEmitCallback): void {
    this.onMessageEmit = callback
  }

  // ==========================================================================
  // reply_chat: 通知に返信
  // ==========================================================================

  async executeReply(character: SimCharacter, session: ChatSession, context?: ChatContext): Promise<void> {
    const provider = getChatProvider(session.providerId)
    if (!provider) {
      console.error(`[ChatExecutor] Provider not found: ${session.providerId}`)
      this.completeChat(character.id, false)
      return
    }

    if (!session.notification) {
      console.error(`[ChatExecutor] No notification in reply session`)
      this.completeChat(character.id, false)
      return
    }

    try {
      // 直近のメッセージを取得
      const recentMessages = await this.loadRecentMessages(session)

      // 既存サマリーを取得
      const existingSummary = await this.loadChatSummary(character.id, session)

      // LLMで返信生成
      const reply = await this.generateReply(character, session, recentMessages, existingSummary, context)

      if (!reply) {
        console.error(`[ChatExecutor] Failed to generate reply`)
        this.completeChat(character.id, false)
        return
      }

      // メッセージ送信
      const result = await provider.sendMessage({
        providerId: session.providerId,
        channelId: session.channelId,
        content: reply.reply,
        replyToMessageId: session.notification.messageId,
      })

      if (!result.success) {
        console.error(`[ChatExecutor] Failed to send message: ${result.error}`)
        this.completeChat(character.id, false)
        return
      }

      // 送信メッセージをDBに保存
      await this.saveOutgoingMessage(character.id, session, reply.reply, result.messageId)

      // メッセージ送信を通知
      this.emitMessage(character.id, session, reply.reply, true)

      console.log(`[ChatExecutor] ${character.name} replied: "${reply.reply.substring(0, 50)}..."`)

      // 後処理（サマリー更新等）
      await this.runPostProcessor(character, session, recentMessages)

      this.completeChat(character.id, true)
    } catch (error) {
      console.error(`[ChatExecutor] Error in executeReply:`, error)
      this.completeChat(character.id, false)
    }
  }

  // ==========================================================================
  // check_chat: チャット確認
  // ==========================================================================

  async executeCheck(character: SimCharacter, session: ChatSession, context?: ChatContext): Promise<void> {
    try {
      // 直近のメッセージを取得
      const recentMessages = await this.loadRecentMessages(session)

      if (recentMessages.length === 0) {
        console.log(`[ChatExecutor] No recent messages to check for ${character.name}`)
        this.completeChat(character.id, true)
        return
      }

      // 既存サマリーを取得
      const existingSummary = await this.loadChatSummary(character.id, session)

      // LLMでサマリー生成
      const checkResult = await this.generateCheckSummary(character, session, recentMessages, existingSummary, context)

      if (checkResult) {
        console.log(`[ChatExecutor] ${character.name} checked chat: ${checkResult.summary}`)
      }

      // 後処理（サマリー更新等）
      await this.runPostProcessor(character, session, recentMessages)

      this.completeChat(character.id, true)
    } catch (error) {
      console.error(`[ChatExecutor] Error in executeCheck:`, error)
      this.completeChat(character.id, false)
    }
  }

  // ==========================================================================
  // send_chat: 自発送信
  // ==========================================================================

  async executeSend(character: SimCharacter, session: ChatSession, context?: ChatContext): Promise<void> {
    const provider = getChatProvider(session.providerId)
    if (!provider) {
      console.error(`[ChatExecutor] Provider not found: ${session.providerId}`)
      this.completeChat(character.id, false)
      return
    }

    if (!session.intent) {
      console.error(`[ChatExecutor] No intent in send session`)
      this.completeChat(character.id, false)
      return
    }

    try {
      // 直近のメッセージを取得
      const recentMessages = await this.loadRecentMessages(session)

      // 既存サマリーを取得
      const existingSummary = await this.loadChatSummary(character.id, session)

      // LLMでメッセージ生成
      const message = await this.generateSendMessage(character, session, recentMessages, existingSummary, context)

      if (!message) {
        console.error(`[ChatExecutor] Failed to generate message`)
        this.completeChat(character.id, false)
        return
      }

      // メッセージ送信
      const result = await provider.sendMessage({
        providerId: session.providerId,
        channelId: session.channelId,
        content: message.message,
      })

      if (!result.success) {
        console.error(`[ChatExecutor] Failed to send message: ${result.error}`)
        this.completeChat(character.id, false)
        return
      }

      // 送信メッセージをDBに保存
      await this.saveOutgoingMessage(character.id, session, message.message, result.messageId)

      // メッセージ送信を通知
      this.emitMessage(character.id, session, message.message, true)

      console.log(`[ChatExecutor] ${character.name} sent: "${message.message.substring(0, 50)}..."`)

      // 後処理（サマリー更新等）
      await this.runPostProcessor(character, session, recentMessages)

      this.completeChat(character.id, true)
    } catch (error) {
      console.error(`[ChatExecutor] Error in executeSend:`, error)
      this.completeChat(character.id, false)
    }
  }

  // ==========================================================================
  // LLM生成
  // ==========================================================================

  private async generateReply(
    character: SimCharacter,
    session: ChatSession,
    recentMessages: ChatMessageRecord[],
    existingSummary: ChatSummary | null,
    context?: ChatContext
  ): Promise<{ reply: string; shouldContinue: boolean } | null> {
    if (!isLLMAvailable()) {
      return { reply: '...', shouldContinue: false }
    }

    const prompt = this.buildReplyPrompt(character, session, recentMessages, existingSummary, context)

    try {
      const result = await llmGenerateObject(
        prompt,
        ChatReplySchema,
        { system: `あなたは${character.name}です。チャットで会話しています。自然な口語調で返信してください。` }
      )
      return result
    } catch (error) {
      console.error(`[ChatExecutor] LLM error in generateReply:`, error)
      return null
    }
  }

  private async generateCheckSummary(
    character: SimCharacter,
    session: ChatSession,
    recentMessages: ChatMessageRecord[],
    existingSummary: ChatSummary | null,
    context?: ChatContext
  ): Promise<{ summary: string; importantInfo?: string } | null> {
    if (!isLLMAvailable()) {
      return { summary: '最近のメッセージを確認しました' }
    }

    const prompt = this.buildCheckPrompt(character, session, recentMessages, existingSummary, context)

    try {
      const result = await llmGenerateObject(
        prompt,
        ChatCheckSummarySchema,
        { system: `チャットの内容を簡潔に要約してください。` }
      )
      return {
        summary: result.summary,
        importantInfo: result.importantInfo ?? undefined,
      }
    } catch (error) {
      console.error(`[ChatExecutor] LLM error in generateCheckSummary:`, error)
      return null
    }
  }

  private async generateSendMessage(
    character: SimCharacter,
    session: ChatSession,
    recentMessages: ChatMessageRecord[],
    existingSummary: ChatSummary | null,
    context?: ChatContext
  ): Promise<{ message: string } | null> {
    if (!isLLMAvailable()) {
      return { message: 'こんにちは！' }
    }

    const prompt = this.buildSendPrompt(character, session, recentMessages, existingSummary, context)

    try {
      const result = await llmGenerateObject(
        prompt,
        ChatSendSchema,
        { system: `あなたは${character.name}です。チャットでメッセージを送信します。自然な口語調で書いてください。` }
      )
      return result
    } catch (error) {
      console.error(`[ChatExecutor] LLM error in generateSendMessage:`, error)
      return null
    }
  }

  // ==========================================================================
  // プロンプト構築
  // ==========================================================================

  private buildReplyPrompt(
    character: SimCharacter,
    session: ChatSession,
    recentMessages: ChatMessageRecord[],
    existingSummary: ChatSummary | null,
    context?: ChatContext
  ): string {
    const parts: string[] = []

    parts.push(`あなたは${character.name}です。`)
    parts.push(`チャンネル「${session.channelName}」で${session.notification?.senderName ?? '誰か'}からメッセージを受け取りました。`)
    parts.push('')

    // 性格（共通ビルダー使用）
    parts.push(...buildPersonalitySection(character))

    // 世界情報（コンテキストがある場合）
    if (context) {
      parts.push(...buildStatusSection(character, context.currentTime))
      parts.push(...buildScheduleSection(context.schedule))
      parts.push(...buildActionHistorySection(context.todayActions))
      parts.push(...buildMemoriesSection(context.midTermMemories))
      parts.push(...buildRecentConversationsSection(context.recentConversations))
      // 他チャンネルのサマリー（現在のチャンネルは下のexistingSummaryで表示）
      const otherChannelSummaries = context.chatSummaries?.filter(
        s => s.channelId !== session.channelId
      )
      parts.push(...buildChatSummariesSection(otherChannelSummaries))
      parts.push(...buildNearbyMapsSection(context.nearbyMaps))
    }

    // 現在のチャンネルのサマリー
    if (existingSummary) {
      parts.push('【このチャンネルでの過去の会話】')
      parts.push(existingSummary.summary)
      parts.push('')
    }

    // 直近メッセージ
    if (recentMessages.length > 0) {
      parts.push('【直近のメッセージ】')
      for (const msg of recentMessages) {
        const sender = msg.isFromCharacter ? `[自分]` : msg.senderName
        parts.push(`${sender}: ${msg.content}`)
      }
      parts.push('')
    }

    // 通知メッセージ
    if (session.notification) {
      parts.push('【返信対象のメッセージ】')
      parts.push(`${session.notification.senderName}: ${session.notification.content}`)
      parts.push('')
    }

    parts.push('【指示】')
    parts.push('上記のメッセージに返信してください。')
    parts.push('- reply: 返信内容（1〜3文程度）')
    parts.push('- shouldContinue: まだ会話を続けたい場合はtrue')

    return parts.join('\n')
  }

  private buildCheckPrompt(
    character: SimCharacter,
    session: ChatSession,
    recentMessages: ChatMessageRecord[],
    existingSummary: ChatSummary | null,
    context?: ChatContext
  ): string {
    const parts: string[] = []

    parts.push(`${character.name}がチャンネル「${session.channelName}」のメッセージを確認しています。`)
    parts.push('')

    // 性格（共通ビルダー使用）
    parts.push(...buildPersonalitySection(character))

    // 世界情報（コンテキストがある場合）
    if (context) {
      parts.push(...buildStatusSection(character, context.currentTime))
      parts.push(...buildActionHistorySection(context.todayActions))
      parts.push(...buildMemoriesSection(context.midTermMemories))
      parts.push(...buildRecentConversationsSection(context.recentConversations))
    }

    // 現在のチャンネルのサマリー
    if (existingSummary) {
      parts.push('【これまでの要約】')
      parts.push(existingSummary.summary)
      parts.push('')
    }

    // 直近メッセージ
    if (recentMessages.length > 0) {
      parts.push('【直近のメッセージ】')
      for (const msg of recentMessages) {
        const sender = msg.isFromCharacter ? `[${character.name}]` : msg.senderName
        parts.push(`${sender}: ${msg.content}`)
      }
      parts.push('')
    }

    parts.push('【指示】')
    parts.push('上記のチャットを要約してください。')
    parts.push('- summary: 100文字程度の要約')
    parts.push('- importantInfo: 行動に影響する重要な情報があれば')

    return parts.join('\n')
  }

  private buildSendPrompt(
    character: SimCharacter,
    session: ChatSession,
    recentMessages: ChatMessageRecord[],
    existingSummary: ChatSummary | null,
    context?: ChatContext
  ): string {
    const parts: string[] = []

    parts.push(`あなたは${character.name}です。`)
    parts.push(`チャンネル「${session.channelName}」にメッセージを送信しようとしています。`)
    parts.push('')

    // 性格（共通ビルダー使用）
    parts.push(...buildPersonalitySection(character))

    // 送信意図
    if (session.intent) {
      parts.push('【送信したいこと】')
      parts.push(session.intent)
      parts.push('')
    }

    // 世界情報（コンテキストがある場合）
    if (context) {
      parts.push(...buildStatusSection(character, context.currentTime))
      parts.push(...buildScheduleSection(context.schedule))
      parts.push(...buildActionHistorySection(context.todayActions))
      parts.push(...buildMemoriesSection(context.midTermMemories))
      parts.push(...buildRecentConversationsSection(context.recentConversations))
      // 他チャンネルのサマリー
      const otherChannelSummaries = context.chatSummaries?.filter(
        s => s.channelId !== session.channelId
      )
      parts.push(...buildChatSummariesSection(otherChannelSummaries))
      parts.push(...buildNearbyMapsSection(context.nearbyMaps))
    }

    // 現在のチャンネルのサマリー
    if (existingSummary) {
      parts.push('【このチャンネルでの過去の会話】')
      parts.push(existingSummary.summary)
      parts.push('')
    }

    // 直近メッセージ
    if (recentMessages.length > 0) {
      parts.push('【直近のメッセージ】')
      for (const msg of recentMessages) {
        const sender = msg.isFromCharacter ? `[自分]` : msg.senderName
        parts.push(`${sender}: ${msg.content}`)
      }
      parts.push('')
    }

    parts.push('【指示】')
    parts.push('送信するメッセージを生成してください。')
    parts.push('- message: 送信内容（1〜3文程度）')

    return parts.join('\n')
  }

  // ==========================================================================
  // ヘルパー
  // ==========================================================================

  private async loadRecentMessages(session: ChatSession): Promise<ChatMessageRecord[]> {
    if (!this.stateStore) return []

    try {
      return await this.stateStore.loadRecentChatMessages(
        session.providerId,
        session.channelId,
        10
      )
    } catch (error) {
      console.error(`[ChatExecutor] Failed to load recent messages:`, error)
      return []
    }
  }

  private async loadChatSummary(characterId: string, session: ChatSession): Promise<ChatSummary | null> {
    if (!this.stateStore) return null

    try {
      return await this.stateStore.loadChatSummary(
        characterId,
        session.providerId,
        session.channelId
      )
    } catch (error) {
      console.error(`[ChatExecutor] Failed to load chat summary:`, error)
      return null
    }
  }

  private async saveOutgoingMessage(
    characterId: string,
    session: ChatSession,
    content: string,
    messageId?: string
  ): Promise<void> {
    if (!this.stateStore) return

    const now = Date.now()
    await this.stateStore.saveChatMessage({
      providerId: session.providerId,
      channelId: session.channelId,
      channelName: session.channelName,
      messageId: messageId ?? `char-${characterId}-${now}`,
      senderId: characterId,
      senderName: characterId, // キャラクター名は後で取得
      content,
      isFromCharacter: true,
      characterId,
      timestamp: now,
      createdAt: now,
    })
  }

  private async runPostProcessor(
    character: SimCharacter,
    session: ChatSession,
    recentMessages: ChatMessageRecord[]
  ): Promise<void> {
    if (!this.postProcessor) return

    try {
      await this.postProcessor.process(
        character,
        session,
        recentMessages,
        this.stateStore
      )
    } catch (error) {
      console.error(`[ChatExecutor] PostProcessor error:`, error)
    }
  }

  private emitMessage(
    characterId: string,
    session: ChatSession,
    content: string,
    isFromCharacter: boolean
  ): void {
    if (this.onMessageEmit) {
      this.onMessageEmit(
        characterId,
        session.providerId,
        session.channelId,
        session.channelName,
        content,
        isFromCharacter
      )
    }
  }

  private completeChat(characterId: string, success: boolean): void {
    this.chatManager.endSession(characterId)
    if (this.onChatComplete) {
      this.onChatComplete(characterId, success)
    }
  }
}
