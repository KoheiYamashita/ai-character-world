'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { Application, Container, Graphics } from 'pixi.js'
import { useGameStore, useCharacterStore, useNavigationStore } from '@/stores'
import { maps, getNode } from '@/data/maps'
import { findPath } from '@/lib/pathfinding'
import { lerpPosition, getDirection, getDistance, MOVEMENT_SPEED } from '@/lib/movement'
import type { PathNode } from '@/types'

const IDLE_TIME_MIN = 500
const IDLE_TIME_MAX = 1500
const ENTRANCE_PROBABILITY = 0.1
const FADE_STEP = 0.05
const FADE_INTERVAL_MS = 16

export default function PixiApp(): React.ReactNode {
  const containerRef = useRef<HTMLDivElement>(null)
  const appRef = useRef<Application | null>(null)
  const characterGraphicsRef = useRef<Graphics | null>(null)
  const idleTimerRef = useRef<NodeJS.Timeout | null>(null)
  const initializingRef = useRef(false)

  const currentMapId = useGameStore((s) => s.currentMapId)
  const transition = useGameStore((s) => s.transition)
  const startTransition = useGameStore((s) => s.startTransition)
  const updateTransitionProgress = useGameStore((s) => s.updateTransitionProgress)
  const endTransition = useGameStore((s) => s.endTransition)

  const activeCharacter = useCharacterStore((s) => s.getActiveCharacter())
  const updatePosition = useCharacterStore((s) => s.updatePosition)
  const updateDirection = useCharacterStore((s) => s.updateDirection)
  const setCharacterMap = useCharacterStore((s) => s.setCharacterMap)
  const updateCharacter = useCharacterStore((s) => s.updateCharacter)

  const getNavigation = useNavigationStore((s) => s.getNavigation)
  const startNavigation = useNavigationStore((s) => s.startNavigation)
  const updateProgress = useNavigationStore((s) => s.updateProgress)
  const advanceToNextNode = useNavigationStore((s) => s.advanceToNextNode)
  const completeNavigation = useNavigationStore((s) => s.completeNavigation)

  const [isReady, setIsReady] = useState(false)

  const clearIdleTimer = useCallback(() => {
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current)
      idleTimerRef.current = null
    }
  }, [])

  const moveToRandomNode = useCallback(() => {
    if (!activeCharacter || transition.isTransitioning) return

    const nav = getNavigation(activeCharacter.id)
    if (nav?.isMoving) return

    const map = maps[currentMapId]
    if (!map) return

    const shouldGoToEntrance = Math.random() < ENTRANCE_PROBABILITY
    const excludeCurrentNode = (n: PathNode) => n.id !== activeCharacter.currentNodeId
    const isNonEntrance = (n: PathNode) => n.type !== 'entrance'

    let availableNodes = map.nodes.filter(excludeCurrentNode)
    if (!shouldGoToEntrance) {
      const nonEntranceNodes = availableNodes.filter(isNonEntrance)
      if (nonEntranceNodes.length > 0) {
        availableNodes = nonEntranceNodes
      }
    }

    if (availableNodes.length === 0) return

    const randomNode = availableNodes[Math.floor(Math.random() * availableNodes.length)]
    const path = findPath(map, activeCharacter.currentNodeId, randomNode.id)
    if (path.length <= 1) return

    const firstTargetNode = getNode(currentMapId, path[1])
    if (!firstTargetNode) return

    const targetPosition = { x: firstTargetNode.x, y: firstTargetNode.y }
    startNavigation(activeCharacter.id, path, activeCharacter.position, targetPosition)

    const direction = getDirection(activeCharacter.position, targetPosition)
    updateDirection(activeCharacter.id, direction)
  }, [
    activeCharacter,
    currentMapId,
    transition.isTransitioning,
    getNavigation,
    startNavigation,
    updateDirection,
  ])

  const scheduleNextMove = useCallback(() => {
    clearIdleTimer()
    const idleTime = IDLE_TIME_MIN + Math.random() * (IDLE_TIME_MAX - IDLE_TIME_MIN)
    idleTimerRef.current = setTimeout(moveToRandomNode, idleTime)
  }, [clearIdleTimer, moveToRandomNode])

  const handleMapTransition = useCallback((entranceNode: PathNode) => {
    if (!entranceNode.leadsTo || !activeCharacter) return

    const { mapId, nodeId } = entranceNode.leadsTo
    const targetMap = maps[mapId]
    const targetNode = targetMap?.nodes.find((n) => n.id === nodeId)
    if (!targetMap || !targetNode) return

    startTransition(currentMapId, mapId)

    let progress = 0
    const fadeOut = setInterval(() => {
      progress += FADE_STEP
      updateTransitionProgress(progress)

      if (progress >= 1) {
        clearInterval(fadeOut)
        setCharacterMap(activeCharacter.id, mapId, nodeId, { x: targetNode.x, y: targetNode.y })

        let fadeInProgress = 1
        const fadeIn = setInterval(() => {
          fadeInProgress -= FADE_STEP
          updateTransitionProgress(fadeInProgress)

          if (fadeInProgress <= 0) {
            clearInterval(fadeIn)
            endTransition()
          }
        }, FADE_INTERVAL_MS)
      }
    }, FADE_INTERVAL_MS)
  }, [activeCharacter, currentMapId, startTransition, updateTransitionProgress, setCharacterMap, endTransition])

  // Initialize PixiJS application
  useEffect(() => {
    if (!containerRef.current || initializingRef.current || appRef.current) return

    initializingRef.current = true
    const container = containerRef.current
    const app = new Application()

    async function initApp(): Promise<void> {
      try {
        await app.init({
          width: 800,
          height: 600,
          backgroundColor: 0x1a1a2e,
          antialias: true,
        })

        if (container && app.canvas && !appRef.current) {
          while (container.firstChild) {
            container.removeChild(container.firstChild)
          }
          container.appendChild(app.canvas)
          appRef.current = app
          setIsReady(true)
        }
      } catch (error) {
        console.error('Failed to initialize PixiJS:', error)
      } finally {
        initializingRef.current = false
      }
    }

    initApp()

    return () => {
      if (appRef.current) {
        appRef.current.destroy(true)
        appRef.current = null
      }
      clearIdleTimer()
      initializingRef.current = false
      setIsReady(false)
    }
  }, [clearIdleTimer])

  // Render map and character
  useEffect(() => {
    if (!isReady || !appRef.current) return

    const app = appRef.current
    const map = maps[currentMapId]
    if (!map) return

    app.stage.removeChildren()

    // Background
    const bgGraphics = new Graphics()
    bgGraphics.rect(0, 0, map.width, map.height)
    bgGraphics.fill(map.backgroundColor)
    app.stage.addChild(bgGraphics)

    // Nodes container
    const nodesContainer = new Container()
    app.stage.addChild(nodesContainer)

    // Render nodes
    for (const node of map.nodes) {
      const nodeGraphics = new Graphics()
      renderNode(nodeGraphics, node)
      nodesContainer.addChild(nodeGraphics)

      // Draw entrance connections
      if (node.type === 'entrance') {
        renderEntranceConnections(nodesContainer, node, map.nodes)
      }
    }

    // Character
    const charGraphics = new Graphics()
    charGraphics.circle(0, 0, 16)
    charGraphics.fill(0xf39c12)
    charGraphics.circle(0, 0, 16)
    charGraphics.stroke({ color: 0xe67e22, width: 3 })

    if (activeCharacter) {
      charGraphics.x = activeCharacter.position.x
      charGraphics.y = activeCharacter.position.y
    }

    characterGraphicsRef.current = charGraphics
    app.stage.addChild(charGraphics)
  }, [isReady, currentMapId, activeCharacter?.id])

  // Schedule movement when idle
  useEffect(() => {
    if (!isReady || !activeCharacter || transition.isTransitioning) return

    const nav = getNavigation(activeCharacter.id)
    if (!nav?.isMoving) {
      scheduleNextMove()
    }

    return clearIdleTimer
  }, [isReady, activeCharacter?.id, transition.isTransitioning, scheduleNextMove, getNavigation, clearIdleTimer])

  // Movement ticker
  useEffect(() => {
    if (!isReady || !appRef.current || !activeCharacter) return

    const app = appRef.current
    const characterId = activeCharacter.id

    function ticker(time: { deltaMS: number }): void {
      const deltaTime = time.deltaMS / 1000
      const nav = getNavigation(characterId)
      if (!nav?.isMoving || !nav.startPosition || !nav.targetPosition) return

      const distance = getDistance(nav.startPosition, nav.targetPosition)
      const duration = distance / MOVEMENT_SPEED
      const newProgress = Math.min(1, nav.progress + deltaTime / duration)
      const newPosition = lerpPosition(nav.startPosition, nav.targetPosition, newProgress)

      updatePosition(characterId, newPosition)

      if (characterGraphicsRef.current) {
        characterGraphicsRef.current.x = newPosition.x
        characterGraphicsRef.current.y = newPosition.y
      }

      if (newProgress >= 1) {
        handleMovementComplete(nav, newPosition)
      } else {
        updateProgress(characterId, newProgress)
      }
    }

    function handleMovementComplete(
      nav: { path: string[]; currentPathIndex: number },
      newPosition: { x: number; y: number }
    ): void {
      const nextIndex = nav.currentPathIndex + 1
      const isAtFinalNode = nextIndex >= nav.path.length - 1

      if (isAtFinalNode) {
        const finalNodeId = nav.path[nav.path.length - 1]
        const map = maps[currentMapId]
        const finalNode = map?.nodes.find((n) => n.id === finalNodeId)

        updateCharacter(characterId, { currentNodeId: finalNodeId })
        completeNavigation(characterId)

        if (finalNode?.type === 'entrance' && finalNode.leadsTo) {
          handleMapTransition(finalNode)
        } else {
          scheduleNextMove()
        }
      } else {
        const nextNodeId = nav.path[nextIndex + 1]
        const map = maps[currentMapId]
        const nextNode = map?.nodes.find((n) => n.id === nextNodeId)

        if (nextNode) {
          const currentNodeId = nav.path[nextIndex]
          updateCharacter(characterId, { currentNodeId })
          advanceToNextNode(characterId, { x: nextNode.x, y: nextNode.y })

          const direction = getDirection(newPosition, { x: nextNode.x, y: nextNode.y })
          updateDirection(characterId, direction)
        }
      }
    }

    app.ticker.add(ticker)

    return () => {
      appRef.current?.ticker.remove(ticker)
    }
  }, [
    isReady,
    activeCharacter?.id,
    currentMapId,
    scheduleNextMove,
    handleMapTransition,
    getNavigation,
    updatePosition,
    updateProgress,
    updateCharacter,
    completeNavigation,
    advanceToNextNode,
    updateDirection,
  ])

  // Transition overlay
  useEffect(() => {
    if (!isReady || !appRef.current) return

    const app = appRef.current

    if (transition.isTransitioning) {
      const overlay = new Graphics()
      overlay.label = 'transitionOverlay'
      overlay.rect(0, 0, 800, 600)
      overlay.fill({ color: 0x000000, alpha: transition.progress })
      app.stage.addChild(overlay)
    } else {
      const overlay = app.stage.getChildByLabel('transitionOverlay')
      if (overlay) {
        app.stage.removeChild(overlay)
      }
    }
  }, [isReady, transition.isTransitioning, transition.progress])

  return (
    <div
      ref={containerRef}
      className="w-[800px] h-[600px] rounded-lg overflow-hidden shadow-xl bg-slate-800"
    />
  )
}

function renderNode(graphics: Graphics, node: PathNode): void {
  switch (node.type) {
    case 'entrance':
      graphics.circle(node.x, node.y, 8)
      graphics.fill(0xe74c3c)
      graphics.stroke({ color: 0xc0392b, width: 2 })
      break
    case 'spawn':
      graphics.circle(node.x, node.y, 6)
      graphics.fill(0x2ecc71)
      graphics.stroke({ color: 0x27ae60, width: 1 })
      break
    default:
      graphics.circle(node.x, node.y, 4)
      graphics.fill({ color: 0x3498db, alpha: 0.5 })
  }
}

function renderEntranceConnections(
  container: Container,
  entranceNode: PathNode,
  allNodes: PathNode[]
): void {
  for (const connectedId of entranceNode.connectedTo) {
    const connectedNode = allNodes.find((n) => n.id === connectedId)
    if (connectedNode) {
      const lineGraphics = new Graphics()
      lineGraphics.moveTo(entranceNode.x, entranceNode.y)
      lineGraphics.lineTo(connectedNode.x, connectedNode.y)
      lineGraphics.stroke({ color: 0xc0392b, width: 2, alpha: 0.5 })
      container.addChildAt(lineGraphics, 0)
    }
  }
}
