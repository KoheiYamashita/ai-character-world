import { createOpenAI } from '@ai-sdk/openai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import { generateText, generateObject, type LanguageModel, type ModelMessage } from 'ai'
import type { ProviderOptions } from '@ai-sdk/provider-utils'
import type { z } from 'zod'
import { getLLMErrorHandler } from './errorHandler'

/**
 * Options for messages-based LLM calls
 */
export interface LLMMessagesOptions {
  /** System prompt */
  system?: string
  /** Whether to enable cache for system prompt on Anthropic (default: true) */
  cacheSystem?: boolean
}

// Internal state
let model: LanguageModel | null = null
let modelString: string | null = null

/**
 * Parse model string
 * "openai/chat/gpt-4o-mini" → { provider: "openai", subType: "chat", model: "gpt-4o-mini" }
 * "openai/chat/nvidia/nemotron-3-nano" → { provider: "openai", subType: "chat", model: "nvidia/nemotron-3-nano" }
 * "anthropic/claude-sonnet-4" → { provider: "anthropic", model: "claude-sonnet-4" }
 */
function parseModelString(str: string): { provider: string; subType?: string; model: string } {
  const parts = str.split('/')
  if (parts.length >= 3) {
    // First part is provider, second is subType, rest is model (may contain slashes)
    return { provider: parts[0], subType: parts[1], model: parts.slice(2).join('/') }
  }
  if (parts.length === 2) {
    return { provider: parts[0], model: parts[1] }
  }
  throw new Error(`Invalid model string: ${str}`)
}

/**
 * Create LanguageModel from provider, subType, and modelId
 * Uses LLM_API_KEY and optional LLM_BASE_URL for all providers
 */
function createLanguageModel(
  provider: string,
  subType: string | undefined,
  modelId: string
): LanguageModel {
  const apiKey = process.env.LLM_API_KEY
  if (!apiKey) {
    throw new Error('LLM_API_KEY not set')
  }

  const baseURL = process.env.LLM_BASE_URL

  switch (provider) {
    case 'openai': {
      const openai = createOpenAI({ apiKey, baseURL })
      if (subType === 'chat') {
        return openai.chat(modelId)
      }
      return openai(modelId)
    }
    case 'anthropic': {
      const anthropic = createAnthropic({ apiKey, baseURL })
      return anthropic(modelId)
    }
    case 'gemini':
    case 'google': {
      const google = createGoogleGenerativeAI({ apiKey, baseURL })
      return google(modelId)
    }
    case 'openrouter': {
      const openrouter = createOpenRouter({ apiKey })
      const fullModelId = subType ? `${subType}/${modelId}` : modelId
      return openrouter.chat(fullModelId)
    }
    default:
      throw new Error(`Unknown provider: ${provider}`)
  }
}

/**
 * Initialize LLM client (reads from environment variables)
 */
export function initializeLLMClient(): void {
  const llmModel = process.env.LLM_MODEL
  if (!llmModel) {
    console.warn('[LLM] LLM_MODEL not set, LLM features disabled')
    return
  }

  try {
    const parsed = parseModelString(llmModel)
    model = createLanguageModel(parsed.provider, parsed.subType, parsed.model)
    modelString = llmModel
    const baseURL = process.env.LLM_BASE_URL
    console.log(`[LLM] Client initialized: ${llmModel}${baseURL ? ` (baseURL: ${baseURL})` : ''}`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[LLM] Failed to initialize (${llmModel}): ${message}`)
  }
}

/**
 * Check if LLM is available
 */
export function isLLMAvailable(): boolean {
  return model !== null
}

/**
 * Generate text
 */
export async function llmGenerateText(
  prompt: string,
  options?: { system?: string }
): Promise<string> {
  const errorHandler = getLLMErrorHandler()

  if (!model) {
    const error = new Error('LLM client not initialized')
    await errorHandler.handleError(error, { operation: 'generateText', reason: 'not_initialized' })
    throw error
  }

  try {
    const result = await generateText({
      model,
      prompt,
      system: options?.system,
    })

    errorHandler.resetFailureCount()
    return result.text
  } catch (error) {
    await errorHandler.handleError(error, { operation: 'generateText', prompt: prompt.substring(0, 100) })
    throw error
  }
}

/**
 * Generate structured output
 */
export async function llmGenerateObject<T>(
  prompt: string,
  schema: z.Schema<T>,
  options?: { system?: string }
): Promise<T> {
  const errorHandler = getLLMErrorHandler()

  if (!model) {
    const error = new Error('LLM client not initialized')
    await errorHandler.handleError(error, { operation: 'generateObject', reason: 'not_initialized' })
    throw error
  }

  try {
    const result = await generateObject({
      model,
      prompt,
      schema,
      system: options?.system,
    })

    errorHandler.resetFailureCount()
    return result.object
  } catch (error) {
    await errorHandler.handleError(error, { operation: 'generateObject', prompt: prompt.substring(0, 100) })
    throw error
  }
}

/**
 * Shutdown LLM client
 */
export function shutdownLLMClient(): void {
  model = null
  modelString = null
  console.log('[LLM] Client shutdown')
}

/**
 * Get current model string
 */
export function getLLMModelString(): string | null {
  return modelString
}

/**
 * Check if current model is Anthropic
 */
function isAnthropicModel(): boolean {
  return modelString?.startsWith('anthropic/') ?? false
}

/**
 * Build provider options for cache control
 * Returns cache control options for Anthropic models unless explicitly disabled
 */
function buildProviderOptions(cacheSystem: boolean | undefined): ProviderOptions | undefined {
  if (!isAnthropicModel() || cacheSystem === false) {
    return undefined
  }
  return {
    anthropic: {
      cacheControl: { type: 'ephemeral' as const },
    },
  }
}

/**
 * Generate text with messages array
 */
export async function llmGenerateTextWithMessages(
  messages: ModelMessage[],
  options?: LLMMessagesOptions
): Promise<string> {
  const errorHandler = getLLMErrorHandler()

  if (!model) {
    const error = new Error('LLM client not initialized')
    await errorHandler.handleError(error, { operation: 'generateTextWithMessages', reason: 'not_initialized' })
    throw error
  }

  try {
    const providerOptions = buildProviderOptions(options?.cacheSystem)
    const result = await generateText({
      model,
      messages,
      system: options?.system,
      providerOptions,
    })

    errorHandler.resetFailureCount()
    return result.text
  } catch (error) {
    await errorHandler.handleError(error, { operation: 'generateTextWithMessages' })
    throw error
  }
}

/**
 * Generate structured output with messages array
 */
export async function llmGenerateObjectWithMessages<T>(
  messages: ModelMessage[],
  schema: z.Schema<T>,
  options?: LLMMessagesOptions
): Promise<T> {
  const errorHandler = getLLMErrorHandler()

  if (!model) {
    const error = new Error('LLM client not initialized')
    await errorHandler.handleError(error, { operation: 'generateObjectWithMessages', reason: 'not_initialized' })
    throw error
  }

  try {
    const providerOptions = buildProviderOptions(options?.cacheSystem)
    const result = await generateObject({
      model,
      messages,
      schema,
      system: options?.system,
      providerOptions,
    })

    errorHandler.resetFailureCount()
    return result.object
  } catch (error) {
    await errorHandler.handleError(error, { operation: 'generateObjectWithMessages' })
    throw error
  }
}
