import { NextResponse } from 'next/server'
import { z } from 'zod'
import {
  ensureEngineInitialized,
  type SerializedWorldState,
} from '@/server/simulation'

// Request validation schema
const ALLOWED_ACTIONS = ['pause', 'unpause', 'toggle', 'start', 'stop'] as const
const SimulationActionSchema = z.object({
  action: z.enum(ALLOWED_ACTIONS, {
    message: 'Invalid action. Must be one of: pause, unpause, toggle, start, stop',
  }),
})

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
    // Parse and validate request body
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json(
        { success: false, error: 'Invalid JSON in request body' },
        { status: 400 }
      )
    }

    const validation = SimulationActionSchema.safeParse(body)
    if (!validation.success) {
      return NextResponse.json(
        {
          success: false,
          error: validation.error.issues[0]?.message ?? 'Invalid request',
        },
        { status: 400 }
      )
    }

    const { action } = validation.data
    const engine = await ensureEngineInitialized('[API]')

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
