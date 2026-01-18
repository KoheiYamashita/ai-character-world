import { NextResponse } from 'next/server'
import {
  getSimulationEngine,
  loadGameDataServer,
  type SerializedWorldState,
} from '@/server/simulation'

// Flag to track if engine has been initialized
let engineInitialized = false

// Initialize and start the simulation engine
async function ensureEngineRunning(): Promise<void> {
  const engine = getSimulationEngine()

  if (!engineInitialized) {
    console.log('[API] Initializing simulation engine...')
    try {
      const { maps, characters, config, npcBlockedNodes, npcs } = await loadGameDataServer()
      await engine.initialize(maps, characters, config.initialState.mapId, config.initialState.time, npcBlockedNodes, npcs)
      engine.start()
      engineInitialized = true
      console.log('[API] Simulation engine started')
    } catch (error) {
      console.error('[API] Failed to initialize simulation engine:', error)
      throw error
    }
  }
}

// GET - Get current simulation state
export async function GET() {
  try {
    await ensureEngineRunning()

    const engine = getSimulationEngine()
    const state: SerializedWorldState = engine.getState()

    return NextResponse.json({
      success: true,
      state,
      meta: {
        tickRate: engine.getTickRate(),
        isPaused: engine.isPaused(),
        isRunning: engine.isSimulationRunning(),
        subscriberCount: engine.getSubscriberCount(),
      },
    })
  } catch (error) {
    console.error('[API] Error getting simulation state:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to get simulation state' },
      { status: 500 }
    )
  }
}

// POST - Control simulation (pause/unpause/restart)
export async function POST(request: Request) {
  try {
    await ensureEngineRunning()

    const body = await request.json()
    const { action } = body as { action: string }

    const engine = getSimulationEngine()

    switch (action) {
      case 'pause':
        engine.pause()
        break
      case 'unpause':
        engine.unpause()
        break
      case 'toggle':
        engine.togglePause()
        break
      case 'start':
        engine.start()
        break
      case 'stop':
        engine.stop()
        break
      default:
        return NextResponse.json(
          { success: false, error: `Unknown action: ${action}` },
          { status: 400 }
        )
    }

    return NextResponse.json({
      success: true,
      isPaused: engine.isPaused(),
      isRunning: engine.isSimulationRunning(),
    })
  } catch (error) {
    console.error('[API] Error controlling simulation:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to control simulation' },
      { status: 500 }
    )
  }
}
