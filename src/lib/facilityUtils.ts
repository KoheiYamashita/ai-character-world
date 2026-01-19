import type { PathNode, Obstacle, FacilityInfo, FacilityTag } from '@/types'
import { isNodeInsideZone } from '@/data/maps/grid'

/**
 * Parse a node ID to extract grid coordinates.
 * Returns null if the node ID doesn't match the expected format.
 */
function parseNodeIdToGridCoord(
  nodeId: string,
  gridPrefix: string
): { row: number; col: number } | null {
  const parts = nodeId.split('-')
  if (parts.length < 3 || parts[0] !== gridPrefix) return null

  const row = parseInt(parts[1], 10)
  const col = parseInt(parts[2], 10)

  if (isNaN(row) || isNaN(col)) return null
  return { row, col }
}

/**
 * Get facility info for a node if it's inside a zone with facility info.
 * Returns null if the node is not inside any zone with facility info.
 */
export function getFacilityForNode(
  node: PathNode,
  obstacles: Obstacle[],
  gridPrefix: string
): FacilityInfo | null {
  const coord = parseNodeIdToGridCoord(node.id, gridPrefix)
  if (!coord) return null

  return findZoneFacilityForNode(coord.row, coord.col, obstacles)
}

/**
 * Find facility info for a node at the given grid coordinates
 * if it's inside a zone with facility info.
 */
export function findZoneFacilityForNode(
  row: number,
  col: number,
  obstacles: Obstacle[]
): FacilityInfo | null {
  const zones = obstacles.filter((obs) => obs.type === 'zone')

  for (const zone of zones) {
    if (zone.facility && isNodeInsideZone(row, col, zone)) {
      return zone.facility
    }
  }

  return null
}

/**
 * Find facility info for a node if it's near a building with facility info.
 * Proximity is measured in grid cells (not pixels).
 * Building coordinates are origin-based (top-left corner).
 */
export function findBuildingFacilityNearNode(
  row: number,
  col: number,
  obstacles: Obstacle[],
  proximity: number = 1
): FacilityInfo | null {
  const buildings = obstacles.filter((obs) => obs.type === 'building')

  for (const building of buildings) {
    if (!building.facility) continue

    // Building tile coordinates are origin-based (top-left corner)
    // Building covers from (tileRow, tileCol) to (tileRow + tileHeight - 1, tileCol + tileWidth - 1)
    const minRow = building.tileRow - proximity
    const maxRow = building.tileRow + building.tileHeight - 1 + proximity
    const minCol = building.tileCol - proximity
    const maxCol = building.tileCol + building.tileWidth - 1 + proximity

    if (row >= minRow && row <= maxRow && col >= minCol && col <= maxCol) {
      return building.facility
    }
  }

  return null
}

/**
 * Check if a facility has a specific tag.
 */
export function hasFacilityTag(
  facility: FacilityInfo | null | undefined,
  tag: FacilityTag
): boolean {
  if (!facility) return false
  return facility.tags.includes(tag)
}

/**
 * Find all obstacles with a specific facility tag.
 */
export function findObstaclesWithFacilityTag(
  obstacles: Obstacle[],
  tag: FacilityTag
): Obstacle[] {
  return obstacles.filter(
    (obs) => obs.facility && obs.facility.tags.includes(tag)
  )
}

/**
 * Find all facilities in a map that match any of the given tags.
 */
export function findObstaclesWithAnyFacilityTag(
  obstacles: Obstacle[],
  tags: FacilityTag[]
): Obstacle[] {
  return obstacles.filter(
    (obs) => obs.facility && obs.facility.tags.some((t) => tags.includes(t))
  )
}

/**
 * Get all facility info from obstacles in a map.
 */
export function getAllFacilities(
  obstacles: Obstacle[]
): { obstacle: Obstacle; facility: FacilityInfo }[] {
  return obstacles
    .filter((obs) => obs.facility)
    .map((obs) => ({ obstacle: obs, facility: obs.facility! }))
}
