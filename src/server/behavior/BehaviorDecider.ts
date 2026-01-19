import type { BehaviorContext, BehaviorDecision } from '@/types/behavior'

/**
 * BehaviorDecider インターフェース
 *
 * キャラクターの行動を決定するための抽象インターフェース。
 * 将来のLLM実装を見据えて非同期（Promise）を返す。
 */
export interface BehaviorDecider {
  /**
   * 現在のコンテキストに基づいて行動を決定する
   * @param context 行動決定に必要なコンテキスト
   * @returns 決定された行動
   */
  decide(context: BehaviorContext): Promise<BehaviorDecision>
}
