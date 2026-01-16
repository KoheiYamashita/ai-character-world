export type Direction = 'up' | 'down' | 'left' | 'right'

export interface SpriteConfig {
  sheetUrl: string
  frameWidth: number
  frameHeight: number
  animations: {
    walkDown: number[]
    walkUp: number[]
    walkLeft: number[]
    walkRight: number[]
    idle: number[]
  }
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
  currentMapId: string
  currentNodeId: string
  position: Position
  direction: Direction
}

export interface NavigationState {
  isMoving: boolean
  path: string[]
  currentPathIndex: number
  progress: number
  targetPosition: Position | null
}
