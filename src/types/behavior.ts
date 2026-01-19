import type { ActionId } from '@/server/simulation/actions/definitions'
import type { SimCharacter, SimNPC } from '@/server/simulation/types'
import type { FacilityInfo, WorldTime, ScheduleEntry } from '@/types'

/**
 * 行動決定に必要なコンテキスト
 */
export interface BehaviorContext {
  character: SimCharacter
  currentTime: WorldTime
  currentFacility: FacilityInfo | null
  schedule: ScheduleEntry[] | null  // 当日のスケジュール
  availableActions: ActionId[]      // 現在実行可能なアクション
  nearbyNPCs: SimNPC[]              // 周囲のNPC
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
}
