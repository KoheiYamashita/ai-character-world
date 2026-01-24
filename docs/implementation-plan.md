# 実装計画

設計書（system-overview.md, llm-behavior-system.md, memory-and-conversation-system.md, action-system.md）に基づく実装順序。
各ステップは動作確認できる単位で区切っている。

---

## Phase 1: LLMなしで実装可能な範囲

### ✅ Step 1: ステータス拡張（全層対応）

| # | タスク | 動作確認 |
|---|--------|----------|
| ✅ 1-1 | `src/types/character.ts` に `energy`, `hygiene`, `mood`, `bladder` 追加 | ビルド通過 |
| ✅ 1-2 | `src/server/simulation/types.ts` の `SimCharacter` に新ステータス追加 | ビルド通過 |
| ✅ 1-3 | `public/data/characters.json` に新ステータスの初期値追加 | JSON読み込み成功 |
| ✅ 1-4 | `src/server/simulation/dataLoader.ts` でロード処理更新 | サーバー起動成功 |
| ✅ 1-5 | `src/hooks/useSimulationSync.ts` でSSE同期に新ステータス反映 | クライアント同期確認 |
| ✅ 1-6 | `src/stores/characterStore.ts` に新ステータス用アクション追加 | ストア更新成功 |
| ✅ 1-7 | `src/components/panels/StatusPanel.tsx` に全ステータス表示 | UIで6ステータスが表示される |

---

### ✅ Step 2: 時間システム＋ステータス減少

| # | タスク | 動作確認 |
|---|--------|----------|
| ✅ 2-1 | `src/types/config.ts` に `TimeConfig` 追加（timezone, statusDecayIntervalMs, decayRates） | ビルド通過 |
| ✅ 2-2 | `public/data/world-config.json` に時間・減衰設定追加 | 設定読み込み成功 |
| ✅ 2-3 | `SimulationEngine` の tick で現実時間と同期 | 時間が現実時間と一致 |
| ✅ 2-4 | `SimulationEngine` にステータス減少タイマー追加 | 減衰ログ出力 |
| ✅ 2-5 | SSE経由でクライアントに時間・ステータス変化を配信 | UIでリアルタイム反映 |

---

### ✅ Step 3: 施設システム（型・ローダー・データ）

| # | タスク | 動作確認 |
|---|--------|----------|
| ✅ 3-1 | `src/types/map.ts` に `FacilityTag`, `FacilityInfo` 型追加 | ビルド通過 |
| ✅ 3-2 | `src/types/map.ts` の `Obstacle` に `facility?: FacilityInfo` 追加 | ビルド通過 |
| ✅ 3-3 | `public/data/maps.json` の obstacles に facility 追加（自宅: bedroom, kitchen等） | JSONバリデーション通過 |
| ✅ 3-4 | `src/lib/mapLoader.ts` で facility のパース追加 | クライアント側読み込み成功 |
| ✅ 3-5 | `src/server/simulation/dataLoader.ts` で facility のパース追加 | サーバー側読み込み成功 |
| ✅ 3-6 | Zone と PathNode の関連付けデータ構築（Zone内ノードの特定） | Zone判定可能 |

---

### ✅ Step 4: アクション定義

| # | タスク | 動作確認 |
|---|--------|----------|
| ✅ 4-1 | `src/types/action.ts` 新規作成: `ActionDefinition`, `ActionState` 型 | ビルド通過 |
| ✅ 4-2 | `src/server/simulation/actions/definitions.ts` に ACTIONS 定数（eat, sleep, toilet, bathe, rest） | ビルド通過 |
| ✅ 4-3 | `SimCharacter` に `currentAction?: ActionState` 追加 | ビルド通過 |

---

### ✅ Step 5: アクション実行ロジック（CharacterSimulator置換）

| # | タスク | 動作確認 |
|---|--------|----------|
| ✅ 5-1 | `src/server/simulation/actions/ActionExecutor.ts` 新規作成 | ビルド通過 |
| ✅ 5-2 | アクション開始・終了管理ロジック実装 | アクション状態遷移 |
| ✅ 5-3 | アクション所要時間の待機（現実時間ベース） | 待機後に完了 |
| ✅ 5-4 | `CharacterSimulator` のランダム移動ロジックを無効化/削除 | ランダム移動停止 |
| ✅ 5-5 | `ActionExecutor` を `SimulationEngine` に統合 | エンジンからアクション実行 |

---

### ✅ Step 6: 施設でのアクション実行

| # | タスク | 動作確認 |
|---|--------|----------|
| ✅ 6-1 | キャラクターが Zone 内にいるかの判定ロジック | Zone進入検知 |
| ✅ 6-2 | Zone の施設タグに基づいて実行可能アクション判定 | 寝室で sleep 可能 |
| ✅ 6-3 | アクション実行によるステータス変化適用 | sleep後に energy 回復 |
| ✅ 6-4 | アクション実行中の頭上絵文字表示（クライアント側） | 絵文字表示 |
| ✅ 6-5 | テスト用トリガー（低ステータス時に自動アクション） | 自動でアクション実行 |

---

### ✅ Step 7: 仕事システム

| # | タスク | 動作確認 |
|---|--------|----------|
| ✅ 7-1 | `src/types/job.ts` 新規作成: `JobInfo`, `Employment` 型 | ビルド通過 |
| ✅ 7-2 | `src/types/character.ts` に `employment?: Employment` 追加 | ビルド通過 |
| ✅ 7-3 | `public/data/maps.json` に workspace 施設の job プロパティ追加 | JSON読み込み成功 |
| ✅ 7-4 | `public/data/characters.json` に employment 追加 | JSON読み込み成功 |
| ✅ 7-5 | `dataLoader.ts`, `characterLoader.ts` で employment ロード | ローダー更新 |
| ✅ 7-6 | `work` アクション実装（営業時間チェック、時給計算） | 仕事で money 増加 |

---

### ✅ Step 8: SQLite永続化（StateStore統合）

| # | タスク | 動作確認 |
|---|--------|----------|
| ✅ 8-1 | `better-sqlite3` インストール | パッケージ追加 |
| ✅ 8-2 | `src/server/persistence/SqliteStore.ts` 新規作成（StateStore実装） | ビルド通過 |
| ✅ 8-3 | `character_states` テーブル（全ステータス保存） | テーブル作成 |
| ✅ 8-4 | `SimulationEngine` で StateStore を使用 | 状態保存 |
| ✅ 8-5 | サーバー再起動時に状態復元 | 状態が永続化される |

---

## Phase 2: LLM基盤

### ✅ Step 9: AI SDK統合

| # | タスク | 動作確認 |
|---|--------|----------|
| ✅ 9-1 | AI SDKパッケージインストール（ai, @ai-sdk/openai, @ai-sdk/anthropic, @ai-sdk/google） | パッケージ追加 |
| ✅ 9-4 | `src/server/llm/client.ts` 新規作成 | ビルド通過 |

※ 9-2, 9-3は環境変数のみで制御する設計に変更のため削除

---

### ✅ Step 10: エラーハンドリング

| # | タスク | 動作確認 |
|---|--------|----------|
| ✅ 10-1 | `src/types/config.ts` に `ErrorConfig` 追加 | ビルド通過 |
| ✅ 10-2 | `src/server/llm/errorHandler.ts` 新規作成 | ビルド通過 |
| ✅ 10-3 | Webhook通知送信実装 | 擬似エラーで通知 |
| ✅ 10-4 | エラー時のシミュレーション一時停止 | 停止確認 |

---

### ✅ Step 11: スケジュール基本実装

| # | タスク | 動作確認 |
|---|--------|----------|
| ✅ 11-1 | `src/types/schedule.ts` に `ScheduleEntry`, `DailySchedule` 型定義 | ビルド通過 |
| ✅ 11-2 | `schedules` テーブル作成（SQLite） | テーブル作成 |
| ✅ 11-3 | `public/data/characters.json` に初期スケジュール追加 | JSON読み込み |
| ✅ 11-4 | スケジュール CRUD 実装 | 保存・取得成功 |

---

### ✅ Step 12: 行動決定インターフェース＋スタブ

| # | タスク | 動作確認 |
|---|--------|----------|
| ✅ 12-1 | `src/server/behavior/BehaviorDecider.ts` インターフェース定義 | ビルド通過 |
| ✅ 12-2 | `BehaviorDecision`, `BehaviorContext` 型定義 | ビルド通過 |
| ✅ 12-3 | `StubBehaviorDecider` 実装（スケジュール参照＋ステータスルール） | ルールベースで行動決定 |
| ✅ 12-4 | `SimulationEngine` に BehaviorDecider 統合 | スタブで自律行動 |

---

## Phase 3: LLM活用

### ✅ Step 13: 行動決定LLM

| # | タスク | 動作確認 |
|---|--------|----------|
| ✅ 13-1 | `LLMBehaviorDecider` 実装 | ビルド通過 |
| ✅ 13-2 | 行動決定プロンプト構築 | プロンプトログ出力 |
| ✅ 13-3 | 構造化出力パース（zod schema） | 行動決定成功 |
| ✅ 13-4 | アクション詳細選択（施設一覧→LLM選択の2段階） | 施設選択も動作 |
| ✅ 13-5 | `case 'move':` 実装（マップ移動/ノード移動） | move決定で移動開始 |
| ✅ 13-6 | フォールバック改善（nearbyFacilitiesから施設検索） | 施設移動+アクション |
| ✅ 13-7 | ACTION_FACILITY_TAGSマッピング追加 | 施設検索が動作 |

#### Step 13 設計変更点（実装時に追加）

| 変更 | 内容 |
|------|------|
| `hunger` → `satiety` | 空腹度から満腹度に変更（0=空腹, 100=満腹）。直感的な理解のため |
| アクション設定外部化 | `world-config.json` の `actions` セクションで時間・効果を管理 |
| 可変時間アクション | LLMが `durationMinutes` を指定、`perMinute` × 時間で効果計算 |
| `PendingAction` | 移動完了後にアクション実行する仕組み |
| `thinking` アクション | LLM決定中に🤔表示（duration: 0、手動完了） |
| キャラクタープロファイル | `personality`, `tendencies`, `customPrompt` をキャラクターに追加 |
| 雇用情報構造変更 | 単一職場 → 複数職場（`workplaces[]`）対応 |
| 施設検索ロジック | 「現在位置」→「マップ全体」でチェック |
| `StubBehaviorDecider` 削除 | `LLMBehaviorDecider` に完全置換 |

---

### ✅ Step 13.5: 行動履歴

当日の行動履歴をDBに保存し、LLMの行動決定プロンプトに含める。

| # | タスク | 動作確認 |
|---|--------|----------|
| ✅ 13.5-1 | `ActionHistoryEntry` 型定義（`src/types/behavior.ts`） | ビルド通過 |
| ✅ 13.5-2 | `action_history` テーブル追加（SQLite） | テーブル作成 |
| ✅ 13.5-3 | アクション完了時に履歴記録（ActionExecutor → SimulationEngine → StateStore） | DB保存確認 |
| ✅ 13.5-4 | 行動決定プロンプトに「今日の行動」セクション追加 | プロンプトに表示 |

---

### ✅ Step 14: ステータス割り込み

| # | タスク | 動作確認 |
|---|--------|----------|
| ✅ 14-1 | 割り込み判定ロジック（< 10%） | 割り込み検知 |
| ✅ 14-2 | 強制アクション種別決定＋施設選択をLLMに委譲 | 緊急アクション発動 |

---

### ✅ Step 15: システム自動移動

| # | タスク | 動作確認 |
|---|--------|----------|
| ✅ 15-1 | アクションカウンター追加 | カウント増加 |
| ✅ 15-2 | 3アクションごとにランダム移動（3マップ以内） | 定期移動確認 |

---

### ✅ Step 16: NPC拡張（facts/affinity追加）

| # | タスク | 動作確認 |
|---|--------|----------|
| ✅ 16-1 | `src/types/npc.ts` に `personality`, `tendencies`, `customPrompt`, `facts` 追加 | ビルド通過 |
| ✅ 16-2 | `NPC` に `affinity`, `mood`, `conversationCount`, `lastConversation` 追加 | ビルド通過 |
| ✅ 16-3 | `public/data/maps.json` のNPC定義に新フィールド追加 | JSON読み込み |
| ✅ 16-4 | ローダー更新 | NPC拡張データ読み込み |

※ NPC固定配置（spawnNodeId）は実装済み

---

### ✅ Step 17: 会話システム基盤

| # | タスク | 動作確認 |
|---|--------|----------|
| ✅ 17-1 | `ConversationGoal` 型定義 | ビルド通過 |
| ✅ 17-2 | 会話開始判定（NPC近くで talk アクション） | 会話開始イベント発火 |
| ✅ 17-3 | 会話状態管理（ログ、ターン数） | 会話進行状態を保持 |

---

### ✅ Step 18: 会話LLM実装

| # | タスク | 動作確認 |
|---|--------|----------|
| ✅ 18-1 | キャラクターLLM（目的達成判定付き） | キャラクター発話生成 |
| ✅ 18-2 | NPC LLM（facts参照） | NPC発話生成 |
| ✅ 18-3 | 会話ループ（交互発話、10ターン上限） | 会話が交互に進む |
| ✅ 18-4 | 会話UIに表示 | フロントで会話内容を表示 |

---

### ✅ Step 19: 会話終了処理

| # | タスク | 動作確認 |
|---|--------|----------|
| ✅ 19-1 | サマリー生成（LLM） | 会話サマリー生成 |
| ✅ 19-2 | `npc_summaries` テーブル作成・保存 | DBに保存 |
| ✅ 19-3 | facts抽出・NPC更新 | NPC.factsに新情報追加 |
| ✅ 19-4 | affinity/mood更新 | NPC好感度が変化 |

---

### Step 20: 中期記憶

| # | タスク | 動作確認 |
|---|--------|----------|
| 20-1 | `MidTermMemory` 型定義 | ビルド通過 |
| 20-2 | `mid_term_memories` テーブル作成・CRUD | DB操作成功 |
| 20-3 | 会話から中期記憶を抽出（LLM） | 記憶が保存される |
| 20-4 | 有効期限チェック・削除 | 期限切れ記憶が削除される |
| 20-5 | 行動決定プロンプトに中期記憶追加 | 中期記憶が行動に影響 |

---

### Step 21: 当日の一時状態

| # | タスク | 動作確認 |
|---|--------|----------|
| 21-1 | `CharacterDailyState` 実装（recentConversations） | オンメモリで保持 |
| 21-2 | sleep アクション実行時にクリア | 睡眠後にリセット |

---

### Step 22: ミニエピソード

| # | タスク | 動作確認 |
|---|--------|----------|
| 22-1 | `MiniEpisodeGenerator` インターフェース | ビルド通過 |
| 22-2 | `StubMiniEpisodeGenerator`（常にnull） | スタブ動作 |
| 22-3 | `LLMMiniEpisodeGenerator`（20%確率） | 時々エピソード生成 |
| 22-4 | エピソードをログ/UIに表示 | 生成されたエピソードを確認 |

---

## Phase 4: 記憶システム（Graphiti）

### Step 23: Graphiti統合準備

| # | タスク | 動作確認 |
|---|--------|----------|
| 23-1 | Neo4j/Graphiti環境構築（Docker等） | コンテナ起動 |
| 23-2 | Graphiti SDK インストール・設定 | 接続成功 |
| 23-3 | 接続ユーティリティ作成 | ヘルスチェック通過 |

---

### Step 24: 長期記憶の登録

| # | タスク | 動作確認 |
|---|--------|----------|
| 24-1 | 会話サマリーをエピソードとして登録 | Graphitiにデータ追加 |
| 24-2 | `group_id` でキャラクター分離 | キャラクター別に検索可能 |

---

### Step 25: 長期記憶の検索

| # | タスク | 動作確認 |
|---|--------|----------|
| 25-1 | NPCに関するファクト検索 | 関連ファクト取得 |
| 25-2 | 会話開始時のコンテキスト構築（前回サマリー＋Graphiti検索） | 会話プロンプトに過去情報 |
| 25-3 | 過去の会話を参照した会話 | 「前に話した〇〇」と言及 |

---

### Step 26: 記憶に基づく行動決定

| # | タスク | 動作確認 |
|---|--------|----------|
| 26-1 | 行動決定プロンプトにGraphiti情報追加 | プロンプトに長期記憶 |
| 26-2 | 長期記憶が行動に影響することを確認 | 過去の経験で行動が変わる |

---

## 実装の優先順位（依存関係図）

```
Phase 1 (LLMなし)
├── Step 1: ステータス拡張 ─────────────────────┐
├── Step 2: 時間システム ←─────────────────────┤
├── Step 3: 施設システム                        │
├── Step 4: アクション定義 ←───────────────────┤
├── Step 5: アクション実行 ← Step 3, 4          │
├── Step 6: 施設アクション ← Step 5             │
├── Step 7: 仕事システム ← Step 3, 4, 5         │
└── Step 8: SQLite永続化 ← Step 1              ↓

Phase 2 (LLM基盤)
├── Step 9: AI SDK ─────────────────────────────┐
├── Step 10: エラーハンドリング ← Step 9        │
├── Step 11: スケジュール ← Step 8              │
└── Step 12: 行動決定スタブ ← Step 5, 11       ↓

Phase 3 (LLM活用)
├── Step 13: 行動決定LLM ← Step 9, 12 ─────────┐
├── Step 14: ステータス割り込み ← Step 13       │
├── Step 15: システム自動移動 ← Step 13         │
├── Step 16: NPC拡張                            │
├── Step 17-19: 会話システム ← Step 9, 16       │
├── Step 20-21: 中期記憶 ← Step 8, 19           │
└── Step 22: ミニエピソード ← Step 9, 5        ↓

Phase 4 (長期記憶)
├── Step 23: Graphiti準備 ─────────────────────┐
├── Step 24: 記憶登録 ← Step 19, 23             │
├── Step 25: 記憶検索 ← Step 24                 │
└── Step 26: 記憶に基づく行動 ← Step 13, 25    ↓
```

---

## 設計上の注意点

### 既存コードとの整合性

| 既存コード | 対応方針 |
|------------|----------|
| `CharacterSimulator` のランダム移動 | Step 5 で ActionExecutor に置換 |
| `WorldState.advanceTime()` | Step 2 で SimulationEngine から呼び出し |
| `StateStore` インターフェース | Step 8 で SqliteStore として実装 |
| NPC の `spawnNodeId` | 実装済み。Step 16 は facts/affinity のみ追加 |
