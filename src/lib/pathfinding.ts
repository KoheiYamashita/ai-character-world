import type { GameMap, PathNode } from '@/types'

function reconstructPath(
  parent: Map<string, string>,
  startId: string,
  endId: string
): string[] {
  const path: string[] = []
  let current = endId

  while (current !== startId) {
    path.unshift(current)
    const p = parent.get(current)
    if (!p) break
    current = p
  }

  path.unshift(startId)
  return path
}

export function getNodeById(map: GameMap, nodeId: string): PathNode | undefined {
  return map.nodes.find((n) => n.id === nodeId)
}

export function getNodesInPath(map: GameMap, path: string[]): PathNode[] {
  return path
    .map((id) => getNodeById(map, id))
    .filter((n): n is PathNode => n !== undefined)
}

/**
 * Find a path that avoids blocked nodes.
 * Returns empty array if no alternative path is found (no fallback).
 * If destination is blocked, returns empty array.
 */
export function findPathAvoidingNodes(
  map: GameMap,
  startId: string,
  endId: string,
  blockedNodes: Set<string>
): string[] {
  if (startId === endId) return [startId]

  // If destination is blocked, return empty array
  if (blockedNodes.has(endId)) return []

  const nodeMap = new Map<string, PathNode>()
  for (const node of map.nodes) {
    nodeMap.set(node.id, node)
  }

  const startNode = nodeMap.get(startId)
  const endNode = nodeMap.get(endId)

  if (!startNode || !endNode) return []

  const queue: string[] = [startId]
  const visited = new Set<string>([startId])
  const parent = new Map<string, string>()

  while (queue.length > 0) {
    const currentId = queue.shift()!
    const currentNode = nodeMap.get(currentId)!

    if (currentId === endId) {
      return reconstructPath(parent, startId, endId)
    }

    for (const neighborId of currentNode.connectedTo) {
      if (visited.has(neighborId)) continue

      // Skip blocked nodes
      if (blockedNodes.has(neighborId)) continue

      visited.add(neighborId)
      parent.set(neighborId, currentId)
      queue.push(neighborId)
    }
  }

  // No path found - return empty array (no fallback)
  return []
}
