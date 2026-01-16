import type { GameConfig } from '@/types'

let cachedConfig: GameConfig | null = null

export function parseColor(colorStr: string): number {
  if (colorStr.startsWith('0x')) {
    return parseInt(colorStr, 16)
  }
  return parseInt(colorStr.replace('#', ''), 16)
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
