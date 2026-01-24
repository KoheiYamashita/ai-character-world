import { z } from 'zod'
import type { BehaviorDecider } from './BehaviorDecider'
import type { BehaviorContext, BehaviorDecision, NearbyFacility, NearbyMap, ScheduleUpdate, CurrentMapFacility, ActionHistoryEntry } from '@/types/behavior'
import type { ActionId } from '@/server/simulation/actions/definitions'
import type { SimNPC } from '@/server/simulation/types'
import type { ScheduleEntry, FacilityTag, ActionConfig, WorldTime } from '@/types'
import type { EffectPerMinute } from '@/types/action'
import { llmGenerateObject } from '@/server/llm'
import {
  FACILITY_TAG_TO_ACTION_ID,
  ACTION_TO_FACILITY_TAGS,
} from '@/lib/facilityMapping'

// =============================================================================
// Zod スキーマ
// =============================================================================

/**
 * スケジュール変更スキーマ
 * Note: OpenAI Structured Output では全フィールドが required 必須。
 * オプショナルフィールドは .nullable() を使用し null を許容する。
 */
const ScheduleUpdateSchema = z.object({
  type: z.enum(['add', 'remove', 'modify']).describe('変更タイプ'),
  entry: z.object({
    time: z.string().describe('時刻（HH:MM形式）'),
    activity: z.string().describe('活動内容'),
    location: z.string().nullable().describe('場所（不要ならnull）'),
    note: z.string().nullable().describe('備考（不要ならnull）'),
  }),
})

/**
 * 許可されるアクション種別
 */
const ALLOWED_ACTIONS = ['eat', 'sleep', 'toilet', 'bathe', 'rest', 'talk', 'work', 'move', 'idle'] as const

/**
 * LLMからのアクション決定出力スキーマ
 * Note: OpenAI Structured Output では全フィールドが required 必須。
 */
const ConversationGoalSchema = z.object({
  goal: z.string().describe('会話の具体的な目的（例: 「おすすめの料理を聞く」「最近の街の様子を聞く」「体調を気遣う」）'),
  successCriteria: z.string().describe('目的達成の具体的な判定基準（例: 「おすすめを1つ以上教えてもらえた」「街の近況を1つ以上聞けた」「体調について返答があった」）'),
})

const ActionDecisionSchema = z.object({
  action: z.enum(ALLOWED_ACTIONS).describe('アクション種別'),
  target: z.string().nullable().describe('対象のID（施設ID、NPC ID、マップIDのいずれか。不要ならnull）'),
  reason: z.string().describe('この行動を選んだ理由'),
  durationMinutes: z.number().nullable().describe('実行時間（分）。可変時間アクション（eat, sleep, toilet, bathe, rest, work）の場合に指定。talk, move, idle, thinkingはnull'),
  conversationGoal: ConversationGoalSchema.nullable().describe('会話の目的と達成条件（talkの場合に必須。それ以外はnull）'),
  scheduleUpdate: ScheduleUpdateSchema.nullable().describe('スケジュール変更（不要ならnull）'),
})

type LLMActionDecision = z.infer<typeof ActionDecisionSchema>

/**
 * 施設選択スキーマ（2段階目：eat, bathe等の場合）
 */
const FacilitySelectionSchema = z.object({
  facilityId: z.string().describe('選択した施設のID'),
  reason: z.string().describe('この施設を選んだ理由'),
})

// =============================================================================
// LLMBehaviorDecider
// =============================================================================

/**
 * LLMを使用した行動決定クラス
 */
export class LLMBehaviorDecider implements BehaviorDecider {
  private actionConfigs: Record<string, ActionConfig> = {}

  /**
   * アクション設定を設定（world-config.json の actions セクション）
   */
  setActionConfigs(configs: Record<string, ActionConfig>): void {
    this.actionConfigs = configs
    console.log(`[LLMBehaviorDecider] Loaded action configs for: ${Object.keys(configs).join(', ')}`)
  }

  /**
   * 行動を決定する
   */
  async decide(context: BehaviorContext): Promise<BehaviorDecision> {
    // ステップ1: LLMにアクション種別を決定させる
    const llmDecision = await this.decideAction(context)

    console.log(`[LLMBehaviorDecider] LLM decision: ${llmDecision.action} (${llmDecision.reason})`)

    // idle の場合はそのまま返す
    if (llmDecision.action === 'idle') {
      return {
        type: 'idle',
        reason: llmDecision.reason,
        scheduleUpdate: this.convertScheduleUpdate(llmDecision.scheduleUpdate),
      }
    }

    // ステップ2: 詳細選択が必要な場合、LLMに選択させる（2段階選択）
    if (this.needsDetailSelection(llmDecision, context)) {
      const detailDecision = await this.selectDetail(llmDecision, context)
      // scheduleUpdate を引き継ぐ
      if (llmDecision.scheduleUpdate && !detailDecision.scheduleUpdate) {
        detailDecision.scheduleUpdate = this.convertScheduleUpdate(llmDecision.scheduleUpdate)
      }
      // durationMinutes を引き継ぐ
      if (llmDecision.durationMinutes != null && detailDecision.durationMinutes === undefined) {
        detailDecision.durationMinutes = llmDecision.durationMinutes
      }
      return detailDecision
    }

    // 内部形式に変換して返す
    return this.convertToInternalFormat(llmDecision, context)
  }

  /**
   * LLMにアクション種別を決定させる
   */
  private async decideAction(context: BehaviorContext): Promise<LLMActionDecision> {
    const prompt = this.buildActionDecisionPrompt(context)

    console.log('[LLMBehaviorDecider] Prompt:', prompt)

    const decision = await llmGenerateObject(
      prompt,
      ActionDecisionSchema,
      {
        system: 'あなたはキャラクターとして、次の行動を決定してください。JSON形式で回答してください。',
      }
    )

    return decision
  }

  /**
   * 詳細選択が必要かどうかを判定
   */
  private needsDetailSelection(decision: LLMActionDecision, context: BehaviorContext): boolean {
    // 施設選択が必要なアクション（eat, bathe）で複数施設がある場合
    if (ACTION_TO_FACILITY_TAGS[decision.action]) {
      const relevantFacilities = this.getRelevantFacilities(decision.action, context)

      // LLMがtargetを指定していて、それが有効な施設IDの場合は2段階選択不要
      if (decision.target) {
        const targetFacility = relevantFacilities.find(f => f.id === decision.target)
        if (targetFacility) {
          return false
        }
      }

      if (relevantFacilities.length > 1) {
        return true
      }
    }

    // talk は最初の決定で target に NPC ID を指定するので2段階選択不要

    return false
  }

  /**
   * 詳細選択を行う（2段階目）
   * 現在は施設選択（eat, bathe）のみ
   */
  private async selectDetail(
    decision: LLMActionDecision,
    context: BehaviorContext
  ): Promise<BehaviorDecision> {
    // 施設選択が必要なアクション
    if (ACTION_TO_FACILITY_TAGS[decision.action]) {
      return this.selectFacility(decision, context)
    }

    // その他（通常はここに来ない）
    return this.convertToInternalFormat(decision, context)
  }

  /**
   * 施設から BehaviorDecision を構築（共通ヘルパー）
   */
  private buildFacilityDecision(
    facility: NearbyFacility,
    reason: string,
    includeMapId: boolean = false,
    preferredAction?: string
  ): BehaviorDecision {
    return {
      type: 'action',
      actionId: this.getActionIdFromFacility(facility, preferredAction),
      targetFacilityId: facility.id,
      targetMapId: includeMapId && facility.distance > 0 ? facility.mapId : undefined,
      reason,
    }
  }

  /**
   * LLMに施設選択をさせる（共通処理）
   */
  private async selectFacilityWithLLM(
    facilities: NearbyFacility[],
    prompt: string,
    systemMessage: string,
    logContext: string
  ): Promise<{ facility: NearbyFacility; reason: string }> {
    console.log(`[LLMBehaviorDecider] ${logContext} prompt:`, prompt)

    const selection = await llmGenerateObject(
      prompt,
      FacilitySelectionSchema,
      { system: systemMessage }
    )

    console.log(`[LLMBehaviorDecider] ${logContext}: ${selection.facilityId} (${selection.reason})`)

    const facility = facilities.find(f => f.id === selection.facilityId) ?? facilities[0]
    return { facility, reason: selection.reason }
  }

  /**
   * 施設を選択する（eat, bathe等）
   */
  private async selectFacility(
    decision: LLMActionDecision,
    context: BehaviorContext
  ): Promise<BehaviorDecision> {
    const relevantFacilities = this.getRelevantFacilities(decision.action, context)

    if (relevantFacilities.length === 0) {
      return { type: 'idle', reason: `${decision.action}できる施設がない` }
    }

    // 1つだけなら自動選択
    if (relevantFacilities.length === 1) {
      const facility = relevantFacilities[0]
      return this.buildFacilityDecision(facility, `${facility.label}で${decision.action}`)
    }

    // 複数施設がある場合、LLMに選択させる
    const prompt = this.buildFacilitySelectionPrompt(
      context.character.name,
      decision.action,
      relevantFacilities,
      context.character.money
    )

    const { facility, reason } = await this.selectFacilityWithLLM(
      relevantFacilities,
      prompt,
      'キャラクターとして、利用する施設を選んでください。JSON形式で回答してください。',
      'Facility selection'
    )

    return this.buildFacilityDecision(facility, reason)
  }

  /**
   * アクションに関連する施設を取得（現在マップ + 他マップ）
   */
  private getRelevantFacilities(action: string, context: BehaviorContext): NearbyFacility[] {
    const relevantTags = ACTION_TO_FACILITY_TAGS[action]
    if (!relevantTags) {
      return []
    }

    const hasRelevantTag = (tags: FacilityTag[]) => tags.some(tag => relevantTags.includes(tag))
    const results: NearbyFacility[] = []

    // 現在マップの施設を検索（distance: 0）
    for (const f of context.currentMapFacilities ?? []) {
      if (hasRelevantTag(f.tags)) {
        results.push({
          id: f.id,
          label: f.label,
          tags: f.tags,
          cost: f.cost,
          distance: 0,
          mapId: context.character.currentMapId,
          availableActions: f.availableActions,
        })
      }
    }

    // 他マップの施設を検索（distance > 0）
    for (const f of context.nearbyFacilities ?? []) {
      if (hasRelevantTag(f.tags)) {
        results.push(f)
      }
    }

    return results
  }

  /**
   * 施設から具体的なアクションIDを取得
   */
  private getActionIdFromFacility(facility: NearbyFacility, preferredAction?: string): ActionId {
    // preferredAction が指定されている場合、そのアクションに対応するタグを施設が持っていれば優先
    if (preferredAction) {
      const preferredTags = ACTION_TO_FACILITY_TAGS[preferredAction]
      if (preferredTags) {
        const hasMatchingTag = facility.tags.some(tag => preferredTags.includes(tag as FacilityTag))
        if (hasMatchingTag) {
          return preferredAction as ActionId
        }
      }
    }

    for (const tag of facility.tags) {
      const actionId = FACILITY_TAG_TO_ACTION_ID[tag]
      if (actionId) {
        return actionId
      }
    }
    // フォールバック（通常はここに来ない）
    return 'rest'
  }

  /**
   * LLM形式 → 内部形式への変換
   */
  private convertToInternalFormat(
    llmDecision: LLMActionDecision,
    context: BehaviorContext
  ): BehaviorDecision {
    const { action, target, reason, scheduleUpdate, durationMinutes, conversationGoal } = llmDecision
    const convertedScheduleUpdate = this.convertScheduleUpdate(scheduleUpdate)
    const duration = durationMinutes ?? undefined

    // move アクション
    if (action === 'move') {
      return {
        type: 'move',
        targetMapId: target ?? undefined,
        reason,
        scheduleUpdate: convertedScheduleUpdate,
      }
    }

    // 施設から BehaviorDecision を構築するヘルパー
    const buildFacilityAction = (facility: NearbyFacility): BehaviorDecision => ({
      type: 'action',
      actionId: this.getActionIdFromFacility(facility, action),
      targetFacilityId: facility.id,
      targetMapId: facility.distance > 0 ? facility.mapId : undefined,
      reason,
      scheduleUpdate: convertedScheduleUpdate,
      durationMinutes: duration,
    })

    // 施設選択が必要なアクション（eat, bathe）
    if (ACTION_TO_FACILITY_TAGS[action]) {
      const relevantFacilities = this.getRelevantFacilities(action, context)

      // LLMがtargetを指定している場合、その施設を使用
      if (target) {
        const targetFacility = relevantFacilities.find(f => f.id === target)
        if (targetFacility) {
          return buildFacilityAction(targetFacility)
        }
        // targetが無効な場合はフォールバック（ログ出力）
        console.log(`[LLMBehaviorDecider] Target facility ${target} not found for action ${action}, falling back to auto-selection`)
      }

      // 単一施設の場合は自動選択
      if (relevantFacilities.length === 1) {
        return buildFacilityAction(relevantFacilities[0])
      }
      // 施設がない場合
      if (relevantFacilities.length === 0) {
        return {
          type: 'idle',
          reason: `${action}できる施設がない`,
          scheduleUpdate: convertedScheduleUpdate,
        }
      }
    }

    // 具体的アクション（sleep, toilet, rest, work等）
    // availableActions から対応するアクションを探す
    const matchingAction = context.availableActions.find(a => a === action)

    if (matchingAction) {
      const result: BehaviorDecision = {
        type: 'action',
        actionId: matchingAction,
        reason,
        scheduleUpdate: convertedScheduleUpdate,
        durationMinutes: duration,
      }

      // talk アクションの場合、targetがあればNPC IDとして設定
      if (action === 'talk' && target) {
        result.targetNpcId = target
        result.conversationGoal = conversationGoal ?? { goal: reason, successCriteria: '' }
      }
      // 施設アクションの場合、targetがあれば施設IDとして設定
      else if (target) {
        result.targetFacilityId = target
      }

      return result
    }

    // availableActionsにないが、nearbyFacilitiesに該当施設があれば移動+実行
    const facility = this.findFacilityForAction(action, context.nearbyFacilities)
    if (facility) {
      console.log(`[LLMBehaviorDecider] Action ${action} not in availableActions, found facility: ${facility.label}`)
      return {
        type: 'action',
        actionId: action as ActionId,
        targetFacilityId: facility.id,
        reason,
        scheduleUpdate: convertedScheduleUpdate,
        durationMinutes: duration,
      }
    }

    // 施設も見つからない場合はidle
    console.log(`[LLMBehaviorDecider] Action ${action} not available and no facility found, falling back to idle`)
    return {
      type: 'idle',
      reason: `${action} は現在利用できません: ${reason}`,
      scheduleUpdate: convertedScheduleUpdate,
    }
  }

  /**
   * scheduleUpdate を内部形式に変換
   * Note: LLM出力では nullable なので null → undefined に変換
   */
  private convertScheduleUpdate(
    update: z.infer<typeof ScheduleUpdateSchema> | null | undefined
  ): ScheduleUpdate | undefined {
    if (!update) return undefined
    return {
      type: update.type,
      entry: {
        time: update.entry.time,
        activity: update.entry.activity,
        location: update.entry.location ?? undefined,
        note: update.entry.note ?? undefined,
      },
    }
  }

  /**
   * アクションに対応する施設をnearbyFacilitiesから検索
   * ACTION_FACILITY_TAGSマッピングを使用して、必要なタグを持つ施設を探す
   */
  private findFacilityForAction(
    action: string,
    nearbyFacilities?: NearbyFacility[]
  ): NearbyFacility | null {
    if (!nearbyFacilities || nearbyFacilities.length === 0) return null

    const requiredTags = ACTION_TO_FACILITY_TAGS[action]
    if (!requiredTags || requiredTags.length === 0) return null

    // 必要なタグをすべて持つ施設を探す
    return nearbyFacilities.find(f =>
      requiredTags.every(tag => f.tags.includes(tag))
    ) ?? null
  }

  // ===========================================================================
  // プロンプト構築
  // ===========================================================================

  /**
   * 行動決定プロンプトを構築
   */
  private buildActionDecisionPrompt(context: BehaviorContext): string {
    const {
      character,
      currentTime,
      schedule,
      availableActions,
      nearbyNPCs,
      currentFacility,
      currentMapFacilities,
      nearbyFacilities,
      nearbyMaps,
      recentConversations,
      midTermMemories,
      todayActions,
    } = context

    const parts: string[] = []

    // キャラクター情報
    parts.push(`あなたは${character.name}です。`)
    parts.push('')

    // 性格
    parts.push('【性格】')
    parts.push(character.personality || '（未設定）')
    parts.push('')

    // 行動傾向
    parts.push('【行動傾向】')
    if (character.tendencies && character.tendencies.length > 0) {
      parts.push(character.tendencies.map(t => `- ${t}`).join('\n'))
    } else {
      parts.push('（未設定）')
    }
    parts.push('')

    // その他
    parts.push('【その他】')
    parts.push(character.customPrompt || 'なし')
    parts.push('')

    // 直近の会話（sleep+日付変更でクリア）
    parts.push('【直近の会話】')
    if (recentConversations && recentConversations.length > 0) {
      parts.push(recentConversations.map(c => `- ${c.npcName}: ${c.summary}`).join('\n'))
    } else {
      parts.push('なし')
    }
    parts.push('')

    // 重要な記憶（将来拡張）
    parts.push('【重要な記憶】')
    if (midTermMemories && midTermMemories.length > 0) {
      parts.push(midTermMemories.map(m => `- ${m.content}`).join('\n'))
    } else {
      parts.push('なし')
    }
    parts.push('')

    // 今日の行動
    parts.push('【今日の行動】')
    parts.push(this.formatTodayActions(todayActions))
    parts.push('')

    // 現在の状況
    parts.push('【現在の状況】')
    parts.push(`- 時刻: ${currentTime.hour}:${String(currentTime.minute).padStart(2, '0')}`)
    parts.push(`- 場所: ${character.currentMapId}`)
    parts.push(`- 現在の施設: ${currentFacility ? currentFacility.tags.join(', ') : 'なし'}`)
    parts.push(`- ステータス説明:`)
    parts.push(`  - 全ステータスは0〜100%で、高いほど良い状態です`)
    parts.push(`  - 満腹度: 100%=満腹、0%=空腹（食事で回復）`)
    parts.push(`  - エネルギー: 100%=元気、0%=疲労困憊（睡眠で回復）`)
    parts.push(`  - 衛生: 100%=清潔、0%=不潔（入浴で回復）`)
    parts.push(`  - 気分: 100%=上機嫌、0%=不機嫌（会話・休憩で回復）`)
    parts.push(`  - トイレ: 100%=快適、0%=限界（トイレで回復）`)
    parts.push(`- 現在のステータス:`)
    parts.push(`  - 満腹度: ${character.satiety.toFixed(0)}%`)
    parts.push(`  - エネルギー: ${character.energy.toFixed(0)}%`)
    parts.push(`  - 衛生: ${character.hygiene.toFixed(0)}%`)
    parts.push(`  - 気分: ${character.mood.toFixed(0)}%`)
    parts.push(`  - トイレ: ${character.bladder.toFixed(0)}%`)
    parts.push(`- 所持金: ${character.money}円`)
    parts.push('')

    // 今日のスケジュール
    parts.push('【今日のスケジュール】')
    parts.push(this.formatSchedule(schedule))
    parts.push('')

    // 次のスケジュールまでの時間
    const nextScheduleInfo = this.getNextScheduleInfo(schedule, currentTime)
    if (nextScheduleInfo) {
      parts.push('【次のスケジュールまでの時間】')
      parts.push(`- ${nextScheduleInfo.minutesUntil}分後に「${nextScheduleInfo.activity}」${nextScheduleInfo.location ? `(${nextScheduleInfo.location})` : ''}`)
      parts.push('')
    }

    // 現在マップで実行可能なアクション（NPC・施設情報を含む）
    parts.push('【アクション】（現在マップで実行可能）')
    parts.push(this.formatAvailableActions(availableActions, nearbyNPCs, currentMapFacilities))
    parts.push('')

    // 他マップの施設（移動が必要）
    parts.push('【他マップの施設】（移動が必要）')
    parts.push(this.formatNearbyFacilities(nearbyFacilities))
    parts.push('')

    // 移動可能なマップ
    parts.push('【移動可能なマップ】')
    parts.push(this.formatNearbyMaps(nearbyMaps))
    parts.push('')

    // その他のアクション
    parts.push('【その他】')
    parts.push('- move: 任意の場所へ移動（上記マップIDをtargetに指定）')
    parts.push('- idle: その場で待機')
    parts.push('')

    // 指示
    parts.push('【回答形式】')
    parts.push('JSON形式で回答してください。targetには必ずIDを指定してください（ラベルや説明文ではなくID）。')
    parts.push('')
    parts.push('【行動選択の指針】')
    parts.push('- ステータスが低い場合（20%以下）は優先的に対処してください')
    parts.push('- スケジュールも考慮してください')
    parts.push('- 現在マップで実行可能なアクションを優先してください')
    parts.push('- 施設を利用する場合（eat, sleep, bathe, rest等）はアクションを選択し、targetに施設IDを指定')
    parts.push('- NPCと話したい場合は「talk」を選択し、targetにNPC IDを指定。conversationGoalには1回の会話で達成可能な具体的目的を設定すること（例: 「おすすめの料理を聞く」「最近の出来事を聞く」）。「会話する」「話す」のような曖昧な目的は避けること')
    parts.push('- 別のマップに移動したい場合は「move」を選択し、targetにマップIDを指定')
    parts.push('- 特にすることがなければ「idle」を選択（targetはnull）')
    parts.push('')
    parts.push('【durationMinutesについて】')
    parts.push('- eat, sleep, toilet, bathe, rest, work の場合は durationMinutes を分単位で指定してください')
    parts.push('- 各アクションの最小〜最大時間の範囲内で指定してください')
    parts.push('- 次のスケジュールまでの時間を考慮して適切な時間を選んでください')
    parts.push('- talk, move, idle は固定または即時なので durationMinutes は null にしてください')
    parts.push('')
    parts.push('スケジュールを変更したい場合は scheduleUpdate で指定できます。')

    return parts.join('\n')
  }

  /**
   * 今日の行動をフォーマット
   */
  private formatTodayActions(actions: ActionHistoryEntry[] | undefined): string {
    if (!actions || actions.length === 0) {
      return 'なし'
    }

    return actions
      .map(a => {
        let line = `- ${a.time} ${a.actionId}`
        if (a.target) {
          line += ` → ${a.target}`
        }
        if (a.durationMinutes) {
          line += ` (${a.durationMinutes}分)`
        }
        if (a.reason) {
          line += ` [${a.reason}]`
        }
        if (a.episode) {
          line += `\n  ✨ ${a.episode}`
        }
        return line
      })
      .join('\n')
  }

  /**
   * スケジュールをフォーマット
   */
  private formatSchedule(schedule: ScheduleEntry[] | null): string {
    if (!schedule || schedule.length === 0) {
      return 'なし'
    }

    return schedule
      .map(entry => {
        let line = `- ${entry.time}: ${entry.activity}`
        if (entry.location) {
          line += ` (${entry.location})`
        }
        return line
      })
      .join('\n')
  }

  /**
   * 利用可能なアクションをフォーマット（抽象アクションに変換、NPC・施設情報を含む）
   */
  private formatAvailableActions(
    actions: ActionId[],
    npcs?: SimNPC[],
    currentMapFacilities?: CurrentMapFacility[]
  ): string {
    if (actions.length === 0 && (!npcs || npcs.length === 0)) {
      return 'なし'
    }

    // アクションIDをそのまま使用（eat, bathe等は既に統一済み）
    const abstractActions = new Set<string>(actions)

    // アクション→施設情報のマッピングを構築（現在マップの施設から）
    const actionFacilityMap = new Map<string, string[]>()
    if (currentMapFacilities) {
      for (const facility of currentMapFacilities) {
        for (const action of facility.availableActions) {
          const existing = actionFacilityMap.get(action) || []
          existing.push(`${facility.label}[${facility.id}]`)
          actionFacilityMap.set(action, existing)
        }
      }
    }

    // 各アクションに対応する説明を構築
    const lines: string[] = []

    for (const action of abstractActions) {
      // 動的にアクション説明を生成（時間と効果を含む）
      const description = this.buildActionDescription(action)
      let facilityInfo = ''

      // talk の場合は NPC 情報を付加
      if (action === 'talk' && npcs && npcs.length > 0) {
        const npcList = npcs.map(n => `${n.name}[${n.id}]`).join('、')
        facilityInfo = `（${npcList}）`
      }
      // 施設アクションの場合は施設情報を付加
      else if (actionFacilityMap.has(action)) {
        const facilities = actionFacilityMap.get(action)!
        facilityInfo = `（${facilities.join('、')}）`
      }

      lines.push(`- ${action}: ${description}${facilityInfo}`)
    }

    return lines.join('\n')
  }

  /**
   * 周囲の施設をフォーマット
   */
  private formatNearbyFacilities(facilities: NearbyFacility[] | undefined): string {
    if (!facilities || facilities.length === 0) {
      return 'なし'
    }

    return facilities
      .map(f => this.formatFacilityEntry(f))
      .join('\n')
  }

  /**
   * 施設エントリをフォーマット（共通処理）
   */
  private formatFacilityEntry(f: NearbyFacility): string {
    const parts: string[] = [`- ID: ${f.id}, ${f.label} (${f.tags.join(', ')})`]
    if (f.availableActions && f.availableActions.length > 0) {
      parts.push(`アクション: ${f.availableActions.join(', ')}`)
    }
    if (f.cost !== undefined) {
      parts.push(`料金: ${f.cost}円`)
    }
    if (f.quality !== undefined) {
      parts.push(`品質: ${f.quality}`)
    }
    if (f.distance !== undefined) {
      parts.push(`距離: ${f.distance}`)
    }
    return parts.join(', ')
  }

  /**
   * 移動可能なマップをフォーマット
   */
  private formatNearbyMaps(maps: NearbyMap[] | undefined): string {
    if (!maps || maps.length === 0) {
      return 'なし'
    }

    return maps
      .map(m => `- ID: ${m.id}, ${m.label}, 距離: ${m.distance}`)
      .join('\n')
  }

  /**
   * 施設選択プロンプトを構築
   */
  private buildFacilitySelectionPrompt(
    characterName: string,
    action: string,
    facilities: NearbyFacility[],
    money: number
  ): string {
    const facilityList = facilities
      .map(f => this.formatFacilityForSelection(f))
      .join('\n')

    return `あなたは${characterName}です。
${action}をすることにしました。

【所持金】${money}円

【利用可能な施設】
${facilityList}

どの施設を利用しますか？`
  }

  /**
   * 施設選択用にフォーマット
   */
  private formatFacilityForSelection(f: NearbyFacility): string {
    const parts: string[] = [`- ${f.id}: ${f.label}`]
    if (f.cost !== undefined) {
      parts.push(`（料金: ${f.cost}円）`)
    }
    if (f.quality !== undefined) {
      parts.push(`（品質: ${f.quality}）`)
    }
    if (f.distance !== undefined) {
      parts.push(`（距離: ${f.distance}）`)
    }
    return parts.join(' ')
  }

  /**
   * 次のスケジュールまでの時間を計算
   */
  private getNextScheduleInfo(
    schedule: ScheduleEntry[] | null,
    currentTime: WorldTime
  ): { activity: string; location?: string; minutesUntil: number } | null {
    if (!schedule || schedule.length === 0) return null

    const currentMinutes = currentTime.hour * 60 + currentTime.minute

    for (const entry of schedule) {
      const timeParts = entry.time.split(':')
      if (timeParts.length < 2) continue
      const h = parseInt(timeParts[0], 10)
      const m = parseInt(timeParts[1], 10)
      if (isNaN(h) || isNaN(m)) continue

      const entryMinutes = h * 60 + m
      if (entryMinutes > currentMinutes) {
        return {
          activity: entry.activity,
          location: entry.location,
          minutesUntil: entryMinutes - currentMinutes,
        }
      }
    }

    return null  // 今日のスケジュールはすべて終了
  }

  /**
   * アクション説明を動的に生成
   */
  buildActionDescription(actionType: string): string {
    const baseDescriptions: Record<string, string> = {
      eat: '食事',
      sleep: '睡眠',
      toilet: 'トイレ',
      bathe: '入浴',
      rest: '休憩',
      talk: 'NPC会話',
      work: '仕事',
      move: '別の場所へ移動',
      idle: '何もしない（待機）',
    }

    const base = baseDescriptions[actionType] || actionType
    const config = this.actionConfigs[actionType]

    // 設定がない場合は基本説明のみ
    if (!config) {
      return base
    }

    // 固定時間アクション
    if (config.fixed) {
      const effectStr = this.formatFixedEffects(config.effects)
      return effectStr
        ? `${base}（${effectStr}、固定${config.duration}分）`
        : `${base}（固定${config.duration}分）`
    }

    // 可変時間アクション
    if (config.durationRange && config.perMinute) {
      const { min, max } = config.durationRange
      const effectStr = this.formatPerMinuteEffects(config.perMinute)
      return `${base} - ${min}〜${max}分、${effectStr}`
    }

    return base
  }

  /**
   * 分あたりの効果をフォーマット
   */
  private formatPerMinuteEffects(perMinute: EffectPerMinute): string {
    return this.formatEffects(perMinute, true)
  }

  /**
   * 固定効果をフォーマット
   */
  private formatFixedEffects(effects?: ActionConfig['effects']): string {
    if (!effects) return ''
    return this.formatEffects(effects, false)
  }

  /**
   * ステータス効果をフォーマット（共通処理）
   */
  private formatEffects(
    effects: Partial<Record<'satiety' | 'energy' | 'hygiene' | 'mood' | 'bladder', number>>,
    perMinute: boolean
  ): string {
    const labels: Record<string, string> = {
      satiety: '満腹度',
      energy: 'エネルギー',
      hygiene: '衛生',
      mood: '気分',
      bladder: '膀胱',
    }
    const suffix = perMinute ? '%/分' : ''

    const parts: string[] = []
    for (const [key, label] of Object.entries(labels)) {
      const value = effects[key as keyof typeof effects]
      if (value) {
        const sign = value > 0 ? '+' : ''
        const formatted = perMinute ? value.toFixed(key === 'energy' || key === 'mood' ? 2 : 1) : String(value)
        parts.push(`${label}${sign}${formatted}${suffix}`)
      }
    }
    return parts.join('・')
  }

  // ===========================================================================
  // Step 14: ステータス割り込み - 施設選択専用
  // ===========================================================================

  /**
   * ステータス割り込み時の施設選択
   * システムが強制アクションを決定し、LLMは施設選択のみを行う
   */
  async decideInterruptFacility(
    forcedAction: string,
    context: BehaviorContext
  ): Promise<BehaviorDecision> {
    console.log(`[LLMBehaviorDecider] Interrupt facility selection for action: ${forcedAction}`)

    const relevantFacilities = this.getRelevantFacilities(forcedAction, context)
    const actionLabel = this.getActionLabel(forcedAction)

    // 施設がない場合のフォールバック
    if (relevantFacilities.length === 0) {
      return this.buildInterruptFallbackDecision(actionLabel, context)
    }

    // 単一施設なら自動選択
    if (relevantFacilities.length === 1) {
      const facility = relevantFacilities[0]
      return this.buildFacilityDecision(
        facility,
        `緊急: ${actionLabel}が必要（${facility.label}を選択）`,
        true,
        forcedAction
      )
    }

    // 複数施設ならLLMに選択させる
    const prompt = this.buildInterruptFacilitySelectionPrompt(
      context.character.name,
      actionLabel,
      relevantFacilities,
      context.character.money
    )

    const { facility, reason } = await this.selectFacilityWithLLM(
      relevantFacilities,
      prompt,
      '緊急状況です。施設を選んでください。JSON形式で回答してください。',
      'Interrupt facility selection'
    )

    return this.buildFacilityDecision(facility, `緊急: ${reason}`, true, forcedAction)
  }

  /**
   * 割り込み時のフォールバック決定
   * 施設が見つからない場合、自宅へ移動または idle
   */
  private buildInterruptFallbackDecision(
    actionLabel: string,
    context: BehaviorContext
  ): BehaviorDecision {
    // 自宅(home)マップがあれば移動を提案
    const homeMap = context.nearbyMaps?.find(m => m.id === 'home')
    if (homeMap && context.character.currentMapId !== 'home') {
      return {
        type: 'move',
        targetMapId: 'home',
        reason: `緊急: ${actionLabel}が必要だが施設がないため自宅へ移動`,
      }
    }

    // 自宅にも施設がない、または既に自宅にいる場合は idle
    return {
      type: 'idle',
      reason: `緊急: ${actionLabel}が必要だが利用可能な施設がない`,
    }
  }

  /**
   * 緊急時の施設選択プロンプトを構築
   */
  private buildInterruptFacilitySelectionPrompt(
    characterName: string,
    actionLabel: string,
    facilities: NearbyFacility[],
    money: number
  ): string {
    const facilityList = facilities
      .map(f => this.formatFacilityForSelection(f))
      .join('\n')

    return `あなたは${characterName}です。
【緊急】${actionLabel}が必要です！ステータスが危険な状態です。

【所持金】${money}円

【利用可能な施設】
${facilityList}

最も適切な施設を選んでください。距離、料金、所持金を考慮してください。`
  }

  /**
   * アクション種別からラベルを取得
   */
  private getActionLabel(action: string): string {
    const labels: Record<string, string> = {
      eat: '食事',
      sleep: '睡眠',
      toilet: 'トイレ',
      bathe: '入浴',
      rest: '休憩',
    }
    return labels[action] || action
  }
}
