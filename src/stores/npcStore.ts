import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
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

/**
 * Optimized selector for a single NPC
 * Only re-renders when the specific NPC changes
 */
export function useNPC(npcId: string): NPC | undefined {
  return useNPCStore(
    useShallow((state) => state.npcs.get(npcId))
  )
}

/**
 * Optimized selector for NPCs in a specific map
 * Only re-renders when NPCs on that map change
 */
export function useNPCsInMap(mapId: string): NPC[] {
  return useNPCStore(
    useShallow((state) =>
      Array.from(state.npcs.values()).filter((npc) => npc.mapId === mapId)
    )
  )
}
