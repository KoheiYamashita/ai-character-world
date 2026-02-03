/**
 * NPC Commitment System - 約束管理
 * NPCが会話で合意した約束（待ち合わせ等）を追跡
 */

export interface NPCCommitment {
  id: string
  npcId: string
  characterId: string
  // Meeting location
  targetMapId: string
  targetFacilityId?: string  // Optional: specific facility within the map
  // Timing
  targetTime: string  // "HH:MM" format
  targetDay: number   // World day number
  // Metadata
  description: string
  status: CommitmentStatus
  createdAt: number   // Unix timestamp
}

export type CommitmentStatus = 'pending' | 'triggered' | 'fulfilled' | 'expired'

/**
 * Commitment creation parameters (from conversation post-processing)
 */
export interface CommitmentCreateParams {
  npcId: string
  characterId: string
  targetMapId: string
  targetFacilityId?: string
  targetTime: string
  targetDay: number
  description: string
}

/**
 * Resolved commitment location (ready for NPC navigation)
 */
export interface ResolvedCommitmentLocation {
  mapId: string
  nodeId: string
}
