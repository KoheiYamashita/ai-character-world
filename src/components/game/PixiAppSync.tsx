'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { Application, Container, Graphics, AnimatedSprite } from 'pixi.js'
import { useGameStore, useCharacterStore } from '@/stores'
import { getMaps, loadMaps, clearMapsCache } from '@/data/maps'
import { loadGameConfig, parseColor } from '@/lib/gameConfigLoader'
import { loadCharacterSpritesheet, getDirectionAnimation, getIdleTexture, type CharacterSpritesheet } from '@/lib/spritesheet'
import { renderNode, renderObstacle, createObstacleLabel, renderEntranceConnections } from '@/lib/pixiRenderers'
import { useSimulationSync } from '@/hooks'
import type { Direction, GameConfig, PathNode } from '@/types'

export default function PixiAppSync(): React.ReactNode {
  // Store selectors
  const currentMapId = useGameStore((s) => s.currentMapId)
  const setStoreMapsLoaded = useGameStore((s) => s.setMapsLoaded)

  const activeCharacter = useCharacterStore((s) => s.getActiveCharacter())

  // Connect to simulation server - get serverCharacters for navigation state
  const { isConnected, isConnecting, error, serverCharacters } = useSimulationSync()

  // PixiJS refs
  const containerRef = useRef<HTMLDivElement>(null)
  const appRef = useRef<Application | null>(null)
  const characterSpriteRef = useRef<AnimatedSprite | null>(null)
  const spritesheetRef = useRef<CharacterSpritesheet | null>(null)
  const pathLineRef = useRef<Graphics | null>(null)

  // State refs
  const initializingRef = useRef(false)
  const currentDirectionRef = useRef<Direction>('down')
  const serverCharactersRef = useRef(serverCharacters)
  const lastPathKeyRef = useRef<string>('')  // For path change detection

  // Component state
  const [isReady, setIsReady] = useState(false)
  const [spritesheetLoaded, setSpritesheetLoaded] = useState(false)
  const [localMapsLoaded, setLocalMapsLoaded] = useState(false)
  const [canvasSize, setCanvasSize] = useState({ width: 800, height: 600 })

  // Config ref
  const configRef = useRef<GameConfig | null>(null)

  // Keep serverCharactersRef in sync (avoid stale closure in ticker)
  useEffect(() => {
    serverCharactersRef.current = serverCharacters
  }, [serverCharacters])

  // Load config and maps for rendering (server will handle simulation)
  useEffect(() => {
    let cancelled = false

    async function loadData() {
      try {
        clearMapsCache()
        const config = await loadGameConfig()
        if (cancelled) return

        configRef.current = config

        const loadedMaps = await loadMaps()
        if (cancelled) return

        const initialMap = loadedMaps[config.initialState.mapId]
        if (initialMap) {
          setCanvasSize({ width: initialMap.width, height: initialMap.height })
        }

        setLocalMapsLoaded(true)
        setStoreMapsLoaded(true)
      } catch (error) {
        console.error('Failed to load config/maps:', error)
      }
    }

    loadData()

    return () => {
      cancelled = true
    }
  }, [setStoreMapsLoaded])

  // Initialize PixiJS
  useEffect(() => {
    const config = configRef.current
    if (!containerRef.current || initializingRef.current || appRef.current || !localMapsLoaded || !config) return

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
      initializingRef.current = false
      setIsReady(false)
    }
  }, [localMapsLoaded, canvasSize.width, canvasSize.height])

  // Update canvas size when map changes
  useEffect(() => {
    if (!localMapsLoaded) return

    const map = getMaps()[currentMapId]
    if (map) {
      setCanvasSize({ width: map.width, height: map.height })
    }
  }, [currentMapId, localMapsLoaded])

  // Resize canvas when map size changes
  useEffect(() => {
    if (!appRef.current || !isReady) return

    const app = appRef.current
    app.renderer.resize(canvasSize.width, canvasSize.height)
  }, [canvasSize.width, canvasSize.height, isReady])

  // Load spritesheet
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
  }, [activeCharacter?.id, spriteSheetUrl])

  // Render map and character
  useEffect(() => {
    if (!isReady || !appRef.current || !localMapsLoaded) return

    const app = appRef.current
    const map = getMaps()[currentMapId]
    if (!map) return

    app.stage.removeChildren()

    const config = configRef.current
    if (!config) return

    // Background
    const bgGraphics = new Graphics()
    bgGraphics.rect(0, 0, map.width, map.height)
    bgGraphics.fill(map.backgroundColor)
    app.stage.addChild(bgGraphics)

    // Obstacles container
    const obstaclesContainer = new Container()
    app.stage.addChild(obstaclesContainer)

    for (const obstacle of map.obstacles) {
      const obstacleContainer = new Container()
      const obstacleGraphics = new Graphics()
      renderObstacle(obstacleGraphics, obstacle, config)
      obstacleContainer.addChild(obstacleGraphics)

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
      const nodeGraphics = new Graphics()
      renderNode(nodeGraphics, node, config)
      nodesContainer.addChild(nodeGraphics)

      if (node.type === 'entrance') {
        renderEntranceConnections(nodesContainer, node, map.nodes, config)
      }
    }

    // Character
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
      // Fallback circle
      const fallback = config.theme.characterFallback
      const charGraphics = new Graphics()
      charGraphics.circle(0, 0, fallback.radius)
      charGraphics.fill(parseColor(fallback.fill))
      charGraphics.stroke({ color: parseColor(fallback.stroke), width: fallback.strokeWidth })
      charGraphics.x = activeCharacter.position.x
      charGraphics.y = activeCharacter.position.y
      app.stage.addChild(charGraphics)
    }
  }, [isReady, currentMapId, activeCharacter?.id, spritesheetLoaded, localMapsLoaded])

  // Clear path line (safe removal with parent check)
  const clearPathLine = useCallback((): void => {
    if (!pathLineRef.current) return

    if (pathLineRef.current.parent) {
      pathLineRef.current.parent.removeChild(pathLineRef.current)
    }
    pathLineRef.current.destroy()
    pathLineRef.current = null
  }, [])

  // Draw path line from current position to remaining path nodes
  const drawPathLine = useCallback((
    path: string[],
    nodes: PathNode[],
    startX: number,
    startY: number
  ): void => {
    if (!appRef.current || path.length < 1) return

    // Use clear() instead of destroy() to reuse Graphics object
    if (pathLineRef.current) {
      pathLineRef.current.clear()
    } else {
      pathLineRef.current = new Graphics()
      appRef.current.stage.addChild(pathLineRef.current)
    }

    const pathGraphics = pathLineRef.current
    const nodeMap = new Map(nodes.map(n => [n.id, n]))

    pathGraphics.setStrokeStyle({ width: 2, color: 0xffffff, alpha: 0.6 })
    pathGraphics.moveTo(startX, startY)

    for (const nodeId of path) {
      const node = nodeMap.get(nodeId)
      if (node) {
        pathGraphics.lineTo(node.x, node.y)
      }
    }
    pathGraphics.stroke()
  }, [])

  // Update sprite and path line from server state (ticker for smooth updates)
  useEffect(() => {
    if (!isReady || !appRef.current || !activeCharacter || !localMapsLoaded) return

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

    function updatePathLine(nav: { isMoving: boolean; path: string[]; currentPathIndex: number } | undefined, x: number, y: number): void {
      const map = getMaps()[useGameStore.getState().currentMapId]
      if (!map) return

      // Create a key to detect path changes
      const pathKey = nav?.isMoving
        ? `${nav.path.join(',')}-${nav.currentPathIndex}`
        : ''

      // Only redraw if path actually changed
      if (pathKey === lastPathKeyRef.current) {
        return
      }
      lastPathKeyRef.current = pathKey

      if (nav?.isMoving && nav.path.length > 1) {
        const remainingPath = nav.path.slice(nav.currentPathIndex + 1)
        drawPathLine(remainingPath, map.nodes, x, y)
      } else {
        clearPathLine()
      }
    }

    function ticker(): void {
      const sprite = characterSpriteRef.current
      const character = useCharacterStore.getState().getCharacter(characterId)

      if (!sprite || !character) return

      // Get navigation state from ref (avoids stale closure)
      const serverChar = serverCharactersRef.current[characterId]
      const nav = serverChar?.navigation
      const isMoving = nav?.isMoving ?? false

      // Use server position with interpolation towards target
      let x = character.position.x
      let y = character.position.y

      if (isMoving && nav?.startPosition && nav?.targetPosition) {
        // Interpolate based on progress for smoother movement
        const progress = nav.progress
        x = nav.startPosition.x + (nav.targetPosition.x - nav.startPosition.x) * progress
        y = nav.startPosition.y + (nav.targetPosition.y - nav.startPosition.y) * progress
      }

      sprite.x = x
      sprite.y = y

      // Update path line (only redraws when path changes)
      updatePathLine(nav, x, y)

      updateSpriteAnimation(character.direction, isMoving)
    }

    app.ticker.add(ticker)

    return () => {
      appRef.current?.ticker.remove(ticker)
      clearPathLine()
    }
  }, [isReady, activeCharacter?.id, localMapsLoaded, clearPathLine, drawPathLine])

  // Connection status overlay
  const renderConnectionStatus = () => {
    if (isConnected) return null

    return (
      <div className="absolute inset-0 flex items-center justify-center bg-black/50">
        <div className="text-white text-center p-4 rounded bg-slate-900">
          {isConnecting ? (
            <p>Connecting to simulation server...</p>
          ) : (
            <p className="text-red-400">{error || 'Disconnected from server'}</p>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="relative">
      <div
        ref={containerRef}
        className="rounded-lg overflow-hidden shadow-xl bg-slate-800"
        style={{ width: canvasSize.width, height: canvasSize.height }}
      />
      {renderConnectionStatus()}
    </div>
  )
}
