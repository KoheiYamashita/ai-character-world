import type { ActionDefinition } from '@/types/action'

// アクション定義一覧
export const ACTIONS: Record<string, ActionDefinition> = {
  // 食事系
  eat_home: {
    type: 'eat',
    duration: 30 * 60 * 1000, // 30分
    requirements: {
      facilityTags: ['kitchen'],
      ownership: 'self',
    },
    effects: {
      stats: {
        hunger: 50,
        mood: 10,
      },
    },
    emoji: '🍳',
  },

  eat_restaurant: {
    type: 'eat',
    duration: 45 * 60 * 1000, // 45分
    requirements: {
      facilityTags: ['restaurant'],
      ownership: 'any',
      cost: 'facility',
    },
    effects: {
      stats: {
        hunger: 70,
        mood: 20,
      },
      qualityBonus: true,
    },
    emoji: '🍽️',
  },

  // 睡眠
  sleep: {
    type: 'sleep',
    duration: 8 * 60 * 60 * 1000, // 8時間
    requirements: {
      facilityTags: ['bedroom'],
      ownership: 'self',
    },
    effects: {
      stats: {
        energy: 100,
        mood: 20,
      },
    },
    emoji: '💤',
  },

  // トイレ
  toilet: {
    type: 'toilet',
    duration: 5 * 60 * 1000, // 5分
    requirements: {
      facilityTags: ['toilet'],
      ownership: 'any',
    },
    effects: {
      stats: {
        bladder: 100,
      },
    },
    emoji: '🚽',
  },

  // 入浴系
  bathe_home: {
    type: 'bathe',
    duration: 30 * 60 * 1000, // 30分
    requirements: {
      facilityTags: ['bathroom'],
      ownership: 'self',
    },
    effects: {
      stats: {
        hygiene: 100,
        mood: 15,
      },
    },
    emoji: '🛁',
  },

  bathe_hotspring: {
    type: 'bathe',
    duration: 60 * 60 * 1000, // 1時間
    requirements: {
      facilityTags: ['hotspring'],
      ownership: 'any',
      cost: 'facility',
    },
    effects: {
      stats: {
        hygiene: 100,
        mood: 30,
        energy: 20,
      },
      qualityBonus: true,
    },
    emoji: '♨️',
  },

  // 休憩
  rest: {
    type: 'rest',
    duration: 30 * 60 * 1000, // 30分
    requirements: {
      facilityTags: ['public'],
      ownership: 'any',
    },
    effects: {
      stats: {
        energy: 15,
        mood: 5,
      },
    },
    emoji: '☕',
  },

  // 会話
  talk: {
    type: 'talk',
    duration: 15 * 60 * 1000, // 15分
    requirements: {
      nearNpc: true,
    },
    effects: {
      stats: {
        mood: 20,
      },
    },
    emoji: '💬',
  },

  // 仕事
  work: {
    type: 'work',
    duration: 60 * 60 * 1000, // 1時間単位
    requirements: {
      facilityTags: ['workspace'],
      employment: true,
    },
    effects: {
      stats: {
        energy: -20,
        mood: -5,
      },
      money: 'hourlyWage',
    },
    emoji: '💼',
  },
}

// アクションIDの型
export type ActionId = keyof typeof ACTIONS
