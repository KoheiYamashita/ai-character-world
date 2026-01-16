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
- マップはグリッド状のノード（12x9=108個/マップ）で構成
- ノード間は8方向（上下左右+斜め）で接続
- BFSで最短経路を計算
- 障害物はノードを配置しないことで表現

### ノードタイプ
- `waypoint` - 通常の移動可能ポイント（青）
- `spawn` - スポーン地点（緑）
- `entrance` - マップ遷移ポイント（赤）

### マップ遷移
- entranceノードに到達 → フェードアウト → 別マップのentranceに出現 → フェードイン
- `leadsTo: { mapId, nodeId }` で遷移先を定義

### 状態管理 (Zustand)
- `gameStore` - 現在マップ、時間、遷移状態
- `characterStore` - キャラクター情報（位置、空腹、所持金）
- `navigationStore` - 移動状態（パス、進捗、開始/目標位置）

### スプライトシステム
- 行ベースのスプライトシート（3列×4行、各方向3フレーム）
- 行構成: Row0=下、Row1=左、Row2=右、Row3=上
- アニメーション: [0,1,2,1]ループ、停止時はフレーム1
- キャラクター設定は`public/data/characters.json`で管理
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
│   └── characterLoader.ts # JSON設定からキャラクター生成
└── types/                 # 型定義

public/
├── assets/sprites/        # スプライト画像（288x384px、96x96フレーム）
└── data/characters.json   # キャラクター設定JSON

scripts/
└── generate-placeholder-sprite.mjs  # プレースホルダースプライト生成
```

## 重要な設計判断

### PixiJS直接API使用
- @pixi/reactは不使用
- ticker駆動でリアルタイム更新
- Reactの再レンダリングを介さずパフォーマンス向上

### グリッドノード
- 自由な移動感を出すため高密度のノードを配置
- `src/data/maps/grid.ts` で共通生成

### キャラクター移動
- ランダム自動移動
- 10%の確率でentranceへ、90%はマップ内を探索
- 移動完了時に最終方向をstoreに保存

## コマンド
```bash
npm run dev    # 開発サーバー (http://localhost:3000)
npm run build  # プロダクションビルド
npm run lint   # ESLint

# プレースホルダースプライト生成
node scripts/generate-placeholder-sprite.mjs
```
