import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Mock AI SDK providers
vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: vi.fn(() => {
    const provider = (modelId: string) => ({ modelId, provider: 'openai' })
    provider.chat = (modelId: string) => ({ modelId, provider: 'openai', type: 'chat' })
    return provider
  }),
}))

vi.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: vi.fn(() => {
    return (modelId: string) => ({ modelId, provider: 'anthropic' })
  }),
}))

vi.mock('@ai-sdk/google', () => ({
  createGoogleGenerativeAI: vi.fn(() => {
    return (modelId: string) => ({ modelId, provider: 'google' })
  }),
}))

vi.mock('ai', () => ({
  generateText: vi.fn(async () => ({ text: 'generated text' })),
  generateObject: vi.fn(async () => ({ object: { key: 'value' } })),
}))

vi.mock('./errorHandler', () => ({
  getLLMErrorHandler: vi.fn(() => ({
    handleError: vi.fn(async () => ({})),
    resetFailureCount: vi.fn(),
  })),
}))

describe('client', () => {
  let client: typeof import('./client')

  beforeEach(async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    // Reset module state for each test
    vi.resetModules()
    client = await import('./client')
  })

  afterEach(() => {
    vi.restoreAllMocks()
    delete process.env.LLM_MODEL
    delete process.env.LLM_API_KEY
    delete process.env.LLM_BASE_URL
  })

  describe('initializeLLMClient', () => {
    it('should warn when LLM_MODEL is not set', () => {
      delete process.env.LLM_MODEL
      client.initializeLLMClient()
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('LLM_MODEL not set')
      )
      expect(client.isLLMAvailable()).toBe(false)
    })

    it('should initialize with openai/chat model', () => {
      process.env.LLM_MODEL = 'openai/chat/gpt-4o-mini'
      process.env.LLM_API_KEY = 'test-key'
      client.initializeLLMClient()
      expect(client.isLLMAvailable()).toBe(true)
      expect(client.getLLMModelString()).toBe('openai/chat/gpt-4o-mini')
    })

    it('should initialize with anthropic model', () => {
      process.env.LLM_MODEL = 'anthropic/claude-sonnet-4'
      process.env.LLM_API_KEY = 'test-key'
      client.initializeLLMClient()
      expect(client.isLLMAvailable()).toBe(true)
    })

    it('should handle initialization errors', () => {
      process.env.LLM_MODEL = 'invalid'
      client.initializeLLMClient()
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to initialize')
      )
    })
  })

  describe('isLLMAvailable', () => {
    it('should return false before initialization', () => {
      expect(client.isLLMAvailable()).toBe(false)
    })

    it('should return true after successful initialization', () => {
      process.env.LLM_MODEL = 'openai/chat/gpt-4o-mini'
      process.env.LLM_API_KEY = 'test-key'
      client.initializeLLMClient()
      expect(client.isLLMAvailable()).toBe(true)
    })
  })

  describe('llmGenerateText', () => {
    it('should throw when not initialized', async () => {
      await expect(client.llmGenerateText('hello')).rejects.toThrow('LLM client not initialized')
    })

    it('should return generated text when initialized', async () => {
      process.env.LLM_MODEL = 'openai/chat/gpt-4o-mini'
      process.env.LLM_API_KEY = 'test-key'
      client.initializeLLMClient()
      const result = await client.llmGenerateText('hello')
      expect(result).toBe('generated text')
    })
  })

  describe('llmGenerateObject', () => {
    it('should throw when not initialized', async () => {
      const { z } = await import('zod')
      const schema = z.object({ key: z.string() })
      await expect(client.llmGenerateObject('hello', schema)).rejects.toThrow('LLM client not initialized')
    })

    it('should return generated object when initialized', async () => {
      process.env.LLM_MODEL = 'openai/chat/gpt-4o-mini'
      process.env.LLM_API_KEY = 'test-key'
      client.initializeLLMClient()
      const { z } = await import('zod')
      const schema = z.object({ key: z.string() })
      const result = await client.llmGenerateObject('hello', schema)
      expect(result).toEqual({ key: 'value' })
    })
  })

  describe('shutdownLLMClient', () => {
    it('should make LLM unavailable', () => {
      process.env.LLM_MODEL = 'openai/chat/gpt-4o-mini'
      process.env.LLM_API_KEY = 'test-key'
      client.initializeLLMClient()
      expect(client.isLLMAvailable()).toBe(true)
      client.shutdownLLMClient()
      expect(client.isLLMAvailable()).toBe(false)
      expect(client.getLLMModelString()).toBeNull()
    })
  })

  describe('getLLMModelString', () => {
    it('should return null before initialization', () => {
      expect(client.getLLMModelString()).toBeNull()
    })

    it('should return model string after initialization', () => {
      process.env.LLM_MODEL = 'anthropic/claude-sonnet-4'
      process.env.LLM_API_KEY = 'test-key'
      client.initializeLLMClient()
      expect(client.getLLMModelString()).toBe('anthropic/claude-sonnet-4')
    })
  })
})
