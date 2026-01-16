import type { GameMap, PathNode } from '@/types'

export function findPath(map: GameMap, startId: string, endId: string): string[] {
  if (startId === endId) return [startId]

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
      if (!visited.has(neighborId)) {
        visited.add(neighborId)
        parent.set(neighborId, currentId)
        queue.push(neighborId)
      }
    }
  }

  return []
}

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
