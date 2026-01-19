import { Graphics, Text, TextStyle, Container, AnimatedSprite } from 'pixi.js'
import type { PathNode, Obstacle, WallSide, NPC } from '@/types'
import type { WorldConfig, ObstacleTheme } from '@/types/config'
import { parseColor, getObstacleTheme } from './worldConfigLoader'
import { getDirectionAnimation, getIdleTexture, type CharacterSpritesheet } from './spritesheet'

/**
 * ノードタイプに対応するテーマを取得
 */
export function getNodeTheme(nodeType: string, nodes: WorldConfig['theme']['nodes']) {
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
export function renderNode(graphics: Graphics, node: PathNode, config: WorldConfig): void {
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
export function renderObstacle(graphics: Graphics, obstacle: Obstacle, config: WorldConfig): void {
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
 * シンプルなルール（起点ベース座標系）:
 * - x, y = 起点ノードのピクセル位置
 * - 壁はノード位置に直接描画（outset不要）
 * - ドアのstart/endは起点からのオフセット
 */
function renderZoneObstacle(graphics: Graphics, obstacle: Obstacle, theme: ObstacleTheme): void {
  const { x, y, width, height, wallSides, door, tileWidth, tileHeight } = obstacle
  const strokeColor = parseColor(theme.stroke)
  const strokeWidth = theme.strokeWidth

  // Fill background
  graphics.rect(x, y, width, height)
  graphics.fill({ color: parseColor(theme.fill), alpha: theme.alpha })

  // No walls: draw boundary outline only
  if (!wallSides || wallSides.length === 0) {
    graphics.stroke({ color: strokeColor, width: strokeWidth, alpha: 0.4 })
    return
  }

  // Draw each wall side
  const tileSizeX = width / tileWidth
  const tileSizeY = height / tileHeight
  for (const side of wallSides) {
    drawWallSide(graphics, side, x, y, width, height, tileSizeX, tileSizeY, tileWidth, tileHeight, door, strokeColor, strokeWidth)
  }
}

/**
 * 壁の描画（起点ベース座標系）
 *
 * - 壁はノード位置に直接描画
 * - ドア: start〜endの間が開口部（0-indexed）
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
  tileWidth: number,
  tileHeight: number,
  door: Obstacle['door'],
  strokeColor: number,
  strokeWidth: number
): void {
  // 壁の始点・終点（ノード位置に直接）
  let wallStartX: number, wallStartY: number, wallEndX: number, wallEndY: number
  let tileCount: number
  let tileSize: number
  let isHorizontal: boolean

  switch (side) {
    case 'top':
      wallStartX = x
      wallStartY = y
      wallEndX = x + width
      wallEndY = y
      tileCount = tileWidth
      tileSize = tileSizeX
      isHorizontal = true
      break
    case 'bottom':
      wallStartX = x
      wallStartY = y + height
      wallEndX = x + width
      wallEndY = y + height
      tileCount = tileWidth
      tileSize = tileSizeX
      isHorizontal = true
      break
    case 'left':
      wallStartX = x
      wallStartY = y
      wallEndX = x
      wallEndY = y + height
      tileCount = tileHeight
      tileSize = tileSizeY
      isHorizontal = false
      break
    case 'right':
      wallStartX = x + width
      wallStartY = y
      wallEndX = x + width
      wallEndY = y + height
      tileCount = tileHeight
      tileSize = tileSizeY
      isHorizontal = false
      break
  }

  if (door && door.side === side) {
    // ドアあり: 2つのセグメントに分けて描画
    const doorStartPos = door.start * tileSize
    const doorEndPos = door.end * tileSize

    // セグメント1: 始点〜ドア開始位置
    if (door.start > 0) {
      if (isHorizontal) {
        graphics.moveTo(wallStartX, wallStartY)
        graphics.lineTo(wallStartX + doorStartPos, wallStartY)
      } else {
        graphics.moveTo(wallStartX, wallStartY)
        graphics.lineTo(wallStartX, wallStartY + doorStartPos)
      }
      graphics.stroke({ color: strokeColor, width: strokeWidth })
    }

    // セグメント2: ドア終了位置〜終点
    if (door.end < tileCount) {
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
export function createObstacleLabel(obstacle: Obstacle, config: WorldConfig): Text {
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
  config: WorldConfig
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

/**
 * NPCスプライトを作成
 */
export function createNPCSprite(
  npc: NPC,
  spritesheet: CharacterSpritesheet,
  config: WorldConfig
): AnimatedSprite {
  const idleTexture = getIdleTexture(spritesheet, npc.direction)
  const textures = getDirectionAnimation(spritesheet, npc.direction)
  const sprite = new AnimatedSprite(textures)
  sprite.anchor.set(0.5, 0.5)
  sprite.scale.set(config.character.scale)
  sprite.x = npc.position.x
  sprite.y = npc.position.y
  sprite.label = `npc-${npc.id}`
  sprite.texture = idleTexture
  sprite.stop()

  return sprite
}
