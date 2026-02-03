import { randomUUID } from 'crypto'
import { z } from 'zod'
import type { ConversationSession, ConversationSummaryEntry, NPCDynamicState, NPC, WorldTime, CommitmentCreateParams } from '@/types'
import type { SimCharacter } from '@/server/simulation/types'
import type { MidTermMemory } from '@/types/behavior'
import { llmGenerateObject } from '@/server/llm'

const ConversationExtractionSchema = z.object({
  summary: z.string().describe('会話の要約（1-2文）'),
  affinityChange: z.number().min(-20).max(20).describe('好感度変化量'),
  updatedFacts: z.array(z.object({
    content: z.string().describe('知識・事実の内容'),
    expiresDay: z.number().nullable().describe('有効期限（ワールド日数）。永続的な基本情報はnull、時限情報は適切な日数を設定'),
  })).describe('NPCのfacts全量。永続的な基本情報はexpiresDay:null、会話で得た時限情報は適切な期限を設定'),
  mood: z.enum(['happy', 'neutral', 'sad', 'angry', 'excited']).describe('会話後のNPCの気分'),
  topicsDiscussed: z.array(z.string()).describe('話題になったトピック'),
  consolidatedMemories: z.array(z.object({
    content: z.string().describe('行動に影響する情報（簡潔に）'),
    importance: z.enum(['low', 'medium', 'high']).describe('重要度: low=些細な情報, medium=数日覚えておくべき情報, high=重要な約束や予定'),
  })).describe('既存の記憶と今回の会話から得られた情報を統合・整理した結果。重複を排除し、重要度の高いものを優先して保持'),
  // 約束・待ち合わせの抽出
  commitment: z.object({
    hasCommitment: z.boolean().describe('会話で待ち合わせ・約束が成立したか'),
    location: z.string().nullable().describe('約束の場所（マップ名または施設名）。nullの場合は約束なし'),
    time: z.string().nullable().describe('約束の時刻（"HH:MM"形式）。nullの場合は約束なし'),
    dayOffset: z.number().describe('約束の日（0=今日、1=明日、2=明後日）'),
    description: z.string().describe('約束の内容の簡潔な説明'),
  }).describe('会話で成立した約束・待ち合わせ。具体的な場所と時間が決まっている場合のみ'),
})

export type ConversationExtraction = z.infer<typeof ConversationExtractionSchema>

export type NPCUpdateCallback = (npcId: string, updates: Partial<NPCDynamicState>) => void
export type SummaryPersistCallback = (entry: ConversationSummaryEntry) => Promise<void>
export type NPCStatePersistCallback = (npcId: string, state: NPCDynamicState) => Promise<void>
// Replace all memories with the consolidated list (not append)
export type MemoryReplaceCallback = (characterId: string, memories: MidTermMemory[]) => Promise<void>

// Deprecated: Use MemoryReplaceCallback instead
export type MemoryPersistCallback = (memories: MidTermMemory[]) => Promise<void>

// Commitment creation callback (约束作成時に呼び出し)
export type CommitmentCreateCallback = (params: CommitmentCreateParams) => Promise<void>

// Importance → days until expiry mapping
const IMPORTANCE_EXPIRY_DAYS: Record<string, number> = {
  low: 0,     // 当日中
  medium: 1,  // 翌日まで
  high: 2,    // 2日後まで
}

// Default memory limit
const DEFAULT_MID_TERM_LIMIT = 8
const DEFAULT_FACTS_LIMIT = 20

export class ConversationPostProcessor {
  private onNPCUpdate: NPCUpdateCallback | null = null
  private onSummaryPersist: SummaryPersistCallback | null = null
  private onNPCStatePersist: NPCStatePersistCallback | null = null
  private onMemoryReplace: MemoryReplaceCallback | null = null
  private onCommitmentCreate: CommitmentCreateCallback | null = null
  private midTermLimit: number = DEFAULT_MID_TERM_LIMIT
  private factsLimit: number = DEFAULT_FACTS_LIMIT

  setOnNPCUpdate(callback: NPCUpdateCallback): void {
    this.onNPCUpdate = callback
  }

  setOnSummaryPersist(callback: SummaryPersistCallback): void {
    this.onSummaryPersist = callback
  }

  setOnNPCStatePersist(callback: NPCStatePersistCallback): void {
    this.onNPCStatePersist = callback
  }

  setOnMemoryReplace(callback: MemoryReplaceCallback): void {
    this.onMemoryReplace = callback
  }

  setOnCommitmentCreate(callback: CommitmentCreateCallback): void {
    this.onCommitmentCreate = callback
  }

  setMidTermLimit(limit: number): void {
    this.midTermLimit = limit
  }

  setFactsLimit(limit: number): void {
    this.factsLimit = limit
  }

  async process(
    session: ConversationSession,
    npc: NPC,
    character: SimCharacter,
    currentTime?: WorldTime,
    existingMemories?: MidTermMemory[]
  ): Promise<ConversationExtraction | null> {
    // Skip if no messages
    if (session.messages.length === 0) {
      return null
    }

    // LLM extraction with existing memories for consolidation
    const prompt = this.buildExtractionPrompt(session, npc, character, existingMemories ?? [])
    const extraction = await llmGenerateObject(
      prompt,
      ConversationExtractionSchema,
      { system: '会話ログを分析し、要約・好感度変化・facts更新・気分・トピックを抽出し、既存記憶と新情報を統合してください。' }
    )

    console.log(`[ConversationPostProcessor] Extraction for ${npc.name}: summary="${extraction.summary}", affinity=${extraction.affinityChange}, mood=${extraction.mood}`)

    // Calculate updated NPC state
    const newAffinity = Math.max(-100, Math.min(100, npc.affinity + extraction.affinityChange))
    const newConversationCount = npc.conversationCount + 1
    const newLastConversation = Date.now()

    // Enforce facts limit
    const limitedFacts = extraction.updatedFacts.slice(0, this.factsLimit)

    const updates: Partial<NPCDynamicState> = {
      facts: limitedFacts,
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
      facts: limitedFacts,
      conversationCount: newConversationCount,
      lastConversation: newLastConversation,
    }

    if (this.onNPCStatePersist) {
      await this.onNPCStatePersist(npc.id, fullState)
    }

    // Persist consolidated mid-term memories (replace, not append)
    if (this.onMemoryReplace && currentTime && extraction.consolidatedMemories) {
      // Convert consolidated memories to MidTermMemory format
      const consolidatedMemories: MidTermMemory[] = extraction.consolidatedMemories
        .slice(0, this.midTermLimit)  // Enforce limit
        .map((m) => ({
          id: randomUUID(),
          characterId: session.characterId,
          content: m.content,
          importance: m.importance,
          createdDay: currentTime.day,
          expiresDay: currentTime.day + (IMPORTANCE_EXPIRY_DAYS[m.importance] ?? 0),
          sourceNpcId: npc.id,
        }))

      await this.onMemoryReplace(session.characterId, consolidatedMemories)
      console.log(`[ConversationPostProcessor] Replaced memories with ${consolidatedMemories.length} consolidated entries for ${character.name}`)
    }

    // Process commitment if extracted
    if (this.onCommitmentCreate && currentTime && extraction.commitment?.hasCommitment) {
      const { location, time, dayOffset, description } = extraction.commitment
      if (location && time) {
        const targetDay = currentTime.day + dayOffset
        const commitmentParams: CommitmentCreateParams = {
          npcId: npc.id,
          characterId: session.characterId,
          targetMapId: location, // Will be resolved to actual mapId by CommitmentManager
          targetTime: time,
          targetDay,
          description,
        }
        await this.onCommitmentCreate(commitmentParams)
        console.log(`[ConversationPostProcessor] Created commitment: ${description} (${npc.name}, Day ${targetDay} at ${time})`)
      }
    }

    return extraction
  }

  private buildExtractionPrompt(
    session: ConversationSession,
    npc: NPC,
    character: SimCharacter,
    existingMemories: MidTermMemory[]
  ): string {
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
      parts.push(npc.facts.map(f => `- ${f.content}${f.expiresDay !== null ? ` (期限: ${f.expiresDay}日目まで)` : ' (永続)'}`).join('\n'))
    } else {
      parts.push('（なし）')
    }
    parts.push('')

    // Include existing memories for consolidation
    parts.push(`【${character.name}の既存の記憶】`)
    if (existingMemories.length > 0) {
      parts.push(existingMemories.map(m => `- [${m.importance}] ${m.content}`).join('\n'))
    } else {
      parts.push('（なし）')
    }
    parts.push('')

    parts.push('【指示】')
    parts.push('- summary: 会話の要約を1-2文で')
    parts.push('- affinityChange: NPCの好感度変化（-20〜+20）。良い会話なら正、悪い会話なら負')
    parts.push(`- updatedFacts: NPCのfacts全量を出力（上限${this.factsLimit}件）。各factにはexpiresDay（有効期限）を設定:`)
    parts.push('  - 永続的な基本情報（職業、趣味、性格など）: expiresDay: null')
    parts.push('  - 時限情報（予定、約束、一時的な状態など）: expiresDay: 適切な日数（例: 明日の約束なら現在日+1）')
    parts.push('  - 既存の永続factは変更がなければそのまま維持')
    parts.push('  - 重要度の高いものを優先して保持')
    parts.push('- mood: 会話後のNPCの気分（happy/neutral/sad/angry/excited）')
    parts.push('- topicsDiscussed: 話題になったトピック一覧')
    parts.push(`- consolidatedMemories: 既存の記憶と今回の会話から得られた新情報を統合・整理した結果（上限${this.midTermLimit}件）`)
    parts.push('  - 重複する情報は統合')
    parts.push('  - 古くなった情報は更新または削除')
    parts.push('  - 重要度の高いものを優先して保持')
    parts.push('  - 雑談や既知の情報は含めない')
    parts.push('  - 今後の行動に影響しうる情報のみ残す（約束、予定、新知識など）')
    parts.push('- commitment: 会話で成立した約束・待ち合わせ')
    parts.push('  - hasCommitment: 具体的な場所と時間が決まった約束があるかどうか')
    parts.push('  - location: 約束の場所（マップ名：公園、カフェ、自宅など、または施設名）')
    parts.push('  - time: 約束の時刻（"HH:MM"形式、例："15:00"）')
    parts.push('  - dayOffset: 約束の日（0=今日、1=明日、2=明後日）')
    parts.push('  - description: 約束の内容の簡潔な説明')
    parts.push('  - 注意: 「また会おうね」などの曖昧な約束は含めない。具体的な場所・時間が決まっている場合のみ')

    return parts.join('\n')
  }
}
