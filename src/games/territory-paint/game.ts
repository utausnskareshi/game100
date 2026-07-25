// =============================================================
// じんとりペイント（No.93）: 指でなぞって陣地を囲む action ゲーム（陣取り系）
// =============================================================
// - marker を指でなぞって動かす。filled から empty へ入ると trail を引き、filled へ戻ると
//   囲みこみ成立＝trail＋「敵が入れないポケット」を一気に塗る（logic.closeTrail）。
// - うろつく敵に trail をさわられる／自分の trail を横切ると ライフ−1（3つでおしまい）。
// - 目標％を塗ればステージクリア→敵が増えて速くなる。
// - 敵は固定サブステップ(1/120s)で動かす＝実時間で決定論。初期配置は rng 固定順（日替わり共通）。
// - import してよいのは game-api（types / helpers）と、このフォルダ内（logic）だけ。
import type { GameContext, IGame, PointerInfo } from '../../game-api/types';
import { clamp } from '../../game-api/helpers';
import {
  CELL,
  EMPTY,
  FILL,
  GH,
  GW,
  PLAY_Y0,
  TARGET_PCT,
  TRAIL,
  at,
  cellIndex,
  closeTrail,
  inBounds,
  makeGrid,
  percentFill,
  revertTrail,
} from './logic';

const HUD_H = PLAY_Y0;
const MARKER_SPEED = 16; // cells/s（敵よりしっかり速く＝思いきった囲みこみが成立する）
const ENEMY_R = 0.42;
const SUB = 1 / 120;
const FLASH_MS = 360;
const CELEBRATE_MS = 1100;
const END_DELAY = 1900;
const BIG_CATCH = 80;
const SCORE_HI = 1000;

type Mode = 'play' | 'over';

interface Enemy {
  x: number;
  y: number;
  vx: number;
  vy: number;
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
  const W = GW * CELL;
  const H = PLAY_Y0 + GH * CELL;
  const cv = ctx.canvas2d({ design: { w: W, h: H } });
  const g = cv.ctx;

  let mode: Mode = 'play';
  let started = false;
  let hostPaused = false;
  let ended = false;

  let grid = makeGrid();
  let mx = 0;
  let my = 0; // marker cell
  let lastSafeX = 0;
  let lastSafeY = 0;
  let drawing = false;
  let markerAccum = 0;

  let activeId = -1; // ドラッグ中のポインタid（-1=なし・単一タッチに限定）
  let fingerX = 0;
  let fingerY = 0;

  let enemies: Enemy[] = [];
  let subAccum = 0;

  let lives = 3;
  let score = 0;
  let stage = 1;
  let pct = 0;
  let claims = 0;
  let celebrating = false;
  let phaseUntil = 0;
  let flashUntil = 0;
  let effects: FloatFx[] = [];
  let lastEvent = '';

  function enemyCellList(): number[] {
    return enemies.map((e) => {
      const cx = clamp(Math.floor(e.x), 0, GW - 1);
      const cy = clamp(Math.floor(e.y), 0, GH - 1);
      return cellIndex(cx, cy);
    });
  }

  function beginStage(n: number, now: number): void {
    stage = n;
    grid = makeGrid();
    mx = 0;
    my = 0;
    lastSafeX = 0;
    lastSafeY = 0;
    drawing = false;
    markerAccum = 0;
    subAccum = 0;
    activeId = -1; // 盤替わりは指を置き直してから（保持中の指での意図しない自動描画を防ぐ）
    celebrating = false;
    pct = percentFill(grid);
    const count = Math.min(4, 1 + Math.floor((n - 1) / 2)); // 敵の数は2ステージごとに1匹（s1-2:1 / s3-4:2 / s5-6:3 …）
    const speed = 3.4 + n * 0.5; // 速さは毎ステージ上がる
    enemies = [];
    for (let i = 0; i < count; i++) {
      const rx = 3 + ctx.random() * (GW - 6);
      const ry = 3 + ctx.random() * (GH - 6);
      const ang = ctx.random() * Math.PI * 2;
      enemies.push({ x: rx, y: ry, vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed });
    }
    if (n >= 3) ctx.achieve('stage-3');
    ctx.sfx('start');
    void now;
  }

  function toOver(now: number): void {
    if (mode !== 'play') return;
    mode = 'over';
    phaseUntil = now + END_DELAY;
    ctx.sfx('fail');
    ctx.haptic('error');
    lastEvent = 'over';
  }

  function loseLife(now: number, reason: string): void {
    lives--;
    revertTrail(grid);
    drawing = false;
    mx = lastSafeX;
    my = lastSafeY;
    markerAccum = 0;
    activeId = -1;
    flashUntil = now + FLASH_MS;
    ctx.sfx('fail');
    ctx.haptic('error');
    lastEvent = reason;
    if (lives <= 0) toOver(now);
  }

  function doClose(now: number): void {
    const added = closeTrail(grid, enemyCellList());
    drawing = false;
    lastSafeX = mx;
    lastSafeY = my;
    claims++;
    score += added;
    pct = percentFill(grid);
    if (claims === 1) ctx.achieve('first-claim');
    if (added >= BIG_CATCH) ctx.achieve('big-catch');
    if (pct >= 0.5) ctx.achieve('half');
    if (score >= SCORE_HI) ctx.achieve('score-hi');
    effects.push({ x: mx * CELL + CELL / 2, y: HUD_H + my * CELL, text: `+${added}`, color: '#fff', at: now, until: now + 800 });
    ctx.sfx(added >= BIG_CATCH ? 'combo' : 'success');
    ctx.haptic(added >= BIG_CATCH ? 'success' : 'light');
    lastEvent = `close:${added}`;
    if (pct >= TARGET_PCT) stageClear(now);
  }

  function stageClear(now: number): void {
    celebrating = true;
    phaseUntil = now + CELEBRATE_MS;
    const bonus = 100 + stage * 30;
    score += bonus;
    ctx.achieve('clear-stage');
    if (score >= SCORE_HI) ctx.achieve('score-hi');
    effects.push({ x: W / 2, y: H / 2, text: 'せいはく！', color: '#ffd54a', at: now, until: now + CELEBRATE_MS });
    effects.push({ x: W / 2, y: H / 2 + 30, text: `+${bonus}`, color: '#fff', at: now + 120, until: now + CELEBRATE_MS });
    ctx.sfx('medal');
    ctx.haptic('success');
    lastEvent = `clear:${stage}`;
  }

  // marker を1マス dir 方向へ動かす（ルール適用）
  function stepToward(tx: number, ty: number, now: number): boolean {
    const dx = tx - mx;
    const dy = ty - my;
    if (dx === 0 && dy === 0) return false;
    let sx = 0;
    let sy = 0;
    if (Math.abs(dx) >= Math.abs(dy) && dx !== 0) sx = Math.sign(dx);
    else sy = Math.sign(dy);
    const nx = mx + sx;
    const ny = my + sy;
    if (!inBounds(nx, ny)) return false;
    const val = at(grid, nx, ny);
    if (!drawing) {
      if (val === FILL) {
        mx = nx;
        my = ny;
        lastSafeX = nx;
        lastSafeY = ny;
      } else {
        // filled -> empty: 描き始め
        grid[cellIndex(nx, ny)] = TRAIL;
        mx = nx;
        my = ny;
        drawing = true;
      }
      return true;
    }
    // drawing 中
    if (val === EMPTY) {
      grid[cellIndex(nx, ny)] = TRAIL;
      mx = nx;
      my = ny;
      return true;
    }
    if (val === TRAIL) {
      loseLife(now, 'self-cross');
      return false;
    }
    // val === FILL: 閉じる
    mx = nx;
    my = ny;
    doClose(now);
    return true;
  }

  function enemySubstep(): void {
    for (const e of enemies) {
      const nx = e.x + e.vx * SUB;
      if (at(grid, Math.floor(nx + Math.sign(e.vx) * ENEMY_R), Math.floor(e.y)) === FILL) e.vx = -e.vx;
      else e.x = nx;
      const ny = e.y + e.vy * SUB;
      if (at(grid, Math.floor(e.x), Math.floor(ny + Math.sign(e.vy) * ENEMY_R)) === FILL) e.vy = -e.vy;
      else e.y = ny;
    }
  }

  function enemyHitsTrail(): boolean {
    for (const e of enemies) {
      const cs = [
        [Math.floor(e.x - ENEMY_R), Math.floor(e.y)],
        [Math.floor(e.x + ENEMY_R), Math.floor(e.y)],
        [Math.floor(e.x), Math.floor(e.y - ENEMY_R)],
        [Math.floor(e.x), Math.floor(e.y + ENEMY_R)],
        [Math.floor(e.x), Math.floor(e.y)],
      ];
      for (const [cx, cy] of cs) if (at(grid, cx!, cy!) === TRAIL) return true;
    }
    return false;
  }

  // ---- 入力（ドラッグで marker をなぞる） ----
  const cellFromPoint = (lx: number, ly: number): void => {
    fingerX = clamp(Math.floor(lx / CELL), 0, GW - 1);
    fingerY = clamp(Math.floor((ly - HUD_H) / CELL), 0, GH - 1);
  };
  const offDown = ctx.input.onDown((p: PointerInfo) => {
    if (hostPaused || !started || mode !== 'play' || celebrating) return;
    if (activeId >= 0) return; // 単一タッチ：2本目の指は無視
    activeId = p.id;
    const l = cv.toLocal(p);
    cellFromPoint(l.x, l.y);
  });
  const offMove = ctx.input.onMove((p: PointerInfo) => {
    if (hostPaused || activeId < 0 || p.id !== activeId) return;
    const l = cv.toLocal(p);
    cellFromPoint(l.x, l.y);
  });
  const offUp = ctx.input.onUp((p: PointerInfo) => {
    if (p.id === activeId) activeId = -1;
  });

  // ---- 毎フレーム ----
  const offFrame = ctx.onFrame((dt: number) => {
    if (hostPaused || !started) return;
    const now = ctx.now();

    if (mode === 'play') {
      if (celebrating) {
        if (now >= phaseUntil) beginStage(stage + 1, now);
      } else {
        // 敵（固定サブステップ）
        subAccum += dt;
        let guard = 0;
        while (subAccum >= SUB && guard++ < 400) {
          subAccum -= SUB;
          enemySubstep();
          if (enemyHitsTrail()) {
            loseLife(now, 'enemy');
            break;
          }
        }
        // marker（指を追いかける）
        if (activeId >= 0 && mode === 'play' && !celebrating) {
          markerAccum += MARKER_SPEED * dt;
          let steps = 0;
          while (markerAccum >= 1 && steps++ < 40) {
            markerAccum -= 1;
            const moved = stepToward(fingerX, fingerY, now);
            if (!moved || celebrating || mode !== 'play') break;
          }
        }
      }
    } else if (mode === 'over' && !ended && now >= phaseUntil) {
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
    r.dataset.mode = mode;
    r.dataset.lives = String(lives);
    r.dataset.score = String(score);
    r.dataset.stage = String(stage);
    r.dataset.pct = (pct * 100).toFixed(1);
    r.dataset.target = String(Math.round(TARGET_PCT * 100));
    r.dataset.mx = String(mx);
    r.dataset.my = String(my);
    r.dataset.drawing = drawing ? '1' : '0';
    r.dataset.celebrating = celebrating ? '1' : '0';
    r.dataset.claims = String(claims);
    r.dataset.enemies = JSON.stringify(enemies.map((e) => ({ x: +e.x.toFixed(2), y: +e.y.toFixed(2) })));
    r.dataset.last = lastEvent;
  }

  // ---- 描画 ----
  function draw(now: number): void {
    // 背景（未確定の empty）
    cv.clear('#1a2436');
    // グリッドのセル
    for (let y = 0; y < GH; y++) {
      for (let x = 0; x < GW; x++) {
        const v = grid[cellIndex(x, y)]!;
        if (v === FILL) {
          g.fillStyle = '#2f8f6b';
          g.fillRect(x * CELL, HUD_H + y * CELL, CELL, CELL);
          g.fillStyle = 'rgba(255,255,255,.06)';
          g.fillRect(x * CELL, HUD_H + y * CELL, CELL, 2);
        } else if (v === TRAIL) {
          g.fillStyle = '#ffd54a';
          g.fillRect(x * CELL + 3, HUD_H + y * CELL + 3, CELL - 6, CELL - 6);
        }
      }
    }
    // 敵
    for (const e of enemies) {
      const ex = e.x * CELL;
      const ey = HUD_H + e.y * CELL;
      g.fillStyle = '#ff5a6a';
      g.beginPath();
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + now / 400;
        const rr = i % 2 === 0 ? ENEMY_R * CELL : ENEMY_R * CELL * 0.55;
        const px = ex + Math.cos(a) * rr;
        const py = ey + Math.sin(a) * rr;
        if (i === 0) g.moveTo(px, py);
        else g.lineTo(px, py);
      }
      g.closePath();
      g.fill();
      g.fillStyle = '#fff';
      g.beginPath();
      g.arc(ex, ey, 2.4, 0, Math.PI * 2);
      g.fill();
    }
    // marker
    const cxp = mx * CELL + CELL / 2;
    const cyp = HUD_H + my * CELL + CELL / 2;
    g.fillStyle = drawing ? '#fff2a0' : '#eafff4';
    g.beginPath();
    g.arc(cxp, cyp, 6.5, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#1a2436';
    g.lineWidth = 2;
    g.stroke();

    // フラッシュ
    if (now < flashUntil) {
      const a = (flashUntil - now) / FLASH_MS;
      g.fillStyle = `rgba(220,60,50,${a * 0.35})`;
      g.fillRect(0, HUD_H, W, H - HUD_H);
    }

    // 浮かぶテキスト
    for (const e of effects) {
      if (now < e.at) continue;
      const a = clamp((e.until - now) / 400, 0, 1);
      g.globalAlpha = a;
      g.fillStyle = e.color;
      g.font = 'bold 20px sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.strokeStyle = 'rgba(20,30,45,.85)';
      g.lineWidth = 3.5;
      g.strokeText(e.text, e.x, e.y);
      g.fillText(e.text, e.x, e.y);
      g.globalAlpha = 1;
    }

    // HUD
    g.fillStyle = 'rgba(20,30,45,.9)';
    g.fillRect(0, 0, W, HUD_H);
    // 進捗バー
    const tgt = TARGET_PCT;
    g.fillStyle = 'rgba(255,255,255,.15)';
    g.fillRect(12, HUD_H - 8, W - 24, 4);
    g.fillStyle = pct >= tgt ? '#8ae05a' : '#3ec8a0';
    g.fillRect(12, HUD_H - 8, (W - 24) * clamp(pct / tgt, 0, 1), 4);
    g.fillStyle = '#fff';
    g.font = 'bold 17px sans-serif';
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.fillText(`${Math.round(pct * 100)}% / ${Math.round(tgt * 100)}%`, 12, 15);
    g.fillStyle = '#cfe8ff';
    g.font = 'bold 13px sans-serif';
    g.fillText(`ステージ${stage}`, 150, 15);
    for (let i = 0; i < 3; i++) {
      const x = W - 18 - i * 20;
      g.fillStyle = i < lives ? '#ff5a76' : 'rgba(255,255,255,.22)';
      g.beginPath();
      g.arc(x, 15, 6, 0, Math.PI * 2);
      g.fill();
    }
    // ヒント
    if (claims === 0 && mode === 'play' && !celebrating) {
      g.fillStyle = 'rgba(255,255,255,.85)';
      g.font = 'bold 14px sans-serif';
      g.textAlign = 'center';
      g.fillText('ふちから 指でなぞって 囲もう！', W / 2, H - 16);
    }

    if (mode === 'over') {
      g.fillStyle = 'rgba(20,30,45,.82)';
      g.fillRect(0, 0, W, H);
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = '#fff';
      g.font = 'bold 30px sans-serif';
      g.fillText('おしまい！', W / 2, H / 2 - 40);
      g.font = 'bold 26px sans-serif';
      g.fillText(`${score}てん`, W / 2, H / 2 + 2);
      g.fillStyle = '#ffd54a';
      g.font = 'bold 15px sans-serif';
      g.fillText(`ステージ${stage}・${Math.round(pct * 100)}%`, W / 2, H / 2 + 36);
    }
  }

  draw(ctx.now());
  setData();

  return {
    start() {
      started = true;
      beginStage(1, ctx.now());
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
