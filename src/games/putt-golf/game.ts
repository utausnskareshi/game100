// =============================================================
// パターゴルフ（No.74）: ボールを引っぱって はなして、カップまで はこぼう！全9ホール
// =============================================================
// - ドラッグで引っぱると 反対方向へのガイドと強さゲージが出る。はなすとパット。
//   ボールは摩擦で止まり、かべで反射、カップに ゆっくり入ると カップイン。砂は減速。
// - 物理・コース・採点は logic.ts（純ロジック・乱数不使用＝完全決定論）。
//   固定サブステップ（1/120s）。時間は ctx.now・setTimeout 不使用。
// - import してよいのは game-api（types / helpers）と、このフォルダ内（logic）だけ
import type { GameContext, IGame, PointerInfo } from '../../game-api/types';
import { clamp } from '../../game-api/helpers';
import {
  BALL_R,
  type Ball,
  CUP_R,
  HOLES,
  type Hole,
  MAX_PUTT,
  MAX_STROKES,
  MIN_PULL,
  PULL_SCALE,
  W,
  pointsFor,
  stepBall,
} from './logic';

const HUD_H = 40;
const INTRO_MS = 1100;
const SUNK_MS = 1300;
const END_DELAY = 2100;
const SCORE_HI = 2100;

type Mode = 'intro' | 'aim' | 'roll' | 'sunk' | 'over';

export function createGame(ctx: GameContext): IGame {
  const cv = ctx.canvas2d({ design: { w: W, h: 640 } });
  const g = cv.ctx;

  let mode: Mode = 'intro';
  let hostPaused = false;
  let holeIdx = 0;
  let hole: Hole = HOLES[0]!;
  const ball: Ball = { x: hole.tee.x, y: hole.tee.y, vx: 0, vy: 0 };
  let strokes = 0;
  let score = 0;
  let holesDone = 0;
  let birdies = 0;
  let acesMade = 0;
  let underParTotal = 0; // 合計の パー差（マイナスが良い）
  let acc = 0;
  let introUntil = 0;
  let sunkUntil = 0;
  let endAt = 0;
  let ended = false;
  let lastGain = 0;
  let lastAce = false;

  // ドラッグ
  let dragId = -1;
  let dragStart: { x: number; y: number } | null = null;
  let dragNow: { x: number; y: number } | null = null;

  function initHole(idx: number, now: number): void {
    holeIdx = idx;
    hole = HOLES[idx]!;
    ball.x = hole.tee.x;
    ball.y = hole.tee.y;
    ball.vx = 0;
    ball.vy = 0;
    strokes = 0;
    mode = 'intro';
    introUntil = now + INTRO_MS;
    dragId = -1;
    dragStart = null;
    dragNow = null;
  }

  function addScore(n: number): void {
    score += n;
    if (score >= SCORE_HI) ctx.achieve('score-hi');
  }

  function finishHole(sunk: boolean, now: number): void {
    const gain = pointsFor(strokes, hole.par, sunk);
    addScore(gain);
    lastGain = gain;
    lastAce = sunk && strokes <= 1;
    holesDone++;
    ctx.achieve('first-hole');
    if (sunk) {
      underParTotal += strokes - hole.par;
      if (strokes <= 1) {
        acesMade++;
        ctx.achieve('ace');
      } else if (strokes < hole.par) {
        birdies++;
        ctx.achieve('birdie');
        if (birdies >= 3) ctx.achieve('birdie-3');
      }
    } else {
      underParTotal += MAX_STROKES - hole.par; // 未達は上限打数ぶんのオーバー扱い
    }
    mode = 'sunk';
    sunkUntil = now + SUNK_MS;
    ctx.sfx(sunk ? 'medal' : 'fail');
    ctx.haptic(sunk ? 'success' : 'error');
  }

  function putt(dirx: number, diry: number, power: number): void {
    ball.vx = dirx * power;
    ball.vy = diry * power;
    strokes++;
    mode = 'roll';
    ctx.sfx('tap');
    ctx.haptic('light');
  }

  // ---- 入力（引っぱって はなす）----
  const offDown = ctx.input.onDown((p: PointerInfo) => {
    if (hostPaused || mode !== 'aim') return;
    if (dragId === -1) {
      dragId = p.id;
      dragStart = cv.toLocal(p);
      dragNow = dragStart;
    }
  });
  const offMove = ctx.input.onMove((p: PointerInfo) => {
    if (p.id !== dragId || mode !== 'aim') return;
    dragNow = cv.toLocal(p);
  });
  const offUp = ctx.input.onUp((p: PointerInfo) => {
    if (p.id !== dragId) return;
    const start = dragStart;
    const end = cv.toLocal(p);
    dragId = -1;
    dragStart = null;
    dragNow = null;
    if (mode !== 'aim' || hostPaused || !start) return;
    // 引っぱった方向の反対へ打つ（バックスイング方式）
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const len = Math.hypot(dx, dy);
    if (len < MIN_PULL) return;
    const power = clamp(len * PULL_SCALE, 60, MAX_PUTT);
    putt(-dx / len, -dy / len, power);
  });

  // ---- 毎フレーム ----
  const offFrame = ctx.onFrame((dt) => {
    if (hostPaused) return;
    const now = ctx.now();
    if (mode === 'intro') {
      if (now >= introUntil) mode = 'aim';
    } else if (mode === 'roll') {
      acc += Math.min(dt, 0.05);
      const STEP = 1 / 120;
      let guard = 0;
      while (acc >= STEP && guard++ < 40) {
        acc -= STEP;
        const r = stepBall(ball, STEP, hole);
        if (r.sunk) {
          finishHole(true, now);
          break;
        }
        if (r.stopped) {
          if (strokes >= MAX_STROKES) finishHole(false, now);
          else mode = 'aim';
          break;
        }
      }
    } else if (mode === 'sunk') {
      if (now >= sunkUntil) {
        if (holeIdx >= HOLES.length - 1) {
          if (underParTotal <= 0) ctx.achieve('under-par');
          mode = 'over';
          endAt = now + END_DELAY;
        } else {
          initHole(holeIdx + 1, now);
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
    setData();
  });

  function setData(): void {
    if (!import.meta.env.DEV) return;
    const r = ctx.root as HTMLElement;
    r.dataset.mode = mode;
    r.dataset.hole = String(holeIdx + 1);
    r.dataset.par = String(hole.par);
    r.dataset.strokes = String(strokes);
    r.dataset.score = String(score);
    r.dataset.holesdone = String(holesDone);
    r.dataset.aces = String(acesMade);
    r.dataset.birdies = String(birdies);
    r.dataset.underpar = String(underParTotal);
    r.dataset.ball = `${ball.x.toFixed(1)},${ball.y.toFixed(1)}`;
    r.dataset.cup = `${hole.cup.x},${hole.cup.y}`;
    r.dataset.tee = `${hole.tee.x},${hole.tee.y}`;
    r.dataset.moving = mode === 'roll' ? '1' : '0';
  }

  // ---- 描画 ----
  function draw(now: number): void {
    // グリーン
    g.fillStyle = '#2f8f4e';
    g.fillRect(0, 0, W, 640);
    g.fillStyle = '#2a8347';
    for (let y = 100; y < 596; y += 22) {
      if (((y / 22) | 0) % 2 === 0) g.fillRect(20, y, 320, 11);
    }
    // 外周のふち
    g.strokeStyle = '#e6ead0';
    g.lineWidth = 5;
    g.strokeRect(20, 100, 320, 496);

    // 砂（バンカー）
    for (const s of hole.sand) {
      g.fillStyle = '#e8d59a';
      g.beginPath();
      g.ellipse(s.x + s.w / 2, s.y + s.h / 2, s.w / 2, s.h / 2, 0, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = '#d0bd7e';
      g.lineWidth = 2;
      g.stroke();
    }

    // かべ（外周いがい＝飾りかべ）
    g.strokeStyle = '#8a6a45';
    g.lineWidth = 8;
    g.lineCap = 'round';
    for (const s of hole.walls) {
      if (s.x1 === 20 && s.x2 === 20) continue; // 外周は描かない（下で別描画済み）
      if (s.y1 === 100 && s.y2 === 100) continue;
      if (s.y1 === 596 && s.y2 === 596) continue;
      if (s.x1 === 340 && s.x2 === 340) continue;
      g.beginPath();
      g.moveTo(s.x1, s.y1);
      g.lineTo(s.x2, s.y2);
      g.stroke();
    }

    // カップ（穴）＋ピン旗
    g.fillStyle = '#14331e';
    g.beginPath();
    g.arc(hole.cup.x, hole.cup.y, CUP_R, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#0c2415';
    g.lineWidth = 2;
    g.stroke();
    if (mode !== 'sunk' || Math.floor(now / 120) % 2 === 0) {
      g.strokeStyle = '#f2f2f2';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(hole.cup.x, hole.cup.y);
      g.lineTo(hole.cup.x, hole.cup.y - 40);
      g.stroke();
      g.fillStyle = '#e0483c';
      g.beginPath();
      g.moveTo(hole.cup.x, hole.cup.y - 40);
      g.lineTo(hole.cup.x + 20, hole.cup.y - 33);
      g.lineTo(hole.cup.x, hole.cup.y - 26);
      g.closePath();
      g.fill();
    }

    // ティー位置マーク
    g.strokeStyle = 'rgba(255,255,255,.35)';
    g.lineWidth = 2;
    g.beginPath();
    g.arc(hole.tee.x, hole.tee.y, BALL_R + 5, 0, Math.PI * 2);
    g.stroke();

    // 引っぱりガイド
    if (mode === 'aim' && dragStart && dragNow) {
      const dx = dragNow.x - dragStart.x;
      const dy = dragNow.y - dragStart.y;
      const len = Math.hypot(dx, dy);
      if (len >= MIN_PULL) {
        const power = clamp(len * PULL_SCALE, 60, MAX_PUTT);
        const gl = 24 + (power / MAX_PUTT) * 130;
        const nx = -dx / len;
        const ny = -dy / len;
        g.strokeStyle = power >= MAX_PUTT ? '#ff9a4a' : 'rgba(255,255,255,.85)';
        g.lineWidth = 4;
        g.setLineDash([7, 7]);
        g.beginPath();
        g.moveTo(ball.x, ball.y);
        g.lineTo(ball.x + nx * gl, ball.y + ny * gl);
        g.stroke();
        g.setLineDash([]);
        // 矢じり
        g.beginPath();
        g.moveTo(ball.x + nx * (gl + 9), ball.y + ny * (gl + 9));
        g.lineTo(ball.x + nx * gl - ny * 6, ball.y + ny * gl + nx * 6);
        g.lineTo(ball.x + nx * gl + ny * 6, ball.y + ny * gl - nx * 6);
        g.closePath();
        g.fillStyle = g.strokeStyle;
        g.fill();
      }
    }

    // ボール
    if (mode !== 'over') {
      g.fillStyle = '#ffffff';
      g.beginPath();
      g.arc(ball.x, ball.y, BALL_R, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = 'rgba(0,0,0,.12)';
      g.beginPath();
      g.arc(ball.x + 2, ball.y + 2, BALL_R, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#ffffff';
      g.beginPath();
      g.arc(ball.x, ball.y, BALL_R, 0, Math.PI * 2);
      g.fill();
    }

    // HUD
    g.fillStyle = 'rgba(8,30,16,.9)';
    g.fillRect(0, 0, W, HUD_H);
    g.textBaseline = 'middle';
    g.textAlign = 'left';
    g.fillStyle = '#fff';
    g.font = 'bold 18px sans-serif';
    g.fillText(`${score}てん`, 12, HUD_H / 2);
    g.fillStyle = '#cdeccd';
    g.font = 'bold 15px sans-serif';
    g.fillText(`H${holeIdx + 1}/9  パー${hole.par}`, 118, HUD_H / 2);
    g.textAlign = 'right';
    g.fillStyle = strokes > hole.par ? '#ffce7a' : '#fff';
    g.fillText(`${strokes}打`, W - 12, HUD_H / 2);

    // 下部ヒント
    g.textAlign = 'center';
    if (mode === 'aim') {
      g.fillStyle = 'rgba(255,255,255,.85)';
      g.font = 'bold 14px sans-serif';
      g.fillText('ボールを 引っぱって はなす → パット！', W / 2, 618);
    }

    // バナー
    let banner = '';
    let sub = '';
    if (mode === 'intro') {
      banner = `ホール ${holeIdx + 1}`;
      sub = `パー ${hole.par}`;
    } else if (mode === 'sunk') {
      banner = lastAce ? 'ホールインワン！' : lastGain >= 250 ? 'ナイスバーディ！' : lastGain >= 200 ? 'パー！' : 'カップイン';
      sub = `+${lastGain}てん`;
    } else if (mode === 'over') {
      banner = 'ラウンド しゅうりょう！';
      sub = `${holesDone}ホール / ${score}てん`;
    }
    if (banner) {
      g.fillStyle = 'rgba(6,24,14,.66)';
      g.fillRect(40, 250, W - 80, 108);
      g.fillStyle = '#fff';
      g.textAlign = 'center';
      g.font = 'bold 27px sans-serif';
      g.fillText(banner, W / 2, 292);
      g.fillStyle = '#cdeccd';
      g.font = 'bold 17px sans-serif';
      g.fillText(sub, W / 2, 326);
    }
  }

  return {
    start() {
      initHole(0, ctx.now());
      draw(ctx.now());
      setData();
    },
    pause() {
      hostPaused = true;
      dragId = -1;
      dragStart = null;
      dragNow = null;
    },
    resume() {
      hostPaused = false;
    },
    resize() {
      draw(ctx.now());
    },
    destroy() {
      offDown();
      offMove();
      offUp();
      offFrame();
    },
  };
}
