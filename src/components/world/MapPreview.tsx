'use client'

import { useEffect, useRef, useState } from 'react'
import { Application, Container, Graphics, Text, TextStyle } from 'pixi.js'
import { loadMaps, getCachedMaps, getNPCConfigsForMap } from '@/lib/mapLoader'
import { loadNPCsFromMapConfig } from '@/lib/npcLoader'
import { loadWorldConfig } from '@/lib/worldConfigLoader'
import { loadCharacterSpritesheet } from '@/lib/spritesheet'
import {
  renderNode,
  renderObstacle,
  createObstacleLabel,
  renderEntranceConnections,
  createNPCSprite,
} from '@/lib/pixiRenderers'
import type { WorldConfig, WorldMap, NPC } from '@/types'

interface MapPreviewProps {
  mapId: string
}

export default function MapPreview({ mapId }: MapPreviewProps): React.ReactNode {
  const containerRef = useRef<HTMLDivElement>(null)
  const appRef = useRef<Application | null>(null)

  const [isReady, setIsReady] = useState(false)
  const [mapsLoaded, setMapsLoaded] = useState(false)
  const [config, setConfig] = useState<WorldConfig | null>(null)
  const [currentMap, setCurrentMap] = useState<WorldMap | null>(null)
  const [npcs, setNpcs] = useState<NPC[]>([])

  // Load world config
  useEffect(() => {
    loadWorldConfig().then((cfg) => {
      setConfig(cfg)
    })
  }, [])

  // Load maps
  useEffect(() => {
    if (!config) return
    loadMaps().then(() => {
      setMapsLoaded(true)
    })
  }, [config])

  // Get current map and NPCs
  useEffect(() => {
    if (!mapsLoaded) return

    try {
      const maps = getCachedMaps()
      const map = maps[mapId]
      if (map) {
        setCurrentMap(map)

        // Load NPCs for this map
        const npcConfigs = getNPCConfigsForMap(mapId)
        if (npcConfigs.length > 0) {
          const loadedNpcs = loadNPCsFromMapConfig(mapId, npcConfigs, map)
          setNpcs(loadedNpcs)
        } else {
          setNpcs([])
        }
      }
    } catch {
      console.warn('Maps not yet available')
    }
  }, [mapsLoaded, mapId])

  // Initialize PixiJS
  useEffect(() => {
    if (!containerRef.current || !config || !currentMap) return

    const initApp = async () => {
      const app = new Application()
      await app.init({
        width: currentMap.width,
        height: currentMap.height,
        backgroundColor: currentMap.backgroundColor,
        antialias: true,
      })

      containerRef.current?.appendChild(app.canvas)
      appRef.current = app
      setIsReady(true)
    }

    initApp()

    return () => {
      if (appRef.current) {
        appRef.current.destroy(true, { children: true })
        appRef.current = null
      }
    }
  }, [config, currentMap])

  // Render map
  useEffect(() => {
    if (!isReady || !appRef.current || !config || !currentMap) return

    const app = appRef.current

    // Clear stage
    app.stage.removeChildren()

    // Background
    const bgGraphics = new Graphics()
    bgGraphics.rect(0, 0, currentMap.width, currentMap.height)
    bgGraphics.fill(currentMap.backgroundColor)
    app.stage.addChild(bgGraphics)

    // Obstacles container
    const obstaclesContainer = new Container()
    app.stage.addChild(obstaclesContainer)

    for (const obstacle of currentMap.obstacles) {
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

    for (const node of currentMap.nodes) {
      const nodeGraphics = new Graphics()
      renderNode(nodeGraphics, node, config)
      nodesContainer.addChild(nodeGraphics)

      if (node.type === 'entrance') {
        renderEntranceConnections(nodesContainer, node, currentMap.nodes, config)
      }
    }

    // NPC container
    const npcContainer = new Container()
    npcContainer.label = 'npcs'
    app.stage.addChild(npcContainer)

    // Load and render NPCs
    for (const npc of npcs) {
      loadCharacterSpritesheet(npc.sprite)
        .then((spritesheet) => {
          const sprite = createNPCSprite(npc, spritesheet, config)
          npcContainer.addChild(sprite)
        })
        .catch((err) => {
          console.error(`[MapPreview] Failed to load NPC sprite for ${npc.id}:`, err)
        })
    }

    // Map title
    const titleBg = new Graphics()
    titleBg.rect(5, 5, 200, 30)
    titleBg.fill({ color: 0x000000, alpha: 0.5 })
    app.stage.addChild(titleBg)

    const titleStyle = new TextStyle({
      fontFamily: 'sans-serif',
      fontSize: 16,
      fill: 0xffffff,
    })
    const title = new Text({ text: `${currentMap.name} (${mapId})`, style: titleStyle })
    title.x = 10
    title.y = 10
    app.stage.addChild(title)
  }, [isReady, config, currentMap, npcs])

  if (!currentMap) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-900 text-white">
        <div>Loading map: {mapId}...</div>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-900 p-4">
      <div
        ref={containerRef}
        className="border-2 border-gray-600 rounded-lg overflow-hidden"
        style={{ width: currentMap.width, height: currentMap.height }}
      />
      <div className="mt-4 text-gray-400 text-sm">
        Map: {currentMap.name} | Size: {currentMap.width}x{currentMap.height} |
        Nodes: {currentMap.nodes.length} | Obstacles: {currentMap.obstacles.length} |
        NPCs: {npcs.length}
      </div>
    </div>
  )
}
