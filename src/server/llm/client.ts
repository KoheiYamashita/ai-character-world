import { createOpenAI } from '@ai-sdk/openai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { generateText, generateObject, type LanguageModel } from 'ai'
import type { z } from 'zod'

// Internal state
let model: LanguageModel | null = null
let modelString: string | null = null

/**
 * Parse model string
 * "openai/chat/gpt-4o-mini" → { provider: "openai", subType: "chat", model: "gpt-4o-mini" }
 * "anthropic/claude-sonnet-4" → { provider: "anthropic", model: "claude-sonnet-4" }
 */
function parseModelString(str: string): { provider: string; subType?: string; model: string } {
  const parts = str.split('/')
  if (parts.length === 3) {
    return { provider: parts[0], subType: parts[1], model: parts[2] }
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
  if (!model) {
    throw new Error('LLM client not initialized')
  }

  const result = await generateText({
    model,
    prompt,
    system: options?.system,
  })

  return result.text
}

/**
 * Generate structured output
 */
export async function llmGenerateObject<T>(
  prompt: string,
  schema: z.Schema<T>,
  options?: { system?: string }
): Promise<T> {
  if (!model) {
    throw new Error('LLM client not initialized')
  }

  const result = await generateObject({
    model,
    prompt,
    schema,
    system: options?.system,
  })

  return result.object
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
