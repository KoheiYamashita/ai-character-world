import type { ActionDefinition, ActionId } from '@/types/action'

/**
 * アクション定義一覧
 *
 * 注意:
 * - duration と effects.stats は world-config.json の actions セクションから読み込む
 * - 絵文字は src/lib/uiLabels.ts の ACTION_INFO から取得
 * - 施設要件は施設側の actionIds で管理（FacilityInfo.actionIds）
 *
 * ここでは以下のみを定義:
 * - nearNpc: NPC近くにいる必要
 * - employment: 雇用されている必要
 * - effects.money: お金効果
 */
export const ACTIONS: Record<ActionId, ActionDefinition> = {
  eat: {
    requirements: {},
    effects: {},
  },

  sleep: {
    requirements: {},
    effects: {},
  },

  toilet: {
    requirements: {},
    effects: {},
  },

  bathe: {
    requirements: {},
    effects: {},
  },

  rest: {
    requirements: {},
    effects: {},
  },

  // 固定時間アクション - world-config.json で fixed: true
  talk: {
    requirements: { nearNpc: true },
    effects: {},
  },

  work: {
    requirements: { employment: true },
    effects: { money: 'hourlyWage' },
  },

  // fixed: true, duration: 0 なので手動で completeAction() を呼ぶ必要がある
  thinking: {
    requirements: {},
    effects: {},
  },

  // 娯楽・運動アクション
  exercise: {
    requirements: {},
    effects: {},
  },

  read: {
    requirements: {},
    effects: {},
  },

  game: {
    requirements: {},
    effects: {},
  },

  drink_alcohol: {
    requirements: {},
    effects: {},
  },

  watch: {
    requirements: {},
    effects: {},
  },

  shopping: {
    requirements: {},
    effects: {},
  },

  // 自己改善・学習系
  study: {
    requirements: {},
    effects: {},
  },

  meditate: {
    requirements: {},
    effects: {},
  },

  nap: {
    requirements: {},
    effects: {},
  },

  // 趣味・創作系
  draw: {
    requirements: {},
    effects: {},
  },

  play_music: {
    requirements: {},
    effects: {},
  },

  cook: {
    requirements: {},
    effects: {},
  },

  garden: {
    requirements: {},
    effects: {},
  },

  // 運動・アウトドア系
  jog: {
    requirements: {},
    effects: {},
  },

  swim: {
    requirements: {},
    effects: {},
  },

  walk: {
    requirements: {},
    effects: {},
  },

  fish: {
    requirements: {},
    effects: {},
  },

  // 娯楽施設系
  karaoke: {
    requirements: {},
    effects: {},
  },

  cinema: {
    requirements: {},
    effects: {},
  },

  arcade: {
    requirements: {},
    effects: {},
  },

  bowling: {
    requirements: {},
    effects: {},
  },

  // 軽い消費・休憩系
  coffee: {
    requirements: {},
    effects: {},
  },

  snack: {
    requirements: {},
    effects: {},
  },

  // サービス利用系
  massage: {
    requirements: {},
    effects: {},
  },

  haircut: {
    requirements: {},
    effects: {},
  },

  // 家事系
  clean: {
    requirements: {},
    effects: {},
  },
}

// ActionId は @/types/action からエクスポート（循環依存回避のため）
export type { ActionId } from '@/types/action'
