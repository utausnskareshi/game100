// =============================================================
// みずみちほり（No.87）: すなを掘って泉の水を3つの花にとどける水路パズル
// =============================================================
// - タップ＝すなを1マス掘る（岩は掘れない・コツン）。水は1ティックに1マスずつ
//   「下に落ちる・足元が固ければ横にひろがる」（logic.ts のCA・完全決定論）。
// - 掘れる回数はパー+2。さいごの1掘りでも届かなければ「みずぎれ」＝そのレベルは0点。
// - 盤面は「実際に水が通れる歩き」を彫る構成的生成＝必ず解ける保証つき（logic.ts）。
// - 全画面 Canvas・時間は ctx.now 期限方式・setTimeout 不使用。
// - import してよいのは game-api（types / helpers）と、このフォルダ内（logic）だけ
import type { GameContext, IGame, PointerInfo } from '../../game-api/types';
import {
  BLOOM_PTS,
  CELL,
  COLS,
  DIG_BONUS,
  EXTRA_DIGS,
  LEVELS,
  ROWS,
  SCORE_HI,
  T_AIR,
  T_FLOWER,
  T_ROCK,
  T_SAND,
  T_SPRING,
  type WaterLevel,
  genLevel,
  idx,
  speedBonus,
  stepWater,
} from './logic';

const W = 360;
const H = 640;
const HUD_H = 40;
const BOARD_X = (W - COLS * CELL) / 2;
const BOARD_Y = 56;
const TICK_MS = 110;
const INTRO_MS = 1500;
const CLEAR_MS = 2000;
const STUCK_MS = 1900;
const END_DELAY = 2000;
/** 掘りきったあと、水がこれだけ動かなければ「みずぎれ」 */
const IDLE_TICKS_FAIL = 10;

type Mode = 'intro' | 'play' | 'clear' | 'stuck' | 'over';

interface Crumble {
  x: number;
  y: number;
  vx: number;
  vy: number;
  at: number;
}

interface FloatFx {
  x: number;
  y: number;
  text: string;
  color: string;
  at: number;
  until: number;
}

export function createGame(ctx: GameContext): IGame {
  const cv = ctx.canvas2d({ design: { w: W, h: H } });
  const g = cv.ctx;

  // 3レベルを最初に一括生成（rng 消費順固定＝決定論）
  const levels: WaterLevel[] = [];
  for (let i = 0; i < LEVELS; i++) levels.push(genLevel(ctx.random, i));

  let mode: Mode = 'intro';
  let started = false;
  let hostPaused = false;
  let ended = false;
  let levelIdx = 0;
  let grid = new Uint8Array(0);
  let water = new Uint8Array(0);
  let waterAt: number[] = [];
  let bloomAt: number[] = [0, 0, 0];
  let bloomed = 0;
  let digsUsed = 0;
  let score = 0;
  let cleared = 0;
  let phaseUntil = 0;
  let nextTickAt = 0;
  let idleTicks = 0;
  let levelStartAt = 0;
  let crumbs: Crumble[] = [];
  let effects: FloatFx[] = [];
  let shakeRockAt = 0;
  let shakeRockCell = -1;
  let lastEvent = '';

  const level = (): WaterLevel => levels[levelIdx]!;
  const maxDigs = (): number => level().par + EXTRA_DIGS;
  const digsLeft = (): number => maxDigs() - digsUsed;

  function addScore(n: number): void {
    score += n;
    if (score >= SCORE_HI) ctx.achieve('score-hi');
  }

  function beginLevel(i: number, now: number): void {
    levelIdx = i;
    const lv = level();
    grid = new Uint8Array(lv.grid);
    water = new Uint8Array(grid.length);
    water[idx(lv.spring.c, lv.spring.r)] = 1;
    waterAt = new Array(grid.length).fill(0);
    bloomAt = [0, 0, 0];
    bloomed = 0;
    digsUsed = 0;
    idleTicks = 0;
    crumbs = [];
    mode = 'intro';
    phaseUntil = now + INTRO_MS;
    ctx.sfx('tick');
  }

  function advance(now: number): void {
    if (levelIdx + 1 < LEVELS) {
      beginLevel(levelIdx + 1, now);
    } else {
      if (cleared === LEVELS) ctx.achieve('all-levels');
      mode = 'over';
      phaseUntil = now + END_DELAY;
      ctx.sfx('medal');
    }
  }

  function doClear(now: number): void {
    cleared++;
    const ms = now - levelStartAt;
    const pts = BLOOM_PTS * 3 + DIG_BONUS * digsLeft() + speedBonus(ms);
    addScore(pts);
    ctx.achieve('level-clear');
    if (digsUsed === level().par) ctx.achieve('no-waste');
    if (ms <= 30_000) ctx.achieve('speedy');
    mode = 'clear';
    phaseUntil = now + CLEAR_MS;
    effects.push({ x: W / 2, y: 300, text: `+${pts}`, color: '#ffd54a', at: now + 200, until: now + 1600 });
    ctx.sfx('success');
    ctx.haptic('success');
    lastEvent = `clear:${pts}`;
  }

  // ---- 入力（タップ＝掘る） ----
  const offDown = ctx.input.onDown((p: PointerInfo) => {
    if (hostPaused || !started || mode !== 'play') return;
    const l = cv.toLocal(p);
    const c = Math.floor((l.x - BOARD_X) / CELL);
    const r = Math.floor((l.y - BOARD_Y) / CELL);
    if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return;
    const i = idx(c, r);
    const now = ctx.now();
    if (grid[i] === T_ROCK) {
      shakeRockAt = now;
      shakeRockCell = i;
      ctx.sfx('tick');
      lastEvent = 'rock';
      return;
    }
    if (grid[i] !== T_SAND) return;
    if (digsLeft() <= 0) {
      ctx.sfx('tick');
      lastEvent = 'no-digs';
      return;
    }
    grid[i] = T_AIR;
    digsUsed++;
    idleTicks = 0;
    const cx = BOARD_X + c * CELL + CELL / 2;
    const cy = BOARD_Y + r * CELL + CELL / 2;
    for (let k = 0; k < 6; k++) {
      crumbs.push({ x: cx, y: cy, vx: Math.cos(k * 1.05 + c) * 60, vy: -40 - ((k * 17 + r) % 3) * 30, at: now });
    }
    ctx.sfx('tap');
    ctx.haptic('light');
    lastEvent = `dig:${digsUsed}`;
  });

  // ---- 毎フレーム ----
  const offFrame = ctx.onFrame(() => {
    if (hostPaused) return;
    const now = ctx.now();
    if (mode === 'intro' && started && now >= phaseUntil) {
      mode = 'play';
      levelStartAt = now;
      nextTickAt = now + TICK_MS;
      ctx.sfx('start');
    } else if (mode === 'play') {
      while (now >= nextTickAt) {
        nextTickAt += TICK_MS;
        const grew = stepWater(grid, water);
        if (grew) {
          idleTicks = 0;
          for (let i = 0; i < water.length; i++) if (water[i] === 1 && waterAt[i] === 0) waterAt[i] = now;
        } else {
          idleTicks++;
        }
        // 開花チェック
        const lv = level();
        lv.flowers.forEach((f, fi) => {
          if (bloomAt[fi] === 0 && water[idx(f.c, f.r)] === 1) {
            bloomAt[fi] = now;
            bloomed++;
            ctx.achieve('first-bloom');
            ctx.sfx('combo');
            ctx.haptic('success');
            effects.push({ x: BOARD_X + f.c * CELL + CELL / 2, y: BOARD_Y + f.r * CELL - 6, text: 'さいた！', color: '#ff9ad5', at: now, until: now + 1000 });
            lastEvent = `bloom:${bloomed}`;
          }
        });
        if (bloomed === 3) {
          doClear(now);
          break;
        }
        if (digsLeft() <= 0 && idleTicks >= IDLE_TICKS_FAIL) {
          mode = 'stuck';
          phaseUntil = now + STUCK_MS;
          ctx.sfx('fail');
          lastEvent = 'stuck';
          break;
        }
      }
    } else if ((mode === 'clear' || mode === 'stuck') && now >= phaseUntil) {
      advance(now);
    } else if (mode === 'over' && !ended && now >= phaseUntil) {
      ended = true;
      ctx.end({ score });
      return;
    }
    crumbs = crumbs.filter((cb) => now - cb.at < 500);
    effects = effects.filter((e) => e.until > now);
    draw(now);
    setData(now);
  });

  function setData(now: number): void {
    if (!import.meta.env.DEV) return;
    void now;
    const r = ctx.root as HTMLElement;
    r.dataset.mode = mode;
    r.dataset.level = String(levelIdx + 1);
    r.dataset.digsUsed = String(digsUsed);
    r.dataset.digsLeft = String(digsLeft());
    r.dataset.par = String(level().par);
    r.dataset.bloomed = String(bloomed);
    r.dataset.cleared = String(cleared);
    r.dataset.score = String(score);
    r.dataset.idle = String(idleTicks);
    r.dataset.last = lastEvent;
  }

  // ---- 描画 ----
  const off = document.createElement('canvas');
  off.width = W * 2;
  off.height = H * 2;
  const og = off.getContext('2d');

  function bakeStatic(): void {
    if (!og) return;
    og.setTransform(2, 0, 0, 2, 0, 0);
    const bg = og.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#8fd0f0');
    bg.addColorStop(0.16, '#a8dcf4');
    bg.addColorStop(0.17, '#8a6a42');
    bg.addColorStop(1, '#5f452a');
    og.fillStyle = bg;
    og.fillRect(0, 0, W, H);
    // 盤のわく
    og.fillStyle = 'rgba(0,0,0,.25)';
    og.fillRect(BOARD_X - 5, BOARD_Y - 5, COLS * CELL + 10, ROWS * CELL + 10);
    og.strokeStyle = '#3d2c18';
    og.lineWidth = 3;
    og.strokeRect(BOARD_X - 4, BOARD_Y - 4, COLS * CELL + 8, ROWS * CELL + 8);
  }
  bakeStatic();

  function cellHash(c: number, r: number): number {
    return ((c * 73856093) ^ (r * 19349663)) >>> 0;
  }

  function draw(now: number): void {
    g.drawImage(off, 0, 0, W, H);
    const lv = level();

    // セル描画
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const i = idx(c, r);
        const x = BOARD_X + c * CELL;
        const y = BOARD_Y + r * CELL;
        const t = grid[i];
        if (t === T_SAND) {
          g.fillStyle = '#c9a36a';
          g.fillRect(x, y, CELL, CELL);
          g.fillStyle = 'rgba(122,90,40,.35)';
          const h = cellHash(c, r);
          g.fillRect(x + (h % 18) + 3, y + ((h >> 5) % 18) + 3, 3, 3);
          g.fillRect(x + ((h >> 9) % 20) + 2, y + ((h >> 13) % 20) + 2, 2, 2);
          g.strokeStyle = 'rgba(94,68,32,.25)';
          g.lineWidth = 1;
          g.strokeRect(x + 0.5, y + 0.5, CELL - 1, CELL - 1);
        } else if (t === T_ROCK) {
          g.fillStyle = '#c9a36a';
          g.fillRect(x, y, CELL, CELL);
          let ox = 0;
          if (i === shakeRockCell && now - shakeRockAt < 220) ox = Math.sin((now - shakeRockAt) / 18) * 2;
          g.fillStyle = '#8a8f98';
          g.beginPath();
          g.ellipse(x + CELL / 2 + ox, y + CELL / 2 + 2, CELL * 0.42, CELL * 0.36, 0, 0, Math.PI * 2);
          g.fill();
          g.fillStyle = 'rgba(255,255,255,.25)';
          g.beginPath();
          g.ellipse(x + CELL / 2 - 4 + ox, y + CELL / 2 - 4, CELL * 0.14, CELL * 0.1, -0.5, 0, Math.PI * 2);
          g.fill();
        } else {
          // AIR / SPRING / FLOWER の背景（ほら穴）
          g.fillStyle = '#4a3220';
          g.fillRect(x, y, CELL, CELL);
          if (water[i]) {
            const age = Math.min(1, (now - (waterAt[i] || now)) / 300);
            g.fillStyle = `rgba(61,157,240,${0.55 + 0.35 * age})`;
            g.fillRect(x, y + CELL * (1 - age) * 0.3, CELL, CELL * (1 - (1 - age) * 0.3));
            // 水面のきらめき（上が水でないときだけ）
            const above = r > 0 ? idx(c, r - 1) : -1;
            if (above < 0 || !water[above]) {
              g.fillStyle = 'rgba(200,235,255,.8)';
              g.fillRect(x + 2 + Math.sin(now / 300 + c) * 2, y + 2, CELL - 8, 2.5);
            }
          }
        }
        if (t === T_SPRING) {
          g.fillStyle = '#6a7a8a';
          g.fillRect(x + 2, y + 2, CELL - 4, CELL - 4);
          g.fillStyle = '#3d9df0';
          g.fillRect(x + 8, y + 10, CELL - 16, CELL - 12);
          g.fillStyle = '#cfe8ff';
          g.fillRect(x + CELL / 2 - 2, y + 14 + ((now / 160) % 10), 4, 6);
        }
        if (t === T_FLOWER) {
          const fi = lv.flowers.findIndex((f) => f.c === c && f.r === r);
          const bAt = fi >= 0 ? bloomAt[fi]! : 0;
          // くき
          g.strokeStyle = '#3f8a4a';
          g.lineWidth = 3;
          g.beginPath();
          g.moveTo(x + CELL / 2, y + CELL - 3);
          g.lineTo(x + CELL / 2, y + CELL / 2);
          g.stroke();
          if (bAt > 0) {
            const p = Math.min(1, (now - bAt) / 500);
            const pr = 5 + p * 6;
            g.fillStyle = '#ff9ad5';
            for (let k = 0; k < 5; k++) {
              const a = (k / 5) * Math.PI * 2 + p * 2;
              g.beginPath();
              g.arc(x + CELL / 2 + Math.cos(a) * pr * 0.7, y + CELL / 2 - 2 + Math.sin(a) * pr * 0.7, pr * 0.55, 0, Math.PI * 2);
              g.fill();
            }
            g.fillStyle = '#ffd54a';
            g.beginPath();
            g.arc(x + CELL / 2, y + CELL / 2 - 2, 4 + p * 1.5, 0, Math.PI * 2);
            g.fill();
          } else {
            g.fillStyle = '#7ec87a';
            g.beginPath();
            g.ellipse(x + CELL / 2, y + CELL / 2 - 2, 5, 7, 0, 0, Math.PI * 2);
            g.fill();
          }
        }
      }
    }

    // 掘りくず
    g.fillStyle = '#b08a52';
    for (const cb of crumbs) {
      const t = (now - cb.at) / 1000;
      g.fillRect(cb.x + cb.vx * t - 2, cb.y + cb.vy * t + 260 * t * t - 2, 4, 4);
    }

    // うかぶテキスト
    for (const e of effects) {
      if (now < e.at) continue;
      const a = Math.min(1, (e.until - now) / 400);
      g.globalAlpha = Math.max(0, a);
      g.fillStyle = e.color;
      g.font = 'bold 16px sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.strokeStyle = 'rgba(40,28,14,.8)';
      g.lineWidth = 3;
      const rise = ((now - e.at) / 1200) * 20;
      g.strokeText(e.text, e.x, e.y - rise);
      g.fillText(e.text, e.x, e.y - rise);
      g.globalAlpha = 1;
    }

    // バナー
    if (mode === 'intro' && started) {
      banner(`レベル ${levelIdx + 1}`, levelIdx === 0 ? 'すなを掘って 水を3つの花へ！' : levelIdx === 1 ? '岩がふえた！まわり道も考えよう' : 'みちは くねくね。掘る前によく見て！');
    } else if (mode === 'clear') {
      banner('ぜんぶ さいた！', null);
    } else if (mode === 'stuck') {
      banner('みずぎれ…', 'シャベルが たりなかった');
    }

    // HUD
    if (mode !== 'over') {
      g.fillStyle = 'rgba(40,28,14,.9)';
      g.fillRect(0, 0, W, HUD_H);
      g.textBaseline = 'middle';
      g.textAlign = 'left';
      g.fillStyle = '#fff';
      g.font = 'bold 19px sans-serif';
      g.fillText(`${score}てん`, 12, HUD_H / 2);
      g.fillStyle = '#e8d5b5';
      g.font = 'bold 15px sans-serif';
      g.fillText(`レベル ${levelIdx + 1}/${LEVELS}`, 118, HUD_H / 2);
      g.fillText(`⛏️×${digsLeft()}`, 228, HUD_H / 2);
      // 下部: 花の状況
      g.fillStyle = 'rgba(40,28,14,.75)';
      g.fillRect(0, H - 56, W, 56);
      g.textAlign = 'left';
      g.fillStyle = '#e8d5b5';
      g.font = 'bold 14px sans-serif';
      g.fillText('さいた花：', 14, H - 28);
      for (let k = 0; k < 3; k++) {
        g.font = '20px sans-serif';
        g.fillText(k < bloomed ? '🌸' : '🥀', 96 + k * 30, H - 28);
      }
      g.fillStyle = digsLeft() <= 1 ? '#ffb3a8' : '#e8d5b5';
      g.font = 'bold 14px sans-serif';
      g.fillText(digsLeft() <= 1 ? 'のこりわずか！しんちょうに' : 'タップ＝すなを掘る', 196, H - 28);
    } else {
      g.fillStyle = 'rgba(40,28,14,.85)';
      g.fillRect(0, 0, W, H);
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = '#fff';
      g.font = 'bold 30px sans-serif';
      g.fillText('おしまい！', W / 2, H / 2 - 56);
      g.font = 'bold 26px sans-serif';
      g.fillText(`${score}てん`, W / 2, H / 2 - 12);
      g.fillStyle = '#ffd54a';
      g.font = 'bold 16px sans-serif';
      g.fillText(`さかせた花だん ${cleared}/${LEVELS}`, W / 2, H / 2 + 24);
      if (cleared === LEVELS) g.fillText('ぜんめんクリア！', W / 2, H / 2 + 52);
    }
  }

  function banner(title: string, sub: string | null): void {
    const bw = 312;
    const bh = sub ? 84 : 58;
    const y = 250;
    g.fillStyle = 'rgba(40,28,14,.85)';
    g.beginPath();
    g.moveTo(W / 2 - bw / 2 + 14, y);
    g.arcTo(W / 2 + bw / 2, y, W / 2 + bw / 2, y + bh, 14);
    g.arcTo(W / 2 + bw / 2, y + bh, W / 2 - bw / 2, y + bh, 14);
    g.arcTo(W / 2 - bw / 2, y + bh, W / 2 - bw / 2, y, 14);
    g.arcTo(W / 2 - bw / 2, y, W / 2 + bw / 2, y, 14);
    g.closePath();
    g.fill();
    g.fillStyle = '#fff';
    g.font = 'bold 24px sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(title, W / 2, y + (sub ? 30 : bh / 2));
    if (sub) {
      g.fillStyle = '#ffd57a';
      g.font = 'bold 13px sans-serif';
      g.fillText(sub, W / 2, y + 60);
    }
  }

  draw(ctx.now());
  setData(ctx.now());

  return {
    start() {
      started = true;
      beginLevel(0, ctx.now());
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
      offFrame();
    },
  };
}
