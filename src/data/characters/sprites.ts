import type { SpriteConfig } from '@/types'

export const defaultSprite: SpriteConfig = {
  sheetUrl: '/assets/sprites/character.png',
  frameWidth: 32,
  frameHeight: 32,
  animations: {
    walkDown: [0, 1, 2, 1],
    walkUp: [3, 4, 5, 4],
    walkLeft: [6, 7, 8, 7],
    walkRight: [9, 10, 11, 10],
    idle: [1],
  },
}

export const alexSprite: SpriteConfig = {
  sheetUrl: '/assets/sprites/alex.png',
  frameWidth: 32,
  frameHeight: 32,
  animations: {
    walkDown: [0, 1, 2, 1],
    walkUp: [3, 4, 5, 4],
    walkLeft: [6, 7, 8, 7],
    walkRight: [9, 10, 11, 10],
    idle: [1],
  },
}
