import type { WorldStateManager } from '../WorldState'
import type { ActionExecutor } from './ActionExecutor'
import type { ActionId } from './definitions'

/**
 * Status thresholds for automatic action triggering.
 * All stats: 100 = good, 0 = bad.
 * Actions trigger when stat falls below threshold.
 */
const STATUS_THRESHOLDS = {
  bladder: 20,  // 20% or below -> toilet
  hunger: 20,   // 20% or below -> eat
  energy: 20,   // 20% or below -> sleep
  hygiene: 20,  // 20% or below -> bathe
}

/**
 * Action mapping for each status type.
 * Maps status to action that resolves it.
 */
const STATUS_TO_ACTION: Record<string, ActionId[]> = {
  bladder: ['toilet'],
  hunger: ['eat_home', 'eat_restaurant'],
  energy: ['sleep'],
  hygiene: ['bathe_home', 'bathe_hotspring'],
}

/**
 * SimpleActionTrigger - Test stub for automatic action triggering
 *
 * This is a placeholder until BehaviorDecider (Step 12) is implemented.
 * It checks character status and triggers actions when thresholds are crossed.
 *
 * Priority order: bladder > hunger > energy > hygiene
 */
export class SimpleActionTrigger {
  private worldState: WorldStateManager
  private actionExecutor: ActionExecutor

  constructor(worldState: WorldStateManager, actionExecutor: ActionExecutor) {
    this.worldState = worldState
    this.actionExecutor = actionExecutor
  }

  /**
   * Check and trigger actions based on status thresholds.
   * Called once per tick from SimulationEngine.
   */
  tick(): void {
    const characters = this.worldState.getAllCharacters()

    for (const character of characters) {
      // Skip if already executing action
      if (character.currentAction) continue

      // Skip if in conversation
      if (character.conversation?.isActive) continue

      // Skip if moving
      if (character.navigation.isMoving) continue

      // Check status in priority order
      this.checkAndTriggerAction(character.id)
    }
  }

  /**
   * Check character status and trigger appropriate action if needed.
   * All stats: 100 = good, 0 = bad. Trigger when below threshold.
   * Priority: bladder > hunger > energy > hygiene
   */
  private checkAndTriggerAction(characterId: string): void {
    const character = this.worldState.getCharacter(characterId)
    if (!character) return

    // Check status in priority order (most urgent first)
    const statusChecks: Array<{ stat: number; type: string }> = [
      { stat: character.bladder, type: 'bladder' },
      { stat: character.hunger, type: 'hunger' },
      { stat: character.energy, type: 'energy' },
      { stat: character.hygiene, type: 'hygiene' },
    ]

    for (const { stat, type } of statusChecks) {
      const threshold = STATUS_THRESHOLDS[type as keyof typeof STATUS_THRESHOLDS]
      if (stat <= threshold) {
        if (this.tryTriggerAction(character.id, character.name, type)) return
      }
    }
  }

  /**
   * Try to trigger an action for a specific status type.
   * Returns true if action was started, false otherwise.
   */
  private tryTriggerAction(characterId: string, characterName: string, statusType: string): boolean {
    const possibleActions = STATUS_TO_ACTION[statusType]
    if (!possibleActions) return false

    // Try each possible action in order
    for (const actionId of possibleActions) {
      const checkResult = this.actionExecutor.canExecuteAction(characterId, actionId)

      if (checkResult.canExecute) {
        const success = this.actionExecutor.startAction(characterId, actionId)
        if (success) {
          console.log(`[SimpleActionTrigger] ${characterName} auto-started ${actionId} (${statusType} threshold crossed)`)
          return true
        }
      } else {
        // Log why action cannot be executed (useful for debugging)
        console.log(`[SimpleActionTrigger] ${characterName} cannot ${actionId}: ${checkResult.reason}`)
      }
    }

    // Could not execute any action for this status
    // In the future (Step 12), BehaviorDecider will handle navigation to appropriate facility
    console.log(`[SimpleActionTrigger] ${characterName} needs ${statusType} relief but no suitable facility available`)
    return false
  }
}
