export {
  initializeLLMClient,
  isLLMAvailable,
  llmGenerateText,
  llmGenerateObject,
  llmGenerateTextWithMessages,
  llmGenerateObjectWithMessages,
  shutdownLLMClient,
  getLLMModelString,
} from './client'

export type { LLMMessagesOptions } from './client'

export {
  conversationToMessagesForCharacter,
  conversationToMessagesForNPC,
  chatToMessagesForCharacter,
} from './messageUtils'

export {
  initializeLLMErrorHandler,
  getLLMErrorHandler,
  resetLLMErrorHandler,
  LLMErrorHandler,
} from './errorHandler'

export type { LLMError, LLMErrorCode, LLMErrorSeverity } from './errorHandler'
