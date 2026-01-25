import type { ActionState, EffectPerMinute } from '@/types/action'
import type { FacilityInfo, JobInfo, ActionConfig } from '@/types'
import type { SimCharacter } from '../types'
import type { WorldStateManager } from '../WorldState'
import { ACTIONS, type ActionId } from './definitions'
import { findZoneFacilityForNode, findBuildingFacilityNearNode } from '@/lib/facilityUtils'
import { parseNodeIdToGridCoord } from '@/lib/gridUtils'

/** Callback type for action completion events */
export type ActionCompleteCallback = (characterId: string, actionId: ActionId) => void

/** Callback type for action start events */
export type ActionStartCallback = (entry: {
  characterId: string
  actionId: ActionId
  facilityId?: string
  targetNpcId?: string
  durationMinutes?: number
  reason?: string
  startTimeReal: number  // Date.now() at action start
}) => void

/** Callback type for recording action history (legacy: completion only) */
export type ActionHistoryCallback = (entry: {
  characterId: string
  actionId: ActionId
  facilityId?: string
  targetNpcId?: string
  durationMinutes?: number
  reason?: string
}) => void

/**
 * アクションの実行管理（開始・進行・完了）
 *
 * アクションの時間と効果は world-config.json の actions セクションから読み込む。
 * LLMが可変時間アクションの実行時間を指定できる（durationMinutes）。
 */
export class ActionExecutor {
  private worldState: WorldStateManager
  private onActionComplete?: ActionCompleteCallback
  private onActionStart?: ActionStartCallback
  private onRecordHistory?: ActionHistoryCallback
  private actionConfigs: Record<string, ActionConfig> = {}

  constructor(worldState: WorldStateManager) {
    this.worldState = worldState
  }

  /**
   * アクション設定を設定（world-config.json の actions セクション）
   */
  setActionConfigs(configs: Record<string, ActionConfig>): void {
    this.actionConfigs = configs
    console.log(`[ActionExecutor] Loaded action configs for: ${Object.keys(configs).join(', ')}`)
  }

  /**
   * アクションタイプの設定を取得
   */
  getActionConfig(actionType: string): ActionConfig | undefined {
    return this.actionConfigs[actionType]
  }

  /**
   * キャラクターが実行中のアクションの perMinute 効果を取得
   * @returns perMinute 効果、またはアクション実行中でない/固定時間アクションの場合は null
   */
  getActivePerMinuteEffects(characterId: string): EffectPerMinute | null {
    const character = this.worldState.getCharacter(characterId)
    if (!character?.currentAction) return null

    const actionId = character.currentAction.actionId
    const actionDef = ACTIONS[actionId]
    if (!actionDef) return null

    const actionConfig = this.actionConfigs[actionId]
    if (!actionConfig) return null

    // 固定時間アクションには perMinute がないので null を返す
    if (actionConfig.fixed) return null

    // 可変時間アクションの perMinute を返す
    return actionConfig.perMinute ?? null
  }

  /** Set callback for action completion events */
  setOnActionComplete(callback: ActionCompleteCallback): void {
    this.onActionComplete = callback
  }

  /** Set callback for action start events */
  setOnActionStart(callback: ActionStartCallback): void {
    this.onActionStart = callback
  }

  /** Set callback for recording action history */
  setOnRecordHistory(callback: ActionHistoryCallback): void {
    this.onRecordHistory = callback
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

  /**
   * アクション開始。成功時true、失敗時false
   * @param characterId キャラクターID
   * @param actionId アクションID
   * @param facilityId 施設ID（オプション）
   * @param targetNpcId 対象NPC ID（talkアクション用）
   * @param durationMinutes 実行時間（分）- 可変時間アクションの場合にLLMが指定
   * @param reason 行動理由（LLMが出力したもの）
   */
  startAction(
    characterId: string,
    actionId: ActionId,
    facilityId?: string,
    targetNpcId?: string,
    durationMinutes?: number,
    reason?: string
  ): boolean {
    // 前提条件チェック (6-2)
    const checkResult = this.canExecuteAction(characterId, actionId)
    if (!checkResult.canExecute) {
      console.log(`[ActionExecutor] Cannot start action ${actionId}: ${checkResult.reason}`)
      return false
    }

    const character = this.worldState.getCharacter(characterId)!
    const actionDef = ACTIONS[actionId]!
    const actionConfig = this.actionConfigs[actionId]

    // コストの支払い（施設にcostが設定されていれば支払う）
    const facility = this.getCurrentFacility(characterId)
    if (facility?.cost !== undefined && facility.cost > 0) {
      this.worldState.updateCharacter(characterId, {
        money: character.money - facility.cost,
      })
      console.log(`[ActionExecutor] ${character.name} paid ${facility.cost} for ${actionId}`)
    }

    // 時間計算
    const { durationMs, actualDurationMinutes } = this.calculateDuration(actionConfig, durationMinutes)

    // ActionState作成
    const now = Date.now()
    const actionState: ActionState = {
      actionId,
      startTime: now,
      targetEndTime: now + durationMs,
      facilityId: facilityId ?? facility?.owner,
      targetNpcId,  // talk アクション用
      durationMinutes: actualDurationMinutes,  // 選択された時間を記録
      reason,  // 行動理由を記録
    }

    // キャラクター状態更新（displayEmoji設定含む）
    this.worldState.updateCharacter(characterId, {
      currentAction: actionState,
      displayEmoji: actionDef.emoji,  // 頭上絵文字を設定 (6-4)
    })

    const durationStr = actualDurationMinutes !== undefined
      ? `${actualDurationMinutes}min`
      : `${durationMs / 1000}s`
    console.log(`[ActionExecutor] ${character.name} started action: ${actionId} (duration: ${durationStr}, emoji: ${actionDef.emoji ?? 'none'})`)

    // Notify action start callback (skip thinking action - it's internal)
    if (this.onActionStart && actionId !== 'thinking') {
      this.onActionStart({
        characterId,
        actionId,
        facilityId: facilityId ?? facility?.owner,
        targetNpcId,
        durationMinutes: actualDurationMinutes,
        reason,
        startTimeReal: now,
      })
    }

    return true
  }

  /**
   * アクションの実行時間を計算
   * @returns durationMs（ミリ秒）と actualDurationMinutes（分、可変時間の場合のみ）
   */
  private calculateDuration(
    actionConfig: ActionConfig | undefined,
    requestedDurationMinutes?: number
  ): { durationMs: number; actualDurationMinutes?: number } {
    // 設定がない場合は0（thinking等の即時完了アクション）
    if (!actionConfig) {
      return { durationMs: 0 }
    }

    // 固定時間アクション
    if (actionConfig.fixed) {
      const durationMs = (actionConfig.duration ?? 0) * 60 * 1000
      return { durationMs }
    }

    // 可変時間アクション
    if (actionConfig.durationRange) {
      const { min, max, default: defaultDuration } = actionConfig.durationRange

      if (requestedDurationMinutes !== undefined) {
        // LLMが指定した時間を範囲内にクランプ
        const clamped = Math.max(min, Math.min(max, requestedDurationMinutes))
        return {
          durationMs: clamped * 60 * 1000,
          actualDurationMinutes: clamped,
        }
      } else {
        // 指定がない場合はデフォルト時間を使用
        return {
          durationMs: defaultDuration * 60 * 1000,
          actualDurationMinutes: defaultDuration,
        }
      }
    }

    // フォールバック
    return { durationMs: 0 }
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

  /**
   * アクションを強制完了（thinking等、duration: 0 のアクション用）
   * 効果は適用されず、状態のみクリアする。
   */
  forceCompleteAction(characterId: string): void {
    const character = this.worldState.getCharacter(characterId)
    if (!character?.currentAction) return

    const actionId = character.currentAction.actionId
    console.log(`[ActionExecutor] ${character.name} force-completed action: ${actionId}`)

    // 状態クリアのみ（効果は適用しない）
    this.worldState.updateCharacter(characterId, {
      currentAction: null,
      displayEmoji: undefined,
    })

    // Note: forceComplete ではコールバックを呼ばない（thinking 完了後に別の判断をするため）
  }

  private updateAction(character: SimCharacter, currentTime: number): void {
    const action = character.currentAction
    if (!action) return

    // thinking, talk アクションは手動完了のみ（duration: 0 だが自動完了しない）
    if (action.actionId === 'thinking' || action.actionId === 'talk') return

    // 終了時刻に達したら完了
    if (currentTime >= action.targetEndTime) {
      this.completeAction(character.id)
    }
  }

  private completeAction(characterId: string): void {
    const character = this.worldState.getCharacter(characterId)
    if (!character?.currentAction) return

    const actionId = character.currentAction.actionId
    const durationMinutes = character.currentAction.durationMinutes
    const actionDef = ACTIONS[actionId]
    if (!actionDef) {
      // 定義がない場合はクリアのみ（displayEmojiもクリア）
      this.worldState.updateCharacter(characterId, {
        currentAction: null,
        displayEmoji: undefined,
      })
      return
    }

    // world-config.json からアクション設定を取得
    const actionConfig = this.actionConfigs[actionId]

    // 適用前ステータスをログ
    console.log(`[ActionExecutor] ${character.name} before ${actionId}:`, {
      satiety: character.satiety,
      energy: character.energy,
      hygiene: character.hygiene,
      mood: character.mood,
      bladder: character.bladder,
    })

    // ステータス効果を適用
    // 可変時間アクション: perMinute 効果は SimulationEngine.applyStatusDecay でリアルタイム適用済み
    // 固定時間アクション: 完了時に固定の効果を適用
    if (actionConfig?.fixed && actionConfig.effects) {
      this.applyStatEffectsInternal(characterId, actionConfig.effects)
    }

    // 適用後ステータスをログ
    const updatedChar = this.worldState.getCharacter(characterId)
    if (updatedChar) {
      console.log(`[ActionExecutor] ${character.name} after ${actionId}:`, {
        satiety: updatedChar.satiety,
        energy: updatedChar.energy,
        hygiene: updatedChar.hygiene,
        mood: updatedChar.mood,
        bladder: updatedChar.bladder,
      })
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

    const durationStr = durationMinutes !== undefined ? `(${durationMinutes}min)` : ''
    console.log(`[ActionExecutor] ${character.name} completed action: ${actionId} ${durationStr}`)

    // Record action history (before clearing action state)
    if (this.onRecordHistory) {
      this.onRecordHistory({
        characterId,
        actionId,
        facilityId: character.currentAction.facilityId,
        targetNpcId: character.currentAction.targetNpcId,
        durationMinutes,
        reason: character.currentAction.reason,
      })
    }

    // アクション状態クリア + displayEmojiクリア (6-4)
    this.worldState.updateCharacter(characterId, {
      currentAction: null,
      displayEmoji: undefined,
    })

    // Notify callback (for behavior decision trigger)
    if (this.onActionComplete) {
      this.onActionComplete(characterId, actionId)
    }
  }

  /**
   * ステータス効果の適用（共通処理）
   * All stats: 100 = good, 0 = bad
   * Actions restore stats by adding positive values.
   * @param multiplier - 効果の倍率（perMinute の場合は durationMinutes）
   */
  private applyStatEffectsInternal(
    characterId: string,
    stats: Partial<Record<'satiety' | 'energy' | 'hygiene' | 'mood' | 'bladder', number>>,
    multiplier: number = 1,
    logLabel?: string
  ): void {
    const character = this.worldState.getCharacter(characterId)
    if (!character) return

    const statKeys = ['satiety', 'energy', 'hygiene', 'mood', 'bladder'] as const
    const updates: Partial<SimCharacter> = {}

    for (const key of statKeys) {
      const value = stats[key]
      if (value !== undefined) {
        const effect = value * multiplier
        updates[key] = this.clamp(character[key] + effect, 0, 100)
      }
    }

    if (Object.keys(updates).length > 0) {
      this.worldState.updateCharacter(characterId, updates)
      if (logLabel) {
        console.log(`[ActionExecutor] Applied ${logLabel}:`, updates)
      }
    }
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value))
  }

  // =====================
  // Zone/Facility判定 (6-1)
  // =====================

  /**
   * Get the facility info for a character's current position.
   * Checks both zone facilities and building facilities (with proximity).
   */
  getCurrentFacility(characterId: string): FacilityInfo | null {
    const character = this.worldState.getCharacter(characterId)
    if (!character) return null

    const map = this.worldState.getMap(character.currentMapId)
    if (!map) return null

    const coord = parseNodeIdToGridCoord(character.currentNodeId)
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
   *
   * @param options.ignoreCurrentAction - trueの場合、currentActionチェックをスキップ。
   *   thinking中にgetAvailableActionsで利用可能アクションを取得するために使用。
   */
  canExecuteAction(
    characterId: string,
    actionId: ActionId,
    options?: { ignoreCurrentAction?: boolean }
  ): { canExecute: boolean; reason?: string } {
    const character = this.worldState.getCharacter(characterId)
    if (!character) {
      return { canExecute: false, reason: 'Character not found' }
    }

    // Cannot start a new action while already executing one
    // (ignoreCurrentAction: true の場合、thinking中の可用性チェック用にスキップ)
    if (character.currentAction && !options?.ignoreCurrentAction) {
      return { canExecute: false, reason: `Already executing action: ${character.currentAction.actionId}` }
    }

    const actionDef = ACTIONS[actionId]
    if (!actionDef) {
      return { canExecute: false, reason: `Action not found: ${actionId}` }
    }

    const requirements = actionDef.requirements

    // Check facility tags at MAP level (not position level)
    // Character can execute action if there's an accessible facility with any required tag on the map
    if (requirements.facilityTags && requirements.facilityTags.length > 0) {
      const map = this.worldState.getMap(character.currentMapId)
      if (!map) {
        return { canExecute: false, reason: 'Map not found' }
      }

      // Check if map has an accessible facility with any of the required tags
      // Accessible = no owner (public) OR owned by this character, AND affordable
      const hasAccessibleFacility = map.obstacles.some(obs => {
        if (!obs.facility) return false
        const hasTag = requirements.facilityTags!.some(tag => obs.facility!.tags.includes(tag))
        if (!hasTag) return false
        // Owner check: if facility has owner, only owner can use
        if (obs.facility.owner && obs.facility.owner !== characterId) return false
        // Cost check: if facility has cost, character needs enough money
        if (obs.facility.cost !== undefined && character.money < obs.facility.cost) return false
        return true
      })

      if (!hasAccessibleFacility) {
        return { canExecute: false, reason: `No accessible facility with tags: ${requirements.facilityTags.join(', ')}` }
      }
    }

    // Check employment requirement
    if (requirements.employment) {
      const facility = this.getCurrentFacility(characterId)
      const employmentCheck = this.checkEmploymentRequirements(character, facility)
      if (!employmentCheck.canExecute) {
        return employmentCheck
      }
    }

    return { canExecute: true }
  }

  /**
   * Get all actions that a character can currently execute.
   * thinkingアクションは選択肢に含めない（システム内部用のため）。
   * thinking中は ignoreCurrentAction を使用して他のアクションを取得可能にする。
   */
  getAvailableActions(characterId: string): ActionId[] {
    const character = this.worldState.getCharacter(characterId)
    const isThinking = character?.currentAction?.actionId === 'thinking'

    const availableActions: ActionId[] = []

    for (const actionId of Object.keys(ACTIONS) as ActionId[]) {
      // thinkingは選択肢に含めない（LLMが選ぶものではない）
      if (actionId === 'thinking') continue

      // thinking中はcurrentActionチェックをスキップして可用性を判定
      const result = this.canExecuteAction(characterId, actionId, {
        ignoreCurrentAction: isThinking,
      })
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
