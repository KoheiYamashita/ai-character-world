import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import type { Character, Position, Direction } from '@/types'

// Clamp a value to 0-100 range
function clampStat(value: number): number {
  return Math.max(0, Math.min(100, value))
}

// Status fields that are clamped to 0-100
type ClampedStatKey = 'satiety' | 'energy' | 'hygiene' | 'mood' | 'bladder'

interface CharacterStore {
  characters: Map<string, Character>
  activeCharacterId: string | null

  addCharacter: (character: Character) => void
  removeCharacter: (id: string) => void
  updateCharacter: (id: string, updates: Partial<Character>) => void
  updatePosition: (id: string, position: Position) => void
  updateDirection: (id: string, direction: Direction) => void
  setActiveCharacter: (id: string | null) => void
  getCharacter: (id: string) => Character | undefined
  getActiveCharacter: () => Character | undefined
  setCharacterMap: (id: string, mapId: string, nodeId: string, position: Position) => void
  updateStat: (id: string, stat: ClampedStatKey, delta: number) => void
  updateMoney: (id: string, delta: number) => void
  // Convenience aliases for individual stats
  updateSatiety: (id: string, delta: number) => void
  updateEnergy: (id: string, delta: number) => void
  updateHygiene: (id: string, delta: number) => void
  updateMood: (id: string, delta: number) => void
  updateBladder: (id: string, delta: number) => void
}

export const useCharacterStore = create<CharacterStore>((set, get) => ({
  // Start with empty state - characters will be loaded from server via SSE
  characters: new Map<string, Character>(),
  activeCharacterId: null,

  addCharacter: (character) =>
    set((state) => {
      const newMap = new Map(state.characters)
      newMap.set(character.id, character)
      return { characters: newMap }
    }),

  removeCharacter: (id) =>
    set((state) => {
      const newMap = new Map(state.characters)
      newMap.delete(id)
      return { characters: newMap }
    }),

  updateCharacter: (id, updates) =>
    set((state) => {
      const char = state.characters.get(id)
      if (!char) return state
      const newMap = new Map(state.characters)
      newMap.set(id, { ...char, ...updates })
      return { characters: newMap }
    }),

  updatePosition: (id, position) =>
    set((state) => {
      const char = state.characters.get(id)
      if (!char) return state
      const newMap = new Map(state.characters)
      newMap.set(id, { ...char, position })
      return { characters: newMap }
    }),

  updateDirection: (id, direction) =>
    set((state) => {
      const char = state.characters.get(id)
      if (!char) return state
      const newMap = new Map(state.characters)
      newMap.set(id, { ...char, direction })
      return { characters: newMap }
    }),

  setActiveCharacter: (id) => set({ activeCharacterId: id }),

  getCharacter: (id) => get().characters.get(id),

  getActiveCharacter: () => {
    const { characters, activeCharacterId } = get()
    return activeCharacterId ? characters.get(activeCharacterId) : undefined
  },

  setCharacterMap: (id, mapId, nodeId, position) =>
    set((state) => {
      const char = state.characters.get(id)
      if (!char) return state
      const newMap = new Map(state.characters)
      newMap.set(id, {
        ...char,
        currentMapId: mapId,
        currentNodeId: nodeId,
        position,
      })
      return { characters: newMap }
    }),

  updateStat: (id, stat, delta) =>
    set((state) => {
      const char = state.characters.get(id)
      if (!char) return state
      const newMap = new Map(state.characters)
      newMap.set(id, { ...char, [stat]: clampStat(char[stat] + delta) })
      return { characters: newMap }
    }),

  updateMoney: (id, delta) =>
    set((state) => {
      const char = state.characters.get(id)
      if (!char) return state
      const newMap = new Map(state.characters)
      newMap.set(id, { ...char, money: char.money + delta })
      return { characters: newMap }
    }),

  // Convenience aliases
  updateSatiety: (id, delta) => get().updateStat(id, 'satiety', delta),
  updateEnergy: (id, delta) => get().updateStat(id, 'energy', delta),
  updateHygiene: (id, delta) => get().updateStat(id, 'hygiene', delta),
  updateMood: (id, delta) => get().updateStat(id, 'mood', delta),
  updateBladder: (id, delta) => get().updateStat(id, 'bladder', delta),
}))

/**
 * Optimized selector for a single character
 * Only re-renders when the specific character changes
 */
export function useCharacter(characterId: string): Character | undefined {
  return useCharacterStore(
    useShallow((state) => state.characters.get(characterId))
  )
}

/**
 * Optimized selector for character IDs only
 * Useful for rendering character lists without full data
 */
export function useCharacterIds(): string[] {
  return useCharacterStore(
    useShallow((state) => Array.from(state.characters.keys()))
  )
}
