# AI Character World

キャラクターエージェントが自律的に行動する2D仮想世界シミュレーター。エージェントの記憶・経験を蓄積し、LLMによる意思決定で行動を決定します。

## 技術スタック

- **フロントエンド**: Next.js 15 (App Router) + TypeScript + React 19
- **描画**: PixiJS 8 (直接API使用)
- **状態管理**: Zustand 5
- **UI**: shadcn/ui + Tailwind CSS 4
- **AI**: AI SDK (Anthropic / OpenAI / Google)
- **永続化**: better-sqlite3
- **テスト**: Vitest

## セットアップ

```bash
npm install
```

### 環境変数

`.env.local` を作成:

```env
LLM_MODEL=anthropic/claude-sonnet-4    # or openai/gpt-4o-mini, google/gemini-2.0
LLM_API_KEY=sk-...
LLM_BASE_URL=http://localhost:5001     # 省略可
```

## 開発

```bash
npm run dev           # 開発サーバー (http://localhost:3000)
npm run build         # プロダクションビルド
npm run lint          # ESLint
npm run test          # Vitest (watchモード)
npm run test:run      # Vitest (単発実行)
npm run test:coverage # カバレッジレポート
```

### ユーティリティスクリプト

```bash
node scripts/generate-placeholder-sprite.mjs  # プレースホルダースプライト生成
node scripts/validate-maps.mjs                # マップデータ検証
```

## 機能

### シミュレーション
- サーバーサイドで20Hz tickループ実行
- SSEで全クライアントにリアルタイム同期
- クライアント側でPixiJSが60fpsで補間描画

### キャラクター
- 6種類のステータス管理（money, satiety, energy, hygiene, mood, bladder）
- LLMによる2段階意思決定（アクション選択 → 詳細選択）
- 日次スケジュールに基づく行動計画

### アクション
- eat, sleep, bathe, rest, work, toilet, talk
- ステータスが10%未満で割り込み発動
- 施設要件に基づくナビゲーション

### マップ
- グリッドベースのノードシステム（BFSパス探索）
- マップ間ナビゲーション対応
- 現在のマップ: home, town, cafe, office, convenience, park

### 永続化
- SQLiteで状態を30秒ごとに自動保存
- サーバー再起動時に前回状態を復元

## プレビュー

```
/preview?map={mapId}
```

シミュレーション接続なしでマップ構造を確認可能。

## 実装状況

### 完了済み

- **Phase 1**: ステータス拡張、時間システム、施設・アクションシステム、仕事システム、SQLite永続化
- **Phase 2**: AI SDK統合、エラーハンドリング、スケジュール、行動決定インターフェース
- **Phase 3**: LLM行動決定、ステータス割り込み、NPC拡張、会話システム、中期記憶、ミニエピソード

### 実装予定（Phase 4: 長期記憶システム）

| Step | 内容 |
|------|------|
| 23 | **Graphiti統合準備** - Neo4j/Graphiti環境構築、SDK設定 |
| 24 | **長期記憶の登録** - 会話サマリーをエピソードとして保存 |
| 25 | **長期記憶の検索** - NPCに関するファクト検索、過去会話の参照 |
| 26 | **記憶に基づく行動決定** - 長期記憶が行動に影響 |

## ドキュメント

- [CLAUDE.md](./CLAUDE.md) - 詳細なアーキテクチャ・実装ガイド
- [docs/implementation-plan.md](./docs/implementation-plan.md) - 実装計画
