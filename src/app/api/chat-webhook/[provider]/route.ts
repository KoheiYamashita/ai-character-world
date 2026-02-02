/**
 * チャットWebhookエンドポイント
 * Gateway Botからのメッセージを受信し、SimulationEngineに転送する
 *
 * POST /api/chat-webhook/[provider]
 */

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import type { ChatProviderId } from '@/types/chat'
import { ensureEngineInitialized } from '@/server/simulation'
import { getChatProvider } from '@/server/chat'

// 環境変数から認証シークレットを取得
const GATEWAY_SECRET = process.env.CHAT_DISCORD_GATEWAY_SECRET

interface RouteParams {
  params: Promise<{
    provider: string
  }>
}

export async function POST(
  request: NextRequest,
  { params }: RouteParams
): Promise<Response> {
  const { provider } = await params

  // Validate provider
  const validProviders: ChatProviderId[] = ['discord', 'slack', 'line']
  if (!validProviders.includes(provider as ChatProviderId)) {
    return NextResponse.json(
      { error: 'Invalid provider' },
      { status: 400 }
    )
  }

  const providerId = provider as ChatProviderId

  // Verify gateway secret (internal authentication)
  const gatewaySecret = request.headers.get('X-Gateway-Secret')
  if (!GATEWAY_SECRET || gatewaySecret !== GATEWAY_SECRET) {
    console.warn(`[ChatWebhook] Invalid gateway secret for ${providerId}`)
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    )
  }

  // Get provider
  const chatProvider = getChatProvider(providerId)
  if (!chatProvider || !chatProvider.isReady()) {
    console.warn(`[ChatWebhook] Provider ${providerId} not available`)
    return NextResponse.json(
      { error: 'Provider not available' },
      { status: 503 }
    )
  }

  // Parse request body
  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON' },
      { status: 400 }
    )
  }

  // Parse webhook payload using provider
  const message = chatProvider.parseWebhookPayload(payload)
  if (!message) {
    console.warn(`[ChatWebhook] Invalid payload for ${providerId}`)
    return NextResponse.json(
      { error: 'Invalid payload' },
      { status: 400 }
    )
  }

  // Get simulation engine
  let engine
  try {
    engine = await ensureEngineInitialized('[ChatWebhook]')
  } catch {
    console.warn('[ChatWebhook] Simulation engine not available')
    return NextResponse.json(
      { error: 'Engine not available' },
      { status: 503 }
    )
  }

  // Forward message to engine
  try {
    engine.receiveExternalChatMessage(message)
    console.log(`[ChatWebhook] Received ${providerId} message from ${message.senderName}: "${message.content.substring(0, 50)}..."`)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error(`[ChatWebhook] Error processing message:`, error)
    return NextResponse.json(
      { error: 'Internal error' },
      { status: 500 }
    )
  }
}

// Health check
export async function GET(
  _request: NextRequest,
  { params }: RouteParams
): Promise<Response> {
  const { provider } = await params

  const validProviders: ChatProviderId[] = ['discord', 'slack', 'line']
  if (!validProviders.includes(provider as ChatProviderId)) {
    return NextResponse.json(
      { error: 'Invalid provider' },
      { status: 400 }
    )
  }

  const chatProvider = getChatProvider(provider as ChatProviderId)
  const isReady = chatProvider?.isReady() ?? false

  return NextResponse.json({
    provider,
    ready: isReady,
  })
}
