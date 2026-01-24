import { ensureEngineInitialized } from '@/server/simulation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const engine = await ensureEngineInitialized('[ActivityLog]')
    const logs = await engine.getTodayLogs()
    return Response.json(logs)
  } catch (error) {
    console.error('[ActivityLog] Error:', error)
    return new Response('Failed to get activity logs', { status: 500 })
  }
}
