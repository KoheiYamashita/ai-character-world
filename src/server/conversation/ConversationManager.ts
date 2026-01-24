import type { ConversationSession, ConversationGoal, ConversationMessage } from '@/types'
import type { WorldStateManager } from '../simulation/WorldState'

export type ConversationEventCallback = (session: ConversationSession) => void

export class ConversationManager {
  private activeSessions: Map<string, ConversationSession> = new Map() // key: characterId
  private worldState: WorldStateManager
  private onConversationStart: ConversationEventCallback | null = null
  private onConversationEnd: ConversationEventCallback | null = null
  private sessionCounter = 0

  constructor(worldState: WorldStateManager) {
    this.worldState = worldState
  }

  setOnConversationStart(callback: ConversationEventCallback): void {
    this.onConversationStart = callback
  }

  setOnConversationEnd(callback: ConversationEventCallback): void {
    this.onConversationEnd = callback
  }

  startConversation(characterId: string, npcId: string, goal: ConversationGoal): ConversationSession | null {
    // Don't start if character already has an active session
    if (this.activeSessions.has(characterId)) {
      console.log(`[ConversationManager] Character ${characterId} already in conversation`)
      return null
    }

    const npc = this.worldState.getNPC(npcId)
    if (!npc) {
      console.log(`[ConversationManager] NPC ${npcId} not found`)
      return null
    }

    // Check if NPC is already in conversation
    if (npc.isInConversation) {
      console.log(`[ConversationManager] NPC ${npcId} already in conversation`)
      return null
    }

    this.sessionCounter++
    const session: ConversationSession = {
      id: `conv-${this.sessionCounter}-${Date.now()}`,
      characterId,
      npcId,
      goal,
      messages: [],
      currentTurn: 0,
      maxTurns: 10,
      startTime: Date.now(),
      status: 'active',
      goalAchieved: false,
    }

    // Update NPC state
    this.worldState.setNPCConversationState(npcId, true)

    // Update character state
    this.worldState.updateCharacter(characterId, {
      conversation: session,
      displayEmoji: '💬',
    })

    this.activeSessions.set(characterId, session)

    console.log(`[ConversationManager] Started conversation: ${characterId} <-> ${npc.name} (goal: ${goal.goal})`)

    if (this.onConversationStart) {
      this.onConversationStart(session)
    }

    return session
  }

  addMessage(characterId: string, message: ConversationMessage): void {
    const session = this.activeSessions.get(characterId)
    if (!session) return

    session.messages.push(message)
    // A turn = 1 character message + 1 NPC response (2 messages per turn)
    session.currentTurn = Math.floor(session.messages.length / 2)

    // Sync session to character state
    this.worldState.updateCharacter(characterId, {
      conversation: { ...session },
    })
  }

  endConversation(characterId: string, goalAchieved: boolean): ConversationSession | null {
    const session = this.activeSessions.get(characterId)
    if (!session) return null

    // Update session status
    session.status = 'completed'
    session.goalAchieved = goalAchieved

    // Clear NPC state
    const npc = this.worldState.getNPC(session.npcId)
    if (npc) {
      this.worldState.setNPCConversationState(session.npcId, false)
    }

    // Clear character conversation state
    this.worldState.updateCharacter(characterId, {
      conversation: null,
      displayEmoji: undefined,
    })

    this.activeSessions.delete(characterId)

    console.log(`[ConversationManager] Ended conversation: ${characterId} (goalAchieved: ${goalAchieved})`)

    if (this.onConversationEnd) {
      this.onConversationEnd(session)
    }

    return session
  }

  getActiveSession(characterId: string): ConversationSession | null {
    return this.activeSessions.get(characterId) ?? null
  }

  isAtMaxTurns(characterId: string): boolean {
    const session = this.activeSessions.get(characterId)
    if (!session) return false
    return session.currentTurn >= session.maxTurns
  }
}
