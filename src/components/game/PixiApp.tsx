'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { Application, Container, Graphics, AnimatedSprite } from 'pixi.js'
import { useGameStore, useCharacterStore, useNavigationStore } from '@/stores'
import { getMaps, loadMaps, getNode, clearMapsCache } from '@/data/maps'
import { findPath } from '@/lib/pathfinding'
import { lerpPosition, getDirection, getDistance, getMovementSpeed } from '@/lib/movement'
import { loadCharacterSpritesheet, getDirectionAnimation, getIdleTexture, type CharacterSpritesheet } from '@/lib/spritesheet'
import { loadGameConfig, parseColor } from '@/lib/gameConfigLoader'
import { hasMoreSegments } from '@/lib/crossMapNavigation'
import { renderNode, renderObstacle, createObstacleLabel, renderEntranceConnections } from '@/lib/pixiRenderers'
import { useCharacterNavigation, setGlobalNavigationAPI } from '@/hooks'
import type { PathNode, Direction, Position, GameConfig, RouteSegment } from '@/types'

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
  const navigations = useNavigationStore((s) => s.navigations)
  const startNavigation = useNavigationStore((s) => s.startNavigation)
  const updateProgress = useNavigationStore((s) => s.updateProgress)
  const advanceToNextNode = useNavigationStore((s) => s.advanceToNextNode)
  const completeNavigation = useNavigationStore((s) => s.completeNavigation)
  const getCrossMapNavigation = useNavigationStore((s) => s.getCrossMapNavigation)
  const advanceCrossMapSegment = useNavigationStore((s) => s.advanceCrossMapSegment)
  const completeCrossMapNavigation = useNavigationStore((s) => s.completeCrossMapNavigation)
  const isCrossMapNavigating = useNavigationStore((s) => s.isCrossMapNavigating)

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

  // External navigation API
  const navigationAPI = useCharacterNavigation()

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

  // Register global navigation API for console testing
  useEffect(() => {
    if (isReady && mapsLoaded) {
      setGlobalNavigationAPI(navigationAPI)
    }
  }, [isReady, mapsLoaded, navigationAPI])

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

  const drawPathLine = useCallback((path: string[], startPosition: Position, mapId?: string) => {
    const app = appRef.current
    if (!app) return

    clearPathLine()

    const map = getMaps()[mapId ?? currentMapIdRef.current]
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

  const startCrossMapSegment = useCallback((characterId: string, segment: RouteSegment, currentPosition: Position): boolean => {
    const map = getMaps()[segment.mapId]
    if (!map) return false

    // Handle single-node segment - return false to indicate caller should handle completion
    if (segment.path.length < 2) {
      console.log(`[CrossMap] Single-node segment in map "${segment.mapId}", needs completion handling`)
      return false
    }

    const firstTargetNode = map.nodes.find(n => n.id === segment.path[1])
    if (!firstTargetNode) return false

    const targetPosition = { x: firstTargetNode.x, y: firstTargetNode.y }
    startNavigation(characterId, segment.path, currentPosition, targetPosition)
    drawPathLine(segment.path, currentPosition, segment.mapId)

    const direction = getDirection(currentPosition, targetPosition)
    updateDirection(characterId, direction)

    console.log(`[CrossMap] Starting segment in map "${segment.mapId}", path: [${segment.path.join(' -> ')}]`)
    return true
  }, [startNavigation, drawPathLine, updateDirection])

  const moveToRandomNode = useCallback(() => {
    const character = activeCharacterRef.current
    const mapId = currentMapIdRef.current
    if (!character || transition.isTransitioning) return

    const nav = getNavigation(character.id)
    if (nav?.isMoving) return

    // Skip if cross-map navigating
    if (isCrossMapNavigating(character.id)) return

    const allMaps = getMaps()
    const map = allMaps[mapId]
    if (!map) return

    const config = configRef.current
    if (!config) return

    // 50% chance of cross-map movement
    const shouldCrossMap = Math.random() < 0.5
    const allMapIds = Object.keys(allMaps)

    if (shouldCrossMap && allMapIds.length > 1) {
      // Select a random different map
      const otherMapIds = allMapIds.filter(id => id !== mapId)
      const randomMapId = otherMapIds[Math.floor(Math.random() * otherMapIds.length)]
      const randomMap = allMaps[randomMapId]

      if (randomMap && randomMap.nodes.length > 0) {
        // Select a random non-entrance node in the target map
        const targetNodes = randomMap.nodes.filter(n => n.type !== 'entrance')
        const randomNode = targetNodes.length > 0
          ? targetNodes[Math.floor(Math.random() * targetNodes.length)]
          : randomMap.nodes[Math.floor(Math.random() * randomMap.nodes.length)]

        console.log(`[RandomMove] Initiating cross-map navigation to ${randomMapId}:${randomNode.id}`)
        navigationAPI.moveToNode(character.id, randomMapId, randomNode.id)
        return
      }
    }

    // Same-map movement (original logic)
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
    isCrossMapNavigating,
    navigationAPI,
  ])

  const scheduleNextMove = useCallback(() => {
    // Skip scheduling if cross-map navigating
    const character = activeCharacterRef.current
    if (character && isCrossMapNavigating(character.id)) {
      return
    }

    clearIdleTimer()
    const config = configRef.current
    if (!config) return
    const { idleTimeMin, idleTimeMax } = config.timing
    const idleTime = idleTimeMin + Math.random() * (idleTimeMax - idleTimeMin)
    idleTimerRef.current = setTimeout(moveToRandomNode, idleTime)
  }, [clearIdleTimer, moveToRandomNode, isCrossMapNavigating])

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

        // Check if we should continue cross-map navigation
        const character = activeCharacterRef.current
        if (character) {
          const crossNav = getCrossMapNavigation(character.id)
          if (crossNav?.isActive) {
            const currentSegment = crossNav.route.segments[crossNav.currentSegmentIndex]
            if (currentSegment) {
              // Get the current position from the entry node
              const currentMap = getMaps()[currentSegment.mapId]
              const entryNode = currentMap?.nodes.find(n => n.id === currentSegment.path[0])
              if (entryNode) {
                const started = startCrossMapSegment(character.id, currentSegment, { x: entryNode.x, y: entryNode.y })
                if (!started) {
                  // Single-node segment - handle completion
                  if (hasMoreSegments(crossNav.route, crossNav.currentSegmentIndex)) {
                    // This shouldn't happen after a transition (entry node should have path)
                    // But handle gracefully by completing navigation
                    console.log(`[CrossMap] Unexpected single-node segment after transition, completing`)
                    completeCrossMapNavigation(character.id)
                  } else {
                    // Final destination reached
                    completeCrossMapNavigation(character.id)
                  }
                }
              }
            }
          }
        }
      }
    }, fadeIntervalMs)
  }, [updateTransitionProgress, endTransition, getCrossMapNavigation, startCrossMapSegment, completeCrossMapNavigation])

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

  // Draw path line when navigation starts (for cross-map navigation initiated via hook)
  const lastDrawnPathRef = useRef<string[] | null>(null)
  const currentNavigation = activeCharacter ? navigations.get(activeCharacter.id) : undefined
  const currentNavPath = currentNavigation?.path

  useEffect(() => {
    const character = activeCharacterRef.current
    if (!isReady || !character || !currentNavigation?.isMoving || !currentNavPath || currentNavPath.length < 2) {
      lastDrawnPathRef.current = null
      return
    }

    // Check if this is a new path we haven't drawn yet
    const pathKey = currentNavPath.join(',')
    const lastPathKey = lastDrawnPathRef.current?.join(',')

    if (pathKey !== lastPathKey) {
      // Draw path line for the new path
      const currentPosition = positionRef.current ?? character.position
      drawPathLine(currentNavPath, currentPosition)
      lastDrawnPathRef.current = currentNavPath
    }
  }, [isReady, currentNavigation?.isMoving, currentNavPath, drawPathLine])

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

      // Check if we're in cross-map navigation mode
      const crossNav = getCrossMapNavigation(characterId)
      if (crossNav?.isActive) {
        const currentSegmentIndex = crossNav.currentSegmentIndex
        const route = crossNav.route

        // If this is an entrance and there are more segments, advance to next segment
        if (finalNode?.type === 'entrance' && finalNode.leadsTo && hasMoreSegments(route, currentSegmentIndex)) {
          console.log(`[CrossMap] Completed segment ${currentSegmentIndex}, transitioning to next map`)
          advanceCrossMapSegment(characterId)
          handleMapTransition(finalNode)
          return
        }

        // If no more segments, we've reached the final destination
        console.log(`[CrossMap] Reached final destination: ${finalNodeId}`)
        completeCrossMapNavigation(characterId)
        scheduleNextMove()
        return
      }

      // Normal navigation (not cross-map)
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
    getCrossMapNavigation,
    advanceCrossMapSegment,
    completeCrossMapNavigation,
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
