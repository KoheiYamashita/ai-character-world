/**
 * マップバリデーション
 * scripts/validate-maps.mjs からのTypeScript移植
 */

import type {
  MapConfigJson,
  ObstacleConfigJson,
  MapValidationResult,
  ValidationResult,
} from '@/types'

// Minimum sizes for obstacle types
const MIN_BUILDING_SIZE = 2
const MIN_ZONE_SIZE = 4

// Valid wall sides
const VALID_WALL_SIDES = ['top', 'bottom', 'left', 'right'] as const

interface PixelObstacle {
  label?: string
  row: number
  col: number
  x: number
  y: number
  width: number
  height: number
}

function tileToPixelObstacle(
  obs: ObstacleConfigJson,
  cols: number,
  rows: number,
  width: number,
  height: number
): PixelObstacle {
  const spacingX = width / (cols + 1)
  const spacingY = height / (rows + 1)
  const x = spacingX * (obs.col + 1)
  const y = spacingY * (obs.row + 1)
  const pixelWidth = spacingX * obs.tileWidth
  const pixelHeight = spacingY * obs.tileHeight
  return {
    label: obs.label,
    row: obs.row,
    col: obs.col,
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(pixelWidth),
    height: Math.round(pixelHeight),
  }
}

function isPointInsideObstacle(x: number, y: number, obs: PixelObstacle): boolean {
  return x >= obs.x && x < obs.x + obs.width && y >= obs.y && y < obs.y + obs.height
}

function getNodePosition(
  nodeId: string,
  prefix: string,
  cols: number,
  rows: number,
  width: number,
  height: number
): { x: number; y: number; row: number; col: number } | null {
  const parts = nodeId.split('-')
  if (parts.length < 3 || parts[0] !== prefix) return null
  const row = parseInt(parts[1], 10)
  const col = parseInt(parts[2], 10)
  if (isNaN(row) || isNaN(col)) return null
  const spacingX = width / (cols + 1)
  const spacingY = height / (rows + 1)
  return {
    x: Math.round(spacingX * (col + 1)),
    y: Math.round(spacingY * (row + 1)),
    row,
    col,
  }
}

/**
 * Check if two zones have overlapping interiors (not just touching edges).
 */
function zonesIntersect(zoneA: ObstacleConfigJson, zoneB: ObstacleConfigJson): boolean {
  const aLeft = zoneA.col
  const aRight = zoneA.col + zoneA.tileWidth
  const aTop = zoneA.row
  const aBottom = zoneA.row + zoneA.tileHeight

  const bLeft = zoneB.col
  const bRight = zoneB.col + zoneB.tileWidth
  const bTop = zoneB.row
  const bBottom = zoneB.row + zoneB.tileHeight

  return aLeft < bRight && aRight > bLeft && aTop < bBottom && aBottom > bTop
}

function generateValidNodeIds(
  prefix: string,
  cols: number,
  rows: number,
  obstacles: PixelObstacle[],
  width: number,
  height: number,
  rawObstacles: ObstacleConfigJson[]
): Set<string> {
  const validIds = new Set<string>()
  const spacingX = width / (cols + 1)
  const spacingY = height / (rows + 1)

  // Only building-type obstacles exclude nodes
  const buildingObstacles = obstacles.filter((obs) => {
    const rawObs = rawObstacles.find(
      (o) => o.label === obs.label && o.row === obs.row && o.col === obs.col
    )
    return !rawObs?.type || rawObs.type === 'building'
  })

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = Math.round(spacingX * (col + 1))
      const y = Math.round(spacingY * (row + 1))
      const insideBuilding = buildingObstacles.some((obs) => isPointInsideObstacle(x, y, obs))
      if (!insideBuilding) {
        validIds.add(`${prefix}-${row}-${col}`)
      }
    }
  }
  return validIds
}

/**
 * 単一マップのバリデーション
 */
export function validateMap(map: MapConfigJson): MapValidationResult {
  const cols = map.grid.cols ?? 12
  const rows = map.grid.rows ?? 9
  const prefix = map.grid.prefix
  const errors: string[] = []
  const warnings: string[] = []

  // Convert obstacles to pixel coordinates
  const obstacles = (map.obstacles ?? []).map((obs) =>
    tileToPixelObstacle(obs, cols, rows, map.width, map.height)
  )

  // Generate valid node IDs (excluding those inside building obstacles)
  const validNodeIds = generateValidNodeIds(
    prefix,
    cols,
    rows,
    obstacles,
    map.width,
    map.height,
    map.obstacles ?? []
  )

  // Add entrance IDs to valid nodes
  for (const entrance of map.entrances ?? []) {
    validNodeIds.add(entrance.id)
  }

  // 1. Check minimum obstacle size and type validity
  for (const obs of map.obstacles ?? []) {
    const type = obs.type ?? 'building'

    // Validate type
    if (type !== 'building' && type !== 'zone') {
      errors.push(`障害物 "${obs.label}" のタイプが無効です: "${type}" (有効: building, zone)`)
      continue
    }

    // Validate minimum size based on type
    const minSize = type === 'zone' ? MIN_ZONE_SIZE : MIN_BUILDING_SIZE
    if (obs.tileWidth < minSize || obs.tileHeight < minSize) {
      errors.push(
        `障害物 "${obs.label}" (${type}) のサイズが最小値未満です (${obs.tileWidth}x${obs.tileHeight}, 最小: ${minSize}x${minSize})`
      )
    }

    // Zone-specific validations
    if (type === 'zone') {
      // Validate wallSides
      if (obs.wallSides) {
        if (!Array.isArray(obs.wallSides)) {
          errors.push(`Zone "${obs.label}" の wallSides は配列である必要があります`)
        } else {
          for (const side of obs.wallSides) {
            if (!VALID_WALL_SIDES.includes(side as (typeof VALID_WALL_SIDES)[number])) {
              errors.push(
                `Zone "${obs.label}" の wallSides に無効な値があります: "${side}" (有効: ${VALID_WALL_SIDES.join(', ')})`
              )
            }
          }
        }
      }

      // Validate door
      if (obs.door) {
        if (typeof obs.door !== 'object') {
          errors.push(`Zone "${obs.label}" の door はオブジェクトである必要があります`)
        } else {
          const { side, start, end } = obs.door

          // Check side validity
          if (!VALID_WALL_SIDES.includes(side as (typeof VALID_WALL_SIDES)[number])) {
            errors.push(
              `Zone "${obs.label}" の door.side が無効です: "${side}" (有効: ${VALID_WALL_SIDES.join(', ')})`
            )
          }

          // Check if door side is in wallSides
          if (obs.wallSides && !obs.wallSides.includes(side)) {
            errors.push(
              `Zone "${obs.label}" の door.side "${side}" が wallSides に含まれていません`
            )
          }

          // Check start/end validity
          if (typeof start !== 'number' || typeof end !== 'number') {
            errors.push(`Zone "${obs.label}" の door.start/end は数値である必要があります`)
          } else {
            if (start < 0) {
              errors.push(`Zone "${obs.label}" の door.start は0以上である必要があります`)
            }
            if (end < start) {
              errors.push(`Zone "${obs.label}" の door.end は door.start 以上である必要があります`)
            }

            // Door spec: start and end are wall termination positions.
            if (end - start < 2) {
              errors.push(
                `Zone "${obs.label}" の door は end - start >= 2 が必要です（現在: ${end - start}）。開口部が最低1つ必要です`
              )
            }

            // Check if door is within wall bounds
            const wallLength = side === 'top' || side === 'bottom' ? obs.tileWidth : obs.tileHeight
            if (end >= wallLength) {
              errors.push(
                `Zone "${obs.label}" の door.end (${end}) が壁の長さ (${wallLength}) を超えています`
              )
            }
          }
        }
      }
    }
  }

  // 2. Check zone intersections
  const allZones = (map.obstacles ?? []).filter((obs) => obs.type === 'zone')
  for (let i = 0; i < allZones.length; i++) {
    for (let j = i + 1; j < allZones.length; j++) {
      const zoneA = allZones[i]
      const zoneB = allZones[j]
      if (zonesIntersect(zoneA, zoneB)) {
        errors.push(`ゾーン "${zoneA.label}" と "${zoneB.label}" が交差しています`)
      }
    }
  }

  // 3. Check label-obstacle conflicts (only for building-type obstacles)
  const buildingObstacles = obstacles.filter((obs) => {
    const rawObs = (map.obstacles ?? []).find(
      (o) => o.label === obs.label && o.row === obs.row && o.col === obs.col
    )
    return !rawObs?.type || rawObs.type === 'building'
  })

  for (const label of map.labels ?? []) {
    const pos = getNodePosition(label.nodeId, prefix, cols, rows, map.width, map.height)
    if (!pos) continue

    for (const obs of buildingObstacles) {
      if (isPointInsideObstacle(pos.x, pos.y, obs)) {
        errors.push(
          `ラベル "${label.label}" (${label.nodeId}) が障害物 "${obs.label}" (row:${obs.row}, col:${obs.col}) 内にあります`
        )
      }
    }
  }

  // 4. Check if spawnNodeId exists
  if (!validNodeIds.has(map.spawnNodeId)) {
    errors.push(`spawnNodeId "${map.spawnNodeId}" が存在しないか障害物内にあります`)
  }

  // 5. Check entrance connectedNodeIds
  for (const entrance of map.entrances ?? []) {
    for (const connectedId of entrance.connectedNodeIds) {
      if (!validNodeIds.has(connectedId)) {
        errors.push(
          `入口 "${entrance.id}" の接続先 "${connectedId}" が存在しないか障害物内にあります`
        )
      }
    }
  }

  // 6. Check if labels reference valid nodes
  for (const label of map.labels ?? []) {
    if (!validNodeIds.has(label.nodeId)) {
      errors.push(
        `ラベル "${label.label}" のノード "${label.nodeId}" が存在しないか障害物内にあります`
      )
    }
  }

  // 7. Check NPC spawnNodeId
  for (const npc of map.npcs ?? []) {
    if (!validNodeIds.has(npc.spawnNodeId)) {
      errors.push(
        `NPC "${npc.name}" (${npc.id}) の spawnNodeId "${npc.spawnNodeId}" が存在しないか障害物内にあります`
      )
    }
  }

  return {
    mapId: map.id,
    mapName: map.name,
    valid: errors.length === 0,
    errors,
    warnings,
  }
}

/**
 * 全マップのバリデーション
 */
export function validateMaps(maps: MapConfigJson[]): ValidationResult {
  const results = maps.map(validateMap)
  const valid = results.every((r) => r.valid)
  return { valid, results }
}

/**
 * マップ間の入口接続をバリデーション
 */
export function validateEntranceConnections(maps: MapConfigJson[]): string[] {
  const errors: string[] = []
  const mapIds = new Set(maps.map((m) => m.id))

  for (const map of maps) {
    for (const entrance of map.entrances ?? []) {
      const { leadsTo } = entrance

      // Check if target map exists
      if (!mapIds.has(leadsTo.mapId)) {
        errors.push(
          `[${map.id}] 入口 "${entrance.id}" の接続先マップ "${leadsTo.mapId}" が存在しません`
        )
        continue
      }

      // Check if target node exists in target map
      const targetMap = maps.find((m) => m.id === leadsTo.mapId)
      if (targetMap) {
        const targetEntranceIds = targetMap.entrances.map((e) => e.id)
        if (!targetEntranceIds.includes(leadsTo.nodeId)) {
          errors.push(
            `[${map.id}] 入口 "${entrance.id}" の接続先ノード "${leadsTo.nodeId}" がマップ "${leadsTo.mapId}" に存在しません`
          )
        }
      }
    }
  }

  return errors
}
