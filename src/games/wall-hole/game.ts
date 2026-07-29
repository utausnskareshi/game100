// =============================================================
// かべの あな（No.119・かくれゲーム）: 形と 向きを 合わせて くぐりぬける
// =============================================================
// - ねらい: #19 よけよけレースは「よける」。こちらは **形を 合わせる**。
//   左右に なぞって 位置を、タップで 90度 まわして 向きを 合わせる。
// - 判定は マスの集合の 一致（logic.passes）＝見た目と ずれない。
// - import してよいのは game-api（types / helpers）と、このフォルダ内（logic）だけ。
import type { GameContext, IGame, PointerInfo } from '../../game-api/types';
import { clamp } from '../../game-api/helpers';
import {
  CELL,
  CLEAN_BONUS,
  COLS,
  GRID_X,
  LIVES,
  PLAYER_Y,
  SHAPES,
  WAVES,
  type Wave,
  holeCells,
  makeWaves,
  maxCol,
  passes,
  playerCells,
  rotations,
  wavePoints,
} from './logic';

const W = 360;
const H = 640;
const HUD_H = 46;

/** かべの おびの 高さ（マス） */
const BAND = 3;
/** かべが 出てくる 高さ */
const SPAWN_Y = -BAND * CELL;
const HIT_MS = 900;
const END_DELAY = 2600;
const SCORE_HI = 950;

const C_BG = '#151a2b';
const C_GRID = 'rgba(255,255,255,.05)';
const C_WALL = '#3d4a72';
const C_WALL_EDGE = '#5b6ca8';
const C_ME = '#4ad0a0';
const C_TEXT = '#eaf0ff';
const C_DIM = '#8b97bd';
const C_OK = '#43c98a';
const C_NG = '#e0483c';

type Mode = 'play' | 'hit' | 'done';

export function createGame(ctx: GameContext): IGame {
  const cv = ctx.canvas2d({ design: { w: W, h: H } });
  const g = cv.ctx;

  const waves: Wave[] = makeWaves(ctx.random);
  let waveIdx = 0;
  let wave: Wave = waves[0]!;
  /** かべの おびの 上のはし（px） */
  let wallY = SPAWN_Y;
  let shape = wave.shape;
  let rot = 0;
  let col = 0;
  let mode: Mode = 'play';
  let started = false;
  let hostPaused = false;
  let ended = false;
  let score = 0;
  let passed = 0;
  let lives = LIVES;
  let streak = 0;
  let bestStreak = 0;
  let crashes = 0;
  let dragging = false;
  let lastX = 0;
  let dragAcc = 0;
  /** この かべの 判定を もう したか（判定は 1まいに 1回だけ） */
  let checked = false;
  let phaseUntil = 0;
  let lastEvent = '';

  function loadWave(i: number): void {
    waveIdx = i;
    wave = waves[i]!;
    wallY = SPAWN_Y;
    checked = false;
    shape = wave.shape;
    rot = 0;
    col = Math.min(col, maxCol(shape, rot));
    mode = 'play';
    lastEvent = `wave:${i}:${wave.shape}/${wave.rot}/${wave.col}`;
  }
  loadWave(0);
  col = 2;

  // ---------- 入力 ----------
  const offDown = ctx.input.onDown((p: PointerInfo) => {
    if (hostPaused || !started || mode !== 'play') return;
    dragging = true;
    lastX = cv.toLocal(p).x;
    dragAcc = 0;
  });
  const offMove = ctx.input.onMove((p: PointerInfo) => {
    if (hostPaused || !started || mode !== 'play' || !dragging) return;
    const x = cv.toLocal(p).x;
    dragAcc += x - lastX;
    lastX = x;
    // 1マスぶん 動いたら 1マス ずらす
    while (Math.abs(dragAcc) >= CELL * 0.6) {
      const dir = dragAcc > 0 ? 1 : -1;
      dragAcc -= dir * CELL * 0.6;
      col = clamp(col + dir, 0, maxCol(shape, rot));
    }
  });
  const offUp = ctx.input.onUp(() => {
    dragging = false;
  });
  const offTap = ctx.input.onTap(() => {
    if (hostPaused || !started || mode !== 'play') return;
    const n = rotations(SHAPES[shape]!).length;
    rot = (rot + 1) % n;
    col = clamp(col, 0, maxCol(shape, rot));
    ctx.sfx('tap');
    lastEvent = `rot:${rot}`;
  });

  // ---------- 毎フレーム ----------
  const offFrame = ctx.onFrame((dt) => {
    if (hostPaused || !started) return;
    const now = ctx.now();
    if (mode === 'play') {
      const prev = wallY;
      wallY += wave.speed * Math.min(0.1, dt);
      // 通りぬけたら、かべが 下まで 落ちてから つぎへ（いきなり 消えると 分かりにくい）
      if (checked && wallY > 680) {
        nextWave(now);
      } else if (!checked && prev < PLAYER_Y && wallY >= PLAYER_Y) {
        checked = true;
        // 判定の しゅんかん
        if (passes(wave, shape, rot, col)) {
          const pts = wavePoints(waveIdx);
          score += pts;
          passed++;
          streak++;
          bestStreak = Math.max(bestStreak, streak);
          ctx.sfx('success');
          ctx.haptic('success');
          if (passed === 1) ctx.achieve('first-pass');
          if (passed >= 6) ctx.achieve('half');
          if (streak >= 5) ctx.achieve('streak-5');
          lastEvent = `pass:${waveIdx}:${pts}`;
        } else {
          lives--;
          crashes++;
          streak = 0;
          mode = 'hit';
          phaseUntil = now + HIT_MS;
          ctx.sfx('fail');
          ctx.haptic('error');
          lastEvent = `hit:${waveIdx}:${lives}`;
        }
      }
    } else if (mode === 'hit' && now >= phaseUntil) {
      if (lives <= 0) finish(now);
      else nextWave(now);
    } else if (mode === 'done' && !ended && now >= phaseUntil) {
      ended = true;
      ctx.end({ score });
      return;
    }
    draw();
    setData();
  });

  function nextWave(now: number): void {
    if (waveIdx + 1 >= WAVES) finish(now);
    else loadWave(waveIdx + 1);
  }

  function finish(now: number): void {
    if (passed >= WAVES) ctx.achieve('all-pass');
    if (crashes === 0) {
      score += CLEAN_BONUS;
      ctx.achieve('no-crash');
    }
    if (score >= SCORE_HI) ctx.achieve('score-hi');
    mode = 'done';
    phaseUntil = now + END_DELAY;
    ctx.sfx('medal');
    lastEvent = `finish:${score}:${passed}`;
  }

  function setData(): void {
    if (!import.meta.env.DEV) return;
    const r = ctx.root as HTMLElement;
    r.dataset.mode = mode;
    r.dataset.wave = String(waveIdx);
    r.dataset.shape = String(shape);
    r.dataset.rot = String(rot);
    r.dataset.col = String(col);
    r.dataset.wrot = String(wave.rot);
    r.dataset.wcol = String(wave.col);
    r.dataset.wally = wallY.toFixed(1);
    r.dataset.fits = passes(wave, shape, rot, col) ? '1' : '0';
    r.dataset.lives = String(lives);
    r.dataset.passed = String(passed);
    r.dataset.streak = String(streak);
    r.dataset.score = String(score);
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

  function draw(): void {
    cv.clear(C_BG);

    // HUD
    g.fillStyle = '#0d1120';
    g.fillRect(0, 0, W, HUD_H);
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.fillStyle = C_TEXT;
    g.font = 'bold 18px sans-serif';
    g.fillText(`${score}てん`, 12, HUD_H / 2);
    g.fillStyle = C_DIM;
    g.font = 'bold 13px sans-serif';
    g.fillText(`かべ ${Math.min(waveIdx + 1, WAVES)}/${WAVES}`, 116, HUD_H / 2 - 8);
    g.fillText(`とおった ${passed}・れんぞく ${streak}`, 116, HUD_H / 2 + 9);
    // ライフ
    g.textAlign = 'right';
    g.fillStyle = C_NG;
    g.font = 'bold 15px sans-serif';
    g.fillText('♥'.repeat(Math.max(0, lives)), W - 12, HUD_H / 2);

    g.textAlign = 'center';

    if (mode === 'done') {
      g.fillStyle = C_TEXT;
      g.font = 'bold 26px sans-serif';
      g.fillText(`${passed} / ${WAVES} まい とおった！`, W / 2, 280);
      g.font = 'bold 34px sans-serif';
      g.fillStyle = C_ME;
      g.fillText(`${score}てん`, W / 2, 336);
      g.fillStyle = C_DIM;
      g.font = 'bold 14px sans-serif';
      g.fillText(`ぶつかった ${crashes}かい・さいこう れんぞく ${bestStreak}`, W / 2, 380);
      return;
    }

    // たての 目やす線
    for (let c = 0; c <= COLS; c++) {
      g.strokeStyle = C_GRID;
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(GRID_X + c * CELL, 70);
      g.lineTo(GRID_X + c * CELL, 560);
      g.stroke();
    }

    // かべ
    const hole = holeCells(wave);
    const bandTop = wallY;
    for (let r = 0; r < BAND; r++) {
      for (let c = 0; c < COLS; c++) {
        if (hole.some(([hc, hr]) => hc === c && hr === r)) continue;
        const x = GRID_X + c * CELL;
        const y = bandTop + r * CELL;
        if (y > 620 || y < -CELL) continue;
        g.fillStyle = C_WALL;
        roundRect(x + 1, y + 1, CELL - 2, CELL - 2, 4);
        g.fill();
        g.strokeStyle = C_WALL_EDGE;
        g.lineWidth = 1.5;
        roundRect(x + 1, y + 1, CELL - 2, CELL - 2, 4);
        g.stroke();
      }
    }

    // じぶん
    const me = playerCells(shape, rot, col);
    const fits = passes(wave, shape, rot, col);
    for (const [c, r] of me) {
      const x = GRID_X + c * CELL;
      const y = PLAYER_Y + r * CELL;
      g.fillStyle = mode === 'hit' ? C_NG : C_ME;
      roundRect(x + 3, y + 3, CELL - 6, CELL - 6, 8);
      g.fill();
    }
    // 目
    const head = me[0]!;
    g.fillStyle = '#0d2a22';
    g.beginPath();
    g.arc(GRID_X + head[0] * CELL + CELL / 2 - 6, PLAYER_Y + head[1] * CELL + CELL / 2, 3, 0, Math.PI * 2);
    g.arc(GRID_X + head[0] * CELL + CELL / 2 + 6, PLAYER_Y + head[1] * CELL + CELL / 2, 3, 0, Math.PI * 2);
    g.fill();

    // 合っているかの めやす
    g.fillStyle = mode === 'hit' ? C_NG : fits ? C_OK : C_DIM;
    g.font = 'bold 15px sans-serif';
    g.fillText(
      mode === 'hit' ? 'ぶつかった！' : fits ? 'このまま！ ぴったり' : '形か 位置が ちがう',
      W / 2,
      596,
    );

    g.fillStyle = C_DIM;
    g.font = 'bold 12px sans-serif';
    g.fillText('なぞって よこに 動く／タップで まわる', W / 2, 620);
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
      offTap();
      offFrame();
    },
  };
}
