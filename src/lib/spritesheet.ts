import { Assets, Texture, Spritesheet } from 'pixi.js'
import type { SpriteConfig, Direction } from '@/types'
import { isConfigLoaded, getConfig } from './worldConfigLoader'

// Default fallbacks (matches world-config.json)
const DEFAULT_ANIMATION_SEQUENCE = [0, 1, 2, 1]
const DEFAULT_IDLE_FRAME = 1

function getAnimationSequence(): number[] {
  if (isConfigLoaded()) {
    return getConfig().sprite.animationSequence
  }
  return DEFAULT_ANIMATION_SEQUENCE
}

function getIdleFrame(): number {
  if (isConfigLoaded()) {
    return getConfig().sprite.idleFrame
  }
  return DEFAULT_IDLE_FRAME
}

export interface CharacterSpritesheet {
  spritesheet: Spritesheet
  animations: {
    down: Texture[]
    left: Texture[]
    right: Texture[]
    up: Texture[]
  }
}

export async function loadCharacterSpritesheet(
  config: SpriteConfig
): Promise<CharacterSpritesheet> {
  const texture = await Assets.load(config.sheetUrl)

  const frames: Record<string, { frame: { x: number; y: number; w: number; h: number } }> = {}

  for (let row = 0; row < config.rows; row++) {
    for (let col = 0; col < config.cols; col++) {
      const frameIndex = row * config.cols + col
      frames[`frame_${frameIndex}`] = {
        frame: {
          x: col * config.frameWidth,
          y: row * config.frameHeight,
          w: config.frameWidth,
          h: config.frameHeight,
        },
      }
    }
  }

  const atlasData = {
    frames,
    meta: {
      scale: 1,
    },
  }

  const spritesheet = new Spritesheet(texture, atlasData)
  await spritesheet.parse()

  const animations = {
    down: getAnimationTextures(spritesheet, config.rowMapping.down, config.cols),
    left: getAnimationTextures(spritesheet, config.rowMapping.left, config.cols),
    right: getAnimationTextures(spritesheet, config.rowMapping.right, config.cols),
    up: getAnimationTextures(spritesheet, config.rowMapping.up, config.cols),
  }

  return { spritesheet, animations }
}

function getAnimationTextures(
  spritesheet: Spritesheet,
  row: number,
  colsPerRow: number
): Texture[] {
  return getAnimationSequence().map((col) => {
    const frameIndex = row * colsPerRow + col
    return spritesheet.textures[`frame_${frameIndex}`]
  })
}

export function getDirectionAnimation(
  charSpritesheet: CharacterSpritesheet,
  direction: Direction
): Texture[] {
  return charSpritesheet.animations[direction]
}

export function getIdleTexture(
  charSpritesheet: CharacterSpritesheet,
  direction: Direction
): Texture {
  const animation = charSpritesheet.animations[direction]
  return animation[getIdleFrame()]
}
