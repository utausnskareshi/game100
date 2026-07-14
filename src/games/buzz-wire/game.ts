// =============================================================
// ビリビリワイヤー（No.42）: 電気のワイヤーめいろを、ふれないように ゆびでなぞりきれ！
// =============================================================
// - たまは「ゆびの少し上」に浮く（ゆびで見えなくならない）。みちの外に出るとビリッ⚡＝
//   ライフ−1で直前のチェックポイントへ。3コース（どんどん細く・うねる）。
// - コース生成・幾何は logic.ts（rng注入・消費固定・つづら折り＝重なりなし）。
// - Canvas 360×640・startMode:'immediate'（たまにタッチしたらスタート）。
// - import してよいのは game-api（types / helpers）と、このフォルダ内（logic）だけ
import type { GameContext, IGame } from '../../game-api/types';
import {
  BALL_R,
  COURSE_WIDTHS,
  FINGER_OFFSET_Y,
  GOAL_DIST,
  checkpointIndices,
  cumulative,
  generateCourse,
  projectNear,
  type Pt,
} from './logic';

const W = 360;
const H = 640;
const LIVES = 3;
const COURSE_BASE = 150;
const TIME_BONUS_FROM = 90; // max(0, 90-秒)×2
const NO_ZAP_BONUS = 60;
const PARTIAL_MAX = 60; // 失敗終了時の部分点（進み×60）
const NEXT_MS = 1600;
const END_DELAY = 1900;
const SPEEDY_SEC = 30;

type Mode = 'ready' | 'trace' | 'zap' | 'clear' | 'over';

export function createGame(ctx: GameContext): IGame {
  const cv = ctx.canvas2d({ design: { w: W, h: H } });
  const g = cv.ctx;

  // ---- 状態 ----
  let mode: Mode = 'ready';
  let hostPaused = false;
  let courseIdx = 0;
  let pts: Pt[] = [];
  let cum: number[] = [];
  let cps: number[] = [];
  let width: number = COURSE_WIDTHS[0];
  let ball: Pt = { x: 0, y: 0 };
  let progressS = 0;
  let lastCpS = 0;
  let lastCpPt: Pt = { x: 0, y: 0 };
  let lives = LIVES;
  let zappedThisCourse = false;
  let zappedAny = false;
  let courseStart = 0;
  let started = false; // このコースで一度でもなぞり始めたか
  let score = 0;
  let activePid = -1;
  let zapFlashUntil = 0;
  let nextAt = 0;
  let endAt = 0;
  let ended = false;
  let overReason: 'lives' | 'done' = 'done';

  function buildCourse(): void {
    width = COURSE_WIDTHS[Math.min(courseIdx, COURSE_WIDTHS.length - 1)]!;
    const wobble = [6, 10, 13][Math.min(courseIdx, 2)]!;
    pts = generateCourse(ctx.random, wobble);
    cum = cumulative(pts);
    cps = checkpointIndices(pts);
    ball = { ...pts[0]! };
    progressS = 0;
    lastCpS = 0;
    lastCpPt = { ...pts[0]! };
    zappedThisCourse = false;
    started = false;
    mode = 'ready';
    setData();
  }

  function totalLen(): number {
    return cum[cum.length - 1]!;
  }

  function setData(): void {
    const r = ctx.root as HTMLElement;
    r.dataset.mode = mode;
    r.dataset.course = String(courseIdx);
    r.dataset.lives = String(lives);
    r.dataset.score = String(score);
    if (!import.meta.env.DEV) return;
    r.dataset.progress = (progressS / Math.max(1, totalLen())).toFixed(3);
    r.dataset.ballx = ball.x.toFixed(1);
    r.dataset.bally = ball.y.toFixed(1);
    r.dataset.pts = JSON.stringify(pts.map((p) => [Math.round(p.x), Math.round(p.y)]));
  }

  // ---- 入力（たまをつかんでなぞる）----
  const offDown = ctx.input.onDown((p) => {
    if (hostPaused || (mode !== 'ready' && mode !== 'trace')) return;
    const l = cv.toLocal(p);
    const fx = l.x;
    const fy = l.y + FINGER_OFFSET_Y;
    if (Math.hypot(fx - ball.x, fy - ball.y) < 34) {
      activePid = p.id;
      if (mode === 'ready') {
        mode = 'trace';
        if (!started) {
          started = true;
          courseStart = ctx.now();
        }
        ctx.sfx('start');
      }
      setData();
    }
  });
  const offMove = ctx.input.onMove((p) => {
    if (mode !== 'trace' || hostPaused || p.id !== activePid) return;
    const l = cv.toLocal(p);
    moveBall({ x: l.x, y: l.y + FINGER_OFFSET_Y });
  });
  const offUp = ctx.input.onUp((p) => {
    if (p.id !== activePid) return;
    activePid = -1;
    // ゆびを離したら いったん休憩（たまはその場・ふたたびタッチで再開）
    if (mode === 'trace') {
      mode = 'ready';
      setData();
    }
  });

  function moveBall(to: Pt): void {
    // 速いスワイプの「とび」をふせぐため、途中を刻んで判定する
    const steps = Math.max(1, Math.ceil(Math.hypot(to.x - ball.x, to.y - ball.y) / 6));
    for (let k = 1; k <= steps; k++) {
      const q = { x: ball.x + ((to.x - ball.x) * k) / steps, y: ball.y + ((to.y - ball.y) * k) / steps };
      const pr = projectNear(pts, cum, q, progressS);
      if (pr.dist > width / 2) {
        zap();
        return;
      }
      ball = q;
      if (pr.s > progressS) progressS = pr.s;
      // チェックポイント更新
      for (const ci of cps) {
        if (cum[ci]! <= progressS && cum[ci]! > lastCpS) {
          lastCpS = cum[ci]!;
          lastCpPt = { ...pts[ci]! };
          ctx.sfx('tick');
          ctx.haptic('light');
        }
      }
    }
    // ゴール判定
    const goal = pts[pts.length - 1]!;
    if (progressS >= totalLen() - 24 && Math.hypot(ball.x - goal.x, ball.y - goal.y) < GOAL_DIST) {
      clearCourse();
    }
    setData();
  }

  function zap(): void {
    lives--;
    zappedThisCourse = true;
    zappedAny = true;
    zapFlashUntil = ctx.now() + 550;
    ctx.sfx('fail');
    ctx.haptic('error');
    activePid = -1;
    if (lives <= 0) {
      // 部分点（このコースの進み）
      score += Math.floor((progressS / Math.max(1, totalLen())) * PARTIAL_MAX);
      overReason = 'lives';
      mode = 'over';
      endAt = ctx.now() + END_DELAY;
    } else {
      ball = { ...lastCpPt };
      progressS = lastCpS;
      mode = 'ready';
    }
    setData();
  }

  function clearCourse(): void {
    const sec = Math.floor((ctx.now() - courseStart) / 1000);
    let s = COURSE_BASE + Math.max(0, TIME_BONUS_FROM - sec) * 2;
    if (!zappedThisCourse) s += NO_ZAP_BONUS;
    score += s;
    mode = 'clear';
    ctx.sfx('medal');
    ctx.haptic('success');
    // 実績（クリア時点で即解除）
    ctx.achieve('first-clear');
    if (courseIdx >= 1) ctx.achieve('clear-2');
    if (!zappedThisCourse) ctx.achieve('no-zap-course');
    if (sec <= SPEEDY_SEC) ctx.achieve('speedy');
    if (courseIdx >= 2) {
      ctx.achieve('clear-3');
      if (!zappedAny) ctx.achieve('no-zap-all');
      overReason = 'done';
      nextAt = 0;
      endAt = ctx.now() + END_DELAY;
      mode = 'over';
    } else {
      nextAt = ctx.now() + NEXT_MS;
    }
    setData();
  }

  // ---- 毎フレーム ----
  const offFrame = ctx.onFrame(() => {
    const now = ctx.now();
    if (mode === 'clear' && nextAt > 0 && now >= nextAt) {
      nextAt = 0;
      courseIdx++;
      buildCourse();
    }
    if (mode === 'over' && !ended && now >= endAt) {
      ended = true;
      ctx.end({ score });
      return;
    }
    draw(now);
  });

  // ---- 描画（電気っぽい固定パレット＝両テーマ共通）----
  function drawPath(w2: number, color: string): void {
    g.strokeStyle = color;
    g.lineWidth = w2;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.beginPath();
    g.moveTo(pts[0]!.x, pts[0]!.y);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i]!.x, pts[i]!.y);
    g.stroke();
  }

  function draw(now: number): void {
    g.fillStyle = '#101430';
    g.fillRect(0, 0, W, H);

    if (pts.length > 1) {
      // 通路（外枠 → 面 → 中心ワイヤー）
      drawPath(width + BALL_R * 2 + 4, '#2b3260');
      drawPath(width + BALL_R * 2, '#3a4180');
      g.setLineDash([2, 10]);
      drawPath(2, '#7c8cff');
      g.setLineDash([]);
      // チェックポイント・スタート・ゴール
      for (const ci of cps) {
        const cp = pts[ci]!;
        g.strokeStyle = cum[ci]! <= lastCpS ? '#3ed36a' : '#8a93c8';
        g.lineWidth = 3;
        g.beginPath();
        g.arc(cp.x, cp.y, 10, 0, Math.PI * 2);
        g.stroke();
      }
      const goal = pts[pts.length - 1]!;
      g.font = '24px sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('🏁', goal.x, goal.y - 2);

      // たま（グロー）
      const zapping = now < zapFlashUntil;
      g.fillStyle = zapping ? 'rgba(255,120,80,.35)' : 'rgba(124,140,255,.3)';
      g.beginPath();
      g.arc(ball.x, ball.y, BALL_R + 7, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = zapping ? '#ff7850' : '#e8ecff';
      g.beginPath();
      g.arc(ball.x, ball.y, BALL_R, 0, Math.PI * 2);
      g.fill();
      if (zapping) {
        g.fillStyle = '#ffd23e';
        g.font = 'bold 30px sans-serif';
        g.fillText('⚡', ball.x + 20, ball.y - 18);
      }
    }

    // HUD（左上）
    g.fillStyle = '#dfe4ff';
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.font = 'bold 16px sans-serif';
    g.fillText(`コース ${courseIdx + 1}/3`, 14, 30);
    g.font = 'bold 14px sans-serif';
    let hearts = '';
    for (let i = 0; i < LIVES; i++) hearts += i < lives ? '💛' : '🖤';
    g.fillText(hearts, 14, 54);
    g.fillText(`${score}てん`, 110, 54);
    if (mode === 'trace' || started) {
      const sec = Math.floor((now - courseStart) / 1000);
      g.fillText(`⏱ ${Math.max(0, sec)}`, 190, 54);
    }

    // 案内
    if (mode === 'ready') {
      g.fillStyle = 'rgba(16,20,48,.72)';
      g.fillRect(0, 268, W, 84);
      g.fillStyle = '#fff';
      g.textAlign = 'center';
      g.font = 'bold 20px sans-serif';
      g.fillText(started ? 'たまにタッチで さいかい' : 'たまにタッチで スタート！', W / 2, 300);
      g.font = 'bold 13px sans-serif';
      g.fillText('たまは ゆびの少し上に うくよ。ワイヤーにふれないで！', W / 2, 328);
    }

    if (mode === 'over') {
      g.fillStyle = 'rgba(10,14,36,.72)';
      g.fillRect(0, 0, W, H);
      g.fillStyle = '#fff';
      g.textAlign = 'center';
      g.font = 'bold 32px sans-serif';
      g.fillText(overReason === 'done' ? 'ぜんぶ とおった！ 🎉' : 'ビリビリ… ⚡', W / 2, H / 2 - 40);
      g.font = 'bold 24px sans-serif';
      g.fillText(`${score}てん`, W / 2, H / 2 + 8);
    } else if (mode === 'clear') {
      g.fillStyle = 'rgba(16,20,48,.72)';
      g.fillRect(0, 268, W, 84);
      g.fillStyle = '#3ed36a';
      g.textAlign = 'center';
      g.font = 'bold 24px sans-serif';
      g.fillText(`コースクリア！ つぎは もっと細い…`, W / 2, 310);
    }
  }

  // ---- 起動（startMode:'immediate'）----
  buildCourse();
  draw(0);

  return {
    start() {
      // カウントダウンなし。「たまにタッチでスタート」から
    },
    pause() {
      hostPaused = true;
      activePid = -1;
      if (mode === 'trace') mode = 'ready';
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
