# システム全体設計

## 概要

キャラクターエージェントが現実時間で生活し、記憶を形成する世界シミュレーションシステム。

## 時間システム

### 時間の進行

- **現実世界と同期**: 世界内時間 = 現実時間
- **タイムゾーン**: 設定で指定可能
- **アクション時間**: 現実時間で待機（食事30分なら現実の30分経過を待つ）

### アクション所要時間

アクションの所要時間は現実時間で経過する:

| アクション | 所要時間 | 備考 |
|-----------|---------|------|
| eat | 30-45分 | 場所により異なる |
| sleep | 8時間 | 「寝ている」状態で8時間待機 |
| bathe | 30-60分 | 温泉は長め |
| work | 1時間単位 | 連続勤務可能 |
| toilet | 5分 | 短時間 |
| rest | 15-30分 | 任意の時間 |

### ステータス減少

- **タイミング**: 現実時間ベースで定期的に減少
- **減少レート**: 設定ファイル（world-config.json）で管理
- **計算間隔**: 設定可能（例: 1分ごとにチェック）

```typescript
interface TimeConfig {
  timezone: string  // "Asia/Tokyo"
  statusDecayIntervalMs: number  // ステータス減少チェック間隔(ms)
}
```

## データ永続化

### SQLite

軽量テーブルはSQLiteで管理。

| テーブル | 用途 |
|---------|------|
| mid_term_memories | 中期記憶 |
| npc_summaries | NPC別会話サマリー |
| schedules | スケジュール |
| character_states | キャラクター状態 |

### Graphiti (Neo4j)

長期記憶・関係性はGraphitiで管理。

## LLM設定

### AI SDK

- **ライブラリ**: Vercel AI SDK
- **モデル切り替え**: 柔軟に差し替え可能
- **デフォルト**: gpt-4o-mini

```typescript
import { generateText } from 'ai'
import { openai } from '@ai-sdk/openai'

const model = openai('gpt-4o-mini')  // 設定で変更可能
```

### 用途別モデル（将来的な検討）

| 用途 | 推奨モデル | 理由 |
|------|-----------|------|
| 行動決定 | gpt-4o-mini | 高頻度、低コスト |
| 会話生成 | gpt-4o-mini | バランス |
| サマリー/抽出 | gpt-4o-mini | 構造化出力 |

## エラーハンドリング

### LLM呼び出し失敗時

```
LLM呼び出し失敗
  ↓
Webhook通知を送信
  ↓
システム一時停止
  ↓
ユーザーがエラー確認
  ↓
サーバー再起動で再開
```

```typescript
interface ErrorConfig {
  webhookUrl: string
  notifyOnError: boolean
}

async function handleLLMError(error: Error) {
  // Webhook通知
  await fetch(config.webhookUrl, {
    method: 'POST',
    body: JSON.stringify({
      type: 'llm_error',
      message: error.message,
      timestamp: new Date().toISOString(),
    }),
  })

  // システム停止
  simulationEngine.pause()
}
```

## フロントエンド

### キャラクター情報表示

キャラクターをクリックすると以下を表示:

- 全ステータス（hunger, energy, hygiene, mood, bladder, money）
- 直近の会話サマリー
- 中期記憶
- 現在のスケジュール
- 雇用情報

### 会話表示

リアルタイムで会話中の場合:

- 会話の内容を表示
- 発話者（キャラクター/NPC）を区別
- 会話の目的を表示（任意）

## 実装順序

### Phase 1: LLMなしで実装可能な範囲

1. ステータス拡張（energy, hygiene, mood, bladder）
2. 施設タグ・情報をZone/マップに追加
3. アクション定義・実行ロジック
4. 時間経過によるステータス変化
5. SQLiteテーブル作成
6. フロントエンド（ステータス表示）

### Phase 2: LLMの仕組み

1. AI SDK統合
2. LLM呼び出しインターフェース定義
3. エラーハンドリング・Webhook通知
4. スタブ実装（固定値返却）

### Phase 3: LLMが必要な機能

1. 行動決定LLM
2. 会話システム（2者間LLM）
3. サマリー・記憶抽出
4. ミニエピソード生成

### Phase 4: 記憶システム

1. Graphiti統合
2. 長期記憶の登録・検索
3. 記憶に基づく行動決定

## 設定ファイル

### 全体設定例

```typescript
interface SystemConfig {
  // 時間
  time: {
    timezone: string
  }

  // LLM
  llm: {
    provider: 'openai' | 'anthropic' | 'google'
    model: string
    apiKey: string
  }

  // エラー通知
  error: {
    webhookUrl: string
    notifyOnError: boolean
  }

  // データベース
  database: {
    sqlitePath: string
    graphitiUrl?: string
  }
}
```
