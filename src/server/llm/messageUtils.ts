/**
 * 会話履歴をAI SDK ModelMessage配列に変換するユーティリティ
 */

import type { ModelMessage } from 'ai'
import type { ConversationMessage } from '@/types/conversation'
import type { ChatMessageRecord } from '@/types/chat'

/**
 * 会話メッセージを変換する共通ヘルパー
 * @param messages 会話メッセージ配列
 * @param assistantSpeaker assistant ロールとして扱う speaker 値
 */
function mapConversationMessages(
  messages: ConversationMessage[],
  assistantSpeaker: 'character' | 'npc'
): ModelMessage[] {
  return messages.map((msg) => ({
    role: msg.speaker === assistantSpeaker ? 'assistant' as const : 'user' as const,
    content: msg.utterance,
  }))
}

/**
 * NPC会話: キャラクター発話生成用
 * LLMがキャラクターをシミュレートするため:
 * - 過去のキャラクター発話 → assistant（LLMの出力）
 * - 過去のNPC発話 → user（入力）
 */
export function conversationToMessagesForCharacter(
  messages: ConversationMessage[]
): ModelMessage[] {
  return mapConversationMessages(messages, 'character')
}

/**
 * NPC会話: NPC発話生成用
 * LLMがNPCをシミュレートするため:
 * - 過去のNPC発話 → assistant（LLMの出力）
 * - 過去のキャラクター発話 → user（入力）
 */
export function conversationToMessagesForNPC(
  messages: ConversationMessage[]
): ModelMessage[] {
  return mapConversationMessages(messages, 'npc')
}

/**
 * チャット: キャラクター返信生成用
 * LLMがキャラクターをシミュレートするため:
 * - 過去のキャラクター発話 → assistant（LLMの出力）
 * - 外部ユーザー発話 → user（入力）
 */
export function chatToMessagesForCharacter(
  messages: ChatMessageRecord[]
): ModelMessage[] {
  return messages.map((msg) => {
    if (msg.isFromCharacter) {
      return {
        role: 'assistant' as const,
        content: msg.content,
      }
    }
    // 外部ユーザーの場合は送信者名を含める
    return {
      role: 'user' as const,
      content: `${msg.senderName}: ${msg.content}`,
    }
  })
}
