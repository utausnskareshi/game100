# 🎮 GAME100

**100種類のミニゲームで遊べる、オフライン対応の無料ゲームアプリ（PWA）**

📲 **あそぶ / インストール** → https://utausnskareshi.github.io/game100/

iPhone・Android・iPad のホーム画面に追加すると、アプリのように全画面＆オフラインで遊べます。
上のリンクを開くと、機種ごとのインストール手順が表示されます。

> 現在5種類のゲームを収録。100種類を目標に、これから少しずつ追加していきます。

## ✨ とくちょう

- 📴 **オフライン対応** — 一度インストールすれば電波がなくても遊べる
- 💯 **100ゲーム構想** — 10×10のスタンプ台紙を埋めていくコレクション要素
- 🏆 **やりこみ** — ハイスコア・銅銀金メダル・実績・プレイヤーレベル
- ☀️ **今日のゲーム** — 毎日日替わり。その日はみんな同じ配置でスコア勝負
- 🆓 **無料・広告なし・アカウント登録なし・通信なし**（データはすべて端末内に保存）

## 🛠 開発

```bash
npm install
npm run dev      # 開発サーバ（検証用ゲーム3種が有効になる）
npm run build    # 型チェック + 本番ビルド（dist/）
npm run preview  # ビルド結果の確認（Service Worker 有効）
```

- スタック: Vite + TypeScript / フレームワークなし（Vanilla DOM + Canvas 2D）/ vite-plugin-pwa
- 実行時依存: **ゼロ**
- 開発ビルドには検証用ゲーム（`src/games/dev/`）が含まれますが、本番ビルドには含まれません

### フォルダ構成

```
src/
├─ game-api/    ゲームプラグイン契約（ゲームがimportしてよい唯一の場所）
├─ platform/    コアサービス（保存・音・センサー・向き・ゲーム実行の統括 など）
├─ shell/       アプリUI（ホーム・ゲーム一覧・きろく・せってい・ランディング）
├─ games/       ゲーム本体（index.ts のレジストリに1エントリ追記で追加できる）
└─ styles/      デザインシステム
```

### ドキュメント

- [docs/ADDING_A_GAME.md](docs/ADDING_A_GAME.md) — 新しいゲームの追加手順
- [docs/PUBLISH.md](docs/PUBLISH.md) — GitHub Pages への公開・更新手順

## 📱 動作対象

iPhone（SE / Pro / Pro Max）・Android スマートフォン・iPad（mini / Pro）。
PC は対象外です（アクセスするとスマホ用QRコードが表示されます）。

## 📄 ライセンス

[MIT License](LICENSE) © 歌うＬＩＮＥ彼氏
