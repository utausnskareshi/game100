// =============================================================
// さかさま おぼえ（No.117・かくれゲーム）: 光った順を「逆から」こたえる
// =============================================================
// - ねらい: #14 おぼえてピアノ は「同じ順」に たたく。こちらは **逆順**。
//   前から 思い出せないので、いったん ぜんぶ ためてから 後ろへ たどる必要がある。
// - 時間は ctx.now()（＝playedMs）だけを使う。ポーズ中は 止まる。
// - import してよいのは game-api（types / helpers）と、このフォルダ内（logic）だけ。
import type { GameContext, IGame, PointerInfo } from '../../game-api/types';
import {
  PADS,
  ROUNDS,
  SHOW_GAP,
  SHOW_ON,
  START_DELAY,
  inputMs,
  makeSeqs,
  reversed,
  roundPoints,
} from './logic';

const W = 360;
const H = 640;
const HUD_H = 46;

/** ボタン（3×2） */
const PAD_COLS = 3;
const PAD_W = 96;
const PAD_H = 96;
const PAD_GAP = 12;
const PAD_Y = 210;

const RESULT_MS = 1500;
const END_DELAY = 2400;
const SCORE_HI = 900;

const C_BG = '#101a24';
const C_TEXT = '#e8f2fa';
const C_DIM = '#7e9bb0';
const C_OK = '#43c98a';
const C_NG = '#e0483c';
const C_ACC = '#ffd54a';
/** ボタンの色（見分けやすい6色） */
const PAD_COLORS = ['#e05a5a', '#e0a13a', '#4ac96a', '#3aa6e0', '#9a6ae0', '#e06aa8'];

type Mode = 'show' | 'input' | 'result' | 'done';

export function createGame(ctx: GameContext): IGame {
  const cv = ctx.canvas2d({ design: { w: W, h: H } });
  const g = cv.ctx;

  const seqs: number[][] = makeSeqs(ctx.random);
  let roundIdx = 0;
  let seq: number[] = seqs[0]!;
  let answer: number[] = reversed(seq);
  let pos = 0;
  let mode: Mode = 'show';
  let started = false;
  let hostPaused = false;
  let ended = false;
  let score = 0;
  let cleared = 0;
  let bestLen = 0;
  let roundStart = 0;
  let phaseUntil = 0;
  /** いま 光っている ボタン（-1 は なし） */
  let lit = -1;
  /** 直前の 判定: 0=なし 1=あたり 2=はずれ 3=時間ぎれ */
  let mark = 0;
  let roundOk = false;
  let lastEvent = '';

  function loadRound(i: number, now: number): void {
    roundIdx = i;
    seq = seqs[i]!;
    answer = reversed(seq);
    pos = 0;
    roundStart = now;
    roundOk = false;
    lit = -1;
    mode = 'show';
    lastEvent = `round:${i}:${seq.length}`;
  }

  // ---------- レイアウト ----------
  const padRect = (i: number): { x: number; y: number } => {
    const total = PAD_COLS * PAD_W + (PAD_COLS - 1) * PAD_GAP;
    const x0 = (W - total) / 2;
    return { x: x0 + (i % PAD_COLS) * (PAD_W + PAD_GAP), y: PAD_Y + Math.floor(i / PAD_COLS) * (PAD_H + PAD_GAP) };
  };
  const hitPad = (p: { x: number; y: number }): number => {
    for (let i = 0; i < PADS; i++) {
      const r = padRect(i);
      if (p.x >= r.x && p.x <= r.x + PAD_W && p.y >= r.y && p.y <= r.y + PAD_H) return i;
    }
    return -1;
  };

  // ---------- 入力 ----------
  const offTap = ctx.input.onTap((p: PointerInfo) => {
    if (hostPaused || !started || mode !== 'input') return;
    const i = hitPad(cv.toLocal(p));
    if (i < 0) return;
    const now = ctx.now();
    if (i === answer[pos]) {
      pos++;
      lit = i;
      mark = 1;
      ctx.sfx('tap');
      lastEvent = `hit:${roundIdx}:${pos}`;
      if (pos >= answer.length) {
        // 1ラウンド せいかい
        const pts = roundPoints(seq.length);
        score += pts;
        cleared++;
        roundOk = true;
        bestLen = Math.max(bestLen, seq.length);
        if (cleared === 1) ctx.achieve('first-clear');
        if (cleared >= 4) ctx.achieve('half');
        if (seq.length >= 5) ctx.achieve('len5');
        if (seq.length >= 7) ctx.achieve('len7');
        mode = 'result';
        phaseUntil = now + RESULT_MS;
        ctx.sfx('medal');
        ctx.haptic('success');
        lastEvent = `clear:${roundIdx}:${pts}`;
      }
    } else {
      mark = 2;
      mode = 'result';
      phaseUntil = now + RESULT_MS;
      ctx.sfx('fail');
      ctx.haptic('error');
      lastEvent = `wrong:${roundIdx}:${pos}`;
    }
  });

  // ---------- 毎フレーム ----------
  const offFrame = ctx.onFrame(() => {
    if (hostPaused || !started) return;
    const now = ctx.now();
    if (mode === 'show') {
      const t = now - roundStart - START_DELAY;
      if (t < 0) {
        lit = -1;
      } else {
        const step = Math.floor(t / (SHOW_ON + SHOW_GAP));
        if (step >= seq.length) {
          lit = -1;
          mode = 'input';
          pos = 0;
          roundStart = now;
          ctx.sfx('start');
          lastEvent = `input:${roundIdx}`;
        } else {
          const inStep = t - step * (SHOW_ON + SHOW_GAP);
          const next = inStep < SHOW_ON ? seq[step]! : -1;
          if (next !== lit && next >= 0) ctx.sfx('tick');
          lit = next;
        }
      }
    } else if (mode === 'input' && now - roundStart >= inputMs(seq.length)) {
      mark = 3;
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
    if (cleared >= ROUNDS) ctx.achieve('all-clear');
    if (score >= SCORE_HI) ctx.achieve('score-hi');
    mode = 'done';
    phaseUntil = now + END_DELAY;
    ctx.sfx('medal');
    lastEvent = `finish:${score}:${cleared}`;
  }

  function setData(): void {
    if (!import.meta.env.DEV) return;
    const r = ctx.root as HTMLElement;
    r.dataset.mode = mode;
    r.dataset.round = String(roundIdx);
    r.dataset.len = String(seq.length);
    r.dataset.seq = seq.join('');
    r.dataset.pos = String(pos);
    r.dataset.lit = String(lit);
    r.dataset.score = String(score);
    r.dataset.cleared = String(cleared);
    r.dataset.best = String(bestLen);
    r.dataset.ok = roundOk ? '1' : '0';
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
    g.fillStyle = '#0a121a';
    g.fillRect(0, 0, W, HUD_H);
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.fillStyle = C_TEXT;
    g.font = 'bold 18px sans-serif';
    g.fillText(`${score}てん`, 12, HUD_H / 2);
    g.fillStyle = C_DIM;
    g.font = 'bold 13px sans-serif';
    g.fillText(`もんだい ${Math.min(roundIdx + 1, ROUNDS)}/${ROUNDS}`, 116, HUD_H / 2 - 8);
    g.fillText(`せいかい ${cleared}・さいちょう ${bestLen}`, 116, HUD_H / 2 + 9);

    g.textAlign = 'center';

    if (mode === 'done') {
      g.fillStyle = C_TEXT;
      g.font = 'bold 26px sans-serif';
      g.fillText(`${cleared} / ${ROUNDS} もん せいかい！`, W / 2, 280);
      g.font = 'bold 34px sans-serif';
      g.fillStyle = C_ACC;
      g.fillText(`${score}てん`, W / 2, 336);
      g.fillStyle = C_DIM;
      g.font = 'bold 14px sans-serif';
      g.fillText(`いちばん長く おぼえた ${bestLen}こ`, W / 2, 380);
      return;
    }

    // といかけ
    if (mode === 'show') {
      g.fillStyle = C_DIM;
      g.font = 'bold 15px sans-serif';
      g.fillText('よく見て おぼえよう', W / 2, 84);
      g.fillStyle = C_TEXT;
      g.font = 'bold 22px sans-serif';
      g.fillText(`${seq.length}こ ひかるよ`, W / 2, 118);
    } else if (mode === 'input') {
      g.fillStyle = C_ACC;
      g.font = 'bold 22px sans-serif';
      g.fillText('さいごから じゅんに タップ！', W / 2, 90);
      g.fillStyle = C_DIM;
      g.font = 'bold 14px sans-serif';
      g.fillText(`のこり ${answer.length - pos}こ`, W / 2, 120);
      // のこり時間
      const left = Math.max(0, 1 - (now - roundStart) / inputMs(seq.length));
      g.fillStyle = 'rgba(126,155,176,.25)';
      roundRect(50, 138, 260, 8, 4);
      g.fill();
      g.fillStyle = left > 0.3 ? C_OK : C_NG;
      roundRect(50, 138, 260 * left, 8, 4);
      g.fill();
    } else {
      g.font = 'bold 22px sans-serif';
      if (mark === 1) {
        g.fillStyle = C_OK;
        g.fillText('せいかい！', W / 2, 100);
      } else if (mark === 2) {
        g.fillStyle = C_NG;
        g.fillText('ちがった…', W / 2, 100);
      } else {
        g.fillStyle = C_NG;
        g.fillText('時間ぎれ…', W / 2, 100);
      }
      g.fillStyle = C_DIM;
      g.font = 'bold 13px sans-serif';
      g.fillText(`こたえ: ${answer.map((v) => v + 1).join(' → ')}`, W / 2, 130);
    }

    // ボタン
    for (let i = 0; i < PADS; i++) {
      const r = padRect(i);
      const on = lit === i || (mode === 'result' && mark === 2 && answer[pos] === i);
      g.fillStyle = on ? PAD_COLORS[i]! : 'rgba(255,255,255,.07)';
      roundRect(r.x, r.y, PAD_W, PAD_H, 16);
      g.fill();
      g.strokeStyle = on ? '#ffffff' : PAD_COLORS[i]!;
      g.lineWidth = on ? 4 : 2.5;
      roundRect(r.x, r.y, PAD_W, PAD_H, 16);
      g.stroke();
      g.fillStyle = on ? '#0a121a' : PAD_COLORS[i]!;
      g.font = 'bold 26px sans-serif';
      g.fillText(String(i + 1), r.x + PAD_W / 2, r.y + PAD_H / 2);
    }

    // すすみ ぐあい（こたえた 数）
    if (mode === 'input') {
      const n = answer.length;
      const dw = Math.min(20, 260 / n);
      const x0 = W / 2 - ((n - 1) * dw) / 2;
      for (let i = 0; i < n; i++) {
        g.beginPath();
        g.arc(x0 + i * dw, 460, 5, 0, Math.PI * 2);
        g.fillStyle = i < pos ? C_OK : 'rgba(126,155,176,.35)';
        g.fill();
      }
    }

    g.fillStyle = C_DIM;
    g.font = 'bold 12px sans-serif';
    g.fillText('ひかった 順を おぼえて、うしろから こたえる', W / 2, 520);
    g.font = 'bold 11px sans-serif';
    g.fillText('1回 まちがえると そのもんだいは おわり（つぎへ すすむ）', W / 2, 546);
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
