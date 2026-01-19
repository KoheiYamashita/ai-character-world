import type { Character } from './character'
import type { FacilityTag } from './map'

// キャラクターステータスの部分型（effects用）
// Character型から数値ステータスを抽出
export type CharacterStats = Pick<
  Character,
  'hunger' | 'energy' | 'hygiene' | 'mood' | 'bladder' | 'money'
>

// アクションの前提条件
export interface ActionRequirements {
  facilityTags?: FacilityTag[] // 必要な施設タグ（AND条件）
  ownership?: 'self' | 'any' // 所有権
  minStats?: Partial<CharacterStats> // 最低ステータス
  cost?: 'facility' | number // 施設料金 or 固定額
  nearNpc?: boolean // NPC近くにいる必要
  employment?: boolean // 雇用されている必要
}

// アクションの効果
export interface ActionEffects {
  stats?: Partial<CharacterStats>
  money?: number | 'hourlyWage'
  qualityBonus?: boolean
}

// アクション定義
export interface ActionDefinition {
  type: string // アクションの基本タイプ
  duration: number // 所要時間(ms)
  requirements: ActionRequirements
  effects: ActionEffects
  emoji?: string // 頭上表示用絵文字
}

// アクション実行状態
export interface ActionState {
  actionId: string // 実行中のアクションID
  startTime: number // 開始時刻(timestamp)
  targetEndTime: number // 終了予定時刻
  facilityId?: string // 使用中の施設ID
}
