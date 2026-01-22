export interface WorldTime {
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
