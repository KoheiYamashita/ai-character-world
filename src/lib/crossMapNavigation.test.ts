import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  buildMapGraph,
  findMapSequence,
  planCrossMapRoute,
  getSegmentStartNode,
  hasMoreSegments,
  getNextSegment,
} from './crossMapNavigation'
import type { WorldMap, PathNode, CrossMapRoute, RouteSegment } from '@/types'

// Helper to create a simple map with entrances
function createTestMap(
  id: string,
  entrances: { id: string; leadsTo: { mapId: string; nodeId: string } }[]
): WorldMap {
  const nodes: PathNode[] = [
    { id: `${id}-0-0`, x: 100, y: 100, type: 'waypoint', connectedTo: [`${id}-0-1`, `${id}-1-0`] },
    { id: `${id}-0-1`, x: 200, y: 100, type: 'waypoint', connectedTo: [`${id}-0-0`, `${id}-1-1`] },
    { id: `${id}-1-0`, x: 100, y: 200, type: 'waypoint', connectedTo: [`${id}-0-0`, `${id}-1-1`] },
    { id: `${id}-1-1`, x: 200, y: 200, type: 'waypoint', connectedTo: [`${id}-0-1`, `${id}-1-0`] },
  ]

  // Add entrance nodes
  for (const entrance of entrances) {
    nodes.push({
      id: entrance.id,
      x: 0,
      y: 0,
      type: 'entrance',
      connectedTo: [`${id}-0-0`],
      leadsTo: entrance.leadsTo,
    })
    // Connect waypoint to entrance
    const waypoint = nodes.find((n) => n.id === `${id}-0-0`)
    if (waypoint) {
      waypoint.connectedTo.push(entrance.id)
    }
  }

  return {
    id,
    name: `Test ${id}`,
    width: 800,
    height: 600,
    backgroundColor: 0x000000,
    spawnNodeId: `${id}-0-0`,
    nodes,
    obstacles: [],
  }
}

describe('crossMapNavigation', () => {
  describe('buildMapGraph', () => {
    it('should build graph with connections from entrances', () => {
      const maps: Record<string, WorldMap> = {
        mapA: createTestMap('mapA', [
          { id: 'entrance-A-to-B', leadsTo: { mapId: 'mapB', nodeId: 'entrance-B-to-A' } },
        ]),
        mapB: createTestMap('mapB', [
          { id: 'entrance-B-to-A', leadsTo: { mapId: 'mapA', nodeId: 'entrance-A-to-B' } },
        ]),
      }

      const graph = buildMapGraph(maps)

      expect(graph.connections).toHaveLength(2)
      expect(graph.adjacency.get('mapA')).toHaveLength(1)
      expect(graph.adjacency.get('mapB')).toHaveLength(1)
    })

    it('should handle maps without entrances', () => {
      const maps: Record<string, WorldMap> = {
        mapA: createTestMap('mapA', []),
      }

      const graph = buildMapGraph(maps)

      expect(graph.connections).toHaveLength(0)
      expect(graph.adjacency.get('mapA')).toHaveLength(0)
    })

    it('should handle multiple entrances from same map', () => {
      const maps: Record<string, WorldMap> = {
        mapA: createTestMap('mapA', [
          { id: 'entrance-A-to-B', leadsTo: { mapId: 'mapB', nodeId: 'entrance-B-to-A' } },
          { id: 'entrance-A-to-C', leadsTo: { mapId: 'mapC', nodeId: 'entrance-C-to-A' } },
        ]),
        mapB: createTestMap('mapB', [
          { id: 'entrance-B-to-A', leadsTo: { mapId: 'mapA', nodeId: 'entrance-A-to-B' } },
        ]),
        mapC: createTestMap('mapC', [
          { id: 'entrance-C-to-A', leadsTo: { mapId: 'mapA', nodeId: 'entrance-A-to-C' } },
        ]),
      }

      const graph = buildMapGraph(maps)

      expect(graph.adjacency.get('mapA')).toHaveLength(2)
      expect(graph.adjacency.get('mapB')).toHaveLength(1)
      expect(graph.adjacency.get('mapC')).toHaveLength(1)
    })
  })

  describe('findMapSequence', () => {
    it('should return single step for same map', () => {
      const maps: Record<string, WorldMap> = {
        mapA: createTestMap('mapA', []),
      }
      const graph = buildMapGraph(maps)

      const result = findMapSequence(graph, 'mapA', 'mapA')

      expect(result).toHaveLength(1)
      expect(result![0].mapId).toBe('mapA')
    })

    it('should find direct path between connected maps', () => {
      const maps: Record<string, WorldMap> = {
        mapA: createTestMap('mapA', [
          { id: 'entrance-A-to-B', leadsTo: { mapId: 'mapB', nodeId: 'entrance-B-to-A' } },
        ]),
        mapB: createTestMap('mapB', [
          { id: 'entrance-B-to-A', leadsTo: { mapId: 'mapA', nodeId: 'entrance-A-to-B' } },
        ]),
      }
      const graph = buildMapGraph(maps)

      const result = findMapSequence(graph, 'mapA', 'mapB')

      expect(result).toHaveLength(2)
      expect(result![0].mapId).toBe('mapA')
      expect(result![0].exitEntranceId).toBe('entrance-A-to-B')
      expect(result![1].mapId).toBe('mapB')
      expect(result![1].entryEntranceId).toBe('entrance-B-to-A')
    })

    it('should find path through intermediate maps', () => {
      const maps: Record<string, WorldMap> = {
        mapA: createTestMap('mapA', [
          { id: 'entrance-A-to-B', leadsTo: { mapId: 'mapB', nodeId: 'entrance-B-to-A' } },
        ]),
        mapB: createTestMap('mapB', [
          { id: 'entrance-B-to-A', leadsTo: { mapId: 'mapA', nodeId: 'entrance-A-to-B' } },
          { id: 'entrance-B-to-C', leadsTo: { mapId: 'mapC', nodeId: 'entrance-C-to-B' } },
        ]),
        mapC: createTestMap('mapC', [
          { id: 'entrance-C-to-B', leadsTo: { mapId: 'mapB', nodeId: 'entrance-B-to-C' } },
        ]),
      }
      const graph = buildMapGraph(maps)

      const result = findMapSequence(graph, 'mapA', 'mapC')

      expect(result).toHaveLength(3)
      expect(result![0].mapId).toBe('mapA')
      expect(result![1].mapId).toBe('mapB')
      expect(result![2].mapId).toBe('mapC')
    })

    it('should return null for unreachable maps', () => {
      const maps: Record<string, WorldMap> = {
        mapA: createTestMap('mapA', []),
        mapB: createTestMap('mapB', []),
      }
      const graph = buildMapGraph(maps)

      const result = findMapSequence(graph, 'mapA', 'mapB')

      expect(result).toBeNull()
    })
  })

  describe('planCrossMapRoute', () => {
    beforeEach(() => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
    })

    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('should plan route within same map', () => {
      const maps: Record<string, WorldMap> = {
        mapA: createTestMap('mapA', []),
      }

      const result = planCrossMapRoute(maps, 'mapA', 'mapA-0-0', 'mapA', 'mapA-1-1')

      expect(result).not.toBeNull()
      expect(result!.segments).toHaveLength(1)
      expect(result!.segments[0].mapId).toBe('mapA')
      expect(result!.segments[0].path[0]).toBe('mapA-0-0')
      expect(result!.segments[0].path[result!.segments[0].path.length - 1]).toBe('mapA-1-1')
    })

    it('should plan route across two maps', () => {
      const maps: Record<string, WorldMap> = {
        mapA: createTestMap('mapA', [
          { id: 'entrance-A-to-B', leadsTo: { mapId: 'mapB', nodeId: 'entrance-B-to-A' } },
        ]),
        mapB: createTestMap('mapB', [
          { id: 'entrance-B-to-A', leadsTo: { mapId: 'mapA', nodeId: 'entrance-A-to-B' } },
        ]),
      }

      const result = planCrossMapRoute(maps, 'mapA', 'mapA-0-0', 'mapB', 'mapB-1-1')

      expect(result).not.toBeNull()
      expect(result!.segments).toHaveLength(2)
      expect(result!.segments[0].mapId).toBe('mapA')
      expect(result!.segments[1].mapId).toBe('mapB')
    })

    it('should return null for unreachable destination', () => {
      const maps: Record<string, WorldMap> = {
        mapA: createTestMap('mapA', []),
        mapB: createTestMap('mapB', []),
      }

      const result = planCrossMapRoute(maps, 'mapA', 'mapA-0-0', 'mapB', 'mapB-1-1')

      expect(result).toBeNull()
    })

    it('should avoid blocked nodes', () => {
      const maps: Record<string, WorldMap> = {
        mapA: createTestMap('mapA', []),
      }
      const blockedNodes = new Map<string, Set<string>>()
      blockedNodes.set('mapA', new Set(['mapA-0-1'])) // Block direct path

      const result = planCrossMapRoute(
        maps,
        'mapA',
        'mapA-0-0',
        'mapA',
        'mapA-1-1',
        blockedNodes
      )

      expect(result).not.toBeNull()
      expect(result!.segments[0].path).not.toContain('mapA-0-1')
    })
  })

  describe('getSegmentStartNode', () => {
    it('should return the first node of the segment', () => {
      const map: WorldMap = createTestMap('mapA', [])
      const segment: RouteSegment = {
        mapId: 'mapA',
        path: ['mapA-0-0', 'mapA-0-1', 'mapA-1-1'],
      }

      const result = getSegmentStartNode(map, segment)

      expect(result).toBeDefined()
      expect(result!.id).toBe('mapA-0-0')
    })

    it('should return undefined for empty path', () => {
      const map: WorldMap = createTestMap('mapA', [])
      const segment: RouteSegment = {
        mapId: 'mapA',
        path: [],
      }

      const result = getSegmentStartNode(map, segment)

      expect(result).toBeUndefined()
    })
  })

  describe('hasMoreSegments', () => {
    it('should return true when there are more segments', () => {
      const route: CrossMapRoute = {
        segments: [
          { mapId: 'mapA', path: ['a'] },
          { mapId: 'mapB', path: ['b'] },
        ],
      }

      expect(hasMoreSegments(route, 0)).toBe(true)
    })

    it('should return false for last segment', () => {
      const route: CrossMapRoute = {
        segments: [
          { mapId: 'mapA', path: ['a'] },
          { mapId: 'mapB', path: ['b'] },
        ],
      }

      expect(hasMoreSegments(route, 1)).toBe(false)
    })
  })

  describe('getNextSegment', () => {
    it('should return the next segment', () => {
      const route: CrossMapRoute = {
        segments: [
          { mapId: 'mapA', path: ['a'] },
          { mapId: 'mapB', path: ['b'] },
        ],
      }

      const result = getNextSegment(route, 0)

      expect(result).toBeDefined()
      expect(result!.mapId).toBe('mapB')
    })

    it('should return undefined when no more segments', () => {
      const route: CrossMapRoute = {
        segments: [
          { mapId: 'mapA', path: ['a'] },
        ],
      }

      const result = getNextSegment(route, 0)

      expect(result).toBeUndefined()
    })
  })
})
