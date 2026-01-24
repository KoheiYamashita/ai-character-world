import type { DurationRange, EffectPerMinute } from './action'

export interface TimingConfig {
  idleTimeMin: number
  idleTimeMax: number
  fadeStep: number
  fadeIntervalMs: number
}

export interface StatusDecayConfig {
  satietyPerMinute: number
  energyPerMinute: number
  hygienePerMinute: number
  moodPerMinute: number
  bladderPerMinute: number
}

export interface TimeConfig {
  timezone: string
  statusDecayIntervalMs: number
  decayRates: StatusDecayConfig
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

export interface WorldGridConfig {
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

export interface ObstacleThemeConfig {
  building: ObstacleTheme
  zone: ObstacleTheme
}

export interface ThemeConfig {
  nodes: {
    entrance: NodeTheme
    spawn: NodeTheme
    waypoint: NodeTheme
    connectionLine: ConnectionLineTheme
  }
  obstacle: ObstacleTheme | ObstacleThemeConfig
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

export interface ErrorConfig {
  /** シミュレーションを一時停止するか（デフォルト: true） */
  pauseOnCriticalError?: boolean
  /** 停止までの連続失敗回数（デフォルト: 3） */
  maxConsecutiveFailures?: number
  /** Webhookタイムアウト（デフォルト: 10000ms） */
  webhookTimeoutMs?: number
}

// アクション設定（world-config.json actions セクション）
export interface ActionConfig {
  // 可変時間アクション用
  durationRange?: DurationRange
  perMinute?: EffectPerMinute
  // 固定時間アクション用
  fixed?: boolean
  duration?: number // 分単位
  effects?: {
    satiety?: number
    energy?: number
    hygiene?: number
    mood?: number
    bladder?: number
  }
  // talk アクション用: 各ターン間のインターバル（ms）
  turnIntervalMs?: number
}

export interface MiniEpisodeConfig {
  probability: number  // ミニエピソード生成確率（0-1）
}

export interface WorldConfig {
  timing: TimingConfig
  movement: MovementConfig
  character: CharacterRenderConfig
  sprite: SpriteAnimationConfig
  grid: WorldGridConfig
  canvas: CanvasConfig
  theme: ThemeConfig
  initialState: InitialStateConfig
  paths: PathsConfig
  time: TimeConfig
  error?: ErrorConfig
  actions?: Record<string, ActionConfig>
  miniEpisode?: MiniEpisodeConfig
}
