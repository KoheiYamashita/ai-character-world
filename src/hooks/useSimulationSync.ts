'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useCharacterStore, useGameStore } from '@/stores'
import type { SerializedWorldState, SimCharacter } from '@/server/simulation/types'
import type { Character } from '@/types'

interface SimulationSyncState {
  isConnected: boolean
  isConnecting: boolean
  error: string | null
  lastTick: number
  reconnectAttempts: number
  // Server character states including navigation
  serverCharacters: Record<string, SimCharacter>
}

interface UseSimulationSyncOptions {
  autoConnect?: boolean
  maxReconnectAttempts?: number
  reconnectDelay?: number
}

// Convert SimCharacter to client Character format
function simCharacterToCharacter(simChar: SimCharacter, existingChar?: Character): Character {
  return {
    id: simChar.id,
    name: simChar.name,
    sprite: existingChar?.sprite ?? {
      sheetUrl: '/assets/sprites/kanon.png',
      frameWidth: 96,
      frameHeight: 96,
      cols: 3,
      rows: 4,
      rowMapping: { down: 0, left: 1, right: 2, up: 3 },
    },
    money: simChar.money,
    hunger: simChar.hunger,
    currentMapId: simChar.currentMapId,
    currentNodeId: simChar.currentNodeId,
    position: simChar.position,
    direction: simChar.direction,
  }
}

export function useSimulationSync(options: UseSimulationSyncOptions = {}) {
  const {
    autoConnect = true,
    maxReconnectAttempts = 5,
    reconnectDelay = 3000,
  } = options

  const [state, setState] = useState<SimulationSyncState>({
    isConnected: false,
    isConnecting: false,
    error: null,
    lastTick: 0,
    reconnectAttempts: 0,
    serverCharacters: {},
  })

  const eventSourceRef = useRef<EventSource | null>(null)
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const connectFnRef = useRef<(() => void) | null>(null)

  // Zustand store actions
  const addCharacter = useCharacterStore((s) => s.addCharacter)
  const updateCharacter = useCharacterStore((s) => s.updateCharacter)
  const updatePosition = useCharacterStore((s) => s.updatePosition)
  const updateDirection = useCharacterStore((s) => s.updateDirection)
  const getCharacter = useCharacterStore((s) => s.getCharacter)

  const setCurrentMap = useGameStore((s) => s.setCurrentMap)
  const setTime = useGameStore((s) => s.setTime)

  // Sync state from server to Zustand stores
  const syncStateToStores = useCallback((worldState: SerializedWorldState) => {
    // Update game state
    setCurrentMap(worldState.currentMapId)
    setTime(worldState.time)

    // Update characters
    for (const [id, simChar] of Object.entries(worldState.characters)) {
      const existingChar = getCharacter(id)

      if (!existingChar) {
        // Add new character
        addCharacter(simCharacterToCharacter(simChar))
      } else {
        // Update existing character position and direction
        updatePosition(id, simChar.position)
        updateDirection(id, simChar.direction)
        updateCharacter(id, {
          currentMapId: simChar.currentMapId,
          currentNodeId: simChar.currentNodeId,
          money: simChar.money,
          hunger: simChar.hunger,
        })
      }
    }

    setState((prev) => ({
      ...prev,
      lastTick: worldState.tick,
      serverCharacters: worldState.characters,
    }))
  }, [
    addCharacter,
    getCharacter,
    setCurrentMap,
    setTime,
    updateCharacter,
    updateDirection,
    updatePosition,
  ])

  // Handle SSE message
  const handleMessage = useCallback((event: MessageEvent) => {
    try {
      const message = JSON.parse(event.data) as { type: string; data: SerializedWorldState }

      if (message.type === 'state') {
        syncStateToStores(message.data)
      }
    } catch (error) {
      console.error('[SimulationSync] Failed to parse SSE message:', error)
    }
  }, [syncStateToStores])

  // Connect to SSE
  const connect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
    }

    setState((prev) => ({
      ...prev,
      isConnecting: true,
      error: null,
    }))

    console.log('[SimulationSync] Connecting to SSE...')
    const eventSource = new EventSource('/api/simulation-stream')
    eventSourceRef.current = eventSource

    eventSource.onopen = () => {
      console.log('[SimulationSync] Connected to SSE')
      // Note: Don't set mapsLoaded here - let PixiAppSync set it when client-side maps are actually loaded
      setState((prev) => ({
        ...prev,
        isConnected: true,
        isConnecting: false,
        error: null,
        reconnectAttempts: 0,
      }))
    }

    eventSource.onmessage = handleMessage

    eventSource.onerror = () => {
      console.error('[SimulationSync] SSE connection error')
      eventSource.close()
      eventSourceRef.current = null

      setState((prev) => {
        const newAttempts = prev.reconnectAttempts + 1
        const shouldReconnect = newAttempts <= maxReconnectAttempts

        if (shouldReconnect) {
          console.log(`[SimulationSync] Reconnecting in ${reconnectDelay}ms (attempt ${newAttempts}/${maxReconnectAttempts})`)
          // Use ref to avoid circular dependency
          reconnectTimeoutRef.current = setTimeout(() => {
            connectFnRef.current?.()
          }, reconnectDelay)
        }

        return {
          ...prev,
          isConnected: false,
          isConnecting: shouldReconnect,
          error: shouldReconnect ? 'Connection lost, reconnecting...' : 'Failed to connect to server',
          reconnectAttempts: newAttempts,
        }
      })
    }
  }, [handleMessage, maxReconnectAttempts, reconnectDelay])

  // Keep ref updated with latest connect function
  useEffect(() => {
    connectFnRef.current = connect
  }, [connect])

  // Disconnect from SSE
  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current)
      reconnectTimeoutRef.current = null
    }

    if (eventSourceRef.current) {
      eventSourceRef.current.close()
      eventSourceRef.current = null
    }

    setState((prev) => ({
      ...prev,
      isConnected: false,
      isConnecting: false,
    }))

    console.log('[SimulationSync] Disconnected')
  }, [])

  // Auto-connect on mount - use setTimeout to avoid synchronous setState in effect body
  useEffect(() => {
    if (autoConnect) {
      // Defer connect to avoid React's warning about synchronous setState in effects
      const timeoutId = setTimeout(() => {
        connect()
      }, 0)
      return () => {
        clearTimeout(timeoutId)
        disconnect()
      }
    }
    return () => {
      disconnect()
    }
  }, [autoConnect, connect, disconnect])

  // Send simulation control action
  const sendAction = useCallback(async (action: 'pause' | 'unpause' | 'toggle') => {
    try {
      await fetch('/api/simulation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
    } catch (error) {
      console.error(`[SimulationSync] Failed to ${action}:`, error)
    }
  }, [])

  const pause = useCallback(() => sendAction('pause'), [sendAction])
  const unpause = useCallback(() => sendAction('unpause'), [sendAction])
  const togglePause = useCallback(() => sendAction('toggle'), [sendAction])

  return {
    ...state,
    connect,
    disconnect,
    pause,
    unpause,
    togglePause,
  }
}
