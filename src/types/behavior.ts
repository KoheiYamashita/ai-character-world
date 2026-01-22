import type { FacilityInfo, FacilityTag, WorldTime, ScheduleEntry, ActionId } from '@/types'
import type { SimCharacter, SimNPC } from '@/server/simulation/types'

/**
 * 施設情報（LLMに提示用）
 * 現在マップの施設（distance: 0）と他マップの施設（distance > 0）の両方を含む
 */
export interface NearbyFacility {
  id: string
  label: string
  tags: FacilityTag[]
  cost?: number              // 利用料金
  quality?: number           // 品質
  distance: number           // 距離（マップホップ数）、0=現在マップ、1以上=他マップ
  mapId: string              // 施設があるマップID
  availableActions?: string[] // この施設で実行可能なアクション（例: ['sleep'], ['eat']）
}

/**
 * 行動履歴エントリ
 */
export interface ActionHistoryEntry {
  time: string              // "HH:MM"形式
  actionId: string          // 実行したアクションID
  target?: string           // 対象（施設ID、NPC ID等）
  durationMinutes?: number  // 実行時間（分）
  reason?: string           // 行動理由（LLMが出力したもの）
}

/**
 * 直近の会話履歴（将来拡張用）
 */
export interface RecentConversation {
  npcId: string
  npcName: string
  summary: string
  timestamp: number
}

/**
 * 中期記憶（将来拡張用）
 */
export interface MidTermMemory {
  content: string
  importance: number
  timestamp: number
}

/**
 * スケジュール変更（LLMが行動決定時に提案）
 */
export interface ScheduleUpdate {
  type: 'add' | 'remove' | 'modify'
  entry: {
    time: string        // "HH:MM"
    activity: string
    location?: string
    note?: string
  }
}

/**
 * 移動可能なマップ情報（LLMに提示用）
 */
export interface NearbyMap {
  id: string
  label: string
  distance: number   // 現在地からのホップ数（0=現在のマップ）
}

/**
 * 現在マップの施設情報（アクションとの紐付け用）
 */
export interface CurrentMapFacility {
  id: string
  label: string
  tags: FacilityTag[]
  cost?: number
  availableActions: string[]  // この施設で実行可能なアクション
}

/**
 * 行動決定に必要なコンテキスト
 */
export interface BehaviorContext {
  character: SimCharacter
  currentTime: WorldTime
  currentFacility: FacilityInfo | null
  schedule: ScheduleEntry[] | null  // 当日のスケジュール
  availableActions: ActionId[]      // 現在実行可能なアクション
  nearbyNPCs: SimNPC[]              // 周囲のNPC（マップ内）
  // 拡張フィールド（LLMBehaviorDecider用）
  currentMapFacilities?: CurrentMapFacility[] // 現在マップの施設（アクション表示用）
  nearbyFacilities?: NearbyFacility[]         // 他マップの施設（移動が必要）
  nearbyMaps?: NearbyMap[]                    // 移動可能なマップ（3ホップ以内）
  recentConversations?: RecentConversation[]  // 直近の会話（将来拡張）
  midTermMemories?: MidTermMemory[]           // 中期記憶（将来拡張）
  todayActions?: ActionHistoryEntry[]         // 当日の行動履歴
}

/**
 * 行動決定の結果
 */
export interface BehaviorDecision {
  type: 'action' | 'move' | 'idle'
  actionId?: ActionId               // type='action'の場合
  targetNodeId?: string             // type='move'の場合
  targetMapId?: string              // マップ間移動の場合
  reason?: string                   // 決定理由（ログ用）
  // talk アクション用
  targetNpcId?: string              // 会話相手のNPC ID
  conversationGoal?: string         // 会話の目的
  // 施設選択用（eat, bathe等）
  targetFacilityId?: string         // 選択した施設ID
  // スケジュール変更（LLMが提案）
  scheduleUpdate?: ScheduleUpdate
  // 可変時間アクションの場合
  durationMinutes?: number          // 実行時間（分）
}
