import type { ActionState } from '@/types/action'
import type { SimCharacter } from '../types'
import type { WorldStateManager } from '../WorldState'
import { ACTIONS, type ActionId } from './definitions'

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
    const character = this.worldState.getCharacter(characterId)
    if (!character) {
      console.log(`[ActionExecutor] Character not found: ${characterId}`)
      return false
    }

    // 既にアクション実行中
    if (character.currentAction) {
      console.log(`[ActionExecutor] Character ${characterId} already executing action: ${character.currentAction.actionId}`)
      return false
    }

    // アクション定義取得
    const actionDef = ACTIONS[actionId]
    if (!actionDef) {
      console.log(`[ActionExecutor] Action not found: ${actionId}`)
      return false
    }

    // ActionState作成
    const now = Date.now()
    const actionState: ActionState = {
      actionId,
      startTime: now,
      targetEndTime: now + actionDef.duration,
      facilityId,
    }

    // キャラクター状態更新
    this.worldState.updateCharacter(characterId, {
      currentAction: actionState,
    })

    console.log(`[ActionExecutor] ${character.name} started action: ${actionId} (duration: ${actionDef.duration / 1000}s)`)
    return true
  }

  /** アクションキャンセル */
  cancelAction(characterId: string): void {
    const character = this.worldState.getCharacter(characterId)
    if (!character?.currentAction) return

    const actionId = character.currentAction.actionId
    this.worldState.updateCharacter(characterId, {
      currentAction: null,
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
      // 定義がない場合はクリアのみ
      this.worldState.updateCharacter(characterId, {
        currentAction: null,
      })
      return
    }

    // ステータス効果を適用
    if (actionDef.effects.stats) {
      this.applyStatEffects(characterId, actionDef.effects.stats)
    }

    // お金の効果を適用（固定額のみ、hourlyWageはStep 7で実装）
    if (typeof actionDef.effects.money === 'number') {
      const newMoney = character.money + actionDef.effects.money
      this.worldState.updateCharacter(characterId, {
        money: Math.max(0, newMoney),
      })
    }

    // アクション状態クリア
    this.worldState.updateCharacter(characterId, {
      currentAction: null,
    })

    console.log(`[ActionExecutor] ${character.name} completed action: ${actionId}`)
  }

  /**
   * ステータス効果の適用
   * - hunger/bladder: 減算（高い値=不満なので、アクションで下げる）
   * - energy/hygiene/mood: 加算（高い値=良好なので、アクションで上げる）
   */
  private applyStatEffects(
    characterId: string,
    stats: Partial<Record<'hunger' | 'energy' | 'hygiene' | 'mood' | 'bladder', number>>
  ): void {
    const character = this.worldState.getCharacter(characterId)
    if (!character) return

    const updates: Partial<SimCharacter> = {}

    if (stats.hunger !== undefined) {
      updates.hunger = this.clamp(character.hunger - stats.hunger, 0, 100)
    }
    if (stats.bladder !== undefined) {
      updates.bladder = this.clamp(character.bladder - stats.bladder, 0, 100)
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
      console.log(`[ActionExecutor] Applied stat effects to ${character.name}:`, updates)
    }
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value))
  }
}
