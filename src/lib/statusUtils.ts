/**
 * ステータス計算ユーティリティ
 *
 * キャラクターステータス（satiety, energy, hygiene, mood, bladder）の
 * 減少・回復計算を行う純粋関数を提供する。
 */

/**
 * ステータス値の変化を計算
 *
 * アクション実行中の場合、perMinute 効果で通常減少を「置き換え」る。
 * perMinute が undefined の場合は通常の減少を適用する。
 *
 * @param currentValue 現在の値（0-100）
 * @param decayRate 通常の減少率（/分）
 * @param elapsedMinutes 経過時間（分）
 * @param actionPerMinute アクションの perMinute 効果（undefined の場合は通常減少）
 * @returns 新しい値（0-100 でクランプ）
 *
 * @example
 * // 通常減少: energy 50 → 47 (0.05/分 × 60分)
 * calculateStatChange(50, 0.05, 60) // => 47
 *
 * @example
 * // sleep 中: energy 50 → 62.48 (0.208/分 × 60分)
 * calculateStatChange(50, 0.05, 60, 0.208) // => 62.48
 *
 * @example
 * // work 中: energy 50 → 30.2 (-0.33/分 × 60分)
 * calculateStatChange(50, 0.05, 60, -0.33) // => 30.2
 */
export function calculateStatChange(
  currentValue: number,
  decayRate: number,
  elapsedMinutes: number,
  actionPerMinute?: number
): number {
  if (actionPerMinute !== undefined) {
    // アクションの perMinute 効果で置き換え（減少を停止し、perMinute を適用）
    const newValue = currentValue + actionPerMinute * elapsedMinutes
    return Math.max(0, Math.min(100, newValue))
  }
  // 通常の減少を適用
  return Math.max(0, currentValue - decayRate * elapsedMinutes)
}
