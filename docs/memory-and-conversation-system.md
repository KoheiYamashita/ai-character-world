# キャラクター記憶 & NPC会話システム設計

## 概要

キャラクターに長期記憶を持たせ、NPCとの自然な会話を実現するためのシステム設計。

## 1. 記憶システム構成

### キャラクター側

#### Graphiti (Neo4j)

- **用途**: 長期記憶、時系列、関係性の推論
- **分離方法**: `group_id`をキャラクターIDとして使用
- **エピソードAPI**: 会話サマリーを登録、ファクトを抽出

```python
await graphiti.add_episode(
    name="NPC1との会話",
    episode_body="サマリーテキスト",
    source_description="npc_1",
    reference_time=datetime.now(),
    source=EpisodeType.message,
    group_id="character_alice",
)
```

#### 軽量テーブル (サマリー用)

- **用途**: NPC別の直近会話サマリーを保存
- **理由**: Graphitiは`source_description`でフィルタ不可
- **カラム**: `npc_id`, `summary`, `timestamp`

### NPC側

#### NPC配置

- **配置方式**: 固定位置（maps.jsonの`spawnNodeId`で指定）
- **移動**: NPCは移動しない（指定ノードに固定）
- **パス探索への影響**: NPCが占有するノードはキャラクターの移動経路から除外

#### NPC.facts

- **用途**: NPCが一貫した振る舞いをするため
- **例**: `["既婚者", "子供2人", "料理が趣味"]`
- **使用タイミング**: 会話生成プロンプトに含める

#### その他ステータス

| フィールド | 型 | 説明 |
|-----------|-----|------|
| affinity | number | 好感度 |
| mood | string | 気分 |
| conversationCount | number | 会話回数 |
| lastConversation | Date | 最終会話時刻 |

## 2. データの二重管理（意図的）

| データ | NPC.facts | Graphiti |
|--------|-----------|----------|
| 目的 | NPCの一貫性担保 | キャラクターの記憶 |
| 例 | 「既婚者」 | 「NPC1が既婚者と言っていた」 |
| 用途 | NPC発話生成時 | 次回会話時の文脈 |

NPCのマスターデータとキャラクターの記憶は別物として管理する。

## 3. 会話システム

### 構成

2本のLLMを交互に動作させる:

```
┌──────────────────┐              ┌──────────────────┐
│ キャラクターLLM   │  ←──会話──→  │    NPC LLM       │
│                  │              │                  │
│ - 人格設定        │              │ - NPC設定        │
│ - Graphiti記憶   │              │ - NPC.facts      │
│ - 会話の目的     │              │ - mood/affinity  │
└──────────────────┘              └──────────────────┘
```

### 会話フロー

1. **会話開始**: キャラクターが「話したい」と判断し、目的を生成
2. **会話ループ**: 2本のLLMが交互に発話
3. **終了条件**: 目的達成 or ターン上限
4. **会話終了時の処理**:
   - サマリー生成 → 軽量テーブルに保存
   - エピソード → Graphitiに登録
   - facts抽出 → NPC.facts & Graphiti両方に反映

### 目的達成の判断

```typescript
const response = await characterLLM.generate({
  schema: z.object({
    utterance: z.string(),
    goalAchieved: z.boolean(),
    wantsToEndConversation: z.boolean(),
  }),
  prompt: `
    目的: ${goal}
    会話履歴: ${history}
    次の発話と、目的達成状況を判断してください
  `
});
```

### 会話終了時のデータ抽出

```typescript
const extracted = await llm.parse({
  schema: z.object({
    affinity: z.number().min(-100).max(100),
    learnedFacts: z.array(z.string()),
    mood: z.enum(["happy", "neutral", "angry"]),
    topicsDiscussed: z.array(z.string()),
  }),
  prompt: `会話から以下を抽出: ${conversationLog}`
});
```

## 4. 会話開始時のプロンプト構成

```
┌─────────────────────────────────────────────┐
│ NPC会話開始時のプロンプト構成               │
├─────────────────────────────────────────────┤
│ 1. 前回の会話サマリー (軽量テーブルから)    │
│ 2. 経過時間 (世界内時間から計算)          │
│ 3. NPCに関するファクト (Graphiti検索)       │
│    - 「NPC1について覚えていること」          │
│    - 関係性、過去の出来事など               │
└─────────────────────────────────────────────┘
```

## 5. 会話の詳細設定

### ターン上限

- **10ターン**を上限とする
- 目的達成 or ターン上限で会話終了

### 会話の目的

LLMがtalkアクションを選択時に目的も生成。
ガイドラインをプロンプトに含めて発散を防ぐ。

```typescript
interface ConversationGoal {
  goal: string           // "最近の様子を聞きたい"
  successCriteria: string // "近況を1つ以上聞けたら達成"
}
```

**目的生成のガイドライン（プロンプトに含める）:**
- 1つの会話で達成可能な範囲に絞る
- 具体的な情報収集 or 関係性の構築
- 例: 「挨拶する」「近況を聞く」「相談する」「お礼を言う」

### NPCプロファイル

キャラクターと同様の構造 + facts。

```typescript
interface NPCProfile {
  id: string
  name: string
  personality: string        // 性格
  tendencies: string[]       // 行動傾向
  customPrompt?: string      // 自由入力欄
  facts: string[]            // 判明している事実
}
```

### NPC例

```typescript
const taroProfile: NPCProfile = {
  id: "npc_taro",
  name: "太郎",
  personality: "穏やかで親切、話好き",
  tendencies: [
    "困っている人を見ると声をかける",
    "地元の話題に詳しい",
  ],
  customPrompt: `
    この町で30年暮らしている。
    妻と子供2人がいる。
    レストランの常連客。
  `,
  facts: ["既婚者", "子供2人", "地元民"],
}
```

## 6. キャラクター行動プロンプトへの追加

行動決定時のプロンプトに以下を追加:

```
【直近の会話】（睡眠でクリア）
${recentConversations.map(c => `- ${c.npcName}: ${c.summary}`).join('\n')}

【中期記憶】
${midTermMemories.map(m => `- ${m.content}`).join('\n')}
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

## 7. 実装順序

1. **アクションシステム** ← ステータス・施設・アクション定義
2. **LLM行動決定システム** ← スケジュール・行動選択
3. **会話システム** ← 2者間LLM会話
4. **記憶システム（Graphiti）統合**
