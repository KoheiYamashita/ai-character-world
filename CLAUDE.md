# AI Agent World

## 概要
2Dマップ上でキャラクターがノードに沿って移動するシミュレーター

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
- 障害物内のノードは自動的に生成されず、キャラクターは通過不可
- 描画: 黄色枠線 + 内部にラベル表示（日本語フォント対応）
- バリデーション:
  - 必須フィールドチェック（row, col, tileWidth, tileHeight）
  - 最小サイズチェック（2x2タイル以上）
  - ラベル-障害物衝突チェック

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
- `gameStore` - 現在マップ、時間、遷移状態
- `characterStore` - キャラクター情報（位置、空腹、所持金）
- `navigationStore` - 移動状態（パス、進捗、開始/目標位置）

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
│   ├── game/              # PixiJS関連
│   │   ├── GameCanvas.tsx # dynamic importラッパー
│   │   └── PixiApp.tsx    # メイン描画・ゲームロジック
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
│   └── gameConfigLoader.ts # ゲーム設定JSON読み込み
└── types/                 # 型定義

public/
├── assets/sprites/        # スプライト画像（288x384px、96x96フレーム）
└── data/
    ├── characters.json    # キャラクター設定
    ├── maps.json          # マップ定義（障害物、entrance含む）
    └── game-config.json   # ゲーム設定（テーマ、タイミング等）

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
- `src/data/maps/grid.ts` で共通生成
- 障害物領域内のノードは生成時にスキップ、接続も自動フィルタリング
- キャッシュ管理: `mapLoader.ts`が一元管理、`clearMapCache()`でHMR時にリセット
- デフォルト値: `getGridDefaults()`で一元管理（game-config.jsonから取得、未ロード時はフォールバック）

### キャラクター移動
- ランダム自動移動
- 10%の確率でentranceへ、90%はマップ内を探索
- 位置更新の最適化: スプライトは毎フレーム直接更新、storeへの反映はノード到達時のみ
- `positionRef`で移動中の位置を保持、60fpsのstore更新を回避
- 移動完了時に最終方向をstoreに保存

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
