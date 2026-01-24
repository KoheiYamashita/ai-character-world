import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock LLM client
const mockLlmGenerateObject = vi.fn()
vi.mock('@/server/llm', () => ({
  llmGenerateObject: (...args: unknown[]) => mockLlmGenerateObject(...args),
}))

import { StubMiniEpisodeGenerator } from './StubMiniEpisodeGenerator'
import { LLMMiniEpisodeGenerator } from './LLMMiniEpisodeGenerator'
import type { SimCharacter } from '@/server/simulation/types'
import type { FacilityInfo } from '@/types'

function createTestCharacter(overrides: Partial<SimCharacter> = {}): SimCharacter {
  return {
    id: 'c1',
    name: 'TestChar',
    personality: '明るく元気な性格',
    sprite: { sheetUrl: 'test.png', frameWidth: 96, frameHeight: 96, cols: 3, rows: 4, rowMapping: { down: 0, left: 1, right: 2, up: 3 } },
    money: 100,
    satiety: 80,
    energy: 70,
    hygiene: 90,
    mood: 75,
    bladder: 60,
    currentMapId: 'town',
    currentNodeId: 'town-0-0',
    position: { x: 100, y: 100 },
    direction: 'down',
    navigation: { isMoving: false, path: [], currentPathIndex: 0, progress: 0, startPosition: null, targetPosition: null },
    crossMapNavigation: null,
    conversation: null,
    currentAction: null,
    pendingAction: null,
    actionCounter: 0,
    ...overrides,
  }
}

describe('StubMiniEpisodeGenerator', () => {
  it('should always return null', async () => {
    const generator = new StubMiniEpisodeGenerator()
    const result = await generator.generate(createTestCharacter(), 'eat', null)
    expect(result).toBeNull()
  })

  it('should return null regardless of action or facility', async () => {
    const generator = new StubMiniEpisodeGenerator()
    const facility: FacilityInfo = { tags: ['restaurant'] }
    const result = await generator.generate(createTestCharacter(), 'work', facility)
    expect(result).toBeNull()
  })
})

describe('LLMMiniEpisodeGenerator', () => {
  let generator: LLMMiniEpisodeGenerator

  beforeEach(() => {
    vi.restoreAllMocks()
    mockLlmGenerateObject.mockReset()
    generator = new LLMMiniEpisodeGenerator(0.5)
  })

  describe('action skipping', () => {
    it('should skip talk action', async () => {
      const result = await generator.generate(createTestCharacter(), 'talk', null)
      expect(result).toBeNull()
      expect(mockLlmGenerateObject).not.toHaveBeenCalled()
    })

    it('should skip thinking action', async () => {
      const result = await generator.generate(createTestCharacter(), 'thinking', null)
      expect(result).toBeNull()
      expect(mockLlmGenerateObject).not.toHaveBeenCalled()
    })
  })

  describe('probability check', () => {
    it('should return null when random exceeds probability', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.8) // > 0.5
      const result = await generator.generate(createTestCharacter(), 'eat', null)
      expect(result).toBeNull()
      expect(mockLlmGenerateObject).not.toHaveBeenCalled()
    })

    it('should call LLM when random is within probability', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.3) // < 0.5
      mockLlmGenerateObject.mockResolvedValue({
        episode: 'おいしいパンを見つけた',
        statChanges: { satiety: null, energy: null, hygiene: null, mood: 5, bladder: null },
      })

      const result = await generator.generate(createTestCharacter(), 'eat', null)
      expect(result).not.toBeNull()
      expect(mockLlmGenerateObject).toHaveBeenCalledTimes(1)
    })

    it('should respect custom probability', async () => {
      const gen = new LLMMiniEpisodeGenerator(1.0) // always generate
      vi.spyOn(Math, 'random').mockReturnValue(0.99) // still < 1.0
      mockLlmGenerateObject.mockResolvedValue({
        episode: 'エピソード',
        statChanges: { satiety: null, energy: null, hygiene: null, mood: null, bladder: null },
      })

      const result = await gen.generate(createTestCharacter(), 'eat', null)
      expect(result).not.toBeNull()
    })

    it('should never generate with probability 0', async () => {
      const gen = new LLMMiniEpisodeGenerator(0)
      vi.spyOn(Math, 'random').mockReturnValue(0.01) // > 0
      const result = await gen.generate(createTestCharacter(), 'eat', null)
      expect(result).toBeNull()
    })
  })

  describe('LLM result processing', () => {
    beforeEach(() => {
      vi.spyOn(Math, 'random').mockReturnValue(0.1) // always within probability
    })

    it('should convert nullable stat changes to actual values', async () => {
      mockLlmGenerateObject.mockResolvedValue({
        episode: 'いい気分になった',
        statChanges: { satiety: null, energy: 3, hygiene: null, mood: 5, bladder: null },
      })

      const result = await generator.generate(createTestCharacter(), 'rest', null)
      expect(result).toEqual({
        episode: 'いい気分になった',
        statChanges: { energy: 3, mood: 5 },
      })
    })

    it('should exclude null stat changes from result', async () => {
      mockLlmGenerateObject.mockResolvedValue({
        episode: '何もなかった',
        statChanges: { satiety: null, energy: null, hygiene: null, mood: null, bladder: null },
      })

      const result = await generator.generate(createTestCharacter(), 'eat', null)
      expect(result).toEqual({
        episode: '何もなかった',
        statChanges: {},
      })
    })

    it('should clamp stat changes to -10..+10', async () => {
      mockLlmGenerateObject.mockResolvedValue({
        episode: '極端な出来事',
        statChanges: { satiety: 15, energy: -20, hygiene: null, mood: 10, bladder: null },
      })

      const result = await generator.generate(createTestCharacter(), 'eat', null)
      expect(result!.statChanges.satiety).toBe(10)
      expect(result!.statChanges.energy).toBe(-10)
      expect(result!.statChanges.mood).toBe(10)
    })

    it('should round stat changes to integers', async () => {
      mockLlmGenerateObject.mockResolvedValue({
        episode: '小さな出来事',
        statChanges: { satiety: null, energy: null, hygiene: null, mood: 3.7, bladder: null },
      })

      const result = await generator.generate(createTestCharacter(), 'bathe', null)
      expect(result!.statChanges.mood).toBe(4)
    })

    it('should include facility tags in prompt when facility is provided', async () => {
      mockLlmGenerateObject.mockResolvedValue({
        episode: 'レストランでの出来事',
        statChanges: { satiety: null, energy: null, hygiene: null, mood: 2, bladder: null },
      })

      const facility: FacilityInfo = { tags: ['restaurant'], quality: 80 }
      await generator.generate(createTestCharacter(), 'eat', facility)

      const prompt = mockLlmGenerateObject.mock.calls[0][0] as string
      expect(prompt).toContain('restaurant')
    })

    it('should include character personality in prompt', async () => {
      mockLlmGenerateObject.mockResolvedValue({
        episode: 'エピソード',
        statChanges: { satiety: null, energy: null, hygiene: null, mood: null, bladder: null },
      })

      await generator.generate(createTestCharacter({ personality: '穏やかで優しい' }), 'rest', null)

      const prompt = mockLlmGenerateObject.mock.calls[0][0] as string
      expect(prompt).toContain('穏やかで優しい')
    })

    it('should include action id in prompt', async () => {
      mockLlmGenerateObject.mockResolvedValue({
        episode: 'エピソード',
        statChanges: { satiety: null, energy: null, hygiene: null, mood: null, bladder: null },
      })

      await generator.generate(createTestCharacter(), 'work', null)

      const prompt = mockLlmGenerateObject.mock.calls[0][0] as string
      expect(prompt).toContain('work')
    })
  })

  describe('error handling', () => {
    beforeEach(() => {
      vi.spyOn(Math, 'random').mockReturnValue(0.1)
      vi.spyOn(console, 'error').mockImplementation(() => {})
    })

    it('should return null on LLM error', async () => {
      mockLlmGenerateObject.mockRejectedValue(new Error('LLM error'))

      const result = await generator.generate(createTestCharacter(), 'eat', null)
      expect(result).toBeNull()
    })

    it('should log error on LLM failure', async () => {
      mockLlmGenerateObject.mockRejectedValue(new Error('API timeout'))

      await generator.generate(createTestCharacter(), 'eat', null)
      expect(console.error).toHaveBeenCalledWith(
        '[MiniEpisodeGenerator] Error generating episode:',
        expect.any(Error)
      )
    })
  })
})
