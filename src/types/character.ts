export type Direction = 'up' | 'down' | 'left' | 'right'

export interface SpriteConfig {
  sheetUrl: string
  frameWidth: number
  frameHeight: number
  cols: number
  rows: number
  rowMapping: {
    down: number
    left: number
    right: number
    up: number
  }
}

export interface CharacterConfig {
  id: string
  name: string
  sprite: SpriteConfig
  defaultStats: {
    money: number
    hunger: number
    energy: number
    hygiene: number
    mood: number
    bladder: number
  }
}

export interface CharactersData {
  characters: CharacterConfig[]
}

export interface Position {
  x: number
  y: number
}

export interface Character {
  id: string
  name: string
  sprite: SpriteConfig
  money: number
  hunger: number
  energy: number
  hygiene: number
  mood: number
  bladder: number
  currentMapId: string
  currentNodeId: string
  position: Position
  direction: Direction
}
