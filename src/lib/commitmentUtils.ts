import type { WorldMap, Obstacle, PathNode } from '@/types'
import { findPathAvoidingNodes } from './pathfinding'

/**
 * Resolve location text from conversation to map and facility
 * @param locationText Location mentioned in conversation (e.g., "カフェ", "公園")
 * @param maps All available maps
 * @returns Resolved map and facility, or null if not found
 */
export function resolveLocationToFacility(
  locationText: string,
  maps: Record<string, WorldMap>
): { mapId: string; facility: Obstacle | null } | null {
  const normalizedText = locationText.toLowerCase().trim()

  // 1. Try to match map name
  for (const [mapId, map] of Object.entries(maps)) {
    const mapName = map.name.toLowerCase()
    if (mapName.includes(normalizedText) || normalizedText.includes(mapName)) {
      return { mapId, facility: null }
    }
  }

  // 2. Try to match facility label
  for (const [mapId, map] of Object.entries(maps)) {
    for (const obstacle of map.obstacles) {
      if (obstacle.label) {
        const label = obstacle.label.toLowerCase()
        if (label.includes(normalizedText) || normalizedText.includes(label)) {
          return { mapId, facility: obstacle }
        }
      }
    }
  }

  // 3. Try partial matches with common location keywords
  const locationKeywords: Record<string, string[]> = {
    cafe: ['カフェ', 'cafe', '喫茶', 'コーヒー'],
    park: ['公園', 'park', '広場'],
    home: ['家', 'home', '自宅', 'うち'],
    office: ['オフィス', 'office', '事務所', '会社'],
    convenience: ['コンビニ', 'convenience', 'コンビニエンス'],
    town: ['街', 'town', '町', '商店街'],
  }

  for (const [mapId, keywords] of Object.entries(locationKeywords)) {
    if (maps[mapId]) {
      for (const keyword of keywords) {
        if (normalizedText.includes(keyword.toLowerCase()) ||
            keyword.toLowerCase().includes(normalizedText)) {
          return { mapId, facility: null }
        }
      }
    }
  }

  return null
}

/**
 * Find an available node near a facility for NPC to stand
 * Conditions:
 * 1. Not occupied by NPC or character
 * 2. Blocking the node doesn't cut off paths to facility
 * 3. Prefer wall-adjacent nodes (fewer neighbors)
 *
 * @param map Target map
 * @param facility Target facility (null = use map center area)
 * @param blockedNodes Currently blocked nodes (NPCs + characters)
 * @param entranceNodeId Optional entrance node for path check
 * @returns Available node ID, or null if none found
 */
export function findAvailableNodeNearFacility(
  map: WorldMap,
  facility: Obstacle | null,
  blockedNodes: Set<string>,
  entranceNodeId?: string
): string | null {
  // 1. Get candidate nodes
  const candidates = facility
    ? getNodesAroundObstacle(map, facility)
    : getNodesNearCenter(map)

  if (candidates.length === 0) {
    return null
  }

  // 2. Filter out blocked nodes
  const available = candidates.filter(nodeId => !blockedNodes.has(nodeId))

  if (available.length === 0) {
    return null
  }

  // 3. Check path connectivity (optional - skip if no entrance specified)
  let safeNodes = available
  if (entranceNodeId) {
    safeNodes = available.filter(nodeId => {
      // Temporarily add this node to blocked
      const testBlocked = new Set(blockedNodes)
      testBlocked.add(nodeId)

      // Check if entrance can still reach some facility-adjacent node
      for (const facilityNode of candidates) {
        if (facilityNode === nodeId) continue
        if (testBlocked.has(facilityNode)) continue

        const path = findPathAvoidingNodes(map, entranceNodeId, facilityNode, testBlocked)
        if (path.length > 0) {
          return true // At least one path exists
        }
      }
      return false
    })

    // If path check filtered everything, fall back to available
    if (safeNodes.length === 0) {
      safeNodes = available
    }
  }

  // 4. Sort by neighbor count (prefer wall-adjacent = fewer neighbors)
  safeNodes.sort((a, b) => {
    const aCount = getNeighborCount(map, a)
    const bCount = getNeighborCount(map, b)
    return aCount - bCount
  })

  return safeNodes[0] ?? null
}

// Default grid constants (matching world-config.json defaults)
const DEFAULT_SPACING = 50

/**
 * Get nodes around an obstacle (facility)
 * Returns nodes that are adjacent to the obstacle boundary
 */
export function getNodesAroundObstacle(map: WorldMap, obstacle: Obstacle): string[] {
  const result: string[] = []

  // Calculate obstacle bounds in grid coordinates
  const spacing = DEFAULT_SPACING

  // Obstacle pixel bounds
  const obsLeft = obstacle.x
  const obsRight = obstacle.x + obstacle.width
  const obsTop = obstacle.y
  const obsBottom = obstacle.y + obstacle.height

  // Check each node
  for (const node of map.nodes) {
    // Skip non-traversable nodes
    if (node.type === 'entrance') continue

    // Check if node is just outside the obstacle
    const isNearLeft = Math.abs(node.x - obsLeft) < spacing * 1.5
    const isNearRight = Math.abs(node.x - obsRight) < spacing * 1.5
    const isNearTop = Math.abs(node.y - obsTop) < spacing * 1.5
    const isNearBottom = Math.abs(node.y - obsBottom) < spacing * 1.5

    const isInXRange = node.x >= obsLeft - spacing && node.x <= obsRight + spacing
    const isInYRange = node.y >= obsTop - spacing && node.y <= obsBottom + spacing

    // Node is adjacent if it's just outside in one dimension and within range in the other
    const isAdjacent = (
      ((isNearLeft || isNearRight) && isInYRange && (node.x < obsLeft || node.x > obsRight)) ||
      ((isNearTop || isNearBottom) && isInXRange && (node.y < obsTop || node.y > obsBottom))
    )

    if (isAdjacent) {
      result.push(node.id)
    }
  }

  // If no adjacent nodes found, expand search to nearby nodes
  if (result.length === 0) {
    const nearbyDistance = spacing * 3
    for (const node of map.nodes) {
      if (node.type === 'entrance') continue

      // Calculate distance to obstacle center
      const obsCenterX = obstacle.x + obstacle.width / 2
      const obsCenterY = obstacle.y + obstacle.height / 2
      const dx = node.x - obsCenterX
      const dy = node.y - obsCenterY
      const distance = Math.sqrt(dx * dx + dy * dy)

      if (distance < nearbyDistance) {
        result.push(node.id)
      }
    }
  }

  return result
}

/**
 * Get nodes near the center of the map
 * Used when no specific facility is targeted
 */
export function getNodesNearCenter(map: WorldMap): string[] {
  const spacing = DEFAULT_SPACING
  // Default grid: 12 cols x 9 rows
  const gridCols = 12
  const gridRows = 9

  // Calculate center position
  const centerX = spacing * (Math.floor(gridCols / 2) + 1)
  const centerY = spacing * (Math.floor(gridRows / 2) + 1)

  // Find nodes within 2 grid cells of center
  const searchRadius = spacing * 2.5
  const result: string[] = []

  for (const node of map.nodes) {
    if (node.type === 'entrance') continue

    const dx = node.x - centerX
    const dy = node.y - centerY
    const distance = Math.sqrt(dx * dx + dy * dy)

    if (distance < searchRadius) {
      result.push(node.id)
    }
  }

  // If center is blocked (e.g., by obstacle), expand search
  if (result.length === 0) {
    // Return spawn node area as fallback
    const spawnNode = map.nodes.find(n => n.id === map.spawnNodeId)
    if (spawnNode) {
      for (const node of map.nodes) {
        if (node.type === 'entrance') continue

        const dx = node.x - spawnNode.x
        const dy = node.y - spawnNode.y
        const distance = Math.sqrt(dx * dx + dy * dy)

        if (distance < spacing * 3) {
          result.push(node.id)
        }
      }
    }
  }

  return result
}

/**
 * Count the number of connected neighbors for a node
 * Fewer neighbors = more likely to be wall-adjacent
 */
export function getNeighborCount(map: WorldMap, nodeId: string): number {
  const node = map.nodes.find(n => n.id === nodeId)
  if (!node) return 0

  // A node in a grid can have up to 8 neighbors
  // Wall-adjacent nodes typically have 3-5 neighbors
  // Corner nodes have 3 neighbors
  return node.connectedTo?.length ?? 0
}
