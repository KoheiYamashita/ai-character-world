import type { Character } from './character'
import type { FacilityTag } from './map'

// アクションIDの型（循環依存を避けるため明示的に定義）
export type ActionId =
  | 'eat_home'
  | 'eat_restaurant'
  | 'sleep'
  | 'toilet'
  | 'bathe_home'
  | 'bathe_hotspring'
  | 'rest'
  | 'talk'
  | 'work'
  | 'thinking'

// キャラクターステータスの部分型（effects用）
// Character型から数値ステータスを抽出
export type CharacterStats = Pick<
  Character,
  'satiety' | 'energy' | 'hygiene' | 'mood' | 'bladder' | 'money'
>

// 可変時間アクションの時間範囲
export interface DurationRange {
  min: number      // 最小時間（分）
  max: number      // 最大時間（分）
  default: number  // デフォルト時間（分）
}

// 分あたりの効果（可変時間アクション用）
export interface EffectPerMinute {
  satiety?: number
  energy?: number
  hygiene?: number
  mood?: number
  bladder?: number
}

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
// Note: duration と effects.stats は world-config.json の actions セクションから読み込む
export interface ActionDefinition {
  type: string // アクションの基本タイプ
  duration?: number // 固定時間アクション用（ms）- 通常は world-config.json から取得
  requirements: ActionRequirements
  effects: ActionEffects // stats は world-config.json から取得するため空でも可
  emoji?: string // 頭上表示用絵文字
}

// アクション実行状態
export interface ActionState {
  actionId: ActionId // 実行中のアクションID
  startTime: number // 開始時刻(timestamp)
  targetEndTime: number // 終了予定時刻
  facilityId?: string // 使用中の施設ID
  targetNpcId?: string // talk アクション用：対象NPC ID
  durationMinutes?: number // 選択された時間（分）- 可変時間アクション用
}
