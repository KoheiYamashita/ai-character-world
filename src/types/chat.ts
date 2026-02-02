/**
 * チャット連携機能の型定義
 * Discord/Slack/LINE等の外部チャットプラットフォームとの連携用
 */

// =============================================================================
// プロバイダー識別子
// =============================================================================

export type ChatProviderId = 'discord' | 'slack' | 'line'

// =============================================================================
// メッセージ型
// =============================================================================

/**
 * 外部からの受信メッセージ（Gateway Bot経由）
 */
export interface ChatIncomingMessage {
  providerId: ChatProviderId
  messageId: string           // プロバイダー側のメッセージID
  channelId: string           // チャンネル/ルームID
  channelName: string         // 表示名（DM: ユーザー名、グループ: サーバー名-チャンネル名）
  senderId: string            // 送信者ID
  senderName: string          // 送信者表示名
  content: string             // メッセージ本文
  isDM: boolean               // ダイレクトメッセージか
  isMention: boolean          // Botへのメンションか
  timestamp: number           // メッセージタイムスタンプ
}

/**
 * キャラクターからの送信メッセージ
 */
export interface ChatOutgoingMessage {
  providerId: ChatProviderId
  channelId: string
  content: string
  replyToMessageId?: string   // 返信先メッセージID（任意）
}

/**
 * メッセージ送信結果
 */
export interface ChatSendResult {
  success: boolean
  messageId?: string          // 送信成功時のメッセージID
  error?: string              // エラーメッセージ
}

// =============================================================================
// 通知・セッション管理
// =============================================================================

/**
 * 保留中の通知（@メンション/DMで受信、未応答のもの）
 */
export interface PendingNotification {
  id: string                  // 一意のID
  providerId: ChatProviderId
  channelId: string
  channelName: string
  messageId: string           // トリガーとなったメッセージID
  senderId: string
  senderName: string
  content: string
  receivedAt: number          // 受信時刻
}

/**
 * チャットセッションの種類
 */
export type ChatSessionType = 'reply' | 'check' | 'send'

/**
 * アクティブなチャットセッション
 */
export interface ChatSession {
  id: string
  characterId: string
  type: ChatSessionType
  providerId: ChatProviderId
  channelId: string
  channelName: string
  notification?: PendingNotification  // reply時のトリガー通知
  intent?: string                     // send時の送信意図
  startedAt: number
}

// =============================================================================
// チャットサマリー（記憶システム用）
// =============================================================================

/**
 * チャンネルごとの会話サマリー
 * キャラクターの記憶としてLLMコンテキストに提供
 */
export interface ChatSummary {
  characterId: string
  providerId: ChatProviderId
  channelId: string
  channelName: string         // DM: ユーザー名、グループ: サーバー名-チャンネル名
  summary: string             // 最新のサマリー（LLM生成）
  lastInteractionAt: number   // 最終やりとり時刻
  totalMessages: number       // 累計メッセージ数
  updatedAt: number           // サマリー更新時刻
}

// =============================================================================
// DBに保存するメッセージ
// =============================================================================

/**
 * DB保存用メッセージ（7日間保持）
 */
export interface ChatMessageRecord {
  id?: number                 // DB auto-increment
  providerId: ChatProviderId
  channelId: string
  channelName: string
  messageId: string           // プロバイダー側のID（重複防止用）
  senderId: string
  senderName: string
  content: string
  isFromCharacter: boolean    // キャラクターからの送信か
  characterId?: string        // キャラクター発言の場合のID
  timestamp: number           // メッセージタイムスタンプ
  createdAt: number           // DB登録時刻
}

// =============================================================================
// プロバイダー設定
// =============================================================================

/**
 * プロバイダー初期化設定
 */
export interface ChatProviderConfig {
  providerId: ChatProviderId
  // Discord
  discordGatewayUrl?: string          // Gateway Botのメッセージ送信URL
  discordGatewaySecret?: string       // Gateway Bot認証用シークレット
  discordDefaultCharacters?: string[] // デフォルト参加キャラクター
  discordChannelMapping?: Map<string, string[]>  // channelId -> characterIds
}

/**
 * チャンネル→キャラクター マッピング
 * 複数キャラクターが同じチャンネルに参加可能
 */
export interface ChannelCharacterMapping {
  channelId: string
  characterIds: string[]
}

// =============================================================================
// ChatExecutor用コンテキスト
// =============================================================================

// Re-export for convenience (actual types from behavior.ts)
import type { WorldTime, ScheduleEntry } from '@/types'
import type { ActionHistoryEntry, MidTermMemory, RecentConversation, NearbyMap } from '@/types/behavior'

/**
 * ChatExecutor用のコンテキスト情報
 * ConversationContextと類似の構造で、チャットアクション実行時に世界情報を提供
 */
export interface ChatContext {
  /** 現在のワールド時間 */
  currentTime: WorldTime
  /** 今日の行動履歴 */
  todayActions: ActionHistoryEntry[]
  /** 今日のスケジュール */
  schedule: ScheduleEntry[] | null
  /** 中期記憶（行動に影響する情報） */
  midTermMemories: MidTermMemory[]
  /** 直近のNPC会話サマリー（全NPC各1件） */
  recentConversations: RecentConversation[]
  /** 全チャンネルの会話サマリー */
  chatSummaries?: ChatSummary[]
  /** 周辺の場所 */
  nearbyMaps?: NearbyMap[]
}
