'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { Application, Container, Graphics, AnimatedSprite } from 'pixi.js'
import { useGameStore, useCharacterStore, useNavigationStore } from '@/stores'
import { getMaps, loadMaps, getNode } from '@/data/maps'
import { findPath } from '@/lib/pathfinding'
import { lerpPosition, getDirection, getDistance, getMovementSpeed } from '@/lib/movement'
import { loadCharacterSpritesheet, getDirectionAnimation, getIdleTexture, type CharacterSpritesheet } from '@/lib/spritesheet'
import { loadGameConfig, parseColor } from '@/lib/gameConfigLoader'
import type { PathNode, Direction, Position, GameConfig } from '@/types'

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
          configRef.current = config
          setMapsLoaded(true)
          return
        }

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

    const direction = getDirection(currentPosition, targetPosition)
    updateDirection(character.id, direction)
  }, [
    transition.isTransitioning,
    getNavigation,
    startNavigation,
    updateDirection,
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

    // Background
    const bgGraphics = new Graphics()
    bgGraphics.rect(0, 0, map.width, map.height)
    bgGraphics.fill(map.backgroundColor)
    app.stage.addChild(bgGraphics)

    // Nodes container
    const nodesContainer = new Container()
    app.stage.addChild(nodesContainer)

    // Render nodes
    const config = configRef.current
    if (!config) return

    for (const node of map.nodes) {
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

      // Update idle animation when not moving
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
        const direction = getDirection(nav.startPosition, nav.targetPosition)
        updateSpriteAnimation(direction, true)
      }

      if (newProgress >= 1) {
        handleMovementComplete({
          path: nav.path,
          currentPathIndex: nav.currentPathIndex,
          startPosition: nav.startPosition,
          targetPosition: nav.targetPosition,
        }, newPosition)
      } else {
        updateProgress(characterId, newProgress)
      }
    }

    function handleMovementComplete(nav: ActiveNavigation, newPosition: Position): void {
      const nextIndex = nav.currentPathIndex + 1
      const finalNodeIndex = nav.path.length - 1
      const hasReachedFinalNode = nextIndex >= finalNodeIndex

      if (hasReachedFinalNode) {
        handleArrivalAtDestination(nav, characterId)
      } else {
        handleContinueToNextNode(nav, nextIndex, newPosition, characterId)
      }
    }

    function handleArrivalAtDestination(nav: ActiveNavigation, charId: string): void {
      const finalNodeId = nav.path[nav.path.length - 1]
      const mapId = currentMapIdRef.current
      const map = getMaps()[mapId]
      const finalNode = map?.nodes.find((n) => n.id === finalNodeId)

      const finalDirection = getDirection(nav.startPosition, nav.targetPosition)
      updatePosition(charId, nav.targetPosition)
      updateDirection(charId, finalDirection)
      updateCharacter(charId, { currentNodeId: finalNodeId })
      completeNavigation(charId)

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

    function handleContinueToNextNode(
      nav: ActiveNavigation,
      nextIndex: number,
      newPosition: Position,
      charId: string
    ): void {
      const nextNodeId = nav.path[nextIndex + 1]
      const mapId = currentMapIdRef.current
      const map = getMaps()[mapId]
      const nextNode = map?.nodes.find((n) => n.id === nextNodeId)

      if (!nextNode) return

      const currentNodeId = nav.path[nextIndex]
      const nextPosition: Position = { x: nextNode.x, y: nextNode.y }

      updatePosition(charId, newPosition)
      updateCharacter(charId, { currentNodeId })
      advanceToNextNode(charId, nextPosition)

      const direction = getDirection(newPosition, nextPosition)
      updateDirection(charId, direction)
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
  const themeMap = {
    entrance: nodes.entrance,
    spawn: nodes.spawn,
  } as const
  return themeMap[nodeType as keyof typeof themeMap] ?? nodes.waypoint
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
