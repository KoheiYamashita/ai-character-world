# アクションシステム設計

## 概要

キャラクターエージェントが生活を通じて記憶を形成するための世界シミュレーションシステム。
娯楽としての楽しさではなく、キャラクターの体験と記憶蓄積を目的とする。

## 設計思想

各ステータスは「行動のトリガー」として機能し、予期しない移動や出会いを生み出す:

- satiety → 食事に行く → 外食先で出会い
- energy → 休憩・睡眠 → 場所での体験
- bladder → 行動中断 → 予期しない移動・出会い
- hygiene → 入浴 → 大浴場・温泉での出会い
- mood → 行動選択・会話品質に影響
- money → 仕事・消費行動のトリガー

## ステータス

### キャラクターステータス

| ステータス | 説明 | 範囲 | 記憶形成への役割 |
|-----------|------|------|-----------------|
| satiety | 満腹度 | 0-100 | 食事行動 → 外食で出会い |
| energy | 体力/疲労 | 0-100 | 睡眠・休憩 → 場所での体験 |
| hygiene | 衛生 | 0-100 | 入浴行動 → 大浴場・温泉で出会い |
| mood | 気分 | 0-100 | 行動選択・会話品質に影響 |
| bladder | トイレ欲求 | 0-100 | 行動中断 → ランダムな移動・出会い |
| money | 所持金 | 0以上 | 仕事・消費行動のトリガー |

## アクション一覧

### 生存欲求 (Survival)

| アクション | 必要施設 | 料金 | 効果 | 記憶形成 |
|-----------|---------|------|------|---------|
| eat | kitchen (自宅) | 食材費 | satiety ↑ | 日常の記録 |
| eat | restaurant | 施設料金 | satiety ↑ | 場所・出会いの体験 |
| sleep | bedroom (自宅) | 0 | energy 全回復 | 日の区切り |
| sleep | bedroom + hotel | 施設料金 | energy 全回復 | 場所の記憶 |
| toilet | toilet | 0 | bladder ↑ | 行動中断による偶発的体験 |

### 生活維持 (Daily Life)

| アクション | 必要施設 | 料金 | 効果 | 記憶形成 |
|-----------|---------|------|------|---------|
| work | workspace | - | money ↑, satiety ↓, energy ↓ | 仕事場での体験 |
| bathe | bathroom (自宅) | 0 | hygiene ↑ | 日常の記録 |
| bathe | bathroom + hotel | 施設料金 | hygiene ↑ | 場所の記憶 |
| bathe | hotspring | 施設料金 | hygiene ↑, mood ↑ | 出会い・体験 |

### 社会活動 (Social)

| アクション | 必要施設 | 料金 | 効果 | 記憶形成 |
|-----------|---------|------|------|---------|
| talk | - (NPC近く) | 0 | NPC好感度変化 | **最重要**: 会話による記憶 |

### 余暇 (Leisure)

| アクション | 必要施設 | 料金 | 効果 | 記憶形成 |
|-----------|---------|------|------|---------|
| rest | - | 0 | mood ↑, energy 微回復 | 場所での体験 |

### 移動 (Movement)

| アクション | 必要施設 | 料金 | 効果 | 記憶形成 |
|-----------|---------|------|------|---------|
| move | - | 0 | 位置移動 | 「どこに行った」の記録 |

#### システム自動移動

LLMの行動決定とは別に、システムが定期的にmoveアクションを発動する:

- **発動条件**: 3回のアクション完了ごと（カウンターベース）
- **行き先**: 3マップ以内のランダムな場所
- **目的**: 同じ場所に留まることを防ぐ、偶発的な出会いの創出

```
アクション完了 → カウント+1
  ↓
ステータス割り込み判定（いずれかのステータス < 10%）
  ↓ YES → 緊急アクション（カウントは進むがmoveスキップ）
  ↓ NO
カウント == 3?
  ├─ YES → 3マップ以内のランダムな場所へ自動move → カウントリセット
  └─ NO → LLMが次の行動を決定
```

## 施設システム

### 施設タグ (FacilityTag)

```typescript
type FacilityTag =
  | "bathroom"      // 浴室
  | "kitchen"       // キッチン
  | "bedroom"       // 寝室
  | "toilet"        // トイレ
  | "restaurant"    // レストラン
  | "workspace"     // 仕事場
  | "hotspring"     // 温泉
  | "hotel"         // ホテル
  | "public"        // 公共
```

### 施設情報

```typescript
interface FacilityInfo {
  tags: FacilityTag[]
  owner?: string           // 所有者ID（自宅判定用）
  cost?: number            // 利用料金（0 = 無料）
  quality?: number         // 品質（効果量に影響）
  job?: JobInfo            // 仕事情報（workspaceの場合）
}
```

### maps.jsonでの施設定義

施設情報は `public/data/maps.json` の obstacles 配列内に `facility` プロパティとして定義する。

### 自宅の施設構成

自宅は全基本アクションのフォールバック先として、以下の施設タグを持つ:

| 施設タグ | 用途 | 備考 |
|---------|------|------|
| bedroom | 睡眠 | 寝室 |
| kitchen | 食事 | 調理台 |
| bathroom | 入浴 | 浴室 |
| toilet | トイレ | トイレ |
| workspace | 仕事 | リモートワーク用 |

```json
{
  "id": "home",
  "name": "自宅",
  "obstacles": [
    {
      "label": "寝室",
      "type": "zone",
      "facility": { "tags": ["bedroom"], "owner": "character_alice" }
    },
    {
      "label": "調理台",
      "facility": { "tags": ["kitchen"], "owner": "character_alice" }
    },
    {
      "label": "浴室",
      "facility": { "tags": ["bathroom"], "owner": "character_alice" }
    },
    {
      "label": "トイレ",
      "facility": { "tags": ["toilet"], "owner": "character_alice" }
    },
    {
      "label": "デスク",
      "facility": { "tags": ["workspace"], "owner": "character_alice" }
    }
  ]
}
```

### その他の施設例

```json
{
  "label": "温泉",
  "type": "zone",
  "facility": {
    "tags": ["bathroom", "hotspring", "public"],
    "cost": 500,
    "quality": 80
  }
}
```

### 施設の検索

アクション実行時、以下のルールで利用可能な施設を検索:

1. **検索範囲**: 現在地から3マップ以内（entrance経由のホップ数でカウント）
2. **マッチング**: `requirements.facilityTags`と照合（OR条件: いずれかのタグを持つ施設）
3. **所有権**: `facility.owner`が設定されている場合、そのオーナーのみ使用可
4. **料金**: `facility.cost`が設定されている場合、所持金チェック
5. **フォールバック**: 該当施設がなければ自宅を使用
6. **提示**: 料金・品質・移動距離をLLMに提示し、選択させる

### アクション実行条件

- **実行可能条件**: 対応する施設タグを持つ施設がマップ内に存在すること
  - 例: `bedroom`タグを持つ施設がマップにあれば`sleep`アクション実行可能
  - 例: `kitchen`または`restaurant`タグを持つ施設がマップにあれば`eat`アクション実行可能
- **実行中の移動**: アクション実行中は移動不可（その場に留まる）
- **実行中の表示**: 頭上に対応する絵文字を表示

### ステータス表示（頭上絵文字）

キャラクターの状態を頭上の絵文字で表現:

| 状態 | 絵文字 | 説明 |
|------|--------|------|
| LLM思考中 | 🤔 | 行動決定待ち |
| 会話中 | 💬 | NPCとの会話中 |
| 食事中 | 🍽️ | eatアクション実行中 |
| 睡眠中 | 😴 | sleepアクション実行中 |
| 入浴中 | 🛁 | batheアクション実行中 |
| 仕事中 | 💼 | workアクション実行中 |
| トイレ中 | 🚻 | toiletアクション実行中 |
| 休憩中 | ☕ | restアクション実行中 |
| 移動中 | 🚶 | moveアクション実行中（任意） |

```
例: キャラクターが町にいて空腹の場合

利用可能な食事場所:
- カフェ ドルチェ (1マップ, 800円, 品質70)
- 喫茶 つばめ (1マップ, 600円, 品質65)
- コンビニ (1マップ, 400円, 品質40)
- 自宅キッチン (1マップ, 300円, 品質50)
```

## 仕事システム

### 仕事情報

```typescript
interface JobInfo {
  jobId: string
  title: string           // "ウェイター", "料理人"
  hourlyWage: number      // 時給
  workHours: {            // 営業時間（この時間内のみ働ける）
    start: number         // 9 (時)
    end: number           // 22 (時)
  }
}
```

### 職場定義例

```json
{
  "label": "レストラン",
  "type": "zone",
  "facility": {
    "tags": ["restaurant", "workspace"],
    "job": {
      "jobId": "waiter",
      "title": "ウェイター",
      "hourlyWage": 1000,
      "workHours": { "start": 10, "end": 22 }
    }
  }
}
```

### 雇用状態

キャラクターに雇用状態を持たせる。複数の職場で働けるように配列で管理。

```typescript
interface WorkplaceInfo {
  workplaceLabel: string  // 職場名（表示用）
  mapId: string           // 職場があるマップID
}

interface Employment {
  jobId: string
  workplaces: WorkplaceInfo[]  // 複数職場対応
}

interface SimCharacter {
  // 既存...
  employment?: Employment
}
```

### 雇用の初期設定

キャラクターの雇用状態は `characters.json` で初期設定する。

```json
{
  "id": "character_alice",
  "name": "アリス",
  "employment": {
    "jobId": "waiter",
    "workplaces": [
      { "workplaceLabel": "レストラン", "mapId": "town" }
    ]
  }
}
```

- **未雇用**: `employment`フィールドを省略
- **雇用済み**: 上記のように職場情報を設定
- **複数勤務先**: `workplaces`配列に複数の職場を追加可能

### workアクションの流れ

1. workspace タグのある場所で work アクション実行
2. 営業時間内なら働ける
3. 時間経過 → 時給 × 時間 = 給料を money に加算
4. satiety ↓, energy ↓

### フルタイム/フリーランス

- システムでは厳密に定義しない
- LLMがスケジュールで判断
  - フルタイム: 「9:00-17:00はここで働く」
  - フリーランス: 必要に応じて働く

## アクション定義

### 型定義

```typescript
interface ActionDefinition {
  // 前提条件
  requirements: {
    facilityTags?: FacilityTag[]   // 必要な施設タグ（OR条件: いずれかを持つ施設が必要）
    minStats?: Partial<CharacterStats>
    nearNpc?: boolean              // NPC近くにいる必要
    employment?: boolean           // 雇用されている必要（workの場合）
  }

  // 効果
  effects: {
    stats?: Partial<CharacterStats>
    money?: number | "hourlyWage"  // 固定額 or 時給計算
  }

  emoji?: string                   // 頭上表示用絵文字
}
```

注: `duration` と `effects.stats` は `world-config.json` の actions セクションから読み込む。
所有権(`owner`)・料金(`cost`)・品質(`quality`)は施設側(`FacilityInfo`)のプロパティとして管理する。

### アクション設定の外部化

アクションの時間と効果は `world-config.json` の `actions` セクションで管理。
`definitions.ts` では requirements と emoji のみを定義する。

```json
// world-config.json
{
  "actions": {
    "sleep": {
      "durationRange": { "min": 30, "max": 480, "default": 480 },
      "perMinute": { "energy": 0.208, "mood": 0.042 }
    },
    "eat": {
      "durationRange": { "min": 15, "max": 60, "default": 30 },
      "perMinute": { "satiety": 1.67, "mood": 0.33 }
    },
    "talk": {
      "fixed": true,
      "duration": 5,
      "effects": { "mood": 20 }
    },
    "thinking": {
      "fixed": true,
      "duration": 0,
      "effects": {}
    }
  }
}
```

### 可変時間アクション

LLMが `durationMinutes` を指定可能。効果は `perMinute × durationMinutes` で計算。

| アクション | 時間範囲 | 効果（/分） |
|-----------|---------|-----------|
| eat | 15-60分 | satiety+1.67, mood+0.33 |
| sleep | 30-480分 | energy+0.208, mood+0.042 |
| bathe | 15-60分 | hygiene+3.33, mood+0.5 |
| rest | 10-60分 | energy+0.5, mood+0.17 |
| work | 30-480分 | energy-0.33, mood-0.08 |
| toilet | 3-15分 | bladder+20 |

### 固定時間アクション

`fixed: true` で定義。時間と効果は固定。

| アクション | 時間 | 効果 |
|-----------|-----|------|
| talk | 5分 | mood+20 |
| thinking | 0分 | なし（LLM決定中表示用） |

### ステータス効果のリアルタイム適用

アクション実行中のステータス変化は、完了時の一括適用ではなく**リアルタイムで適用**される。

#### 仕様

1. **可変時間アクション**: `perMinute` 効果がリアルタイムで適用される
   - アクション中は該当ステータスの通常減少を**停止**
   - 代わりに `perMinute` の値で**置き換え**（合算ではない）
   - `perMinute` で定義されていないステータスは通常通り減少

2. **固定時間アクション**: 完了時に `effects` を一括適用（従来通り）
   - 短時間なのでリアルタイム適用の必要なし

#### 例: sleep アクション中（8時間）

| ステータス | 通常減少 | アクション中 | 備考 |
|-----------|---------|-------------|------|
| energy    | -0.05/分 | **+0.208/分** | perMinute で置き換え |
| mood      | -0.02/分 | **+0.042/分** | perMinute で置き換え |
| satiety   | -0.1/分  | -0.1/分 | 通常通り減少 |
| hygiene   | -0.03/分 | -0.03/分 | 通常通り減少 |
| bladder   | -0.15/分 | -0.15/分 | 通常通り減少 |

#### 例: work アクション中（4時間）

| ステータス | 通常減少 | アクション中 | 備考 |
|-----------|---------|-------------|------|
| energy    | -0.05/分 | **-0.33/分** | perMinute で置き換え（消耗） |
| mood      | -0.02/分 | **-0.08/分** | perMinute で置き換え（消耗） |
| satiety   | -0.1/分  | -0.1/分 | 通常通り減少 |
| hygiene   | -0.03/分 | -0.03/分 | 通常通り減少 |
| bladder   | -0.15/分 | -0.15/分 | 通常通り減少 |

#### 処理フロー

```
SimulationEngine.applyStatusDecay(elapsedMinutes)
  for each character:
    perMinute = actionExecutor.getActivePerMinuteEffects(characterId)

    for each stat (satiety, energy, hygiene, mood, bladder):
      if perMinute[stat] exists:
        // 減少を停止し、perMinute で置き換え
        newValue = current + perMinute[stat] * elapsedMinutes
      else:
        // 通常の減少を適用
        newValue = current - decayRate[stat] * elapsedMinutes

      clamp(newValue, 0, 100)
```

#### 設計意図

- **リアルな進行**: 睡眠中は徐々に回復、仕事中は徐々に消耗
- **割り込みの意味**: 睡眠を中断すると回復が途中で止まる
- **二重適用の防止**: 完了時の一括適用を削除し、リアルタイムのみで効果適用

### 登録例（definitions.ts）

```typescript
const ACTIONS: Record<ActionId, ActionDefinition> = {
  eat: {
    // duration と effects.stats は world-config.json から取得
    requirements: { facilityTags: ["kitchen", "restaurant"] },
    effects: {},
    emoji: "🍽️",
  },

  bathe: {
    requirements: { facilityTags: ["bathroom", "hotspring"] },
    effects: {},
    emoji: "🛁",
  },

  sleep: {
    requirements: { facilityTags: ["bedroom"] },
    effects: {},
    emoji: "💤",
  },

  work: {
    requirements: { facilityTags: ["workspace"], employment: true },
    effects: { money: "hourlyWage" },
    emoji: "💼",
  },

  thinking: {
    // fixed: true, duration: 0 → 手動完了
    requirements: {},
    effects: {},
    emoji: "🤔",
  },
}
```

## ミニエピソード生成

### 概要

アクション完了後、設定された確率（デフォルト50%）でLLMがミニエピソード（小さな出来事）を生成し、キャラクターの記憶を豊かにする。生成されたエピソードは行動履歴に記録され、次回以降の行動決定・会話プロンプトに反映される。

### 設定

`public/data/world-config.json`:
```json
{
  "miniEpisode": {
    "probability": 0.5
  }
}
```

### スキップ対象アクション

以下のアクションではエピソード生成をスキップする:
- `talk` - 会話自体が記録されるため
- `thinking` - システム内部アクションのため
- `idle` - 特に行動していないため

### フロー

```
ActionExecutor.completeAction()
    ↓
onRecordHistory → SimulationEngine.recordActionHistory()
    ├── キャッシュ更新 + DB保存 + ログ配信（既存）
    └── generateMiniEpisode() 非同期開始
          ├── スキップ対象アクション判定
          ├── actionExecutor.getCurrentFacility() ← action stateまだ残っている
          ├── generator.generate(character, actionId, facility)
          │     ├── 確率判定: return null（確率外）
          │     └── 確率内: LLM呼び出し → MiniEpisodeResult
          ├── ステータス変化適用（0-100クランプ）
          ├── キャッシュの最新ActionHistoryEntryにepisode追記
          ├── DB更新 (action_history.episode)
          └── notifyLogSubscribersMiniEpisode() → SSE配信
    ↓
action stateクリア → 次の行動決定
```

### インターフェース

`src/server/episode/MiniEpisodeGenerator.ts`:
```typescript
interface MiniEpisodeResult {
  episode: string       // "新メニューのパンケーキが美味しかった"
  statChanges: Partial<Record<'satiety' | 'energy' | 'hygiene' | 'mood' | 'bladder', number>>
}

interface MiniEpisodeGenerator {
  generate(
    character: SimCharacter,
    actionId: ActionId,
    facility: FacilityInfo | null
  ): Promise<MiniEpisodeResult | null>
}
```

### LLM実装

`src/server/episode/LLMMiniEpisodeGenerator.ts`:
- `world-config.json` の `miniEpisode.probability` で確率管理
- `Math.random() > probability` なら即 `null` 返却
- `llmGenerateObject` でエピソード生成（zodスキーマ）
- 各ステータス変化は -10〜+10 の範囲にクランプ
- プロンプト: キャラクター名・性格、アクション種別、施設タグ、現在ステータス

### スタブ実装

`src/server/episode/StubMiniEpisodeGenerator.ts`:
- LLM未設定時に使用
- 常に `null` を返す（エピソード生成なし）

### 行動決定・会話プロンプトへの反映

`ActionHistoryEntry` に `episode?: string` フィールドが追加され、行動決定プロンプトと会話プロンプトの「今日の行動」セクションに表示される:

```
【今日の行動】
- 08:00 eat → レストランA (30分) [朝食を食べに]
  ✨ 新メニューのパンケーキが美味しかった
- 09:30 work → オフィス (120分) [仕事の時間]
```

### 永続化

- `action_history` テーブルに `episode TEXT` カラム（マイグレーション自動適用）
- `updateActionHistoryEpisode()` メソッドで非同期更新

### UI表示

ActivityLogPanelに `MiniEpisodeLogLine` コンポーネント:
```
[10:30] キャラ名 ✨ エピソード内容 (mood+5)
```

### ミニエピソード例

| アクション | エピソード例 | ステータス変化 |
|-----------|-------------|---------------|
| bathe | 入浴剤を使ってリラックスした | mood +5 |
| bathe | 長風呂してのぼせた | energy -5 |
| bathe (温泉) | 常連と世間話をした | mood +3 |
| eat | 新メニューを試して美味しかった | mood +5 |
| eat | 料理が冷めていた | mood -3 |
| work | 同僚に褒められた | mood +10 |
| work | 小さなミスをしてしまった | mood -5 |
| sleep | 良い夢を見た | mood +5 |
| sleep | 悪夢で目が覚めた | energy -10 |
| rest | 綺麗な景色を見つけた | mood +5 |

## LLMとの連携

### 行動決定

#### LLMへの入力

- 現在のステータス
- 現在地で利用可能なアクション
- 周囲の施設情報
- 1日のスケジュール
- 雇用情報

#### LLMからの出力

- 選択するアクション
- 移動先（moveの場合）
- 理由（ログ用）

### LLMに任せる部分

- 勤務スケジュール（フルタイム/フリーランス）
- 行動の優先順位
- スケジュールの動的変更
