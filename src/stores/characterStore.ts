import { create } from 'zustand'
import type { Character, Position, Direction } from '@/types'
import { defaultCharacter } from '@/data/characters'

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
  updateHunger: (id: string, delta: number) => void
  updateMoney: (id: string, delta: number) => void
}

export const useCharacterStore = create<CharacterStore>((set, get) => ({
  characters: new Map([[defaultCharacter.id, defaultCharacter]]),
  activeCharacterId: defaultCharacter.id,

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

  updateHunger: (id, delta) =>
    set((state) => {
      const char = state.characters.get(id)
      if (!char) return state
      const newMap = new Map(state.characters)
      const newHunger = Math.max(0, Math.min(100, char.hunger + delta))
      newMap.set(id, { ...char, hunger: newHunger })
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
}))
