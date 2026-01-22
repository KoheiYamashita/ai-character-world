export interface GridCoordinate {
  row: number
  col: number
}

/**
 * Node IDからグリッド座標をパース
 *
 * @param nodeId - "prefix-row-col" 形式のID
 * @param gridPrefix - 検証用プレフィックス（省略時はチェックなし）
 */
export function parseNodeIdToGridCoord(
  nodeId: string,
  gridPrefix?: string
): GridCoordinate | null {
  const parts = nodeId.split('-')
  if (parts.length < 3) return null

  if (gridPrefix !== undefined && parts[0] !== gridPrefix) {
    return null
  }

  // 末尾から取得（複合プレフィックス対応）
  const row = parseInt(parts[parts.length - 2], 10)
  const col = parseInt(parts[parts.length - 1], 10)

  if (isNaN(row) || isNaN(col)) return null
  return { row, col }
}
