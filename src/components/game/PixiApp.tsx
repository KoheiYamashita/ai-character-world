'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { Application, Container, Graphics, AnimatedSprite, Text, TextStyle } from 'pixi.js'
import { useGameStore, useCharacterStore, useNavigationStore } from '@/stores'
import { getMaps, loadMaps, getNode, clearMapsCache } from '@/data/maps'
import { findPath } from '@/lib/pathfinding'
import { lerpPosition, getDirection, getDistance, getMovementSpeed } from '@/lib/movement'
import { loadCharacterSpritesheet, getDirectionAnimation, getIdleTexture, type CharacterSpritesheet } from '@/lib/spritesheet'
import { loadGameConfig, parseColor, getObstacleTheme } from '@/lib/gameConfigLoader'
import type { PathNode, Direction, Position, GameConfig, Obstacle, WallSide, ObstacleTheme } from '@/types'

interface ActiveNavigation {
  path: string[]
  currentPathIndex: number
  startPosition: Position
  targetPosition: Position
}

export default function PixiApp(): React.ReactNode {
  // Store selectors
  const currentMapId = useGameStore((s) => s.currentMapId)
  const transition = useGameStore((s) => s.transition)
  const startTransition = useGameStore((s) => s.startTransition)
  const updateTransitionProgress = useGameStore((s) => s.updateTransitionProgress)
  const endTransition = useGameStore((s) => s.endTransition)
  const setCurrentMap = useGameStore((s) => s.setCurrentMap)
  const setTime = useGameStore((s) => s.setTime)
  const setStoreMapsLoaded = useGameStore((s) => s.setMapsLoaded)

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

  // PixiJS refs
  const containerRef = useRef<HTMLDivElement>(null)
  const appRef = useRef<Application | null>(null)
  const characterSpriteRef = useRef<AnimatedSprite | null>(null)
  const spritesheetRef = useRef<CharacterSpritesheet | null>(null)
  const transitionOverlayRef = useRef<Graphics | null>(null)
  const pathLineRef = useRef<Graphics | null>(null)

  // Timer refs
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fadeOutIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const fadeInIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // State refs (avoid stale closures in callbacks)
  const initializingRef = useRef(false)
  const currentDirectionRef = useRef<Direction>('down')
  const positionRef = useRef<Position | null>(null)
  const activeCharacterRef = useRef(activeCharacter)
  const currentMapIdRef = useRef(currentMapId)

  // Component state
  const [isReady, setIsReady] = useState(false)
  const [spritesheetLoaded, setSpritesheetLoaded] = useState(false)
  const [mapsLoaded, setMapsLoaded] = useState(false)
  const [canvasSize, setCanvasSize] = useState({ width: 800, height: 600 })

  // Config ref to avoid stale closures (initialized after config loads)
  const configRef = useRef<GameConfig | null>(null)

  // Sync refs with latest values
  useEffect(() => {
    activeCharacterRef.current = activeCharacter
    if (activeCharacter) {
      positionRef.current = activeCharacter.position
    }
  }, [activeCharacter])

  useEffect(() => {
    currentMapIdRef.current = currentMapId
  }, [currentMapId])

  // Load config first, then maps (sequential to ensure config paths are used)
  useEffect(() => {
    let cancelled = false

    async function loadData() {
      try {
        // Check if already loaded (prevents re-applying initialState on remount)
        const alreadyLoaded = useGameStore.getState().mapsLoaded
        if (alreadyLoaded) {
          // Still need to set local state and configRef for this component instance
          const config = await loadGameConfig()
          if (cancelled) return
          configRef.current = config
          // Ensure maps are loaded in cache (may have been cleared by hot reload)
          const loadedMaps = await loadMaps()
          if (cancelled) return
          const currentMap = loadedMaps[useGameStore.getState().currentMapId]
          if (currentMap) {
            setCanvasSize({ width: currentMap.width, height: currentMap.height })
          }
          setMapsLoaded(true)
          return
        }

        // First load: clear cache to ensure fresh data
        clearMapsCache()

        // Load config first so mapLoader can use config.paths
        const config = await loadGameConfig()
        if (cancelled) return

        configRef.current = config

        // Now load maps (will use config.paths.mapsJson)
        const loadedMaps = await loadMaps()
        if (cancelled) return

        const mapId = config.initialState.mapId
        const initialMap = loadedMaps[mapId]

        // Apply initialState from config to stores (only on first load)
        setCurrentMap(mapId)
        setTime(config.initialState.time)

        // Sync character to spawn node of initial map
        if (initialMap) {
          const spawnNode = initialMap.nodes.find((n) => n.id === initialMap.spawnNodeId)
          if (spawnNode) {
            const activeChar = useCharacterStore.getState().getActiveCharacter()
            if (activeChar) {
              setCharacterMap(activeChar.id, mapId, spawnNode.id, { x: spawnNode.x, y: spawnNode.y })
            }
          }
          setCanvasSize({ width: initialMap.width, height: initialMap.height })
        } else {
          setCanvasSize({ width: config.canvas.defaultWidth, height: config.canvas.defaultHeight })
        }

        setMapsLoaded(true)
        setStoreMapsLoaded(true)
      } catch (error) {
        console.error('Failed to load config/maps:', error)
      }
    }

    loadData()

    return () => {
      cancelled = true
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const clearIdleTimer = useCallback(() => {
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current)
      idleTimerRef.current = null
    }
  }, [])

  const clearTransitionIntervals = useCallback(() => {
    if (fadeOutIntervalRef.current) {
      clearInterval(fadeOutIntervalRef.current)
      fadeOutIntervalRef.current = null
    }
    if (fadeInIntervalRef.current) {
      clearInterval(fadeInIntervalRef.current)
      fadeInIntervalRef.current = null
    }
  }, [])

  const clearPathLine = useCallback(() => {
    if (!pathLineRef.current) return

    // Safe removal: only removeChild if still attached to a parent
    if (pathLineRef.current.parent) {
      pathLineRef.current.parent.removeChild(pathLineRef.current)
    }
    pathLineRef.current.destroy()
    pathLineRef.current = null
  }, [])

  const drawPathLine = useCallback((path: string[], startPosition: Position) => {
    const app = appRef.current
    if (!app) return

    clearPathLine()

    const map = getMaps()[currentMapIdRef.current]
    if (!map || path.length < 2) return

    const pathLine = new Graphics()
    pathLine.label = 'pathLine'
    pathLine.moveTo(startPosition.x, startPosition.y)

    for (let i = 1; i < path.length; i++) {
      const node = map.nodes.find((n) => n.id === path[i])
      if (node) {
        pathLine.lineTo(node.x, node.y)
      }
    }

    pathLine.stroke({ color: 0xffffff, width: 2, alpha: 0.7 })
    app.stage.addChild(pathLine)
    pathLineRef.current = pathLine
  }, [clearPathLine])

  const moveToRandomNode = useCallback(() => {
    const character = activeCharacterRef.current
    const mapId = currentMapIdRef.current
    if (!character || transition.isTransitioning) return

    const nav = getNavigation(character.id)
    if (nav?.isMoving) return

    const map = getMaps()[mapId]
    if (!map) return

    const config = configRef.current
    if (!config) return

    const shouldGoToEntrance = Math.random() < config.movement.entranceProbability
    const otherNodes = map.nodes.filter((n) => n.id !== character.currentNodeId)
    const nonEntranceNodes = otherNodes.filter((n) => n.type !== 'entrance')

    // Prefer non-entrance nodes unless we're going to an entrance or there are none
    const availableNodes = shouldGoToEntrance || nonEntranceNodes.length === 0
      ? otherNodes
      : nonEntranceNodes

    if (availableNodes.length === 0) return

    const randomNode = availableNodes[Math.floor(Math.random() * availableNodes.length)]
    const path = findPath(map, character.currentNodeId, randomNode.id)
    if (path.length <= 1) return

    const firstTargetNode = getNode(mapId, path[1])
    if (!firstTargetNode) return

    const currentPosition = positionRef.current ?? character.position
    const targetPosition = { x: firstTargetNode.x, y: firstTargetNode.y }
    startNavigation(character.id, path, currentPosition, targetPosition)
    drawPathLine(path, currentPosition)

    const direction = getDirection(currentPosition, targetPosition)
    updateDirection(character.id, direction)
  }, [
    transition.isTransitioning,
    getNavigation,
    startNavigation,
    updateDirection,
    drawPathLine,
  ])

  const scheduleNextMove = useCallback(() => {
    clearIdleTimer()
    const config = configRef.current
    if (!config) return
    const { idleTimeMin, idleTimeMax } = config.timing
    const idleTime = idleTimeMin + Math.random() * (idleTimeMax - idleTimeMin)
    idleTimerRef.current = setTimeout(moveToRandomNode, idleTime)
  }, [clearIdleTimer, moveToRandomNode])

  const startFadeIn = useCallback(() => {
    const config = configRef.current
    if (!config) return
    let progress = 1
    const { fadeStep, fadeIntervalMs } = config.timing
    fadeInIntervalRef.current = setInterval(() => {
      progress -= fadeStep
      updateTransitionProgress(progress)

      if (progress <= 0) {
        if (fadeInIntervalRef.current) {
          clearInterval(fadeInIntervalRef.current)
          fadeInIntervalRef.current = null
        }
        endTransition()
      }
    }, fadeIntervalMs)
  }, [updateTransitionProgress, endTransition])

  const handleMapTransition = useCallback((entranceNode: PathNode) => {
    const character = activeCharacterRef.current
    if (!entranceNode.leadsTo || !character) return

    const { mapId, nodeId } = entranceNode.leadsTo
    const targetMap = getMaps()[mapId]
    const targetNode = targetMap?.nodes.find((n) => n.id === nodeId)
    if (!targetMap || !targetNode) return

    clearTransitionIntervals()
    startTransition(currentMapIdRef.current, mapId)

    const config = configRef.current
    if (!config) return
    const { fadeStep, fadeIntervalMs } = config.timing
    let progress = 0
    fadeOutIntervalRef.current = setInterval(() => {
      progress += fadeStep
      updateTransitionProgress(progress)

      if (progress >= 1) {
        if (fadeOutIntervalRef.current) {
          clearInterval(fadeOutIntervalRef.current)
          fadeOutIntervalRef.current = null
        }
        setCharacterMap(character.id, mapId, nodeId, { x: targetNode.x, y: targetNode.y })
        startFadeIn()
      }
    }, fadeIntervalMs)
  }, [clearTransitionIntervals, startTransition, updateTransitionProgress, setCharacterMap, startFadeIn])

  // Initialize PixiJS (wait for maps to load first)
  useEffect(() => {
    const config = configRef.current
    if (!containerRef.current || initializingRef.current || appRef.current || !mapsLoaded || !config) return

    initializingRef.current = true
    const container = containerRef.current
    const app = new Application()
    const bgColor = parseColor(config.canvas.backgroundColor)

    async function initApp(): Promise<void> {
      try {
        await app.init({
          width: canvasSize.width,
          height: canvasSize.height,
          backgroundColor: bgColor,
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
      clearTransitionIntervals()
      initializingRef.current = false
      setIsReady(false)
    }
  }, [mapsLoaded, clearIdleTimer, clearTransitionIntervals])

  // Update canvas size when map changes
  useEffect(() => {
    if (!mapsLoaded) return

    const map = getMaps()[currentMapId]
    if (map) {
      setCanvasSize({ width: map.width, height: map.height })
    }
  }, [currentMapId, mapsLoaded])

  // Resize canvas when map size changes
  useEffect(() => {
    if (!appRef.current || !isReady) return

    const app = appRef.current
    app.renderer.resize(canvasSize.width, canvasSize.height)
  }, [canvasSize.width, canvasSize.height, isReady])

  // Load spritesheet (deps use ?.id to avoid re-renders on position updates)
  const spriteSheetUrl = activeCharacter?.sprite.sheetUrl
  useEffect(() => {
    if (!activeCharacter || !spriteSheetUrl) return

    const spriteConfig = activeCharacter.sprite
    setSpritesheetLoaded(false)

    async function loadSprite(): Promise<void> {
      try {
        const charSpritesheet = await loadCharacterSpritesheet(spriteConfig)
        spritesheetRef.current = charSpritesheet
        setSpritesheetLoaded(true)
      } catch (error) {
        console.error('Failed to load character spritesheet:', error)
      }
    }

    loadSprite()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCharacter?.id, spriteSheetUrl])

  // Render map and character
  useEffect(() => {
    if (!isReady || !appRef.current) return

    const app = appRef.current
    const map = getMaps()[currentMapId]
    if (!map) return

    app.stage.removeChildren()

    // Get config early
    const config = configRef.current
    if (!config) return

    // Background
    const bgGraphics = new Graphics()
    bgGraphics.rect(0, 0, map.width, map.height)
    bgGraphics.fill(map.backgroundColor)
    app.stage.addChild(bgGraphics)

    // Obstacles container (rendered above background, below nodes)
    const obstaclesContainer = new Container()
    app.stage.addChild(obstaclesContainer)

    // Render obstacles with labels
    for (const obstacle of map.obstacles) {
      const obstacleContainer = new Container()
      const obstacleGraphics = new Graphics()
      renderObstacle(obstacleGraphics, obstacle, config)
      obstacleContainer.addChild(obstacleGraphics)

      // Add label text if obstacle has a label
      if (obstacle.label) {
        const labelText = createObstacleLabel(obstacle, config)
        obstacleContainer.addChild(labelText)
      }

      obstaclesContainer.addChild(obstacleContainer)
    }

    // Nodes container
    const nodesContainer = new Container()
    app.stage.addChild(nodesContainer)

    for (const node of map.nodes) {
      // All nodes from generateGridNodes are valid - no filtering needed here
      // (zone wall nodes are already excluded at generation time in grid.ts)
      const nodeGraphics = new Graphics()
      renderNode(nodeGraphics, node, config)
      nodesContainer.addChild(nodeGraphics)

      // Draw entrance connections
      if (node.type === 'entrance') {
        renderEntranceConnections(nodesContainer, node, map.nodes, config)
      }
    }

    // Character - use AnimatedSprite if spritesheet is loaded, otherwise fallback to Graphics
    if (spritesheetRef.current && activeCharacter) {
      const direction = activeCharacter.direction
      const textures = getDirectionAnimation(spritesheetRef.current, direction)
      const charSprite = new AnimatedSprite(textures)
      charSprite.anchor.set(0.5, 0.5)
      charSprite.scale.set(config.character.scale)
      charSprite.animationSpeed = config.character.animationSpeed
      charSprite.x = activeCharacter.position.x
      charSprite.y = activeCharacter.position.y
      currentDirectionRef.current = direction

      characterSpriteRef.current = charSprite
      app.stage.addChild(charSprite)
    } else if (activeCharacter) {
      // Fallback to circle while loading
      const fallback = config.theme.characterFallback
      const charGraphics = new Graphics()
      charGraphics.circle(0, 0, fallback.radius)
      charGraphics.fill(parseColor(fallback.fill))
      charGraphics.stroke({ color: parseColor(fallback.stroke), width: fallback.strokeWidth })
      charGraphics.x = activeCharacter.position.x
      charGraphics.y = activeCharacter.position.y
      app.stage.addChild(charGraphics)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady, currentMapId, activeCharacter?.id, spritesheetLoaded, mapsLoaded])

  // Schedule movement when idle
  useEffect(() => {
    const character = activeCharacterRef.current
    if (!isReady || !character || transition.isTransitioning) return

    const nav = getNavigation(character.id)
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

    function updateSpriteAnimation(direction: Direction, isMoving: boolean): void {
      const sprite = characterSpriteRef.current
      const spritesheet = spritesheetRef.current
      if (!sprite || !spritesheet) return

      if (direction !== currentDirectionRef.current) {
        const textures = getDirectionAnimation(spritesheet, direction)
        sprite.textures = textures
        currentDirectionRef.current = direction
      }

      if (isMoving && !sprite.playing) {
        sprite.play()
      } else if (!isMoving && sprite.playing) {
        sprite.stop()
        sprite.texture = getIdleTexture(spritesheet, direction)
      }
    }

    function ticker(time: { deltaMS: number }): void {
      const deltaTime = time.deltaMS / 1000
      const nav = getNavigation(characterId)
      const character = activeCharacterRef.current

      if (characterSpriteRef.current && character && !nav?.isMoving) {
        updateSpriteAnimation(character.direction, false)
      }

      if (!nav?.isMoving || !nav.startPosition || !nav.targetPosition) return

      const distance = getDistance(nav.startPosition, nav.targetPosition)
      const duration = distance / getMovementSpeed()
      const newProgress = Math.min(1, nav.progress + deltaTime / duration)
      const newPosition = lerpPosition(nav.startPosition, nav.targetPosition, newProgress)

      positionRef.current = newPosition

      if (characterSpriteRef.current) {
        characterSpriteRef.current.x = newPosition.x
        characterSpriteRef.current.y = newPosition.y
        updateSpriteAnimation(getDirection(nav.startPosition, nav.targetPosition), true)
      }

      if (newProgress < 1) {
        updateProgress(characterId, newProgress)
        return
      }

      const activeNav: ActiveNavigation = {
        path: nav.path,
        currentPathIndex: nav.currentPathIndex,
        startPosition: nav.startPosition,
        targetPosition: nav.targetPosition,
      }
      const nextIndex = nav.currentPathIndex + 1

      if (nextIndex >= nav.path.length - 1) {
        handleArrivalAtDestination(activeNav)
      } else {
        handleContinueToNextNode(activeNav, nextIndex, newPosition)
      }
    }

    function handleArrivalAtDestination(nav: ActiveNavigation): void {
      const finalNodeId = nav.path[nav.path.length - 1]
      const map = getMaps()[currentMapIdRef.current]
      const finalNode = map?.nodes.find((n) => n.id === finalNodeId)
      const finalDirection = getDirection(nav.startPosition, nav.targetPosition)

      updatePosition(characterId, nav.targetPosition)
      updateDirection(characterId, finalDirection)
      updateCharacter(characterId, { currentNodeId: finalNodeId })
      completeNavigation(characterId)
      clearPathLine()

      if (characterSpriteRef.current && spritesheetRef.current) {
        characterSpriteRef.current.stop()
        characterSpriteRef.current.texture = getIdleTexture(spritesheetRef.current, finalDirection)
      }

      if (finalNode?.type === 'entrance' && finalNode.leadsTo) {
        handleMapTransition(finalNode)
      } else {
        scheduleNextMove()
      }
    }

    function handleContinueToNextNode(nav: ActiveNavigation, nextIndex: number, newPosition: Position): void {
      const nextNodeId = nav.path[nextIndex + 1]
      const map = getMaps()[currentMapIdRef.current]
      const nextNode = map?.nodes.find((n) => n.id === nextNodeId)
      if (!nextNode) return

      const currentNodeId = nav.path[nextIndex]
      const nextPosition: Position = { x: nextNode.x, y: nextNode.y }

      updatePosition(characterId, newPosition)
      updateCharacter(characterId, { currentNodeId })
      advanceToNextNode(characterId, nextPosition)
      updateDirection(characterId, getDirection(newPosition, nextPosition))
    }

    app.ticker.add(ticker)

    return () => {
      appRef.current?.ticker.remove(ticker)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isReady,
    activeCharacter?.id,
    scheduleNextMove,
    handleMapTransition,
    getNavigation,
    updatePosition,
    updateProgress,
    updateCharacter,
    completeNavigation,
    advanceToNextNode,
    updateDirection,
    clearPathLine,
  ])

  // Transition overlay
  useEffect(() => {
    if (!isReady || !appRef.current) return

    const app = appRef.current

    if (transition.isTransitioning) {
      if (!transitionOverlayRef.current) {
        transitionOverlayRef.current = new Graphics()
        transitionOverlayRef.current.label = 'transitionOverlay'
        app.stage.addChild(transitionOverlayRef.current)
      }

      const overlay = transitionOverlayRef.current
      const currentMap = getMaps()[currentMapId]
      const config = configRef.current
      overlay.clear()
      overlay.rect(0, 0, currentMap?.width ?? canvasSize.width, currentMap?.height ?? canvasSize.height)
      overlay.fill({ color: config ? parseColor(config.theme.transition.overlayColor) : 0x000000, alpha: transition.progress })
    } else if (transitionOverlayRef.current) {
      app.stage.removeChild(transitionOverlayRef.current)
      transitionOverlayRef.current.destroy()
      transitionOverlayRef.current = null
    }
  }, [isReady, currentMapId, canvasSize, transition.isTransitioning, transition.progress])

  return (
    <div
      ref={containerRef}
      className="rounded-lg overflow-hidden shadow-xl bg-slate-800"
      style={{ width: canvasSize.width, height: canvasSize.height }}
    />
  )
}

function getNodeTheme(nodeType: string, nodes: GameConfig['theme']['nodes']) {
  switch (nodeType) {
    case 'entrance':
      return nodes.entrance
    case 'spawn':
      return nodes.spawn
    default:
      return nodes.waypoint
  }
}

function renderNode(graphics: Graphics, node: PathNode, config: GameConfig): void {
  const theme = getNodeTheme(node.type, config.theme.nodes)
  const alpha = 'alpha' in theme ? theme.alpha : 1

  graphics.circle(node.x, node.y, theme.radius)
  graphics.fill({ color: parseColor(theme.fill), alpha })

  if ('stroke' in theme && theme.stroke) {
    graphics.stroke({ color: parseColor(theme.stroke), width: theme.strokeWidth ?? 1 })
  }
}

function renderObstacle(graphics: Graphics, obstacle: Obstacle, config: GameConfig): void {
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
 * シンプルなルール:
 * - 壁はノード位置に描画（半タイル外側にoutset）
 * - ドア位置は1-indexed（角=1）
 * - start〜endの間は壁を描画しない（開口部）
 */
function renderZoneObstacle(graphics: Graphics, obstacle: Obstacle, theme: ObstacleTheme): void {
  const { x, y, width, height, wallSides, door, tileWidth, tileHeight } = obstacle

  // Fill background (if any)
  graphics.rect(x, y, width, height)
  graphics.fill({ color: parseColor(theme.fill), alpha: theme.alpha })

  if (!wallSides || wallSides.length === 0) return

  const strokeColor = parseColor(theme.stroke)
  const strokeWidth = theme.strokeWidth
  const tileSizeX = width / tileWidth
  const tileSizeY = height / tileHeight

  // 壁はノード位置に描画するため、半タイル外側にoutset
  const outsetX = tileSizeX / 2
  const outsetY = tileSizeY / 2

  for (const side of wallSides) {
    drawWallSide(graphics, side, x, y, width, height, tileSizeX, tileSizeY, outsetX, outsetY, tileWidth, tileHeight, door, strokeColor, strokeWidth)
  }
}

/**
 * 壁の描画
 *
 * - 壁はノード位置に描画（outsetで外側に配置）
 * - ドア: 1-indexed（角=1）、start〜endの間が開口部
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
  outsetX: number,
  outsetY: number,
  tileWidth: number,
  tileHeight: number,
  door: Obstacle['door'],
  strokeColor: number,
  strokeWidth: number
): void {
  // 壁の始点・終点（ノード位置 = zone境界 + outset）
  let wallStartX: number, wallStartY: number, wallEndX: number, wallEndY: number
  let tileCount: number
  let tileSize: number
  let isHorizontal: boolean

  switch (side) {
    case 'top':
      wallStartX = x - outsetX
      wallStartY = y - outsetY
      wallEndX = x + width + outsetX
      wallEndY = y - outsetY
      tileCount = tileWidth + 1  // outsetで+1
      tileSize = tileSizeX
      isHorizontal = true
      break
    case 'bottom':
      wallStartX = x - outsetX
      wallStartY = y + height + outsetY
      wallEndX = x + width + outsetX
      wallEndY = y + height + outsetY
      tileCount = tileWidth + 1
      tileSize = tileSizeX
      isHorizontal = true
      break
    case 'left':
      wallStartX = x - outsetX
      wallStartY = y - outsetY
      wallEndX = x - outsetX
      wallEndY = y + height + outsetY
      tileCount = tileHeight + 1
      tileSize = tileSizeY
      isHorizontal = false
      break
    case 'right':
      wallStartX = x + width + outsetX
      wallStartY = y - outsetY
      wallEndX = x + width + outsetX
      wallEndY = y + height + outsetY
      tileCount = tileHeight + 1
      tileSize = tileSizeY
      isHorizontal = false
      break
  }

  if (door && door.side === side) {
    // ドアあり: 2つのセグメントに分けて描画
    // 1-indexed: 位置1〜start（壁）、start+1〜end-1（開口部）、end〜最後（壁）
    const doorStartPos = door.start * tileSize  // 位置startまで壁
    const doorEndPos = door.end * tileSize      // 位置endから壁

    // セグメント1: 始点〜位置start
    if (door.start >= 1) {
      if (isHorizontal) {
        graphics.moveTo(wallStartX, wallStartY)
        graphics.lineTo(wallStartX + doorStartPos, wallStartY)
      } else {
        graphics.moveTo(wallStartX, wallStartY)
        graphics.lineTo(wallStartX, wallStartY + doorStartPos)
      }
      graphics.stroke({ color: strokeColor, width: strokeWidth })
    }

    // セグメント2: 位置end〜終点
    if (door.end <= tileCount) {
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

function createObstacleLabel(obstacle: Obstacle, config: GameConfig): Text {
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

function renderEntranceConnections(
  container: Container,
  entranceNode: PathNode,
  allNodes: PathNode[],
  config: GameConfig
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
