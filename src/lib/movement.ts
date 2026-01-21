import type { Position, Direction } from '@/types'
import { isConfigLoaded, getConfig } from './worldConfigLoader'

export function lerp(start: number, end: number, t: number): number {
  return start + (end - start) * t
}

export function lerpPosition(start: Position, end: Position, t: number): Position {
  return {
    x: lerp(start.x, end.x, t),
    y: lerp(start.y, end.y, t),
  }
}

export function getDirection(from: Position, to: Position): Direction {
  const dx = to.x - from.x
  const dy = to.y - from.y

  if (Math.abs(dx) > Math.abs(dy)) {
    return dx > 0 ? 'right' : 'left'
  } else {
    return dy > 0 ? 'down' : 'up'
  }
}

export function getDistance(from: Position, to: Position): number {
  const dx = to.x - from.x
  const dy = to.y - from.y
  return Math.sqrt(dx * dx + dy * dy)
}

// Default fallback speed (matches world-config.json)
const DEFAULT_MOVEMENT_SPEED = 150

export function getMovementSpeed(): number {
  if (isConfigLoaded()) {
    return getConfig().movement.speed
  }
  return DEFAULT_MOVEMENT_SPEED
}
