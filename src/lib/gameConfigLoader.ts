import type { GameConfig, ObstacleTheme, ObstacleType } from '@/types'

let cachedConfig: GameConfig | null = null

export function parseColor(colorStr: string): number {
  if (colorStr.startsWith('0x')) {
    return parseInt(colorStr, 16)
  }
  return parseInt(colorStr.replace('#', ''), 16)
}

/**
 * Helper to check if obstacle theme is in new format (with building/zone keys)
 */
function isObstacleThemeConfig(theme: unknown): theme is { building: ObstacleTheme; zone: ObstacleTheme } {
  return typeof theme === 'object' && theme !== null && 'building' in theme && 'zone' in theme
}

/**
 * Get obstacle theme for a specific type.
 * Handles migration from old format (single ObstacleTheme) to new format (ObstacleThemeConfig).
 */
export function getObstacleTheme(config: GameConfig, type: ObstacleType): ObstacleTheme {
  const obstacleTheme = config.theme.obstacle
  if (isObstacleThemeConfig(obstacleTheme)) {
    return obstacleTheme[type]
  }
  // Old format: use the same theme for all types (building theme)
  return obstacleTheme
}

export async function loadGameConfig(): Promise<GameConfig> {
  if (cachedConfig) {
    return cachedConfig
  }

  const response = await fetch('/data/game-config.json')
  if (!response.ok) {
    throw new Error(`Failed to load game config: ${response.status} ${response.statusText}`)
  }
  cachedConfig = await response.json()
  return cachedConfig!
}

export function getConfig(): GameConfig {
  if (!cachedConfig) {
    throw new Error('Game config not loaded. Call loadGameConfig() first.')
  }
  return cachedConfig
}

export function isConfigLoaded(): boolean {
  return cachedConfig !== null
}

export function clearConfigCache(): void {
  cachedConfig = null
}
