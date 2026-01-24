import { z } from 'zod'
import type { ConversationSession, ConversationSummaryEntry, NPCDynamicState, NPC } from '@/types'
import type { SimCharacter } from '@/server/simulation/types'
import { llmGenerateObject } from '@/server/llm'

const ConversationExtractionSchema = z.object({
  summary: z.string().describe('会話の要約（1-2文）'),
  affinityChange: z.number().min(-20).max(20).describe('好感度変化量'),
  updatedFacts: z.array(z.string()).describe('NPCのfacts全量。更新がなければ既存をそのまま、新情報があれば追加して出力'),
  mood: z.enum(['happy', 'neutral', 'sad', 'angry', 'excited']).describe('会話後のNPCの気分'),
  topicsDiscussed: z.array(z.string()).describe('話題になったトピック'),
})

export type ConversationExtraction = z.infer<typeof ConversationExtractionSchema>

export type NPCUpdateCallback = (npcId: string, updates: Partial<NPCDynamicState>) => void
export type SummaryPersistCallback = (entry: ConversationSummaryEntry) => Promise<void>
export type NPCStatePersistCallback = (npcId: string, state: NPCDynamicState) => Promise<void>

export class ConversationPostProcessor {
  private onNPCUpdate: NPCUpdateCallback | null = null
  private onSummaryPersist: SummaryPersistCallback | null = null
  private onNPCStatePersist: NPCStatePersistCallback | null = null

  setOnNPCUpdate(callback: NPCUpdateCallback): void {
    this.onNPCUpdate = callback
  }

  setOnSummaryPersist(callback: SummaryPersistCallback): void {
    this.onSummaryPersist = callback
  }

  setOnNPCStatePersist(callback: NPCStatePersistCallback): void {
    this.onNPCStatePersist = callback
  }

  async process(session: ConversationSession, npc: NPC, character: SimCharacter): Promise<ConversationExtraction | null> {
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

    return parts.join('\n')
  }
}
