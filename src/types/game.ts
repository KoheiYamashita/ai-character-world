export interface GameTime {
  hour: number
  minute: number
  day: number
}

export interface TransitionState {
  isTransitioning: boolean
  fromMapId: string | null
  toMapId: string | null
  progress: number
}

export interface GameState {
  currentMapId: string
  time: GameTime
  isPaused: boolean
  transition: TransitionState
}
