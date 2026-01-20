import type { ActionDefinition } from '@/types/action'

/**
 * アクション定義一覧
 *
 * 注意: duration と effects.stats は world-config.json の actions セクションから読み込む。
 * ここでは requirements と emoji のみを定義する。
 * ActionExecutor が world-config.json から時間と効果を取得し、適用する。
 */
export const ACTIONS: Record<string, ActionDefinition> = {
  // 食事系
  eat_home: {
    type: 'eat',
    requirements: {
      facilityTags: ['kitchen'],
      ownership: 'self',
    },
    effects: {},
    emoji: '🍳',
  },

  eat_restaurant: {
    type: 'eat',
    requirements: {
      facilityTags: ['restaurant'],
      ownership: 'any',
      cost: 'facility',
    },
    effects: {
      qualityBonus: true,
    },
    emoji: '🍽️',
  },

  // 睡眠
  sleep: {
    type: 'sleep',
    requirements: {
      facilityTags: ['bedroom'],
      ownership: 'self',
    },
    effects: {},
    emoji: '💤',
  },

  // トイレ
  toilet: {
    type: 'toilet',
    requirements: {
      facilityTags: ['toilet'],
      ownership: 'any',
    },
    effects: {},
    emoji: '🚽',
  },

  // 入浴系
  bathe_home: {
    type: 'bathe',
    requirements: {
      facilityTags: ['bathroom'],
      ownership: 'self',
    },
    effects: {},
    emoji: '🛁',
  },

  bathe_hotspring: {
    type: 'bathe',
    requirements: {
      facilityTags: ['hotspring'],
      ownership: 'any',
      cost: 'facility',
    },
    effects: {
      qualityBonus: true,
    },
    emoji: '♨️',
  },

  // 休憩
  rest: {
    type: 'rest',
    requirements: {
      facilityTags: ['public'],
      ownership: 'any',
    },
    effects: {},
    emoji: '☕',
  },

  // 会話（固定時間アクション - world-config.json で fixed: true）
  talk: {
    type: 'talk',
    requirements: {
      nearNpc: true,
    },
    effects: {},
    emoji: '💬',
  },

  // 仕事
  work: {
    type: 'work',
    requirements: {
      facilityTags: ['workspace'],
      employment: true,
    },
    effects: {
      money: 'hourlyWage',
    },
    emoji: '💼',
  },

  // 思考中（LLM行動決定用）
  // fixed: true, duration: 0 なので手動で completeAction() を呼ぶ必要がある
  thinking: {
    type: 'thinking',
    requirements: {},
    effects: {},
    emoji: '🤔',
  },
}

// アクションIDの型
export type ActionId = keyof typeof ACTIONS
