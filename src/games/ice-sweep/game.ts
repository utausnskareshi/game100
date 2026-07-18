// =============================================================
// こおりみがき（No.80）: スワイプですべって、氷をぜんぶピカピカに！
// =============================================================
// - 操作はスワイプだけ（＋「やりなおし」ボタンのタップ）。ロボットは壁か岩まで一直線にすべり、
//   通ったマスがピカピカになる。全マス磨けたらクリア。ラウンド3には「2回とおす よごれマス」も。
// - 盤面生成は logic.ts: 解の実在を確認できた盤だけ採用（par＝その解の手数＝必ず到達可能）。
//   行きづまったら「やりなおし」でラウンドを最初から（時間は進んだまま＝はやさボーナスだけ減る）。
// - 乱数は ctx.random 注入＝完全決定論（今日のゲームで全員同じ盤面）。
// - 全画面 Canvas・時間は ctx.now 期限方式・setTimeout 不使用。
// - import してよいのは game-api（types / helpers）と、このフォルダ内（logic）だけ
import type { GameContext, IGame } from '../../game-api/types';
import {
  type Board,
  type Dir,
  DIRS,
  H,
  ICE,
  ROCK,
  ROUNDS,
  W,
  idxOf,
  initialRemaining,
  generate,
  roundPoints,
  slide,
} from './logic';

const HUD_H = 40;
const BOARD_TOP = 52;
const BOARD_BAND = 410; // 盤面の縦バンド（52〜462）
const END_DELAY = 2200;
const CLEAR_MS = 2400;
const SCORE_HI = 900; // 実績閾値（ソルバボット較正済み・実機要調整）
const RETRY_RECT = { x: 12, y: 576, w: 118, h: 44 };

type Phase = 'play' | 'clear' | 'over';

interface FloatFx {
  x: number;
  y: number;
  text: string;
  color: string;
  until: number;
}

export function createGame(ctx: GameContext): IGame {
  const cv = ctx.canvas2d({ design: { w: W, h: H } });
  const g = cv.ctx;

  // 3ラウンドぶんを先に生成（乱数消費順を固定＝決定論）
  const boards: Board[] = ROUNDS.map((cfg) => generate(ctx.random, cfg));

  let phase: Phase = 'play';
  let started = false;
  let hostPaused = false;
  let roundIdx = 0;
  let board: Board = boards[0]!;
  let rem: number[] = initialRemaining(board);
  let robot = { x: board.start.x, y: board.start.y };
  let moves = 0;
  let usedRetry = false;
  let parOkAll = true;
  let roundStart = 0;
  let score = 0;
  let clearedRounds = 0;
  let lastClear: { moves: number; par: number; parBonus: number; speed: number; total: number } | null = null;
  let anim: { fx: number; fy: number; tx: number; ty: number; startMs: number; durMs: number } | null = null;
  let bump: { dir: Dir; until: number } | null = null;
  let nextAt = 0;
  let endAt = 0;
  let ended = false;
  let effects: FloatFx[] = [];
  let lastEvent = '';

  // セル座標系（ラウンドごとに再計算）
  let cell = 41;
  let offX = 0;
  let offY = 0;
  function layoutRound(): void {
    cell = Math.min(41, Math.floor(328 / board.w), Math.floor(500 / board.h));
    offX = Math.floor((W - board.w * cell) / 2);
    offY = BOARD_TOP + Math.floor((BOARD_BAND - board.h * cell) / 2);
  }
  layoutRound();

  const cx = (x: number): number => offX + x * cell + cell / 2;
  const cy = (y: number): number => offY + y * cell + cell / 2;
  const leftCount = (): number => rem.reduce((a, r) => a + r, 0);

  function addScore(n: number): void {
    score += n;
    if (score >= SCORE_HI) ctx.achieve('score-hi');
  }

  function beginRound(idx: number, now: number): void {
    roundIdx = idx;
    board = boards[idx]!;
    rem = initialRemaining(board);
    robot = { x: board.start.x, y: board.start.y };
    moves = 0;
    anim = null;
    bump = null;
    roundStart = now;
    layoutRound();
    lastEvent = `round:${idx + 1}`;
  }

  function retryRound(now: number): void {
    rem = initialRemaining(board);
    robot = { x: board.start.x, y: board.start.y };
    moves = 0;
    anim = null;
    bump = null;
    usedRetry = true;
    effects.push({ x: W / 2, y: offY + 40, text: 'やりなおし！', color: '#cdd6f5', until: now + 800 });
    ctx.sfx('tick');
    lastEvent = 'retry';
  }

  function roundClear(now: number): void {
    const sec = (now - roundStart) / 1000;
    const pts = roundPoints(moves, board.par, sec);
    addScore(pts.total);
    clearedRounds++;
    ctx.achieve('first-clear');
    if (moves <= board.par) ctx.achieve('par-master');
    else parOkAll = false;
    if (roundIdx === ROUNDS.length - 1) {
      ctx.achieve('all-clear');
      if (parOkAll) ctx.achieve('all-par');
      if (!usedRetry) ctx.achieve('no-retry');
    }
    lastClear = { moves, par: board.par, parBonus: pts.parBonus, speed: pts.speed, total: pts.total };
    phase = 'clear';
    nextAt = now + CLEAR_MS;
    ctx.sfx('medal');
    ctx.haptic('success');
    lastEvent = `clear:${roundIdx + 1}:${pts.total}`;
  }

  function trySlide(dir: Dir, now: number): void {
    if (anim && now < anim.startMs + anim.durMs) return; // すべり中は次を受けない
    const s = slide(board, robot.x, robot.y, dir);
    if (!s) {
      bump = { dir, until: now + 180 };
      ctx.haptic('light');
      return;
    }
    let polished = 0;
    for (const p of s.path) {
      const i = idxOf(board, p.x, p.y);
      if ((rem[i] ?? 0) > 0) {
        rem[i] = (rem[i] ?? 0) - 1;
        polished++;
      }
    }
    moves++;
    anim = {
      fx: robot.x,
      fy: robot.y,
      tx: s.ex,
      ty: s.ey,
      startMs: now,
      durMs: 90 + s.path.length * 48,
    };
    robot = { x: s.ex, y: s.ey };
    ctx.sfx(polished > 0 ? 'tap' : 'tick');
    lastEvent = `slide:${dir}:${polished}`;
    if (leftCount() === 0) roundClear(now);
  }

  // ---- 入力 ----
  const offSwipe = ctx.input.onSwipe((dir) => {
    if (hostPaused || !started || phase !== 'play') return;
    trySlide(dir, ctx.now());
  });
  const offTap = ctx.input.onTap((p) => {
    if (hostPaused || !started || phase !== 'play') return;
    const l = cv.toLocal(p);
    if (l.x >= RETRY_RECT.x && l.x <= RETRY_RECT.x + RETRY_RECT.w && l.y >= RETRY_RECT.y && l.y <= RETRY_RECT.y + RETRY_RECT.h) {
      retryRound(ctx.now());
    }
  });

  // ---- 毎フレーム ----
  const offFrame = ctx.onFrame(() => {
    if (hostPaused) return;
    const now = ctx.now();
    if (phase === 'clear' && now >= nextAt) {
      if (roundIdx + 1 < ROUNDS.length) {
        beginRound(roundIdx + 1, now);
        phase = 'play';
        ctx.sfx('start');
      } else {
        phase = 'over';
        endAt = now + END_DELAY;
      }
    } else if (phase === 'over' && !ended && now >= endAt) {
      ended = true;
      ctx.end({ score });
      return;
    }
    effects = effects.filter((e) => e.until > now);
    draw(now);
    setData();
  });

  function setData(): void {
    if (!import.meta.env.DEV) return;
    const r = ctx.root as HTMLElement;
    r.dataset.phase = phase;
    r.dataset.round = String(roundIdx + 1);
    r.dataset.moves = String(moves);
    r.dataset.par = String(board.par);
    r.dataset.left = String(leftCount());
    r.dataset.robot = `${robot.x},${robot.y}`;
    r.dataset.score = String(score);
    r.dataset.usedretry = usedRetry ? '1' : '0';
    r.dataset.fallback = board.fallback ? '1' : '0';
    r.dataset.cells = board.cells.join('');
    r.dataset.remmap = rem.join('');
    r.dataset.solution = board.solution.join(',');
    r.dataset.last = lastEvent;
    r.dataset.t = started ? ((ctx.now() - roundStart) / 1000).toFixed(2) : '0';
  }

  // ---- 描画 ----
  function roundRectPath(x: number, y: number, w: number, h: number, r: number): void {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  function drawCellAt(x: number, y: number, now: number): void {
    const i = idxOf(board, x, y);
    const c = board.cells[i];
    const px = offX + x * cell;
    const py = offY + y * cell;
    if (c !== ICE) return; // 雪と岩は別レイヤー
    const r = rem[i] ?? 0;
    if (r === 0) {
      // ピカピカ
      g.fillStyle = '#dff7ff';
      g.fillRect(px, py, cell, cell);
      g.strokeStyle = 'rgba(255,255,255,.75)';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(px + cell * 0.2, py + cell * 0.75);
      g.lineTo(px + cell * 0.65, py + cell * 0.3);
      g.stroke();
      const tw = Math.sin(now / 300 + (x * 7 + y * 13)) > 0.86;
      if (tw) {
        g.fillStyle = '#ffffff';
        g.beginPath();
        g.arc(px + cell * 0.72, py + cell * 0.28, 2, 0, Math.PI * 2);
        g.fill();
      }
    } else if (r === 2) {
      // よごれ（2回とおす）
      g.fillStyle = '#7fa3b8';
      g.fillRect(px, py, cell, cell);
      g.fillStyle = 'rgba(42,53,68,.55)';
      for (const [ox, oy] of [
        [0.3, 0.35],
        [0.62, 0.55],
        [0.42, 0.72],
      ] as [number, number][]) {
        g.beginPath();
        g.arc(px + cell * ox, py + cell * oy, 2.6, 0, Math.PI * 2);
        g.fill();
      }
      g.fillStyle = '#fff';
      g.font = 'bold 10px sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('×2', px + cell - 10, py + 9);
    } else {
      // まだ磨いていない氷
      g.fillStyle = '#a8cfe4';
      g.fillRect(px, py, cell, cell);
      g.fillStyle = 'rgba(255,255,255,.14)';
      g.fillRect(px + 2, py + 2, cell - 4, 4);
    }
    g.strokeStyle = 'rgba(58,84,110,.25)';
    g.lineWidth = 1;
    g.strokeRect(px + 0.5, py + 0.5, cell - 1, cell - 1);
  }

  function draw(now: number): void {
    // 冬空の背景
    const grad = g.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#20335c');
    grad.addColorStop(1, '#31517a');
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);
    // 雪（背景のちらちら）
    g.fillStyle = 'rgba(255,255,255,.5)';
    for (let i = 0; i < 26; i++) {
      const sx = (i * 89 + 13) % W;
      const sy = (((i * 131 + now * 0.02) % (H - 20)) + H) % (H - 20);
      g.fillRect(sx, sy + 10, 2, 2);
    }
    // 盤のわく（雪のふち）
    g.fillStyle = '#e9f2fb';
    roundRectPath(offX - 10, offY - 10, board.w * cell + 20, board.h * cell + 20, 14);
    g.fill();
    g.fillStyle = '#cfe0ef';
    roundRectPath(offX - 4, offY - 4, board.w * cell + 8, board.h * cell + 8, 8);
    g.fill();
    // 雪マス（ICE以外の下地）
    g.fillStyle = '#e9f2fb';
    g.fillRect(offX, offY, board.w * cell, board.h * cell);
    // セル
    for (let y = 0; y < board.h; y++) for (let x = 0; x < board.w; x++) drawCellAt(x, y, now);
    // 岩
    for (let y = 0; y < board.h; y++) {
      for (let x = 0; x < board.w; x++) {
        if (board.cells[idxOf(board, x, y)] !== ROCK) continue;
        const px = offX + x * cell + cell / 2;
        const py = offY + y * cell + cell / 2;
        g.fillStyle = '#6b7787';
        g.beginPath();
        g.ellipse(px, py + 3, cell * 0.36, cell * 0.28, 0, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = '#8794a6';
        g.beginPath();
        g.ellipse(px - 2, py - 2, cell * 0.3, cell * 0.22, 0, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = 'rgba(255,255,255,.35)';
        g.beginPath();
        g.arc(px - 6, py - 7, 3, 0, Math.PI * 2);
        g.fill();
      }
    }

    // ロボット（すべりアニメ）
    let rx = cx(robot.x);
    let ry = cy(robot.y);
    if (anim) {
      const k = Math.min(1, (now - anim.startMs) / anim.durMs);
      const e = 1 - (1 - k) * (1 - k); // ease-out
      rx = cx(anim.fx) + (cx(anim.tx) - cx(anim.fx)) * e;
      ry = cy(anim.fy) + (cy(anim.ty) - cy(anim.fy)) * e;
      if (k >= 1) anim = null;
    }
    if (bump && now < bump.until) {
      const { dx, dy } = DIRS[bump.dir];
      const k = Math.sin(((now - (bump.until - 180)) / 180) * Math.PI);
      rx += dx * 5 * k;
      ry += dy * 5 * k;
    }
    const bob = anim ? 0 : Math.sin(now / 300) * 1.5;
    // ブラシあと（すべり中）
    if (anim) {
      g.fillStyle = 'rgba(255,255,255,.5)';
      g.beginPath();
      g.arc(rx, ry + 8, 4, 0, Math.PI * 2);
      g.fill();
    }
    // 本体
    g.fillStyle = '#ff8a4a';
    g.beginPath();
    g.arc(rx, ry + bob, cell * 0.34, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#ffd7bd';
    g.beginPath();
    g.arc(rx, ry + bob - 2, cell * 0.24, 0, Math.PI * 2);
    g.fill();
    // 目
    g.fillStyle = '#2a2340';
    g.beginPath();
    g.arc(rx - 5, ry + bob - 4, 2.2, 0, Math.PI * 2);
    g.arc(rx + 5, ry + bob - 4, 2.2, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#2a2340';
    g.lineWidth = 1.8;
    g.beginPath();
    g.arc(rx, ry + bob + 1, 3.4, 0.15 * Math.PI, 0.85 * Math.PI);
    g.stroke();
    // アンテナ
    g.strokeStyle = '#ffd54a';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(rx, ry + bob - cell * 0.34);
    g.lineTo(rx, ry + bob - cell * 0.34 - 6);
    g.stroke();
    g.fillStyle = '#ffd54a';
    g.beginPath();
    g.arc(rx, ry + bob - cell * 0.34 - 8, 2.5, 0, Math.PI * 2);
    g.fill();

    // うかぶ文字
    for (const e of effects) {
      const a = Math.max(0, Math.min(1, (e.until - now) / 800));
      g.globalAlpha = a;
      g.fillStyle = e.color;
      g.font = 'bold 15px sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(e.text, e.x, e.y - (1 - a) * 18);
      g.globalAlpha = 1;
    }

    // HUD
    g.fillStyle = 'rgba(8,10,24,.9)';
    g.fillRect(0, 0, W, HUD_H);
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.fillStyle = '#fff';
    g.font = 'bold 19px sans-serif';
    g.fillText(`${score}てん`, 12, HUD_H / 2);
    g.fillStyle = '#cdd6f5';
    g.font = 'bold 14px sans-serif';
    g.fillText(`ラウンド${roundIdx + 1}/3`, 116, HUD_H / 2);
    g.fillText(`て ${moves}／めやす ${board.par}`, 208, HUD_H / 2);

    // やりなおしボタン
    g.fillStyle = 'rgba(8,10,24,.55)';
    roundRectPath(RETRY_RECT.x, RETRY_RECT.y, RETRY_RECT.w, RETRY_RECT.h, 12);
    g.fill();
    g.strokeStyle = 'rgba(205,214,245,.5)';
    g.lineWidth = 1.5;
    roundRectPath(RETRY_RECT.x, RETRY_RECT.y, RETRY_RECT.w, RETRY_RECT.h, 12);
    g.stroke();
    g.fillStyle = '#cdd6f5';
    g.font = 'bold 14px sans-serif';
    g.textAlign = 'center';
    g.fillText('↺ やりなおし', RETRY_RECT.x + RETRY_RECT.w / 2, RETRY_RECT.y + RETRY_RECT.h / 2);

    // 操作ヒント
    if (phase === 'play' && roundIdx === 0 && moves === 0) {
      g.fillStyle = 'rgba(205,214,245,.9)';
      g.font = 'bold 15px sans-serif';
      g.textAlign = 'center';
      g.fillText('スワイプで すべって ぜんぶ ピカピカに！', W / 2, 505);
    }

    // クリア演出
    if (phase === 'clear' && lastClear) {
      g.fillStyle = 'rgba(8,10,24,.72)';
      roundRectPath(40, 220, W - 80, 170, 16);
      g.fill();
      g.textAlign = 'center';
      g.fillStyle = '#8affc0';
      g.font = 'bold 24px sans-serif';
      g.fillText('ピカピカ！', W / 2, 254);
      g.fillStyle = '#fff';
      g.font = 'bold 15px sans-serif';
      g.fillText(
        lastClear.moves <= lastClear.par ? `めやすいない！ +${lastClear.parBonus}` : `てじゅん +${lastClear.parBonus}`,
        W / 2,
        292,
      );
      g.fillText(`はやさ +${lastClear.speed}`, W / 2, 318);
      g.fillStyle = '#ffd54a';
      g.font = 'bold 20px sans-serif';
      g.fillText(`+${lastClear.total}`, W / 2, 356);
    }

    if (phase === 'over') {
      g.fillStyle = 'rgba(8,10,24,.8)';
      g.fillRect(0, 0, W, H);
      g.textAlign = 'center';
      g.fillStyle = '#fff';
      g.font = 'bold 30px sans-serif';
      g.fillText('おわり！', W / 2, H / 2 - 50);
      g.font = 'bold 26px sans-serif';
      g.fillText(`${score}てん`, W / 2, H / 2 - 8);
      g.fillStyle = '#cdd6f5';
      g.font = 'bold 15px sans-serif';
      g.fillText(`みがいたラウンド ${clearedRounds}/3`, W / 2, H / 2 + 26);
    }
  }

  draw(ctx.now());
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
      offSwipe();
      offTap();
      offFrame();
    },
  };
}
