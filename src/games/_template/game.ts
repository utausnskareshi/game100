// =============================================================
// 新しいゲームの雛形（このフォルダをコピーして作り始める）
// 手順の詳細: docs/ADDING_A_GAME.md
// =============================================================
// ルール:
//   - import してよいのは ../../game-api/ の中（types と helpers）だけ。
//     共通ヘルパー（clamp / elem / makeSeg / createCountdown / createDragTilt /
//     pushOutCircleFromRect）は ../../game-api/helpers から使える
//   - 乱数は ctx.random()、時間は ctx.now() を使う（Math.random / Date.now 禁止）
//   - setTimeout / setInterval も使わない（ポーズ中でも進んでしまう）。
//     時間差の処理は「期限 = ctx.now() + ミリ秒」を覚えて ctx.onFrame で比べる期限方式で書く
//   - destroy() で自分が登録したものをすべて解除する
//   - 右上 60×60px はポーズボタンの領域なので重要なUIを置かない
// =============================================================
import type { GameContext, IGame } from '../../game-api/types';

export function createGame(ctx: GameContext): IGame {
  // --- 初期化 ---------------------------------------------------
  // Canvasを使う場合（design を指定すると自動レターボックスの固定解像度になる）
  const cv = ctx.canvas2d({ design: { w: 360, h: 640 } });
  // DOMでつくる場合は ctx.root に要素を追加する（canvas2d は呼ばなくてよい）

  let score = 0;

  const unsubscribes = [
    // タップ入力（座標は cv.toLocal() でキャンバス座標に変換）
    ctx.input.onTap((p) => {
      const local = cv.toLocal(p);
      void local;
      score++;
      ctx.sfx('tap');
      ctx.haptic('light');
      if (score === 10) ctx.achieve('score-10'); // 実績はメタデータで宣言したIDを渡す
    }),

    // 毎フレーム呼ばれる（dt: 秒）。ポーズ中は自動で止まる
    ctx.onFrame((dt) => {
      update(dt);
      draw();
    }),
  ];

  function update(_dt: number): void {
    // 30秒たったら終了する例。ctx.now() はポーズ中に進まない
    if (ctx.now() >= 30_000) {
      ctx.end({ score }); // スコアの記録・結果画面はシェルがやってくれる
    }
  }

  function draw(): void {
    cv.clear('#101330');
    const g = cv.ctx;
    g.fillStyle = '#ffffff';
    g.font = 'bold 32px sans-serif';
    g.textAlign = 'center';
    g.fillText(String(score), cv.width / 2, 64);
    g.font = '16px sans-serif';
    g.fillText('タップしてスコアをかせごう', cv.width / 2, cv.height / 2);
  }

  // --- ライフサイクル -------------------------------------------
  return {
    start() {
      // カウントダウン後に1回だけ呼ばれる。BGM開始などがあればここで
    },
    pause() {
      // onFrame と ctx.now() はシェルが止めるので、期限方式ならここは通常なにもしなくてよい
    },
    resume() {},
    resize(_size) {
      // designモードのCanvasは自動調整されるので通常なにもしなくてよい。
      // 画面いっぱいに使うゲーム（design未指定/DOM）はここでレイアウトし直す
    },
    destroy() {
      for (const off of unsubscribes) off();
      // DOMを追加した場合はここで remove する
    },
  };
}

/* -----------------------------------------------------------------
src/games/index.ts に追記する登録エントリの例:

  {
    id: 'my-game',                       // 不変ID（フォルダ名と合わせる）
    no: 4,                               // 空いている次の番号
    title: 'マイゲーム',
    kana: 'まいげーむ',                   // ひらがな読み（検索用）
    description: 'ゲームのかんたんな説明。',
    category: 'action',                  // action|puzzle|reflex|memory|timing|sensor|chill
    orientation: 'portrait',             // portrait|landscape|any
    scoring: 'points',                   // points|timeMs|none
    medals: { bronze: 10, silver: 20, gold: 30 },
    timeToPlay: 'short',                 // short|mid|long
    help: {
      goal: 'ゲームの目的をここに書く。',
      controls: ['タップ：〜する'],
      tips: ['コツをここに書く'],
    },
    achievements: [
      { id: 'score-10', name: 'はじめのいっぽ', desc: 'スコア10をとった' },
    ],
    icon: { emoji: '🎯' },
    addedIn: '0.6.0',                    // = 収録ゲーム数（このゲームで6本目なら 0.6.0・100本で 1.0.0）
    load: () => import('./my-game/game'),
  },
----------------------------------------------------------------- */
