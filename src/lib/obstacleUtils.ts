/**
 * 障害物関連のユーティリティ関数
 */

import type { Obstacle, ObstacleType } from '@/types'

/**
 * 障害物をタイプでフィルタリング
 */
export function getObstaclesByType(obstacles: Obstacle[], type: ObstacleType): Obstacle[] {
  return obstacles.filter((obs) => obs.type === type)
}

/**
 * Zone タイプの障害物を取得
 */
export function getZones(obstacles: Obstacle[]): Obstacle[] {
  return getObstaclesByType(obstacles, 'zone')
}

/**
 * Building タイプの障害物を取得
 */
export function getBuildings(obstacles: Obstacle[]): Obstacle[] {
  return getObstaclesByType(obstacles, 'building')
}

/**
 * 施設情報を持つ障害物のみを取得
 */
export function getObstaclesWithFacility(obstacles: Obstacle[]): Obstacle[] {
  return obstacles.filter((obs) => obs.facility !== undefined)
}

/**
 * 障害物が施設タイプかどうかを判定
 */
export function hasFacility(obstacle: Obstacle): boolean {
  return obstacle.facility !== undefined
}
