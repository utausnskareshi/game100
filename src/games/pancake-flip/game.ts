// =============================================================
// ぱんけーきめいじん（No.70）: きつね色を見きわめて フリップ！両面やけたら お皿へ
// =============================================================
// - フライパンをタップ: 生地を注ぐ → きつね色でもう一度タップ=フリップ →
//   うら面も焼けたらタップ=お皿へ。泡が出たら もうすぐ食べごろの合図。
//   4枚めからは フライパン2つの同時管理。全8枚の焼き上がり評価の合計がスコア。
// - 焼き加減・評価・焼き色は logic.ts（純ロジック・乱数不使用）。
// - 全画面 Canvas・onTap のみ。時間は ctx.now 期限方式・setTimeout 不使用。
// - import してよいのは game-api（types / helpers）と、このフォルダ内（logic）だけ
import type { GameContext, IGame } from '../../game-api/types';
import {
  BUBBLE_AT,
  SIDE_A_MS,
  SIDE_B_MS,
  TOTAL_PANCAKES,
  colorOf,
  donenessOf,
  gradeWord,
  pansAvailable,
  ratePoints,
  rateSide,
} from './logic';

const W = 360;
const H = 640;
const HUD_H = 44;
const PANS = [
  { x: 100, y: 300 },
  { x: 260, y: 300 },
];
const PAN_R = 64;
const FLIP_MS = 420;
const SERVE_MS = 520;
const END_DELAY = 1900;
const SCORE_HI = 700;

type PanPhase = 'empty' | 'sideA' | 'flipping' | 'sideB' | 'serving';
type Mode = 'play' | 'over';

interface Pan {
  phase: PanPhase;
  t0: number; // いまの面の焼きはじめ／アニメ開始
  rateA: number; // 面Aの評価点（フリップ時に確定）
  animFrom: number; // serving アニメの開始位置用
}

export function createGame(ctx: GameContext): IGame {
  const cv = ctx.canvas2d({ design: { w: W, h: H } });
  const g = cv.ctx;

  let mode: Mode = 'play';
  let hostPaused = false;
  let pans: Pan[] = PANS.map(() => ({ phase: 'empty', t0: 0, rateA: 0, animFrom: 0 }));
  let served = 0;
  let score = 0;
  let burnt = 0; // こげ評価（bad面）を出した枚数
  let perfects = 0;
  let plateBounce = 0;
  let lastGrade = '';
  let lastGradeUntil = 0;
  let endAt = 0;
  let ended = false;

  function addScore(n: number): void {
    score += n;
    if (score >= SCORE_HI) ctx.achieve('score-hi');
  }

  function tapPan(pi: number, now: number): void {
    const pan = pans[pi]!;
    if (pan.phase === 'empty') {
      if (pi >= pansAvailable(served)) return; // まだ使えないフライパン
      if (served + activeCount() >= TOTAL_PANCAKES) return; // のこり枚数ぶんだけ注げる
      pan.phase = 'sideA';
      pan.t0 = now;
      ctx.sfx('tap');
      ctx.haptic('light');
    } else if (pan.phase === 'sideA') {
      const d = donenessOf(now - pan.t0, SIDE_A_MS);
      const r = rateSide(d);
      pan.rateA = ratePoints(r);
      if (r === 'bad') burnt++;
      pan.phase = 'flipping';
      pan.t0 = now;
      ctx.sfx('combo');
      ctx.haptic('medium');
    } else if (pan.phase === 'sideB') {
      const d = donenessOf(now - pan.t0, SIDE_B_MS);
      const r = rateSide(d);
      const pts = pan.rateA + ratePoints(r);
      if (r === 'bad') burnt++;
      addScore(pts);
      served++;
      ctx.achieve('first-serve');
      if (pts >= 100) {
        perfects++;
        ctx.achieve('perfect-one');
        if (perfects >= 3) ctx.achieve('perfect-3');
      }
      lastGrade = `${gradeWord(pts)} +${pts}`;
      lastGradeUntil = now + 1100;
      plateBounce = now;
      pan.phase = 'serving';
      pan.t0 = now;
      ctx.sfx('success');
      ctx.haptic('success');
    }
  }

  // 「まだ served に数えられていない」焼き途中の枚数（serving は served 加算済みなので除く）
  const activeCount = (): number => pans.filter((p) => p.phase !== 'empty' && p.phase !== 'serving').length;

  // ---- 入力 ----
  const offTap = ctx.input.onTap((p) => {
    if (hostPaused || mode !== 'play') return;
    const l = cv.toLocal(p);
    const now = ctx.now();
    for (let i = 0; i < PANS.length; i++) {
      const c = PANS[i]!;
      if (Math.hypot(l.x - c.x, l.y - c.y) <= PAN_R + 14) {
        tapPan(i, now);
        return;
      }
    }
  });

  // ---- 毎フレーム ----
  const offFrame = ctx.onFrame(() => {
    if (hostPaused) return;
    const now = ctx.now();
    if (mode === 'play') {
      for (const pan of pans) {
        if (pan.phase === 'flipping' && now >= pan.t0 + FLIP_MS) {
          pan.phase = 'sideB';
          pan.t0 = now;
        } else if (pan.phase === 'serving' && now >= pan.t0 + SERVE_MS) {
          pan.phase = 'empty';
          if (served >= TOTAL_PANCAKES) {
            ctx.achieve('serve-8');
            if (burnt === 0) ctx.achieve('no-burn');
            mode = 'over';
            endAt = now + END_DELAY;
            ctx.sfx('medal');
          }
        }
      }
    } else if (mode === 'over') {
      if (!ended && now >= endAt) {
        ended = true;
        ctx.end({ score });
        return;
      }
    }
    draw(now);
    setData(now);
  });

  function setData(now: number): void {
    if (!import.meta.env.DEV) return;
    const r = ctx.root as HTMLElement;
    r.dataset.mode = mode;
    r.dataset.score = String(score);
    r.dataset.served = String(served);
    r.dataset.burnt = String(burnt);
    r.dataset.perfects = String(perfects);
    r.dataset.pansavail = String(pansAvailable(served));
    r.dataset.pans = pans
      .map((p) => {
        const sideMs = p.phase === 'sideA' ? SIDE_A_MS : SIDE_B_MS;
        const d = p.phase === 'sideA' || p.phase === 'sideB' ? donenessOf(now - p.t0, sideMs) : 0;
        return `${p.phase}:${d.toFixed(3)}:${p.rateA}`;
      })
      .join(';');
  }

  // ---- 描画 ----
  function roundRect(x: number, y: number, w: number, h: number, rad: number): void {
    const rr = Math.min(rad, w / 2, h / 2);
    g.beginPath();
    g.moveTo(x + rr, y);
    g.arcTo(x + w, y, x + w, y + h, rr);
    g.arcTo(x + w, y + h, x, y + h, rr);
    g.arcTo(x, y + h, x, y, rr);
    g.arcTo(x, y, x + w, y, rr);
    g.closePath();
  }

  function drawPan(pi: number, now: number): void {
    const c = PANS[pi]!;
    const pan = pans[pi]!;
    const usable = pi < pansAvailable(served);
    // とって
    g.strokeStyle = '#4a3a2a';
    g.lineWidth = 10;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(c.x + (pi === 0 ? -PAN_R : PAN_R) * 0.9, c.y + 10);
    g.lineTo(c.x + (pi === 0 ? -PAN_R - 34 : PAN_R + 34), c.y + 26);
    g.stroke();
    // フライパン
    g.fillStyle = usable ? '#3a3a42' : 'rgba(58,58,66,.35)';
    g.beginPath();
    g.ellipse(c.x, c.y, PAN_R, PAN_R * 0.62, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = usable ? '#2a2a30' : 'rgba(42,42,48,.35)';
    g.beginPath();
    g.ellipse(c.x, c.y, PAN_R - 8, (PAN_R - 8) * 0.62, 0, 0, Math.PI * 2);
    g.fill();
    if (!usable) {
      g.fillStyle = 'rgba(255,255,255,.55)';
      g.font = 'bold 13px sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('4まいめから', c.x, c.y - 8);
      g.fillText('つかえるよ', c.x, c.y + 10);
      return;
    }

    if (pan.phase === 'empty') {
      if (mode === 'play' && served + activeCount() < TOTAL_PANCAKES) {
        g.fillStyle = 'rgba(255,255,255,.7)';
        g.font = 'bold 14px sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText('タップで そそぐ', c.x, c.y);
      }
      return;
    }

    // 生地
    const sideMs = pan.phase === 'sideA' || pan.phase === 'flipping' ? SIDE_A_MS : SIDE_B_MS;
    const d = pan.phase === 'sideA' || pan.phase === 'sideB' ? donenessOf(now - pan.t0, sideMs) : 0;
    let scaleY = 1;
    let offY = 0;
    if (pan.phase === 'flipping') {
      const t = Math.min(1, (now - pan.t0) / FLIP_MS);
      scaleY = Math.abs(Math.cos(t * Math.PI));
      offY = -Math.sin(t * Math.PI) * 34;
    } else if (pan.phase === 'serving') {
      const t = Math.min(1, (now - pan.t0) / SERVE_MS);
      offY = -t * 120;
      g.globalAlpha = 1 - t * 0.8;
    }
    // うら面はフリップ後、見えているのは「まだ焼けていない側→焼き進む側」
    const face = pan.phase === 'sideB' ? donenessOf(now - pan.t0, SIDE_B_MS) : d;
    const color = pan.phase === 'flipping' ? colorOf(0.2) : colorOf(Math.min(face * 0.35, 0.5));
    // 上から見えている面は「焼けていない側」なので薄めの色 + フチに焼き色
    g.fillStyle = color;
    g.beginPath();
    g.ellipse(c.x, c.y - 4 + offY, 40, 26 * Math.max(0.12, scaleY), 0, 0, Math.PI * 2);
    g.fill();
    // フチ（下面の焼き色がのぞく）
    const edge = pan.phase === 'sideA' || pan.phase === 'sideB' ? colorOf(face) : colorOf(pan.rateA >= 50 ? 1 : 0.6);
    g.strokeStyle = edge;
    g.lineWidth = 5;
    g.beginPath();
    g.ellipse(c.x, c.y - 4 + offY, 40, 26 * Math.max(0.12, scaleY), 0, 0, Math.PI * 2);
    g.stroke();
    // 泡（あわ）＝もうすぐ食べごろの合図
    if ((pan.phase === 'sideA' || pan.phase === 'sideB') && face >= BUBBLE_AT) {
      g.fillStyle = 'rgba(255,244,214,.9)';
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2 + now / 300;
        const rr = 3 + ((k * 7 + Math.floor(now / 160)) % 3);
        g.beginPath();
        g.arc(c.x + Math.cos(a) * 22, c.y - 6 + Math.sin(a) * 12, rr / 2 + 1.2, 0, Math.PI * 2);
        g.fill();
      }
    }
    // こげ煙
    if ((pan.phase === 'sideA' || pan.phase === 'sideB') && face > 1.5) {
      g.fillStyle = 'rgba(120,120,130,.5)';
      g.font = '18px sans-serif';
      g.textAlign = 'center';
      g.fillText('〰', c.x + 14, c.y - 46 - (now / 60) % 14);
      g.fillText('〰', c.x - 12, c.y - 58 - (now / 80) % 12);
    }
    g.globalAlpha = 1;
  }

  function draw(now: number): void {
    // キッチン背景
    g.fillStyle = '#f3e3c8';
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#e2cba4';
    g.fillRect(0, 0, W, 130);
    // コンロ
    g.fillStyle = '#c8ccd4';
    roundRect(16, 220, W - 32, 170, 18);
    g.fill();
    g.fillStyle = '#aab0ba';
    roundRect(16, 220, W - 32, 12, 6);
    g.fill();

    for (let i = 0; i < PANS.length; i++) drawPan(i, now);

    // お皿（できあがりスタック）
    const bounce = now - plateBounce < 300 ? Math.sin(((now - plateBounce) / 300) * Math.PI) * 6 : 0;
    g.fillStyle = '#fff';
    g.beginPath();
    g.ellipse(180, 500, 74, 18, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#e8ecf2';
    g.beginPath();
    g.ellipse(180, 498, 60, 13, 0, 0, Math.PI * 2);
    g.fill();
    for (let i = 0; i < served; i++) {
      g.fillStyle = colorOf(1.0);
      g.beginPath();
      g.ellipse(180, 492 - i * 7 - bounce, 44, 10, 0, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = colorOf(1.2);
      g.lineWidth = 2;
      g.stroke();
    }
    if (served > 0) {
      g.fillStyle = '#f2c84b';
      g.beginPath();
      g.ellipse(180, 486 - served * 7 - bounce, 10, 4, 0, 0, Math.PI * 2);
      g.fill(); // バターのせ
    }

    // 評価ポップ
    if (now < lastGradeUntil) {
      g.fillStyle = '#e05a2a';
      g.font = 'bold 21px sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(lastGrade, 180, 436);
    }

    // ヒント
    g.fillStyle = 'rgba(90,60,20,.7)';
    g.font = 'bold 14px sans-serif';
    g.textAlign = 'center';
    g.fillText('あわが 出てきたら もうすぐ きつね色！', W / 2, 580);
    g.font = 'bold 12px sans-serif';
    g.fillText('そそぐ → きつね色でフリップ → やけたら お皿へ', W / 2, 604);

    // HUD
    g.fillStyle = 'rgba(60,40,16,.88)';
    g.fillRect(0, 0, W, HUD_H);
    g.textBaseline = 'middle';
    g.textAlign = 'left';
    g.fillStyle = '#fff';
    g.font = 'bold 19px sans-serif';
    g.fillText(`${score}てん`, 12, HUD_H / 2);
    g.fillStyle = '#ffe0b0';
    g.font = 'bold 16px sans-serif';
    g.fillText(`🥞 ${served}/${TOTAL_PANCAKES}まい`, 130, HUD_H / 2);

    if (mode === 'over') {
      g.fillStyle = 'rgba(40,26,10,.72)';
      g.fillRect(0, 0, W, H);
      g.fillStyle = '#fff';
      g.textAlign = 'center';
      g.font = 'bold 30px sans-serif';
      g.fillText('できあがり〜！', W / 2, H / 2 - 40);
      g.font = 'bold 22px sans-serif';
      g.fillText(`8まい やいて ${score}てん`, W / 2, H / 2 + 6);
    }
  }

  draw(0);
  setData(0);

  return {
    start() {
      /* シェルの3-2-1のあと。最初のフライパンをタップして開始 */
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
