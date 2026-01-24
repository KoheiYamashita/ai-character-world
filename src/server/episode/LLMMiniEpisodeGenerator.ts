import { z } from 'zod'
import type { MiniEpisodeGenerator, MiniEpisodeResult } from './MiniEpisodeGenerator'
import type { SimCharacter } from '@/server/simulation/types'
import type { ActionId } from '@/types/action'
import type { FacilityInfo } from '@/types'
import { llmGenerateObject } from '@/server/llm'

// Actions that should never generate episodes
const SKIP_ACTIONS: Set<string> = new Set(['talk', 'thinking', 'idle'])

const MiniEpisodeSchema = z.object({
  episode: z.string().describe('短い出来事の描写（1-2文、キャラクターの一人称視点ではなく客観的描写）'),
  statChanges: z.object({
    satiety: z.number().nullable().describe('満腹度の変化（-10〜+10、変化なしならnull）'),
    energy: z.number().nullable().describe('エネルギーの変化（-10〜+10、変化なしならnull）'),
    hygiene: z.number().nullable().describe('衛生度の変化（-10〜+10、変化なしならnull）'),
    mood: z.number().nullable().describe('気分の変化（-10〜+10、変化なしならnull）'),
    bladder: z.number().nullable().describe('トイレ欲求の変化（-10〜+10、変化なしならnull）'),
  }),
})

export class LLMMiniEpisodeGenerator implements MiniEpisodeGenerator {
  private probability: number

  constructor(probability: number = 0.5) {
    this.probability = probability
  }

  async generate(
    character: SimCharacter,
    actionId: ActionId,
    facility: FacilityInfo | null
  ): Promise<MiniEpisodeResult | null> {
    // Skip certain actions
    if (SKIP_ACTIONS.has(actionId)) {
      console.log(`[MiniEpisodeGenerator] Skipped (action: ${actionId})`)
      return null
    }

    // Probability check
    if (Math.random() > this.probability) {
      console.log(`[MiniEpisodeGenerator] Skipped (probability)`)
      return null
    }

    const prompt = this.buildPrompt(character, actionId, facility)

    try {
      const result = await llmGenerateObject(prompt, MiniEpisodeSchema, {
        system: 'あなたはキャラクターシミュレーションのミニエピソード生成器です。キャラクターがアクションを完了した際に、ちょっとした出来事を生成してください。出来事は短く（1-2文）、日常的で自然なものにしてください。',
      })

      // Convert nullable values to actual stat changes (exclude nulls)
      const statChanges: MiniEpisodeResult['statChanges'] = {}
      const statKeys = ['satiety', 'energy', 'hygiene', 'mood', 'bladder'] as const
      for (const key of statKeys) {
        if (result.statChanges[key] != null) {
          statChanges[key] = clampChange(result.statChanges[key])
        }
      }

      console.log(`[MiniEpisodeGenerator] Generated: ${result.episode}`)
      return { episode: result.episode, statChanges }
    } catch (error) {
      console.error('[MiniEpisodeGenerator] Error generating episode:', error)
      return null
    }
  }

  private buildPrompt(character: SimCharacter, actionId: ActionId, facility: FacilityInfo | null): string {
    const parts: string[] = []

    parts.push(`キャラクター: ${character.name}`)
    if (character.personality) {
      parts.push(`性格: ${character.personality}`)
    }
    parts.push(`完了したアクション: ${actionId}`)
    if (facility) {
      parts.push(`施設タグ: ${facility.tags.join(', ')}`)
    }
    parts.push('')
    parts.push('【現在のステータス】')
    parts.push(`- 満腹度: ${character.satiety.toFixed(0)}%`)
    parts.push(`- エネルギー: ${character.energy.toFixed(0)}%`)
    parts.push(`- 衛生: ${character.hygiene.toFixed(0)}%`)
    parts.push(`- 気分: ${character.mood.toFixed(0)}%`)
    parts.push(`- トイレ: ${character.bladder.toFixed(0)}%`)
    parts.push('')
    parts.push('上記のアクション完了後に起こった小さな出来事を生成してください。')
    parts.push('例: 食事中に新メニューを発見した、仕事中に同僚と雑談した、入浴中にリラックスできた、など。')
    parts.push('ステータス変化は出来事に応じて -10〜+10 の範囲で設定してください。多くの場合は変化なし(null)で構いません。')

    return parts.join('\n')
  }
}

function clampChange(value: number): number {
  return Math.max(-10, Math.min(10, Math.round(value)))
}
