export interface TimingConfig {
  idleTimeMin: number
  idleTimeMax: number
  fadeStep: number
  fadeIntervalMs: number
}

export interface MovementConfig {
  speed: number
  entranceProbability: number
}

export interface CharacterRenderConfig {
  scale: number
  animationSpeed: number
}

export interface SpriteAnimationConfig {
  animationSequence: number[]
  idleFrame: number
}

export interface GridConfig {
  defaultCols: number
  defaultRows: number
  defaultWidth: number
  defaultHeight: number
}

export interface CanvasConfig {
  defaultWidth: number
  defaultHeight: number
  backgroundColor: string
}

export interface NodeTheme {
  fill: string
  stroke?: string
  strokeWidth?: number
  radius: number
  alpha?: number
}

export interface ConnectionLineTheme {
  color: string
  width: number
  alpha: number
}

export interface ObstacleTheme {
  fill: string
  alpha: number
  stroke: string
  strokeWidth: number
  labelColor?: string
}

export interface ThemeConfig {
  nodes: {
    entrance: NodeTheme
    spawn: NodeTheme
    waypoint: NodeTheme
    connectionLine: ConnectionLineTheme
  }
  obstacle: ObstacleTheme
  characterFallback: {
    fill: string
    stroke: string
    strokeWidth: number
    radius: number
  }
  transition: {
    overlayColor: string
  }
}

export interface InitialStateConfig {
  mapId: string
  time: {
    hour: number
    minute: number
    day: number
  }
}

export interface PathsConfig {
  mapsJson: string
  charactersJson: string
}

export interface GameConfig {
  timing: TimingConfig
  movement: MovementConfig
  character: CharacterRenderConfig
  sprite: SpriteAnimationConfig
  grid: GridConfig
  canvas: CanvasConfig
  theme: ThemeConfig
  initialState: InitialStateConfig
  paths: PathsConfig
}
