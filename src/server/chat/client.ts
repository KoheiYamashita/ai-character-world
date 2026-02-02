/**
 * チャットプロバイダーのファクトリ
 * 環境変数からプロバイダーを初期化する
 */

import type { ChatProvider } from './ChatProvider'
import type { ChatProviderId, ChatProviderConfig } from '@/types/chat'
import { DiscordProvider } from './providers/DiscordProvider'

// シングルトンのプロバイダーマップ
const providers: Map<ChatProviderId, ChatProvider> = new Map()

/**
 * 環境変数からプロバイダー設定を読み込む
 */
function loadProviderConfig(): ChatProviderConfig | null {
  const enabledProviders = process.env.CHAT_PROVIDERS?.split(',').map(p => p.trim()) ?? []

  if (enabledProviders.length === 0) {
    return null
  }

  // 現在はDiscordのみサポート
  if (!enabledProviders.includes('discord')) {
    return null
  }

  const gatewayUrl = process.env.CHAT_DISCORD_GATEWAY_URL
  const gatewaySecret = process.env.CHAT_DISCORD_GATEWAY_SECRET

  if (!gatewayUrl || !gatewaySecret) {
    console.warn('[ChatClient] Discord configuration incomplete: CHAT_DISCORD_GATEWAY_URL and CHAT_DISCORD_GATEWAY_SECRET required')
    return null
  }

  // デフォルトキャラクター（カンマ区切りで複数可）
  const defaultCharacters = process.env.CHAT_DISCORD_DEFAULT_CHARACTERS?.split(',').map(c => c.trim()) ?? []

  // チャンネル→キャラクター マッピング
  // 形式: "channelId1:char1|char2,channelId2:char3"
  const channelMapping = new Map<string, string[]>()
  const channelsEnv = process.env.CHAT_DISCORD_CHANNELS
  if (channelsEnv) {
    const entries = channelsEnv.split(',')
    for (const entry of entries) {
      const [channelId, chars] = entry.split(':')
      if (channelId && chars) {
        channelMapping.set(channelId.trim(), chars.split('|').map(c => c.trim()))
      }
    }
  }

  return {
    providerId: 'discord',
    discordGatewayUrl: gatewayUrl,
    discordGatewaySecret: gatewaySecret,
    discordDefaultCharacters: defaultCharacters,
    discordChannelMapping: channelMapping,
  }
}

/**
 * プロバイダーを初期化
 */
export async function initializeChatProviders(): Promise<void> {
  const config = loadProviderConfig()

  if (!config) {
    console.log('[ChatClient] No chat providers configured')
    return
  }

  try {
    const provider = new DiscordProvider()
    await provider.initialize(config)
    providers.set('discord', provider)
    console.log('[ChatClient] Discord provider initialized')
  } catch (error) {
    console.error('[ChatClient] Failed to initialize Discord provider:', error)
  }
}

/**
 * プロバイダーを取得
 */
export function getChatProvider(providerId: ChatProviderId): ChatProvider | null {
  return providers.get(providerId) ?? null
}

/**
 * 有効なプロバイダー一覧を取得
 */
export function getEnabledProviders(): ChatProviderId[] {
  return Array.from(providers.keys())
}

/**
 * チャット機能が有効かどうか
 */
export function isChatEnabled(): boolean {
  return providers.size > 0
}

/**
 * チャンネルに参加しているキャラクターを取得
 */
export function getCharactersForChannel(providerId: ChatProviderId, channelId: string): string[] {
  const provider = providers.get(providerId)
  if (!provider) return []

  // DiscordProviderの場合、設定からマッピングを取得
  if (providerId === 'discord' && provider instanceof DiscordProvider) {
    return provider.getCharactersForChannel(channelId)
  }

  return []
}

/**
 * 全プロバイダーをシャットダウン
 */
export async function shutdownChatProviders(): Promise<void> {
  for (const [id, provider] of providers) {
    try {
      await provider.shutdown()
      console.log(`[ChatClient] ${id} provider shutdown`)
    } catch (error) {
      console.error(`[ChatClient] Failed to shutdown ${id} provider:`, error)
    }
  }
  providers.clear()
}
