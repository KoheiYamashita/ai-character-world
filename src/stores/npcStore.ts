import { create } from 'zustand'
import type { NPC } from '@/types'

interface NPCStore {
  npcs: Map<string, NPC>

  // NPC management
  addNPC: (npc: NPC) => void
  removeNPC: (id: string) => void
  updateNPC: (id: string, updates: Partial<NPC>) => void
  getNPC: (id: string) => NPC | undefined
  getNPCsByMap: (mapId: string) => NPC[]
  clearNPCs: () => void
}

export const useNPCStore = create<NPCStore>((set, get) => ({
  npcs: new Map(),

  addNPC: (npc) =>
    set((state) => {
      const newNpcs = new Map(state.npcs)
      newNpcs.set(npc.id, npc)
      return { npcs: newNpcs }
    }),

  removeNPC: (id) =>
    set((state) => {
      const newNpcs = new Map(state.npcs)
      newNpcs.delete(id)
      return { npcs: newNpcs }
    }),

  updateNPC: (id, updates) =>
    set((state) => {
      const npc = state.npcs.get(id)
      if (!npc) return state
      const newNpcs = new Map(state.npcs)
      newNpcs.set(id, { ...npc, ...updates })
      return { npcs: newNpcs }
    }),

  getNPC: (id) => get().npcs.get(id),

  getNPCsByMap: (mapId) =>
    Array.from(get().npcs.values()).filter((npc) => npc.mapId === mapId),

  clearNPCs: () => set({ npcs: new Map() }),
}))
