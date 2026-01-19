'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { Application, Container, Graphics, AnimatedSprite, Text, TextStyle } from 'pixi.js'
import { useWorldStore, useCharacterStore, useNPCStore } from '@/stores'
import { getMaps, loadMaps, clearMapsCache } from '@/data/maps'
import { getNPCConfigsForMap } from '@/lib/mapLoader'
import { loadNPCsFromMapConfig } from '@/lib/npcLoader'
import { loadWorldConfig, parseColor } from '@/lib/worldConfigLoader'
import { loadCharacterSpritesheet, getDirectionAnimation, getIdleTexture, type CharacterSpritesheet } from '@/lib/spritesheet'
import { renderNode, renderObstacle, createObstacleLabel, renderEntranceConnections, createNPCSprite } from '@/lib/pixiRenderers'
import { useSimulationSync } from '@/hooks'
import type { Direction, WorldConfig, PathNode } from '@/types'

export default function PixiAppSync(): React.ReactNode {
  // Store selectors
  const currentMapId = useWorldStore((s) => s.currentMapId)
  const setStoreMapsLoaded = useWorldStore((s) => s.setMapsLoaded)

  const activeCharacter = useCharacterStore((s) => s.getActiveCharacter())

  const addNPC = useNPCStore((s) => s.addNPC)
  const getNPCsByMap = useNPCStore((s) => s.getNPCsByMap)
  const clearNPCs = useNPCStore((s) => s.clearNPCs)

  // Connect to simulation server - get serverCharacters and serverNPCs for navigation/conversation state
  const { isConnected, isConnecting, error, serverCharacters, serverNPCs } = useSimulationSync()

  // PixiJS refs
  const containerRef = useRef<HTMLDivElement>(null)
  const appRef = useRef<Application | null>(null)
  const characterSpriteRef = useRef<AnimatedSprite | null>(null)
  const spritesheetRef = useRef<CharacterSpritesheet | null>(null)
  const pathLineRef = useRef<Graphics | null>(null)

  // NPC refs (static display only)
  const npcSpritesRef = useRef<Map<string, AnimatedSprite>>(new Map())
  const npcSpritesheetsRef = useRef<Map<string, CharacterSpritesheet>>(new Map())
  const npcContainerRef = useRef<Container | null>(null)
  const npcDirectionsRef = useRef<Map<string, Direction>>(new Map())  // Track NPC directions for change detection

  // Head icon refs (for displayEmoji - actions, conversations, etc.)
  const headIconsRef = useRef<Map<string, Text>>(new Map())  // Track emoji icons by entity ID

  // State refs
  const initializingRef = useRef(false)
  const currentDirectionRef = useRef<Direction>('down')
  const currentMapIdRef = useRef(currentMapId)
  const serverCharactersRef = useRef(serverCharacters)
  const serverNPCsRef = useRef(serverNPCs)
  const lastPathKeyRef = useRef<string>('')  // For path change detection

  // Component state
  const [isReady, setIsReady] = useState(false)
  const [spritesheetLoaded, setSpritesheetLoaded] = useState(false)
  const [localMapsLoaded, setLocalMapsLoaded] = useState(false)
  const [npcsLoaded, setNpcsLoaded] = useState(false)
  const [canvasSize, setCanvasSize] = useState({ width: 800, height: 600 })

  // Config ref
  const configRef = useRef<WorldConfig | null>(null)

  // Keep refs in sync (avoid stale closure in ticker)
  useEffect(() => {
    serverCharactersRef.current = serverCharacters
  }, [serverCharacters])

  useEffect(() => {
    serverNPCsRef.current = serverNPCs
  }, [serverNPCs])

  useEffect(() => {
    currentMapIdRef.current = currentMapId
  }, [currentMapId])

  // Load config and maps for rendering (server will handle simulation)
  useEffect(() => {
    let cancelled = false

    async function loadData() {
      try {
        clearMapsCache()
        const config = await loadWorldConfig()
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

  // Load NPCs when maps are loaded
  useEffect(() => {
    if (!localMapsLoaded) return

    // Clear existing NPCs
    clearNPCs()
    setNpcsLoaded(false)

    // Load NPCs for all maps
    let allMaps: Record<string, import('@/types').GameMap>
    try {
      allMaps = getMaps()
    } catch {
      console.warn('Maps not yet available for NPC loading')
      return
    }

    if (Object.keys(allMaps).length === 0) {
      console.warn('[NPC] No maps available yet')
      return
    }

    let totalNpcsLoaded = 0
    for (const mapId of Object.keys(allMaps)) {
      const npcConfigs = getNPCConfigsForMap(mapId)
      if (npcConfigs.length > 0) {
        const map = allMaps[mapId]
        const npcs = loadNPCsFromMapConfig(mapId, npcConfigs, map)
        for (const npc of npcs) {
          addNPC(npc)
          totalNpcsLoaded++
        }
      }
    }

    console.log(`[NPC] Loaded ${totalNpcsLoaded} NPCs`)
    setNpcsLoaded(true)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localMapsLoaded])

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

    // NPC container
    const npcContainer = new Container()
    npcContainer.label = 'npcContainer'
    app.stage.addChild(npcContainer)
    npcContainerRef.current = npcContainer

    // Clear old NPC sprites
    npcSpritesRef.current.clear()

    // Create NPC sprites for current map
    const npcsOnMap = getNPCsByMap(currentMapId)
    for (const npc of npcsOnMap) {
      const cachedSpritesheet = npcSpritesheetsRef.current.get(npc.id)
      if (cachedSpritesheet) {
        const sprite = createNPCSprite(npc, cachedSpritesheet, config)
        npcSpritesRef.current.set(npc.id, sprite)
        npcDirectionsRef.current.set(npc.id, npc.direction)
        npcContainer.addChild(sprite)
      } else {
        loadCharacterSpritesheet(npc.sprite).then((spritesheet) => {
          npcSpritesheetsRef.current.set(npc.id, spritesheet)
          if (npcContainerRef.current && currentMapIdRef.current === npc.mapId) {
            const sprite = createNPCSprite(npc, spritesheet, configRef.current!)
            npcSpritesRef.current.set(npc.id, sprite)
            npcDirectionsRef.current.set(npc.id, npc.direction)
            npcContainerRef.current.addChild(sprite)
          }
        }).catch((err) => {
          console.error(`[NPC] Failed to load spritesheet for ${npc.id}:`, err)
        })
      }
    }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady, currentMapId, activeCharacter?.id, spritesheetLoaded, localMapsLoaded, npcsLoaded])

  // Head icon Y offset above sprite
  const HEAD_ICON_Y_OFFSET = 50

  // Remove and destroy a head icon
  function destroyHeadIcon(icon: Text): void {
    if (icon.parent) {
      icon.parent.removeChild(icon)
    }
    icon.destroy()
  }

  // Update or create head icon (emoji displayed above sprite head)
  function updateHeadIcon(entityId: string, x: number, y: number, emoji: string | undefined): void {
    const existingIcon = headIconsRef.current.get(entityId)

    if (!emoji) {
      // Remove icon if no emoji to display
      if (existingIcon) {
        destroyHeadIcon(existingIcon)
        headIconsRef.current.delete(entityId)
      }
      return
    }

    if (existingIcon) {
      // Update existing icon position and text
      existingIcon.x = x
      existingIcon.y = y - HEAD_ICON_Y_OFFSET
      if (existingIcon.text !== emoji) {
        existingIcon.text = emoji
      }
    } else if (appRef.current) {
      // Create new icon
      const style = new TextStyle({ fontSize: 24 })
      const icon = new Text({ text: emoji, style })
      icon.anchor.set(0.5, 1)
      icon.x = x
      icon.y = y - HEAD_ICON_Y_OFFSET
      icon.label = `head-icon-${entityId}`
      headIconsRef.current.set(entityId, icon)
      appRef.current.stage.addChild(icon)
    }
  }

  // Clear all head icons
  const clearAllHeadIcons = useCallback((): void => {
    for (const icon of headIconsRef.current.values()) {
      destroyHeadIcon(icon)
    }
    headIconsRef.current.clear()
  }, [])

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
      const map = getMaps()[useWorldStore.getState().currentMapId]
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

    // Update NPC sprite direction when it changes
    function updateNPCDirections(): void {
      const serverNPCs = serverNPCsRef.current
      for (const [npcId, simNPC] of Object.entries(serverNPCs)) {
        const sprite = npcSpritesRef.current.get(npcId)
        const spritesheet = npcSpritesheetsRef.current.get(npcId)
        const lastDirection = npcDirectionsRef.current.get(npcId)

        if (sprite && spritesheet && lastDirection !== simNPC.direction) {
          sprite.texture = getIdleTexture(spritesheet, simNPC.direction)
          npcDirectionsRef.current.set(npcId, simNPC.direction)
        }
      }
    }

    // Update head icons (displayEmoji from server state)
    function updateHeadIcons(charX: number, charY: number): void {
      const serverChar = serverCharactersRef.current[characterId]
      const characterIconId = `char-${characterId}`

      // Update character's head icon based on displayEmoji
      updateHeadIcon(characterIconId, charX, charY, serverChar?.displayEmoji)

      // Update NPC head icons (for conversation partner)
      const conversation = serverChar?.conversation
      if (conversation?.isActive) {
        const npcId = conversation.npcId
        const npcSprite = npcSpritesRef.current.get(npcId)
        const npcIconId = `npc-${npcId}`

        if (npcSprite) {
          // Show 💬 for NPC in conversation
          updateHeadIcon(npcIconId, npcSprite.x, npcSprite.y, '💬')
        }
      } else {
        // Remove NPC conversation icons if no conversation
        for (const [iconId, icon] of headIconsRef.current) {
          if (iconId.startsWith('npc-')) {
            destroyHeadIcon(icon)
            headIconsRef.current.delete(iconId)
          }
        }
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

      // Update NPC directions
      updateNPCDirections()

      // Update head icons (displayEmoji from server state)
      updateHeadIcons(x, y)
    }

    app.ticker.add(ticker)

    return () => {
      appRef.current?.ticker.remove(ticker)
      clearPathLine()
      clearAllHeadIcons()
    }
  }, [isReady, activeCharacter?.id, localMapsLoaded, clearPathLine, drawPathLine, clearAllHeadIcons])

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
