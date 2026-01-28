/**
 * マップエディタ用描画関数
 */

import { Graphics, Text, TextStyle, Container, Sprite, Texture, Rectangle, Assets } from 'pixi.js'
import type { WorldConfig } from '@/types/config'
import type { ObstacleConfigJson, EntranceConfigJson } from '@/types/map'
import type { EditorSelection, ResizeHandle } from '@/types/editor'
import { parseColor, getObstacleTheme } from './worldConfigLoader'
import { tileToPixelObstacle, tileToPixelEntrance, type TileToPixelConfig } from '@/data/maps/grid'

// グリッド線の色
const GRID_LINE_COLOR = 0x808080
const GRID_LINE_ALPHA = 0.3
const GRID_NODE_COLOR = 0xffffff
const GRID_NODE_ALPHA = 0.2
const GRID_NODE_RADIUS = 3

// 選択ハンドルの設定
const SELECTION_STROKE_COLOR = 0x00ffff
const SELECTION_STROKE_WIDTH = 2
const HANDLE_SIZE = 8
const HANDLE_COLOR = 0x00ffff

// 入口の色
const ENTRANCE_COLOR = 0xffd700
const ENTRANCE_RADIUS = 8

// スポーン位置の色
const SPAWN_COLOR = 0x00ff00
const SPAWN_RADIUS = 10

/**
 * ノードがbuilding障害物の内部にあるかチェック
 */
function isNodeInsideBuilding(
  row: number,
  col: number,
  obstacles: ObstacleConfigJson[]
): boolean {
  for (const obs of obstacles) {
    if (obs.type !== 'building' && obs.type !== undefined) continue
    // building内部: row/colが障害物の範囲内
    if (
      row >= obs.row &&
      row < obs.row + obs.tileHeight &&
      col >= obs.col &&
      col < obs.col + obs.tileWidth
    ) {
      return true
    }
  }
  return false
}

/**
 * ノードが壁付きゾーンの壁上にあるかチェック（ドア開口部を除く）
 */
function isNodeOnZoneWall(
  row: number,
  col: number,
  obstacles: ObstacleConfigJson[]
): boolean {
  for (const obs of obstacles) {
    if (obs.type !== 'zone') continue
    const wallSides = obs.wallSides ?? []
    if (wallSides.length === 0) continue

    const topEdge = obs.row
    const bottomEdge = obs.row + obs.tileHeight
    const leftEdge = obs.col
    const rightEdge = obs.col + obs.tileWidth

    // 角は除外（壁の交差点）
    const isCorner =
      (row === topEdge || row === bottomEdge) &&
      (col === leftEdge || col === rightEdge)
    if (isCorner) continue

    // 各壁をチェック
    for (const side of wallSides) {
      let onWall = false
      let offset = 0

      switch (side) {
        case 'top':
          if (row === topEdge && col > leftEdge && col < rightEdge) {
            onWall = true
            offset = col - leftEdge
          }
          break
        case 'bottom':
          if (row === bottomEdge && col > leftEdge && col < rightEdge) {
            onWall = true
            offset = col - leftEdge
          }
          break
        case 'left':
          if (col === leftEdge && row > topEdge && row < bottomEdge) {
            onWall = true
            offset = row - topEdge
          }
          break
        case 'right':
          if (col === rightEdge && row > topEdge && row < bottomEdge) {
            onWall = true
            offset = row - topEdge
          }
          break
      }

      if (onWall) {
        // ドア開口部かチェック
        const door = obs.door
        if (door && door.side === side) {
          // ドア開口部内: start < offset < end
          if (offset > door.start && offset < door.end) {
            continue // ドア開口部なのでスキップ
          }
        }
        return true // 壁上
      }
    }
  }
  return false
}

/**
 * グリッドオーバーレイを描画
 */
export function renderGridOverlay(
  graphics: Graphics,
  width: number,
  height: number,
  cols: number,
  rows: number,
  obstacles?: ObstacleConfigJson[]
): void {
  const spacingX = width / (cols + 1)
  const spacingY = height / (rows + 1)

  graphics.clear()

  // グリッド線を描画
  // 縦線
  for (let col = 0; col <= cols + 1; col++) {
    const x = spacingX * col
    graphics.moveTo(x, 0)
    graphics.lineTo(x, height)
    graphics.stroke({ color: GRID_LINE_COLOR, width: 1, alpha: GRID_LINE_ALPHA })
  }

  // 横線
  for (let row = 0; row <= rows + 1; row++) {
    const y = spacingY * row
    graphics.moveTo(0, y)
    graphics.lineTo(width, y)
    graphics.stroke({ color: GRID_LINE_COLOR, width: 1, alpha: GRID_LINE_ALPHA })
  }

  // グリッドノードを描画（障害物を考慮）
  const obs = obstacles ?? []
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      // building内部のノードはスキップ
      if (isNodeInsideBuilding(row, col, obs)) {
        continue
      }
      // 壁付きゾーンの壁上ノードはスキップ
      if (isNodeOnZoneWall(row, col, obs)) {
        continue
      }

      const x = Math.round(spacingX * (col + 1))
      const y = Math.round(spacingY * (row + 1))
      graphics.circle(x, y, GRID_NODE_RADIUS)
      graphics.fill({ color: GRID_NODE_COLOR, alpha: GRID_NODE_ALPHA })
    }
  }
}

/**
 * 選択ハイライトを描画
 */
export function renderSelectionHighlight(
  graphics: Graphics,
  x: number,
  y: number,
  width: number,
  height: number
): void {
  graphics.clear()
  graphics.rect(x, y, width, height)
  graphics.stroke({ color: SELECTION_STROKE_COLOR, width: SELECTION_STROKE_WIDTH })
}

/**
 * リサイズハンドルの位置を取得
 */
export function getHandlePositions(
  x: number,
  y: number,
  width: number,
  height: number
): Record<ResizeHandle, { x: number; y: number }> {
  const halfHandle = HANDLE_SIZE / 2
  return {
    'top-left': { x: x - halfHandle, y: y - halfHandle },
    top: { x: x + width / 2 - halfHandle, y: y - halfHandle },
    'top-right': { x: x + width - halfHandle, y: y - halfHandle },
    left: { x: x - halfHandle, y: y + height / 2 - halfHandle },
    right: { x: x + width - halfHandle, y: y + height / 2 - halfHandle },
    'bottom-left': { x: x - halfHandle, y: y + height - halfHandle },
    bottom: { x: x + width / 2 - halfHandle, y: y + height - halfHandle },
    'bottom-right': { x: x + width - halfHandle, y: y + height - halfHandle },
  }
}

/**
 * リサイズハンドルを描画
 */
export function renderResizeHandles(
  graphics: Graphics,
  x: number,
  y: number,
  width: number,
  height: number
): void {
  const positions = getHandlePositions(x, y, width, height)

  for (const pos of Object.values(positions)) {
    graphics.rect(pos.x, pos.y, HANDLE_SIZE, HANDLE_SIZE)
    graphics.fill({ color: HANDLE_COLOR })
  }
}

/**
 * ハンドル位置からリサイズハンドルを特定
 */
export function getHandleAtPosition(
  mouseX: number,
  mouseY: number,
  x: number,
  y: number,
  width: number,
  height: number
): ResizeHandle | null {
  const positions = getHandlePositions(x, y, width, height)

  for (const [handle, pos] of Object.entries(positions) as [ResizeHandle, { x: number; y: number }][]) {
    if (
      mouseX >= pos.x &&
      mouseX <= pos.x + HANDLE_SIZE &&
      mouseY >= pos.y &&
      mouseY <= pos.y + HANDLE_SIZE
    ) {
      return handle
    }
  }
  return null
}

/**
 * エディタ用壁描画（起点ベース座標系）
 * pixiRenderers.ts の drawWallSide を参考に実装
 */
function drawEditorWallSide(
  graphics: Graphics,
  side: string, // 'top' | 'bottom' | 'left' | 'right'
  x: number,
  y: number,
  width: number,
  height: number,
  tileSizeX: number,
  tileSizeY: number,
  tileWidth: number,
  tileHeight: number,
  door: { side: string; start: number; end: number } | undefined,
  strokeColor: number,
  strokeWidth: number
): void {
  // 壁の始点・終点
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
    default:
      return
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
 * 障害物をエディタ用に描画（選択状態対応）
 * 本番マップと同じ描画ロジックを使用
 */
export function renderEditorObstacle(
  container: Container,
  obstacle: ObstacleConfigJson,
  index: number,
  gridConfig: TileToPixelConfig,
  config: WorldConfig,
  isSelected: boolean
): void {
  const pixel = tileToPixelObstacle(obstacle, gridConfig)
  const type = obstacle.type ?? 'building'
  const theme = getObstacleTheme(config, type)
  const strokeColor = parseColor(theme.stroke)

  const obsGraphics = new Graphics()
  obsGraphics.label = `obstacle-${index}`

  if (type === 'building') {
    // Building: 四角形を描画（黄色の枠線）
    obsGraphics.rect(pixel.x, pixel.y, pixel.width, pixel.height)
    obsGraphics.fill({ color: parseColor(theme.fill), alpha: theme.alpha })
    obsGraphics.stroke({ color: strokeColor, width: theme.strokeWidth })
  } else if (type === 'zone') {
    // Zone: 背景を塗る
    obsGraphics.rect(pixel.x, pixel.y, pixel.width, pixel.height)
    obsGraphics.fill({ color: parseColor(theme.fill), alpha: theme.alpha })

    const wallSides = obstacle.wallSides ?? []

    if (wallSides.length === 0) {
      // 壁なしゾーン: 境界線のみ（薄いアルファ）
      obsGraphics.stroke({ color: strokeColor, width: theme.strokeWidth, alpha: 0.4 })
    } else {
      // 壁ありゾーン: 各壁を描画
      const tileSizeX = pixel.width / obstacle.tileWidth
      const tileSizeY = pixel.height / obstacle.tileHeight

      for (const side of wallSides) {
        drawEditorWallSide(
          obsGraphics,
          side,
          pixel.x,
          pixel.y,
          pixel.width,
          pixel.height,
          tileSizeX,
          tileSizeY,
          obstacle.tileWidth,
          obstacle.tileHeight,
          obstacle.door,
          strokeColor,
          theme.strokeWidth
        )
      }
    }
  }

  container.addChild(obsGraphics)

  // ラベル
  if (obstacle.label) {
    const labelStyle = new TextStyle({
      fontFamily: '"Hiragino Sans", "Meiryo", "Yu Gothic", sans-serif',
      fontSize: Math.min(12, pixel.height * 0.3),
      fill: parseColor(theme.labelColor ?? '0xffffff'),
      align: 'center',
    })
    const label = new Text({ text: obstacle.label, style: labelStyle })
    label.anchor.set(0.5, 0.5)
    label.x = pixel.x + pixel.width / 2
    label.y = pixel.y + pixel.height / 2
    container.addChild(label)
  }

  // 選択状態
  if (isSelected) {
    const selGraphics = new Graphics()
    renderSelectionHighlight(selGraphics, pixel.x, pixel.y, pixel.width, pixel.height)
    container.addChild(selGraphics)

    const handleGraphics = new Graphics()
    renderResizeHandles(handleGraphics, pixel.x, pixel.y, pixel.width, pixel.height)
    container.addChild(handleGraphics)
  }
}

/**
 * 入口をエディタ用に描画
 */
export function renderEditorEntrance(
  container: Container,
  entrance: EntranceConfigJson,
  index: number,
  gridConfig: TileToPixelConfig,
  isSelected: boolean
): void {
  const pixel = tileToPixelEntrance(entrance, gridConfig)

  const graphics = new Graphics()
  graphics.label = `entrance-${index}`
  graphics.circle(pixel.x, pixel.y, ENTRANCE_RADIUS)
  graphics.fill({ color: ENTRANCE_COLOR, alpha: 0.8 })

  if (isSelected) {
    graphics.stroke({ color: SELECTION_STROKE_COLOR, width: SELECTION_STROKE_WIDTH })
  }

  container.addChild(graphics)

  // ラベル
  const labelStyle = new TextStyle({
    fontFamily: '"Hiragino Sans", "Meiryo", "Yu Gothic", sans-serif',
    fontSize: 10,
    fill: 0xffffff,
  })
  const label = new Text({ text: entrance.label || entrance.id, style: labelStyle })
  label.anchor.set(0.5, 0)
  label.x = pixel.x
  label.y = pixel.y + ENTRANCE_RADIUS + 2
  container.addChild(label)
}

/**
 * スポーン位置をエディタ用に描画
 */
export function renderEditorSpawnNode(
  container: Container,
  spawnNodeId: string,
  prefix: string,
  gridConfig: TileToPixelConfig,
  isSelected: boolean
): void {
  const pixel = nodeIdToPixel(spawnNodeId, prefix, gridConfig)
  if (!pixel) return

  const graphics = new Graphics()
  graphics.label = 'spawn-node'

  // 外側の円（緑）
  graphics.circle(pixel.x, pixel.y, SPAWN_RADIUS)
  graphics.fill({ color: SPAWN_COLOR, alpha: 0.8 })

  // 内側の点（白）
  graphics.circle(pixel.x, pixel.y, 3)
  graphics.fill({ color: 0xffffff })

  if (isSelected) {
    graphics.stroke({ color: SELECTION_STROKE_COLOR, width: SELECTION_STROKE_WIDTH })
  }

  container.addChild(graphics)

  // ラベル
  const labelStyle = new TextStyle({
    fontFamily: '"Hiragino Sans", "Meiryo", "Yu Gothic", sans-serif',
    fontSize: 10,
    fill: 0x00ff00,
  })
  const label = new Text({ text: '初期位置', style: labelStyle })
  label.anchor.set(0.5, 0)
  label.x = pixel.x
  label.y = pixel.y + SPAWN_RADIUS + 2
  container.addChild(label)
}

/**
 * スポーン位置がクリック位置を含むかチェック
 */
export function isSpawnNodeAtPosition(
  spawnNodeId: string,
  pixelX: number,
  pixelY: number,
  prefix: string,
  gridConfig: TileToPixelConfig
): boolean {
  const pixel = nodeIdToPixel(spawnNodeId, prefix, gridConfig)
  if (!pixel) return false

  const dx = pixelX - pixel.x
  const dy = pixelY - pixel.y
  return Math.sqrt(dx * dx + dy * dy) <= SPAWN_RADIUS + 4
}

/**
 * ピクセル座標をタイル座標に変換
 */
export function pixelToTile(
  pixelX: number,
  pixelY: number,
  gridConfig: TileToPixelConfig
): { row: number; col: number } {
  const spacingX = gridConfig.width / (gridConfig.cols + 1)
  const spacingY = gridConfig.height / (gridConfig.rows + 1)

  // ノード位置に最も近いタイル座標を計算
  const col = Math.round(pixelX / spacingX - 1)
  const row = Math.round(pixelY / spacingY - 1)

  return { row, col }
}

/**
 * ピクセル座標をスナップしたタイル座標に変換
 */
export function pixelToTileSnapped(
  pixelX: number,
  pixelY: number,
  gridConfig: TileToPixelConfig
): { row: number; col: number } {
  const { row, col } = pixelToTile(pixelX, pixelY, gridConfig)
  return {
    row: Math.max(-1, Math.min(gridConfig.rows, row)),
    col: Math.max(-1, Math.min(gridConfig.cols, col)),
  }
}

/**
 * 障害物がクリック位置を含むかチェック
 */
export function isObstacleAtPosition(
  obstacle: ObstacleConfigJson,
  pixelX: number,
  pixelY: number,
  gridConfig: TileToPixelConfig
): boolean {
  const pixel = tileToPixelObstacle(obstacle, gridConfig)
  return (
    pixelX >= pixel.x &&
    pixelX <= pixel.x + pixel.width &&
    pixelY >= pixel.y &&
    pixelY <= pixel.y + pixel.height
  )
}

/**
 * 入口がクリック位置を含むかチェック
 */
export function isEntranceAtPosition(
  entrance: EntranceConfigJson,
  pixelX: number,
  pixelY: number,
  gridConfig: TileToPixelConfig
): boolean {
  const pixel = tileToPixelEntrance(entrance, gridConfig)
  const dx = pixelX - pixel.x
  const dy = pixelY - pixel.y
  return Math.sqrt(dx * dx + dy * dy) <= ENTRANCE_RADIUS + 4 // 少し余裕を持たせる
}

/**
 * 選択状態に基づいてカーソルスタイルを取得
 */
export function getCursorStyle(
  selection: EditorSelection | null,
  handle: ResizeHandle | null
): string {
  if (handle) {
    switch (handle) {
      case 'top':
      case 'bottom':
        return 'ns-resize'
      case 'left':
      case 'right':
        return 'ew-resize'
      case 'top-left':
      case 'bottom-right':
        return 'nwse-resize'
      case 'top-right':
      case 'bottom-left':
        return 'nesw-resize'
    }
  }

  if (selection) {
    return 'move'
  }

  return 'default'
}

// NPC表示の設定
const NPC_RADIUS = 12
const NPC_COLOR = 0x9966ff

// ========================================
// 衝突検出関数
// ========================================

/**
 * 2つの矩形が重なるかチェック
 */
export function rectanglesOverlap(
  r1: { row: number; col: number; tileWidth: number; tileHeight: number },
  r2: { row: number; col: number; tileWidth: number; tileHeight: number }
): boolean {
  // r1の右端がr2の左端より左にある場合、重ならない
  if (r1.col + r1.tileWidth <= r2.col) return false
  // r1の左端がr2の右端より右にある場合、重ならない
  if (r1.col >= r2.col + r2.tileWidth) return false
  // r1の下端がr2の上端より上にある場合、重ならない
  if (r1.row + r1.tileHeight <= r2.row) return false
  // r1の上端がr2の下端より下にある場合、重ならない
  if (r1.row >= r2.row + r2.tileHeight) return false
  return true
}

/**
 * 点が矩形内にあるかチェック
 */
export function pointInRectangle(
  point: { row: number; col: number },
  rect: { row: number; col: number; tileWidth: number; tileHeight: number }
): boolean {
  return (
    point.col >= rect.col &&
    point.col < rect.col + rect.tileWidth &&
    point.row >= rect.row &&
    point.row < rect.row + rect.tileHeight
  )
}

/**
 * 障害物が他の障害物と衝突するかチェック
 */
export function checkObstacleCollision(
  obstacle: { row: number; col: number; tileWidth: number; tileHeight: number },
  obstacles: { row: number; col: number; tileWidth: number; tileHeight: number }[],
  excludeIndex?: number
): boolean {
  for (let i = 0; i < obstacles.length; i++) {
    if (i === excludeIndex) continue
    if (rectanglesOverlap(obstacle, obstacles[i])) {
      return true
    }
  }
  return false
}

/**
 * 入口が障害物または他の入口と衝突するかチェック
 */
export function checkEntranceCollision(
  entrance: { row: number; col: number },
  obstacles: { row: number; col: number; tileWidth: number; tileHeight: number }[],
  entrances: { row: number; col: number }[],
  excludeEntranceIndex?: number
): boolean {
  // 障害物との衝突チェック
  for (const obs of obstacles) {
    if (pointInRectangle(entrance, obs)) {
      return true
    }
  }
  // 他の入口との衝突チェック
  for (let i = 0; i < entrances.length; i++) {
    if (i === excludeEntranceIndex) continue
    if (entrances[i].row === entrance.row && entrances[i].col === entrance.col) {
      return true
    }
  }
  return false
}

/**
 * NPCが障害物または他のNPCと衝突するかチェック
 */
export function checkNPCCollision(
  npcPosition: { row: number; col: number },
  obstacles: { row: number; col: number; tileWidth: number; tileHeight: number }[],
  npcPositions: { row: number; col: number }[],
  excludeNPCIndex?: number
): boolean {
  // 障害物との衝突チェック
  for (const obs of obstacles) {
    if (pointInRectangle(npcPosition, obs)) {
      return true
    }
  }
  // 他のNPCとの衝突チェック
  for (let i = 0; i < npcPositions.length; i++) {
    if (i === excludeNPCIndex) continue
    if (npcPositions[i].row === npcPosition.row && npcPositions[i].col === npcPosition.col) {
      return true
    }
  }
  return false
}

/**
 * spawnNodeIdからrow/colを抽出
 */
export function parseSpawnNodeId(spawnNodeId: string): { row: number; col: number } | null {
  const parts = spawnNodeId.split('-')
  if (parts.length < 3) return null
  const row = parseInt(parts[1], 10)
  const col = parseInt(parts[2], 10)
  if (isNaN(row) || isNaN(col)) return null
  return { row, col }
}

/**
 * ノードIDからピクセル座標を計算
 */
export function nodeIdToPixel(
  nodeId: string,
  prefix: string,
  gridConfig: TileToPixelConfig
): { x: number; y: number } | null {
  const parts = nodeId.split('-')
  if (parts.length < 3 || parts[0] !== prefix) return null

  const row = parseInt(parts[1], 10)
  const col = parseInt(parts[2], 10)
  if (isNaN(row) || isNaN(col)) return null

  const spacingX = gridConfig.width / (gridConfig.cols + 1)
  const spacingY = gridConfig.height / (gridConfig.rows + 1)

  return {
    x: Math.round(spacingX * (col + 1)),
    y: Math.round(spacingY * (row + 1)),
  }
}

/**
 * NPCをエディタ用に描画
 */
export function renderEditorNPC(
  container: Container,
  npc: { id: string; name: string; spawnNodeId: string; sprite?: { sheetUrl: string; frameWidth: number; frameHeight: number; cols: number; rows: number; rowMapping: { down: number } } },
  index: number,
  prefix: string,
  gridConfig: TileToPixelConfig,
  isSelected: boolean,
  spriteTexture?: Texture
): void {
  const pixel = nodeIdToPixel(npc.spawnNodeId, prefix, gridConfig)
  if (!pixel) return

  // スプライトがある場合はスプライトを表示、なければ円を表示
  if (spriteTexture && npc.sprite) {
    // スプライトシートの最初のフレームを切り出して表示
    const frameWidth = npc.sprite.frameWidth
    const frameHeight = npc.sprite.frameHeight
    const downRow = npc.sprite.rowMapping.down
    const idleCol = 1 // idle frame

    const frameTexture = new Texture({
      source: spriteTexture.source,
      frame: new Rectangle(
        idleCol * frameWidth,
        downRow * frameHeight,
        frameWidth,
        frameHeight
      ),
    })

    const sprite = new Sprite(frameTexture)
    sprite.anchor.set(0.5, 0.5)
    sprite.x = pixel.x
    sprite.y = pixel.y
    sprite.scale.set(0.5) // エディタではやや小さめに表示
    sprite.label = `npc-${index}`
    container.addChild(sprite)

    // 選択時のハイライト
    if (isSelected) {
      const highlight = new Graphics()
      highlight.rect(
        pixel.x - frameWidth * 0.25 - 2,
        pixel.y - frameHeight * 0.25 - 2,
        frameWidth * 0.5 + 4,
        frameHeight * 0.5 + 4
      )
      highlight.stroke({ color: SELECTION_STROKE_COLOR, width: SELECTION_STROKE_WIDTH })
      container.addChild(highlight)
    }
  } else {
    // フォールバック: 紫の円
    const graphics = new Graphics()
    graphics.label = `npc-${index}`
    graphics.circle(pixel.x, pixel.y, NPC_RADIUS)
    graphics.fill({ color: NPC_COLOR, alpha: 0.8 })

    if (isSelected) {
      graphics.stroke({ color: SELECTION_STROKE_COLOR, width: SELECTION_STROKE_WIDTH })
    }

    container.addChild(graphics)
  }

  // Name label
  const labelStyle = new TextStyle({
    fontFamily: '"Hiragino Sans", "Meiryo", "Yu Gothic", sans-serif',
    fontSize: 10,
    fill: 0xffffff,
  })
  const label = new Text({ text: npc.name, style: labelStyle })
  label.anchor.set(0.5, 0)
  label.x = pixel.x
  label.y = pixel.y + (spriteTexture && npc.sprite ? npc.sprite.frameHeight * 0.25 + 2 : NPC_RADIUS + 2)
  container.addChild(label)
}

/**
 * スプライトテクスチャをロード
 */
export async function loadSpriteTexture(sheetUrl: string): Promise<Texture | null> {
  try {
    const texture = await Assets.load(sheetUrl)
    return texture
  } catch (error) {
    console.warn(`Failed to load sprite: ${sheetUrl}`, error)
    return null
  }
}

/**
 * NPCがクリック位置を含むかチェック
 */
export function isNPCAtPosition(
  npc: { spawnNodeId: string },
  pixelX: number,
  pixelY: number,
  prefix: string,
  gridConfig: TileToPixelConfig
): boolean {
  const pixel = nodeIdToPixel(npc.spawnNodeId, prefix, gridConfig)
  if (!pixel) return false

  const dx = pixelX - pixel.x
  const dy = pixelY - pixel.y
  return Math.sqrt(dx * dx + dy * dy) <= NPC_RADIUS + 4
}
