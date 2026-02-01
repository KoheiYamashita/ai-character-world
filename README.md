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

`example.env.local` をコピーして `.env.local` を作成:

```bash
cp example.env.local .env.local
```

必須の環境変数:
- `LLM_MODEL`: LLMプロバイダー/モデル（例: `openai/gpt-4o-mini`, `anthropic/claude-sonnet-4`）
- `LLM_API_KEY`: APIキー

オプション:
- `LLM_BASE_URL`: カスタムエンドポイント（OpenAI互換API使用時）
- `ERROR_WEBHOOK_URL`: エラー通知用Webhook
- `DEBUG_MODE`: デバッグログ有効化
- Discord Gateway/チャット関連: `example.env.local` を参照

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

## カスタマイズ

このプロジェクトでは以下の要素をカスタマイズできます：

| 要素 | 設定ファイル | 主な設定項目 |
|------|-------------|-------------|
| キャラクター | `public/data/characters.json` | 名前、性格、スケジュール、雇用 |
| NPC | `public/data/maps.json` | 名前、性格、知識（facts） |
| マップ | `public/data/maps.json` | 障害物、施設、入口、背景色 |
| ワールド設定 | `public/data/world-config.json` | 時間、アクション効果、テーマ |
| スプライト | `public/assets/sprites/` | キャラクター・NPC画像 |
| LLM | `.env.local` | プロバイダー、モデル |

詳細は [docs/customization.md](./docs/customization.md) を参照。

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
- [docs/customization.md](./docs/customization.md) - カスタマイズガイド
- [docs/implementation-plan.md](./docs/implementation-plan.md) - 実装計画
