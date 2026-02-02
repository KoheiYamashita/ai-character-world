/**
 * チャット機能のエクスポート
 */

// プロバイダーインターフェース
export type { ChatProvider, DiscordWebhookPayload } from './ChatProvider'
export { isValidDiscordConfig } from './ChatProvider'

// クライアント（プロバイダーファクトリ）
export {
  initializeChatProviders,
  getChatProvider,
  getEnabledProviders,
  isChatEnabled,
  getCharactersForChannel,
  shutdownChatProviders,
} from './client'

// マネージャー
export { ChatManager } from './ChatManager'

// エグゼキューター
export { ChatExecutor } from './ChatExecutor'

// ポストプロセッサー
export { ChatPostProcessor } from './ChatPostProcessor'

// プロバイダー実装
export { DiscordProvider } from './providers/DiscordProvider'
