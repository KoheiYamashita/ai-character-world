import type { ActionDefinition, ActionId } from '@/types/action'

/**
 * アクション定義一覧
 *
 * 注意: duration と effects.stats は world-config.json の actions セクションから読み込む。
 * ここでは requirements と emoji のみを定義する。
 * ActionExecutor が world-config.json から時間と効果を取得し、適用する。
 */
export const ACTIONS: Record<ActionId, ActionDefinition> = {
  eat: {
    requirements: { facilityTags: ['kitchen', 'restaurant'] },
    effects: {},
    emoji: '🍽️',
  },

  sleep: {
    requirements: { facilityTags: ['bedroom'] },
    effects: {},
    emoji: '💤',
  },

  toilet: {
    requirements: { facilityTags: ['toilet'] },
    effects: {},
    emoji: '🚽',
  },

  bathe: {
    requirements: { facilityTags: ['bathroom', 'hotspring'] },
    effects: {},
    emoji: '🛁',
  },

  rest: {
    requirements: { facilityTags: ['public'] },
    effects: {},
    emoji: '☕',
  },

  // 固定時間アクション - world-config.json で fixed: true
  talk: {
    requirements: { nearNpc: true },
    effects: {},
    emoji: '💬',
  },

  work: {
    requirements: { facilityTags: ['workspace'], employment: true },
    effects: { money: 'hourlyWage' },
    emoji: '💼',
  },

  // fixed: true, duration: 0 なので手動で completeAction() を呼ぶ必要がある
  thinking: {
    requirements: {},
    effects: {},
    emoji: '🤔',
  },
}

// ActionId は @/types/action からエクスポート（循環依存回避のため）
export type { ActionId } from '@/types/action'
