import type { NPCCommitment, CommitmentCreateParams, WorldTime, WorldMap, Obstacle } from '@/types'
import type { StateStore } from '@/server/persistence/StateStore'
import type { WorldStateManager } from '@/server/simulation/WorldState'
import { randomUUID } from 'crypto'
import { resolveLocationToFacility, findAvailableNodeNearFacility } from '@/lib/commitmentUtils'

/**
 * CommitmentManager - NPC約束管理
 * 会話で合意した約束（待ち合わせ等）を追跡し、時間になったらNPCを移動させる
 */
export class CommitmentManager {
  private stateStore: StateStore | null = null
  private worldState: WorldStateManager | null = null
  private maps: Record<string, WorldMap> = {}
  // In-memory cache of active commitments for quick lookup
  private activeCommitments: Map<string, NPCCommitment> = new Map()
  // Track triggered commitments to avoid re-triggering
  private triggeredCommitments: Set<string> = new Set()

  setStateStore(store: StateStore): void {
    this.stateStore = store
  }

  setWorldState(worldState: WorldStateManager): void {
    this.worldState = worldState
    this.maps = worldState.getMaps()
  }

  /**
   * Create a new commitment from conversation post-processing
   */
  async createCommitment(params: CommitmentCreateParams): Promise<NPCCommitment> {
    const commitment: NPCCommitment = {
      id: randomUUID(),
      npcId: params.npcId,
      characterId: params.characterId,
      targetMapId: params.targetMapId,
      targetFacilityId: params.targetFacilityId,
      targetTime: params.targetTime,
      targetDay: params.targetDay,
      description: params.description,
      status: 'pending',
      createdAt: Date.now(),
    }

    this.activeCommitments.set(commitment.id, commitment)

    if (this.stateStore) {
      await this.stateStore.saveCommitment(commitment)
    }

    console.log(`[CommitmentManager] Created commitment: ${commitment.description} (NPC: ${commitment.npcId}, Day ${commitment.targetDay} at ${commitment.targetTime})`)

    return commitment
  }

  /**
   * Create commitment from location text (resolves to mapId)
   */
  async createCommitmentFromLocation(params: {
    npcId: string
    characterId: string
    locationText: string
    targetTime: string
    targetDay: number
    description: string
  }): Promise<NPCCommitment | null> {
    const resolved = resolveLocationToFacility(params.locationText, this.maps)
    if (!resolved) {
      console.warn(`[CommitmentManager] Could not resolve location: "${params.locationText}"`)
      return null
    }

    return this.createCommitment({
      npcId: params.npcId,
      characterId: params.characterId,
      targetMapId: resolved.mapId,
      targetFacilityId: resolved.facility?.id,
      targetTime: params.targetTime,
      targetDay: params.targetDay,
      description: params.description,
    })
  }

  /**
   * Get commitments that should trigger NPC movement now (5 minutes before target time)
   */
  getTriggeredCommitments(currentTime: WorldTime): NPCCommitment[] {
    const triggered: NPCCommitment[] = []

    for (const commitment of this.activeCommitments.values()) {
      // Skip non-pending commitments
      if (commitment.status !== 'pending') continue

      // Skip wrong day
      if (commitment.targetDay !== currentTime.day) continue

      // Skip already triggered this session
      if (this.triggeredCommitments.has(commitment.id)) continue

      // Check if within 5 minutes of target time
      if (this.isWithinMinutesBefore(commitment.targetTime, currentTime, 5)) {
        triggered.push(commitment)
        this.triggeredCommitments.add(commitment.id)
      }
    }

    return triggered
  }

  /**
   * Resolve commitment to a specific node for NPC navigation
   */
  resolveCommitmentToNode(commitment: NPCCommitment): { mapId: string; nodeId: string } | null {
    if (!this.worldState) return null

    const map = this.maps[commitment.targetMapId]
    if (!map) return null

    // Find the target facility (if specified)
    let facility: Obstacle | null = null
    if (commitment.targetFacilityId) {
      facility = map.obstacles.find(o => o.id === commitment.targetFacilityId) ?? null
    }

    // Get blocked nodes (other NPCs + characters)
    const npcBlockedNodes = this.worldState.getNPCBlockedNodes(commitment.targetMapId)
    const characterBlockedNodes = this.worldState.getCharacterBlockedNodes(commitment.targetMapId)
    const allBlockedNodes = new Set([...npcBlockedNodes, ...characterBlockedNodes])

    // Find available node near facility/map center
    const nodeId = findAvailableNodeNearFacility(map, facility, allBlockedNodes)
    if (!nodeId) {
      console.warn(`[CommitmentManager] No available node found for commitment: ${commitment.id}`)
      return null
    }

    return { mapId: commitment.targetMapId, nodeId }
  }

  /**
   * Mark commitment as triggered (NPC started moving)
   */
  async markTriggered(commitmentId: string): Promise<void> {
    const commitment = this.activeCommitments.get(commitmentId)
    if (commitment) {
      commitment.status = 'triggered'
      if (this.stateStore) {
        await this.stateStore.updateCommitmentStatus(commitmentId, 'triggered')
      }
    }
  }

  /**
   * Mark commitment as fulfilled (NPC reached destination)
   */
  async markFulfilled(commitmentId: string): Promise<void> {
    const commitment = this.activeCommitments.get(commitmentId)
    if (commitment) {
      commitment.status = 'fulfilled'
      this.activeCommitments.delete(commitmentId)
      if (this.stateStore) {
        await this.stateStore.updateCommitmentStatus(commitmentId, 'fulfilled')
      }
      console.log(`[CommitmentManager] Commitment fulfilled: ${commitmentId}`)
    }
  }

  /**
   * Load commitments for a specific day from DB
   */
  async loadCommitmentsForDay(day: number): Promise<void> {
    if (!this.stateStore) return

    const commitments = await this.stateStore.loadCommitmentsForDay(day)
    for (const commitment of commitments) {
      this.activeCommitments.set(commitment.id, commitment)
    }

    console.log(`[CommitmentManager] Loaded ${commitments.length} commitments for day ${day}`)
  }

  /**
   * Expire old commitments (called on day change)
   */
  async expireOldCommitments(currentDay: number): Promise<void> {
    // Mark past-day pending commitments as expired in memory
    for (const [id, commitment] of this.activeCommitments) {
      if (commitment.status === 'pending' && commitment.targetDay < currentDay) {
        commitment.status = 'expired'
        this.activeCommitments.delete(id)
        if (this.stateStore) {
          await this.stateStore.updateCommitmentStatus(id, 'expired')
        }
      }
    }

    // Clear triggered tracking for new day
    this.triggeredCommitments.clear()

    // Delete old commitments from DB
    if (this.stateStore) {
      const deleted = await this.stateStore.deleteExpiredCommitments(currentDay)
      if (deleted > 0) {
        console.log(`[CommitmentManager] Deleted ${deleted} expired commitments`)
      }
    }
  }

  /**
   * Check if current time is within N minutes before target time
   */
  private isWithinMinutesBefore(targetTime: string, currentTime: WorldTime, minutes: number): boolean {
    const [targetHour, targetMinute] = targetTime.split(':').map(Number)
    const targetTotalMinutes = targetHour * 60 + targetMinute
    const currentTotalMinutes = currentTime.hour * 60 + currentTime.minute

    // Calculate time difference
    const diff = targetTotalMinutes - currentTotalMinutes

    // Trigger if within [0, minutes] range (0 = exact time, negative = past)
    return diff >= 0 && diff <= minutes
  }

  /**
   * Get all active commitments (for debugging)
   */
  getActiveCommitments(): NPCCommitment[] {
    return Array.from(this.activeCommitments.values())
  }
}
