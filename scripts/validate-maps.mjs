#!/usr/bin/env node
/**
 * マップデータ検証スクリプト
 * - ラベルと障害物の重複チェック
 * - 入口の接続先ノードの存在チェック
 * - spawnNodeIdの存在チェック
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

function generateValidNodeIds(prefix, cols, rows, obstacles, width, height) {
  const validIds = new Set()
  const spacingX = width / (cols + 1)
  const spacingY = height / (rows + 1)

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = Math.round(spacingX * (col + 1))
      const y = Math.round(spacingY * (row + 1))
      const insideObstacle = obstacles.some(obs => isPointInsideObstacle(x, y, obs))
      if (!insideObstacle) {
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

  // Generate valid node IDs (excluding those inside obstacles)
  const validNodeIds = generateValidNodeIds(prefix, cols, rows, obstacles, map.width, map.height)

  // Add entrance IDs to valid nodes
  for (const entrance of map.entrances || []) {
    validNodeIds.add(entrance.id)
  }

  // 1. Check minimum obstacle size (2x2)
  for (const obs of map.obstacles || []) {
    if (obs.tileWidth < 2 || obs.tileHeight < 2) {
      errors.push(`❌ 障害物 "${obs.label}" のサイズが最小値未満です (${obs.tileWidth}x${obs.tileHeight}, 最小: 2x2)`)
    }
  }

  // 2. Check label-obstacle conflicts
  for (const label of map.labels || []) {
    const pos = getNodePosition(label.nodeId, prefix, cols, rows, map.width, map.height)
    if (!pos) continue

    for (const obs of obstacles) {
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
