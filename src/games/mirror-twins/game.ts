// =============================================================
// かがみワールド（No.99）: 本体と鏡の分身を1入力で同時操作するパズル
// =============================================================
// - スワイプで本体を動かすと、分身が「左右反対」に動く（上下は同じ）。壁で片方だけ止まると ズレる。
//   2体を同時に それぞれのゴールへ。トゲを踏むと そのステージの最初へ戻る（やり直し）。全5面。
// - 盤面は logic.makeLevel（構成的に可解＋トゲは解の道の外・rng決定論）。
// - スコアは手数ベース＝時間非依存の決定論。
// - import してよいのは game-api（types / helpers）と、このフォルダ内（logic）だけ。
import type { GameContext, IGame, SwipeDir } from '../../game-api/types';
import { type Dir, type Level, type Pt, STAGES, makeLevel, mirror, moveChar } from './logic';

const W = 360;
const H = 640;
const HUD_H = 46;
const CELEBRATE_MS = 1000;
const END_DELAY = 2000;
const FLASH_MS = 320;
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
  let wallSet = new Set<number>();
  let spikeSet = new Set<number>();
  let main: Pt = { x: 0, y: 0 };
  let twin: Pt = { x: 0, y: 0 };
  let movesSinceReset = 0;
  let spikeHit = false;
  let score = 0;
  let clears = 0;
  let CS = 54;
  let ox = 0;
  let oy = HUD_H;
  let phaseUntil = 0;
  let flashUntil = 0;
  let lastEvent = '';

  function loadLevel(idx: number): void {
    level = makeLevel(ctx.random, idx);
    stage = idx;
    wallSet = new Set(level.walls);
    spikeSet = new Set(level.spikes);
    main = { ...level.mainStart };
    twin = { ...level.twinStart };
    movesSinceReset = 0;
    spikeHit = false;
    const availH = H - HUD_H - 44;
    CS = Math.min(58, Math.floor((W - 24) / level.cols), Math.floor(availH / level.rows));
    ox = Math.floor((W - CS * level.cols) / 2);
    oy = HUD_H + 10 + Math.floor((availH - CS * level.rows) / 2);
  }

  loadLevel(0);

  const cxp = (x: number): number => ox + (x + 0.5) * CS;
  const cyp = (y: number): number => oy + (y + 0.5) * CS;
  const same = (a: Pt, b: Pt): boolean => a.x === b.x && a.y === b.y;
  const cell = (p: Pt): number => p.y * level.cols + p.x;

  function solveLevel(now: number): void {
    if (mode !== 'play') return;
    mode = 'solved';
    phaseUntil = now + CELEBRATE_MS;
    const eff = movesSinceReset <= level.par;
    score += 200 + (eff ? 100 : 0);
    if (eff) ctx.achieve('efficient');
    if (!spikeHit) ctx.achieve('no-reset');
    if (stage === 0) ctx.achieve('first-clear');
    clears++;
    if (clears >= 3) ctx.achieve('clear-3');
    if (score >= SCORE_HI) ctx.achieve('score-hi');
    ctx.sfx('medal');
    ctx.haptic('success');
    lastEvent = `clear:${stage}`;
  }

  function applyMove(d: Dir, now: number): void {
    const nm = moveChar(main, d, wallSet, level.cols, level.rows);
    const nt = moveChar(twin, mirror(d), wallSet, level.cols, level.rows);
    if (same(nm, main) && same(nt, twin)) return; // 両方とも動けない＝無効
    main = nm;
    twin = nt;
    movesSinceReset++;
    // トゲ判定（どちらかが踏んだら やり直し）
    if (spikeSet.has(cell(main)) || spikeSet.has(cell(twin))) {
      main = { ...level.mainStart };
      twin = { ...level.twinStart };
      movesSinceReset = 0;
      spikeHit = true;
      flashUntil = now + FLASH_MS;
      ctx.sfx('fail');
      ctx.haptic('error');
      lastEvent = 'spike';
      return;
    }
    ctx.sfx('tap');
    ctx.haptic('light');
    lastEvent = `move:${d}`;
    if (same(main, level.mainGoal) && same(twin, level.twinGoal)) solveLevel(now);
  }

  // ---- 入力（スワイプで同時操作） ----
  const swipeMap: Record<SwipeDir, Dir> = { up: 'U', down: 'D', left: 'L', right: 'R' };
  const offSwipe = ctx.input.onSwipe((d: SwipeDir) => {
    if (hostPaused || !started || mode !== 'play') return;
    applyMove(swipeMap[d], ctx.now());
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
    draw(now);
    setData();
  });

  function setData(): void {
    if (!import.meta.env.DEV) return;
    const r = ctx.root as HTMLElement;
    r.dataset.mode = mode;
    r.dataset.stage = String(stage);
    r.dataset.moves = String(movesSinceReset);
    r.dataset.par = String(level.par);
    r.dataset.score = String(score);
    r.dataset.spikehit = spikeHit ? '1' : '0';
    r.dataset.main = `${main.x},${main.y}`;
    r.dataset.twin = `${twin.x},${twin.y}`;
    r.dataset.ongoal = same(main, level.mainGoal) && same(twin, level.twinGoal) ? '1' : '0';
    r.dataset.sol = JSON.stringify(level.solution);
    r.dataset.last = lastEvent;
  }

  // ---- 描画 ----
  function draw(now: number): void {
    cv.clear('#171a2e');
    const bw = CS * level.cols;
    const bh = CS * level.rows;
    g.fillStyle = '#20263f';
    g.fillRect(ox, oy, bw, bh);
    // 鏡の軸（中央）
    g.strokeStyle = 'rgba(180,200,255,.18)';
    g.setLineDash([5, 5]);
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(ox + bw / 2, oy);
    g.lineTo(ox + bw / 2, oy + bh);
    g.stroke();
    g.setLineDash([]);
    // グリッド線
    g.strokeStyle = 'rgba(255,255,255,.05)';
    g.lineWidth = 1;
    for (let x = 0; x <= level.cols; x++) { g.beginPath(); g.moveTo(ox + x * CS, oy); g.lineTo(ox + x * CS, oy + bh); g.stroke(); }
    for (let y = 0; y <= level.rows; y++) { g.beginPath(); g.moveTo(ox, oy + y * CS); g.lineTo(ox + bw, oy + y * CS); g.stroke(); }
    // 壁
    g.fillStyle = '#39406a';
    for (const w of level.walls) g.fillRect(ox + (w % level.cols) * CS + 1, oy + ((w / level.cols) | 0) * CS + 1, CS - 2, CS - 2);
    // トゲ
    g.fillStyle = '#ff5a6a';
    for (const s of level.spikes) {
      const sx = ox + (s % level.cols) * CS;
      const sy = oy + ((s / level.cols) | 0) * CS;
      for (let i = 0; i < 3; i++) {
        g.beginPath();
        g.moveTo(sx + 6 + i * (CS - 12) / 3, sy + CS - 6);
        g.lineTo(sx + 6 + i * (CS - 12) / 3 + (CS - 12) / 6, sy + 8);
        g.lineTo(sx + 6 + (i + 1) * (CS - 12) / 3, sy + CS - 6);
        g.closePath();
        g.fill();
      }
    }
    // ゴール
    const goal = (p: Pt, col: string): void => {
      g.strokeStyle = col;
      g.lineWidth = 3;
      g.beginPath();
      g.arc(cxp(p.x), cyp(p.y), CS * 0.34, 0, Math.PI * 2);
      g.stroke();
      g.fillStyle = col;
      g.globalAlpha = 0.18;
      g.beginPath();
      g.arc(cxp(p.x), cyp(p.y), CS * 0.34, 0, Math.PI * 2);
      g.fill();
      g.globalAlpha = 1;
    };
    goal(level.mainGoal, '#5aa0ff');
    goal(level.twinGoal, '#ff7ab0');
    // キャラ（分身→本体の順で重なっても見えるように）
    const drawChar = (p: Pt, col: string, dark: string): void => {
      g.fillStyle = col;
      g.beginPath();
      g.arc(cxp(p.x), cyp(p.y), CS * 0.28, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = dark;
      g.beginPath();
      g.arc(cxp(p.x) - 4, cyp(p.y) - 3, 2.6, 0, Math.PI * 2);
      g.arc(cxp(p.x) + 4, cyp(p.y) - 3, 2.6, 0, Math.PI * 2);
      g.fill();
    };
    drawChar(twin, '#ff7ab0', '#5a1e3a');
    drawChar(main, '#5aa0ff', '#12244a');

    // フラッシュ（トゲ）
    if (now < flashUntil) {
      const a = (flashUntil - now) / FLASH_MS;
      g.fillStyle = `rgba(220,60,50,${a * 0.4})`;
      g.fillRect(0, 0, W, H);
    }

    // HUD
    g.fillStyle = 'rgba(23,26,46,.9)';
    g.fillRect(0, 0, W, HUD_H);
    g.fillStyle = '#fff';
    g.font = 'bold 18px sans-serif'; g.textAlign = 'left'; g.textBaseline = 'middle';
    g.fillText(`${score}てん`, 12, HUD_H / 2);
    g.fillStyle = '#bcd0ff';
    g.font = 'bold 13px sans-serif';
    g.fillText(`ステージ ${stage + 1}/${STAGES.length}`, 108, HUD_H / 2 - 8);
    g.fillText(`${movesSinceReset}手（もくひょう ${level.par}）`, 108, HUD_H / 2 + 9);

    if (stage === 0 && movesSinceReset === 0 && mode === 'play') {
      g.fillStyle = 'rgba(188,208,255,.9)';
      g.font = 'bold 14px sans-serif'; g.textAlign = 'center';
      g.fillText('スワイプで うごかすと、鏡の分身は', W / 2, H - 32);
      g.fillText('左右反対に うごく。2人ともゴールへ！', W / 2, H - 14);
    }
    if (mode === 'solved') {
      g.fillStyle = '#8ae0a0'; g.font = 'bold 30px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.strokeStyle = '#171a2e'; g.lineWidth = 4;
      g.strokeText('クリア！', W / 2, oy + bh + 24);
      g.fillText('クリア！', W / 2, oy + bh + 24);
    }
    if (mode === 'done') {
      g.fillStyle = 'rgba(23,26,46,.86)'; g.fillRect(0, 0, W, H);
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillStyle = '#fff'; g.font = 'bold 30px sans-serif';
      g.fillText('ぜんめん クリア！', W / 2, H / 2 - 40);
      g.font = 'bold 26px sans-serif'; g.fillText(`${score}てん`, W / 2, H / 2 + 4);
      g.fillStyle = '#ffd54a'; g.font = 'bold 15px sans-serif'; g.fillText('かがみマスター！', W / 2, H / 2 + 38);
    }
  }

  draw(ctx.now());
  setData();

  return {
    start() { started = true; },
    pause() { hostPaused = true; },
    resume() { hostPaused = false; },
    resize() { draw(ctx.now()); },
    destroy() { offSwipe(); offFrame(); },
  };
}
