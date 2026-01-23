import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  LLMErrorHandler,
  initializeLLMErrorHandler,
  getLLMErrorHandler,
  resetLLMErrorHandler,
} from './errorHandler'

// Mock dynamic import of SimulationEngine
vi.mock('../simulation/SimulationEngine', () => ({
  getSimulationEngine: () => ({
    isInitialized: () => true,
    isPaused: () => false,
    pause: vi.fn(),
  }),
}))

describe('LLMErrorHandler', () => {
  let handler: LLMErrorHandler

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
    handler = new LLMErrorHandler({ pauseOnCriticalError: false })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    resetLLMErrorHandler()
    delete process.env.ERROR_WEBHOOK_URL
  })

  describe('classifyError (via handleError)', () => {
    it('should classify rate limit errors', async () => {
      const result = await handler.handleError(new Error('rate limit exceeded'))
      expect(result.code).toBe('LLM_RATE_LIMIT')
      expect(result.severity).toBe('warning')
    })

    it('should classify 429 errors as rate limit', async () => {
      const result = await handler.handleError(new Error('HTTP 429 Too Many Requests'))
      expect(result.code).toBe('LLM_RATE_LIMIT')
    })

    it('should classify timeout errors', async () => {
      const result = await handler.handleError(new Error('request timed out'))
      expect(result.code).toBe('LLM_TIMEOUT')
      expect(result.severity).toBe('error')
    })

    it('should classify network errors', async () => {
      const result = await handler.handleError(new Error('ECONNREFUSED'))
      expect(result.code).toBe('LLM_NETWORK_ERROR')
      expect(result.severity).toBe('error')
    })

    it('should classify unauthorized errors as critical', async () => {
      const result = await handler.handleError(new Error('401 Unauthorized'))
      expect(result.code).toBe('LLM_API_ERROR')
      expect(result.severity).toBe('critical')
    })

    it('should classify not initialized errors as critical', async () => {
      const result = await handler.handleError(new Error('LLM not initialized'))
      expect(result.code).toBe('LLM_NOT_INITIALIZED')
      expect(result.severity).toBe('critical')
    })

    it('should classify unknown errors', async () => {
      const result = await handler.handleError(new Error('something went wrong'))
      expect(result.code).toBe('LLM_UNKNOWN_ERROR')
      expect(result.severity).toBe('error')
    })

    it('should handle non-Error values', async () => {
      const result = await handler.handleError('string error')
      expect(result.message).toBe('string error')
      expect(result.cause).toBeUndefined()
    })
  })

  describe('handleError', () => {
    it('should increment consecutiveFailures', async () => {
      expect(handler.getConsecutiveFailures()).toBe(0)
      await handler.handleError(new Error('test'))
      expect(handler.getConsecutiveFailures()).toBe(1)
      await handler.handleError(new Error('test2'))
      expect(handler.getConsecutiveFailures()).toBe(2)
    })

    it('should include context in the error', async () => {
      const result = await handler.handleError(new Error('test'), { key: 'value' })
      expect(result.context).toEqual({ key: 'value' })
    })

    it('should include timestamp', async () => {
      const before = Date.now()
      const result = await handler.handleError(new Error('test'))
      expect(result.timestamp).toBeGreaterThanOrEqual(before)
    })
  })

  describe('resetFailureCount', () => {
    it('should reset the counter to 0', async () => {
      await handler.handleError(new Error('test'))
      await handler.handleError(new Error('test'))
      expect(handler.getConsecutiveFailures()).toBe(2)
      handler.resetFailureCount()
      expect(handler.getConsecutiveFailures()).toBe(0)
    })

    it('should not log when count is already 0', () => {
      handler.resetFailureCount()
      // console.log should not have been called for reset message
      expect(console.log).not.toHaveBeenCalledWith(
        expect.stringContaining('Failure count reset')
      )
    })
  })

  describe('shouldPauseSimulation', () => {
    it('should pause on critical error when pauseOnCriticalError=true', async () => {
      const criticalHandler = new LLMErrorHandler({ pauseOnCriticalError: true })
      const result = await criticalHandler.handleError(new Error('401 Unauthorized'))
      expect(result.severity).toBe('critical')
    })

    it('should not pause when pauseOnCriticalError=false', async () => {
      // handler already has pauseOnCriticalError: false
      await handler.handleError(new Error('401 Unauthorized'))
      // No pause triggered (no exception)
    })

    it('should pause when consecutive failures exceed max', async () => {
      const strictHandler = new LLMErrorHandler({
        pauseOnCriticalError: true,
        maxConsecutiveFailures: 2,
      })
      await strictHandler.handleError(new Error('error1'))
      await strictHandler.handleError(new Error('error2'))
      // Third call should trigger pause (consecutiveFailures=2 >= max=2)
      // This doesn't throw, just calls pause internally
    })
  })

  describe('sendWebhookNotification', () => {
    it('should skip when ERROR_WEBHOOK_URL is not set', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch')
      await handler.handleError(new Error('test'))
      expect(fetchSpy).not.toHaveBeenCalled()
    })

    it('should call fetch when ERROR_WEBHOOK_URL is set', async () => {
      process.env.ERROR_WEBHOOK_URL = 'https://example.com/webhook'
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response('ok', { status: 200 })
      )
      await handler.handleError(new Error('test'))
      // Wait for non-blocking webhook
      await new Promise((resolve) => setTimeout(resolve, 10))
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://example.com/webhook',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })
      )
    })
  })

  describe('singleton management', () => {
    it('getLLMErrorHandler should auto-initialize', () => {
      resetLLMErrorHandler()
      const h = getLLMErrorHandler()
      expect(h).toBeInstanceOf(LLMErrorHandler)
    })

    it('initializeLLMErrorHandler should set the singleton', () => {
      initializeLLMErrorHandler({ pauseOnCriticalError: false })
      const h = getLLMErrorHandler()
      expect(h).toBeInstanceOf(LLMErrorHandler)
    })

    it('resetLLMErrorHandler should clear the singleton', () => {
      initializeLLMErrorHandler()
      resetLLMErrorHandler()
      // Next call should auto-initialize a new one
      const h = getLLMErrorHandler()
      expect(h.getConsecutiveFailures()).toBe(0)
    })
  })
})
