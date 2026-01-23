/**
 * 施設タグとアクションのマッピング
 * SimulationEngine と LLMBehaviorDecider で使用される共通定義
 */

import type { FacilityTag } from '@/types'
import type { ActionId } from '@/types/action'

/**
 * 施設タグ → アクションID
 * 施設タグから実行するアクションIDを決定
 */
export const FACILITY_TAG_TO_ACTION_ID: Record<string, ActionId> = {
  kitchen: 'eat',
  restaurant: 'eat',
  bathroom: 'bathe',
  hotspring: 'bathe',
  bedroom: 'sleep',
  toilet: 'toilet',
  workspace: 'work',
  public: 'rest',
}

/**
 * アクション → 要求施設タグ（逆引き）
 */
export const ACTION_TO_FACILITY_TAGS: Record<string, FacilityTag[]> = Object.entries(
  FACILITY_TAG_TO_ACTION_ID
).reduce(
  (acc, [tag, action]) => {
    if (!acc[action]) acc[action] = []
    acc[action].push(tag as FacilityTag)
    return acc
  },
  {} as Record<string, FacilityTag[]>
)

/**
 * 施設タグリストからアクションIDリストを取得（重複なし）
 */
export function getActionsForTags(tags: string[]): string[] {
  const actions: string[] = []
  for (const tag of tags) {
    const action = FACILITY_TAG_TO_ACTION_ID[tag]
    if (action && !actions.includes(action)) {
      actions.push(action)
    }
  }
  return actions
}
