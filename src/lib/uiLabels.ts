/**
 * UI表示用ラベルと絵文字の一元管理
 * アクションラベル、絵文字、特殊状態表示を統一管理
 */

import type { ActionId } from '@/types/action'

// アクション情報（ラベルと絵文字を一元管理）
export interface ActionInfo {
  label: string   // 日本語ラベル（LLMプロンプト用）
  emoji: string   // 絵文字（キャラクター頭上表示・UI用）
}

export const ACTION_INFO: Record<ActionId, ActionInfo> = {
  eat:           { label: '食事',       emoji: '🍽️' },
  sleep:         { label: '睡眠',       emoji: '💤' },
  toilet:        { label: 'トイレ',     emoji: '🚽' },
  bathe:         { label: '入浴',       emoji: '🛁' },
  rest:          { label: '休憩',       emoji: '☕' },
  talk:          { label: '会話',       emoji: '💬' },
  work:          { label: '仕事',       emoji: '💼' },
  thinking:      { label: '思考',       emoji: '🤔' },
  exercise:      { label: '運動',       emoji: '🏋️' },
  read:          { label: '読書',       emoji: '📖' },
  game:          { label: 'ゲーム',     emoji: '🎮' },
  drink_alcohol: { label: '飲酒',       emoji: '🍺' },
  watch:         { label: '動画視聴',   emoji: '📺' },
  shopping:      { label: '買い物',     emoji: '🛍️' },
  study:         { label: '勉強',       emoji: '📚' },
  meditate:      { label: '瞑想',       emoji: '🧘' },
  nap:           { label: '仮眠',       emoji: '💤' },
  draw:          { label: 'お絵描き',   emoji: '🎨' },
  play_music:    { label: '演奏',       emoji: '🎸' },
  cook:          { label: '料理',       emoji: '🍳' },
  garden:        { label: '園芸',       emoji: '🌱' },
  jog:           { label: 'ジョギング', emoji: '🏃' },
  swim:          { label: '水泳',       emoji: '🏊' },
  walk:          { label: '散歩',       emoji: '🚶' },
  fish:          { label: '釣り',       emoji: '🎣' },
  karaoke:       { label: 'カラオケ',   emoji: '🎤' },
  cinema:        { label: '映画鑑賞',   emoji: '🎬' },
  arcade:        { label: 'ゲーセン',   emoji: '🕹️' },
  bowling:       { label: 'ボウリング', emoji: '🎳' },
  coffee:        { label: 'コーヒー',   emoji: '☕' },
  snack:         { label: '間食',       emoji: '🍪' },
  massage:       { label: 'マッサージ', emoji: '💆' },
  haircut:       { label: '散髪',       emoji: '💇' },
  clean:         { label: '掃除',       emoji: '🧹' },
}

// 特殊絵文字（アクション以外の状態表示）
export const SPECIAL_EMOJI = {
  interrupt: '😰',  // ステータス割り込み時
  idle: '😶',       // アイドル/待機
} as const

// 非アクションのラベル（LLMプロンプト用）
export const NON_ACTION_LABELS: Record<string, string> = {
  move: '別の場所へ移動',
  idle: '何もしない（待機）',
}

// ヘルパー関数
export function getActionLabel(actionId: string): string {
  return ACTION_INFO[actionId as ActionId]?.label ?? NON_ACTION_LABELS[actionId] ?? actionId
}

export function getActionEmoji(actionId: string): string {
  return ACTION_INFO[actionId as ActionId]?.emoji ?? ''
}

// 「〜中」付きラベル（CharacterPanel用）
export function getActionStatusLabel(actionId: string): string {
  const info = ACTION_INFO[actionId as ActionId]
  if (!info) return actionId
  return `${info.emoji} ${info.label}中`
}
