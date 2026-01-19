import type { ErrorConfig } from '@/types/config'

// Error type definitions
export type LLMErrorCode =
  | 'LLM_NOT_INITIALIZED'
  | 'LLM_API_ERROR'
  | 'LLM_RATE_LIMIT'
  | 'LLM_TIMEOUT'
  | 'LLM_INVALID_RESPONSE'
  | 'LLM_NETWORK_ERROR'
  | 'LLM_UNKNOWN_ERROR'

export type LLMErrorSeverity = 'warning' | 'error' | 'critical'

export interface LLMError {
  code: LLMErrorCode
  message: string
  severity: LLMErrorSeverity
  cause?: Error
  context?: Record<string, unknown>
  timestamp: number
}

// Default configuration
const DEFAULT_ERROR_CONFIG: Required<ErrorConfig> = {
  pauseOnCriticalError: true,
  maxConsecutiveFailures: 3,
  webhookTimeoutMs: 10000,
}

export class LLMErrorHandler {
  private config: Required<ErrorConfig>
  private consecutiveFailures: number = 0

  constructor(config?: ErrorConfig) {
    this.config = { ...DEFAULT_ERROR_CONFIG, ...config }
  }

  /**
   * Handle an error from LLM operations
   */
  async handleError(error: unknown, context?: Record<string, unknown>): Promise<LLMError> {
    const llmError = this.normalizeError(error, context)
    this.consecutiveFailures++

    console.error(`[LLMErrorHandler] Error (${llmError.code}): ${llmError.message}`, {
      severity: llmError.severity,
      consecutiveFailures: this.consecutiveFailures,
      context: llmError.context,
    })

    // Determine if simulation should pause
    const shouldPause = this.shouldPauseSimulation(llmError)

    // Send webhook notification (non-blocking)
    this.sendWebhookNotification(llmError, shouldPause).catch((webhookError) => {
      console.error('[LLMErrorHandler] Webhook notification failed:', webhookError)
    })

    // Pause simulation if needed
    if (shouldPause) {
      await this.pauseSimulation()
    }

    return llmError
  }

  /**
   * Reset failure count (call on successful operation)
   */
  resetFailureCount(): void {
    if (this.consecutiveFailures > 0) {
      console.log(`[LLMErrorHandler] Failure count reset (was ${this.consecutiveFailures})`)
      this.consecutiveFailures = 0
    }
  }

  /**
   * Get current consecutive failure count
   */
  getConsecutiveFailures(): number {
    return this.consecutiveFailures
  }

  /**
   * Normalize various error types to LLMError
   */
  private normalizeError(error: unknown, context?: Record<string, unknown>): LLMError {
    const timestamp = Date.now()
    const message = error instanceof Error ? error.message : String(error)
    const cause = error instanceof Error ? error : undefined

    const classification = this.classifyError(message)

    return {
      code: classification.code,
      message,
      severity: classification.severity,
      cause,
      context,
      timestamp,
    }
  }

  /**
   * Classify error message into code and severity
   */
  private classifyError(message: string): { code: LLMErrorCode; severity: LLMErrorSeverity } {
    const lowerMessage = message.toLowerCase()

    // Error patterns mapped to their classification
    const patterns: Array<{
      keywords: string[]
      code: LLMErrorCode
      severity: LLMErrorSeverity
    }> = [
      {
        keywords: ['rate limit', '429', 'too many requests'],
        code: 'LLM_RATE_LIMIT',
        severity: 'warning',
      },
      {
        keywords: ['timeout', 'timed out', 'etimedout'],
        code: 'LLM_TIMEOUT',
        severity: 'error',
      },
      {
        keywords: ['network', 'econnrefused', 'enotfound', 'fetch failed'],
        code: 'LLM_NETWORK_ERROR',
        severity: 'error',
      },
      {
        keywords: ['not initialized', 'not configured'],
        code: 'LLM_NOT_INITIALIZED',
        severity: 'critical',
      },
      {
        keywords: ['invalid', 'parse', 'schema'],
        code: 'LLM_INVALID_RESPONSE',
        severity: 'warning',
      },
      {
        keywords: ['401', '403', 'unauthorized', 'forbidden', 'quota'],
        code: 'LLM_API_ERROR',
        severity: 'critical',
      },
    ]

    for (const pattern of patterns) {
      if (pattern.keywords.some((keyword) => lowerMessage.includes(keyword))) {
        return { code: pattern.code, severity: pattern.severity }
      }
    }

    // Default classification for unknown errors
    return { code: 'LLM_UNKNOWN_ERROR', severity: 'error' }
  }

  /**
   * Determine if simulation should be paused
   */
  private shouldPauseSimulation(error: LLMError): boolean {
    if (!this.config.pauseOnCriticalError) {
      return false
    }

    return (
      error.severity === 'critical' ||
      this.consecutiveFailures >= this.config.maxConsecutiveFailures
    )
  }

  /**
   * Send webhook notification
   */
  private async sendWebhookNotification(error: LLMError, willPause: boolean): Promise<void> {
    const webhookUrl = process.env.ERROR_WEBHOOK_URL
    if (!webhookUrl) {
      return
    }

    const payload = {
      type: 'llm_error',
      timestamp: new Date(error.timestamp).toISOString(),
      error: {
        code: error.code,
        message: error.message,
        severity: error.severity,
      },
      simulation: {
        willPause,
        consecutiveFailures: this.consecutiveFailures,
      },
      // Slack-compatible text field
      text: `[${error.severity.toUpperCase()}] LLM Error: ${error.code}\n${error.message}${willPause ? '\nSimulation will pause.' : ''}`,
    }

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), this.config.webhookTimeoutMs)

    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      })

      if (!response.ok) {
        console.warn(`[LLMErrorHandler] Webhook returned ${response.status}`)
      } else {
        console.log('[LLMErrorHandler] Webhook notification sent')
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        console.warn('[LLMErrorHandler] Webhook request timed out')
      } else {
        throw err
      }
    } finally {
      clearTimeout(timeoutId)
    }
  }

  /**
   * Pause simulation (uses dynamic import to avoid circular dependencies)
   */
  private async pauseSimulation(): Promise<void> {
    try {
      const { getSimulationEngine } = await import('../simulation/SimulationEngine')
      const engine = getSimulationEngine()

      if (engine.isInitialized() && !engine.isPaused()) {
        engine.pause()
        console.log('[LLMErrorHandler] Simulation paused due to error')
      }
    } catch (err) {
      console.error('[LLMErrorHandler] Failed to pause simulation:', err)
    }
  }
}

// Singleton instance
let errorHandler: LLMErrorHandler | null = null

/**
 * Initialize the LLM error handler
 */
export function initializeLLMErrorHandler(config?: ErrorConfig): void {
  errorHandler = new LLMErrorHandler(config)
  console.log('[LLMErrorHandler] Initialized')
}

/**
 * Get the LLM error handler instance
 */
export function getLLMErrorHandler(): LLMErrorHandler {
  if (!errorHandler) {
    // Auto-initialize with defaults if not explicitly initialized
    errorHandler = new LLMErrorHandler()
    console.log('[LLMErrorHandler] Auto-initialized with defaults')
  }
  return errorHandler
}

/**
 * Reset the error handler (for testing)
 */
export function resetLLMErrorHandler(): void {
  errorHandler = null
}
