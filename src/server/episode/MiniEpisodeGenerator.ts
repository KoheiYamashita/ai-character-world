import type { SimCharacter } from '@/server/simulation/types'
import type { ActionId } from '@/types/action'
import type { FacilityInfo } from '@/types'

export interface MiniEpisodeResult {
  episode: string
  statChanges: Partial<Record<'satiety' | 'energy' | 'hygiene' | 'mood' | 'bladder', number>>
}

export interface MiniEpisodeGenerator {
  generate(
    character: SimCharacter,
    actionId: ActionId,
    facility: FacilityInfo | null
  ): Promise<MiniEpisodeResult | null>
}
