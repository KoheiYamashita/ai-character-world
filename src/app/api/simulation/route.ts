import { NextResponse } from 'next/server'
import {
  ensureEngineInitialized,
  type SerializedWorldState,
} from '@/server/simulation'

// GET - Get current simulation state
export async function GET() {
  try {
    const engine = await ensureEngineInitialized('[API]')
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
    const engine = await ensureEngineInitialized('[API]')
    const body = await request.json()
    const { action } = body as { action: string }

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
