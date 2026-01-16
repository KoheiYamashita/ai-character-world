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

// Initial defaults for store (will be updated when config/maps load)
const INITIAL_MAP_ID = 'town'
const INITIAL_NODE_ID = 'town-4-5'
const INITIAL_POSITION = { x: 369, y: 300 }

// Default character for initial store state (sync fallback for async JSON loading)
// Keep in sync with public/data/characters.json
export const defaultCharacter: Character = {
  id: 'kanon',
  name: '花音・クレア・トンプソン',
  sprite: defaultSpriteConfig,
  money: 100,
  hunger: 100,
  currentMapId: INITIAL_MAP_ID,
  currentNodeId: INITIAL_NODE_ID,
  position: INITIAL_POSITION,
  direction: 'down',
}
