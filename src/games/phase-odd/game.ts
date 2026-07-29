// =============================================================
// ひとつだけ ズレてる（No.112・かくれゲーム）: 位相のズレを 見つける
// =============================================================
// - ねらい: 「色がちがう」「形がちがう」ではなく **うごく タイミングが ちがう** ものを
//   見つける。ズレが 小さくなるほど、じっと見くらべないと 分からなくなる。
// - ふくらみは logic.pulseOf（時間の関数＝決定論）。ポーズ中は ctx.now が止まるので
//   ズレの位置が 動かない＝ポーズしても 有利にならない。
// - import してよいのは game-api（types / helpers）と、このフォルダ内（logic）だけ。
import type { GameContext, IGame, PointerInfo } from '../../game-api/types';
import {
  FAST_EYE_MS,
  MISS_PENALTY,
  QUICK_BONUS,
  QUICK_MS,
  ROUNDS,
  ROUND_MS,
  type Round,
  makeRounds,
  pulseOf,
  roundPoints,
} from './logic';

const W = 360;
const H = 640;
const HUD_H = 46;

/** 盤の わく */
const FIELD_Y = 126;
const FIELD_W = 320;
const FIELD_H = 384;

const RESULT_MS = 1100;
const END_DELAY = 2400;
const SCORE_HI = 1100;

const C_BG = '#141024';
const C_DOT = '#7d6bff';
const C_DOT2 = '#b7aaff';
const C_TEXT = '#efeaff';
const C_DIM = '#9a91c4';
const C_OK = '#43c98a';
const C_NG = '#e0483c';
const C_ACC = '#ffd54a';

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
  let misses = 0;
  /** このラウンドの まちがい回数（点は ラウンドの ごほうびから 引く） */
  let roundMiss = 0;
  let bigFound = 0;
  let roundStart = 0;
  let phaseUntil = 0;
  /** 直前の判定: 0=なし 1=せいかい 2=はずれ 3=時間ぎれ */
  let mark = 0;
  let markUntil = 0;
  let lastEvent = '';

  function loadRound(i: number, now: number): void {
    roundMiss = 0;
    roundIdx = i;
    round = rounds[i]!;
    roundStart = now;
    mode = 'play';
    lastEvent = `round:${i}`;
  }

  // ---------- レイアウト ----------
  const cellSize = (): number => Math.min(FIELD_W / round.spec.cols, FIELD_H / round.spec.rows);
  const cellCenter = (index: number): { x: number; y: number } => {
    const c = cellSize();
    const gx = (W - c * round.spec.cols) / 2;
    const gy = FIELD_Y + (FIELD_H - c * round.spec.rows) / 2;
    const col = index % round.spec.cols;
    const row = Math.floor(index / round.spec.cols);
    return { x: gx + col * c + c / 2, y: gy + row * c + c / 2 };
  };
  const hitIndex = (p: { x: number; y: number }): number => {
    const c = cellSize();
    const gx = (W - c * round.spec.cols) / 2;
    const gy = FIELD_Y + (FIELD_H - c * round.spec.rows) / 2;
    const col = Math.floor((p.x - gx) / c);
    const row = Math.floor((p.y - gy) / c);
    if (col < 0 || row < 0 || col >= round.spec.cols || row >= round.spec.rows) return -1;
    return row * round.spec.cols + col;
  };

  // ---------- 入力 ----------
  const offTap = ctx.input.onTap((p: PointerInfo) => {
    if (hostPaused || !started || mode !== 'play') return;
    const l = cv.toLocal(p);
    const idx = hitIndex(l);
    if (idx < 0) return;
    const now = ctx.now();
    const used = now - roundStart;
    if (idx === round.odd) {
      // ★まちがいの 代償は「そのラウンドの ごほうびから 引く」方式にする。
      //   合計点から 引く方式だと、合計が 0 のとき（＝1もん目や 減点しきったあと）
      //   まちがいが タダに なり、ぜんぶ タップして さがす 力わざが 通ってしまう。
      let pts = roundPoints(roundIdx);
      if (used <= QUICK_MS) pts += QUICK_BONUS;
      pts = Math.max(0, pts - roundMiss * MISS_PENALTY);
      score += pts;
      correct++;
      mark = 1;
      markUntil = now + RESULT_MS;
      ctx.sfx('success');
      ctx.haptic('success');
      if (correct === 1) ctx.achieve('first-find');
      if (correct >= 5) ctx.achieve('half');
      if (used <= FAST_EYE_MS) ctx.achieve('quick-eye');
      if (round.spec.cols * round.spec.rows >= 30) {
        bigFound++;
        ctx.achieve('big-grid');
      }
      mode = 'result';
      phaseUntil = now + RESULT_MS;
      lastEvent = `hit:${roundIdx}:${pts}:${Math.round(used)}`;
    } else {
      misses++;
      roundMiss++;
      mark = 2;
      markUntil = now + 500;
      ctx.sfx('fail');
      ctx.haptic('error');
      lastEvent = `miss:${roundIdx}:${idx}`;
    }
  });

  // ---------- 毎フレーム ----------
  const offFrame = ctx.onFrame(() => {
    if (hostPaused || !started) return;
    const now = ctx.now();
    if (mode === 'play' && now - roundStart >= ROUND_MS) {
      mark = 3;
      markUntil = now + RESULT_MS;
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
    if (correct >= ROUNDS) ctx.achieve('all-find');
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
    r.dataset.grid = `${round.spec.cols}x${round.spec.rows}`;
    r.dataset.odd = String(round.odd);
    r.dataset.offset = round.spec.offset.toFixed(2);
    r.dataset.roundmiss = String(roundMiss);
    r.dataset.score = String(score);
    r.dataset.correct = String(correct);
    r.dataset.misses = String(misses);
    r.dataset.big = String(bigFound);
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

  function draw(now: number): void {
    cv.clear(C_BG);

    // HUD
    g.fillStyle = '#0d0a1a';
    g.fillRect(0, 0, W, HUD_H);
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.fillStyle = C_TEXT;
    g.font = 'bold 18px sans-serif';
    g.fillText(`${score}てん`, 12, HUD_H / 2);
    g.fillStyle = C_DIM;
    g.font = 'bold 13px sans-serif';
    g.fillText(`もんだい ${Math.min(roundIdx + 1, ROUNDS)}/${ROUNDS}`, 116, HUD_H / 2 - 8);
    g.fillText(`せいかい ${correct}・おてつき ${misses}`, 116, HUD_H / 2 + 9);

    g.textAlign = 'center';

    if (mode === 'done') {
      g.fillStyle = C_TEXT;
      g.font = 'bold 26px sans-serif';
      g.fillText(`${correct} / ${ROUNDS} もん せいかい！`, W / 2, 280);
      g.font = 'bold 34px sans-serif';
      g.fillStyle = C_DOT2;
      g.fillText(`${score}てん`, W / 2, 336);
      g.fillStyle = C_DIM;
      g.font = 'bold 14px sans-serif';
      g.fillText(`おてつき ${misses}かい`, W / 2, 380);
      return;
    }

    // といかけ
    g.fillStyle = C_TEXT;
    g.font = 'bold 16px sans-serif';
    g.fillText('リズムが ズレている 1つを さがそう', W / 2, 74);

    // のこり時間
    const left = Math.max(0, 1 - (now - roundStart) / ROUND_MS);
    g.fillStyle = 'rgba(154,145,196,.22)';
    roundRect(40, 96, 280, 9, 5);
    g.fill();
    g.fillStyle = left > 0.35 ? C_DOT : C_NG;
    roundRect(40, 96, 280 * left, 9, 5);
    g.fill();

    // マル
    const c = cellSize();
    const n = round.spec.cols * round.spec.rows;
    const elapsed = now - roundStart;
    for (let i = 0; i < n; i++) {
      const p = cellCenter(i);
      const v = pulseOf(round, i, elapsed);
      const r = c * (0.2 + 0.22 * v);
      const isOdd = i === round.odd;
      const reveal = mode === 'result' && isOdd;
      g.fillStyle = reveal ? (mark === 1 ? C_OK : C_ACC) : C_DOT;
      g.beginPath();
      g.arc(p.x, p.y, r, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = 'rgba(255,255,255,.22)';
      g.beginPath();
      g.arc(p.x - r * 0.28, p.y - r * 0.28, r * 0.3, 0, Math.PI * 2);
      g.fill();
      if (reveal) {
        g.strokeStyle = mark === 1 ? C_OK : C_ACC;
        g.lineWidth = 3;
        g.beginPath();
        g.arc(p.x, p.y, c * 0.44, 0, Math.PI * 2);
        g.stroke();
      }
    }

    // 判定
    if (now < markUntil) {
      g.font = 'bold 20px sans-serif';
      if (mark === 1) {
        g.fillStyle = C_OK;
        g.fillText('見つけた！', W / 2, 552);
      } else if (mark === 2) {
        g.fillStyle = C_NG;
        g.fillText('ちがう…', W / 2, 552);
      } else {
        g.fillStyle = C_ACC;
        g.fillText('時間ぎれ。これだったよ', W / 2, 552);
      }
    } else {
      g.fillStyle = C_DIM;
      g.font = 'bold 13px sans-serif';
      g.fillText(`ズレ ${(round.spec.offset * 100).toFixed(0)}%・${round.spec.cols * round.spec.rows}マス`, W / 2, 552);
      // まちがうと この もんだいの ごほうびが へることを 見せる（代償が 見えないと 力わざを 誘う）
      if (roundMiss > 0) {
        const left = Math.max(0, roundPoints(roundIdx) + QUICK_BONUS - roundMiss * MISS_PENALTY);
        g.fillStyle = C_NG;
        g.font = 'bold 12px sans-serif';
        g.fillText(`まちがい ${roundMiss}かい → この もんだいは さいだい ${left}てん`, W / 2, 574);
      }
    }

    g.fillStyle = C_DIM;
    g.font = 'bold 11px sans-serif';
    g.fillText('まちがえると 20点へる。じっくり くらべよう', W / 2, 596);
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
