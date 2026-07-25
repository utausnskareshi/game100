// =============================================================
// つなげてパイプ（No.95）: 同じ色の●をドラッグでつなぐ論理パズル（同色つなぎ系）
// =============================================================
// - ●から指でなぞって同じ色の●まで線をつなぐ。線は交差できない。
//   全ペアをつなぎ、かつ全マスをうめると そのステージクリア。全5ステージ。
// - 盤面は logic.makeBoard（ハミルトン路を切る＝構成的に可解＋全マス被覆を保証・rng決定論）。
// - あそび中に別の色の線をなぞると、その線は交点で切れる（引き直せる）。フェイルなし＝じっくり考える。
// - import してよいのは game-api（types / helpers）と、このフォルダ内（logic）だけ。
import type { GameContext, IGame, PointerInfo } from '../../game-api/types';
import { clamp } from '../../game-api/helpers';
import { type Board, STAGES, areAdjacent, makeBoard } from './logic';

const W = 360;
const H = 640;
const HUD_H = 48;
const CELEBRATE_MS = 950;
const END_DELAY = 2000;
const SCORE_HI = 1200;

type Mode = 'play' | 'solved' | 'done';

const COLORS = ['#e0483c', '#3d7df0', '#3ea94f', '#f0b400', '#b05ad0', '#ff7a2f', '#1fb6c8', '#ff7ab0'];
const SOFT = ['rgba(224,72,60,.22)', 'rgba(61,125,240,.22)', 'rgba(62,169,79,.22)', 'rgba(240,180,0,.22)', 'rgba(176,90,208,.22)', 'rgba(255,122,47,.22)', 'rgba(31,182,200,.22)', 'rgba(255,122,176,.22)'];

export function createGame(ctx: GameContext): IGame {
  const cv = ctx.canvas2d({ design: { w: W, h: H } });
  const g = cv.ctx;

  let mode: Mode = 'play';
  let started = false;
  let hostPaused = false;
  let ended = false;

  let stage = 0;
  let board: Board;
  let cols = 0;
  let rows = 0;
  let N = 0;
  let cellColor = new Int16Array(0);
  let dotColor = new Int16Array(0);
  let path: number[][] = [];
  let connected: boolean[] = [];
  let cur = -1; // ドラッグ中の色
  let activePointer = -1; // ドラッグ中のポインタid（単一タッチに限定）
  let CS = 40;
  let ox = 0;
  let oy = HUD_H;

  let score = 0;
  let clears = 0;
  let boardStartNow = 0;
  let phaseUntil = 0;
  let lastEvent = '';

  function loadStage(idx: number, now: number): void {
    stage = idx;
    board = makeBoard(ctx.random, idx);
    cols = board.cols;
    rows = board.rows;
    N = cols * rows;
    cellColor = new Int16Array(N).fill(-1);
    dotColor = new Int16Array(N).fill(-1);
    path = board.dots.map(() => []);
    connected = board.dots.map(() => false);
    for (let c = 0; c < board.colors; c++) {
      const [a, b] = board.dots[c]!;
      cellColor[a] = c;
      cellColor[b] = c;
      dotColor[a] = c;
      dotColor[b] = c;
    }
    const availH = H - HUD_H;
    CS = Math.min(Math.floor(W / cols), Math.floor(availH / rows));
    const bw = CS * cols;
    const bh = CS * rows;
    ox = Math.floor((W - bw) / 2);
    oy = HUD_H + Math.floor((availH - bh) / 2);
    boardStartNow = now;
    cur = -1;
    activePointer = -1;
  }

  loadStage(0, ctx.now());

  const cellAt = (px: number, py: number): number => {
    const cx = Math.floor((px - ox) / CS);
    const cy = Math.floor((py - oy) / CS);
    if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) return -1;
    return cy * cols + cx;
  };
  const centerX = (cell: number): number => ox + ((cell % cols) + 0.5) * CS;
  const centerY = (cell: number): number => oy + (((cell / cols) | 0) + 0.5) * CS;

  function isConnected(c: number): boolean {
    const p = path[c]!;
    if (p.length < 2) return false;
    const s = p[0]!;
    const e = p[p.length - 1]!;
    return dotColor[s] === c && dotColor[e] === c && s !== e;
  }

  function clearPath(c: number): void {
    for (const cell of path[c]!) if (dotColor[cell] !== c) cellColor[cell] = -1;
    path[c] = [];
    connected[c] = false;
  }

  function checkWin(now: number): void {
    for (let c = 0; c < board.colors; c++) connected[c] = isConnected(c);
    if (!connected.every(Boolean)) return;
    let filled = 0;
    for (let i = 0; i < N; i++) if (cellColor[i]! >= 0) filled++;
    if (filled !== N) return;
    solveBoard(now);
  }

  function solveBoard(now: number): void {
    const timeSec = (now - boardStartNow) / 1000;
    const par = cols * rows * 1.4;
    const bonus = Math.max(0, Math.round((par - timeSec) * 4));
    if (bonus > 0) ctx.achieve('speed-clear');
    score += 200 + stage * 50 + bonus;
    if (score >= SCORE_HI) ctx.achieve('score-hi');
    if (stage === 0) ctx.achieve('first-clear');
    clears++;
    if (clears >= 3) ctx.achieve('clear-3');
    mode = 'solved';
    phaseUntil = now + CELEBRATE_MS;
    ctx.sfx('medal');
    ctx.haptic('success');
    lastEvent = `solved:${stage}:${bonus}`;
  }

  // ---- 入力（ドラッグでつなぐ） ----
  const offDown = ctx.input.onDown((p: PointerInfo) => {
    if (hostPaused || !started || mode !== 'play') return;
    if (activePointer >= 0) return; // 単一タッチ：2本目の指は無視
    const l = cv.toLocal(p);
    const c = cellAt(l.x, l.y);
    if (c < 0) return;
    const dc = dotColor[c];
    if (dc === undefined || dc < 0) return; // ●からだけ引き始められる
    activePointer = p.id;
    clearPath(dc);
    cur = dc;
    cellColor[c] = dc;
    path[dc] = [c];
    lastEvent = `grab:${dc}`;
  });

  const offMove = ctx.input.onMove((p: PointerInfo) => {
    if (hostPaused || cur < 0 || p.id !== activePointer || mode !== 'play') return;
    const l = cv.toLocal(p);
    const c = cellAt(l.x, l.y);
    if (c < 0) return;
    const pc = path[cur]!;
    const last = pc[pc.length - 1]!;
    if (c === last) return;
    // 一つ前へ戻る＝リトラクト
    if (pc.length >= 2 && c === pc[pc.length - 2]) {
      const popped = pc.pop()!;
      if (dotColor[popped] !== cur) cellColor[popped] = -1;
      connected[cur] = false;
      return;
    }
    if (!areAdjacent(c, last, cols, rows)) return;
    if (isConnected(cur)) return; // すでにゴール到達（戻る以外は受け付けない）
    const dc = dotColor[c]!;
    if (dc >= 0 && dc !== cur) return; // ほかの色の●には重ねられない
    if (dc === cur) {
      if (c === pc[0]) return; // スタートの●へ戻るループは不可
      // 相手の●に到達＝接続
      pc.push(c);
      connected[cur] = true;
      ctx.achieve('first-connect');
      ctx.sfx('success');
      ctx.haptic('light');
      checkWin(ctx.now());
      return;
    }
    if (cellColor[c] === cur) return; // 自分の線と交差＝不可
    const owner = cellColor[c]!;
    if (owner >= 0 && owner !== cur) {
      // ほかの色の線をなぞった → その交点から先を切る
      const op = path[owner]!;
      const idx = op.indexOf(c);
      if (idx >= 0) {
        const removed = op.splice(idx);
        for (const rc of removed) if (dotColor[rc] !== owner) cellColor[rc] = -1;
        connected[owner] = false;
      }
    }
    cellColor[c] = cur;
    pc.push(c);
    ctx.sfx('tap');
  });

  const offUp = ctx.input.onUp((p: PointerInfo) => {
    if (p.id !== activePointer) return;
    cur = -1;
    activePointer = -1;
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
        loadStage(stage + 1, now);
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
    let filled = 0;
    for (let i = 0; i < N; i++) if (cellColor[i]! >= 0) filled++;
    r.dataset.mode = mode;
    r.dataset.stage = String(stage);
    r.dataset.colors = String(board.colors);
    r.dataset.connected = String(connected.filter(Boolean).length);
    r.dataset.filled = String(filled);
    r.dataset.total = String(N);
    r.dataset.score = String(score);
    r.dataset.cols = String(cols);
    r.dataset.rows = String(rows);
    r.dataset.cs = String(CS);
    r.dataset.ox = String(ox);
    r.dataset.oy = String(oy);
    r.dataset.sol = JSON.stringify(board.solution);
    r.dataset.last = lastEvent;
  }

  // ---- 描画 ----
  function draw(now: number): void {
    cv.clear('#f2ecdd');
    // 盤の背景
    g.fillStyle = '#efe6d0';
    g.fillRect(ox, oy, CS * cols, CS * rows);
    // グリッド線
    g.strokeStyle = 'rgba(120,100,70,.28)';
    g.lineWidth = 1;
    for (let x = 0; x <= cols; x++) {
      g.beginPath();
      g.moveTo(ox + x * CS, oy);
      g.lineTo(ox + x * CS, oy + rows * CS);
      g.stroke();
    }
    for (let y = 0; y <= rows; y++) {
      g.beginPath();
      g.moveTo(ox, oy + y * CS);
      g.lineTo(ox + cols * CS, oy + y * CS);
      g.stroke();
    }
    // 各色: 塗り＋パイプ線
    for (let c = 0; c < board.colors; c++) {
      const p = path[c]!;
      // 塗り
      g.fillStyle = SOFT[c % SOFT.length]!;
      for (const cell of p) {
        g.fillRect(ox + (cell % cols) * CS + 1, oy + ((cell / cols) | 0) * CS + 1, CS - 2, CS - 2);
      }
      // パイプ
      if (p.length >= 2) {
        g.strokeStyle = COLORS[c % COLORS.length]!;
        g.lineWidth = CS * 0.36;
        g.lineCap = 'round';
        g.lineJoin = 'round';
        g.beginPath();
        g.moveTo(centerX(p[0]!), centerY(p[0]!));
        for (let i = 1; i < p.length; i++) g.lineTo(centerX(p[i]!), centerY(p[i]!));
        g.stroke();
      }
    }
    // ●（端点）
    for (let c = 0; c < board.colors; c++) {
      const [a, b] = board.dots[c]!;
      const conn = connected[c];
      for (const d of [a, b]) {
        g.fillStyle = COLORS[c % COLORS.length]!;
        g.beginPath();
        g.arc(centerX(d), centerY(d), CS * 0.32, 0, Math.PI * 2);
        g.fill();
        if (conn) {
          g.strokeStyle = 'rgba(255,255,255,.9)';
          g.lineWidth = 2.5;
          g.beginPath();
          g.arc(centerX(d), centerY(d), CS * 0.32, 0, Math.PI * 2);
          g.stroke();
        }
      }
    }

    // HUD
    g.fillStyle = 'rgba(60,45,25,.9)';
    g.fillRect(0, 0, W, HUD_H);
    g.fillStyle = '#fff';
    g.font = 'bold 19px sans-serif';
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.fillText(`${score}てん`, 12, HUD_H / 2);
    g.fillStyle = '#ffe6b0';
    g.font = 'bold 14px sans-serif';
    g.fillText(`ステージ ${stage + 1}/${STAGES.length}`, 118, HUD_H / 2 - 8);
    g.fillText(`つながった ${connected.filter(Boolean).length}/${board.colors}`, 118, HUD_H / 2 + 9);

    if (stage === 0 && mode === 'play' && path.every((p) => p.length === 0)) {
      g.fillStyle = 'rgba(60,45,25,.8)';
      g.font = 'bold 14px sans-serif';
      g.textAlign = 'center';
      g.fillText('同じ色の●を なぞってつなごう（全マスうめる）', W / 2, H - 16);
    }

    if (mode === 'solved') {
      const a = clamp((phaseUntil - now) / 400, 0, 1);
      g.globalAlpha = a;
      g.fillStyle = 'rgba(62,169,79,.28)';
      g.fillRect(0, 0, W, H);
      g.globalAlpha = 1;
      g.fillStyle = '#2e8f4f';
      g.font = 'bold 32px sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.strokeStyle = '#fff';
      g.lineWidth = 4;
      g.strokeText('クリア！', W / 2, H / 2);
      g.fillText('クリア！', W / 2, H / 2);
    }

    if (mode === 'done') {
      g.fillStyle = 'rgba(60,45,25,.85)';
      g.fillRect(0, 0, W, H);
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = '#fff';
      g.font = 'bold 30px sans-serif';
      g.fillText('ぜんめん クリア！', W / 2, H / 2 - 40);
      g.font = 'bold 26px sans-serif';
      g.fillText(`${score}てん`, W / 2, H / 2 + 4);
      g.fillStyle = '#ffd54a';
      g.font = 'bold 15px sans-serif';
      g.fillText('パイプマスター！', W / 2, H / 2 + 38);
    }
  }

  draw(ctx.now());
  setData();

  return {
    start() {
      started = true;
      boardStartNow = ctx.now(); // タイマーは実際に始まった時点から
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
      offDown();
      offMove();
      offUp();
      offFrame();
    },
  };
}
