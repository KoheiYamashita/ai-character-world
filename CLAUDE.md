# AI Agent World

## 概要
キャラクターエージェントが行動できる仮想世界をシミュレートし、エージェントの記憶・経験を蓄積していくシステム。

### 目的
- AIエージェントが自律的に行動できる2D仮想世界の提供
- エージェントの行動履歴・経験の記録と記憶の形成
- エージェント同士やNPCとのインタラクションを通じた経験の蓄積

### 技術的実現
- 2Dマップ上でキャラクターがノードに沿って移動するシミュレーション基盤
- サーバーサイドでのシミュレーション実行とSSEによるクライアント同期

## 技術スタック
- Next.js 15 (App Router) + TypeScript
- PixiJS 8 (直接API使用、@pixi/react不使用)
- Zustand 5 (状態管理)
- shadcn/ui + Tailwind CSS 4

## アーキテクチャ

### ノードベースのパス探索
- マップはグリッド状のノード（12x9グリッド、障害物内は除外）で構成
- ノード間は8方向（上下左右+斜め）で接続
- BFSで最短経路を計算
- 障害物領域内のノードは生成時にスキップ

### 障害物システム
- 各マップに`obstacles`配列で定義（タイルベース座標: `row`, `col`, `tileWidth`, `tileHeight`）
- `mapLoader.ts`がタイル座標→ピクセル座標に変換
- 2種類の障害物タイプ: `building`（デフォルト）と `zone`

#### Building型（通過不可オブジェクト）
- 家具、カウンターなど物理的な障害物
- 内部ノードは生成されず、キャラクターは通過不可
- 描画: 黄色枠線 + 内部にラベル表示
- 最小サイズ: 2x2タイル

#### Zone型（部屋エリア）
- 寝室、キッチンなど壁で囲まれた空間
- 内部にノードが生成され、キャラクターは移動可能
- `wallSides`: 壁のある辺（`top`, `bottom`, `left`, `right`の配列）
- `door`: 扉の位置（壁があっても通過可能な開口部）
  - `side`: 扉がある壁の辺
  - `start`: 壁終端位置（0-indexed、壁の最初のノード=0）
  - `end`: 壁終端位置
  - 開口部は`start < offset < end`の範囲（両端は壁）
- 描画: グレー実線で壁、扉の位置は開口部
- 最小サイズ: 4x4タイル
- 壁上のノードは生成されない（扉位置を除く）
- 壁を横切る斜め接続は自動的に切断（扉の位置を除く）

```json
// Zone型の例: start=2, end=4 → offset 0,1,2は壁、offset 3が開口部、offset 4以降は壁
{
  "row": 0, "col": 0, "tileWidth": 4, "tileHeight": 4,
  "label": "寝室",
  "type": "zone",
  "wallSides": ["top", "left", "bottom", "right"],
  "door": { "side": "right", "start": 2, "end": 4 }
}
```

- バリデーション:
  - 必須フィールドチェック（row, col, tileWidth, tileHeight）
  - タイプ別最小サイズチェック（building: 2x2、zone: 4x4）
  - ラベル-障害物衝突チェック（building型のみ）
  - zone: wallSidesとdoorの整合性チェック

### 入口システム
- 各マップに`entrances`配列で定義（タイルベース座標: `row`, `col`）
- グリッド範囲外の値も許容（マップ端に配置する場合: row=-1, col=12等）
- `connectedNodeIds`で接続するグリッドノードを指定

### 経路表示
- 移動開始時に目的地までのルートを白線で描画
- 移動完了時に自動で消去
- `pathLineRef`で管理、`drawPathLine`/`clearPathLine`で操作

### ノードタイプ
- `waypoint` - 通常の移動可能ポイント（青）
- `spawn` - スポーン地点（緑）
- `entrance` - マップ遷移ポイント（赤）

### マップ遷移
- entranceノードに到達 → フェードアウト → 別マップのentranceに出現 → フェードイン
- `leadsTo: { mapId, nodeId }` で遷移先を定義
- フェードアニメーションは`setInterval`で実装、`fadeOutIntervalRef`/`fadeInIntervalRef`で管理
- unmount時や新規遷移開始時に`clearTransitionIntervals()`でクリーンアップ

### 状態管理 (Zustand)
- `worldStore` - 現在マップ、時間、遷移状態
- `characterStore` - キャラクター情報（位置、空腹、所持金）
- `npcStore` - NPC情報

### スプライトシステム
- 行ベースのスプライトシート（3列×4行、各方向3フレーム）
- 行構成: Row0=下、Row1=左、Row2=右、Row3=上
- アニメーション: [0,1,2,1]ループ、停止時はフレーム1
- キャラクター設定は`public/data/characters.json`で管理（正本）
- `src/data/characters/index.ts`はZustand初期状態用の同期フォールバック
- PixiJS `AnimatedSprite`で描画、方向変更時にテクスチャ切替

## ディレクトリ構成
```
src/
├── app/                    # Next.js App Router
├── components/
│   ├── world/             # PixiJS関連
│   │   ├── WorldCanvas.tsx # dynamic importラッパー
│   │   └── PixiAppSync.tsx # SSE同期・描画（サーバーモード）
│   ├── panels/            # UIパネル
│   └── ui/                # shadcn/ui
├── stores/                # Zustand stores
├── data/
│   ├── maps/              # マップ定義（grid.tsで共通生成）
│   └── characters/        # デフォルトキャラクター定義
├── lib/                   # ユーティリティ
│   ├── pathfinding.ts     # BFSパス探索
│   ├── movement.ts        # 補間・方向計算
│   ├── spritesheet.ts     # スプライトシート読み込み・テクスチャ生成
│   ├── characterLoader.ts # JSON設定からキャラクター生成
│   ├── mapLoader.ts       # マップJSON読み込み・障害物バリデーション
│   └── worldConfigLoader.ts # ワールド設定JSON読み込み
└── types/                 # 型定義

public/
├── assets/sprites/        # スプライト画像（288x384px、96x96フレーム）
└── data/
    ├── characters.json    # キャラクター設定
    ├── maps.json          # マップ定義（障害物、entrance含む）
    └── world-config.json  # ワールド設定（テーマ、タイミング等）

scripts/
├── generate-placeholder-sprite.mjs  # プレースホルダースプライト生成
└── validate-maps.mjs                # マップデータ検証スクリプト
```

## 重要な設計判断

### PixiJS直接API使用
- @pixi/reactは不使用
- ticker駆動でリアルタイム更新
- Reactの再レンダリングを介さずパフォーマンス向上
- stale closure対策: `activeCharacterRef`, `currentMapIdRef` でtickerコールバック内の最新値を参照
- Graphics再利用: transition overlayは単一インスタンスを`clear()`して再描画
- 経路ライン: 移動開始時に新規作成、到着時に`destroy()`で破棄（parent存在チェック必須）

### グリッドノード
- 自由な移動感を出すため高密度のノードを配置
- `src/data/maps/grid.ts` で共通生成（**ノード生成の正本**）
- 生成時にスキップされるノード:
  - Building領域内のノード
  - Zone壁上のノード（扉位置を除く）
- Zone領域内の移動可能ノードは生成される
- 壁を横切る斜め接続は自動フィルタリング
- 描画と探索で同じノードリストを使用（`grid.ts`が正本、`PixiAppSync.tsx`は追加フィルタなし）
- キャッシュ管理: `mapLoader.ts`が一元管理、`clearMapCache()`でHMR時にリセット
- デフォルト値: `getGridDefaults()`で一元管理（world-config.jsonから取得、未ロード時はフォールバック）

### キャラクター移動
- ランダム自動移動
- 10%の確率でentranceへ、90%はマップ内を探索
- 位置更新の最適化: スプライトは毎フレーム直接更新、storeへの反映はノード到達時のみ
- `positionRef`で移動中の位置を保持、60fpsのstore更新を回避
- 移動完了時に最終方向をstoreに保存

### 後方互換性
- 基本的に後方互換性は不要（開発初期段階のため）
- 不使用コードは完全に削除する
- どうしても気になる場合はユーザーに確認すること

## コマンド
```bash
npm run dev    # 開発サーバー (http://localhost:3000)
npm run build  # プロダクションビルド
npm run lint   # ESLint

# プレースホルダースプライト生成
node scripts/generate-placeholder-sprite.mjs

# マップデータ検証
node scripts/validate-maps.mjs
```

## 実装プラン管理

実装計画は `docs/implementation-plan.md` に記載されている。

### 実装済みマーク
各タスクの実装が完了したら、タスク番号の前に `✅` マークを追加する。

```markdown
# 実装前
| 1-1 | `src/types/character.ts` に `energy` 追加 | ビルド通過 |

# 実装後
| ✅ 1-1 | `src/types/character.ts` に `energy` 追加 | ビルド通過 |
```

Stepの全タスクが完了したら、Step見出しにも `✅` を追加する。

```markdown
# 全タスク完了後
### ✅ Step 1: ステータス拡張（全層対応）
```
