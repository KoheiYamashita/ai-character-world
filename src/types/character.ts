import type { Employment } from './job'
import type { ScheduleEntry } from './schedule'

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
    satiety: number
    energy: number
    hygiene: number
    mood: number
    bladder: number
  }
  employment?: Employment
  defaultSchedule?: ScheduleEntry[]
  // LLM行動決定用のプロファイル情報
  personality?: string        // 性格
  tendencies?: string[]       // 行動傾向
  customPrompt?: string       // 自由入力欄
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
  satiety: number
  energy: number
  hygiene: number
  mood: number
  bladder: number
  currentMapId: string
  currentNodeId: string
  position: Position
  direction: Direction
  employment?: Employment
  // LLM行動決定用のプロファイル情報
  personality?: string
  tendencies?: string[]
  customPrompt?: string
}
