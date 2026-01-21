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

  /**
   * ステータス割り込み時の施設選択専用メソッド
   * システムが強制アクションを決定し、LLMは施設選択のみを行う
   * @param forcedAction 強制されるアクション（'eat' | 'sleep' | 'toilet' | 'bathe' | 'rest'）
   * @param context 行動決定に必要なコンテキスト
   * @returns 決定された行動（施設選択結果）
   */
  decideInterruptFacility(
    forcedAction: string,
    context: BehaviorContext
  ): Promise<BehaviorDecision>
}
