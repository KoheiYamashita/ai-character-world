/**
 * チャットプロバイダーの抽象インターフェース
 * Discord/Slack/LINE等の各プロバイダーはこれを実装する
 */

import type {
  ChatProviderId,
  ChatIncomingMessage,
  ChatOutgoingMessage,
  ChatSendResult,
  ChatProviderConfig,
} from '@/types/chat'

/**
 * チャットプロバイダーの抽象インターフェース
 */
export interface ChatProvider {
  /**
   * プロバイダーの識別子
   */
  readonly providerId: ChatProviderId

  /**
   * 初期化
   * @param config プロバイダー設定
   */
  initialize(config: ChatProviderConfig): Promise<void>

  /**
   * メッセージ送信（Gateway Bot経由）
   * @param message 送信メッセージ
   */
  sendMessage(message: ChatOutgoingMessage): Promise<ChatSendResult>

  /**
   * Webhookペイロードをパースして共通形式に変換
   * @param payload Webhookリクエストボディ
   * @returns パース結果、無効なペイロードの場合はnull
   */
  parseWebhookPayload(payload: unknown): ChatIncomingMessage | null

  /**
   * 通知対象かどうかを判定（@メンション/DM）
   * @param message 受信メッセージ
   */
  shouldNotify(message: ChatIncomingMessage): boolean

  /**
   * チャンネル名を生成
   * DM: ユーザー名
   * グループ: サーバー名-チャンネル名
   */
  formatChannelName(message: ChatIncomingMessage): string

  /**
   * プロバイダーが使用可能かどうか
   */
  isReady(): boolean

  /**
   * シャットダウン
   */
  shutdown(): Promise<void>
}

/**
 * Discord Webhookペイロード型
 * Gateway Botから送信されるメッセージ形式
 */
export interface DiscordWebhookPayload {
  messageId: string
  channelId: string
  channelName: string
  senderId: string
  senderName: string
  content: string
  isDM: boolean
  isMention: boolean
  timestamp: number
}

/**
 * プロバイダー設定の検証
 */
export function isValidDiscordConfig(config: ChatProviderConfig): boolean {
  return !!(config.discordGatewayUrl && config.discordGatewaySecret)
}
