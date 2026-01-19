import { NextResponse } from 'next/server'
import { getLLMErrorHandler } from '@/server/llm'
import type { LLMErrorCode } from '@/server/llm'

// Test error configurations
const ERROR_CONFIGS: Record<string, { message: string; expectedCode: LLMErrorCode }> = {
  rate_limit: { message: 'Rate limit exceeded: 429 Too Many Requests', expectedCode: 'LLM_RATE_LIMIT' },
  timeout: { message: 'Request timed out after 30000ms', expectedCode: 'LLM_TIMEOUT' },
  network: { message: 'fetch failed: ECONNREFUSED', expectedCode: 'LLM_NETWORK_ERROR' },
  api: { message: 'API Error: 401 Unauthorized', expectedCode: 'LLM_API_ERROR' },
  critical: { message: 'LLM client not initialized', expectedCode: 'LLM_NOT_INITIALIZED' },
  unknown: { message: 'An unknown error occurred', expectedCode: 'LLM_UNKNOWN_ERROR' },
}

/**
 * Test endpoint for LLM error handling
 * POST /api/test-error
 *
 * Request body:
 * {
 *   "errorType": "rate_limit" | "timeout" | "network" | "api" | "critical" | "unknown"
 * }
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const body = await request.json()
    const errorType = body.errorType || 'unknown'

    const errorHandler = getLLMErrorHandler()
    const config = ERROR_CONFIGS[errorType] || ERROR_CONFIGS.unknown
    const simulatedError = new Error(config.message)

    const llmError = await errorHandler.handleError(simulatedError, {
      testEndpoint: true,
      requestedType: errorType,
    })

    return NextResponse.json({
      success: true,
      message: 'Error handled successfully',
      error: {
        code: llmError.code,
        message: llmError.message,
        severity: llmError.severity,
        expectedCode: config.expectedCode,
        matchesExpected: llmError.code === config.expectedCode,
      },
      consecutiveFailures: errorHandler.getConsecutiveFailures(),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json(
      {
        success: false,
        message: 'Failed to process test error',
        error: message,
      },
      { status: 500 }
    )
  }
}

/**
 * GET endpoint to check error handler status
 */
export async function GET(): Promise<Response> {
  try {
    const errorHandler = getLLMErrorHandler()

    return NextResponse.json({
      success: true,
      consecutiveFailures: errorHandler.getConsecutiveFailures(),
      webhookConfigured: !!process.env.ERROR_WEBHOOK_URL,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json(
      {
        success: false,
        error: message,
      },
      { status: 500 }
    )
  }
}

/**
 * DELETE endpoint to reset failure count
 */
export async function DELETE(): Promise<Response> {
  try {
    const errorHandler = getLLMErrorHandler()
    const previousCount = errorHandler.getConsecutiveFailures()
    errorHandler.resetFailureCount()

    return NextResponse.json({
      success: true,
      message: 'Failure count reset',
      previousCount,
      currentCount: errorHandler.getConsecutiveFailures(),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json(
      {
        success: false,
        error: message,
      },
      { status: 500 }
    )
  }
}
