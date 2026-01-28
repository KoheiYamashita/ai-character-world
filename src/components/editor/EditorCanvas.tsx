'use client'

import { useEffect, useRef, useCallback, useState } from 'react'
import { Application, Container, Graphics, Text, TextStyle } from 'pixi.js'
import { useEditorStore, selectCurrentMap } from '@/stores/editorStore'
import { loadWorldConfig } from '@/lib/worldConfigLoader'
import { parseColor } from '@/lib/worldConfigLoader'
import {
  renderGridOverlay,
  renderEditorObstacle,
  renderEditorEntrance,
  renderEditorNPC,
  renderEditorSpawnNode,
  pixelToTileSnapped,
  isObstacleAtPosition,
  isEntranceAtPosition,
  isNPCAtPosition,
  isSpawnNodeAtPosition,
  getHandleAtPosition,
  getCursorStyle,
  checkObstacleCollision,
  checkEntranceCollision,
  checkNPCCollision,
  parseSpawnNodeId,
  loadSpriteTexture,
} from '@/lib/editorRenderers'
import type { Texture } from 'pixi.js'
import { tileToPixelObstacle } from '@/data/maps/grid'
import type { WorldConfig } from '@/types/config'
import type { TileToPixelConfig } from '@/data/maps/grid'
import type { ResizeHandle } from '@/types/editor'

export default function EditorCanvas(): React.ReactNode {
  const containerRef = useRef<HTMLDivElement>(null)
  const appRef = useRef<Application | null>(null)
  const configRef = useRef<WorldConfig | null>(null)
  const [isReady, setIsReady] = useState(false)
  const [spriteTextures, setSpriteTextures] = useState<Map<string, Texture>>(new Map())

  // Store state
  const currentMap = useEditorStore(selectCurrentMap)
  const selection = useEditorStore((s) => s.selection)
  const settings = useEditorStore((s) => s.settings)
  const tool = useEditorStore((s) => s.tool)
  const drag = useEditorStore((s) => s.drag)

  // Actions
  const setSelection = useEditorStore((s) => s.setSelection)
  const updateMap = useEditorStore((s) => s.updateMap)
  const updateObstacle = useEditorStore((s) => s.updateObstacle)
  const updateEntrance = useEditorStore((s) => s.updateEntrance)
  const updateNPC = useEditorStore((s) => s.updateNPC)
  const addObstacle = useEditorStore((s) => s.addObstacle)
  const addEntrance = useEditorStore((s) => s.addEntrance)
  const addNPC = useEditorStore((s) => s.addNPC)
  const startDrag = useEditorStore((s) => s.startDrag)
  const updateDrag = useEditorStore((s) => s.updateDrag)
  const endDrag = useEditorStore((s) => s.endDrag)
  const startResize = useEditorStore((s) => s.startResize)
  const endResize = useEditorStore((s) => s.endResize)
  const resize = useEditorStore((s) => s.resize)

  // Get grid config
  const getGridConfig = useCallback((): TileToPixelConfig | null => {
    if (!currentMap) return null
    return {
      cols: currentMap.grid.cols ?? 12,
      rows: currentMap.grid.rows ?? 9,
      width: currentMap.width,
      height: currentMap.height,
    }
  }, [currentMap])

  // Initialize PixiJS
  useEffect(() => {
    if (!containerRef.current || !currentMap) return

    let mounted = true
    setIsReady(false)

    const initApp = async () => {
      const config = await loadWorldConfig()
      if (!mounted) return
      configRef.current = config

      const app = new Application()
      await app.init({
        width: currentMap.width,
        height: currentMap.height,
        backgroundColor: parseColor(currentMap.backgroundColor),
        antialias: true,
      })

      if (!mounted) return

      containerRef.current?.appendChild(app.canvas)
      appRef.current = app
      setIsReady(true)
    }

    initApp()

    return () => {
      mounted = false
      setIsReady(false)
      if (appRef.current) {
        appRef.current.destroy(true, { children: true })
        appRef.current = null
      }
    }
  }, [currentMap?.id]) // Re-init only when map changes

  // Load sprite textures for NPCs
  useEffect(() => {
    if (!currentMap || !isReady) return

    const npcs = currentMap.npcs ?? []
    const sheetUrls = new Set<string>()

    for (const npc of npcs) {
      if (npc.sprite?.sheetUrl) {
        sheetUrls.add(npc.sprite.sheetUrl)
      }
    }

    // Load missing textures
    const loadTextures = async () => {
      const newTextures = new Map(spriteTextures)
      let hasChanges = false

      for (const url of sheetUrls) {
        if (!newTextures.has(url)) {
          const texture = await loadSpriteTexture(url)
          if (texture) {
            newTextures.set(url, texture)
            hasChanges = true
          }
        }
      }

      if (hasChanges) {
        setSpriteTextures(newTextures)
      }
    }

    loadTextures()
  }, [currentMap?.npcs, isReady]) // eslint-disable-line react-hooks/exhaustive-deps

  // Render map content
  useEffect(() => {
    if (!isReady || !appRef.current || !currentMap || !configRef.current) return

    const app = appRef.current
    const config = configRef.current
    const gridConfig = getGridConfig()
    if (!gridConfig) return

    // Clear stage
    app.stage.removeChildren()

    // Background
    const bgGraphics = new Graphics()
    bgGraphics.rect(0, 0, currentMap.width, currentMap.height)
    bgGraphics.fill(parseColor(currentMap.backgroundColor))
    app.stage.addChild(bgGraphics)

    // Grid overlay
    if (settings.gridVisible) {
      const gridGraphics = new Graphics()
      renderGridOverlay(
        gridGraphics,
        currentMap.width,
        currentMap.height,
        gridConfig.cols,
        gridConfig.rows,
        currentMap.obstacles
      )
      app.stage.addChild(gridGraphics)
    }

    // Obstacles container
    const obstaclesContainer = new Container()
    obstaclesContainer.label = 'obstacles'
    app.stage.addChild(obstaclesContainer)

    for (let i = 0; i < (currentMap.obstacles ?? []).length; i++) {
      const obstacle = currentMap.obstacles![i]
      const isSelected = selection?.type === 'obstacle' && selection.index === i
      const obsContainer = new Container()
      renderEditorObstacle(obsContainer, obstacle, i, gridConfig, config, isSelected)
      obstaclesContainer.addChild(obsContainer)
    }

    // Entrances container
    const entrancesContainer = new Container()
    entrancesContainer.label = 'entrances'
    app.stage.addChild(entrancesContainer)

    for (let i = 0; i < currentMap.entrances.length; i++) {
      const entrance = currentMap.entrances[i]
      const isSelected = selection?.type === 'entrance' && selection.index === i
      const entContainer = new Container()
      renderEditorEntrance(entContainer, entrance, i, gridConfig, isSelected)
      entrancesContainer.addChild(entContainer)
    }

    // NPCs container
    const npcsContainer = new Container()
    npcsContainer.label = 'npcs'
    app.stage.addChild(npcsContainer)

    for (let i = 0; i < (currentMap.npcs ?? []).length; i++) {
      const npc = currentMap.npcs![i]
      const isSelected = selection?.type === 'npc' && selection.index === i
      const npcContainer = new Container()
      const texture = npc.sprite?.sheetUrl ? spriteTextures.get(npc.sprite.sheetUrl) : undefined
      renderEditorNPC(npcContainer, npc, i, currentMap.grid.prefix, gridConfig, isSelected, texture)
      npcsContainer.addChild(npcContainer)
    }

    // Spawn node
    const spawnContainer = new Container()
    spawnContainer.label = 'spawn'
    app.stage.addChild(spawnContainer)
    const isSpawnSelected = selection?.type === 'spawn'
    renderEditorSpawnNode(spawnContainer, currentMap.spawnNodeId, currentMap.grid.prefix, gridConfig, isSpawnSelected)

    // Map title overlay
    const titleBg = new Graphics()
    titleBg.rect(5, 5, 250, 30)
    titleBg.fill({ color: 0x000000, alpha: 0.6 })
    app.stage.addChild(titleBg)

    const titleStyle = new TextStyle({
      fontFamily: 'sans-serif',
      fontSize: 14,
      fill: 0xffffff,
    })
    const title = new Text({
      text: `${currentMap.name} (${currentMap.id}) - ${currentMap.width}x${currentMap.height}`,
      style: titleStyle,
    })
    title.x = 10
    title.y = 10
    app.stage.addChild(title)
  }, [isReady, currentMap, selection, settings.gridVisible, getGridConfig, spriteTextures])

  // Mouse event handlers
  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!currentMap || !appRef.current) return

      const rect = appRef.current.canvas.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      const gridConfig = getGridConfig()
      if (!gridConfig) return

      // Check for resize handle first
      if (selection?.type === 'obstacle' && selection.index !== undefined) {
        const obstacle = currentMap.obstacles?.[selection.index]
        if (obstacle) {
          const pixel = tileToPixelObstacle(obstacle, gridConfig)
          const handle = getHandleAtPosition(x, y, pixel.x, pixel.y, pixel.width, pixel.height)
          if (handle) {
            startResize(handle, obstacle.tileWidth, obstacle.tileHeight, obstacle.row, obstacle.col)
            return
          }
        }
      }

      // Tool-specific behavior
      if (tool === 'select') {
        // Check obstacles (reverse order for top-most first)
        const obstacles = currentMap.obstacles ?? []
        for (let i = obstacles.length - 1; i >= 0; i--) {
          if (isObstacleAtPosition(obstacles[i], x, y, gridConfig)) {
            setSelection({ type: 'obstacle', index: i })
            startDrag(x, y, obstacles[i].row, obstacles[i].col)
            return
          }
        }

        // Check entrances
        for (let i = currentMap.entrances.length - 1; i >= 0; i--) {
          if (isEntranceAtPosition(currentMap.entrances[i], x, y, gridConfig)) {
            setSelection({ type: 'entrance', index: i })
            startDrag(x, y, currentMap.entrances[i].row, currentMap.entrances[i].col)
            return
          }
        }

        // Check NPCs
        const npcs = currentMap.npcs ?? []
        for (let i = npcs.length - 1; i >= 0; i--) {
          if (isNPCAtPosition(npcs[i], x, y, currentMap.grid.prefix, gridConfig)) {
            setSelection({ type: 'npc', index: i })
            // Parse row/col from spawnNodeId for drag
            const parts = npcs[i].spawnNodeId.split('-')
            if (parts.length >= 3) {
              const row = parseInt(parts[1], 10)
              const col = parseInt(parts[2], 10)
              if (!isNaN(row) && !isNaN(col)) {
                startDrag(x, y, row, col)
              }
            }
            return
          }
        }

        // Check spawn node
        if (isSpawnNodeAtPosition(currentMap.spawnNodeId, x, y, currentMap.grid.prefix, gridConfig)) {
          setSelection({ type: 'spawn' })
          const spawnPos = parseSpawnNodeId(currentMap.spawnNodeId)
          if (spawnPos) {
            startDrag(x, y, spawnPos.row, spawnPos.col)
          }
          return
        }

        // No hit - clear selection
        setSelection(null)
      } else if (tool === 'building') {
        // Add new building with collision check
        const { row, col } = pixelToTileSnapped(x, y, gridConfig)
        const newObstacle = { row, col, tileWidth: 2, tileHeight: 2 }
        const obstacles = currentMap.obstacles ?? []

        if (checkObstacleCollision(newObstacle, obstacles)) {
          // Collision detected - don't add
          return
        }

        addObstacle(currentMap.id, {
          ...newObstacle,
          type: 'building',
          label: '新規障害物',
        })
      } else if (tool === 'zone') {
        // Add new zone with collision check
        const { row, col } = pixelToTileSnapped(x, y, gridConfig)
        // Zones have minimum size of 4x4
        const newObstacle = { row, col, tileWidth: 4, tileHeight: 4 }
        const obstacles = currentMap.obstacles ?? []

        if (checkObstacleCollision(newObstacle, obstacles)) {
          // Collision detected - don't add
          return
        }

        addObstacle(currentMap.id, {
          ...newObstacle,
          type: 'zone',
          label: '新規ゾーン',
          wallSides: [], // Empty = passable zone
        })
      } else if (tool === 'entrance') {
        // Add new entrance with collision check
        const { row, col } = pixelToTileSnapped(x, y, gridConfig)
        const obstacles = currentMap.obstacles ?? []
        const entrances = currentMap.entrances

        if (checkEntranceCollision({ row, col }, obstacles, entrances)) {
          // Collision detected - don't add
          return
        }

        const entranceId = `ent-${Date.now()}`
        addEntrance(currentMap.id, {
          id: entranceId,
          row,
          col,
          connectedNodeIds: [],
          leadsTo: { mapId: '', nodeId: '' },
          label: '新規入口',
        })
      } else if (tool === 'npc') {
        // Add new NPC with collision check
        const { row, col } = pixelToTileSnapped(x, y, gridConfig)
        const obstacles = currentMap.obstacles ?? []
        const npcs = currentMap.npcs ?? []
        const npcPositions = npcs
          .map((n) => parseSpawnNodeId(n.spawnNodeId))
          .filter((p): p is { row: number; col: number } => p !== null)

        if (checkNPCCollision({ row, col }, obstacles, npcPositions)) {
          // Collision detected - don't add
          return
        }

        const npcId = `npc-${Date.now()}`
        const spawnNodeId = `${currentMap.grid.prefix}-${row}-${col}`
        addNPC(currentMap.id, {
          id: npcId,
          name: '新規NPC',
          spawnNodeId,
          sprite: {
            sheetUrl: '/assets/sprites/npcs/placeholder.png',
            frameWidth: 96,
            frameHeight: 96,
            cols: 3,
            rows: 4,
            rowMapping: { down: 0, left: 1, right: 2, up: 3 },
          },
          personality: '',
          tendencies: [],
          facts: [],
        })
      }
    },
    [
      currentMap,
      selection,
      tool,
      getGridConfig,
      setSelection,
      startDrag,
      startResize,
      addObstacle,
      addEntrance,
      addNPC,
    ]
  )

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!currentMap || !appRef.current) return

      const rect = appRef.current.canvas.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      const gridConfig = getGridConfig()
      if (!gridConfig) return

      // Update cursor
      let cursor = 'default'
      if (selection?.type === 'obstacle' && selection.index !== undefined) {
        const obstacle = currentMap.obstacles?.[selection.index]
        if (obstacle) {
          const pixel = tileToPixelObstacle(obstacle, gridConfig)
          const handle = getHandleAtPosition(x, y, pixel.x, pixel.y, pixel.width, pixel.height)
          cursor = getCursorStyle(selection, handle)
        }
      }
      if (containerRef.current) {
        containerRef.current.style.cursor = cursor
      }

      const obstacles = currentMap.obstacles ?? []

      // Handle drag
      if (drag.isDragging && selection) {
        updateDrag(x, y)

        const { row: newRow, col: newCol } = pixelToTileSnapped(x, y, gridConfig)
        const deltaRow = newRow - drag.startTileRow
        const deltaCol = newCol - drag.startTileCol

        if (selection.type === 'obstacle' && selection.index !== undefined) {
          const obstacle = obstacles[selection.index]
          if (obstacle) {
            const targetRow = drag.startTileRow + deltaRow
            const targetCol = drag.startTileCol + deltaCol
            if (targetRow !== obstacle.row || targetCol !== obstacle.col) {
              // Collision check
              const movedObstacle = {
                row: targetRow,
                col: targetCol,
                tileWidth: obstacle.tileWidth,
                tileHeight: obstacle.tileHeight,
              }
              if (!checkObstacleCollision(movedObstacle, obstacles, selection.index)) {
                updateObstacle(currentMap.id, selection.index, {
                  row: targetRow,
                  col: targetCol,
                })
              }
            }
          }
        } else if (selection.type === 'entrance' && selection.index !== undefined) {
          const entrance = currentMap.entrances[selection.index]
          if (entrance) {
            const targetRow = drag.startTileRow + deltaRow
            const targetCol = drag.startTileCol + deltaCol
            if (targetRow !== entrance.row || targetCol !== entrance.col) {
              // Collision check
              if (!checkEntranceCollision({ row: targetRow, col: targetCol }, obstacles, currentMap.entrances, selection.index)) {
                updateEntrance(currentMap.id, selection.index, {
                  row: targetRow,
                  col: targetCol,
                })
              }
            }
          }
        } else if (selection.type === 'npc' && selection.index !== undefined) {
          // NPC drag: update spawnNodeId directly based on position
          const { row, col } = pixelToTileSnapped(x, y, gridConfig)
          const newSpawnNodeId = `${currentMap.grid.prefix}-${row}-${col}`
          const npc = currentMap.npcs?.[selection.index]
          if (npc && npc.spawnNodeId !== newSpawnNodeId) {
            // Collision check
            const npcs = currentMap.npcs ?? []
            const npcPositions = npcs
              .map((n) => parseSpawnNodeId(n.spawnNodeId))
              .filter((p): p is { row: number; col: number } => p !== null)
            if (!checkNPCCollision({ row, col }, obstacles, npcPositions, selection.index)) {
              updateNPC(currentMap.id, selection.index, {
                spawnNodeId: newSpawnNodeId,
              })
            }
          }
        } else if (selection.type === 'spawn') {
          // Spawn node drag: update map's spawnNodeId
          const { row, col } = pixelToTileSnapped(x, y, gridConfig)
          // Clamp to grid bounds
          const clampedRow = Math.max(0, Math.min(gridConfig.rows - 1, row))
          const clampedCol = Math.max(0, Math.min(gridConfig.cols - 1, col))
          const newSpawnNodeId = `${currentMap.grid.prefix}-${clampedRow}-${clampedCol}`
          if (currentMap.spawnNodeId !== newSpawnNodeId) {
            updateMap(currentMap.id, { spawnNodeId: newSpawnNodeId })
          }
        }
      }

      // Handle resize
      if (resize.isResizing && selection?.type === 'obstacle' && selection.index !== undefined) {
        const obstacle = currentMap.obstacles?.[selection.index]
        if (obstacle && resize.handle) {
          const { row, col } = pixelToTileSnapped(x, y, gridConfig)
          let newRow = obstacle.row
          let newCol = obstacle.col
          let newWidth = obstacle.tileWidth
          let newHeight = obstacle.tileHeight

          switch (resize.handle) {
            case 'top-left':
              newRow = Math.min(row, resize.startRow + resize.startHeight - 2)
              newCol = Math.min(col, resize.startCol + resize.startWidth - 2)
              newHeight = resize.startRow + resize.startHeight - newRow
              newWidth = resize.startCol + resize.startWidth - newCol
              break
            case 'top':
              newRow = Math.min(row, resize.startRow + resize.startHeight - 2)
              newHeight = resize.startRow + resize.startHeight - newRow
              break
            case 'top-right':
              newRow = Math.min(row, resize.startRow + resize.startHeight - 2)
              newWidth = Math.max(2, col - resize.startCol + 1)
              newHeight = resize.startRow + resize.startHeight - newRow
              break
            case 'left':
              newCol = Math.min(col, resize.startCol + resize.startWidth - 2)
              newWidth = resize.startCol + resize.startWidth - newCol
              break
            case 'right':
              newWidth = Math.max(2, col - resize.startCol + 1)
              break
            case 'bottom-left':
              newCol = Math.min(col, resize.startCol + resize.startWidth - 2)
              newWidth = resize.startCol + resize.startWidth - newCol
              newHeight = Math.max(2, row - resize.startRow + 1)
              break
            case 'bottom':
              newHeight = Math.max(2, row - resize.startRow + 1)
              break
            case 'bottom-right':
              newWidth = Math.max(2, col - resize.startCol + 1)
              newHeight = Math.max(2, row - resize.startRow + 1)
              break
          }

          if (
            newRow !== obstacle.row ||
            newCol !== obstacle.col ||
            newWidth !== obstacle.tileWidth ||
            newHeight !== obstacle.tileHeight
          ) {
            // Collision check for resized obstacle
            const resizedObstacle = {
              row: newRow,
              col: newCol,
              tileWidth: newWidth,
              tileHeight: newHeight,
            }
            if (!checkObstacleCollision(resizedObstacle, obstacles, selection.index)) {
              updateObstacle(currentMap.id, selection.index, {
                row: newRow,
                col: newCol,
                tileWidth: newWidth,
                tileHeight: newHeight,
              })
            }
          }
        }
      }
    },
    [
      currentMap,
      selection,
      drag,
      resize,
      getGridConfig,
      updateDrag,
      updateMap,
      updateObstacle,
      updateEntrance,
      updateNPC,
    ]
  )

  const handleMouseUp = useCallback(() => {
    if (drag.isDragging) {
      endDrag()
    }
    if (resize.isResizing) {
      endResize()
    }
  }, [drag.isDragging, resize.isResizing, endDrag, endResize])

  if (!currentMap) {
    return (
      <div className="flex items-center justify-center h-full bg-gray-800 text-gray-400">
        <div className="text-center">
          <p className="text-lg mb-2">マップが選択されていません</p>
          <p className="text-sm">左のリストからマップを選択してください</p>
        </div>
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className="overflow-auto bg-gray-900"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      style={{
        width: '100%',
        height: '100%',
        cursor: tool === 'building' || tool === 'zone' || tool === 'entrance' || tool === 'npc' ? 'crosshair' : 'default',
      }}
    />
  )
}
