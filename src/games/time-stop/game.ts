// =============================================================
// とまった せかい（No.108・かくれゲーム）: 指を動かしたぶんだけ 時間がすすむ
// =============================================================
// - 高難度のねらい: 反射神経では解けない。指を止めれば世界は完全に止まるので、
//   いくらでも考えられる。そのかわり「動ける きょり」に上限があり、
//   よけるための むだ動きも コストになる＝道の選び方が勝負。
// - じゃまものの位置は 世界時間 wt の関数（logic.hazardPos）。当たり判定は
//   固定サブステップで進めるので、指を大きく動かしても すり抜けない。
// - import してよいのは game-api（types / helpers）と、このフォルダ内（logic）だけ。
import type { GameContext, IGame, PointerInfo } from '../../game-api/types';
import { pushOutCircleFromRect } from '../../game-api/helpers';
import {
  PLAYER_R,
  SEC_PER_PX,
  STAGES,
  SUB_DT,
  type Stage,
  hazardPos,
  isHit,
  stageScore,
} from './logic';

const W = 360;
const H = 640;
const HUD_H = 46;
const GAUGE_Y = 58;
const GAUGE_H = 16;

const CLEAR_MS = 1200;
const FAIL_MS = 1300;
const END_DELAY = 2400;
const SCORE_HI = 1100;

const C_BG = '#0e1220';
const C_FIELD = '#161d34';
const C_WALL = '#2c3a63';
const C_TEXT = '#e9eeff';
const C_DIM = '#8b97bd';
const C_ME = '#5ce1a6';
const C_HAZ = '#ff6b6b';
const C_STAR = '#ffd54a';
const C_OK = '#43c98a';
const C_NG = '#e0483c';

type Mode = 'play' | 'cleared' | 'failed' | 'done';

export function createGame(ctx: GameContext): IGame {
  const cv = ctx.canvas2d({ design: { w: W, h: H } });
  const g = cv.ctx;

  let stageIdx = 0;
  let stage: Stage = STAGES[0]!;
  let px = 0;
  let py = 0;
  /** 世界時間（秒）。指を動かしたぶんだけ すすむ */
  let wt = 0;
  let budget = 0;
  let taken: boolean[] = [];
  let mode: Mode = 'play';
  let started = false;
  let hostPaused = false;
  let ended = false;
  let score = 0;
  let cleared = 0;
  let retries = 0;
  let thrifty = false;
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let phaseUntil = 0;
  let lastEvent = '';

  function resetStage(): void {
    stage = STAGES[stageIdx]!;
    px = stage.start.x;
    py = stage.start.y;
    wt = 0;
    budget = stage.budget;
    taken = stage.stars.map(() => false);
    dragging = false;
    mode = 'play';
  }

  function loadStage(i: number): void {
    stageIdx = i;
    resetStage();
  }
  loadStage(0);

  // ---------- うごき ----------
  function stepBy(dx: number, dy: number): void {
    const dist = Math.hypot(dx, dy);
    if (dist <= 0) return;
    const useDist = Math.min(dist, budget);
    const k = useDist / dist;
    const mx = dx * k;
    const my = dy * k;
    budget -= useDist;
    const total = useDist * SEC_PER_PX;
    const n = Math.max(1, Math.ceil(total / SUB_DT));
    for (let i = 0; i < n; i++) {
      px += mx / n;
      py += my / n;
      // かべ
      const c = { x: px, y: py };
      for (const r of stage.walls) pushOutCircleFromRect(c, PLAYER_R, r);
      px = c.x;
      py = c.y;
      wt += total / n;
      // ほし
      for (let s = 0; s < stage.stars.length; s++) {
        if (taken[s]) continue;
        const st = stage.stars[s]!;
        if (Math.hypot(px - st.x, py - st.y) < PLAYER_R + 12) {
          taken[s] = true;
          ctx.sfx('combo');
        }
      }
      if (isHit(stage, wt, px, py)) {
        fail('hit');
        return;
      }
      if (taken.every((t) => t)) {
        clearStage();
        return;
      }
    }
    if (budget <= 0 && mode === 'play') fail('empty');
  }

  function clearStage(): void {
    const pts = stageScore(budget);
    score += pts;
    cleared++;
    if (budget >= stage.budget / 2) {
      thrifty = true;
      ctx.achieve('thrifty');
    }
    if (cleared === 1) ctx.achieve('first-escape');
    if (cleared >= 3) ctx.achieve('half');
    mode = 'cleared';
    phaseUntil = ctx.now() + CLEAR_MS;
    ctx.sfx('medal');
    ctx.haptic('success');
    lastEvent = `clear:${stageIdx}:${pts}:${Math.round(budget)}`;
  }

  function fail(why: string): void {
    retries++;
    mode = 'failed';
    phaseUntil = ctx.now() + FAIL_MS;
    ctx.sfx('fail');
    ctx.haptic('error');
    lastEvent = `fail:${stageIdx}:${why}`;
  }

  // ---------- 入力（そうたい ドラッグ: 指の動きぶんだけ 自分が動く） ----------
  const offDown = ctx.input.onDown((p: PointerInfo) => {
    if (hostPaused || !started || mode !== 'play') return;
    const l = cv.toLocal(p);
    dragging = true;
    lastX = l.x;
    lastY = l.y;
  });
  const offMove = ctx.input.onMove((p: PointerInfo) => {
    if (hostPaused || !started || mode !== 'play' || !dragging) return;
    const l = cv.toLocal(p);
    const dx = l.x - lastX;
    const dy = l.y - lastY;
    lastX = l.x;
    lastY = l.y;
    stepBy(dx, dy);
  });
  const offUp = ctx.input.onUp(() => {
    dragging = false;
  });

  // ---------- 毎フレーム（時間は すすめない。表示の更新だけ） ----------
  const offFrame = ctx.onFrame(() => {
    if (hostPaused || !started) return;
    const now = ctx.now();
    if (mode === 'cleared' && now >= phaseUntil) {
      if (stageIdx + 1 >= STAGES.length) finish(now);
      else loadStage(stageIdx + 1);
    } else if (mode === 'failed' && now >= phaseUntil) {
      resetStage();
    } else if (mode === 'done' && !ended && now >= phaseUntil) {
      ended = true;
      ctx.end({ score });
      return;
    }
    draw();
    setData();
  });

  function finish(now: number): void {
    ctx.achieve('all-clear');
    if (retries === 0) ctx.achieve('no-retry');
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
    r.dataset.stage = String(stageIdx);
    r.dataset.x = px.toFixed(2);
    r.dataset.y = py.toFixed(2);
    r.dataset.wt = wt.toFixed(4);
    r.dataset.budget = budget.toFixed(1);
    r.dataset.stars = `${taken.filter(Boolean).length}/${stage.stars.length}`;
    r.dataset.got = taken.map((t) => (t ? '1' : '0')).join('');
    r.dataset.retries = String(retries);
    r.dataset.score = String(score);
    r.dataset.cleared = String(cleared);
    r.dataset.thrifty = thrifty ? '1' : '0';
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

  function drawStar(cx: number, cy: number, r: number, color: string): void {
    g.fillStyle = color;
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const rr = i % 2 === 0 ? r : r * 0.45;
      const x = cx + Math.cos(a) * rr;
      const y = cy + Math.sin(a) * rr;
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.closePath();
    g.fill();
  }

  function draw(): void {
    cv.clear(C_BG);

    // HUD
    g.fillStyle = '#080b16';
    g.fillRect(0, 0, W, HUD_H);
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.fillStyle = C_TEXT;
    g.font = 'bold 18px sans-serif';
    g.fillText(`${score}てん`, 12, HUD_H / 2);
    g.fillStyle = C_DIM;
    g.font = 'bold 13px sans-serif';
    g.fillText(`ステージ ${Math.min(stageIdx + 1, STAGES.length)}/${STAGES.length}`, 116, HUD_H / 2 - 8);
    g.fillText(`やりなおし ${retries}かい`, 116, HUD_H / 2 + 9);

    if (mode === 'done') {
      g.textAlign = 'center';
      g.fillStyle = C_TEXT;
      g.font = 'bold 26px sans-serif';
      g.fillText('ぜんぶ ぬけた！', W / 2, 280);
      g.font = 'bold 34px sans-serif';
      g.fillStyle = C_ME;
      g.fillText(`${score}てん`, W / 2, 336);
      g.fillStyle = C_DIM;
      g.font = 'bold 14px sans-serif';
      g.fillText(`クリア ${cleared} / ${STAGES.length}・やりなおし ${retries}かい`, W / 2, 380);
      return;
    }

    // うごける きょり
    const ratio = Math.max(0, budget / stage.budget);
    g.fillStyle = 'rgba(139,151,189,.22)';
    roundRect(20, GAUGE_Y, 320, GAUGE_H, 8);
    g.fill();
    g.fillStyle = ratio > 0.35 ? C_OK : ratio > 0.15 ? '#ffb44a' : C_NG;
    roundRect(20, GAUGE_Y, 320 * ratio, GAUGE_H, 8);
    g.fill();
    g.textAlign = 'center';
    g.fillStyle = C_TEXT;
    g.font = 'bold 11px sans-serif';
    g.fillText(`うごける きょり ${Math.round(budget)}`, W / 2, GAUGE_Y + GAUGE_H / 2);

    // 盤
    g.fillStyle = C_FIELD;
    g.fillRect(0, 96, W, 464);
    for (const r of stage.walls) {
      // わく（画面の外まで のびている かべ）は 盤の内がわだけ 描く
      const x0 = Math.max(0, r.x);
      const y0 = Math.max(96, r.y);
      const x1 = Math.min(W, r.x + r.w);
      const y1 = Math.min(560, r.y + r.h);
      if (x1 <= x0 || y1 <= y0) continue;
      g.fillStyle = C_WALL;
      roundRect(x0, y0, x1 - x0, y1 - y0, 4);
      g.fill();
    }

    // ほし
    for (let i = 0; i < stage.stars.length; i++) {
      const s = stage.stars[i]!;
      if (taken[i]) {
        g.strokeStyle = 'rgba(255,213,74,.3)';
        g.lineWidth = 1.5;
        g.beginPath();
        g.arc(s.x, s.y, 9, 0, Math.PI * 2);
        g.stroke();
      } else {
        drawStar(s.x, s.y, 12, C_STAR);
      }
    }

    // じゃまもの
    for (const h of stage.hazards) {
      const p = hazardPos(h, wt);
      if (h.kind === 'runner') {
        g.fillStyle = C_HAZ;
        g.beginPath();
        g.arc(p.x, p.y, h.r, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = 'rgba(255,255,255,.5)';
        g.beginPath();
        g.arc(p.x - h.r * 0.3, p.y - h.r * 0.3, h.r * 0.3, 0, Math.PI * 2);
        g.fill();
      } else {
        g.strokeStyle = C_HAZ;
        g.lineWidth = h.r * 2;
        g.lineCap = 'round';
        g.beginPath();
        g.moveTo(p.x, p.y);
        g.lineTo(p.x2, p.y2);
        g.stroke();
        g.fillStyle = '#8b1d1d';
        g.beginPath();
        g.arc(p.x, p.y, h.r + 3, 0, Math.PI * 2);
        g.fill();
      }
    }

    // じぶん
    g.fillStyle = mode === 'failed' ? C_NG : C_ME;
    g.beginPath();
    g.arc(px, py, PLAYER_R, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#08301f';
    g.beginPath();
    g.arc(px - 3, py - 2, 1.9, 0, Math.PI * 2);
    g.arc(px + 3, py - 2, 1.9, 0, Math.PI * 2);
    g.fill();

    // じょうたい
    g.textAlign = 'center';
    g.font = 'bold 14px sans-serif';
    if (mode === 'cleared') {
      g.fillStyle = C_OK;
      g.fillText(`クリア！ +${stageScore(budget)}てん`, W / 2, 584);
    } else if (mode === 'failed') {
      g.fillStyle = C_NG;
      g.fillText(lastEvent.endsWith('empty') ? 'きょりが つきた…' : 'ぶつかった！', W / 2, 584);
    } else if (dragging) {
      g.fillStyle = C_TEXT;
      g.fillText('うごいている＝時間が すすむ', W / 2, 584);
    } else {
      g.fillStyle = C_DIM;
      g.fillText('とまっている＝世界も とまっている', W / 2, 584);
    }
    g.fillStyle = C_DIM;
    g.font = 'bold 11px sans-serif';
    g.fillText('画面を なぞって うごく（指を止めれば 時間も 止まる）', W / 2, 612);
  }

  draw();
  setData();

  return {
    start() {
      started = true;
    },
    pause() {
      hostPaused = true;
      dragging = false;
    },
    resume() {
      hostPaused = false;
    },
    resize() {
      draw();
    },
    destroy() {
      offDown();
      offMove();
      offUp();
      offFrame();
    },
  };
}
