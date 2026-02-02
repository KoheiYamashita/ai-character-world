/**
 * デバッグ設定ユーティリティ
 *
 * 環境変数 DEBUG_MODE=true で有効化
 * - LLM行動決定プロンプト・応答の永続化
 * - 会話ターン詳細の永続化
 */

/**
 * デバッグモードが有効かどうかを判定
 * サーバーサイドでのみ使用（環境変数を参照）
 */
export function isDebugMode(): boolean {
  return process.env.DEBUG_MODE === 'true'
}
