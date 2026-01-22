import { describe, it, expect } from 'vitest'
import { getNodeById, getNodesInPath, findPathAvoidingNodes } from './pathfinding'
import type { WorldMap, PathNode } from '@/types'

// Helper to create a simple test map
function createTestMap(nodes: PathNode[]): WorldMap {
  return {
    id: 'test-map',
    name: 'Test Map',
    width: 800,
    height: 600,
    backgroundColor: 0x000000,
    spawnNodeId: nodes[0]?.id ?? 'node-0-0',
    nodes,
    obstacles: [],
  }
}

// Create a simple 3x3 grid of connected nodes
function create3x3Grid(): PathNode[] {
  const nodes: PathNode[] = []
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      const id = `node-${row}-${col}`
      const connectedTo: string[] = []

      // Connect to adjacent nodes
      if (col > 0) connectedTo.push(`node-${row}-${col - 1}`)
      if (col < 2) connectedTo.push(`node-${row}-${col + 1}`)
      if (row > 0) connectedTo.push(`node-${row - 1}-${col}`)
      if (row < 2) connectedTo.push(`node-${row + 1}-${col}`)

      nodes.push({
        id,
        x: col * 100 + 50,
        y: row * 100 + 50,
        type: 'waypoint',
        connectedTo,
      })
    }
  }
  return nodes
}

describe('pathfinding', () => {
  describe('getNodeById', () => {
    it('should return the node with matching id', () => {
      const nodes = create3x3Grid()
      const map = createTestMap(nodes)

      const result = getNodeById(map, 'node-1-1')

      expect(result).toBeDefined()
      expect(result?.id).toBe('node-1-1')
      expect(result?.x).toBe(150)
      expect(result?.y).toBe(150)
    })

    it('should return undefined for non-existent node', () => {
      const nodes = create3x3Grid()
      const map = createTestMap(nodes)

      const result = getNodeById(map, 'non-existent')

      expect(result).toBeUndefined()
    })

    it('should return undefined for empty map', () => {
      const map = createTestMap([])

      const result = getNodeById(map, 'any-id')

      expect(result).toBeUndefined()
    })
  })

  describe('getNodesInPath', () => {
    it('should return all nodes in the path', () => {
      const nodes = create3x3Grid()
      const map = createTestMap(nodes)
      const path = ['node-0-0', 'node-0-1', 'node-0-2']

      const result = getNodesInPath(map, path)

      expect(result).toHaveLength(3)
      expect(result[0].id).toBe('node-0-0')
      expect(result[1].id).toBe('node-0-1')
      expect(result[2].id).toBe('node-0-2')
    })

    it('should filter out non-existent nodes', () => {
      const nodes = create3x3Grid()
      const map = createTestMap(nodes)
      const path = ['node-0-0', 'non-existent', 'node-0-2']

      const result = getNodesInPath(map, path)

      expect(result).toHaveLength(2)
      expect(result[0].id).toBe('node-0-0')
      expect(result[1].id).toBe('node-0-2')
    })

    it('should return empty array for empty path', () => {
      const nodes = create3x3Grid()
      const map = createTestMap(nodes)

      const result = getNodesInPath(map, [])

      expect(result).toHaveLength(0)
    })
  })

  describe('findPathAvoidingNodes', () => {
    it('should find direct path when start equals end', () => {
      const nodes = create3x3Grid()
      const map = createTestMap(nodes)

      const result = findPathAvoidingNodes(map, 'node-0-0', 'node-0-0', new Set())

      expect(result).toEqual(['node-0-0'])
    })

    it('should find shortest path between adjacent nodes', () => {
      const nodes = create3x3Grid()
      const map = createTestMap(nodes)

      const result = findPathAvoidingNodes(map, 'node-0-0', 'node-0-1', new Set())

      expect(result).toEqual(['node-0-0', 'node-0-1'])
    })

    it('should find path across multiple nodes', () => {
      const nodes = create3x3Grid()
      const map = createTestMap(nodes)

      const result = findPathAvoidingNodes(map, 'node-0-0', 'node-2-2', new Set())

      expect(result.length).toBeGreaterThan(0)
      expect(result[0]).toBe('node-0-0')
      expect(result[result.length - 1]).toBe('node-2-2')
    })

    it('should avoid blocked nodes', () => {
      const nodes = create3x3Grid()
      const map = createTestMap(nodes)
      // Block the center node
      const blocked = new Set(['node-1-1'])

      const result = findPathAvoidingNodes(map, 'node-0-0', 'node-2-2', blocked)

      expect(result.length).toBeGreaterThan(0)
      expect(result).not.toContain('node-1-1')
    })

    it('should return empty array when destination is blocked', () => {
      const nodes = create3x3Grid()
      const map = createTestMap(nodes)
      const blocked = new Set(['node-2-2'])

      const result = findPathAvoidingNodes(map, 'node-0-0', 'node-2-2', blocked)

      expect(result).toEqual([])
    })

    it('should return empty array when no path exists', () => {
      const nodes = create3x3Grid()
      const map = createTestMap(nodes)
      // Block all paths from node-0-0
      const blocked = new Set(['node-0-1', 'node-1-0'])

      const result = findPathAvoidingNodes(map, 'node-0-0', 'node-2-2', blocked)

      expect(result).toEqual([])
    })

    it('should return empty array for non-existent start node', () => {
      const nodes = create3x3Grid()
      const map = createTestMap(nodes)

      const result = findPathAvoidingNodes(map, 'non-existent', 'node-2-2', new Set())

      expect(result).toEqual([])
    })

    it('should return empty array for non-existent end node', () => {
      const nodes = create3x3Grid()
      const map = createTestMap(nodes)

      const result = findPathAvoidingNodes(map, 'node-0-0', 'non-existent', new Set())

      expect(result).toEqual([])
    })

    it('should find alternative path around blocked nodes', () => {
      const nodes = create3x3Grid()
      const map = createTestMap(nodes)
      // Block middle column
      const blocked = new Set(['node-0-1', 'node-1-1', 'node-2-1'])

      const result = findPathAvoidingNodes(map, 'node-0-0', 'node-0-2', blocked)

      // No path should exist as the grid is divided
      expect(result).toEqual([])
    })
  })
})
