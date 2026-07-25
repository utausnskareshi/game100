// =============================================================
// はんしゃレーザー（No.98）: 鏡をタップで回してレーザーを宝石に通すパズル
// =============================================================
// - 鏡(/ か \)をタップで 90°回転。発射口からのレーザーを反射させ、全宝石を通す（爆弾は避ける）。
// - 盤面は logic.makeLevel（構成的に可解＋スクランブルで未解に・rng決定論）。全5面。
// - レーザーは毎フレーム trace（小さい盤なので軽い）。スコアは手数ベース＝時間非依存の決定論。
// - import してよいのは game-api（types / helpers）と、このフォルダ内（logic）だけ。
import type { GameContext, IGame, PointerInfo } from '../../game-api/types';
import { type Level, type Orient, STAGES, makeLevel, solved, trace } from './logic';

const W = 360;
const H = 640;
const HUD_H = 46;
const CELEBRATE_MS = 1000;
const END_DELAY = 2000;
const SCORE_HI = 900;

type Mode = 'play' | 'solved' | 'done';

export function createGame(ctx: GameContext): IGame {
  const cv = ctx.canvas2d({ design: { w: W, h: H } });
  const g = cv.ctx;

  let mode: Mode = 'play';
  let started = false;
  let hostPaused = false;
  let ended = false;

  let stage = 0;
  let level: Level;
  let orient: Orient[] = [];
  let taps = 0;
  let minFlips = 0;
  let score = 0;
  let clears = 0;
  let gemGot = false;
  let CS = 50;
  let ox = 0;
  let oy = HUD_H;
  let phaseUntil = 0;
  let lastEvent = '';

  function loadLevel(idx: number): void {
    level = makeLevel(ctx.random, idx);
    stage = idx;
    orient = level.mirrors.map((m) => m.init);
    minFlips = level.mirrors.reduce((n, m) => n + (m.init !== m.sol ? 1 : 0), 0);
    taps = 0;
    const availH = H - HUD_H - 40;
    CS = Math.min(56, Math.floor((W - 24) / level.cols), Math.floor(availH / level.rows));
    ox = Math.floor((W - CS * level.cols) / 2);
    oy = HUD_H + 8 + Math.floor((availH - CS * level.rows) / 2);
  }

  loadLevel(0);

  const cx = (x: number): number => ox + (x + 0.5) * CS;
  const cy = (y: number): number => oy + (y + 0.5) * CS;

  function checkSolved(now: number): void {
    if (solved(level, orient)) solveLevel(now);
  }

  function solveLevel(now: number): void {
    if (mode !== 'play') return;
    mode = 'solved';
    phaseUntil = now + CELEBRATE_MS;
    const eff = taps <= minFlips;
    score += 200 + (eff ? 100 : 0);
    if (eff) ctx.achieve('efficient');
    if (stage === 0) ctx.achieve('first-clear');
    clears++;
    if (clears >= 3) ctx.achieve('clear-3');
    if (score >= SCORE_HI) ctx.achieve('score-hi');
    ctx.sfx('medal');
    ctx.haptic('success');
    lastEvent = `clear:${stage}`;
  }

  // ---- 入力（鏡をタップで回転） ----
  const offTap = ctx.input.onTap((p: PointerInfo) => {
    if (hostPaused || !started || mode !== 'play') return;
    const l = cv.toLocal(p);
    const gx = Math.floor((l.x - ox) / CS);
    const gy = Math.floor((l.y - oy) / CS);
    const mi = level.mirrors.findIndex((m) => m.x === gx && m.y === gy);
    if (mi < 0) return;
    orient[mi] = orient[mi] === '/' ? '\\' : '/';
    taps++;
    ctx.sfx('tap');
    ctx.haptic('light');
    lastEvent = `rot:${mi}:${orient[mi]}`;
    checkSolved(ctx.now());
  });

  // ---- 毎フレーム ----
  const offFrame = ctx.onFrame(() => {
    if (hostPaused || !started) return;
    const now = ctx.now();
    if (mode === 'solved' && now >= phaseUntil) {
      if (stage + 1 >= STAGES.length) {
        ctx.achieve('all-clear');
        mode = 'done';
        phaseUntil = now + END_DELAY;
      } else {
        loadLevel(stage + 1);
        mode = 'play';
      }
    } else if (mode === 'done' && !ended && now >= phaseUntil) {
      ended = true;
      ctx.end({ score });
      return;
    }
    if (!gemGot && mode === 'play') {
      const tr = trace(level, orient);
      const lit = new Set(tr.path.map((p) => p.y * level.cols + p.x));
      if (level.gems.some((gm) => lit.has(gm.y * level.cols + gm.x))) {
        gemGot = true;
        ctx.achieve('first-gem');
      }
    }
    draw(now);
    setData();
  });

  function setData(): void {
    if (!import.meta.env.DEV) return;
    const r = ctx.root as HTMLElement;
    const tr = trace(level, orient);
    const lit = new Set(tr.path.map((p) => p.y * level.cols + p.x));
    const litGems = level.gems.filter((gm) => lit.has(gm.y * level.cols + gm.x)).length;
    r.dataset.mode = mode;
    r.dataset.stage = String(stage);
    r.dataset.taps = String(taps);
    r.dataset.minflips = String(minFlips);
    r.dataset.litgems = String(litGems);
    r.dataset.gems = String(level.gems.length);
    r.dataset.score = String(score);
    r.dataset.cs = String(CS);
    r.dataset.ox = String(ox);
    r.dataset.oy = String(oy);
    r.dataset.m = JSON.stringify(level.mirrors.map((m, i) => ({ x: m.x, y: m.y, cur: orient[i], sol: m.sol })));
    r.dataset.last = lastEvent;
  }

  // ---- 描画 ----
  function draw(now: number): void {
    cv.clear('#0d1226');
    const bw = CS * level.cols;
    const bh = CS * level.rows;
    // 盤
    g.fillStyle = '#161d3a';
    g.fillRect(ox, oy, bw, bh);
    g.strokeStyle = 'rgba(255,255,255,.06)';
    g.lineWidth = 1;
    for (let x = 0; x <= level.cols; x++) { g.beginPath(); g.moveTo(ox + x * CS, oy); g.lineTo(ox + x * CS, oy + bh); g.stroke(); }
    for (let y = 0; y <= level.rows; y++) { g.beginPath(); g.moveTo(ox, oy + y * CS); g.lineTo(ox + bw, oy + y * CS); g.stroke(); }

    const tr = trace(level, orient);
    const lit = new Set(tr.path.map((p) => p.y * level.cols + p.x));

    // レーザー（発射口→通り道）
    g.strokeStyle = tr.bombHit ? '#ff5a5a' : '#7ee6ff';
    g.lineWidth = 3;
    g.lineCap = 'round';
    g.shadowColor = g.strokeStyle;
    g.shadowBlur = 8;
    const ed = level.emit;
    const edir = [[1, 0], [0, 1], [-1, 0], [0, -1]][ed.dir]!;
    g.beginPath();
    g.moveTo(cx(ed.x) - edir[0]! * CS * 0.5, cy(ed.y) - edir[1]! * CS * 0.5);
    for (const p of tr.path) g.lineTo(cx(p.x), cy(p.y));
    g.stroke();
    g.shadowBlur = 0;

    // 爆弾
    for (const b of level.bombs) {
      g.fillStyle = '#20242e';
      g.beginPath(); g.arc(cx(b.x), cy(b.y), CS * 0.3, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#ff5a5a'; g.lineWidth = 2; g.stroke();
      g.fillStyle = '#ff5a5a';
      g.font = `bold ${Math.round(CS * 0.32)}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('✕', cx(b.x), cy(b.y));
    }
    // 宝石
    for (const gm of level.gems) {
      const on = lit.has(gm.y * level.cols + gm.x);
      g.fillStyle = on ? '#ffd54a' : '#4a5578';
      if (on) { g.shadowColor = '#ffd54a'; g.shadowBlur = 12; }
      const s = CS * 0.24;
      g.beginPath();
      g.moveTo(cx(gm.x), cy(gm.y) - s);
      g.lineTo(cx(gm.x) + s, cy(gm.y));
      g.lineTo(cx(gm.x), cy(gm.y) + s);
      g.lineTo(cx(gm.x) - s, cy(gm.y));
      g.closePath();
      g.fill();
      g.shadowBlur = 0;
    }
    // 鏡
    for (let i = 0; i < level.mirrors.length; i++) {
      const m = level.mirrors[i]!;
      g.strokeStyle = '#cfe0ff';
      g.lineWidth = 4;
      g.lineCap = 'round';
      const r = CS * 0.32;
      g.beginPath();
      if (orient[i] === '/') { g.moveTo(cx(m.x) - r, cy(m.y) + r); g.lineTo(cx(m.x) + r, cy(m.y) - r); }
      else { g.moveTo(cx(m.x) - r, cy(m.y) - r); g.lineTo(cx(m.x) + r, cy(m.y) + r); }
      g.stroke();
      // タップできる印
      g.strokeStyle = 'rgba(126,230,255,.35)';
      g.lineWidth = 1.5;
      g.strokeRect(ox + m.x * CS + 3, oy + m.y * CS + 3, CS - 6, CS - 6);
    }
    // 発射口
    g.fillStyle = '#7ee6ff';
    g.beginPath();
    g.arc(cx(ed.x) - edir[0]! * CS * 0.5, cy(ed.y) - edir[1]! * CS * 0.5, 5, 0, Math.PI * 2);
    g.fill();

    // HUD
    g.fillStyle = 'rgba(13,18,38,.9)';
    g.fillRect(0, 0, W, HUD_H);
    g.fillStyle = '#fff';
    g.font = 'bold 18px sans-serif'; g.textAlign = 'left'; g.textBaseline = 'middle';
    g.fillText(`${score}てん`, 12, HUD_H / 2);
    g.fillStyle = '#9fe3ff';
    g.font = 'bold 13px sans-serif';
    const litGems = level.gems.filter((gm) => lit.has(gm.y * level.cols + gm.x)).length;
    g.fillText(`ステージ ${stage + 1}/${STAGES.length}`, 108, HUD_H / 2 - 8);
    g.fillText(`宝石 ${litGems}/${level.gems.length}・${taps}タップ`, 108, HUD_H / 2 + 9);

    if (stage === 0 && taps === 0 && mode === 'play') {
      g.fillStyle = 'rgba(158,227,255,.9)';
      g.font = 'bold 14px sans-serif'; g.textAlign = 'center';
      g.fillText('鏡をタップで まわして', W / 2, H - 32);
      g.fillText('光を ぜんぶの宝石に とおそう', W / 2, H - 14);
    }
    if (mode === 'solved') {
      g.fillStyle = '#ffd54a'; g.font = 'bold 30px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.strokeStyle = '#0d1226'; g.lineWidth = 4;
      g.strokeText('クリア！', W / 2, oy + bh + 24);
      g.fillText('クリア！', W / 2, oy + bh + 24);
    }
    if (mode === 'done') {
      g.fillStyle = 'rgba(13,18,38,.86)'; g.fillRect(0, 0, W, H);
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillStyle = '#fff'; g.font = 'bold 30px sans-serif';
      g.fillText('ぜんめん クリア！', W / 2, H / 2 - 40);
      g.font = 'bold 26px sans-serif'; g.fillText(`${score}てん`, W / 2, H / 2 + 4);
      g.fillStyle = '#ffd54a'; g.font = 'bold 15px sans-serif'; g.fillText('レーザーマスター！', W / 2, H / 2 + 38);
    }
    void now;
  }

  draw(ctx.now());
  setData();

  return {
    start() { started = true; },
    pause() { hostPaused = true; },
    resume() { hostPaused = false; },
    resize() { draw(ctx.now()); },
    destroy() { offTap(); offFrame(); },
  };
}
