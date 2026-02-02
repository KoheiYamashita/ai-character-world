import type { RecentConversation, NPCWithCooldown } from '@/types/behavior'
import type { SimNPC } from '@/server/simulation/types'
import { minutesToTime } from './timeUtils'

// Cooldown period in game minutes (1 hour = 60 minutes)
export const CONVERSATION_COOLDOWN_MINUTES = 60

/**
 * 行動決定時のフィルタ: 同日直近3件に制限
 */
export function filterForBehaviorDecision(
  conversations: RecentConversation[] | undefined
): RecentConversation[] {
  if (!conversations || conversations.length === 0) {
    return []
  }
  // timestampで降順ソート（新しい順）して直近3件を取得
  return [...conversations]
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 3)
}

/**
 * 会話時のフィルタ: 対象NPC同日全件 + 他NPC同日直近1件
 */
export function filterForConversation(
  conversations: RecentConversation[] | undefined,
  targetNpcId: string
): RecentConversation[] {
  if (!conversations || conversations.length === 0) {
    return []
  }

  // 対象NPCの会話全件
  const targetNpcConversations = conversations.filter(c => c.npcId === targetNpcId)

  // 他NPCの会話から、各NPCごとに直近1件を取得
  const otherConversations = conversations.filter(c => c.npcId !== targetNpcId)

  // NPCごとにグループ化し、各グループから最新1件を取得
  const otherNpcLatest: RecentConversation[] = []
  const seenNpcIds = new Set<string>()

  // timestampで降順ソート（新しい順）
  const sortedOther = [...otherConversations].sort((a, b) => b.timestamp - a.timestamp)

  for (const conv of sortedOther) {
    if (!seenNpcIds.has(conv.npcId)) {
      seenNpcIds.add(conv.npcId)
      otherNpcLatest.push(conv)
    }
  }

  // 結果をtimestampで降順ソート（新しい順）して返す
  return [...targetNpcConversations, ...otherNpcLatest]
    .sort((a, b) => b.timestamp - a.timestamp)
}

/**
 * チャット用フィルタ: 全NPC各1件ずつ（直近のもの）
 * NPCとの対面会話がないため、全NPCを平等に扱う
 */
export function filterLatestPerNPC(
  conversations: RecentConversation[] | undefined
): RecentConversation[] {
  if (!conversations || conversations.length === 0) {
    return []
  }

  // NPCごとに最新1件を取得
  const seenNpcIds = new Set<string>()
  const result: RecentConversation[] = []

  // timestampで降順ソート（新しい順）
  const sorted = [...conversations].sort((a, b) => b.timestamp - a.timestamp)

  for (const conv of sorted) {
    if (!seenNpcIds.has(conv.npcId)) {
      seenNpcIds.add(conv.npcId)
      result.push(conv)
    }
  }

  return result
}

/**
 * NPCごとの最新会話タイムスタンプを取得
 */
function getLatestConversationTimes(
  recentConversations: RecentConversation[]
): Map<string, number> {
  const npcLastConversationTime = new Map<string, number>()
  for (const conv of recentConversations) {
    const existing = npcLastConversationTime.get(conv.npcId)
    if (existing === undefined || conv.timestamp > existing) {
      npcLastConversationTime.set(conv.npcId, conv.timestamp)
    }
  }
  return npcLastConversationTime
}

/**
 * NPCをクールダウン期間でフィルタ
 * 最近会話したNPC（ゲーム内1時間以内）を除外する
 *
 * @param npcs フィルタ対象のNPC配列
 * @param recentConversations 直近の会話履歴（timestampはワールド時間分単位）
 * @param currentTimeMinutes 現在のワールド時間（分単位: day*24*60 + hour*60 + minute）
 * @returns クールダウン期間外のNPC配列
 */
export function filterNPCsByCooldown(
  npcs: SimNPC[],
  recentConversations: RecentConversation[] | undefined,
  currentTimeMinutes: number
): SimNPC[] {
  if (!recentConversations || recentConversations.length === 0) {
    return npcs
  }

  const npcLastConversationTime = getLatestConversationTimes(recentConversations)

  return npcs.filter(npc => {
    const lastConv = npcLastConversationTime.get(npc.id)
    if (lastConv === undefined) {
      return true // No recent conversation, include NPC
    }
    const elapsed = currentTimeMinutes - lastConv
    return elapsed >= CONVERSATION_COOLDOWN_MINUTES
  })
}

/**
 * NPCにクールダウン情報を付加
 * フィルタリングせず、クールダウン中のNPCには nextAvailableTime を設定して返す
 *
 * @param npcs 対象のNPC配列
 * @param recentConversations 直近の会話履歴（timestampはワールド時間分単位）
 * @param currentTimeMinutes 現在のワールド時間（分単位: day*24*60 + hour*60 + minute）
 * @returns クールダウン情報付きNPC配列
 */
export function addCooldownInfoToNPCs(
  npcs: SimNPC[],
  recentConversations: RecentConversation[] | undefined,
  currentTimeMinutes: number
): NPCWithCooldown[] {
  if (!npcs || npcs.length === 0) {
    return []
  }

  // No conversations - all NPCs are available
  if (!recentConversations || recentConversations.length === 0) {
    return npcs.map(npc => ({ id: npc.id, name: npc.name }))
  }

  const npcLastConversationTime = getLatestConversationTimes(recentConversations)

  return npcs.map(npc => {
    const lastConv = npcLastConversationTime.get(npc.id)
    if (lastConv === undefined) {
      // No recent conversation, NPC is available
      return { id: npc.id, name: npc.name }
    }

    const elapsed = currentTimeMinutes - lastConv
    if (elapsed >= CONVERSATION_COOLDOWN_MINUTES) {
      // Cooldown period has passed, NPC is available
      return { id: npc.id, name: npc.name }
    }

    // NPC is in cooldown - calculate next available time
    const nextAvailableMinutes = lastConv + CONVERSATION_COOLDOWN_MINUTES
    const { hour, minute } = minutesToTime(nextAvailableMinutes)
    const nextAvailableTime = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`

    return { id: npc.id, name: npc.name, nextAvailableTime }
  })
}
