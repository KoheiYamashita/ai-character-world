# リファクタリング分析レポート

> 作成日: 2026-01-22
> 対象: AI Character World プロジェクト全体

## エグゼクティブサマリー

| カテゴリ | 評価 | 問題数 | 重大度 |
|---------|------|--------|--------|
| コード品質 | B+ | 12 | 中 |
| 型定義 | B | 8 | 中〜高 |
| 依存関係 | B- | 5 | 高 |
| エラーハンドリング | B+ | 7 | 中 |
| 状態管理 | A- | 4 | 低〜中 |
| API設計 | C+ | 9 | 高 |
| ディレクトリ構造 | B | 6 | 中 |
| データモデル | B+ | 6 | 中 |
| **ロジック重複** | **C+** | **41** | **中〜高** |
| **抽象化機会** | **B-** | **10** | **中** |

### プロジェクト統計

- 総TypeScriptファイル数: 62
- 総コード行数: 約11,500行
- 最大ファイル行数: 1,610行（SimulationEngine.ts）
- テストカバレッジ: 0%
- ロジック重複箇所: 41箇所（推定削減可能行数: ~340行）
- 抽象化機会: 10箇所（DI、型安全性、デザインパターン等）

---

## 目次

1. [Critical - 即座対応](#1-critical---即座対応)
2. [High - 1-2週間で対応](#2-high---1-2週間で対応)
3. [Medium - 1ヶ月以内](#3-medium---1ヶ月以内)
4. [Low - 長期改善](#4-low---長期改善)
5. [副作用リスク評価](#5-副作用リスク評価)
6. [推奨実施スケジュール](#6-推奨実施スケジュール)
7. [詳細分析](#7-詳細分析)
8. [ロジック重複の詳細分析](#8-ロジック重複の詳細分析)
9. [抽象化・堅牢化の機会](#9-抽象化堅牢化の機会)

---

## 1. Critical - 即座対応

副作用リスクが低く、即座に対応可能な項目。

### 1.1 未使用コードの削除

| 対象 | ファイル | 行 | 副作用 |
|------|---------|---|--------|
| `easeInOutQuad`, `easeOutQuad` | `src/lib/movement.ts` | 15-21 | なし |
| `SimulationEvent`, `SimulationEventType` | `src/server/simulation/types.ts` | 226-232 | なし |
| `validateNPCConfig` | `src/lib/npcLoader.ts` | 50-68 | なし（定義のみ、未使用） |
| 空ディレクトリ | `src/components/providers/` | - | なし |

### 1.2 重複コードの統合

#### parseNodeIdToGridCoord（3箇所で重複）

| ファイル | 行 |
|---------|---|
| `src/lib/facilityUtils.ts` | 8 |
| `src/lib/mapLoader.ts` | 64 |
| `src/server/simulation/actions/ActionExecutor.ts` | 406 |

**推奨**: `src/lib/nodeUtils.ts` を新規作成し共通関数として統合

#### getDirection / getDirectionFromPositions（完全重複）

| ファイル | 関数名 | 行 |
|---------|--------|---|
| `src/lib/movement.ts` | `getDirection` | 23-32 |
| `src/server/simulation/CharacterSimulator.ts` | `getDirectionFromPositions` | 439-449 |

**推奨**: CharacterSimulatorで`movement.ts`の`getDirection`をimport

### 1.3 型定義の名前衝突解消

#### WorldState（クライアント/サーバーで異なる構造）

| ファイル | 用途 |
|---------|------|
| `src/types/world.ts:14-19` | クライアント用 |
| `src/server/simulation/types.ts:98-106` | サーバー用 |

**推奨**: `ClientWorldState` / `ServerWorldState` に分離

#### GridConfig（3箇所で異なる意味）

| ファイル | 用途 |
|---------|------|
| `src/types/map.ts:95-99` | JSON設定用（GridConfigJson） |
| `src/data/maps/grid.ts:4-10` | 内部処理用 |
| `src/types/config.ts:39-44` | ワールド設定用 |

**推奨**: 各用途に応じたリネーム（`GridConfigJson`, `InternalGridConfig`, `WorldGridConfig`）

---

## 2. High - 1-2週間で対応

### 2.1 循環依存の解消

```
現状の問題:
types/behavior.ts → server/simulation/types.ts (SimCharacter, SimNPC)
                  → server/simulation/actions/definitions.ts (ActionId)
hooks/useSimulationSync.ts → server/simulation/types.ts
```

**影響**:
- クライアントバンドルにサーバーコードが含まれるリスク
- 型の責任範囲が不明確

**推奨対応**:
1. `SimCharacter`, `SimNPC` を `src/types/simulation.ts` に移動
2. `ActionId` を `src/types/action.ts` に移動
3. `hooks/useSimulationSync.ts` の依存を共有型に変更

### 2.2 巨大ファイルの分割

#### SimulationEngine.ts（1,610行）

| 責務 | 推奨分割先 |
|------|-----------|
| 時刻管理・ステータス減衰 | `TimeManager.ts` |
| スケジュール管理 | `ScheduleManager.ts` |
| 永続化 | `PersistenceManager.ts` |
| コア制御 | `SimulationEngine.ts`（縮小） |

#### LLMBehaviorDecider.ts（1,058行）

| 責務 | 推奨分割先 |
|------|-----------|
| プロンプト構築（600行超） | `PromptBuilder.ts` |
| 施設選択 | `FacilitySelector.ts` |
| スケジュール更新 | `ScheduleUpdater.ts` |
| 行動決定コア | `LLMBehaviorDecider.ts`（縮小） |

#### PixiAppSync.tsx（610行）

| 責務 | 推奨分割先 |
|------|-----------|
| 描画 | `PixiRenderer.tsx` |
| アニメーション | `CharacterAnimator.tsx` |
| マップ遷移 | `MapTransitionHandler.tsx` |

### 2.3 APIセキュリティの追加

**現状の問題**:
- 認証機構なし（全エンドポイントが無認証でアクセス可能）
- 入力バリデーションなし（型アサーションのみ）
- レート制限なし

**推奨対応**:

```typescript
// 1. middleware.ts で API キー検証
export function middleware(request: NextRequest) {
  const apiKey = request.headers.get('x-api-key')
  if (!apiKey || apiKey !== process.env.API_KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
}

// 2. Zod でリクエストバリデーション
const SimulationActionSchema = z.object({
  action: z.enum(['pause', 'unpause', 'toggle', 'start', 'stop'])
})

// 3. レート制限
const limiter = rateLimit({ interval: 60000, uniqueTokenPerInterval: 500 })
```

### 2.4 エラーハンドリングの統一

| 問題箇所 | ファイル | 行 | 対応 |
|---------|---------|---|------|
| 空catchブロック | `MapPreview.tsx` | 66 | エラーログ追加 |
| リカバリなしcatch | `PixiAppSync.tsx` | 99, 228, 339 | UIエラー表示 |
| サイレントPromise | `SimulationEngine.ts` | 301, 331, 1200, 1278 | リトライロジック |

**推奨**: カスタムエラークラスの導入

```typescript
// src/lib/errors.ts
export class MapLoadError extends Error {
  constructor(public mapId: string, message: string, public cause?: Error) {
    super(message)
    this.name = 'MapLoadError'
  }
}
```

---

## 3. Medium - 1ヶ月以内

### 3.1 型継承の活用

**現状**: `SimCharacter`が`Character`の全フィールドを再定義

**推奨**:
```typescript
interface SimCharacter extends Character {
  navigation: SimNavigationState
  crossMapNavigation: SimCrossMapNavState | null
  conversation: ConversationState | null
  currentAction: ActionState | null
  // ... サーバー固有フィールドのみ
}
```

### 3.2 データベーススキーマ改善

| 問題 | 現状 | 推奨 | ファイル |
|------|------|------|---------|
| 外部キー制約なし | 孤立データリスク | CASCADE DELETE追加 | `SqliteStore.ts:119-147` |
| 型不整合 | satiety等がINTEGER | REALに修正 | `SqliteStore.ts:82-99` |
| インデックス重複 | schedules | 明示的インデックス削除 | `SqliteStore.ts:129-130` |
| personality未保存 | DBカラムなし | ALTER TABLE追加 | `SqliteStore.ts` |

### 3.3 SSE最適化

**現状**: 毎tick全状態送信（20fps × 全キャラクター）

**推奨**:
1. 差分更新の導入（変更があったキャラクターのみ送信）
2. 更新頻度削減（10tick毎にまとめる）
3. 圧縮の検討

### 3.4 Zustand Store最適化

**現状**: Map全体コピー（`new Map(state.characters)`）

**推奨**:
```typescript
// 個別セレクタの追加
const character = useCharacterStore(
  useCallback((s) => s.characters.get(characterId), [characterId])
)

// Immer middleware検討
import { immer } from 'zustand/middleware/immer'
```

### 3.5 施設タグマッピングの統合

**現状**: 2箇所で類似定義

| ファイル | 定数名 | 戻り値型 |
|---------|--------|----------|
| `SimulationEngine.ts:28-37` | `TAG_TO_ACTIONS` | `string[]` |
| `LLMBehaviorDecider.ts:17-26` | `FACILITY_TAG_TO_ACTION` | `ActionId` |

**推奨**: `src/lib/facilityMapping.ts` に統合

---

## 4. Low - 長期改善

### 4.1 ディレクトリ構造改善

```
推奨構造:
src/
├── lib/
│   ├── pixi/              # PixiJS関連
│   │   ├── renderers.ts
│   │   └── spritesheet.ts
│   ├── algorithm/         # アルゴリズム
│   │   ├── pathfinding.ts
│   │   └── movement.ts
│   └── loaders/           # データロード
│       └── dataLoaders.ts (統合)
├── server/
│   └── simulation/
│       ├── managers/      # 分割されたマネージャー
│       │   ├── TimeManager.ts
│       │   ├── ScheduleManager.ts
│       │   └── PersistenceManager.ts
│       ├── navigation/    # ナビゲーション
│       │   └── crossMapNavigation.ts
│       └── utils/         # ユーティリティ
│           └── facilityUtils.ts
```

### 4.2 テストインフラ構築

**推奨テスト対象（優先順）**:

| モジュール | 理由 | 優先度 |
|-----------|------|--------|
| `pathfinding.ts` | アルゴリズムの正確性が重要 | 高 |
| `mapLoader.ts` | バリデーションロジック複雑 | 高 |
| `SimulationEngine.ts` | コアロジック | 高 |
| `ActionExecutor.ts` | ビジネスロジック | 中 |
| `grid.ts` | 座標計算の正確性 | 中 |

**推奨ツール**:
```json
{
  "devDependencies": {
    "vitest": "^2.0.0",
    "@testing-library/react": "^15.0.0",
    "playwright": "^1.45.0"
  }
}
```

### 4.3 マイグレーションシステム

**現状**: `CREATE TABLE IF NOT EXISTS` のみ

**推奨**:
```typescript
// src/server/persistence/migrations/index.ts
interface Migration {
  version: number
  up: (db: Database) => void
  down: (db: Database) => void
}

// スキーマバージョン管理
CREATE TABLE schema_version (
  version INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL
);
```

### 4.4 ドキュメント整備

- README.md更新（現状Next.jsデフォルトテンプレート）
- API仕様書作成
- アーキテクチャ図作成

### 4.5 キャッシュ管理の統一

**問題**:
- `characterLoader.ts` にキャッシュクリア関数なし
- `mapLoader.ts` の `clearMapCache()` が `cachedMapConfigs` をクリアしない

**推奨**:
```typescript
// characterLoader.ts に追加
export function clearCharacterCache(): void {
  cachedConfigs = null
}

// mapLoader.ts を修正
export function clearMapCache(): void {
  cachedMaps = null
  cachedMapConfigs = null  // 追加
}
```

---

## 5. 副作用リスク評価

| 対応項目 | リスク | 理由 |
|---------|-------|------|
| 未使用コード削除 | ⚪ なし | 参照なし確認済み |
| 重複コード統合 | 🟡 低 | 内部実装の統合のみ |
| 型定義リネーム | 🟡 低〜中 | import文の修正が必要 |
| 循環依存解消 | 🟠 中 | 複数ファイルの修正が必要 |
| 巨大ファイル分割 | 🟠 中 | 外部APIは維持、内部リファクタのみ |
| API認証追加 | 🟡 低 | 破壊的変更なし（ヘッダー追加） |
| DBスキーマ変更 | 🔴 高 | マイグレーション必要、データ移行リスク |

---

## 6. 推奨実施スケジュール

### Week 1（Critical）
- [ ] 未使用コード削除（4箇所）
- [ ] 重複コード統合（parseNodeIdToGridCoord, getDirection）
- [ ] 空ディレクトリ削除（providers/）
- [ ] 型名衝突解消（WorldState, GridConfig）

### Week 2（High - 型・依存関係）
- [ ] 循環依存の解消（types/behavior.ts）
- [ ] SimCharacter型継承の導入
- [ ] types/index.ts のワイルドカードexport改善

### Week 3（High - セキュリティ・エラー）
- [ ] Zod導入、APIバリデーション追加
- [ ] エラーハンドリング統一
- [ ] 空catchブロック修正

### Week 4（High - 分割開始）
- [ ] SimulationEngine.ts 分割（段階的）
- [ ] LLMBehaviorDecider.ts 分割（段階的）

### Month 2以降（Medium/Low）
- [ ] PixiAppSync.tsx 分割
- [ ] SSE/Zustand最適化
- [ ] DBスキーマ改善
- [ ] テストインフラ構築
- [ ] ディレクトリ構造改善

---

## 7. 詳細分析

### 7.1 コード品質指標

| 指標 | 現状 | 目標 |
|------|------|------|
| 最大ファイル行数 | 1,610行 | <500行 |
| 50行超の関数 | 8個 | 0 |
| 100行超の関数 | 2個 | 0 |
| 循環依存 | 2箇所 | 0 |
| テストカバレッジ | 0% | >80% |
| any使用 | 0 | 0（維持） |

### 7.2 マジックナンバー一覧

| 定数 | ファイル | 行 | 説明不足 |
|------|---------|---|---------|
| `INTERRUPT_THRESHOLD = 10` | SimulationEngine.ts | 67 | 10%の根拠 |
| `SYSTEM_AUTO_MOVE_INTERVAL = 3` | SimulationEngine.ts | 69 | 3の根拠 |
| `HEAD_ICON_Y_OFFSET = 50` | PixiAppSync.tsx | 349 | 50pxの根拠 |
| `TOLERANCE = 2` | grid.ts | 165 | 許容誤差の根拠 |
| `fadeSpeed = 2.0` | PixiAppSync.tsx | 347 | 速度の根拠 |

### 7.3 JSDoc不足箇所

| ファイル | 関数/クラス |
|---------|------------|
| PixiAppSync.tsx | `updateSpriteAnimation`, `updatePathLine`, `updateNPCDirections` |
| SimulationEngine.ts | ほとんどのprivateメソッド |
| grid.ts | `generateGridNodes`, `getWallGeometry` |
| LLMBehaviorDecider.ts | `buildActionDecisionPrompt`, `getRelevantFacilities` |

### 7.4 API評価

| エンドポイント | 認証 | バリデーション | レート制限 | キャッシュ |
|---------------|------|---------------|-----------|----------|
| `/api/simulation` GET | ❌ | ❌ | ❌ | ❌ |
| `/api/simulation` POST | ❌ | ❌ | ❌ | N/A |
| `/api/simulation-stream` GET | ❌ | N/A | ❌ | ✅ |
| `/api/db` GET | ❌ | ❌ | ❌ | ❌ |
| `/api/test-error` | ❌ | ❌ | ❌ | N/A |

### 7.5 データベース評価

| 項目 | 状態 |
|------|------|
| WALモード | ✅ 有効 |
| トランザクション | ✅ 使用 |
| 外部キー制約 | ❌ なし |
| インデックス | ⚠️ 重複あり |
| 型定義 | ⚠️ 一部不整合 |
| マイグレーション | ❌ なし |

---

## 付録: ファイル別問題一覧

### src/server/simulation/SimulationEngine.ts
- 行数: 1,610（分割必要）
- マジックナンバー: 2箇所
- 循環依存の起点
- サイレントPromise: 4箇所

### src/server/behavior/LLMBehaviorDecider.ts
- 行数: 1,058（分割必要）
- buildActionDecisionPrompt: 142行
- 重複ロジック: 施設検索

### src/components/world/PixiAppSync.tsx
- 行数: 610（分割推奨）
- tickerコールバック: 138行
- マジックナンバー: 2箇所
- リカバリなしcatch: 3箇所

### src/types/behavior.ts
- 循環依存: server/simulation/types.ts
- BehaviorContext: 14フィールド（分割推奨）

### src/server/persistence/SqliteStore.ts
- 外部キー制約なし
- インデックス重複
- 型不整合（INTEGER vs REAL）

---

## 8. ロジック重複の詳細分析

関数名の重複だけでなく、類似したロジックパターンを詳細に分析した結果。

### 8.1 座標変換ロジックの重複

#### nodeId → グリッド座標のパース（3箇所）

| ファイル | 行 | 関数名 |
|---------|---|--------|
| `src/lib/facilityUtils.ts` | 8-20 | `parseNodeIdToGridCoord` |
| `src/lib/mapLoader.ts` | 64-73 | `parseNodeIdToGridCoord` |
| `src/server/simulation/actions/ActionExecutor.ts` | 406-415 | `parseNodeIdToGridCoord` |

```typescript
// 3箇所でほぼ同一のロジック
function parseNodeIdToGridCoord(nodeId: string, gridPrefix: string): { row: number; col: number } | null {
  const parts = nodeId.split('-')
  if (parts.length < 3 || parts[0] !== gridPrefix) return null
  const row = parseInt(parts[1], 10)
  const col = parseInt(parts[2], 10)
  if (isNaN(row) || isNaN(col)) return null
  return { row, col }
}
```

**推奨**: `src/lib/gridUtils.ts` を新規作成し統合

#### グリッド座標 → ピクセル座標の変換（2箇所）

| ファイル | 行 | 関数名 |
|---------|---|--------|
| `src/lib/mapLoader.ts` | 75-88 | `gridCoordToPixel` |
| `src/data/maps/grid.ts` | 46-51 | `tileToPixelPosition` |

```typescript
// mapLoader.ts
function gridCoordToPixel(coord, width, height, cols, rows) {
  const spacingX = width / (cols + 1)
  const spacingY = height / (rows + 1)
  return {
    x: Math.round(spacingX * (coord.col + 1)),
    y: Math.round(spacingY * (coord.row + 1)),
  }
}

// grid.ts（同じ計算式）
function tileToPixelPosition(row, col, spacing) {
  return {
    x: Math.round(spacing.x * (col + 1)),
    y: Math.round(spacing.y * (row + 1)),
  }
}
```

**推奨**: `grid.ts` の `tileToPixelPosition` を export して一元化

#### スペーシング計算（3箇所）

| ファイル | 行 |
|---------|---|
| `src/data/maps/grid.ts` | 39-44 |
| `src/data/maps/grid.ts` | 356-357 |
| `src/lib/mapLoader.ts` | 82-83 |

```typescript
// 同じ計算が3箇所に散在
const spacingX = width / (cols + 1)
const spacingY = height / (rows + 1)
```

**推奨**: `getGridSpacing()` 関数を export して共有

---

### 8.2 障害物フィルタリングの重複

#### タイプ別フィルタリング（4箇所以上）

| ファイル | 行 | パターン |
|---------|---|---------|
| `src/lib/facilityUtils.ts` | 41-55 | `obstacles.filter(obs => obs.type === 'zone')` |
| `src/lib/facilityUtils.ts` | 62-86 | `obstacles.filter(obs => obs.type === 'building')` |
| `src/data/maps/grid.ts` | 92-96 | `obstacles.filter(obs => obs.type === 'building')` |
| `src/data/maps/grid.ts` | 359 | `obstacles.filter(obs => obs.type === 'zone')` |
| `src/lib/mapLoader.ts` | 105 | `obstacles.filter(obs => obs.type === 'building')` |

```typescript
// 繰り返し出現するパターン
const zones = obstacles.filter((obs) => obs.type === 'zone')
const buildings = obstacles.filter((obs) => obs.type === 'building')
```

**推奨**: `src/lib/obstacleUtils.ts` に統合

```typescript
export function getObstaclesByType(obstacles: Obstacle[], type: 'zone' | 'building'): Obstacle[]
export function getZones(obstacles: Obstacle[]): Obstacle[]
export function getBuildings(obstacles: Obstacle[]): Obstacle[]
```

#### タグベース施設検索（2箇所）

| ファイル | 行 |
|---------|---|
| `src/lib/facilityUtils.ts` | 102-121 |
| `src/server/behavior/LLMBehaviorDecider.ts` | 289-321 |

```typescript
// facilityUtils.ts
export function findObstaclesWithFacilityTag(obstacles: Obstacle[], tag: FacilityTag): Obstacle[] {
  return obstacles.filter(obs => obs.facility && obs.facility.tags.includes(tag))
}

// LLMBehaviorDecider.ts（類似ロジック）
const hasRelevantTag = (tags: FacilityTag[]) => tags.some(tag => relevantTags.includes(tag))
```

**推奨**: `facilityUtils.ts` の関数を LLMBehaviorDecider で再利用

---

### 8.3 状態チェックの重複

#### キャラクター状態判定（複数箇所）

| ファイル | 行 | チェック内容 |
|---------|---|-------------|
| `SimulationEngine.ts` | 433-437 | `isCharacterIdle` |
| `CharacterSimulator.ts` | 68-72 | `isCharacterNavigating` |
| `CharacterSimulator.ts` | 89-91 | idle + no conversation |
| `SimulationEngine.ts` | 464-465 | idle + no pending |

```typescript
// SimulationEngine.ts
private isCharacterIdle(character: SimCharacter): boolean {
  return !character.currentAction &&
         !character.conversation?.isActive &&
         !character.navigation.isMoving
}

// CharacterSimulator.ts
if (character && !character.currentAction && !character.conversation?.isActive) {
  // 同じ条件の繰り返し
}
```

**推奨**: `src/server/simulation/characterState.ts` を新規作成

```typescript
export function isCharacterIdle(character: SimCharacter): boolean
export function isCharacterNavigating(character: SimCharacter): boolean
export function canStartNewAction(character: SimCharacter): boolean
```

---

### 8.4 存在チェックの重複

#### キャラクター/マップ取得後のnullチェック（6箇所以上）

| ファイル | 行 |
|---------|---|
| `SimulationEngine.ts` | 441-442 |
| `SimulationEngine.ts` | 462-463 |
| `SimulationEngine.ts` | 567-568 |
| `CharacterSimulator.ts` | 219-220 |
| `CharacterSimulator.ts` | 245-246 |
| `ActionExecutor.ts` | 456-459 |

```typescript
// 繰り返し出現するパターン
const character = this.worldState.getCharacter(characterId)
if (!character) return

const character = this.worldState.getCharacter(characterId)
if (!character) return false

const character = this.worldState.getCharacter(characterId)
if (!character) {
  return { canExecute: false, reason: 'Character not found' }
}
```

**推奨**: `WorldStateManager` にヘルパーメソッドを追加

```typescript
getCharacterOrThrow(id: string): SimCharacter
withCharacter<T>(id: string, callback: (char: SimCharacter) => T, fallback?: T): T | undefined
```

---

### 8.5 全キャラクターイテレーションの重複

#### 同一パターンのループ（5箇所以上）

| ファイル | 行 | 目的 |
|---------|---|------|
| `SimulationEngine.ts` | 399-427 | ステータス更新 |
| `SimulationEngine.ts` | 476-486 | 行動決定 |
| `SimulationEngine.ts` | 731-767 | ペンディングアクション処理 |
| `ActionExecutor.ts` | 63-69 | アクション更新 |
| `CharacterSimulator.ts` | 36-65 | キャラクター更新 |

```typescript
// 繰り返し出現するパターン
const characters = this.worldState.getAllCharacters()
for (const character of characters) {
  if (someCondition(character)) continue
  // 処理
}
```

**推奨**: 高階関数で抽象化

```typescript
// WorldStateManager に追加
forEachCharacter(callback: (character: SimCharacter) => void): void
forEachIdleCharacter(callback: (character: SimCharacter) => void): void
filterCharacters(predicate: (character: SimCharacter) => boolean): SimCharacter[]
```

---

### 8.6 時刻処理の重複

#### 時刻フォーマット（3箇所）

| ファイル | 行 | パターン |
|---------|---|---------|
| `SimulationEngine.ts` | 1247 | `${hour}:${minute.padStart(2, '0')}` |
| `LLMBehaviorDecider.ts` | 556 | `${hour}:${minute.padStart(2, '0')}` |
| `LLMBehaviorDecider.ts` | 843-845 | 時刻文字列のパース |

```typescript
// フォーマット
const timeStr = `${String(currentTime.hour).padStart(2, '0')}:${String(currentTime.minute).padStart(2, '0')}`

// パース
const timeParts = entry.time.split(':')
const h = parseInt(timeParts[0], 10)
const m = parseInt(timeParts[1], 10)
```

**推奨**: `src/lib/timeUtils.ts` を新規作成

```typescript
export function formatTime(time: WorldTime): string
export function parseTimeString(timeStr: string): { hour: number; minute: number } | null
export function timeToMinutes(time: WorldTime): number
export function compareTime(a: WorldTime, b: WorldTime): number
```

---

### 8.7 設定値取得パターンの重複

#### isConfigLoaded + getConfig パターン（4箇所）

| ファイル | 行 | 取得内容 |
|---------|---|---------|
| `src/data/maps/grid.ts` | 299-310 | グリッドデフォルト |
| `src/lib/movement.ts` | 41-48 | 移動速度 |
| `src/lib/mapLoader.ts` | 136 | マップパス |
| `src/lib/characterLoader.ts` | 13 | キャラクターパス |

```typescript
// 繰り返し出現するパターン
export function getGridDefaults(): GridDefaults {
  if (isConfigLoaded()) {
    const config = getConfig()
    return {
      cols: config.grid.defaultCols,
      // ...
    }
  }
  return FALLBACK_DEFAULTS
}

export function getMovementSpeed(): number {
  if (isConfigLoaded()) {
    return getConfig().movement.speed
  }
  return DEFAULT_MOVEMENT_SPEED
}
```

**推奨**: `worldConfigLoader.ts` に汎用ゲッターを追加

```typescript
export function getConfigValue<T>(getter: (config: WorldConfig) => T, fallback: T): T {
  if (isConfigLoaded()) {
    return getter(getConfig())
  }
  return fallback
}

// 使用例
export const getMovementSpeed = () => getConfigValue(c => c.movement.speed, DEFAULT_SPEED)
```

---

### 8.8 施設情報構築の重複

#### 施設オブジェクト生成（2箇所）

| ファイル | 行 |
|---------|---|
| `LLMBehaviorDecider.ts` | 289-321 |
| `SimulationEngine.ts` | 1024-1046 |

```typescript
// LLMBehaviorDecider.ts
results.push({
  id: f.id,
  label: f.label,
  tags: f.tags,
  cost: f.cost,
  distance: 0,
  mapId: context.character.currentMapId,
  availableActions: f.availableActions,
})

// SimulationEngine.ts
facilities.push({
  id: obstacle.id,
  label: obstacle.label || obstacle.id,
  tags: obstacle.facility.tags,
  cost: obstacle.facility.cost,
  availableActions,
})
```

**推奨**: `src/lib/facilityBuilder.ts` を新規作成

```typescript
export function buildFacilityInfo(
  obstacle: Obstacle,
  mapId: string,
  distance: number,
  availableActions?: string[]
): NearbyFacility
```

---

### 8.9 スケジュール操作の重複

#### スケジュール変換・更新（2箇所）

| ファイル | 行 | 操作 |
|---------|---|------|
| `LLMBehaviorDecider.ts` | 449-462 | LLM応答 → 内部形式変換 |
| `SimulationEngine.ts` | 1143-1189 | スケジュール配列の更新 |

**推奨**: `src/lib/scheduleUtils.ts` を新規作成

```typescript
export function convertScheduleUpdate(update: LLMScheduleUpdate): ScheduleUpdate | undefined
export function applyScheduleUpdate(entries: ScheduleEntry[], update: ScheduleUpdate): ScheduleEntry[]
export function sortScheduleEntries(entries: ScheduleEntry[]): ScheduleEntry[]
```

---

### 8.10 推奨される共通化ファイル一覧

| 新規ファイル | 統合対象 | 優先度 |
|-------------|---------|--------|
| `src/lib/gridUtils.ts` | 座標変換・パース・スペーシング | 高 |
| `src/lib/obstacleUtils.ts` | 障害物フィルタリング・タイプ判定 | 高 |
| `src/lib/timeUtils.ts` | 時刻フォーマット・パース・比較 | 中 |
| `src/lib/facilityBuilder.ts` | 施設情報オブジェクト生成 | 中 |
| `src/lib/scheduleUtils.ts` | スケジュール変換・操作 | 中 |
| `src/server/simulation/characterState.ts` | 状態チェック関数 | 高 |

---

### 8.11 ロジック重複の統計

| カテゴリ | 重複箇所数 | 推定削減行数 |
|---------|-----------|-------------|
| 座標変換 | 8 | ~80行 |
| 障害物フィルタリング | 6 | ~50行 |
| 状態チェック | 5 | ~30行 |
| 存在確認 | 6 | ~20行 |
| イテレーション | 5 | ~40行 |
| 時刻処理 | 3 | ~20行 |
| 設定値取得 | 4 | ~30行 |
| 施設構築 | 2 | ~30行 |
| スケジュール操作 | 2 | ~40行 |
| **合計** | **41** | **~340行** |

---

## 9. 抽象化・堅牢化の機会

コードの保守性、テスタビリティ、拡張性を向上させる抽象化の機会。

### 9.1 インターフェース/抽象クラスの導入

#### StateStore抽象化の改善

**ファイル**: `src/server/persistence/StateStore.ts`

**現状**: インターフェースは存在するが実装は`SqliteStore`のみ

**推奨**:
```typescript
// 基底クラスで共通処理を実装
abstract class BaseStateStore implements StateStore {
  protected abstract doSaveState(state: SerializedWorldState): Promise<void>
  protected abstract doLoadState(): Promise<SerializedWorldState | null>

  async saveState(state: SerializedWorldState): Promise<void> {
    try {
      await this.doSaveState(state)
    } catch (error) {
      throw new StateStoreError('Save failed', error)
    }
  }
}

// テスト用MemoryStore
class MemoryStore extends BaseStateStore { /* ... */ }
```

**効果**: テスト容易性向上、エラーハンドリング統一

---

#### BehaviorDecider戦略パターン

**ファイル**: `src/server/behavior/LLMBehaviorDecider.ts`

**現状**: LLMBehaviorDeciderが唯一の実装

**推奨**:
```typescript
interface DecisionStrategy {
  canHandle(context: BehaviorContext): boolean
  decide(context: BehaviorContext): Promise<BehaviorDecision>
  priority: number
}

abstract class BaseBehaviorDecider implements BehaviorDecider {
  protected strategies: DecisionStrategy[] = []

  addStrategy(strategy: DecisionStrategy): this {
    this.strategies.push(strategy)
    this.strategies.sort((a, b) => b.priority - a.priority)
    return this
  }

  async decide(context: BehaviorContext): Promise<BehaviorDecision> {
    for (const strategy of this.strategies) {
      if (strategy.canHandle(context)) {
        return await strategy.decide(context)
      }
    }
    return this.defaultDecision(context)
  }
}

// ルールベース実装（フォールバック用）
class RuleBasedDecider extends BaseBehaviorDecider {
  constructor() {
    super()
    this.addStrategy(new StatusInterruptStrategy())
    this.addStrategy(new ScheduleBasedStrategy())
    this.addStrategy(new IdleStrategy())
  }
}
```

**効果**: 複数決定ロジックの組み合わせ、LLMエラー時のフォールバック

---

#### ActionHandler抽象化

**ファイル**: `src/server/simulation/actions/ActionExecutor.ts`

**現状**: アクション定義と実行が密結合

**推奨**:
```typescript
interface ActionHandler {
  canExecute(context: ActionContext): ExecutionResult
  execute(context: ActionContext): Promise<ActionResult>
  onComplete(context: ActionContext, result: ActionResult): void
}

class ActionExecutor {
  private handlers = new Map<ActionId, ActionHandler>()

  registerHandler(actionId: ActionId, handler: ActionHandler): void {
    this.handlers.set(actionId, handler)
  }
}

// 具体的なハンドラー
class EatActionHandler implements ActionHandler {
  canExecute(context: ActionContext): ExecutionResult { /* ... */ }
  execute(context: ActionContext): Promise<ActionResult> { /* ... */ }
  onComplete(context: ActionContext, result: ActionResult): void { /* ... */ }
}
```

**効果**: 新アクション追加容易、各アクションのテスト独立、SRP遵守

---

### 9.2 ジェネリクスによる汎用化

#### ストアのCRUD操作

**ファイル**: `src/server/persistence/SqliteStore.ts`

**現状**: 各エンティティごとに同じパターンのCRUDメソッド

**推奨**:
```typescript
abstract class GenericStore<TEntity, TKey> {
  abstract tableName: string
  abstract serialize(entity: TEntity): Record<string, unknown>
  abstract deserialize(row: Record<string, unknown>): TEntity
  abstract getKey(entity: TEntity): TKey

  async save(entity: TEntity): Promise<void> {
    const row = this.serialize(entity)
    const key = this.getKey(entity)
    await this.db.upsert(this.tableName, key, row)
  }

  async load(key: TKey): Promise<TEntity | null> {
    const row = await this.db.query(this.tableName, key)
    return row ? this.deserialize(row) : null
  }
}

class CharacterStore extends GenericStore<SimCharacter, string> {
  tableName = 'character_states'
  // ...
}
```

**効果**: コード重複削減、新エンティティ追加容易、型安全性向上

---

#### ジェネリックバリデーター

**ファイル**: `src/lib/mapLoader.ts`

**推奨**:
```typescript
interface ValidationRule<T> {
  name: string
  validate(value: T): ValidationResult
}

class Validator<T> {
  private rules: ValidationRule<T>[] = []

  addRule(rule: ValidationRule<T>): this {
    this.rules.push(rule)
    return this
  }

  validate(values: T[]): ValidationReport {
    const errors: ValidationError[] = []
    for (const value of values) {
      for (const rule of this.rules) {
        const result = rule.validate(value)
        if (!result.isValid) {
          errors.push({ rule: rule.name, value, message: result.message })
        }
      }
    }
    return { isValid: errors.length === 0, errors }
  }
}

// 使用例
const obstacleValidator = new Validator<ObstacleConfigJson>()
  .addRule(new RequiredFieldsRule(['row', 'col', 'tileWidth', 'tileHeight']))
  .addRule(new MinSizeRule({ building: 2, zone: 4 }))
```

**効果**: バリデーションルール再利用、エラーメッセージ統一

---

### 9.3 型安全性の向上

#### Branded型（IDの種類区別）

**ファイル**: `src/types/character.ts`, `src/types/map.ts`

**現状**: すべてのIDが`string`型で区別されない

**推奨**:
```typescript
type Brand<K, T> = K & { __brand: T }

type CharacterId = Brand<string, 'CharacterId'>
type MapId = Brand<string, 'MapId'>
type NodeId = Brand<string, 'NodeId'>
type NPCId = Brand<string, 'NPCId'>

// ヘルパー関数
function createCharacterId(id: string): CharacterId {
  return id as CharacterId
}

// 使用例 - これはコンパイルエラーになる
interface Character {
  id: CharacterId
  currentMapId: MapId
  currentNodeId: NodeId
}

const char: Character = {
  id: 'char-1',  // Error: string is not assignable to CharacterId
}
```

**効果**: IDの種類間違いをコンパイル時に検出、リファクタリング安全性向上

---

#### Discriminated Union型

**ファイル**: `src/types/behavior.ts`

**現状**:
```typescript
interface BehaviorDecision {
  type: 'action' | 'move' | 'idle'
  actionId?: ActionId      // typeによって必要性が異なる
  targetNodeId?: string    // オプショナルだらけ
  targetMapId?: string
}
```

**推奨**:
```typescript
type ActionDecision = {
  type: 'action'
  actionId: ActionId  // 必須
  targetFacilityId?: string
  reason?: string
}

type MoveDecision = {
  type: 'move'
  targetMapId: string  // 必須
  targetNodeId?: string
  reason?: string
}

type IdleDecision = {
  type: 'idle'
  reason: string  // 必須
}

export type BehaviorDecision = ActionDecision | MoveDecision | IdleDecision

// 使用例（型ガードが自動で効く）
function handleDecision(decision: BehaviorDecision) {
  switch (decision.type) {
    case 'action':
      console.log(decision.actionId)  // 確実に存在
      break
    case 'move':
      console.log(decision.targetMapId)  // 確実に存在
      break
    case 'idle':
      console.log(decision.reason)  // 確実に存在
      break
  }
}
```

**効果**: 型安全性大幅向上、実行時エラー削減、IDE補完向上

---

### 9.4 依存性注入（DI）

#### SimulationEngineのDI

**ファイル**: `src/server/simulation/SimulationEngine.ts:78-102`

**現状**:
```typescript
constructor(config, stateStore?) {
  this.behaviorDecider = new LLMBehaviorDecider()  // ハードコード
}
```

**推奨**:
```typescript
interface SimulationDependencies {
  worldState: WorldStateManager
  characterSimulator: CharacterSimulator
  actionExecutor: ActionExecutor
  behaviorDecider: BehaviorDecider  // インターフェース
  stateStore: StateStore
}

class SimulationEngine {
  constructor(
    private config: SimulationConfig,
    private deps: SimulationDependencies
  ) {}
}

// ファクトリー関数
function createSimulationEngine(
  config?: Partial<SimulationConfig>,
  overrides?: Partial<SimulationDependencies>
): SimulationEngine {
  const worldState = overrides?.worldState ?? new WorldStateManager()

  const deps: SimulationDependencies = {
    worldState,
    behaviorDecider: overrides?.behaviorDecider ?? new LLMBehaviorDecider(),
    stateStore: overrides?.stateStore ?? new SqliteStore(),
    // ...
  }

  return new SimulationEngine({ ...DEFAULT_CONFIG, ...config }, deps)
}

// テスト用
const engine = createSimulationEngine({}, {
  behaviorDecider: new MockBehaviorDecider(),
  stateStore: new MemoryStore(),
})
```

**効果**: テスト容易、実装切り替え簡単、依存関係明示的

---

#### LLMクライアントのDI

**ファイル**: `src/server/llm/client.ts`

**現状**: グローバル変数に依存

```typescript
let model: LanguageModel | null = null  // グローバル変数
```

**推奨**:
```typescript
interface LLMProvider {
  generateText(prompt: string, options?: GenerateOptions): Promise<string>
  generateObject<T>(prompt: string, schema: z.Schema<T>): Promise<T>
}

class LLMClient {
  constructor(private provider: LLMProvider, private errorHandler: ErrorHandler) {}

  async generateText(prompt: string, options?: GenerateOptions): Promise<string> {
    try {
      const result = await this.provider.generateText(prompt, options)
      this.errorHandler.resetFailureCount()
      return result
    } catch (error) {
      await this.errorHandler.handleError(error)
      throw error
    }
  }
}

// 使用例（DI）
class LLMBehaviorDecider implements BehaviorDecider {
  constructor(private llmClient: LLMClient) {}
}
```

**効果**: グローバル状態排除、テスト並列実行可能、モック容易

---

### 9.5 Result型/Option型の導入

#### エラーハンドリングの統一

**現状**: 例外、null/undefined、空配列が混在

**推奨**:
```typescript
// Result型
type Result<T, E = Error> =
  | { ok: true; value: T }
  | { ok: false; error: E }

function ok<T>(value: T): Result<T, never> {
  return { ok: true, value }
}

function err<E>(error: E): Result<never, E> {
  return { ok: false, error }
}

// 型安全なエラー定義
type ActionExecutionError =
  | { type: 'character_not_found'; characterId: string }
  | { type: 'already_executing'; currentAction: ActionId }
  | { type: 'insufficient_funds'; required: number; available: number }

function canExecuteAction(
  characterId: string,
  actionId: ActionId
): Result<void, ActionExecutionError> {
  const character = this.worldState.getCharacter(characterId)
  if (!character) {
    return err({ type: 'character_not_found', characterId })
  }

  if (character.currentAction) {
    return err({ type: 'already_executing', currentAction: character.currentAction.actionId })
  }

  return ok(undefined)
}

// 使用例
const result = canExecuteAction('char-1', 'eat')
if (!result.ok) {
  switch (result.error.type) {
    case 'character_not_found':
      console.log(`Character ${result.error.characterId} not found`)
      break
    case 'insufficient_funds':
      console.log(`Need ${result.error.required}, have ${result.error.available}`)
      break
  }
}
```

**効果**: エラーハンドリング統一、型安全なエラー処理、エラー理由明確化

---

### 9.6 不変性の強化

#### Readonly型の活用

**推奨**:
```typescript
interface SimCharacter {
  readonly id: string
  readonly name: string
  readonly sprite: Readonly<SpriteConfig>
  money: number  // 変更可能
  satiety: number
  position: Readonly<Position>  // 置き換えのみ
}

// Deep Readonly
type DeepReadonly<T> = {
  readonly [P in keyof T]: T[P] extends object ? DeepReadonly<T[P]> : T[P]
}

// Immerによる不変更新
import { produce } from 'immer'

function updateCharacter(character: SimCharacter, updates: Partial<SimCharacter>): SimCharacter {
  return produce(character, draft => {
    Object.assign(draft, updates)
  })
}
```

**効果**: 意図しない変更防止、バグ早期発見、リファクタリング安全性

---

### 9.7 イベントシステムの型安全化

**現状**: 単一のイベントタイプのみ

**推奨**:
```typescript
type EventMap = {
  'state:change': SerializedWorldState
  'character:move': { characterId: string; position: Position }
  'action:start': { characterId: string; actionId: ActionId }
  'action:complete': { characterId: string; actionId: ActionId }
  'error': Error
}

class EventEmitter<TEvents extends Record<string, unknown>> {
  private listeners = new Map<keyof TEvents, Set<(data: unknown) => void>>()

  on<K extends keyof TEvents>(event: K, handler: (data: TEvents[K]) => void): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set())
    }
    this.listeners.get(event)!.add(handler as (data: unknown) => void)
    return () => this.off(event, handler)
  }

  emit<K extends keyof TEvents>(event: K, data: TEvents[K]): void {
    const handlers = this.listeners.get(event)
    if (!handlers) return
    for (const handler of handlers) {
      try {
        handler(data)
      } catch (error) {
        this.emit('error' as K, error as TEvents[K])
      }
    }
  }
}
```

**効果**: 型安全なイベント処理、詳細なイベント種類、エラーハンドリング改善

---

### 9.8 Zodスキーマと型の統合

**ファイル**: `src/lib/mapLoader.ts`, `src/lib/characterLoader.ts`

**推奨**:
```typescript
import { z } from 'zod'

// スキーマから型を生成
const ObstacleConfigSchema = z.object({
  id: z.string().optional(),
  row: z.number(),
  col: z.number(),
  tileWidth: z.number().min(2, 'Minimum width is 2'),
  tileHeight: z.number().min(2, 'Minimum height is 2'),
  label: z.string().optional(),
  type: z.enum(['building', 'zone']).default('building'),
}).refine(
  data => {
    if (data.type === 'zone') {
      return data.tileWidth >= 4 && data.tileHeight >= 4
    }
    return true
  },
  { message: 'Zone minimum size is 4x4' }
)

type ObstacleConfig = z.infer<typeof ObstacleConfigSchema>

// 使用
function loadObstacles(data: unknown): ObstacleConfig[] {
  return z.array(ObstacleConfigSchema).parse(data)
}
```

**効果**: バリデーションと型の同期、詳細なエラーメッセージ、型安全性向上

---

### 9.9 抽象化の優先度一覧

| 対応項目 | 優先度 | 効果 | 工数 |
|---------|-------|------|------|
| Discriminated Union型 | 高 | 型安全性大幅向上 | 低 |
| 依存性注入（SimulationEngine） | 高 | テスタビリティ向上 | 中 |
| Branded型（ID区別） | 高 | バグ防止 | 低 |
| Result型導入 | 高 | エラー処理統一 | 中 |
| BehaviorDecider戦略パターン | 中 | 拡張性向上 | 中 |
| ActionHandler抽象化 | 中 | 新アクション追加容易 | 高 |
| ジェネリックCRUD | 中 | コード重複削減 | 中 |
| 型安全イベントシステム | 中 | イベント処理改善 | 中 |
| Zodスキーマ統合 | 低 | バリデーション統一 | 中 |
| 不変性強化（Immer） | 低 | 副作用削減 | 低 |

---

### 9.10 抽象化による期待効果

| 指標 | 現状 | 抽象化後（推定） |
|------|------|-----------------|
| テストカバレッジ | 0% | >80%可能 |
| 型エラーでの検出率 | ~60% | >95% |
| 新アクション追加工数 | 高 | 低 |
| 新ストレージ追加工数 | 高 | 低 |
| LLMフォールバック | なし | 自動 |
| リファクタリング安全性 | 低 | 高 |

---

## 変更履歴

| 日付 | 内容 |
|------|------|
| 2026-01-22 | 初版作成 |
| 2026-01-22 | ロジック重複の詳細分析を追加 |
| 2026-01-22 | 抽象化・堅牢化の機会を追加 |
