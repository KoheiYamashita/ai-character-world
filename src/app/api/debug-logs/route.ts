import { ensureEngineInitialized } from '@/server/simulation'
import { isDebugMode } from '@/lib/debugConfig'
import { NextRequest } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * デバッグログ取得API
 * DEBUG_MODE=true 時のみ有効
 *
 * Query params:
 * - day: 日（省略時は現在日）
 * - characterId: キャラクターID（省略時は全員）
 */
export async function GET(request: NextRequest) {
  // デバッグモードが無効なら空配列を返す
  if (!isDebugMode()) {
    return Response.json([])
  }

  try {
    const engine = await ensureEngineInitialized('[DebugLogs]')
    const store = engine.getStateStore()

    if (!store) {
      return Response.json([])
    }

    const searchParams = request.nextUrl.searchParams
    const dayParam = searchParams.get('day')
    const characterId = searchParams.get('characterId')

    // 日の取得（パラメータまたは現在日）
    let day: number
    if (dayParam) {
      day = parseInt(dayParam, 10)
      if (isNaN(day)) {
        return new Response('Invalid day parameter', { status: 400 })
      }
    } else {
      const state = engine.getState()
      day = state.time.day
    }

    // ログ取得
    let logs
    if (characterId) {
      logs = await store.loadDebugLogsForCharacter(characterId, day)
    } else {
      logs = await store.loadDebugLogsForDay(day)
    }

    return Response.json(logs)
  } catch (error) {
    console.error('[DebugLogs] Error:', error)
    return new Response('Failed to get debug logs', { status: 500 })
  }
}
