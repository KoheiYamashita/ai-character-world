import type { BehaviorDecider } from './BehaviorDecider'
import type { BehaviorContext, BehaviorDecision } from '@/types/behavior'
import type { ActionId } from '@/server/simulation/actions/definitions'
import type { ScheduleEntry, WorldTime } from '@/types'

/**
 * ステータス閾値（20% = 緊急）
 * All stats: 100 = good, 0 = bad
 */
const URGENT_THRESHOLD = 20

/**
 * ステータスタイプと対応するアクションのマッピング
 * 優先順位: bladder > hunger > energy > hygiene
 */
const STATUS_TO_ACTION: Record<string, ActionId[]> = {
  bladder: ['toilet'],
  hunger: ['eat_home', 'eat_restaurant'],
  energy: ['sleep'],
  hygiene: ['bathe_home', 'bathe_hotspring'],
}

/**
 * スケジュールactivity → アクションのマッピング
 */
const ACTIVITY_TO_ACTIONS: Record<string, ActionId[]> = {
  '朝食': ['eat_home', 'eat_restaurant'],
  '昼食': ['eat_home', 'eat_restaurant'],
  '夕食': ['eat_home', 'eat_restaurant'],
  '仕事': ['work'],
  '就寝': ['sleep'],
  '身支度': ['bathe_home'],
  '休憩': ['rest'],
}

/**
 * StubBehaviorDecider - ルールベースの行動決定スタブ
 *
 * BehaviorDeciderインターフェースの最初の実装。
 * シンプルなルールベースのロジックで行動を決定する。
 *
 * 優先順位:
 * 1. ステータス緊急対応（閾値以下の場合）
 * 2. スケジュール参照
 * 3. デフォルト行動（アイドル）
 */
export class StubBehaviorDecider implements BehaviorDecider {
  async decide(context: BehaviorContext): Promise<BehaviorDecision> {
    const { character, currentTime, availableActions, schedule } = context

    // 1. ステータス緊急対応
    const urgentAction = this.checkUrgentStatus(character, availableActions)
    if (urgentAction) {
      console.log(`[BehaviorDecider] ${character.name}: urgent action - ${urgentAction.reason}`)
      return urgentAction
    }

    // 2. スケジュール参照
    if (schedule && schedule.length > 0) {
      const scheduledAction = this.checkSchedule(currentTime, schedule, availableActions)
      if (scheduledAction) {
        console.log(`[BehaviorDecider] ${character.name}: scheduled action - ${scheduledAction.reason}`)
        return scheduledAction
      }
    }

    // 3. デフォルト: アイドル状態を維持
    // 将来のLLM実装ではここでより複雑な判断を行う
    return this.selectDefaultAction(availableActions)
  }

  /**
   * ステータス緊急対応チェック
   * 閾値以下のステータスがあれば対応アクションを返す
   */
  private checkUrgentStatus(
    character: BehaviorContext['character'],
    availableActions: ActionId[]
  ): BehaviorDecision | null {
    // 優先順位順にチェック
    const statusChecks: Array<{ stat: number; type: string }> = [
      { stat: character.bladder, type: 'bladder' },
      { stat: character.hunger, type: 'hunger' },
      { stat: character.energy, type: 'energy' },
      { stat: character.hygiene, type: 'hygiene' },
    ]

    for (const { stat, type } of statusChecks) {
      if (stat <= URGENT_THRESHOLD) {
        const possibleActions = STATUS_TO_ACTION[type]
        if (!possibleActions) continue

        // 実行可能なアクションを探す
        for (const actionId of possibleActions) {
          if (availableActions.includes(actionId)) {
            return {
              type: 'action',
              actionId,
              reason: `${type} critical (${stat.toFixed(0)}% <= ${URGENT_THRESHOLD}%)`,
            }
          }
        }

        // 実行可能なアクションがない場合はログのみ
        console.log(`[BehaviorDecider] ${type} is critical (${stat.toFixed(0)}%) but no suitable facility available`)
      }
    }

    return null
  }

  /**
   * スケジュールチェック
   * 現在時刻に対応するスケジュールエントリを確認
   */
  private checkSchedule(
    currentTime: WorldTime,
    schedule: ScheduleEntry[],
    availableActions: ActionId[]
  ): BehaviorDecision | null {
    // 現在時刻に該当するスケジュールエントリを探す
    const currentEntry = this.findCurrentScheduleEntry(currentTime, schedule)
    if (!currentEntry) return null

    // activityに対応するアクションを探す
    const possibleActions = ACTIVITY_TO_ACTIONS[currentEntry.activity]
    if (!possibleActions) {
      // マッピングがない場合はスキップ（起床、自由時間など）
      return null
    }

    // 実行可能なアクションを探す
    for (const actionId of possibleActions) {
      if (availableActions.includes(actionId)) {
        return {
          type: 'action',
          actionId,
          reason: `scheduled: ${currentEntry.activity} at ${currentEntry.time}`,
        }
      }
    }

    return null
  }

  /**
   * 現在時刻に該当するスケジュールエントリを探す
   * 開始時刻が現在時刻以前で、次のエントリの開始時刻より前のものを返す
   */
  private findCurrentScheduleEntry(
    currentTime: WorldTime,
    schedule: ScheduleEntry[]
  ): ScheduleEntry | null {
    const currentMinutes = currentTime.hour * 60 + currentTime.minute

    // スケジュールを時刻順にソート
    const sortedSchedule = [...schedule].sort((a, b) => {
      return this.parseTimeToMinutes(a.time) - this.parseTimeToMinutes(b.time)
    })

    // 現在時刻以前で最も遅いエントリを探す
    let currentEntry: ScheduleEntry | null = null
    for (const entry of sortedSchedule) {
      const entryMinutes = this.parseTimeToMinutes(entry.time)
      if (entryMinutes <= currentMinutes) {
        currentEntry = entry
      } else {
        break
      }
    }

    return currentEntry
  }

  /**
   * "HH:MM"形式の時刻を分に変換
   */
  private parseTimeToMinutes(time: string): number {
    const [hours, minutes] = time.split(':').map(Number)
    return hours * 60 + minutes
  }

  /**
   * デフォルト行動の選択
   * 現時点ではアイドル状態を維持
   */
  private selectDefaultAction(availableActions: ActionId[]): BehaviorDecision {
    // rest アクションが利用可能なら実行（低頻度で）
    if (availableActions.includes('rest') && Math.random() < 0.1) {
      return {
        type: 'action',
        actionId: 'rest',
        reason: 'default: taking a break',
      }
    }

    // それ以外はアイドル状態
    return {
      type: 'idle',
      reason: 'no urgent needs or scheduled activities',
    }
  }
}
