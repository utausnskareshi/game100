// =============================================================
// ぐるっとめいろ（No.65）: 世界ごと90°回して ボールをころがす 重力パズル
// =============================================================
// - ◀▶で迷路全体を回転→ボールが重力で転がる。トゲに入るとスタートから
//   やりなおし（回した回数はそのまま＝じわっとペナルティ）。
// - 盤面生成・重力解決・BFS最短(par)は logic.ts（純ロジック・rng注入）。
//   3もんとも開始時にまとめて生成＝rng消費が固定で日替わり決定論。
// - 全画面 Canvas・onTap のみ。時間は ctx.now 期限方式・setTimeout 不使用。
// - import してよいのは game-api（types / helpers）と、このフォルダ内（logic）だけ
import type { GameContext, IGame } from '../../game-api/types';
import {
  type Board,
  CLEAR_PTS,
  type FallResult,
  GEM_PTS,
  type Grav,
  OVER_PENALTY,
  PAR_BONUS,
  PUZZLES,
  fall,
  generate,
} from './logic';

const W = 360;
const H = 640;
const HUD_H = 44;
const BOARD_PX = 330;
const BOARD_X = 15;
const BOARD_Y = 96;
const ROT_MS = 340;
const STEP_MS = 80;
const SCORE_HI = 700;

type Mode = 'play' | 'spike' | 'clear' | 'over';

type Anim =
  | { kind: 'rot'; t0: number; fromDeg: number; toDeg: number; pending: FallResult }
  | { kind: 'fall'; t0: number; path: number[]; outcome: FallResult['outcome']; end: number; processed: number }
  | { kind: 'reset'; t0: number; fromDeg: number };

const BTN_L = { x: 24, y: 516, w: 88, h: 64 };
const BTN_R = { x: 248, y: 516, w: 88, h: 64 };
const BTN_RESET = { x: 128, y: 524, w: 104, h: 48 };

export function createGame(ctx: GameContext): IGame {
  const cv = ctx.canvas2d({ design: { w: W, h: H } });
  const g2 = cv.ctx;

  let boards: Board[] = [];
  let totalGems = 0;
  let mode: Mode = 'play';
  let hostPaused = false;
  let si = 0;
  let board!: Board;
  let ballCell = 0;
  let orientIdx = 0;
  let rotations = 0;
  let spikeHits = 0;
  let gotTotal = 0;
  let gemsLeft = new Set<number>();
  let parAll = true;
  let anim: Anim | null = null;
  let score = 0;
  let spikeUntil = 0;
  let nextAt = 0;
  let endAt = 0;
  let ended = false;
  let introUntil = 0;
  let overText = '';

  const grav = (): Grav => ((((orientIdx % 4) + 4) % 4) as Grav);
  const rawDeg = (): number => orientIdx * 90;

  function initPuzzle(idx: number, now: number): void {
    si = idx;
    board = boards[idx]!;
    ballCell = board.start;
    orientIdx = 0;
    rotations = 0;
    gemsLeft = new Set(board.gems);
    anim = null;
    mode = 'play';
    introUntil = now + 1300;
  }

  function addScore(n: number): void {
    score += n;
    if (score >= SCORE_HI) ctx.achieve('score-hi');
  }

  function press(mv: 'L' | 'R', now: number): void {
    if (mode !== 'play' || anim || hostPaused) return;
    orientIdx += mv === 'R' ? 1 : -1;
    rotations++;
    const f = fall(board, ballCell, grav());
    anim = { kind: 'rot', t0: now, fromDeg: rawDeg() - (mv === 'R' ? 90 : -90), toDeg: rawDeg(), pending: f };
    ctx.sfx('tap');
  }

  function pressReset(now: number): void {
    if (mode !== 'play' || anim || hostPaused) return;
    if (ballCell === board.start && orientIdx === 0) return;
    anim = { kind: 'reset', t0: now, fromDeg: normDeg(rawDeg()) };
    ctx.sfx('tick');
  }

  function normDeg(d: number): number {
    let x = ((d % 360) + 360) % 360;
    if (x > 180) x -= 360;
    return x;
  }

  function applyOutcome(f: { outcome: FallResult['outcome']; end: number }, now: number): void {
    ballCell = f.end;
    anim = null;
    if (f.outcome === 'spike') {
      spikeHits++;
      mode = 'spike';
      spikeUntil = now + 950;
      ctx.sfx('fail');
      ctx.haptic('error');
    } else if (f.outcome === 'goal') {
      puzzleClear(now);
    }
  }

  function puzzleClear(now: number): void {
    const over = rotations - board.par;
    const bonus = over <= 0 ? PAR_BONUS : Math.max(0, PAR_BONUS - OVER_PENALTY * over);
    addScore(CLEAR_PTS + bonus);
    ctx.achieve('first-clear');
    if (rotations === board.par) ctx.achieve('par-just');
    else parAll = false;
    ctx.haptic('success');
    if (si >= boards.length - 1) {
      if (spikeHits === 0) ctx.achieve('no-spike');
      if (parAll) ctx.achieve('all-par');
      mode = 'over';
      overText = 'ぜんぶクリア！';
      endAt = now + 2000;
      ctx.sfx('medal');
    } else {
      mode = 'clear';
      nextAt = now + 1600;
      ctx.sfx('success');
    }
  }

  function collectGem(cell: number): void {
    if (!gemsLeft.has(cell)) return;
    gemsLeft.delete(cell);
    gotTotal++;
    addScore(GEM_PTS);
    ctx.sfx('combo');
    ctx.haptic('light');
    if (gotTotal >= totalGems) ctx.achieve('gems-all');
  }

  // ---- 入力 ----
  const inRect = (l: { x: number; y: number }, r: { x: number; y: number; w: number; h: number }): boolean =>
    l.x >= r.x && l.x <= r.x + r.w && l.y >= r.y && l.y <= r.y + r.h;
  const offTap = ctx.input.onTap((p) => {
    if (hostPaused) return;
    const l = cv.toLocal(p);
    const now = ctx.now();
    if (inRect(l, BTN_L)) press('L', now);
    else if (inRect(l, BTN_R)) press('R', now);
    else if (inRect(l, BTN_RESET)) pressReset(now);
  });

  // ---- 毎フレーム ----
  const offFrame = ctx.onFrame(() => {
    if (hostPaused) return;
    const now = ctx.now();
    if (anim) {
      if (anim.kind === 'rot') {
        if (now >= anim.t0 + ROT_MS) {
          const f = anim.pending;
          if (f.path.length === 0) applyOutcome(f, now);
          else anim = { kind: 'fall', t0: now, path: f.path, outcome: f.outcome, end: f.end, processed: 0 };
        }
      } else if (anim.kind === 'fall') {
        const idx = Math.min(anim.path.length, Math.floor((now - anim.t0) / STEP_MS) + 1);
        while (anim.processed < idx) {
          const c = anim.path[anim.processed]!;
          if (!board.spike[c] && c !== board.goal) collectGem(c);
          anim.processed++;
        }
        if (now >= anim.t0 + anim.path.length * STEP_MS) applyOutcome(anim, now);
      } else if (anim.kind === 'reset') {
        if (now >= anim.t0 + 400) {
          orientIdx = 0;
          ballCell = board.start;
          anim = null;
        }
      }
    } else if (mode === 'spike') {
      if (now >= spikeUntil) {
        mode = 'play';
        anim = { kind: 'reset', t0: now, fromDeg: normDeg(rawDeg()) };
      }
    } else if (mode === 'clear') {
      if (now >= nextAt) initPuzzle(si + 1, now);
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
    r.dataset.si = String(si);
    r.dataset.score = String(score);
    r.dataset.rot = String(rotations);
    r.dataset.par = String(board?.par ?? 0);
    r.dataset.g = String(grav());
    r.dataset.cell = String(ballCell);
    r.dataset.gems = String(gotTotal);
    r.dataset.gemtotal = String(totalGems);
    r.dataset.spikes = String(spikeHits);
    r.dataset.anim = anim ? '1' : '0';
    r.dataset.sol = board?.solution.join('') ?? '';
    if (board) {
      r.dataset.bd = [
        board.n,
        board.wall.map((w) => (w ? 1 : 0)).join(''),
        board.spike.map((s) => (s ? 1 : 0)).join(''),
        board.start,
        board.goal,
        board.gems.join(','),
      ].join(';');
    }
  }

  // ---- 描画 ----
  function roundRect(x: number, y: number, w: number, h: number, rad: number): void {
    const rr = Math.min(rad, w / 2, h / 2);
    g2.beginPath();
    g2.moveTo(x + rr, y);
    g2.arcTo(x + w, y, x + w, y + h, rr);
    g2.arcTo(x + w, y + h, x, y + h, rr);
    g2.arcTo(x, y + h, x, y, rr);
    g2.arcTo(x, y, x + w, y, rr);
    g2.closePath();
  }

  function displayDeg(now: number): number {
    if (anim?.kind === 'rot') {
      const p = Math.min(1, (now - anim.t0) / ROT_MS);
      const e = 1 - (1 - p) * (1 - p); // easeOut
      return anim.fromDeg + (anim.toDeg - anim.fromDeg) * e;
    }
    if (anim?.kind === 'reset') {
      const p = Math.min(1, (now - anim.t0) / 400);
      return anim.fromDeg * (1 - p);
    }
    return rawDeg();
  }

  function ballMazeXY(now: number): { x: number; y: number } {
    const n = board.n;
    const cellPx = BOARD_PX / n;
    const at = (c: number): { x: number; y: number } => ({ x: ((c % n) + 0.5) * cellPx, y: (Math.floor(c / n) + 0.5) * cellPx });
    if (anim?.kind === 'fall') {
      const t = (now - anim.t0) / STEP_MS;
      const cells = [ballCell, ...anim.path];
      const i = Math.min(cells.length - 1, Math.floor(t));
      const frac = Math.min(1, t - i);
      const a = at(cells[i]!);
      const b = at(cells[Math.min(cells.length - 1, i + 1)]!);
      return { x: a.x + (b.x - a.x) * frac, y: a.y + (b.y - a.y) * frac };
    }
    return at(ballCell);
  }

  function draw(now: number): void {
    g2.fillStyle = '#101830';
    g2.fillRect(0, 0, W, H);

    const n = board.n;
    const cellPx = BOARD_PX / n;
    const deg = displayDeg(now);
    const rad = (deg * Math.PI) / 180;
    const cx = BOARD_X + BOARD_PX / 2;
    const cy = BOARD_Y + BOARD_PX / 2;

    // 回る盤面（迷路座標系で描く）
    g2.save();
    g2.translate(cx, cy);
    g2.rotate(rad);
    g2.translate(-BOARD_PX / 2, -BOARD_PX / 2);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const i = y * n + x;
        const px = x * cellPx;
        const py = y * cellPx;
        if (board.wall[i]) {
          g2.fillStyle = '#7a5a3a';
          g2.fillRect(px, py, cellPx + 0.5, cellPx + 0.5);
          g2.fillStyle = 'rgba(255,255,255,.10)';
          g2.fillRect(px, py, cellPx + 0.5, 3);
        } else {
          g2.fillStyle = (x + y) % 2 === 0 ? '#f4ead8' : '#eee0c8';
          g2.fillRect(px, py, cellPx + 0.5, cellPx + 0.5);
          if (board.spike[i]) {
            g2.fillStyle = '#c04040';
            const s = cellPx / 4;
            for (let k = 0; k < 3; k++) {
              g2.beginPath();
              g2.moveTo(px + s * (k + 0.5) + s / 4, py + cellPx - 4);
              g2.lineTo(px + s * (k + 1) + s / 4, py + 4 + s);
              g2.lineTo(px + s * (k + 1.5) + s / 4, py + cellPx - 4);
              g2.closePath();
              g2.fill();
            }
          }
          if (gemsLeft.has(i)) {
            g2.fillStyle = '#2fb9d8';
            g2.beginPath();
            g2.moveTo(px + cellPx / 2, py + cellPx * 0.2);
            g2.lineTo(px + cellPx * 0.78, py + cellPx / 2);
            g2.lineTo(px + cellPx / 2, py + cellPx * 0.8);
            g2.lineTo(px + cellPx * 0.22, py + cellPx / 2);
            g2.closePath();
            g2.fill();
            g2.fillStyle = 'rgba(255,255,255,.55)';
            g2.beginPath();
            g2.arc(px + cellPx * 0.42, py + cellPx * 0.38, cellPx * 0.07, 0, Math.PI * 2);
            g2.fill();
          }
          if (i === board.goal) {
            g2.strokeStyle = '#8a6a45';
            g2.lineWidth = 3;
            g2.beginPath();
            g2.moveTo(px + cellPx * 0.3, py + cellPx * 0.85);
            g2.lineTo(px + cellPx * 0.3, py + cellPx * 0.15);
            g2.stroke();
            g2.fillStyle = '#e04848';
            g2.beginPath();
            g2.moveTo(px + cellPx * 0.3, py + cellPx * 0.15);
            g2.lineTo(px + cellPx * 0.85, py + cellPx * 0.32);
            g2.lineTo(px + cellPx * 0.3, py + cellPx * 0.5);
            g2.closePath();
            g2.fill();
          }
        }
      }
    }
    // 盤のふち
    g2.strokeStyle = '#c8a878';
    g2.lineWidth = 5;
    g2.strokeRect(0, 0, BOARD_PX, BOARD_PX);
    g2.restore();

    // ボール（画面座標で常に上向きの顔）
    const m = ballMazeXY(now);
    const dx = m.x - BOARD_PX / 2;
    const dy = m.y - BOARD_PX / 2;
    const bx = cx + dx * Math.cos(rad) - dy * Math.sin(rad);
    const by = cy + dx * Math.sin(rad) + dy * Math.cos(rad);
    const br = Math.max(9, cellPx * 0.34);
    g2.fillStyle = '#ff8a3c';
    g2.beginPath();
    g2.arc(bx, by, br, 0, Math.PI * 2);
    g2.fill();
    g2.fillStyle = 'rgba(255,255,255,.5)';
    g2.beginPath();
    g2.arc(bx - br * 0.3, by - br * 0.35, br * 0.28, 0, Math.PI * 2);
    g2.fill();
    g2.fillStyle = '#5a2c10';
    g2.beginPath();
    g2.arc(bx - br * 0.3, by - br * 0.05, br * 0.14, 0, Math.PI * 2);
    g2.arc(bx + br * 0.3, by - br * 0.05, br * 0.14, 0, Math.PI * 2);
    g2.fill();

    // HUD
    g2.fillStyle = '#0c1426';
    g2.fillRect(0, 0, W, HUD_H);
    g2.textBaseline = 'middle';
    g2.textAlign = 'left';
    g2.fillStyle = '#fff';
    g2.font = 'bold 19px sans-serif';
    g2.fillText(`${score}てん`, 12, HUD_H / 2);
    g2.fillStyle = '#9fb2e8';
    g2.font = 'bold 15px sans-serif';
    g2.fillText(`もんだい${si + 1}/3`, 130, HUD_H / 2);
    g2.fillText(`💎${gotTotal}/${totalGems}`, 246, HUD_H / 2);
    // 2行目: 回転数と par
    g2.fillStyle = '#cfd8ff';
    g2.font = 'bold 15px sans-serif';
    g2.fillText(`かいてん ${rotations}`, 14, 70);
    g2.fillStyle = rotations <= board.par ? '#6fe08a' : '#ffb46a';
    g2.fillText(`さいたん ${board.par}かい`, 130, 70);
    if (spikeHits > 0) {
      g2.fillStyle = '#ff8a8a';
      g2.fillText(`トゲ ${spikeHits}`, 262, 70);
    }

    // ヒント
    g2.textAlign = 'center';
    g2.fillStyle = 'rgba(200,214,255,.75)';
    g2.font = 'bold 13px sans-serif';
    g2.fillText('◀▶で 世界を まわして、ボールを はたへ！', W / 2, 448);

    // ボタン
    const drawBtn = (r: { x: number; y: number; w: number; h: number }, label: string, small?: boolean): void => {
      g2.fillStyle = 'rgba(255,255,255,.10)';
      roundRect(r.x, r.y, r.w, r.h, 14);
      g2.fill();
      g2.strokeStyle = 'rgba(255,255,255,.25)';
      g2.lineWidth = 1.5;
      roundRect(r.x, r.y, r.w, r.h, 14);
      g2.stroke();
      g2.fillStyle = '#fff';
      g2.font = small ? 'bold 15px sans-serif' : 'bold 26px sans-serif';
      g2.fillText(label, r.x + r.w / 2, r.y + r.h / 2 + 1);
    };
    drawBtn(BTN_L, '◀ひだり');
    drawBtn(BTN_R, 'みぎ▶');
    drawBtn(BTN_RESET, 'やりなおす', true);
    g2.font = 'bold 12px sans-serif';
    g2.fillStyle = 'rgba(255,255,255,.55)';
    g2.fillText('（ボールを もどす）', BTN_RESET.x + BTN_RESET.w / 2, BTN_RESET.y + BTN_RESET.h + 14);

    // バナー
    let banner = '';
    let sub = '';
    if (mode === 'play' && now < introUntil) {
      banner = `もんだい${si + 1}`;
      sub = `さいたん ${board.par}かいで とけるよ`;
    } else if (mode === 'spike') {
      banner = 'トゲ！';
      sub = 'スタートから やりなおし…';
    } else if (mode === 'clear') {
      banner = 'クリア！';
      sub = rotations === board.par ? 'さいたんぴったり！ +100' : 'つぎの もんだいへ';
    } else if (mode === 'over') {
      banner = overText;
      sub = 'おつかれさま！';
    }
    if (banner) {
      g2.fillStyle = 'rgba(5,10,26,.62)';
      roundRect(46, 226, W - 92, 108, 16);
      g2.fill();
      g2.fillStyle = '#fff';
      g2.font = 'bold 29px sans-serif';
      g2.fillText(banner, W / 2, 270);
      g2.fillStyle = '#cfd8ff';
      g2.font = 'bold 15px sans-serif';
      g2.fillText(sub, W / 2, 306);
    }
  }

  return {
    start() {
      boards = PUZZLES.map((cfg) => generate(cfg, ctx.random));
      totalGems = boards.reduce((s, b) => s + b.gems.length, 0);
      gotTotal = 0;
      parAll = true;
      spikeHits = 0;
      score = 0;
      initPuzzle(0, ctx.now());
      draw(ctx.now());
      setData();
    },
    pause() {
      hostPaused = true;
    },
    resume() {
      hostPaused = false;
    },
    resize() {
      if (board) draw(ctx.now());
    },
    destroy() {
      offTap();
      offFrame();
    },
  };
}
