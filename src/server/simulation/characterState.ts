/**
 * キャラクター状態判定のユーティリティ関数
 * SimulationEngine と CharacterSimulator で使用される共通ロジック
 */

import type { SimCharacter } from './types'

/**
 * キャラクターがアイドル状態（何もしていない）かどうかを判定
 * - アクション実行中でない
 * - 会話中でない
 * - 移動中でない
 */
export function isCharacterIdle(character: SimCharacter): boolean {
  return (
    !character.currentAction &&
    character.conversation?.status !== 'active' &&
    !character.navigation.isMoving
  )
}

/**
 * キャラクターが移動中かどうかを判定
 */
export function isCharacterNavigating(character: SimCharacter): boolean {
  return character.navigation.isMoving
}

/**
 * キャラクターがアクション実行中かどうかを判定
 */
export function isCharacterPerformingAction(character: SimCharacter): boolean {
  return character.currentAction !== null
}

/**
 * キャラクターが会話中かどうかを判定
 */
export function isCharacterInConversation(character: SimCharacter): boolean {
  return character.conversation?.status === 'active'
}

/**
 * キャラクターが新しいアクションを開始できるかどうかを判定
 * - アイドル状態である
 * - ペンディングアクションがない
 */
export function canStartNewAction(character: SimCharacter): boolean {
  return isCharacterIdle(character) && !character.pendingAction
}

/**
 * キャラクターが行動決定を必要としているかどうかを判定
 * - アイドル状態である
 * - ペンディングアクションがない
 * - クロスマップナビゲーション中でない
 */
export function needsBehaviorDecision(character: SimCharacter): boolean {
  return (
    canStartNewAction(character) &&
    !character.crossMapNavigation?.isActive
  )
}
