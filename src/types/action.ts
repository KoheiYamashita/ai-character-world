import type { Character } from './character'

// アクションIDの型（循環依存を避けるため明示的に定義）
export type ActionId =
  // 既存
  | 'eat'
  | 'sleep'
  | 'toilet'
  | 'bathe'
  | 'rest'
  | 'talk'
  | 'work'
  | 'thinking'
  | 'exercise'
  | 'read'
  | 'game'
  | 'drink_alcohol'
  | 'watch'
  | 'shopping'
  // 自己改善・学習系
  | 'study'
  | 'meditate'
  | 'nap'
  // 趣味・創作系
  | 'draw'
  | 'play_music'
  | 'cook'
  | 'garden'
  // 運動・アウトドア系
  | 'jog'
  | 'swim'
  | 'walk'
  | 'fish'
  // 娯楽施設系
  | 'karaoke'
  | 'cinema'
  | 'arcade'
  | 'bowling'
  // 軽い消費・休憩系
  | 'coffee'
  | 'snack'
  // サービス利用系
  | 'massage'
  | 'haircut'
  // 家事系
  | 'clean'
  // チャット連携系
  | 'reply_chat'
  | 'check_chat'
  | 'send_chat'

// キャラクターステータスの部分型（effects用）
// Character型から数値ステータスを抽出
export type CharacterStats = Pick<
  Character,
  'satiety' | 'energy' | 'hygiene' | 'mood' | 'bladder' | 'money' | 'fitness'
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
  fitness?: number
  money?: number
}

// アクションの前提条件
export interface ActionRequirements {
  minStats?: Partial<CharacterStats> // 最低ステータス
  nearNpc?: boolean // NPC近くにいる必要
  employment?: boolean // 雇用されている必要
  hasPendingChat?: boolean // 未読チャット通知がある（reply_chat用）
  chatEnabled?: boolean // チャット機能が有効である必要
}

// アクションの効果
export interface ActionEffects {
  stats?: Partial<CharacterStats>
  money?: number | 'hourlyWage'
}

// アクション定義
// Note: duration と effects.stats は world-config.json の actions セクションから読み込む
// Note: 絵文字は src/lib/uiLabels.ts の ACTION_INFO から取得
export interface ActionDefinition {
  requirements: ActionRequirements
  effects: ActionEffects // stats は world-config.json から取得するため空でも可
}

// アクション実行状態
export interface ActionState {
  actionId: ActionId // 実行中のアクションID
  startTime: number // 開始時刻(timestamp)
  targetEndTime: number // 終了予定時刻
  facilityId?: string // 使用中の施設ID
  targetNpcId?: string // talk アクション用：対象NPC ID
  durationMinutes?: number // 選択された時間（分）- 可変時間アクション用
  reason?: string // 行動理由（LLMが出力したもの）
  triggeredByInterrupt?: boolean // ステータス割り込みで強制発動されたか
}
