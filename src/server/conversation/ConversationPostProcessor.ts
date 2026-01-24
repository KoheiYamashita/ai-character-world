import { randomUUID } from 'crypto'
import { z } from 'zod'
import type { ConversationSession, ConversationSummaryEntry, NPCDynamicState, NPC, WorldTime } from '@/types'
import type { SimCharacter } from '@/server/simulation/types'
import type { MidTermMemory } from '@/types/behavior'
import { llmGenerateObject } from '@/server/llm'

const ConversationExtractionSchema = z.object({
  summary: z.string().describe('会話の要約（1-2文）'),
  affinityChange: z.number().min(-20).max(20).describe('好感度変化量'),
  updatedFacts: z.array(z.string()).describe('NPCのfacts全量。更新がなければ既存をそのまま、新情報があれば追加して出力'),
  mood: z.enum(['happy', 'neutral', 'sad', 'angry', 'excited']).describe('会話後のNPCの気分'),
  topicsDiscussed: z.array(z.string()).describe('話題になったトピック'),
  memories: z.array(z.object({
    content: z.string().describe('行動に影響する情報（簡潔に）'),
    importance: z.enum(['low', 'medium', 'high']).describe('重要度: low=些細な情報, medium=数日覚えておくべき情報, high=重要な約束や予定'),
  })).describe('会話から得られた、キャラクターの行動に影響しうる記憶（約束、予定、新しい知識など）'),
})

export type ConversationExtraction = z.infer<typeof ConversationExtractionSchema>

export type NPCUpdateCallback = (npcId: string, updates: Partial<NPCDynamicState>) => void
export type SummaryPersistCallback = (entry: ConversationSummaryEntry) => Promise<void>
export type NPCStatePersistCallback = (npcId: string, state: NPCDynamicState) => Promise<void>
export type MemoryPersistCallback = (memories: MidTermMemory[]) => Promise<void>

// Importance → days until expiry mapping
const IMPORTANCE_EXPIRY_DAYS: Record<string, number> = {
  low: 0,     // 当日中
  medium: 1,  // 翌日まで
  high: 2,    // 2日後まで
}

export class ConversationPostProcessor {
  private onNPCUpdate: NPCUpdateCallback | null = null
  private onSummaryPersist: SummaryPersistCallback | null = null
  private onNPCStatePersist: NPCStatePersistCallback | null = null
  private onMemoryPersist: MemoryPersistCallback | null = null

  setOnNPCUpdate(callback: NPCUpdateCallback): void {
    this.onNPCUpdate = callback
  }

  setOnSummaryPersist(callback: SummaryPersistCallback): void {
    this.onSummaryPersist = callback
  }

  setOnNPCStatePersist(callback: NPCStatePersistCallback): void {
    this.onNPCStatePersist = callback
  }

  setOnMemoryPersist(callback: MemoryPersistCallback): void {
    this.onMemoryPersist = callback
  }

  async process(session: ConversationSession, npc: NPC, character: SimCharacter, currentTime?: WorldTime): Promise<ConversationExtraction | null> {
    // Skip if no messages
    if (session.messages.length === 0) {
      return null
    }

    // LLM extraction
    const prompt = this.buildExtractionPrompt(session, npc, character)
    const extraction = await llmGenerateObject(
      prompt,
      ConversationExtractionSchema,
      { system: '会話ログを分析し、要約・好感度変化・facts更新・気分・トピックを抽出してください。' }
    )

    console.log(`[ConversationPostProcessor] Extraction for ${npc.name}: summary="${extraction.summary}", affinity=${extraction.affinityChange}, mood=${extraction.mood}`)

    // Calculate updated NPC state
    const newAffinity = Math.max(-100, Math.min(100, npc.affinity + extraction.affinityChange))
    const newConversationCount = npc.conversationCount + 1
    const newLastConversation = Date.now()

    const updates: Partial<NPCDynamicState> = {
      facts: extraction.updatedFacts,
      affinity: newAffinity,
      mood: extraction.mood,
      conversationCount: newConversationCount,
      lastConversation: newLastConversation,
    }

    // Update NPC in-memory
    if (this.onNPCUpdate) {
      this.onNPCUpdate(npc.id, updates)
    }

    // Persist summary
    const summaryEntry: ConversationSummaryEntry = {
      characterId: session.characterId,
      npcId: npc.id,
      npcName: npc.name,
      goal: session.goal.goal,
      summary: extraction.summary,
      topics: extraction.topicsDiscussed,
      goalAchieved: session.goalAchieved,
      timestamp: Date.now(),
      affinityChange: extraction.affinityChange,
      mood: extraction.mood,
    }

    if (this.onSummaryPersist) {
      await this.onSummaryPersist(summaryEntry)
    }

    // Persist NPC state
    const fullState: NPCDynamicState = {
      affinity: newAffinity,
      mood: extraction.mood,
      facts: extraction.updatedFacts,
      conversationCount: newConversationCount,
      lastConversation: newLastConversation,
    }

    if (this.onNPCStatePersist) {
      await this.onNPCStatePersist(npc.id, fullState)
    }

    // Persist mid-term memories
    if (this.onMemoryPersist && currentTime && extraction.memories && extraction.memories.length > 0) {
      const memories: MidTermMemory[] = extraction.memories.map((m, i) => ({
        id: randomUUID(),
        characterId: session.characterId,
        content: m.content,
        importance: m.importance,
        createdDay: currentTime.day,
        expiresDay: currentTime.day + (IMPORTANCE_EXPIRY_DAYS[m.importance] ?? 0),
        sourceNpcId: npc.id,
      }))

      await this.onMemoryPersist(memories)
      console.log(`[ConversationPostProcessor] Persisted ${memories.length} mid-term memories for ${character.name}`)
    }

    return extraction
  }

  private buildExtractionPrompt(session: ConversationSession, npc: NPC, character: SimCharacter): string {
    const parts: string[] = []

    parts.push('以下の会話ログを分析してください。')
    parts.push('')

    parts.push('【参加者】')
    parts.push(`- キャラクター: ${character.name}`)
    parts.push(`- NPC: ${npc.name}`)
    parts.push(`- 現在の好感度: ${npc.affinity}`)
    parts.push(`- 現在の気分: ${npc.mood}`)
    parts.push('')

    parts.push('【会話の目的】')
    parts.push(`- 目的: ${session.goal.goal}`)
    parts.push(`- 達成: ${session.goalAchieved ? 'はい' : 'いいえ'}`)
    parts.push('')

    parts.push('【会話ログ】')
    for (const msg of session.messages) {
      parts.push(`${msg.speakerName}: ${msg.utterance}`)
    }
    parts.push('')

    parts.push('【NPCの現在のfacts】')
    if (npc.facts.length > 0) {
      parts.push(npc.facts.map(f => `- ${f}`).join('\n'))
    } else {
      parts.push('（なし）')
    }
    parts.push('')

    parts.push('【指示】')
    parts.push('- summary: 会話の要約を1-2文で')
    parts.push('- affinityChange: NPCの好感度変化（-20〜+20）。良い会話なら正、悪い会話なら負')
    parts.push('- updatedFacts: NPCのfacts全量を出力。変更がなければ既存をそのまま出力し、新しい情報があれば追加して全量を出力してください')
    parts.push('- mood: 会話後のNPCの気分（happy/neutral/sad/angry/excited）')
    parts.push('- topicsDiscussed: 話題になったトピック一覧')
    parts.push('- memories: キャラクターの今後の行動に影響しうる情報を抽出。例: 約束（「明日また来る」）、新知識（「あの店は水曜定休」）、予定の変更など。雑談や既知の情報は含めない。なければ空配列')

    return parts.join('\n')
  }
}
