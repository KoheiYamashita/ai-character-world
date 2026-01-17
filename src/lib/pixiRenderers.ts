import { Graphics, Text, TextStyle, Container } from 'pixi.js'
import type { PathNode, Obstacle, WallSide } from '@/types'
import type { GameConfig, ObstacleTheme } from '@/types/config'
import { parseColor, getObstacleTheme } from './gameConfigLoader'

/**
 * ノードタイプに対応するテーマを取得
 */
export function getNodeTheme(nodeType: string, nodes: GameConfig['theme']['nodes']) {
  switch (nodeType) {
    case 'entrance':
      return nodes.entrance
    case 'spawn':
      return nodes.spawn
    default:
      return nodes.waypoint
  }
}

/**
 * ノードを描画
 */
export function renderNode(graphics: Graphics, node: PathNode, config: GameConfig): void {
  const theme = getNodeTheme(node.type, config.theme.nodes)
  const alpha = 'alpha' in theme ? theme.alpha : 1

  graphics.circle(node.x, node.y, theme.radius)
  graphics.fill({ color: parseColor(theme.fill), alpha })

  if ('stroke' in theme && theme.stroke) {
    graphics.stroke({ color: parseColor(theme.stroke), width: theme.strokeWidth ?? 1 })
  }
}

/**
 * 障害物を描画（building/zone両対応）
 */
export function renderObstacle(graphics: Graphics, obstacle: Obstacle, config: GameConfig): void {
  const theme = getObstacleTheme(config, obstacle.type)

  if (obstacle.type === 'zone') {
    renderZoneObstacle(graphics, obstacle, theme)
  } else {
    // Building type: draw full rectangle
    graphics.rect(obstacle.x, obstacle.y, obstacle.width, obstacle.height)
    graphics.fill({ color: parseColor(theme.fill), alpha: theme.alpha })
    graphics.stroke({ color: parseColor(theme.stroke), width: theme.strokeWidth })
  }
}

/**
 * Zone障害物の描画
 *
 * シンプルなルール:
 * - 壁はノード位置に描画（半タイル外側にoutset）
 * - ドア位置は1-indexed（角=1）
 * - start〜endの間は壁を描画しない（開口部）
 */
function renderZoneObstacle(graphics: Graphics, obstacle: Obstacle, theme: ObstacleTheme): void {
  const { x, y, width, height, wallSides, door, tileWidth, tileHeight } = obstacle

  // Fill background (if any)
  graphics.rect(x, y, width, height)
  graphics.fill({ color: parseColor(theme.fill), alpha: theme.alpha })

  if (!wallSides || wallSides.length === 0) return

  const strokeColor = parseColor(theme.stroke)
  const strokeWidth = theme.strokeWidth
  const tileSizeX = width / tileWidth
  const tileSizeY = height / tileHeight

  // 壁はノード位置に描画するため、半タイル外側にoutset
  const outsetX = tileSizeX / 2
  const outsetY = tileSizeY / 2

  for (const side of wallSides) {
    drawWallSide(graphics, side, x, y, width, height, tileSizeX, tileSizeY, outsetX, outsetY, tileWidth, tileHeight, door, strokeColor, strokeWidth)
  }
}

/**
 * 壁の描画
 *
 * - 壁はノード位置に描画（outsetで外側に配置）
 * - ドア: 1-indexed（角=1）、start〜endの間が開口部
 */
function drawWallSide(
  graphics: Graphics,
  side: WallSide,
  x: number,
  y: number,
  width: number,
  height: number,
  tileSizeX: number,
  tileSizeY: number,
  outsetX: number,
  outsetY: number,
  tileWidth: number,
  tileHeight: number,
  door: Obstacle['door'],
  strokeColor: number,
  strokeWidth: number
): void {
  // 壁の始点・終点（ノード位置 = zone境界 + outset）
  let wallStartX: number, wallStartY: number, wallEndX: number, wallEndY: number
  let tileCount: number
  let tileSize: number
  let isHorizontal: boolean

  switch (side) {
    case 'top':
      wallStartX = x - outsetX
      wallStartY = y - outsetY
      wallEndX = x + width + outsetX
      wallEndY = y - outsetY
      tileCount = tileWidth + 1  // outsetで+1
      tileSize = tileSizeX
      isHorizontal = true
      break
    case 'bottom':
      wallStartX = x - outsetX
      wallStartY = y + height + outsetY
      wallEndX = x + width + outsetX
      wallEndY = y + height + outsetY
      tileCount = tileWidth + 1
      tileSize = tileSizeX
      isHorizontal = true
      break
    case 'left':
      wallStartX = x - outsetX
      wallStartY = y - outsetY
      wallEndX = x - outsetX
      wallEndY = y + height + outsetY
      tileCount = tileHeight + 1
      tileSize = tileSizeY
      isHorizontal = false
      break
    case 'right':
      wallStartX = x + width + outsetX
      wallStartY = y - outsetY
      wallEndX = x + width + outsetX
      wallEndY = y + height + outsetY
      tileCount = tileHeight + 1
      tileSize = tileSizeY
      isHorizontal = false
      break
  }

  if (door && door.side === side) {
    // ドアあり: 2つのセグメントに分けて描画
    // 1-indexed: 位置1〜start（壁）、start+1〜end-1（開口部）、end〜最後（壁）
    const doorStartPos = door.start * tileSize  // 位置startまで壁
    const doorEndPos = door.end * tileSize      // 位置endから壁

    // セグメント1: 始点〜位置start
    if (door.start >= 1) {
      if (isHorizontal) {
        graphics.moveTo(wallStartX, wallStartY)
        graphics.lineTo(wallStartX + doorStartPos, wallStartY)
      } else {
        graphics.moveTo(wallStartX, wallStartY)
        graphics.lineTo(wallStartX, wallStartY + doorStartPos)
      }
      graphics.stroke({ color: strokeColor, width: strokeWidth })
    }

    // セグメント2: 位置end〜終点
    if (door.end <= tileCount) {
      if (isHorizontal) {
        graphics.moveTo(wallStartX + doorEndPos, wallStartY)
        graphics.lineTo(wallEndX, wallEndY)
      } else {
        graphics.moveTo(wallStartX, wallStartY + doorEndPos)
        graphics.lineTo(wallEndX, wallEndY)
      }
      graphics.stroke({ color: strokeColor, width: strokeWidth })
    }
  } else {
    // ドアなし: 全体を描画
    graphics.moveTo(wallStartX, wallStartY)
    graphics.lineTo(wallEndX, wallEndY)
    graphics.stroke({ color: strokeColor, width: strokeWidth })
  }
}

/**
 * 障害物ラベルのテキストを作成
 */
export function createObstacleLabel(obstacle: Obstacle, config: GameConfig): Text {
  const PADDING = 4
  const MIN_FONT_SIZE = 6
  const MAX_FONT_SIZE = 16

  const maxWidth = obstacle.width - PADDING * 2
  const maxHeight = obstacle.height - PADDING * 2
  const theme = getObstacleTheme(config, obstacle.type)
  const labelColor = theme.labelColor ?? '0xffffff'

  const style = new TextStyle({
    fontFamily: '"Hiragino Sans", "Meiryo", "Yu Gothic", "Noto Sans JP", sans-serif',
    fontSize: Math.min(maxHeight * 0.8, MAX_FONT_SIZE),
    fill: parseColor(labelColor),
    align: 'center',
    wordWrap: true,
    wordWrapWidth: maxWidth,
  })

  const text = new Text({ text: obstacle.label ?? '', style })

  // Scale down proportionally if text exceeds bounds
  if (text.width > maxWidth || text.height > maxHeight) {
    const scale = Math.max(
      MIN_FONT_SIZE / style.fontSize,
      Math.min(maxWidth / text.width, maxHeight / text.height)
    )
    style.fontSize = Math.floor(style.fontSize * scale)
    text.style = style
  }

  text.anchor.set(0.5, 0.5)
  text.x = obstacle.x + obstacle.width / 2
  text.y = obstacle.y + obstacle.height / 2

  return text
}

/**
 * エントランスと接続ノード間の線を描画
 */
export function renderEntranceConnections(
  container: Container,
  entranceNode: PathNode,
  allNodes: PathNode[],
  config: GameConfig
): void {
  const lineTheme = config.theme.nodes.connectionLine
  for (const connectedId of entranceNode.connectedTo) {
    const connectedNode = allNodes.find((n) => n.id === connectedId)
    if (connectedNode) {
      const lineGraphics = new Graphics()
      lineGraphics.moveTo(entranceNode.x, entranceNode.y)
      lineGraphics.lineTo(connectedNode.x, connectedNode.y)
      lineGraphics.stroke({ color: parseColor(lineTheme.color), width: lineTheme.width, alpha: lineTheme.alpha })
      container.addChildAt(lineGraphics, 0)
    }
  }
}
