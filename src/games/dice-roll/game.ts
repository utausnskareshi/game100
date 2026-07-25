// =============================================================
// コロコロダイス（No.97）: スワイプでサイコロを転がす向き追跡パズル
// =============================================================
// - スワイプで1マス転がすと上の目が変わる。目標マスに「指定の目」で乗ると スタンプ。全部でクリア。
// - 盤面は logic.makeLevel（構成的に可解＋壁は解を塞がない・rng決定論）。全5面。
// - スコアは手数ベース＝時間非依存。転がりアニメは見た目だけ（ロジックに影響しない）。
// - import してよいのは game-api（types / helpers）と、このフォルダ内（logic）だけ。
import type { GameContext, IGame, SwipeDir } from '../../game-api/types';
import { clamp } from '../../game-api/helpers';
import { type Die, type Dir, type Level, STAGES, dxOf, dyOf, makeLevel, roll } from './logic';

const W = 360;
const H = 640;
const HUD_H = 46;
const ROLL_MS = 140;
const CELEBRATE_MS = 950;
const END_DELAY = 2000;
const SCORE_HI = 950;

type Mode = 'play' | 'solved' | 'done';

const PIPS: Record<number, [number, number][]> = {
  1: [[0.5, 0.5]],
  2: [[0.28, 0.28], [0.72, 0.72]],
  3: [[0.26, 0.26], [0.5, 0.5], [0.74, 0.74]],
  4: [[0.28, 0.28], [0.72, 0.28], [0.28, 0.72], [0.72, 0.72]],
  5: [[0.26, 0.26], [0.74, 0.26], [0.5, 0.5], [0.26, 0.74], [0.74, 0.74]],
  6: [[0.28, 0.24], [0.72, 0.24], [0.28, 0.5], [0.72, 0.5], [0.28, 0.76], [0.72, 0.76]],
};
const GOAL_COLORS = ['#e0483c', '#3d7df0', '#3ea94f', '#f0b400', '#b05ad0', '#ff7a2f'];

export function createGame(ctx: GameContext): IGame {
  const cv = ctx.canvas2d({ design: { w: W, h: H } });
  const g = cv.ctx;

  let mode: Mode = 'play';
  let started = false;
  let hostPaused = false;
  let ended = false;

  let stage = 0;
  let level: Level;
  let die: Die = { T: 1, N: 2, E: 3 };
  let dx = 0;
  let dy = 0; // die cell
  let stamped: boolean[] = [];
  let moves = 0;
  let score = 0;
  let clears = 0;
  let CS = 56;
  let ox = 0;
  let oy = HUD_H;
  let rollFrom = { x: 0, y: 0 };
  let rollAt = -9999;
  let phaseUntil = 0;
  let lastEvent = '';

  function loadLevel(idx: number): void {
    level = makeLevel(ctx.random, idx);
    stage = idx;
    die = { ...level.startDie };
    dx = level.start.x;
    dy = level.start.y;
    stamped = level.goals.map(() => false);
    moves = 0;
    const availH = H - HUD_H - 70;
    CS = Math.min(64, Math.floor((W - 28) / level.cols), Math.floor(availH / level.rows));
    ox = Math.floor((W - CS * level.cols) / 2);
    oy = HUD_H + 12 + Math.floor((availH - CS * level.rows) / 2);
    rollAt = -9999;
    checkStamps();
  }

  loadLevel(0);

  const cellCX = (cx: number): number => ox + (cx + 0.5) * CS;
  const cellCY = (cy: number): number => oy + (cy + 0.5) * CS;
  const isWall = (cx: number, cy: number): boolean => level.walls.includes(cy * level.cols + cx);

  function checkStamps(): void {
    for (let i = 0; i < level.goals.length; i++) {
      const goal = level.goals[i]!;
      if (!stamped[i] && goal.x === dx && goal.y === dy && goal.face === die.T) {
        stamped[i] = true;
        ctx.achieve('first-stamp');
        ctx.sfx('success');
        ctx.haptic('light');
        lastEvent = `stamp:${i}`;
      }
    }
    if (stamped.every(Boolean)) solveLevel(ctx.now());
  }

  function solveLevel(now: number): void {
    if (mode !== 'play') return;
    mode = 'solved';
    phaseUntil = now + CELEBRATE_MS;
    const eff = moves <= level.par;
    const gained = 180 + Math.max(0, level.par + 2 - moves) * 12 + (eff ? 60 : 0);
    score += gained;
    if (eff) ctx.achieve('efficient');
    if (stage === 0) ctx.achieve('first-clear');
    clears++;
    if (clears >= 3) ctx.achieve('clear-3');
    if (score >= SCORE_HI) ctx.achieve('score-hi');
    ctx.sfx('medal');
    ctx.haptic('success');
    lastEvent = `clear:${stage}:${gained}`;
  }

  function attemptRoll(dir: Dir): void {
    if (mode !== 'play') return;
    const nx = dx + dxOf(dir);
    const ny = dy + dyOf(dir);
    if (nx < 0 || ny < 0 || nx >= level.cols || ny >= level.rows || isWall(nx, ny)) {
      ctx.sfx('fail'); // 進めない
      return;
    }
    rollFrom = { x: dx, y: dy };
    rollAt = ctx.now();
    die = roll(die, dir);
    dx = nx;
    dy = ny;
    moves++;
    ctx.sfx('tap');
    ctx.haptic('light');
    lastEvent = `roll:${dir}:${moves}`;
    checkStamps();
  }

  // ---- 入力（スワイプで転がす） ----
  const swipeMap: Record<SwipeDir, Dir> = { up: 'U', down: 'D', left: 'L', right: 'R' };
  const offSwipe = ctx.input.onSwipe((d: SwipeDir) => {
    if (hostPaused || !started || mode !== 'play') return;
    attemptRoll(swipeMap[d]);
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
    r.dataset.moves = String(moves);
    r.dataset.par = String(level.par);
    r.dataset.stamped = String(stamped.filter(Boolean).length);
    r.dataset.goals = String(level.goals.length);
    r.dataset.score = String(score);
    r.dataset.die = `${die.T},${die.N},${die.E}`;
    r.dataset.pos = `${dx},${dy}`;
    r.dataset.sol = JSON.stringify(level.solution);
    r.dataset.last = lastEvent;
  }

  // ---- 描画 ----
  function drawPips(cx: number, cy: number, size: number, value: number, color: string): void {
    g.fillStyle = color;
    const rr = size * 0.09;
    for (const [px, py] of PIPS[value] ?? []) {
      g.beginPath();
      g.arc(cx - size / 2 + px * size, cy - size / 2 + py * size, rr, 0, Math.PI * 2);
      g.fill();
    }
  }

  function draw(now: number): void {
    cv.clear('#efe6d0');
    const bw = CS * level.cols;
    const bh = CS * level.rows;
    // 盤
    for (let y = 0; y < level.rows; y++) {
      for (let x = 0; x < level.cols; x++) {
        const px = ox + x * CS;
        const py = oy + y * CS;
        if (isWall(x, y)) {
          g.fillStyle = '#7a6a4a';
          g.fillRect(px + 1, py + 1, CS - 2, CS - 2);
        } else {
          g.fillStyle = (x + y) % 2 === 0 ? '#f7f0df' : '#eadfc6';
          g.fillRect(px, py, CS, CS);
        }
      }
    }
    // 目標マス
    for (let i = 0; i < level.goals.length; i++) {
      const goal = level.goals[i]!;
      const px = ox + goal.x * CS;
      const py = oy + goal.y * CS;
      const col = GOAL_COLORS[i % GOAL_COLORS.length]!;
      g.strokeStyle = col;
      g.lineWidth = 3;
      g.strokeRect(px + 3, py + 3, CS - 6, CS - 6);
      if (stamped[i]) {
        g.fillStyle = col;
        g.globalAlpha = 0.3;
        g.fillRect(px + 2, py + 2, CS - 4, CS - 4);
        g.globalAlpha = 1;
        // チェック
        g.strokeStyle = col;
        g.lineWidth = 4;
        g.beginPath();
        g.moveTo(px + CS * 0.3, py + CS * 0.52);
        g.lineTo(px + CS * 0.45, py + CS * 0.68);
        g.lineTo(px + CS * 0.72, py + CS * 0.34);
        g.stroke();
      } else {
        drawPips(px + CS / 2, py + CS / 2, CS * 0.62, goal.face, col);
      }
    }
    // グリッド枠
    g.strokeStyle = 'rgba(120,100,70,.3)';
    g.lineWidth = 1;
    for (let x = 0; x <= level.cols; x++) {
      g.beginPath();
      g.moveTo(ox + x * CS, oy);
      g.lineTo(ox + x * CS, oy + bh);
      g.stroke();
    }
    for (let y = 0; y <= level.rows; y++) {
      g.beginPath();
      g.moveTo(ox, oy + y * CS);
      g.lineTo(ox + bw, oy + y * CS);
      g.stroke();
    }

    // サイコロ（転がりアニメで補間）
    const t = clamp((now - rollAt) / ROLL_MS, 0, 1);
    const px = cellCX(rollFrom.x) + (cellCX(dx) - cellCX(rollFrom.x)) * t;
    const py = cellCY(rollFrom.y) + (cellCY(dy) - cellCY(rollFrom.y)) * t;
    const hop = Math.sin(t * Math.PI) * (t < 1 ? 6 : 0);
    const dsz = CS * 0.74;
    // 影
    g.fillStyle = 'rgba(0,0,0,.18)';
    g.beginPath();
    g.ellipse(px, py + dsz * 0.5, dsz * 0.42, dsz * 0.16, 0, 0, Math.PI * 2);
    g.fill();
    // 本体
    g.fillStyle = '#fbfbf7';
    g.strokeStyle = '#c2b596';
    g.lineWidth = 2;
    roundRect(px - dsz / 2, py - dsz / 2 - hop, dsz, dsz, 8);
    g.fill();
    g.stroke();
    drawPips(px, py - hop, dsz * 0.9, die.T, '#2a2a33');
    // 側面ヒント（右=E / 下=南=7-N）を小さく
    g.fillStyle = 'rgba(60,55,80,.14)';
    g.fillRect(px + dsz / 2 - 3, py - dsz / 2 - hop + 4, 3, dsz - 8);
    g.fillRect(px - dsz / 2 + 4, py + dsz / 2 - hop - 3, dsz - 8, 3);

    // HUD
    g.fillStyle = 'rgba(60,45,25,.9)';
    g.fillRect(0, 0, W, HUD_H);
    g.fillStyle = '#fff';
    g.font = 'bold 18px sans-serif';
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.fillText(`${score}てん`, 12, HUD_H / 2);
    g.fillStyle = '#ffe6b0';
    g.font = 'bold 13px sans-serif';
    g.fillText(`ステージ ${stage + 1}/${STAGES.length}`, 108, HUD_H / 2 - 8);
    g.fillText(`スタンプ ${stamped.filter(Boolean).length}/${level.goals.length}・${moves}手`, 108, HUD_H / 2 + 9);

    if (stage === 0 && moves === 0 && mode === 'play') {
      g.fillStyle = 'rgba(60,45,25,.85)';
      g.font = 'bold 14px sans-serif';
      g.textAlign = 'center';
      g.fillText('スワイプで サイコロを ころがそう', W / 2, H - 34);
      g.fillText('目標マスに「その目」で のせて スタンプ！', W / 2, H - 15);
    }

    if (mode === 'solved') {
      g.fillStyle = '#2e8f4f';
      g.font = 'bold 30px sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.strokeStyle = '#fff';
      g.lineWidth = 4;
      g.strokeText('クリア！', W / 2, oy + bh + 40);
      g.fillText('クリア！', W / 2, oy + bh + 40);
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
      g.fillText('ダイスマスター！', W / 2, H / 2 + 38);
    }
  }

  function roundRect(x: number, y: number, w: number, h: number, r: number): void {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  draw(ctx.now());
  setData();

  return {
    start() {
      started = true;
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
      offSwipe();
      offFrame();
    },
  };
}
