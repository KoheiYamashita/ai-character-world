/**
 * 施設タグとアクションのマッピング
 * SimulationEngine と LLMBehaviorDecider で使用される共通定義
 */

import type { FacilityTag } from '@/types'
import type { ActionId } from '@/types/action'

/**
 * 施設タグ → 抽象アクション（UI表示用）
 * 施設でどんな「種類の」行動ができるかを示す
 */
export const TAG_TO_ABSTRACT_ACTIONS: Record<string, string[]> = {
  bedroom: ['sleep'],
  kitchen: ['eat'],
  restaurant: ['eat'],
  bathroom: ['bathe'],
  hotspring: ['bathe'],
  toilet: ['toilet'],
  workspace: ['work'],
  public: ['rest'],
}

/**
 * 施設タグ → 具体的アクションID
 * 実際に実行するアクションIDを決定
 */
export const FACILITY_TAG_TO_ACTION_ID: Record<string, ActionId> = {
  kitchen: 'eat_home',
  restaurant: 'eat_restaurant',
  bathroom: 'bathe_home',
  hotspring: 'bathe_hotspring',
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
 * 施設タグから抽象アクションリストを取得
 */
export function getAbstractActionsForTags(tags: string[]): string[] {
  const actions: string[] = []
  for (const tag of tags) {
    const tagActions = TAG_TO_ABSTRACT_ACTIONS[tag]
    if (tagActions) {
      for (const action of tagActions) {
        if (!actions.includes(action)) {
          actions.push(action)
        }
      }
    }
  }
  return actions
}

/**
 * 施設タグから具体的アクションIDを取得
 */
export function getActionIdFromFacilityTag(tag: string): ActionId | null {
  return FACILITY_TAG_TO_ACTION_ID[tag] ?? null
}

/**
 * 施設タグリストから最初にマッチする具体的アクションIDを取得
 */
export function getActionIdFromFacilityTags(tags: string[]): ActionId | null {
  for (const tag of tags) {
    const actionId = FACILITY_TAG_TO_ACTION_ID[tag]
    if (actionId) {
      return actionId
    }
  }
  return null
}
