# カスタマイズガイド

AI Character Worldの各種設定をカスタマイズする方法を説明します。

## 設定ファイル一覧

| ファイル | 役割 |
|---------|------|
| `public/data/characters.json` | キャラクター定義 |
| `public/data/maps.json` | マップ・NPC定義 |
| `public/data/world-config.json` | ワールド全体設定 |
| `public/assets/sprites/` | スプライト画像 |
| `.env.local` | 環境変数（LLM設定等） |

---

## 1. キャラクター設定

ファイル: `public/data/characters.json`

### 基本構造

```json
{
  "characters": [
    {
      "id": "character-id",
      "name": "表示名",
      "sprite": { ... },
      "defaultStats": { ... },
      "employment": { ... },
      "defaultSchedule": [ ... ],
      "personality": "性格の説明",
      "tendencies": ["行動傾向1", "行動傾向2"],
      "customPrompt": ""
    }
  ]
}
```

### フィールド一覧

| フィールド | 必須 | 説明 |
|-----------|------|------|
| `id` | ◯ | 一意のID（英数字・ハイフン） |
| `name` | ◯ | 表示名 |
| `sprite` | ◯ | スプライト設定 |
| `defaultStats` | ◯ | 初期ステータス |
| `personality` | ◯ | 性格の説明（LLMへの指示） |
| `tendencies` | - | 行動傾向の配列 |
| `employment` | - | 雇用情報 |
| `defaultSchedule` | - | 日次スケジュール |
| `customPrompt` | - | LLMへの追加プロンプト |

### ステータス

```json
"defaultStats": {
  "money": 100000,
  "satiety": 80,
  "energy": 80,
  "hygiene": 80,
  "mood": 80,
  "bladder": 80,
  "fitness": 80
}
```

- 全ステータスは0-100（moneyのみ上限なし）
- 10%未満で割り込みアクション発動

### 雇用設定

```json
"employment": {
  "jobId": "freelance-engineer",
  "workplaces": [
    { "workplaceLabel": "書斎", "mapId": "home" },
    { "workplaceLabel": "作業エリア", "mapId": "office" }
  ]
}
```

### スケジュール

```json
"defaultSchedule": [
  { "time": "07:00", "activity": "起床" },
  { "time": "09:00", "activity": "仕事" },
  { "time": "12:00", "activity": "昼食" }
]
```

- LLMが行動決定時の参考として使用
- `location`フィールドで場所を指定可能

---

## 2. NPC設定

NPCはマップ定義内で設定します。

ファイル: `public/data/maps.json` 内の `npcs` 配列

### 基本構造

```json
{
  "id": "npc-id",
  "name": "NPC名",
  "spawnNodeId": "map-2-3",
  "sprite": { ... },
  "personality": "性格の説明",
  "tendencies": ["傾向1", "傾向2"],
  "facts": ["既知の事実1", "既知の事実2"],
  "customPrompt": ""
}
```

### フィールド一覧

| フィールド | 必須 | 説明 |
|-----------|------|------|
| `id` | ◯ | 一意のID（マップ内で一意） |
| `name` | ◯ | 表示名 |
| `spawnNodeId` | ◯ | 出現位置のノードID |
| `sprite` | ◯ | スプライト設定 |
| `personality` | ◯ | 性格の説明 |
| `tendencies` | - | 会話時の傾向 |
| `facts` | - | NPCが持つ知識・情報 |
| `customPrompt` | - | LLMへの追加プロンプト |

### 動的属性

以下はシミュレーション中に変化し、DBに保存されます：

| 属性 | 説明 |
|------|------|
| `affinity` | キャラクターへの好感度（0-100） |
| `mood` | 気分（happy/neutral/sad/angry/excited） |
| `conversationCount` | 会話回数 |
| `lastConversation` | 最後の会話タイムスタンプ |

---

## 3. マップ設定

ファイル: `public/data/maps.json`

### 基本構造

```json
{
  "maps": [
    {
      "id": "map-id",
      "name": "マップ名",
      "width": 800,
      "height": 600,
      "backgroundColor": "0x4a7c59",
      "spawnNodeId": "map-4-5",
      "grid": { ... },
      "labels": [],
      "entrances": [ ... ],
      "obstacles": [ ... ],
      "npcs": [ ... ]
    }
  ]
}
```

### グリッド設定

```json
"grid": {
  "prefix": "map",
  "cols": 12,
  "rows": 9
}
```

- `prefix`: ノードIDのプレフィックス（例: `map-0-0`）
- `cols`/`rows`: グリッドサイズ（省略時はworld-config.jsonのデフォルト値）

### 障害物（Obstacle）

2種類の障害物タイプがあります：

#### Building型（デフォルト）
```json
{
  "row": 1,
  "col": 4,
  "tileWidth": 2,
  "tileHeight": 2,
  "label": "噴水"
}
```
- 通過不可
- 内部にノードなし
- 最小サイズ: 2x2

#### Zone型
```json
{
  "row": 0,
  "col": 0,
  "tileWidth": 6,
  "tileHeight": 4,
  "type": "zone",
  "label": "リビング",
  "wallSides": ["top", "left", "bottom"],
  "door": { "side": "right", "start": 1, "end": 3 },
  "facility": { ... }
}
```
- 壁で囲まれた部屋
- 内部は移動可能
- 扉の位置を指定可能
- 最小サイズ: 4x4

### 施設（Facility）

障害物に`facility`プロパティを追加：

```json
"facility": {
  "actionIds": ["eat", "rest", "coffee"],
  "quality": 80,
  "cost": 500,
  "owner": "character-id",
  "job": {
    "jobId": "barista",
    "label": "バリスタ",
    "hourlyWage": 1200
  }
}
```

| フィールド | 説明 |
|-----------|------|
| `actionIds` | この施設で実行可能なアクションID |
| `quality` | 品質（0-100、効果に影響） |
| `cost` | 利用料金 |
| `owner` | 所有者キャラクターID |
| `job` | 仕事情報（workspace施設用） |

### 入口（Entrance）

```json
{
  "id": "cafe-entrance",
  "row": 2,
  "col": 12,
  "connectedNodeIds": ["town-2-11", "town-3-11"],
  "leadsTo": { "mapId": "cafe", "nodeId": "cafe-door" },
  "label": "カフェ"
}
```

- `row`/`col`: グリッド範囲外も指定可能（-1や12等）
- `connectedNodeIds`: この入口に接続するノード
- `leadsTo`: 遷移先マップとノード

---

## 4. ワールド設定

ファイル: `public/data/world-config.json`

### タイミング設定

```json
"timing": {
  "idleTimeMin": 500,
  "idleTimeMax": 1500,
  "fadeStep": 0.05,
  "fadeIntervalMs": 16
}
```

### 時間・ステータス減衰

```json
"time": {
  "timezone": "Asia/Tokyo",
  "statusDecayIntervalMs": 60000,
  "decayRates": {
    "satietyPerMinute": 0.1,
    "energyPerMinute": 0.05,
    "hygienePerMinute": 0.03,
    "moodPerMinute": 0.02,
    "bladderPerMinute": 0.15,
    "fitnessPerMinute": 0.05
  }
}
```

### 移動設定

```json
"movement": {
  "speed": 75,
  "entranceProbability": 0.1
}
```

### グリッド・キャンバス

```json
"grid": {
  "defaultCols": 12,
  "defaultRows": 9,
  "defaultWidth": 800,
  "defaultHeight": 600
},
"canvas": {
  "defaultWidth": 800,
  "defaultHeight": 600,
  "backgroundColor": "0x1a1a2e"
}
```

### テーマ（描画スタイル）

```json
"theme": {
  "nodes": {
    "entrance": { "fill": "0xe74c3c", "stroke": "0xc0392b", "strokeWidth": 2, "radius": 8 },
    "spawn": { "fill": "0x2ecc71", "stroke": "0x27ae60", "strokeWidth": 1, "radius": 6 },
    "waypoint": { "fill": "0x3498db", "alpha": 0.5, "radius": 4 }
  },
  "obstacle": {
    "building": { "fill": "0x1a1a1a", "alpha": 0, "stroke": "0xffff00", "strokeWidth": 2 },
    "zone": { "fill": "0x000000", "alpha": 0, "stroke": "0xaaaaaa", "strokeWidth": 2 }
  }
}
```

### アクション定義

各アクションの時間範囲と効果をカスタマイズ：

```json
"actions": {
  "eat": {
    "durationRange": { "min": 15, "max": 60, "default": 30 },
    "perMinute": { "satiety": 1.67, "mood": 0.33 }
  },
  "talk": {
    "fixed": true,
    "duration": 0,
    "effects": { "mood": 20 },
    "turnIntervalMs": 60000
  }
}
```

- `durationRange`: 可変時間アクション
- `fixed`: 固定時間アクション（会話など）
- `perMinute`: 毎分適用される効果
- `effects`: 完了時に一括適用される効果

### 記憶・履歴の上限

```json
"memory": {
  "midTermLimit": 8,
  "todayActionsLimit": 10,
  "factsLimit": 20
},
"actionRestrictions": {
  "maxConsecutiveSameAction": 3
}
```

### NPC会話クールダウン

```json
"npc": {
  "conversationCooldownMinutes": 60
}
```

---

## 5. スプライト画像

### ディレクトリ構造

```
public/assets/sprites/
├── characters/          # キャラクター
│   └── {character-id}.png
└── npcs/
    └── {map-id}/        # マップごとのNPC
        └── {npc-name}.png
```

### 画像仕様

- サイズ: 288x384 ピクセル（3列×4行のグリッド）
- フレームサイズ: 96x96 ピクセル
- 配列:
  - Row 0: 下向き（3フレーム）
  - Row 1: 左向き（3フレーム）
  - Row 2: 右向き（3フレーム）
  - Row 3: 上向き（3フレーム）

### スプライト設定

```json
"sprite": {
  "sheetUrl": "/assets/sprites/characters/kanon.png",
  "frameWidth": 96,
  "frameHeight": 96,
  "cols": 3,
  "rows": 4,
  "rowMapping": {
    "down": 0,
    "left": 1,
    "right": 2,
    "up": 3
  }
}
```

### プレースホルダー生成

画像がない場合、プレースホルダーを生成できます：

```bash
node scripts/generate-placeholder-sprite.mjs
```

---

## 6. LLM設定

ファイル: `.env.local`

### 対応プロバイダー

| プレフィックス | プロバイダー | 例 |
|--------------|------------|-----|
| `anthropic/` | Anthropic | `anthropic/claude-sonnet-4` |
| `openai/` | OpenAI | `openai/gpt-4o-mini` |
| `openai/chat/` | OpenAI互換API | `openai/chat/gpt-4o-mini` |
| `google/` | Google | `google/gemini-2.0` |
| `gemini/` | Google | `gemini/gemini-2.0-flash` |
| `openrouter/` | OpenRouter | `openrouter/anthropic/claude-3.5-sonnet` |

### 設定例

```bash
# Anthropic
LLM_MODEL=anthropic/claude-sonnet-4
LLM_API_KEY=sk-ant-...

# OpenAI
LLM_MODEL=openai/gpt-4o-mini
LLM_API_KEY=sk-...

# OpenAI互換API（ローカルLLMなど）
LLM_MODEL=openai/chat/gpt-4o-mini
LLM_API_KEY=your-api-key
LLM_BASE_URL=http://localhost:5001

# Google
LLM_MODEL=google/gemini-2.0
LLM_API_KEY=...

# OpenRouter
LLM_MODEL=openrouter/anthropic/claude-3.5-sonnet
LLM_API_KEY=sk-or-...
```

---

## 7. アクション一覧

全38種類のアクションIDとラベル：

| ID | ラベル | 絵文字 |
|----|--------|--------|
| `eat` | 食事 | 🍽️ |
| `sleep` | 睡眠 | 💤 |
| `toilet` | トイレ | 🚽 |
| `bathe` | 入浴 | 🛁 |
| `rest` | 休憩 | ☕ |
| `talk` | 会話 | 💬 |
| `work` | 仕事 | 💼 |
| `thinking` | 思考 | 🤔 |
| `exercise` | 運動 | 🏋️ |
| `read` | 読書 | 📖 |
| `game` | ゲーム | 🎮 |
| `drink_alcohol` | 飲酒 | 🍺 |
| `watch` | 動画視聴 | 📺 |
| `shopping` | 買い物 | 🛍️ |
| `study` | 勉強 | 📚 |
| `meditate` | 瞑想 | 🧘 |
| `nap` | 仮眠 | 💤 |
| `draw` | お絵描き | 🎨 |
| `play_music` | 演奏 | 🎸 |
| `cook` | 料理 | 🍳 |
| `garden` | 園芸 | 🌱 |
| `jog` | ジョギング | 🏃 |
| `swim` | 水泳 | 🏊 |
| `walk` | 散歩 | 🚶 |
| `fish` | 釣り | 🎣 |
| `karaoke` | カラオケ | 🎤 |
| `cinema` | 映画鑑賞 | 🎬 |
| `arcade` | ゲーセン | 🕹️ |
| `bowling` | ボウリング | 🎳 |
| `coffee` | コーヒー | ☕ |
| `snack` | 間食 | 🍪 |
| `massage` | マッサージ | 💆 |
| `haircut` | 散髪 | 💇 |
| `clean` | 掃除 | 🧹 |
| `reply_chat` | チャット返信 | 📱 |
| `check_chat` | チャット確認 | 📲 |
| `send_chat` | チャット送信 | ✉️ |

---

## 付録: よくあるカスタマイズ例

### 新しいキャラクターを追加

1. `public/data/characters.json` にキャラクター定義を追加
2. スプライト画像を `public/assets/sprites/characters/` に配置
3. 必要に応じて `home` マップを持つよう設定

### 新しいマップを追加

1. `public/data/maps.json` に新しいマップ定義を追加
2. 既存マップの入口（entrance）に遷移先を追加
3. `npm run dev` でマップエディタを使用して調整

### アクション効果の調整

`public/data/world-config.json` の `actions` セクションで：
- `durationRange` で時間範囲を変更
- `perMinute` で毎分効果を変更

### ステータス減衰の調整

`public/data/world-config.json` の `time.decayRates` で各ステータスの減衰率を変更。
