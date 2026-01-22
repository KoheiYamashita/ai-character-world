'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useCharacterStore, useWorldStore, useNPCStore } from '@/stores'
import type { SerializedWorldState, SimCharacter, SimNPC } from '@/server/simulation/types'
import type { Character } from '@/types'

interface SimulationSyncState {
  isConnected: boolean
  isConnecting: boolean
  error: string | null
  lastTick: number
  reconnectAttempts: number
  serverCharacters: Record<string, SimCharacter>
  serverNPCs: Record<string, SimNPC>
}

interface UseSimulationSyncOptions {
  autoConnect?: boolean
  maxReconnectAttempts?: number
  reconnectDelay?: number
}

const INITIAL_STATE: SimulationSyncState = {
  isConnected: false,
  isConnecting: false,
  error: null,
  lastTick: 0,
  reconnectAttempts: 0,
  serverCharacters: {},
  serverNPCs: {},
}

// Convert SimCharacter from server to client Character
// Server now includes sprite info from characters.json
function simCharacterToCharacter(simChar: SimCharacter): Character {
  return {
    id: simChar.id,
    name: simChar.name,
    sprite: simChar.sprite,
    money: simChar.money,
    satiety: simChar.satiety,
    energy: simChar.energy,
    hygiene: simChar.hygiene,
    mood: simChar.mood,
    bladder: simChar.bladder,
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

  const [state, setState] = useState<SimulationSyncState>(INITIAL_STATE)

  const eventSourceRef = useRef<EventSource | null>(null)
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const connectFnRef = useRef<(() => void) | null>(null)

  // Zustand store actions
  const addCharacter = useCharacterStore((s) => s.addCharacter)
  const updateCharacter = useCharacterStore((s) => s.updateCharacter)
  const updatePosition = useCharacterStore((s) => s.updatePosition)
  const updateDirection = useCharacterStore((s) => s.updateDirection)
  const getCharacter = useCharacterStore((s) => s.getCharacter)
  const setActiveCharacter = useCharacterStore((s) => s.setActiveCharacter)

  const setCurrentMap = useWorldStore((s) => s.setCurrentMap)
  const setTime = useWorldStore((s) => s.setTime)
  const setServerCharacters = useWorldStore((s) => s.setServerCharacters)

  const updateNPC = useNPCStore((s) => s.updateNPC)

  // Sync state from server to Zustand stores
  // Note: Zustand store actions are stable references, so they don't need to be in the dependency array
  const syncStateToStores = useCallback((worldState: SerializedWorldState) => {
    // Update world state
    setCurrentMap(worldState.currentMapId)
    setTime(worldState.time)

    // Update characters
    const characterIds = Object.keys(worldState.characters)
    for (const [id, simChar] of Object.entries(worldState.characters)) {
      const existingChar = getCharacter(id)

      if (existingChar) {
        // Update existing character
        updatePosition(id, simChar.position)
        updateDirection(id, simChar.direction)
        updateCharacter(id, {
          currentMapId: simChar.currentMapId,
          currentNodeId: simChar.currentNodeId,
          money: simChar.money,
          satiety: simChar.satiety,
          energy: simChar.energy,
          hygiene: simChar.hygiene,
          mood: simChar.mood,
          bladder: simChar.bladder,
        })
      } else {
        // Add new character (sprite info comes from server)
        addCharacter(simCharacterToCharacter(simChar))
      }
    }

    // Set active character if not already set (first character from server)
    const currentActiveId = useCharacterStore.getState().activeCharacterId
    if (!currentActiveId && characterIds.length > 0) {
      setActiveCharacter(characterIds[0])
    }

    // Sync NPC state (direction and conversation state)
    for (const [id, simNPC] of Object.entries(worldState.npcs)) {
      updateNPC(id, {
        direction: simNPC.direction,
        isInConversation: simNPC.isInConversation,
      })
    }

    // Sync server characters to world store for global access
    setServerCharacters(worldState.characters)

    setState((prev) => ({
      ...prev,
      lastTick: worldState.tick,
      serverCharacters: worldState.characters,
      serverNPCs: worldState.npcs,
    }))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
    if (!autoConnect) {
      return disconnect
    }

    // Defer connect to avoid React's warning about synchronous setState in effects
    const timeoutId = setTimeout(connect, 0)
    return () => {
      clearTimeout(timeoutId)
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
