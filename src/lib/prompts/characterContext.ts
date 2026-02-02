/**
 * 共通プロンプトセクションビルダー
 * ConversationExecutor と ChatExecutor で共通して使用するプロンプト構築関数
 */

import type { SimCharacter } from '@/server/simulation/types'
import type { WorldTime, ScheduleEntry, NPC } from '@/types'
import type { ActionHistoryEntry, MidTermMemory, RecentConversation, NearbyMap } from '@/types/behavior'
import type { ChatSummary } from '@/types/chat'

/**
 * 性格セクションを構築
 * - 性格（personality）
 * - 行動傾向（tendencies）
 * - その他の設定（customPrompt）
 */
export function buildPersonalitySection(character: SimCharacter | NPC): string[] {
  const parts: string[] = []

  parts.push('【あなたの性格】')
  parts.push(character.personality || '（未設定）')
  parts.push('')

  if (character.tendencies && character.tendencies.length > 0) {
    parts.push('【行動傾向】')
    parts.push(character.tendencies.map(t => `- ${t}`).join('\n'))
    parts.push('')
  }

  if (character.customPrompt) {
    parts.push('【その他の設定】')
    parts.push(character.customPrompt)
    parts.push('')
  }

  return parts
}

/**
 * ステータスセクションを構築
 * - 時刻
 * - 満腹度、エネルギー、気分
 */
export function buildStatusSection(character: SimCharacter, currentTime: WorldTime): string[] {
  const parts: string[] = []

  parts.push('【現在のステータス】')
  parts.push(`- 時刻: ${currentTime.hour}:${String(currentTime.minute).padStart(2, '0')}`)
  parts.push(`- 満腹度: ${character.satiety.toFixed(0)}%`)
  parts.push(`- エネルギー: ${character.energy.toFixed(0)}%`)
  parts.push(`- 気分: ${character.mood.toFixed(0)}%`)
  parts.push('')

  return parts
}

/**
 * スケジュールセクションを構築
 */
export function buildScheduleSection(schedule: ScheduleEntry[] | null): string[] {
  if (!schedule || schedule.length === 0) return []

  const parts: string[] = []
  parts.push('【今日のスケジュール】')
  parts.push(schedule.map(e => `- ${e.time}: ${e.activity}`).join('\n'))
  parts.push('')

  return parts
}

/**
 * 行動履歴セクションを構築
 */
export function buildActionHistorySection(todayActions: ActionHistoryEntry[]): string[] {
  if (todayActions.length === 0) return []

  const parts: string[] = []
  parts.push('【今日の行動】')
  parts.push(todayActions.map(a => {
    let line = `- ${a.time} ${a.actionId}`
    if (a.target) line += ` → ${a.target}`
    if (a.reason) line += ` [${a.reason}]`
    if (a.episode) line += `\n  ✨ ${a.episode}`
    return line
  }).join('\n'))
  parts.push('')

  return parts
}

/**
 * 中期記憶セクションを構築
 */
export function buildMemoriesSection(midTermMemories: MidTermMemory[]): string[] {
  if (midTermMemories.length === 0) return []

  const parts: string[] = []
  parts.push('【重要な記憶】')
  parts.push(midTermMemories.map(m => `- ${m.content}`).join('\n'))
  parts.push('')

  return parts
}

/**
 * 直近のNPC会話セクションを構築
 */
export function buildRecentConversationsSection(recentConversations: RecentConversation[]): string[] {
  if (recentConversations.length === 0) return []

  const parts: string[] = []
  parts.push('【直近の会話（過去）】')
  parts.push(recentConversations.map(c => `- ${c.npcName}: ${c.summary}`).join('\n'))
  parts.push('')

  return parts
}

/**
 * チャット要約セクションを構築
 */
export function buildChatSummariesSection(chatSummaries: ChatSummary[] | undefined): string[] {
  if (!chatSummaries || chatSummaries.length === 0) return []

  const parts: string[] = []
  parts.push('【チャットでの関係】')
  // 最大3件に制限（行動決定と同様）
  for (const summary of chatSummaries.slice(0, 3)) {
    parts.push(`- ${summary.channelName}: ${summary.summary}`)
  }
  parts.push('')

  return parts
}

/**
 * 周辺場所セクションを構築
 */
export function buildNearbyMapsSection(nearbyMaps: NearbyMap[] | undefined): string[] {
  if (!nearbyMaps || nearbyMaps.length === 0) return []

  const parts: string[] = []
  parts.push('【周辺の場所】')
  for (const m of nearbyMaps) {
    if (m.distance === 0) {
      parts.push(`- ${m.label}（現在地）`)
    } else {
      parts.push(`- ${m.label}`)
    }
  }
  parts.push('')

  return parts
}

/**
 * 周辺場所の注意書きを追加
 * nearbyMapsセクションの後に追加する
 */
export function buildNearbyMapsNote(context: 'character' | 'npc'): string[] {
  if (context === 'character') {
    return [
      '※上記以外にも、【重要な記憶】【直近の会話（過去）】【今日の行動】で言及された場所は話題にできます。',
      '  存在しない施設や店について話さないでください。',
      '',
    ]
  } else {
    return [
      '※上記以外にも、【あなたの知識・事実】【これまでの会話】で言及された場所は話題にできます。',
      '  存在しない施設や店について話さないでください。',
      '',
    ]
  }
}
