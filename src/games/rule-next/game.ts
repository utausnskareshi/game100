// =============================================================
// きまりを 見ぬけ（No.120・かくれゲーム）: 並びの きまりを 読んで つぎを あてる
// =============================================================
// - ねらい: 100本の中に「規則を 見ぬく」型が 無かった。形・色・大きさが
//   それぞれ 別の 周期で 変わるので、後半は 3つ同時に 追う必要がある。
// - 出題は logic.makeRound。**1〜3の どの周期で 読んでも 同じ答えになる**ことを
//   生成時に 確かめてあるので、答えは かならず 1とおり。
// - import してよいのは game-api（types / helpers）と、このフォルダ内（logic）だけ。
import type { GameContext, IGame, PointerInfo } from '../../game-api/types';
import {
  ALL_BONUS,
  QUICK_BONUS,
  QUICK_MS,
  ROUNDS,
  ROUND_MS,
  type Item,
  type Round,
  SHOWN,
  makeRounds,
  roundPoints,
} from './logic';

const W = 360;
const H = 640;
const HUD_H = 46;

/** ならびの マス */
const SEQ_Y = 150;
const SEQ_CELL = 44;
const SEQ_X = 8;
/** えらぶ ボタン（2×2） */
const CH_W = 150;
const CH_H = 106;
const CH_X = 22;
const CH_Y = 300;
const CH_GAP = 16;

const RESULT_MS = 1600;
const END_DELAY = 2600;
const SCORE_HI = 900;

const C_BG = '#1b1f2e';
const C_SLOT = '#262c40';
const C_TEXT = '#eef1fa';
const C_DIM = '#96a0bd';
const C_OK = '#43c98a';
const C_NG = '#e0483c';
const C_ACC = '#ffd54a';
/** ものの色（4色） */
const ITEM_COLORS = ['#ff6b6b', '#4aa3ff', '#ffd54a', '#5ad08a'];

type Mode = 'play' | 'result' | 'done';

export function createGame(ctx: GameContext): IGame {
  const cv = ctx.canvas2d({ design: { w: W, h: H } });
  const g = cv.ctx;

  const rounds: Round[] = makeRounds(ctx.random);
  let roundIdx = 0;
  let round: Round = rounds[0]!;
  let mode: Mode = 'play';
  let started = false;
  let hostPaused = false;
  let ended = false;
  let score = 0;
  let correct = 0;
  let streak = 0;
  let bestStreak = 0;
  let picked = -1;
  let roundStart = 0;
  let phaseUntil = 0;
  let lastEvent = '';

  function loadRound(i: number, now: number): void {
    roundIdx = i;
    round = rounds[i]!;
    picked = -1;
    roundStart = now;
    mode = 'play';
    lastEvent = `round:${i}`;
  }

  // ---------- レイアウト ----------
  const choiceRect = (i: number): { x: number; y: number } => ({
    x: CH_X + (i % 2) * (CH_W + CH_GAP),
    y: CH_Y + Math.floor(i / 2) * (CH_H + CH_GAP),
  });
  const hitChoice = (p: { x: number; y: number }): number => {
    for (let i = 0; i < 4; i++) {
      const r = choiceRect(i);
      if (p.x >= r.x && p.x <= r.x + CH_W && p.y >= r.y && p.y <= r.y + CH_H) return i;
    }
    return -1;
  };

  // ---------- 入力 ----------
  const offTap = ctx.input.onTap((p: PointerInfo) => {
    if (hostPaused || !started || mode !== 'play') return;
    const i = hitChoice(cv.toLocal(p));
    if (i < 0) return;
    const now = ctx.now();
    picked = i;
    if (i === round.correct) {
      let pts = roundPoints(roundIdx);
      if (now - roundStart <= QUICK_MS) {
        pts += QUICK_BONUS;
        ctx.achieve('quick');
      }
      score += pts;
      correct++;
      streak++;
      bestStreak = Math.max(bestStreak, streak);
      ctx.sfx('success');
      ctx.haptic('success');
      if (correct === 1) ctx.achieve('first-right');
      if (correct >= 4) ctx.achieve('half');
      if (streak >= 5) ctx.achieve('streak-5');
      lastEvent = `hit:${roundIdx}:${pts}`;
    } else {
      streak = 0;
      ctx.sfx('fail');
      ctx.haptic('error');
      lastEvent = `miss:${roundIdx}:${i}`;
    }
    mode = 'result';
    phaseUntil = now + RESULT_MS;
  });

  // ---------- 毎フレーム ----------
  const offFrame = ctx.onFrame(() => {
    if (hostPaused || !started) return;
    const now = ctx.now();
    if (mode === 'play' && now - roundStart >= ROUND_MS) {
      streak = 0;
      picked = -1;
      mode = 'result';
      phaseUntil = now + RESULT_MS;
      ctx.sfx('fail');
      lastEvent = `timeup:${roundIdx}`;
    } else if (mode === 'result' && now >= phaseUntil) {
      if (roundIdx + 1 >= ROUNDS) finish(now);
      else loadRound(roundIdx + 1, now);
    } else if (mode === 'done' && !ended && now >= phaseUntil) {
      ended = true;
      ctx.end({ score });
      return;
    }
    draw(now);
    setData();
  });

  function finish(now: number): void {
    if (correct >= ROUNDS) {
      score += ALL_BONUS;
      ctx.achieve('all-right');
    }
    if (score >= SCORE_HI) ctx.achieve('score-hi');
    mode = 'done';
    phaseUntil = now + END_DELAY;
    ctx.sfx('medal');
    lastEvent = `finish:${score}:${correct}`;
  }

  function setData(): void {
    if (!import.meta.env.DEV) return;
    const r = ctx.root as HTMLElement;
    r.dataset.mode = mode;
    r.dataset.round = String(roundIdx);
    r.dataset.correct = String(round.correct);
    r.dataset.picked = String(picked);
    r.dataset.hits = String(correct);
    r.dataset.streak = String(streak);
    r.dataset.score = String(score);
    r.dataset.rule = `${round.rule.shapeP}${round.rule.colorP}${round.rule.sizeP}`;
    r.dataset.last = lastEvent;
  }

  // ---------- 描画 ----------
  function roundRect(x: number, y: number, w: number, h: number, r: number): void {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  /** ものを 1つ 描く */
  function drawItem(it: Item, cx: number, cy: number, base: number): void {
    const r = base * (it.size === 0 ? 0.6 : it.size === 1 ? 0.8 : 1);
    g.fillStyle = ITEM_COLORS[it.color]!;
    g.beginPath();
    if (it.shape === 0) {
      g.arc(cx, cy, r, 0, Math.PI * 2);
    } else if (it.shape === 1) {
      g.rect(cx - r * 0.88, cy - r * 0.88, r * 1.76, r * 1.76);
    } else if (it.shape === 2) {
      g.moveTo(cx, cy - r);
      g.lineTo(cx + r * 0.92, cy + r * 0.75);
      g.lineTo(cx - r * 0.92, cy + r * 0.75);
      g.closePath();
    } else {
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const rr = i % 2 === 0 ? r : r * 0.46;
        const x = cx + Math.cos(a) * rr;
        const y = cy + Math.sin(a) * rr;
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.closePath();
    }
    g.fill();
  }

  function draw(now: number): void {
    cv.clear(C_BG);

    // HUD
    g.fillStyle = '#12151f';
    g.fillRect(0, 0, W, HUD_H);
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.fillStyle = C_TEXT;
    g.font = 'bold 18px sans-serif';
    g.fillText(`${score}てん`, 12, HUD_H / 2);
    g.fillStyle = C_DIM;
    g.font = 'bold 13px sans-serif';
    g.fillText(`もんだい ${Math.min(roundIdx + 1, ROUNDS)}/${ROUNDS}`, 116, HUD_H / 2 - 8);
    g.fillText(`せいかい ${correct}・れんぞく ${streak}`, 116, HUD_H / 2 + 9);

    g.textAlign = 'center';

    if (mode === 'done') {
      g.fillStyle = C_TEXT;
      g.font = 'bold 26px sans-serif';
      g.fillText(`${correct} / ${ROUNDS} もん せいかい！`, W / 2, 280);
      g.font = 'bold 34px sans-serif';
      g.fillStyle = C_ACC;
      g.fillText(`${score}てん`, W / 2, 336);
      g.fillStyle = C_DIM;
      g.font = 'bold 14px sans-serif';
      g.fillText(`さいこう れんぞく ${bestStreak}かい`, W / 2, 380);
      return;
    }

    // といかけ
    g.fillStyle = C_TEXT;
    g.font = 'bold 15px sans-serif';
    g.fillText('きまりを 見ぬいて、つぎに 来るものは？', W / 2, 76);

    // のこり時間
    const left = Math.max(0, 1 - (now - roundStart) / ROUND_MS);
    g.fillStyle = 'rgba(150,160,189,.22)';
    roundRect(50, 96, 260, 8, 4);
    g.fill();
    g.fillStyle = left > 0.3 ? C_OK : C_NG;
    roundRect(50, 96, 260 * left, 8, 4);
    g.fill();

    // ならび（さいごは ？）
    for (let i = 0; i <= SHOWN; i++) {
      const x = SEQ_X + i * SEQ_CELL;
      g.fillStyle = i === SHOWN ? 'rgba(255,213,74,.14)' : C_SLOT;
      roundRect(x + 2, SEQ_Y, SEQ_CELL - 4, SEQ_CELL + 8, 8);
      g.fill();
      if (i < SHOWN) {
        drawItem(round.items[i]!, x + SEQ_CELL / 2, SEQ_Y + (SEQ_CELL + 8) / 2, 15);
      } else if (mode === 'result') {
        drawItem(round.answer, x + SEQ_CELL / 2, SEQ_Y + (SEQ_CELL + 8) / 2, 15);
      } else {
        g.fillStyle = C_ACC;
        g.font = 'bold 26px sans-serif';
        g.fillText('?', x + SEQ_CELL / 2, SEQ_Y + (SEQ_CELL + 8) / 2 + 2);
      }
    }

    // えらぶ
    for (let i = 0; i < 4; i++) {
      const r = choiceRect(i);
      const isAns = i === round.correct;
      const isPick = i === picked;
      let border = 'rgba(150,160,189,.35)';
      if (mode === 'result') border = isAns ? C_OK : isPick ? C_NG : 'rgba(150,160,189,.18)';
      g.fillStyle = mode === 'result' && isAns ? 'rgba(67,201,138,.14)' : C_SLOT;
      roundRect(r.x, r.y, CH_W, CH_H, 14);
      g.fill();
      g.strokeStyle = border;
      g.lineWidth = mode === 'result' && (isAns || isPick) ? 4 : 2;
      roundRect(r.x, r.y, CH_W, CH_H, 14);
      g.stroke();
      drawItem(round.choices[i]!, r.x + CH_W / 2, r.y + CH_H / 2, 30);
    }

    // ようす
    g.font = 'bold 16px sans-serif';
    if (mode === 'result') {
      if (picked < 0) {
        g.fillStyle = C_NG;
        g.fillText('時間ぎれ… こたえは みどりの わく', W / 2, 570);
      } else if (picked === round.correct) {
        g.fillStyle = C_OK;
        g.fillText('せいかい！', W / 2, 570);
      } else {
        g.fillStyle = C_NG;
        g.fillText('ざんねん… こたえは みどりの わく', W / 2, 570);
      }
    } else {
      g.fillStyle = C_DIM;
      g.font = 'bold 12px sans-serif';
      g.fillText('形・色・大きさ、それぞれの くりかえしを 見よう', W / 2, 570);
      g.font = 'bold 11px sans-serif';
      g.fillText('はやく こたえると ボーナス', W / 2, 592);
    }
  }

  draw(0);
  setData();

  return {
    start() {
      started = true;
      roundStart = ctx.now();
    },
    pause() {
      hostPaused = true;
    },
    resume() {
      hostPaused = false;
    },
    resize() {
      draw(ctx.now());
    },
    destroy() {
      offTap();
      offFrame();
    },
  };
}
