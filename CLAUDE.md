# AI Character World

## 概要
キャラクターエージェントが行動できる仮想世界をシミュレートし、エージェントの記憶・経験を蓄積していくシステム。

### 目的
- AIエージェントが自律的に行動できる2D仮想世界の提供
- エージェントの行動履歴・経験の記録と記憶の形成
- エージェント同士やNPCとのインタラクションを通じた経験の蓄積

## 技術スタック
- Next.js 15 (App Router) + TypeScript + React 19
- PixiJS 8 (直接API使用、@pixi/react不使用)
- Zustand 5 (状態管理)
- shadcn/ui + Tailwind CSS 4
- AI SDK (Anthropic / OpenAI / Google) - LLM行動決定
- better-sqlite3 (永続化)
- Vitest (テスト)

## アーキテクチャ概要

### 全体構成
```
[ブラウザ]                    [Next.js サーバー]
PixiAppSync.tsx ←── SSE ───── simulation-stream/route.ts
  ↑ Zustand                         ↑
StatusPanel.tsx              SimulationEngine (20Hz tick)
                               ├── WorldState (状態管理)
                               ├── CharacterSimulator (移動)
                               ├── ActionExecutor (行動実行)
                               └── LLMBehaviorDecider (AI意思決定)
                                         ↓
                                    SqliteStore (永続化)
```

### データフロー
1. SimulationEngine が20Hzでtick実行
2. キャラクターの移動・行動・ステータス変化を計算
3. SSEで全クライアントにブロードキャスト
4. クライアント側でPixiJSが60fpsで補間描画

## ディレクトリ構成
```
src/
├── app/                           # Next.js App Router
│   ├── page.tsx                  # メインページ
│   ├── preview/page.tsx          # マッププレビュー
│   ├── log-viewer/page.tsx       # ログビューア
│   └── api/
│       ├── simulation/route.ts         # シミュレーション制御 (GET/POST)
│       ├── simulation-stream/route.ts  # SSEストリーム
│       └── db/route.ts                 # DB操作エンドポイント
│
├── components/
│   ├── world/
│   │   ├── WorldCanvas.tsx       # dynamic importラッパー
│   │   ├── PixiAppSync.tsx       # PixiJS描画 + SSE同期
│   │   └── MapPreview.tsx        # マッププレビュー描画
│   ├── panels/
│   │   └── StatusPanel.tsx       # ステータスUI
│   └── ui/                       # shadcn/ui
│
├── hooks/
│   └── useSimulationSync.ts      # SSE接続・状態同期
│
├── stores/                        # Zustand
│   ├── worldStore.ts             # ワールド状態（時間、マップ、遷移）
│   ├── characterStore.ts         # キャラクター状態
│   └── npcStore.ts               # NPC状態
│
├── server/
│   ├── simulation/
│   │   ├── SimulationEngine.ts         # メインオーケストレーター
│   │   ├── WorldState.ts              # ワールド状態管理
│   │   ├── CharacterSimulator.ts      # 移動・ナビゲーション
│   │   ├── characterState.ts          # ステータス減衰計算
│   │   ├── dataLoader.ts              # サーバー用データ読み込み
│   │   ├── ensureEngineInitialized.ts  # シングルトン初期化
│   │   ├── types.ts                   # SimCharacter等サーバー型
│   │   └── actions/
│   │       ├── ActionExecutor.ts      # 行動ライフサイクル管理
│   │       └── definitions.ts         # アクション定義マップ
│   │
│   ├── behavior/
│   │   ├── BehaviorDecider.ts         # 抽象インターフェース
│   │   └── LLMBehaviorDecider.ts      # LLM意思決定（2段階）
│   │
│   ├── persistence/
│   │   ├── StateStore.ts              # 抽象ストアIF
│   │   ├── SqliteStore.ts             # SQLite実装
│   │   └── MemoryStore.ts             # インメモリ（テスト用）
│   │
│   ├── episode/
│   │   ├── MiniEpisodeGenerator.ts    # インターフェース + 型
│   │   ├── StubMiniEpisodeGenerator.ts # スタブ（LLM未設定時）
│   │   └── LLMMiniEpisodeGenerator.ts # LLMエピソード生成
│   │
│   └── llm/
│       ├── client.ts                  # LLMモデル生成
│       └── errorHandler.ts            # エラーハンドリング・リトライ
│
├── data/maps/
│   ├── grid.ts                   # ノード生成（正本）
│   └── index.ts                  # マップローダー
│
├── lib/                           # ユーティリティ
│   ├── pathfinding.ts            # BFSパス探索
│   ├── movement.ts               # 補間・方向計算
│   ├── spritesheet.ts            # スプライトシート処理
│   ├── characterLoader.ts        # キャラクターJSON読み込み
│   ├── mapLoader.ts              # マップ読み込み・バリデーション
│   ├── npcLoader.ts              # NPC読み込み
│   ├── worldConfigLoader.ts      # ワールド設定読み込み
│   ├── pixiRenderers.ts          # 描画関数群
│   ├── facilityUtils.ts          # 施設検索
│   ├── facilityMapping.ts        # 施設タグ↔アクション対応
│   ├── crossMapNavigation.ts     # マップ間経路探索
│   ├── gridUtils.ts              # グリッド座標ヘルパー
│   ├── obstacleUtils.ts          # 障害物判定
│   ├── statusUtils.ts            # ステータス計算
│   ├── timeUtils.ts              # 時間フォーマット
│   └── errors.ts                 # カスタムエラー型
│
└── types/                         # 型定義
    ├── character.ts              # Character, Direction, Stats
    ├── world.ts                  # WorldTime, TransitionState
    ├── map.ts                    # PathNode, Obstacle, FacilityInfo
    ├── config.ts                 # WorldConfig
    ├── action.ts                 # ActionId, ActionState, ActionEffects
    ├── behavior.ts               # BehaviorContext, BehaviorDecision
    ├── npc.ts                    # NPC
    ├── job.ts                    # Employment, JobInfo
    └── schedule.ts               # ScheduleEntry, DailySchedule

public/data/
├── world-config.json             # グローバル設定
├── characters.json               # キャラクター定義（正本）
└── maps.json                     # マップ定義（障害物、entrance、NPC、施設）

scripts/
├── generate-placeholder-sprite.mjs
├── validate-maps.mjs
├── test-schedule-crud.mjs
└── test-llm.ts
```

## サーバーサイドシミュレーション

### SimulationEngine
- 20Hzのtickループでシミュレーション実行
- 初回SSE接続時にlazy初期化（シングルトン）
- 30秒ごとにSQLiteへ状態永続化

### Tickフロー
1. `CharacterSimulator.tick()` - 移動・パス追従・補間
2. `ActionExecutor.tick()` - アクション進行・ステータス効果適用・完了判定
3. 行動決定トリガー - ナビゲーション完了またはアクション完了時
4. SSEブロードキャスト - 全接続クライアントへ状態送信

### SimCharacter（サーバー側キャラクター状態）
Character型を拡張:
- `navigation`: 移動状態（isMoving, path, progress, startPosition, targetPosition）
- `crossMapNavigation`: マップ間経路状態
- `currentAction`: 実行中アクション
- `pendingAction`: 移動後に実行予定のアクション
- `displayEmoji`: 頭上表示絵文字

## アクションシステム

### アクション一覧
| ID | 種別 | デフォルト時間 | 効果 |
|---|---|---|---|
| eat | 可変長 | 30分 | satiety +1.67/分 |
| sleep | 可変長 | 480分 | energy +0.208/分 |
| bathe | 可変長 | 30分 | hygiene +3.33/分 |
| rest | 可変長 | 30分 | energy +0.5/分 |
| work | 可変長 | 60分 | energy -0.33/分, 時給加算 |
| toilet | 固定長 | 3-15分 | bladder +20/分 |
| talk | 固定長 | 5分 | mood +20 |

### ライフサイクル
1. LLMまたはステータス割り込みがアクション決定
2. 必要な施設へナビゲーション（facilityTags要件）
3. アクション開始（targetEndTime設定）
4. perMinute効果を毎tick適用（可変長）/ 完了時に一括適用（固定長）
5. 完了 → 次の行動決定トリガー

### ステータス割り込み
ステータスが10%未満になると強制アクション発動:
- bladder < 10% → toilet
- satiety < 10% → eat
- energy < 10% → sleep
- hygiene < 10% → bathe

## LLM行動決定

### 2段階決定プロセス
**Stage 1: アクション選択**
- 入力: 現在ステータス、スケジュール、行動履歴、周辺施設・NPC、性格
- 出力: action, target, reason, durationMinutes, scheduleUpdate

**Stage 2: 詳細選択**（複数候補がある場合）
- どのレストランで食べるか、どの寝室で寝るか等を選択

### 環境変数
```
LLM_MODEL=anthropic/claude-sonnet-4    # or openai/gpt-4o-mini, google/gemini-2.0
LLM_API_KEY=sk-...
LLM_BASE_URL=http://localhost:5001     # 省略可
```

## マップシステム

### グリッドノード
- `src/data/maps/grid.ts` が正本（ノード生成の唯一のソース）
- デフォルト12x9グリッド（world-config.jsonで設定可能）
- ノードID: `{prefix}-{row}-{col}`
- 8方向接続（上下左右+斜め）
- BFSで最短経路計算（`findPathAvoidingNodes()`でNPCノード回避）

### 座標系
```
pixel = spacing * (index + 1)
row/col: 0始まり = 最初のノード位置
row/col: -1 = キャンバス端（マージン外）
```

### 障害物
- **Building型**: 通過不可、内部ノードなし、最小2x2
- **Zone型**: 壁付き部屋、内部移動可能、壁上ノードなし（扉除く）、最小4x4

### 施設（Facility）
障害物に`facility`プロパティで定義:
- `tags`: FacilityTag[] (bathroom, kitchen, bedroom, toilet, restaurant, workspace, hotspring, hotel, public)
- `quality`, `cost`, `owner`, `job`
- アクション実行の場所要件として使用

### 入口・マップ遷移
- `entrances`配列で定義、`leadsTo: { mapId, nodeId }`で遷移先指定
- フェードアウト → マップ切替 → フェードイン

### マップ間ナビゲーション
- `crossMapNavigation.ts`で複数マップをまたぐ経路を計算
- entrance経由でマップ間を移動

### 現在のマップ
home, town, cafe, office, convenience, park

## キャラクターシステム

### ステータス（0-100）
money（上限なし）, satiety, energy, hygiene, mood, bladder

### スプライト
- 96x96フレーム、3列×4行スプライトシート
- Row0=下、Row1=左、Row2=右、Row3=上
- アニメーション: [0,1,2,1]ループ、停止時フレーム1

### スケジュール
- キャラクターごとの日次スケジュール（ScheduleEntry[]）
- LLMが提案するスケジュール変更をDBに永続化
- 行動決定時の参考コンテキストとして使用

### 雇用
- `employment`: { jobId, workplaces[] }
- workアクション時に時給加算

## 永続化（SQLite）

### テーブル
- `character_states`: キャラクター全状態
- `world_time`: ワールド時間
- `schedules`: 日次スケジュール
- `action_history`: 行動履歴

### 保存タイミング
- 30秒ごとに自動保存
- サーバー再起動時に前回状態を復元

## クライアント描画

### PixiJS直接API
- @pixi/react不使用、直接APIで性能確保
- ticker駆動60fps描画
- stale closure対策: Refで最新値参照

### SSE同期
- `useSimulationSync`フックでEventSource接続
- サーバーからの状態更新をZustandストアに反映
- クライアント側でノード間位置を線形補間（スムーズ描画）

## コマンド
```bash
npm run dev           # 開発サーバー (http://localhost:3000)
npm run build         # プロダクションビルド
npm run lint          # ESLint
npm run test          # Vitest (watchモード)
npm run test:run      # Vitest (単発実行)
npm run test:coverage # カバレッジレポート

# ユーティリティ
node scripts/generate-placeholder-sprite.mjs  # プレースホルダースプライト生成
node scripts/validate-maps.mjs                # マップデータ検証
```

## マッププレビュー
```
/preview?map={mapId}
```
シミュレーション接続なしでマップ構造（ノード、障害物、NPC配置）を確認可能。
スクリーンショットは `docs/Screenshots/` に保存。

## 重要な設計判断

### 後方互換性
- 開発初期段階のため後方互換性は不要
- 不使用コードは完全に削除する

### データの正本
- キャラクター設定: `public/data/characters.json`
- マップ定義: `public/data/maps.json`
- グリッドノード生成: `src/data/maps/grid.ts`
- ワールド設定: `public/data/world-config.json`

## 実装プラン管理

実装計画は `docs/implementation-plan.md` に記載。

### 実装済みマーク
```markdown
# タスク完了時
| ✅ 1-1 | `src/types/character.ts` に `energy` 追加 | ビルド通過 |

# Step全完了時
### ✅ Step 1: ステータス拡張（全層対応）
```
