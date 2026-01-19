import type { ActionState } from '@/types/action'
import type { FacilityInfo, JobInfo } from '@/types'
import type { SimCharacter } from '../types'
import type { WorldStateManager } from '../WorldState'
import { ACTIONS, type ActionId } from './definitions'
import { findZoneFacilityForNode, findBuildingFacilityNearNode } from '@/lib/facilityUtils'

/**
 * アクションの実行管理（開始・進行・完了）
 */
export class ActionExecutor {
  private worldState: WorldStateManager

  constructor(worldState: WorldStateManager) {
    this.worldState = worldState
  }

  /** 毎tick呼び出し - アクション完了チェック */
  tick(currentTime: number): void {
    const characters = this.worldState.getAllCharacters()

    for (const character of characters) {
      if (character.currentAction) {
        this.updateAction(character, currentTime)
      }
    }
  }

  /** アクション開始。成功時true、失敗時false */
  startAction(characterId: string, actionId: ActionId, facilityId?: string): boolean {
    // 前提条件チェック (6-2)
    const checkResult = this.canExecuteAction(characterId, actionId)
    if (!checkResult.canExecute) {
      console.log(`[ActionExecutor] Cannot start action ${actionId}: ${checkResult.reason}`)
      return false
    }

    const character = this.worldState.getCharacter(characterId)!
    const actionDef = ACTIONS[actionId]!

    // コストの支払い
    const facility = this.getCurrentFacility(characterId)
    if (actionDef.requirements.cost === 'facility' && facility?.cost !== undefined) {
      this.worldState.updateCharacter(characterId, {
        money: character.money - facility.cost,
      })
      console.log(`[ActionExecutor] ${character.name} paid ${facility.cost} for ${actionId}`)
    } else if (typeof actionDef.requirements.cost === 'number') {
      this.worldState.updateCharacter(characterId, {
        money: character.money - actionDef.requirements.cost,
      })
      console.log(`[ActionExecutor] ${character.name} paid ${actionDef.requirements.cost} for ${actionId}`)
    }

    // ActionState作成
    const now = Date.now()
    const actionState: ActionState = {
      actionId,
      startTime: now,
      targetEndTime: now + actionDef.duration,
      facilityId: facilityId ?? facility?.owner,
    }

    // キャラクター状態更新（displayEmoji設定含む）
    this.worldState.updateCharacter(characterId, {
      currentAction: actionState,
      displayEmoji: actionDef.emoji,  // 頭上絵文字を設定 (6-4)
    })

    console.log(`[ActionExecutor] ${character.name} started action: ${actionId} (duration: ${actionDef.duration / 1000}s, emoji: ${actionDef.emoji ?? 'none'})`)
    return true
  }

  /** アクションキャンセル */
  cancelAction(characterId: string): void {
    const character = this.worldState.getCharacter(characterId)
    if (!character?.currentAction) return

    const actionId = character.currentAction.actionId
    this.worldState.updateCharacter(characterId, {
      currentAction: null,
      displayEmoji: undefined,  // 絵文字もクリア (6-4)
    })

    console.log(`[ActionExecutor] ${character.name} cancelled action: ${actionId}`)
  }

  /** アクション実行中かどうか */
  isExecutingAction(characterId: string): boolean {
    const character = this.worldState.getCharacter(characterId)
    return character?.currentAction != null
  }

  private updateAction(character: SimCharacter, currentTime: number): void {
    const action = character.currentAction
    if (!action) return

    // 終了時刻に達したら完了
    if (currentTime >= action.targetEndTime) {
      this.completeAction(character.id)
    }
  }

  private completeAction(characterId: string): void {
    const character = this.worldState.getCharacter(characterId)
    if (!character?.currentAction) return

    const actionId = character.currentAction.actionId
    const actionDef = ACTIONS[actionId]
    if (!actionDef) {
      // 定義がない場合はクリアのみ（displayEmojiもクリア）
      this.worldState.updateCharacter(characterId, {
        currentAction: null,
        displayEmoji: undefined,
      })
      return
    }

    // ステータス効果を適用（ログ強化 6-3）
    if (actionDef.effects.stats) {
      // 適用前ステータスをログ
      console.log(`[ActionExecutor] ${character.name} before ${actionId}:`, {
        hunger: character.hunger,
        energy: character.energy,
        hygiene: character.hygiene,
        mood: character.mood,
        bladder: character.bladder,
      })

      this.applyStatEffects(characterId, actionDef.effects.stats)

      // 適用後ステータスをログ
      const updatedChar = this.worldState.getCharacter(characterId)
      if (updatedChar) {
        console.log(`[ActionExecutor] ${character.name} after ${actionId}:`, {
          hunger: updatedChar.hunger,
          energy: updatedChar.energy,
          hygiene: updatedChar.hygiene,
          mood: updatedChar.mood,
          bladder: updatedChar.bladder,
        })
      }
    }

    // お金の効果を適用
    if (actionDef.effects.money === 'hourlyWage') {
      // 時給計算
      const facility = this.getCurrentFacility(characterId)
      if (facility?.job) {
        const durationMs = character.currentAction!.targetEndTime - character.currentAction!.startTime
        const hoursWorked = durationMs / (60 * 60 * 1000)
        const earnings = Math.floor(facility.job.hourlyWage * hoursWorked)
        const newMoney = character.money + earnings
        this.worldState.updateCharacter(characterId, {
          money: newMoney,
        })
        console.log(`[ActionExecutor] ${character.name} earned ${earnings} yen (${hoursWorked.toFixed(2)} hours at ${facility.job.hourlyWage}/hour)`)
      }
    } else if (typeof actionDef.effects.money === 'number') {
      const newMoney = character.money + actionDef.effects.money
      this.worldState.updateCharacter(characterId, {
        money: Math.max(0, newMoney),
      })
    }

    console.log(`[ActionExecutor] ${character.name} completed action: ${actionId}`)

    // アクション状態クリア + displayEmojiクリア (6-4)
    this.worldState.updateCharacter(characterId, {
      currentAction: null,
      displayEmoji: undefined,
    })
  }

  /**
   * ステータス効果の適用
   * All stats: 100 = good, 0 = bad
   * Actions restore stats by adding positive values.
   */
  private applyStatEffects(
    characterId: string,
    stats: Partial<Record<'hunger' | 'energy' | 'hygiene' | 'mood' | 'bladder', number>>
  ): void {
    const character = this.worldState.getCharacter(characterId)
    if (!character) return

    const updates: Partial<SimCharacter> = {}

    // All stats use addition (positive values restore towards 100)
    if (stats.hunger !== undefined) {
      updates.hunger = this.clamp(character.hunger + stats.hunger, 0, 100)
    }
    if (stats.bladder !== undefined) {
      updates.bladder = this.clamp(character.bladder + stats.bladder, 0, 100)
    }
    if (stats.energy !== undefined) {
      updates.energy = this.clamp(character.energy + stats.energy, 0, 100)
    }
    if (stats.hygiene !== undefined) {
      updates.hygiene = this.clamp(character.hygiene + stats.hygiene, 0, 100)
    }
    if (stats.mood !== undefined) {
      updates.mood = this.clamp(character.mood + stats.mood, 0, 100)
    }

    if (Object.keys(updates).length > 0) {
      this.worldState.updateCharacter(characterId, updates)
    }
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value))
  }

  // =====================
  // Zone/Facility判定 (6-1)
  // =====================

  /**
   * Parse nodeId to extract grid coordinates.
   * nodeId format: "{prefix}-{row}-{col}"
   */
  private parseNodeIdToGridCoord(nodeId: string): { row: number; col: number } | null {
    const parts = nodeId.split('-')
    if (parts.length < 3) return null

    const row = parseInt(parts[parts.length - 2], 10)
    const col = parseInt(parts[parts.length - 1], 10)

    if (isNaN(row) || isNaN(col)) return null
    return { row, col }
  }

  /**
   * Get the facility info for a character's current position.
   * Checks both zone facilities and building facilities (with proximity).
   */
  getCurrentFacility(characterId: string): FacilityInfo | null {
    const character = this.worldState.getCharacter(characterId)
    if (!character) return null

    const map = this.worldState.getMap(character.currentMapId)
    if (!map) return null

    const coord = this.parseNodeIdToGridCoord(character.currentNodeId)
    if (!coord) return null

    // First check if inside a zone with facility
    const zoneFacility = findZoneFacilityForNode(coord.row, coord.col, map.obstacles)
    if (zoneFacility) return zoneFacility

    // Check if near a building with facility (proximity = 1)
    const buildingFacility = findBuildingFacilityNearNode(coord.row, coord.col, map.obstacles, 1)
    return buildingFacility
  }

  // =====================
  // 実行可能アクション判定 (6-2)
  // =====================

  /**
   * Check if a character can execute a specific action.
   * Returns { canExecute: true } or { canExecute: false, reason: string }
   */
  canExecuteAction(
    characterId: string,
    actionId: ActionId
  ): { canExecute: boolean; reason?: string } {
    const character = this.worldState.getCharacter(characterId)
    if (!character) {
      return { canExecute: false, reason: 'Character not found' }
    }

    // Cannot start a new action while already executing one
    if (character.currentAction) {
      return { canExecute: false, reason: `Already executing action: ${character.currentAction.actionId}` }
    }

    const actionDef = ACTIONS[actionId]
    if (!actionDef) {
      return { canExecute: false, reason: `Action not found: ${actionId}` }
    }

    const requirements = actionDef.requirements
    const facility = this.getCurrentFacility(characterId)

    // Check facility tags
    if (requirements.facilityTags && requirements.facilityTags.length > 0) {
      if (!facility) {
        return { canExecute: false, reason: `Requires facility with tags: ${requirements.facilityTags.join(', ')}` }
      }
      const hasAllTags = requirements.facilityTags.every(tag => facility.tags.includes(tag))
      if (!hasAllTags) {
        return { canExecute: false, reason: `Facility missing required tags: ${requirements.facilityTags.filter(t => !facility.tags.includes(t)).join(', ')}` }
      }
    }

    // Check ownership
    if (requirements.ownership === 'self' && facility) {
      if (facility.owner && facility.owner !== characterId) {
        return { canExecute: false, reason: `Facility owned by ${facility.owner}, not ${characterId}` }
      }
    }

    // Check cost
    if (requirements.cost === 'facility' && facility?.cost !== undefined) {
      if (character.money < facility.cost) {
        return { canExecute: false, reason: `Not enough money: ${character.money} < ${facility.cost}` }
      }
    } else if (typeof requirements.cost === 'number') {
      if (character.money < requirements.cost) {
        return { canExecute: false, reason: `Not enough money: ${character.money} < ${requirements.cost}` }
      }
    }

    // TODO: Check nearNpc requirement (Step 12-13)

    // Check employment requirement
    if (requirements.employment) {
      const employmentCheck = this.checkEmploymentRequirements(character, facility)
      if (!employmentCheck.canExecute) {
        return employmentCheck
      }
    }

    return { canExecute: true }
  }

  /**
   * Get all actions that a character can currently execute.
   */
  getAvailableActions(characterId: string): ActionId[] {
    const availableActions: ActionId[] = []

    for (const actionId of Object.keys(ACTIONS) as ActionId[]) {
      const result = this.canExecuteAction(characterId, actionId)
      if (result.canExecute) {
        availableActions.push(actionId)
      }
    }

    return availableActions
  }

  /**
   * Check if character meets employment requirements for work action.
   */
  private checkEmploymentRequirements(
    character: SimCharacter,
    facility: FacilityInfo | null
  ): { canExecute: boolean; reason?: string } {
    if (!character.employment) {
      return { canExecute: false, reason: 'No employment (work requires employment)' }
    }

    if (!facility?.job) {
      return { canExecute: false, reason: 'Current facility has no job' }
    }

    if (facility.job.jobId !== character.employment.jobId) {
      return {
        canExecute: false,
        reason: `Job mismatch: facility has ${facility.job.jobId}, character has ${character.employment.jobId}`,
      }
    }

    if (!this.isWithinWorkHours(facility.job)) {
      const { start, end } = facility.job.workHours
      const currentHour = this.worldState.getCurrentHour()
      return {
        canExecute: false,
        reason: `Outside work hours: ${start}:00-${end}:00 (current: ${currentHour}:00)`,
      }
    }

    return { canExecute: true }
  }

  /**
   * Check if current time is within job's work hours.
   * Handles overnight shifts (e.g., 22:00-06:00).
   */
  private isWithinWorkHours(job: JobInfo): boolean {
    const currentHour = this.worldState.getCurrentHour()
    const { start, end } = job.workHours

    if (start <= end) {
      // Normal hours (e.g., 9-17)
      return currentHour >= start && currentHour < end
    }
    // Overnight shift (e.g., 22-6)
    return currentHour >= start || currentHour < end
  }
}
