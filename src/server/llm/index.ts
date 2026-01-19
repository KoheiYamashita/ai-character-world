export {
  initializeLLMClient,
  isLLMAvailable,
  llmGenerateText,
  llmGenerateObject,
  shutdownLLMClient,
  getLLMModelString,
} from './client'

export {
  initializeLLMErrorHandler,
  getLLMErrorHandler,
  resetLLMErrorHandler,
  LLMErrorHandler,
} from './errorHandler'

export type { LLMError, LLMErrorCode, LLMErrorSeverity } from './errorHandler'
