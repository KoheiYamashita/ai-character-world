# AI Character World

## 概要
キャラクターエージェントが行動できる仮想世界をシミュレートし、エージェントの記憶・経験を蓄積していくシステム。

### 目的
- AIエージェントが自律的に行動できる2D仮想世界の提供
- エージェントの行動履歴・経験の記録と記憶の形成
- エージェント同士やNPCとのインタラクションを通じた経験の蓄積

## 技術スタック
- Next.js 16 (App Router) + TypeScript + React 19
- PixiJS 8 (直接API使用、@pixi/react不使用)
- Zustand 5 (状態管理)
- shadcn/ui + Tailwind CSS 4
- AI SDK (Anthropic / OpenAI / Google / OpenRouter) - LLM行動決定・会話
- better-sqlite3 (永続化)
- Vitest (テスト)
- Zod (スキーマ検証)

## アーキテクチャ概要

### 全体構成
```
[ブラウザ]                    [Next.js サーバー]
PixiAppSync.tsx ←── SSE ───── simulation-stream/route.ts
  ↑ Zustand                         ↑
TopBar / CharacterPanel      SimulationEngine (20Hz tick)
ActivityLogPanel               ├── WorldState (状態管理)
                               ├── CharacterSimulator (移動)
                               ├── ActionExecutor (行動実行)
                               ├── ConversationManager (会話管理)
                               ├── ConversationExecutor (LLM会話)
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
│   ├── editor/page.tsx           # マップエディタ
│   ├── preview/page.tsx          # マッププレビュー
│   ├── log-viewer/page.tsx       # ログビューア
│   └── api/
│       ├── simulation/route.ts         # シミュレーション制御 (GET/POST)
│       ├── simulation-stream/route.ts  # SSEストリーム
│       ├── activity-log/route.ts       # アクティビティログ取得
│       ├── maps/route.ts               # マップCRUD
│       ├── maps/validate/route.ts      # マップバリデーション
│       ├── db/route.ts                 # DB操作エンドポイント
│       └── sprites/route.ts            # スプライト取得
│
├── components/
│   ├── world/
│   │   ├── WorldCanvas.tsx       # dynamic importラッパー
│   │   ├── PixiAppSync.tsx       # PixiJS描画 + SSE同期
│   │   └── MapPreview.tsx        # マッププレビュー描画
│   ├── panels/
│   │   ├── TopBar.tsx            # 上部バー（時間・日付・コントロール）
│   │   ├── CharacterPanel.tsx    # キャラクター詳細パネル
│   │   └── ActivityLogPanel.tsx  # アクティビティログパネル
│   ├── editor/                   # マップエディタ
│   │   ├── EditorCanvas.tsx      # エディタキャンバス
│   │   ├── EditorToolbar.tsx     # ツールバー
│   │   ├── PropertyPanel.tsx     # プロパティパネル
│   │   ├── panels/               # 各種プロパティエディタ
│   │   └── dialogs/              # ダイアログ
│   └── ui/                       # shadcn/ui
│
├── hooks/
│   ├── useSimulationSync.ts      # SSE接続・状態同期
│   └── useEditorKeyboard.ts      # エディタキーボード操作
│
├── stores/                        # Zustand
│   ├── worldStore.ts             # ワールド状態（時間、マップ、遷移）
│   ├── characterStore.ts         # キャラクター状態
│   ├── npcStore.ts               # NPC状態
│   ├── activityLogStore.ts       # アクティビティログ
│   └── editorStore.ts            # マップエディタ状態
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
│   ├── conversation/
│   │   ├── ConversationManager.ts     # セッション管理
│   │   ├── ConversationExecutor.ts    # LLM会話ループ実行
│   │   └── ConversationPostProcessor.ts # 会話後処理（NPC更新、記憶統合）
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
│       ├── client.ts                  # LLMモデル生成（4プロバイダー対応）
│       ├── errorHandler.ts            # エラーハンドリング・リトライ
│       └── index.ts                   # エクスポート
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
│   ├── mapValidator.ts           # マップバリデーション
│   ├── npcLoader.ts              # NPC読み込み
│   ├── worldConfigLoader.ts      # ワールド設定読み込み
│   ├── pixiRenderers.ts          # ゲーム描画関数群
│   ├── editorRenderers.ts        # エディタ描画関数群
│   ├── facilityUtils.ts          # 施設検索
│   ├── facilityMapping.ts        # 施設タグ↔アクション対応
│   ├── crossMapNavigation.ts     # マップ間経路探索
│   ├── gridUtils.ts              # グリッド座標ヘルパー
│   ├── obstacleUtils.ts          # 障害物判定
│   ├── statusUtils.ts            # ステータス計算
│   ├── timeUtils.ts              # 時間フォーマット
│   ├── uiLabels.ts               # UI表示用ラベル・絵文字一元管理
│   ├── conversationFilters.ts    # 会話フィルタ（クールダウン等）
│   └── errors.ts                 # カスタムエラー型
│
└── types/                         # 型定義
    ├── character.ts              # Character, Direction, Stats
    ├── world.ts                  # WorldTime, TransitionState
    ├── map.ts                    # PathNode, Obstacle, FacilityInfo
    ├── config.ts                 # WorldConfig, ActionConfig
    ├── action.ts                 # ActionId (35種類), ActionState, ActionEffects
    ├── behavior.ts               # BehaviorContext, BehaviorDecision, MidTermMemory
    ├── npc.ts                    # NPC, NPCFact, NPCDynamicState
    ├── conversation.ts           # ConversationSession, ConversationGoal
    ├── activityLog.ts            # ActivityLogEntry (4種類)
    ├── editor.ts                 # EditorStore, EditorTool
    ├── job.ts                    # Employment, JobInfo
    └── schedule.ts               # ScheduleEntry, DailySchedule

public/data/
├── world-config.json             # グローバル設定（アクション定義含む）
├── characters.json               # キャラクター定義（正本）
└── maps.json                     # マップ定義（障害物、entrance、NPC、施設）

scripts/
├── generate-placeholder-sprite.mjs  # プレースホルダースプライト生成
├── validate-maps.mjs                # マップデータ検証
├── test-schedule-crud.mjs           # スケジュールCRUDテスト
└── test-llm.ts                      # LLM接続テスト
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
- `conversation`: 会話セッション

## アクションシステム

### アクション一覧（35種類）

| カテゴリ | ID | ラベル | 絵文字 | デフォルト時間 |
|---------|-----|--------|--------|---------------|
| **基本** | eat | 食事 | 🍽️ | 30分 |
| | sleep | 睡眠 | 💤 | 480分 |
| | toilet | トイレ | 🚽 | 5分 |
| | bathe | 入浴 | 🛁 | 30分 |
| | rest | 休憩 | ☕ | 30分 |
| | talk | 会話 | 💬 | 会話終了まで |
| | work | 仕事 | 💼 | 60分 |
| | thinking | 思考 | 🤔 | 手動終了 |
| **娯楽** | exercise | 運動 | 🏋️ | 60分 |
| | read | 読書 | 📖 | 30分 |
| | game | ゲーム | 🎮 | 60分 |
| | drink_alcohol | 飲酒 | 🍺 | 60分 |
| | watch | 動画視聴 | 📺 | 60分 |
| | shopping | 買い物 | 🛍️ | 30分 |
| **学習** | study | 勉強 | 📚 | 60分 |
| | meditate | 瞑想 | 🧘 | 30分 |
| | nap | 仮眠 | 💤 | 30分 |
| **創作** | draw | お絵描き | 🎨 | 60分 |
| | play_music | 演奏 | 🎸 | 60分 |
| | cook | 料理 | 🍳 | 45分 |
| | garden | 園芸 | 🌱 | 60分 |
| **運動** | jog | ジョギング | 🏃 | 30分 |
| | swim | 水泳 | 🏊 | 60分 |
| | walk | 散歩 | 🚶 | 30分 |
| | fish | 釣り | 🎣 | 120分 |
| **施設** | karaoke | カラオケ | 🎤 | 90分 |
| | cinema | 映画鑑賞 | 🎬 | 120分 |
| | arcade | ゲーセン | 🕹️ | 60分 |
| | bowling | ボウリング | 🎳 | 90分 |
| **軽食** | coffee | コーヒー | ☕ | 15分 |
| | snack | 間食 | 🍪 | 10分 |
| **サービス** | massage | マッサージ | 💆 | 60分 |
| | haircut | 散髪 | 💇 | 45分 |
| **家事** | clean | 掃除 | 🧹 | 45分 |

### ライフサイクル
1. LLMまたはステータス割り込みがアクション決定
2. 必要な施設へナビゲーション（facilityTags要件）
3. アクション開始（targetEndTime設定、DB記録）
4. perMinute効果を毎tick適用（可変長）/ 完了時に一括適用（固定長）
5. 完了 → DB更新 → 次の行動決定トリガー

### ステータス割り込み
ステータスが10%未満になると強制アクション発動:
- bladder < 10% → toilet
- satiety < 10% → eat
- energy < 10% → sleep
- hygiene < 10% → bathe

### 連続アクション制限
同じアクションを連続して実行できる回数に制限あり（デフォルト3回）。

## 会話システム

### ConversationManager
- キャラクター↔NPC間の会話セッション管理
- セッション開始/終了、メッセージ追加
- NPC会話状態管理（同時会話防止）

### ConversationExecutor
- LLM会話ループの非同期実行
- キャラクター発話 → NPC応答 → ... の交互ループ
- 目的達成判定、ターン上限管理
- ターンインターバル（world-config.jsonで設定可能）

### ConversationPostProcessor
会話終了後の後処理:
- 会話サマリー生成・永続化
- NPC好感度・気分更新
- NPC facts更新（有効期限付き）
- キャラクター中期記憶の統合・更新

### 会話クールダウン
同じNPCとの連続会話を防ぐクールダウン機能（world-config.jsonで設定）。

## LLM行動決定

### 2段階決定プロセス
**Stage 1: アクション選択**
- 入力: 現在ステータス、スケジュール、行動履歴、周辺施設・NPC、中期記憶、性格
- 出力: action, target, reason, durationMinutes, scheduleUpdate, conversationGoal

**Stage 2: 詳細選択**（複数候補がある場合）
- どのレストランで食べるか、どの寝室で寝るか等を選択

### 環境変数
```
LLM_MODEL=anthropic/claude-sonnet-4    # or openai/gpt-4o-mini, google/gemini-2.0, openrouter/anthropic/claude-3.5-sonnet
LLM_API_KEY=sk-...
LLM_BASE_URL=http://localhost:5001     # 省略可（OpenRouter以外）
```

### 対応プロバイダー
- `anthropic/` - Anthropic API
- `openai/` - OpenAI API
- `openai/chat/` - OpenAI互換API（chat completions）
- `google/` or `gemini/` - Google Generative AI
- `openrouter/` - OpenRouter（サブタイプ/モデル形式）

## NPCシステム

### NPC構造
- 静的情報: id, name, sprite, personality, tendencies, customPrompt
- 動的情報: affinity (好感度), mood, facts, conversationCount, lastConversation

### NPCFact（知識・事実）
```typescript
interface NPCFact {
  content: string
  expiresDay: number | null  // nullは永続、数値はワールド日数で期限
}
```

### 会話による動的更新
- 好感度変化（-20〜+20）
- 気分変化（happy/neutral/sad/angry/excited）
- facts更新（永続情報と時限情報）
- 会話カウント増加

## 中期記憶（MidTermMemory）

キャラクターが会話で得た「行動に影響する情報」を保持:
- importance: low/medium/high
- 重要度に応じた有効期限（low=当日、medium=翌日、high=2日後）
- 会話後にLLMで既存記憶と統合・整理
- 上限件数あり（world-config.jsonで設定）

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
- `tags`: FacilityTag[] (bathroom, kitchen, bedroom, toilet, restaurant, workspace, hotspring, hotel, public, ...)
- `actionIds`: この施設で実行可能なアクションID
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
money（上限なし）, satiety, energy, hygiene, mood, bladder, fitness

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
- `action_history`: 行動履歴（開始/進行/完了の3段階管理）
- `npc_summaries`: 会話サマリー
- `npc_states`: NPC動的状態
- `mid_term_memories`: 中期記憶

### アクション永続化フロー
1. `startActionHistory()` - 開始時にINSERT（status='in_progress'）
2. `updateActiveActionProgress()` - 30秒ごとに中間更新（statsSnapshot）
3. `completeActionHistory()` - 完了時にUPDATE（status='completed'）
4. `loadActiveActions()` - 再起動時に未完了アクションを復元

### 保存タイミング
- 30秒ごとに自動保存
- サーバー再起動時に前回状態を復元

## アクティビティログ

### ログ種別
```typescript
type ActivityLogEntry =
  | ActionLogEntry           // アクション開始/完了
  | ConversationLogEntry     // 会話完了サマリー
  | ConversationMessageLogEntry  // 会話メッセージ（リアルタイム）
  | MiniEpisodeLogEntry      // ミニエピソード
```

### SSE配信
ログはSSE経由でリアルタイム配信され、ActivityLogPanelで表示。

## マップエディタ

### アクセス
```
npm run dev:editor  # エディタモードで起動（ポート3001）
/editor             # エディタページ
```

### 機能
- マップの追加/編集/削除/複製
- 障害物、入口、NPCの配置・編集
- グリッドスナップ、ドラッグ移動、リサイズ
- Undo/Redo（最大50履歴）
- バリデーション
- JSONエクスポート

### ツール
- select: 選択・移動・リサイズ
- obstacle: 障害物追加
- entrance: 入口追加
- npc: NPC追加

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
npm run dev:editor    # エディタモード (http://localhost:3001)
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

## ワールド設定（world-config.json）

主要セクション:
- `timing`: アイドル時間、フェード設定
- `time`: タイムゾーン、ステータス減衰レート
- `movement`: 移動速度、入口利用確率
- `grid`: デフォルトグリッドサイズ
- `canvas`: キャンバスサイズ、背景色
- `theme`: ノード・障害物の描画テーマ
- `actions`: 全35アクションの時間範囲・効果定義
- `miniEpisode`: ミニエピソード生成確率
- `actionRestrictions`: 連続アクション制限
- `memory`: 中期記憶・行動履歴の上限
- `npc`: 会話クールダウン設定

## 重要な設計判断

### 後方互換性
- 開発初期段階のため後方互換性は不要
- 不使用コードは完全に削除する

### データの正本
- キャラクター設定: `public/data/characters.json`
- マップ定義: `public/data/maps.json`
- グリッドノード生成: `src/data/maps/grid.ts`
- ワールド設定: `public/data/world-config.json`
- アクション定義: `src/server/simulation/actions/definitions.ts` + `world-config.json`
- UIラベル・絵文字: `src/lib/uiLabels.ts`

### homeマップ必須
キャラクターは必ず `home` マップを持つ必要がある（睡眠等の基本行動のため）。

## 実装プラン管理

実装計画は `docs/implementation-plan.md` に記載。

### 実装済みマーク
```markdown
# タスク完了時
| ✅ 1-1 | `src/types/character.ts` に `energy` 追加 | ビルド通過 |

# Step全完了時
### ✅ Step 1: ステータス拡張（全層対応）
```
