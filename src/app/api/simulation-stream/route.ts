import {
  ensureEngineInitialized,
  type SerializedWorldState,
} from '@/server/simulation'
import type { ActivityLogEntry } from '@/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  let engine
  try {
    engine = await ensureEngineInitialized('[SSE]')
  } catch (error) {
    console.error('[SSE] Engine initialization failed:', error)
    return new Response('Failed to initialize simulation', { status: 500 })
  }

  const encoder = new TextEncoder()
  let unsubscribeState: (() => void) | null = null
  let unsubscribeLogs: (() => void) | null = null

  const stream = new ReadableStream({
    start(controller) {

      // Send initial state immediately
      const initialState = engine.getState()
      const initialMessage = `data: ${JSON.stringify({ type: 'state', data: initialState })}\n\n`
      controller.enqueue(encoder.encode(initialMessage))

      // Subscribe to state changes
      unsubscribeState = engine.subscribe((state: SerializedWorldState) => {
        try {
          const message = `data: ${JSON.stringify({ type: 'state', data: state })}\n\n`
          controller.enqueue(encoder.encode(message))
        } catch {
          // Stream closed, will be handled by cancel
          console.log('[SSE] Error sending state, client likely disconnected')
        }
      })

      // Subscribe to log events
      unsubscribeLogs = engine.subscribeToLogs((entry: ActivityLogEntry) => {
        try {
          const message = `data: ${JSON.stringify({ type: 'log', data: entry })}\n\n`
          controller.enqueue(encoder.encode(message))
        } catch {
          console.log('[SSE] Error sending log, client likely disconnected')
        }
      })

      console.log(`[SSE] Client connected. Total subscribers: ${engine.getSubscriberCount()}`)
    },

    cancel() {
      if (unsubscribeState) {
        unsubscribeState()
        unsubscribeState = null
      }
      if (unsubscribeLogs) {
        unsubscribeLogs()
        unsubscribeLogs = null
      }
      console.log('[SSE] Client disconnected')
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // Disable nginx buffering
    },
  })
}
