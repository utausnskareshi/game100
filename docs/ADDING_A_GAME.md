# 新しいゲームの追加手順

ゲーム1本の追加は「**フォルダを1つ作る + レジストリに1エントリ追記**」だけ。
アプリ側（一覧・検索・スタンプ・スコア・メダル・実績・ヘルプ表示・向き制御・ポーズ）は
すべて自動で面倒を見てくれる。

## 手順

### 1. 雛形をコピーする

```
src/games/_template/  →  src/games/<ゲームID>/ にコピー
```

ゲームIDは英小文字とハイフン（例: `tap-panic`）。**一度公開したら変更しない**（保存データのキーになる）。

### 2. ゲームを実装する

`createGame(ctx)` がすべての入口。`ctx`（GameContext）から必要な機能を受け取る。

```ts
export function createGame(ctx: GameContext): IGame {
  const cv = ctx.canvas2d({ design: { w: 360, h: 640 } }); // Canvas派
  // DOM派は ctx.root に要素を追加（dev/quiz.ts が実例）

  const offTap = ctx.input.onTap((p) => { /* cv.toLocal(p) でキャンバス座標に */ });
  const offFrame = ctx.onFrame((dt) => { /* 毎フレーム。dtは秒 */ });

  return {
    start() {},                 // カウントダウン後に1回
    pause() {}, resume() {},    // いつでも呼ばれうる
    resize(size) {},            // 回転・サイズ変化時
    destroy() { offTap(); offFrame(); },  // 全部あとかたづけ
  };
}
```

ゲームが終わったら `ctx.end({ score })` を呼ぶ。結果画面・記録・メダル判定はシェルがやる。

### 3. レジストリに登録する

`src/games/index.ts` の配列に1エントリ追記（書き方の見本は `_template/game.ts` の末尾コメント、
実例は `src/games/dev/index.ts`）。

| フィールド | 説明 |
| --- | --- |
| `id` | 不変ID。フォルダ名と同じにする |
| `no` | 1〜100 の空いている次の番号。**後から変えない**（スタンプ台紙の位置） |
| `title` / `kana` | 表示名と**ひらがな読み**（かな検索に必須） |
| `category` | action / puzzle / reflex / memory / timing / sensor / chill |
| `orientation` | portrait / landscape / any。固定するとAndroidはロック、iPhoneは回転案内 |
| `sensors` | `['motion']` を宣言すると開始前に許可フローが自動で挟まる |
| `optionalSensors` | あると楽しいが必須ではないセンサー。拒否・非対応でも開始できる（`ctx.motion` が null のまま）。タッチだけでも遊べるゲーム向け |
| `scoring` | points（大きいほど良い）/ timeMs（小さいほど良い）/ none |
| `medals` | 銅銀金のスコア閾値。timeMs のときは 銅>銀>金 の順に小さく |
| `help` | goal / controls / tips。開始前画面とポーズ中に表示される |
| `achievements` | 実績の宣言。ゲーム内から `ctx.achieve('id')` で解除 |
| `icon.emoji` | 絵文字1文字（背景グラデはIDから自動生成） |
| `addedIn` | リリースするアプリバージョン（**=収録ゲーム数**。NEWバッジの判定に使う） |
| `load` | `() => import('./<ゲームID>/game')` — 自動でコード分割される |

### 4. 動作確認

```bash
npm run dev
```

チェックリスト:

- [ ] 開始前画面のヘルプ・メダル目標の表示が正しい
- [ ] ポーズ → さいかい / はじめから が正しく動く（音・動きが止まる/戻る）
- [ ] タブ切替やホームボタンでバックグラウンドにすると自動ポーズする
- [ ] iPhone SE サイズ（375×667）と iPad サイズで表示が崩れない
- [ ] 縦横固定ゲーム: 逆向きにすると回転案内が出る
- [ ] `ctx.end()` 後の結果画面 → もういちど、が正しくリセットされて始まる
- [ ] 実績が解除される / メダル閾値が現実的（金は上級者向けの歯ごたえに）
- [ ] `npm run build` がエラーなしで通る

### 5. リリース

`package.json` の version を上げ（**真ん中の数字＝収録した本番ゲームの数**。土台=0.0.0 / 1本=0.1.0 / … / 6本=0.6.0 / 100本=1.0.0）、`src/shell/changelog.ts` に追記して push（詳細は docs/PUBLISH.md）。新ゲームの `addedIn` はこの新バージョンにする。

## 守ること（100本を壊さないためのルール）

1. **import は `../../game-api/` の中（types / helpers）だけ**。ほかのモジュールは触らない（機能はすべて ctx 経由）
2. **`Math.random()` 禁止** → `ctx.random()`（「今日のゲーム」で全員同じ配置にするため）
3. **`Date.now()` / `performance.now()` 禁止** → `ctx.now()`（ポーズ中に時間が進まない）
4. **`destroy()` で完全撤収**（リスナー・タイマー・DOM）。リトライは新インスタンスで作り直される
5. **右上 60×60px は触らない**（フローティングのポーズボタンが載る）
6. `setTimeout` / `setInterval` を使う場合は pause() で止め、destroy() でクリアする
7. スコアの記録は `ctx.end({ score })` の1回だけ。途中でスコアを保存しない
8. ちいさな進行データの保存は `ctx.save()` / `ctx.load()`（ゲームごとに独立した領域）

## ヒント

- **Canvas固定解像度**（`design` 指定）が一番ラク。座標系が常に一定でレターボックスは自動
- **画面いっぱい使う**なら `canvas2d()`（引数なし）+ `resize()` で追従
- **DOMゲーム**（クイズ・カード系）は `ctx.root` に普通に要素を作ってよい。イベントも普通の
  `addEventListener` でOK（`destroy()` での後始末だけ忘れずに）
- 効果音は `ctx.sfx('tap' | 'success' | 'fail' | 'tick' | 'combo' | 'start' | 'medal' | 'powerup')`
- バイブは `ctx.haptic('light' | 'medium' | 'success' | 'error')`（iPhoneでは自動で無効）
- 傾きは `ctx.motion.tilt`（-1〜1、画面基準に補正済み）。`ctx.motion.calibrate()` で
  「いまの持ち方」をゼロ点にできる。シェイクは `ctx.motion.onShake(cb)`
- **共通ヘルパー**（`../../game-api/helpers`）: `clamp` / `elem`（DOM生成）/
  `makeSeg(prefix, ...)`（設定のセグメント選択行。CSSは自ゲームの `${prefix}-seg-*` クラスで持つ）/
  `createCountdown`（設定画面つきゲームの自前 3-2-1。ctx.now 期限方式でポーズ対応）/
  `createDragTilt`（ドラッグ＝仮想傾き。センサーなしでも遊べるように）/
  `pushOutCircleFromRect`（円vs矩形の押し出し。速度応答はゲーム側）
- 参考実装: `src/games/dev/`（tap=Canvas縦 / tilt=センサー横 / quiz=DOM）
