import type { MiniEpisodeGenerator, MiniEpisodeResult } from './MiniEpisodeGenerator'
import type { SimCharacter } from '@/server/simulation/types'
import type { ActionId } from '@/types/action'
import type { FacilityInfo } from '@/types'

export class StubMiniEpisodeGenerator implements MiniEpisodeGenerator {
  async generate(
    _character: SimCharacter,
    _actionId: ActionId,
    _facility: FacilityInfo | null
  ): Promise<MiniEpisodeResult | null> {
    return null
  }
}
