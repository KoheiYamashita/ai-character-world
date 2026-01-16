import type { Character, SpriteConfig } from '@/types'

// Default sprite config (must match public/data/characters.json)
const defaultSpriteConfig: SpriteConfig = {
  sheetUrl: '/assets/sprites/kanon.png',
  frameWidth: 96,
  frameHeight: 96,
  cols: 3,
  rows: 4,
  rowMapping: {
    down: 0,
    left: 1,
    right: 2,
    up: 3,
  },
}

// Default character for initial store state (sync fallback for async JSON loading)
// Keep in sync with public/data/characters.json
export const defaultCharacter: Character = {
  id: 'kanon',
  name: '花音・クレア・トンプソン',
  sprite: defaultSpriteConfig,
  money: 100,
  hunger: 100,
  currentMapId: 'town',
  currentNodeId: 'town-4-5',
  position: { x: 369, y: 300 },
  direction: 'down',
}
