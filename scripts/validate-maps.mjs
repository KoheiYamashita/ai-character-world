#!/usr/bin/env node
/**
 * マップデータ検証スクリプト
 * - ラベルと障害物の重複チェック
 * - 入口の接続先ノードの存在チェック
 * - spawnNodeIdの存在チェック
 * - 障害物タイプ（building/zone）のバリデーション
 *
 * Usage: node scripts/validate-maps.mjs
 */

import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const mapsPath = join(__dirname, '../public/data/maps.json')

const maps = JSON.parse(readFileSync(mapsPath, 'utf8')).maps

let hasErrors = false

// Minimum sizes for obstacle types
const MIN_BUILDING_SIZE = 2
const MIN_ZONE_SIZE = 4

// Valid wall sides
const VALID_WALL_SIDES = ['top', 'bottom', 'left', 'right']

function tileToPixelObstacle(obs, cols, rows, width, height) {
  const spacingX = width / (cols + 1)
  const spacingY = height / (rows + 1)
  const centerX = spacingX * (obs.col + 1)
  const centerY = spacingY * (obs.row + 1)
  const pixelWidth = spacingX * obs.tileWidth
  const pixelHeight = spacingY * obs.tileHeight
  return {
    label: obs.label,
    row: obs.row,
    col: obs.col,
    x: Math.round(centerX - pixelWidth / 2),
    y: Math.round(centerY - pixelHeight / 2),
    width: Math.round(pixelWidth),
    height: Math.round(pixelHeight)
  }
}

function isPointInsideObstacle(x, y, obs) {
  return x >= obs.x && x <= obs.x + obs.width && y >= obs.y && y <= obs.y + obs.height
}

function getNodePosition(nodeId, prefix, cols, rows, width, height) {
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
    col
  }
}

function generateValidNodeIds(prefix, cols, rows, obstacles, width, height, rawObstacles) {
  const validIds = new Set()
  const spacingX = width / (cols + 1)
  const spacingY = height / (rows + 1)

  // Only building-type obstacles exclude nodes
  const buildingObstacles = obstacles.filter(obs => {
    const rawObs = (rawObstacles || []).find(o => o.label === obs.label && o.row === obs.row && o.col === obs.col)
    return !rawObs?.type || rawObs.type === 'building'
  })

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = Math.round(spacingX * (col + 1))
      const y = Math.round(spacingY * (row + 1))
      const insideBuilding = buildingObstacles.some(obs => isPointInsideObstacle(x, y, obs))
      if (!insideBuilding) {
        validIds.add(`${prefix}-${row}-${col}`)
      }
    }
  }
  return validIds
}

console.log('🔍 マップデータ検証開始...\n')

for (const map of maps) {
  const cols = map.grid.cols || 12
  const rows = map.grid.rows || 9
  const prefix = map.grid.prefix
  const errors = []
  const warnings = []

  // Convert obstacles to pixel coordinates
  const obstacles = (map.obstacles || []).map(obs =>
    tileToPixelObstacle(obs, cols, rows, map.width, map.height)
  )

  // Generate valid node IDs (excluding those inside building obstacles)
  const validNodeIds = generateValidNodeIds(prefix, cols, rows, obstacles, map.width, map.height, map.obstacles)

  // Add entrance IDs to valid nodes
  for (const entrance of map.entrances || []) {
    validNodeIds.add(entrance.id)
  }

  // 1. Check minimum obstacle size (building: 2x2, zone: 4x4) and type validity
  for (const obs of map.obstacles || []) {
    const type = obs.type ?? 'building'

    // Validate type
    if (type !== 'building' && type !== 'zone') {
      errors.push(`❌ 障害物 "${obs.label}" のタイプが無効です: "${type}" (有効: building, zone)`)
      continue
    }

    // Validate minimum size based on type
    const minSize = type === 'zone' ? MIN_ZONE_SIZE : MIN_BUILDING_SIZE
    if (obs.tileWidth < minSize || obs.tileHeight < minSize) {
      errors.push(`❌ 障害物 "${obs.label}" (${type}) のサイズが最小値未満です (${obs.tileWidth}x${obs.tileHeight}, 最小: ${minSize}x${minSize})`)
    }

    // Zone-specific validations
    if (type === 'zone') {
      // Validate wallSides
      if (obs.wallSides) {
        if (!Array.isArray(obs.wallSides)) {
          errors.push(`❌ Zone "${obs.label}" の wallSides は配列である必要があります`)
        } else {
          for (const side of obs.wallSides) {
            if (!VALID_WALL_SIDES.includes(side)) {
              errors.push(`❌ Zone "${obs.label}" の wallSides に無効な値があります: "${side}" (有効: ${VALID_WALL_SIDES.join(', ')})`)
            }
          }
        }
      }

      // Validate door
      if (obs.door) {
        if (typeof obs.door !== 'object') {
          errors.push(`❌ Zone "${obs.label}" の door はオブジェクトである必要があります`)
        } else {
          const { side, start, end } = obs.door

          // Check side validity
          if (!VALID_WALL_SIDES.includes(side)) {
            errors.push(`❌ Zone "${obs.label}" の door.side が無効です: "${side}" (有効: ${VALID_WALL_SIDES.join(', ')})`)
          }

          // Check if door side is in wallSides
          if (obs.wallSides && !obs.wallSides.includes(side)) {
            errors.push(`❌ Zone "${obs.label}" の door.side "${side}" が wallSides に含まれていません`)
          }

          // Check start/end validity
          if (typeof start !== 'number' || typeof end !== 'number') {
            errors.push(`❌ Zone "${obs.label}" の door.start/end は数値である必要があります`)
          } else {
            if (start < 0) {
              errors.push(`❌ Zone "${obs.label}" の door.start は0以上である必要があります`)
            }
            if (end < start) {
              errors.push(`❌ Zone "${obs.label}" の door.end は door.start 以上である必要があります`)
            }

            // Door spec: start and end are wall termination positions.
            // The opening is strictly between them (start < pos < end).
            // So we need at least 2 gap between start and end for one opening position.
            if (end - start < 2) {
              errors.push(`❌ Zone "${obs.label}" の door は end - start >= 2 が必要です（現在: ${end - start}）。開口部が最低1つ必要です`)
            }

            // Check if door is within wall bounds
            const wallLength = (side === 'top' || side === 'bottom') ? obs.tileWidth : obs.tileHeight
            if (end >= wallLength) {
              errors.push(`❌ Zone "${obs.label}" の door.end (${end}) が壁の長さ (${wallLength}) を超えています`)
            }
          }
        }
      }
    }
  }

  // 2. Check label-obstacle conflicts (only for building-type obstacles)
  const buildingObstacles = obstacles.filter(obs => {
    const rawObs = (map.obstacles || []).find(o => o.label === obs.label && o.row === obs.row && o.col === obs.col)
    return !rawObs?.type || rawObs.type === 'building'
  })

  for (const label of map.labels || []) {
    const pos = getNodePosition(label.nodeId, prefix, cols, rows, map.width, map.height)
    if (!pos) continue

    for (const obs of buildingObstacles) {
      if (isPointInsideObstacle(pos.x, pos.y, obs)) {
        errors.push(`❌ ラベル "${label.label}" (${label.nodeId}) が障害物 "${obs.label}" (row:${obs.row}, col:${obs.col}) 内にあります`)
      }
    }
  }

  // 3. Check if spawnNodeId exists
  if (!validNodeIds.has(map.spawnNodeId)) {
    errors.push(`❌ spawnNodeId "${map.spawnNodeId}" が存在しないか障害物内にあります`)
  }

  // 4. Check entrance connectedNodeIds
  for (const entrance of map.entrances || []) {
    for (const connectedId of entrance.connectedNodeIds) {
      if (!validNodeIds.has(connectedId)) {
        errors.push(`❌ 入口 "${entrance.id}" の接続先 "${connectedId}" が存在しないか障害物内にあります`)
      }
    }
  }

  // 5. Check if labels reference valid nodes
  for (const label of map.labels || []) {
    if (!validNodeIds.has(label.nodeId)) {
      errors.push(`❌ ラベル "${label.label}" のノード "${label.nodeId}" が存在しないか障害物内にあります`)
    }
  }

  // Print results
  if (errors.length > 0 || warnings.length > 0) {
    console.log(`=== ${map.id} (${map.name}) ===`)
    errors.forEach(e => console.log(e))
    warnings.forEach(w => console.log(w))
    console.log('')
    if (errors.length > 0) hasErrors = true
  }
}

if (hasErrors) {
  console.log('⚠️  エラーが見つかりました。修正してください。')
  process.exit(1)
} else {
  console.log('✅ すべてのマップが正常です！')
  process.exit(0)
}
