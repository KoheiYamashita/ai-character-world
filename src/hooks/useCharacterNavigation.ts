import { useCallback, useMemo } from 'react'
import { useCharacterStore, useNavigationStore } from '@/stores'
import { getMaps, isMapsLoaded } from '@/data/maps'
import { planCrossMapRoute } from '@/lib/crossMapNavigation'
import { findPath } from '@/lib/pathfinding'
import { getDirection } from '@/lib/movement'
import type { CrossMapNavigationResult, Position } from '@/types'

interface CharacterNavigationAPI {
  moveToNode: (characterId: string, targetMapId: string, targetNodeId: string) => Promise<CrossMapNavigationResult>
  cancelNavigation: (characterId: string) => void
}

export function useCharacterNavigation(): CharacterNavigationAPI {
  const getCharacter = useCharacterStore((s) => s.getCharacter)
  const updateDirection = useCharacterStore((s) => s.updateDirection)
  const startNavigation = useNavigationStore((s) => s.startNavigation)
  const cancelNavigation = useNavigationStore((s) => s.cancelNavigation)
  const startCrossMapNavigation = useNavigationStore((s) => s.startCrossMapNavigation)
  const cancelCrossMapNavigation = useNavigationStore((s) => s.cancelCrossMapNavigation)
  const isCrossMapNavigating = useNavigationStore((s) => s.isCrossMapNavigating)
  const isMoving = useNavigationStore((s) => s.isMoving)

  const moveToNode = useCallback(async (
    characterId: string,
    targetMapId: string,
    targetNodeId: string
  ): Promise<CrossMapNavigationResult> => {
    // Validate inputs
    if (!isMapsLoaded()) {
      return { success: false, error: 'Maps not loaded' }
    }

    const character = getCharacter(characterId)
    if (!character) {
      return { success: false, error: `Character "${characterId}" not found` }
    }

    // Cancel any existing navigation
    if (isMoving(characterId)) {
      cancelNavigation(characterId)
    }
    if (isCrossMapNavigating(characterId)) {
      cancelCrossMapNavigation(characterId)
    }

    const maps = getMaps()
    const targetMap = maps[targetMapId]
    if (!targetMap) {
      return { success: false, error: `Target map "${targetMapId}" not found` }
    }

    const targetNode = targetMap.nodes.find(n => n.id === targetNodeId)
    if (!targetNode) {
      return { success: false, error: `Target node "${targetNodeId}" not found in map "${targetMapId}"` }
    }

    const currentMapId = character.currentMapId
    const currentNodeId = character.currentNodeId

    // Check if target is in the same map
    if (currentMapId === targetMapId) {
      // Same-map navigation
      const currentMap = maps[currentMapId]
      if (!currentMap) {
        return { success: false, error: `Current map "${currentMapId}" not found` }
      }

      const path = findPath(currentMap, currentNodeId, targetNodeId)
      if (path.length === 0) {
        return { success: false, error: `No path found from "${currentNodeId}" to "${targetNodeId}"` }
      }

      if (path.length === 1) {
        // Already at destination
        return { success: true }
      }

      // Start same-map navigation
      return new Promise((resolve) => {
        const firstTargetNode = currentMap.nodes.find(n => n.id === path[1])
        if (!firstTargetNode) {
          resolve({ success: false, error: 'Path node not found' })
          return
        }

        const currentPosition: Position = character.position
        const targetPosition: Position = { x: firstTargetNode.x, y: firstTargetNode.y }

        startNavigation(characterId, path, currentPosition, targetPosition)
        updateDirection(characterId, getDirection(currentPosition, targetPosition))

        console.log(`[Navigation] Starting same-map navigation to "${targetNodeId}"`)

        // For same-map navigation, we need a different mechanism to track completion
        // Since this is a simpler case, we'll use the cross-map mechanism with a single segment
        const route = {
          segments: [{
            mapId: currentMapId,
            path,
          }]
        }
        startCrossMapNavigation(characterId, targetMapId, targetNodeId, route, resolve)
      })
    }

    // Cross-map navigation
    const route = planCrossMapRoute(maps, currentMapId, currentNodeId, targetMapId, targetNodeId)
    if (!route) {
      return { success: false, error: `No cross-map route found from "${currentMapId}:${currentNodeId}" to "${targetMapId}:${targetNodeId}"` }
    }

    console.log(`[Navigation] Starting cross-map navigation to "${targetMapId}:${targetNodeId}"`)
    console.log(`[Navigation] Route has ${route.segments.length} segment(s)`)

    return new Promise((resolve) => {
      // Store the route and start the first segment
      startCrossMapNavigation(characterId, targetMapId, targetNodeId, route, resolve)

      // Start the first segment
      const firstSegment = route.segments[0]
      if (!firstSegment) {
        // No segments - shouldn't happen but handle gracefully
        resolve({ success: false, error: 'No segments in route' })
        return
      }

      // Handle single-node segment (already at segment destination)
      if (firstSegment.path.length <= 1) {
        console.log(`[Navigation] First segment has single node, skipping to completion check`)
        // The segment completion will be handled by PixiApp when it checks crossMapNav
        // For now, we don't start navigation - PixiApp will handle advancing/completing
        return
      }

      const currentMap = maps[firstSegment.mapId]
      const firstTargetNode = currentMap?.nodes.find(n => n.id === firstSegment.path[1])

      if (firstTargetNode) {
        const currentPosition: Position = character.position
        const targetPosition: Position = { x: firstTargetNode.x, y: firstTargetNode.y }

        startNavigation(characterId, firstSegment.path, currentPosition, targetPosition)
        updateDirection(characterId, getDirection(currentPosition, targetPosition))
      }
    })
  }, [
    getCharacter,
    updateDirection,
    startNavigation,
    cancelNavigation,
    startCrossMapNavigation,
    cancelCrossMapNavigation,
    isCrossMapNavigating,
    isMoving,
  ])

  const cancel = useCallback((characterId: string) => {
    cancelNavigation(characterId)
    cancelCrossMapNavigation(characterId)
  }, [cancelNavigation, cancelCrossMapNavigation])

  return useMemo(() => ({
    moveToNode,
    cancelNavigation: cancel,
  }), [moveToNode, cancel])
}

// Global API for browser console access
let globalAPI: CharacterNavigationAPI | null = null

export function setGlobalNavigationAPI(api: CharacterNavigationAPI): void {
  globalAPI = api

  // Expose to window for console testing
  if (typeof window !== 'undefined') {
    (window as unknown as Record<string, unknown>).moveToNode = api.moveToNode
    ;(window as unknown as Record<string, unknown>).cancelNavigation = api.cancelNavigation
    console.log('[Navigation] Global API registered. Use window.moveToNode(characterId, mapId, nodeId) to navigate.')
  }
}

export function getGlobalNavigationAPI(): CharacterNavigationAPI | null {
  return globalAPI
}
