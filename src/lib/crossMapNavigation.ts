import type { WorldMap, PathNode, CrossMapRoute, RouteSegment } from '@/types'
import { findPathAvoidingNodes } from './pathfinding'

interface MapConnection {
  fromMapId: string
  toMapId: string
  fromEntranceId: string
  toEntranceId: string
}

interface MapGraph {
  connections: MapConnection[]
  // Map from mapId to list of connected mapIds with their entrance info
  adjacency: Map<string, { toMapId: string; fromEntranceId: string; toEntranceId: string }[]>
}

/**
 * Build a graph of map connections based on entrance definitions
 */
export function buildMapGraph(maps: Record<string, WorldMap>): MapGraph {
  const connections: MapConnection[] = []
  const adjacency = new Map<string, { toMapId: string; fromEntranceId: string; toEntranceId: string }[]>()

  // Initialize adjacency for all maps
  for (const mapId of Object.keys(maps)) {
    adjacency.set(mapId, [])
  }

  // Build connections from entrance leadsTo properties
  for (const map of Object.values(maps)) {
    for (const node of map.nodes) {
      if (node.type === 'entrance' && node.leadsTo) {
        const connection: MapConnection = {
          fromMapId: map.id,
          toMapId: node.leadsTo.mapId,
          fromEntranceId: node.id,
          toEntranceId: node.leadsTo.nodeId,
        }
        connections.push(connection)

        // Add to adjacency list
        const adj = adjacency.get(map.id)
        if (adj) {
          adj.push({
            toMapId: node.leadsTo.mapId,
            fromEntranceId: node.id,
            toEntranceId: node.leadsTo.nodeId,
          })
        }
      }
    }
  }

  return { connections, adjacency }
}

interface MapSequenceStep {
  mapId: string
  exitEntranceId?: string  // Entrance used to leave this map
  entryEntranceId?: string // Entrance used to enter this map
}

/**
 * Find the sequence of maps to traverse using BFS
 * Returns the map IDs in order with their entrance/exit information
 */
export function findMapSequence(
  graph: MapGraph,
  startMapId: string,
  endMapId: string
): MapSequenceStep[] | null {
  if (startMapId === endMapId) {
    return [{ mapId: startMapId }]
  }

  const queue: { mapId: string; path: MapSequenceStep[] }[] = [
    { mapId: startMapId, path: [{ mapId: startMapId }] }
  ]
  const visited = new Set<string>([startMapId])

  while (queue.length > 0) {
    const { mapId, path } = queue.shift()!
    const neighbors = graph.adjacency.get(mapId) ?? []

    for (const neighbor of neighbors) {
      if (visited.has(neighbor.toMapId)) continue

      // Update the last step with exit entrance info
      const newPath = [...path]
      newPath[newPath.length - 1] = {
        ...newPath[newPath.length - 1],
        exitEntranceId: neighbor.fromEntranceId,
      }

      // Add new step with entry entrance info
      const newStep: MapSequenceStep = {
        mapId: neighbor.toMapId,
        entryEntranceId: neighbor.toEntranceId,
      }
      newPath.push(newStep)

      if (neighbor.toMapId === endMapId) {
        return newPath
      }

      visited.add(neighbor.toMapId)
      queue.push({ mapId: neighbor.toMapId, path: newPath })
    }
  }

  return null // No path found
}

/**
 * Plan a complete cross-map route from current position to target
 * @param blockedNodesPerMap - Map of mapId to set of blocked node IDs (e.g., NPC positions)
 */
export function planCrossMapRoute(
  maps: Record<string, WorldMap>,
  currentMapId: string,
  currentNodeId: string,
  targetMapId: string,
  targetNodeId: string,
  blockedNodesPerMap: Map<string, Set<string>> = new Map()
): CrossMapRoute | null {
  // Build the map graph
  const graph = buildMapGraph(maps)

  // Find the sequence of maps to traverse
  const mapSequence = findMapSequence(graph, currentMapId, targetMapId)
  if (!mapSequence) {
    console.error(`No path found from map "${currentMapId}" to map "${targetMapId}"`)
    return null
  }

  const segments: RouteSegment[] = []

  for (let i = 0; i < mapSequence.length; i++) {
    const step = mapSequence[i]
    const map = maps[step.mapId]
    if (!map) {
      console.error(`Map "${step.mapId}" not found`)
      return null
    }

    const isFirstMap = i === 0
    const isLastMap = i === mapSequence.length - 1

    // Determine start and end nodes for this segment
    let startNodeId: string
    let endNodeId: string

    if (isFirstMap) {
      startNodeId = currentNodeId
    } else {
      // Start from the entry entrance
      startNodeId = step.entryEntranceId!
    }

    if (isLastMap) {
      endNodeId = targetNodeId
    } else {
      // End at the exit entrance
      endNodeId = step.exitEntranceId!
    }

    // Get blocked nodes for this map (or empty set if none)
    const blockedNodes = blockedNodesPerMap.get(step.mapId) ?? new Set<string>()

    // Find path within this map, avoiding blocked nodes
    const path = findPathAvoidingNodes(map, startNodeId, endNodeId, blockedNodes)
    if (path.length === 0) {
      console.error(`No path found in map "${step.mapId}" from "${startNodeId}" to "${endNodeId}"`)
      return null
    }

    segments.push({
      mapId: step.mapId,
      path,
      exitEntranceId: step.exitEntranceId,
    })
  }

  return { segments }
}

/**
 * Get the starting node ID and position for a route segment
 */
export function getSegmentStartNode(
  map: WorldMap,
  segment: RouteSegment
): PathNode | undefined {
  if (segment.path.length === 0) return undefined
  return map.nodes.find(n => n.id === segment.path[0])
}

/**
 * Check if a route has more segments after the current one
 */
export function hasMoreSegments(route: CrossMapRoute, currentIndex: number): boolean {
  return currentIndex < route.segments.length - 1
}

/**
 * Get the next segment in a route
 */
export function getNextSegment(route: CrossMapRoute, currentIndex: number): RouteSegment | undefined {
  if (!hasMoreSegments(route, currentIndex)) return undefined
  return route.segments[currentIndex + 1]
}
