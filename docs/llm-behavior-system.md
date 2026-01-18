# LLM行動決定システム設計

## 概要

キャラクターエージェントの行動をLLMが決定するシステム。
ステータス、スケジュール、キャラクター設定を考慮して次の行動を選択する。

## 複数キャラクターの並列動作

### 動作方式

- **独立動作**: 各キャラクターは独立して動作する
- **並列LLM呼び出し**: 複数キャラクターが同時にアクション完了した場合、LLM呼び出しも並列で実行（同時リクエスト）
- **非同期処理**: 各キャラクターのLLM応答は独立して処理される

### 実装上の考慮

```typescript
// 各キャラクターのシミュレーションは独立したループで動作
async function simulateCharacter(characterId: string) {
  while (running) {
    // アクション完了を待機
    await waitForActionComplete(characterId)

    // LLM呼び出し（他キャラクターを待たない）
    const decision = await behaviorDecider.decide(character, context)

    // アクション実行
    await executeAction(characterId, decision)
  }
}

// 全キャラクターを並列で起動
characters.forEach(c => simulateCharacter(c.id))
```

## スケジュール管理

### スケジュールの流れ

```
初日: ユーザーが設定
  ↓
翌日: 前日のスケジュールを引き継ぎ
  ↓
LLMが状況に応じて調整
```

### スケジュール構造

```typescript
interface ScheduleEntry {
  time: string           // "09:00"
  activity: string       // "仕事", "昼食", "自由時間"
  location?: string      // 場所（任意）
  note?: string          // 備考
}

interface DailySchedule {
  date: string           // ゲーム内日付
  entries: ScheduleEntry[]
}
```

### スケジュール例

```json
{
  "date": "2024-01-15",
  "entries": [
    { "time": "07:00", "activity": "起床" },
    { "time": "07:30", "activity": "朝食" },
    { "time": "09:00", "activity": "仕事", "location": "レストラン" },
    { "time": "12:00", "activity": "昼食" },
    { "time": "13:00", "activity": "仕事", "location": "レストラン" },
    { "time": "18:00", "activity": "退勤" },
    { "time": "19:00", "activity": "夕食" },
    { "time": "20:00", "activity": "自由時間" },
    { "time": "23:00", "activity": "就寝" }
  ]
}
```

## LLM呼び出し

### 呼び出しタイミング

| タイミング | トリガー | 処理 |
|-----------|---------|------|
| 通常 | アクション完了 | 次の行動を決定 |
| ステータス割り込み | 各ステータス10%未満 | 強制アクション（詳細はLLM決定） |
| 環境割り込み | ユーザー発動 | LLMが中断判断 |

### ステータス割り込み

ステータスが10%未満になると強制アクションが発動。
アクション種別は強制だが、具体的な内容（場所など）はLLMが決定。

```
hunger < 10%
  ↓
システム: 「食事」アクション強制
  ↓
システム: 食事可能な場所・料金一覧を提示
  [レストランA: 800円, レストランB: 1500円, 自宅: 300円]
  ↓
LLM: 所持金・距離・好みを加味して選択
  「所持金少ないから自宅で」
```

| ステータス | 強制アクション |
|-----------|---------------|
| hunger < 10% | eat |
| energy < 10% | sleep or rest |
| bladder < 10% | toilet |
| hygiene < 10% | bathe |

### 環境割り込み

ユーザーが環境イベントを発動し、LLMが中断するか判断。

```
ユーザー: 「地震だ！」イベント発動
  ↓
LLM: 現在のアクション・状況を考慮して判断
  ↓
├─ 中断する → 避難行動など
└─ 中断しない → 現在のアクション継続
```

| イベント例 | LLM判断例 |
|-----------|----------|
| 地震だ！ | 仕事中断 → 安全確保 |
| 雪が降り始めた | 予定通り続行 or 早めに帰宅 |
| 救急車の音 | 気にせず続行 or 様子を見に行く |
| 停電した | 状況に応じて対応 |

## キャラクタープロファイル

### 構造

```typescript
interface CharacterProfile {
  name: string
  personality: string        // 性格
  tendencies: string[]       // 行動傾向
  customPrompt?: string      // 自由入力欄
}
```

### 例

```typescript
const aliceProfile: CharacterProfile = {
  name: "アリス",
  personality: "明るく社交的だが、少し心配性な面もある",
  tendencies: [
    "節約志向で安い店を選ぶ",
    "朝型で早起きが得意",
    "人と話すのが好き",
  ],
  customPrompt: `
    3年前に都会から引っ越してきた。
    毎朝コーヒーを飲まないと調子が出ない。
    NPC太郎とは幼なじみで親しい。
    水曜日は必ず図書館に行く習慣がある。
  `,
}
```

## 行動選択フロー

### 通常フロー

```
アクション完了 → アクションカウント+1
  ↓
ステータス割り込み判定（いずれかのステータス < 10%）
  ├─ YES → 緊急アクション実行（カウントは進むがシステム移動はスキップ）
  └─ NO ↓
システム自動移動判定（カウント == 5）
  ├─ YES → 3マップ以内のランダムな場所へ移動 → カウントリセット
  └─ NO ↓
システム: 状況情報を収集
  - 現在のステータス
  - 現在時刻・現在地
  - 今日のスケジュール
  - 周囲の施設・NPC
  ↓
LLM: 次の行動を決定
  ↓
システム: 選択されたアクションの詳細情報を提示
  （例: 食事可能な場所一覧）
  ↓
LLM: 具体的な内容を選択
  ↓
システム: アクション実行
```

### システム自動移動

LLMの判断とは別に、システムが定期的に移動を発動する仕組み:

- **目的**: 同じ場所に留まることを防ぎ、偶発的な出会いを創出
- **発動条件**: 5回のアクション完了ごと（カウンターベース）
- **行き先**: 3マップ以内のランダムな場所
- **緊急時**: ステータス割り込み中はスキップ（カウントは進む）

### LLMプロンプト構成

```
あなたは${character.name}です。

【性格】
${character.personality}

【行動傾向】
${character.tendencies.join('\n')}

【その他】
${character.customPrompt || 'なし'}

【直近の会話】（睡眠でクリア）
${recentConversations.map(c => `- ${c.npcName}: ${c.summary}`).join('\n') || 'なし'}

【中期記憶】
${midTermMemories.map(m => `- ${m.content}`).join('\n') || 'なし'}

【現在の状況】
- 時刻: ${time}
- 場所: ${location}
- ステータス: hunger=${hunger}, energy=${energy}, ...
- 所持金: ${money}円

【今日のスケジュール】
${schedule}

【利用可能なアクション】
${availableActions}

【周囲の施設】
${nearbyFacilities}

【周囲のNPC】
${nearbyNPCs}

次の行動を選んでください。
```

### 当日の一時状態

睡眠でクリアされるオンメモリの情報。

```typescript
interface CharacterDailyState {
  recentConversations: ConversationSummary[]  // 直近の会話
}
```

### 直近の会話

- その日の会話サマリーを保持
- 睡眠アクション実行時にクリア

### 中期記憶

- 会話中に抽出した「行動に影響する情報」
- 重要度に応じて有効期限を設定（当日〜最大3日）
- 軽量テーブルに保存
- プロンプトに含める

| 重要度 | 有効期限 | 例 |
|--------|---------|-----|
| 低 | 当日 | 「太郎と夕方に駅前で待ち合わせ」 |
| 中 | 2日 | 「花子が風邪ひいてた」 |
| 高 | 3日 | 「明後日に太郎と約束」 |

```typescript
interface MidTermMemory {
  id: string
  content: string
  importance: "low" | "medium" | "high"
  createdAt: Date
  expiresAt: Date
  sourceNpcId?: string
}
```

### LLM出力形式

```typescript
interface BehaviorDecision {
  action: string              // "eat", "move", "talk", etc.
  target?: string             // 対象（場所ID, NPC IDなど）
  reason: string              // 理由（ログ用）
  scheduleUpdate?: {          // スケジュール変更（任意）
    type: "add" | "remove" | "modify"
    entry: ScheduleEntry
  }
}
```

### 出力例

```json
{
  "action": "eat",
  "target": "restaurant_a",
  "reason": "お昼の時間だし、近くのレストランAで食べよう",
  "scheduleUpdate": null
}
```

```json
{
  "action": "move",
  "target": "home",
  "reason": "雪が強くなってきたので早めに帰宅する",
  "scheduleUpdate": {
    "type": "modify",
    "entry": { "time": "18:00", "activity": "帰宅（予定変更）" }
  }
}
```

## アクション詳細選択

アクション種別が決まった後、具体的な内容をLLMが選択。

### 食事の場合

```
LLM: action="eat"
  ↓
システム: 食事可能な場所を提示
  [
    { id: "home_kitchen", name: "自宅", cost: 300, distance: "遠い" },
    { id: "restaurant_a", name: "レストランA", cost: 800, distance: "近い" },
    { id: "restaurant_b", name: "高級レストラン", cost: 2000, distance: "中" },
  ]
  ↓
LLM: 選択
  {
    "target": "restaurant_a",
    "reason": "近いし手頃な値段だから"
  }
```

### 会話の場合

```
LLM: action="talk"
  ↓
システム: 会話可能なNPCを提示
  [
    { id: "npc_taro", name: "太郎", location: "近く", relationship: "幼なじみ" },
    { id: "npc_hanako", name: "花子", location: "少し遠い", relationship: "知人" },
  ]
  ↓
LLM: 選択 + 会話目的
  {
    "target": "npc_taro",
    "goal": "最近の様子を聞きたい",
    "reason": "久しぶりに会ったから話したい"
  }
```

## 初期実装

### スタブ実装

初期実装ではLLM呼び出しをスタブ化し、ルールベースで動作。

```typescript
interface BehaviorDecider {
  decide(
    character: SimCharacter,
    context: BehaviorContext
  ): Promise<BehaviorDecision>
}

// 初期実装: ルールベース
class StubBehaviorDecider implements BehaviorDecider {
  async decide(character, context): Promise<BehaviorDecision> {
    // スケジュールに従って行動
    // ステータス低下時は対応するアクション
    // それ以外はランダム
  }
}

// 将来実装: LLM
class LLMBehaviorDecider implements BehaviorDecider {
  async decide(character, context): Promise<BehaviorDecision> {
    // LLM呼び出し
  }
}
```
