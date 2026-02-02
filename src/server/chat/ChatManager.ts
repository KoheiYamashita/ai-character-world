/**
 * チャット通知キューとセッション管理
 * キャラクターごとの通知キューとアクティブセッションを管理する
 */

import type {
  ChatProviderId,
  ChatIncomingMessage,
  PendingNotification,
  ChatSession,
} from '@/types/chat'
import { v4 as uuidv4 } from 'uuid'

export class ChatManager {
  // キャラクターごとの通知キュー (characterId -> notifications[])
  private notificationQueues: Map<string, PendingNotification[]> = new Map()

  // キャラクターごとのアクティブセッション (characterId -> session)
  private activeSessions: Map<string, ChatSession> = new Map()

  // ==========================================================================
  // 通知キュー管理
  // ==========================================================================

  /**
   * 通知をキューに追加
   */
  queueNotification(characterId: string, message: ChatIncomingMessage): void {
    const notification: PendingNotification = {
      id: uuidv4(),
      providerId: message.providerId,
      channelId: message.channelId,
      channelName: message.channelName,
      messageId: message.messageId,
      senderId: message.senderId,
      senderName: message.senderName,
      content: message.content,
      receivedAt: Date.now(),
    }

    const queue = this.notificationQueues.get(characterId) ?? []
    queue.push(notification)
    this.notificationQueues.set(characterId, queue)

    console.log(`[ChatManager] Queued notification for ${characterId}: "${message.content.substring(0, 50)}..."`)
  }

  /**
   * キャラクターの保留中通知を取得
   */
  getPendingNotifications(characterId: string): PendingNotification[] {
    return this.notificationQueues.get(characterId) ?? []
  }

  /**
   * キャラクターに保留中の通知があるかどうか
   */
  hasPendingNotifications(characterId: string): boolean {
    const queue = this.notificationQueues.get(characterId)
    return queue !== undefined && queue.length > 0
  }

  /**
   * 通知をキューから削除
   */
  removeNotification(characterId: string, notificationId: string): void {
    const queue = this.notificationQueues.get(characterId)
    if (!queue) return

    const index = queue.findIndex(n => n.id === notificationId)
    if (index !== -1) {
      queue.splice(index, 1)
    }

    if (queue.length === 0) {
      this.notificationQueues.delete(characterId)
    }
  }

  /**
   * キャラクターの全通知をクリア
   */
  clearNotifications(characterId: string): void {
    this.notificationQueues.delete(characterId)
  }

  /**
   * 最も古い通知を取得（FIFO）
   */
  getOldestNotification(characterId: string): PendingNotification | null {
    const queue = this.notificationQueues.get(characterId)
    if (!queue || queue.length === 0) return null
    return queue[0]
  }

  // ==========================================================================
  // セッション管理
  // ==========================================================================

  /**
   * 返信セッションを開始
   */
  startReplySession(characterId: string, notification: PendingNotification): ChatSession {
    const session: ChatSession = {
      id: uuidv4(),
      characterId,
      type: 'reply',
      providerId: notification.providerId,
      channelId: notification.channelId,
      channelName: notification.channelName,
      notification,
      startedAt: Date.now(),
    }

    this.activeSessions.set(characterId, session)
    console.log(`[ChatManager] Started reply session for ${characterId} to ${notification.senderName}`)
    return session
  }

  /**
   * チェックセッションを開始
   */
  startCheckSession(
    characterId: string,
    providerId: ChatProviderId,
    channelId: string,
    channelName: string
  ): ChatSession {
    const session: ChatSession = {
      id: uuidv4(),
      characterId,
      type: 'check',
      providerId,
      channelId,
      channelName,
      startedAt: Date.now(),
    }

    this.activeSessions.set(characterId, session)
    console.log(`[ChatManager] Started check session for ${characterId} on ${channelName}`)
    return session
  }

  /**
   * 送信セッションを開始
   */
  startSendSession(
    characterId: string,
    providerId: ChatProviderId,
    channelId: string,
    channelName: string,
    intent: string
  ): ChatSession {
    const session: ChatSession = {
      id: uuidv4(),
      characterId,
      type: 'send',
      providerId,
      channelId,
      channelName,
      intent,
      startedAt: Date.now(),
    }

    this.activeSessions.set(characterId, session)
    console.log(`[ChatManager] Started send session for ${characterId}: ${intent}`)
    return session
  }

  /**
   * セッションを終了
   */
  endSession(characterId: string): void {
    const session = this.activeSessions.get(characterId)
    if (session) {
      // replyセッションの場合、通知をキューから削除
      if (session.type === 'reply' && session.notification) {
        this.removeNotification(characterId, session.notification.id)
      }

      this.activeSessions.delete(characterId)
      console.log(`[ChatManager] Ended ${session.type} session for ${characterId}`)
    }
  }

  /**
   * アクティブセッションを取得
   */
  getActiveSession(characterId: string): ChatSession | null {
    return this.activeSessions.get(characterId) ?? null
  }

  /**
   * キャラクターがチャットセッション中かどうか
   */
  hasActiveSession(characterId: string): boolean {
    return this.activeSessions.has(characterId)
  }

  // ==========================================================================
  // ユーティリティ
  // ==========================================================================

  /**
   * 全キャラクターの保留中通知数を取得
   */
  getTotalPendingCount(): number {
    let total = 0
    for (const queue of this.notificationQueues.values()) {
      total += queue.length
    }
    return total
  }

  /**
   * 通知があるキャラクターIDのリストを取得
   */
  getCharactersWithNotifications(): string[] {
    return Array.from(this.notificationQueues.keys()).filter(
      id => this.hasPendingNotifications(id)
    )
  }
}
