import { config } from 'dotenv'
config({ path: '.env.local' })

import { initializeLLMClient, isLLMAvailable, llmGenerateText, getLLMModelString } from '../src/server/llm'

async function main() {
  console.log('Testing LLM client...')

  // Initialize
  initializeLLMClient()

  if (!isLLMAvailable()) {
    console.error('LLM not available. Check LLM_MODEL and API key.')
    process.exit(1)
  }

  console.log(`Model: ${getLLMModelString()}`)

  // Call LLM
  console.log('Calling LLM...')
  const result = await llmGenerateText('Say "Hello, AI Character World!" in one line.')
  console.log('Response:', result)
}

main().catch(console.error)
