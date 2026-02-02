/**
 * Discord用チャットプロバイダー
 * Gateway Bot経由でメッセージ送受信を行う
 */

import type { ChatProvider, DiscordWebhookPayload } from '../ChatProvider'
import type {
  ChatProviderId,
  ChatIncomingMessage,
  ChatOutgoingMessage,
  ChatSendResult,
  ChatProviderConfig,
} from '@/types/chat'

export class DiscordProvider implements ChatProvider {
  readonly providerId: ChatProviderId = 'discord'

  private gatewayUrl: string = ''
  private gatewaySecret: string = ''
  private defaultCharacters: string[] = []
  private channelMapping: Map<string, string[]> = new Map()
  private ready: boolean = false

  async initialize(config: ChatProviderConfig): Promise<void> {
    if (!config.discordGatewayUrl || !config.discordGatewaySecret) {
      throw new Error('Discord configuration incomplete: gatewayUrl and gatewaySecret required')
    }

    this.gatewayUrl = config.discordGatewayUrl
    this.gatewaySecret = config.discordGatewaySecret
    this.defaultCharacters = config.discordDefaultCharacters ?? []
    this.channelMapping = config.discordChannelMapping ?? new Map()
    this.ready = true

    console.log(`[DiscordProvider] Initialized with ${this.channelMapping.size} channel mappings, ${this.defaultCharacters.length} default characters`)
  }

  async sendMessage(message: ChatOutgoingMessage): Promise<ChatSendResult> {
    if (!this.ready) {
      return { success: false, error: 'Provider not initialized' }
    }

    try {
      const response = await fetch(`${this.gatewayUrl}/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Gateway-Secret': this.gatewaySecret,
        },
        body: JSON.stringify({
          channelId: message.channelId,
          content: message.content,
          replyToMessageId: message.replyToMessageId,
        }),
      })

      if (!response.ok) {
        const errorText = await response.text()
        return { success: false, error: `Gateway error: ${response.status} ${errorText}` }
      }

      const result = await response.json() as { success: boolean; messageId?: string; error?: string }
      return result
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      console.error('[DiscordProvider] Failed to send message:', error)
      return { success: false, error: errorMessage }
    }
  }

  parseWebhookPayload(payload: unknown): ChatIncomingMessage | null {
    if (!this.isValidPayload(payload)) {
      return null
    }

    const p = payload as DiscordWebhookPayload

    return {
      providerId: 'discord',
      messageId: p.messageId,
      channelId: p.channelId,
      channelName: p.channelName,
      senderId: p.senderId,
      senderName: p.senderName,
      content: p.content,
      isDM: p.isDM,
      isMention: p.isMention,
      timestamp: p.timestamp,
    }
  }

  private isValidPayload(payload: unknown): payload is DiscordWebhookPayload {
    if (!payload || typeof payload !== 'object') return false

    const p = payload as Record<string, unknown>
    return (
      typeof p.messageId === 'string' &&
      typeof p.channelId === 'string' &&
      typeof p.channelName === 'string' &&
      typeof p.senderId === 'string' &&
      typeof p.senderName === 'string' &&
      typeof p.content === 'string' &&
      typeof p.isDM === 'boolean' &&
      typeof p.isMention === 'boolean' &&
      typeof p.timestamp === 'number'
    )
  }

  shouldNotify(message: ChatIncomingMessage): boolean {
    // DMまたはメンションの場合のみ通知
    return message.isDM || message.isMention
  }

  formatChannelName(message: ChatIncomingMessage): string {
    // channelNameはGateway Bot側で設定済み
    return message.channelName
  }

  /**
   * チャンネルに参加しているキャラクターを取得
   */
  getCharactersForChannel(channelId: string): string[] {
    // 特定のマッピングがあればそれを使用
    const mapped = this.channelMapping.get(channelId)
    if (mapped && mapped.length > 0) {
      return mapped
    }

    // なければデフォルトキャラクター
    return this.defaultCharacters
  }

  isReady(): boolean {
    return this.ready
  }

  async shutdown(): Promise<void> {
    this.ready = false
    console.log('[DiscordProvider] Shutdown')
  }
}
