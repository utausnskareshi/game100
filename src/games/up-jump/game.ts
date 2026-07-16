// =============================================================
// うえうえジャンプ（No.58）: 足場を ジャンプで のぼれるだけ のぼろう！
// =============================================================
// - キャラは 自動で ジャンプ。左右は スマホの かたむき（または画面ドラッグ）で動かす。
//   足場に のると はねる。バネは 大ジャンプ。下に落ちたら おしまい。高さ＝スコア。
// - 足場生成・物理定数は logic.ts（純ロジック・rng注入）。全画面 Canvas・純描画。
// - 時間は ctx.now・乱数は ctx.random・setTimeout 不使用。
// - import してよいのは game-api（types / helpers）と、このフォルダ内（logic）だけ
import type { GameContext, IGame } from '../../game-api/types';
import { createDragTilt, type DragTilt } from '../../game-api/helpers';
import {
  GRAVITY,
  H,
  JUMP_V,
  PLAT_H,
  PLAT_W,
  type Platform,
  SPRING_V,
  W,
  landsOn,
  nextPlatform,
} from './logic';

const MOVE_SPEED = 360; // かたむき1のときの横速度
const CAM_Y = 250; // これより上に行くと 世界を下げる（スクロール）
const CHAR_HW = 16; // キャラ半幅
const CHAR_HH = 18;
const END_DELAY = 1700;

type Mode = 'play' | 'over';

export function createGame(ctx: GameContext): IGame {
  const cv = ctx.canvas2d({ design: { w: W, h: H } });
  const g = cv.ctx;

  let mode: Mode = 'play';
  let hostPaused = false;
  let charX = W / 2;
  let charY = H - 120;
  let vy = 0;
  let vx = 0;
  let facing = 1;
  let plats: Platform[] = [];
  let climbedPx = 0;
  let meters = 0;
  let started = false;
  let endAt = 0;
  let ended = false;
  let springFlashUntil = 0;

  const tiltIn: DragTilt = createDragTilt(ctx, { toLocal: (p) => cv.toLocal(p), div: 55, enabled: () => mode === 'play' && !hostPaused });

  function setData(): void {
    if (!import.meta.env.DEV) return;
    const r = ctx.root as HTMLElement;
    r.dataset.mode = mode;
    r.dataset.meters = String(meters);
    r.dataset.score = String(meters);
    r.dataset.charx = charX.toFixed(1);
    r.dataset.chary = charY.toFixed(1);
    r.dataset.vy = vy.toFixed(1);
    r.dataset.plats = String(plats.length);
    r.dataset.topy = plats.length ? Math.min(...plats.map((p) => p.y)).toFixed(0) : '0';
    r.dataset.platlist = plats.map((p) => `${p.x.toFixed(0)},${p.y.toFixed(0)},${p.type[0]}`).join(';');
  }

  function reset(): void {
    charX = W / 2;
    charY = H - 120;
    vy = -JUMP_V;
    vx = 0;
    plats = [];
    climbedPx = 0;
    meters = 0;
    // スタート足場（広め・中央）＋上へ何枚か
    plats.push({ x: W / 2 - PLAT_W / 2, y: H - 90, type: 'normal', vx: 0, used: false });
    let prevY = H - 90;
    while (prevY > -40) {
      const p = nextPlatform(prevY, 0, ctx.random);
      plats.push(p);
      prevY = p.y;
    }
    tiltIn.reset();
    mode = 'play';
    ended = false;
  }

  function spawnAbove(): void {
    let topY = Math.min(...plats.map((p) => p.y));
    while (topY > -40) {
      const p = nextPlatform(topY, climbedPx, ctx.random);
      plats.push(p);
      topY = p.y;
    }
  }

  function bump(threshold: number, id: string): void {
    if (meters >= threshold) ctx.achieve(id);
  }

  function update(dt: number): void {
    // 横（かたむき＋ドラッグ）
    const t = tiltIn.value();
    vx = t.x * MOVE_SPEED;
    if (Math.abs(vx) > 4) facing = vx > 0 ? 1 : -1;
    charX += vx * dt;
    // 画面はしで反対側へワープ（定番）
    if (charX < -CHAR_HW) charX = W + CHAR_HW;
    else if (charX > W + CHAR_HW) charX = -CHAR_HW;

    // 縦（重力→バウンド）
    const footPrev = charY + CHAR_HH;
    vy += GRAVITY * dt;
    charY += vy * dt;
    const footNow = charY + CHAR_HH;

    if (vy > 0) {
      // 落下中：一番 高い（yが小さい）着地足場を選ぶ
      let landed: Platform | null = null;
      for (const p of plats) {
        if (landsOn(charX, CHAR_HW, footPrev, footNow, p)) {
          if (!landed || p.y < landed.y) landed = p;
        }
      }
      if (landed) {
        charY = landed.y - CHAR_HH;
        if (landed.type === 'spring') {
          vy = -SPRING_V;
          landed.used = true;
          springFlashUntil = ctx.now() + 300;
          ctx.achieve('spring');
          ctx.sfx('powerup');
          ctx.haptic('medium');
        } else {
          vy = -JUMP_V;
          ctx.sfx('tap');
          if (landed.type === 'moving') ctx.achieve('moving');
        }
      }
    }

    // 動く足場
    for (const p of plats) {
      if (p.type === 'moving') {
        p.x += p.vx * dt;
        if (p.x < 0) { p.x = 0; p.vx = Math.abs(p.vx); }
        else if (p.x > W - PLAT_W) { p.x = W - PLAT_W; p.vx = -Math.abs(p.vx); }
      }
    }

    // カメラ（上へ行ったら世界を下げる）
    if (charY < CAM_Y) {
      const shift = CAM_Y - charY;
      charY = CAM_Y;
      for (const p of plats) p.y += shift;
      climbedPx += shift;
      meters = Math.floor(climbedPx / 10);
      plats = plats.filter((p) => p.y < H + PLAT_H + 20);
      spawnAbove();
      bump(50, 'climb-50');
      bump(150, 'climb-150');
      bump(300, 'climb-300');
      bump(500, 'score-hi');
    }

    // 落下でゲームオーバー
    if (charY - CHAR_HH > H) {
      mode = 'over';
      endAt = ctx.now() + END_DELAY;
      ctx.sfx('fail');
      ctx.haptic('error');
    }
  }

  const offFrame = ctx.onFrame((dt) => {
    if (hostPaused) return;
    const now = ctx.now();
    if (mode === 'play' && started) update(dt);
    if (mode === 'over' && !ended && now >= endAt) {
      ended = true;
      ctx.end({ score: meters });
      return;
    }
    draw(now);
    setData();
  });

  // ---- 描画 ----
  function draw(now: number): void {
    const sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#bfe8ff');
    sky.addColorStop(1, '#eafaf0');
    g.fillStyle = sky;
    g.fillRect(0, 0, W, H);

    // 足場
    for (const p of plats) {
      const col = p.type === 'moving' ? '#4a8de0' : p.type === 'spring' ? '#46b96a' : '#7bc86c';
      g.fillStyle = col;
      roundRect(p.x, p.y, PLAT_W, PLAT_H, 6);
      g.fill();
      if (p.type === 'spring') {
        g.strokeStyle = '#2f7d47';
        g.lineWidth = 3;
        g.beginPath();
        g.moveTo(p.x + PLAT_W / 2 - 8, p.y);
        g.lineTo(p.x + PLAT_W / 2 - 8, p.y - 8);
        g.lineTo(p.x + PLAT_W / 2 + 8, p.y - 4);
        g.lineTo(p.x + PLAT_W / 2 + 8, p.y - 12);
        g.stroke();
      }
    }

    // キャラ
    drawChar(now);

    // HUD
    g.fillStyle = '#2c3d57';
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.font = 'bold 24px sans-serif';
    g.fillText(`${meters}m`, 14, 30);

    if (!started) {
      g.fillStyle = 'rgba(20,40,60,.5)';
      g.fillRect(0, 0, W, H);
      g.fillStyle = '#fff';
      g.textAlign = 'center';
      g.font = 'bold 22px sans-serif';
      g.fillText('かたむけて 左右に うごかそう！', W / 2, H / 2 - 20);
      g.font = 'bold 16px sans-serif';
      g.fillText('（画面ドラッグでもOK）', W / 2, H / 2 + 14);
    }
    if (mode === 'over') {
      g.fillStyle = 'rgba(20,40,60,.72)';
      g.fillRect(0, 0, W, H);
      g.fillStyle = '#fff';
      g.textAlign = 'center';
      g.font = 'bold 32px sans-serif';
      g.fillText('おっこちた〜！', W / 2, H / 2 - 30);
      g.font = 'bold 26px sans-serif';
      g.fillText(`${meters}m のぼった`, W / 2, H / 2 + 12);
    }
  }

  function drawChar(now: number): void {
    const spring = now < springFlashUntil;
    g.save();
    g.translate(charX, charY);
    g.fillStyle = spring ? '#ffd24a' : '#5ec06a';
    g.beginPath();
    g.ellipse(0, 0, CHAR_HW, CHAR_HH, 0, 0, Math.PI * 2);
    g.fill();
    // 目
    g.fillStyle = '#fff';
    g.beginPath();
    g.arc(facing * 5, -4, 5, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#1b2b1b';
    g.beginPath();
    g.arc(facing * 6, -4, 2.5, 0, Math.PI * 2);
    g.fill();
    // 足（ジャンプ中は下に）
    g.restore();
  }

  function roundRect(x: number, y: number, w: number, h: number, rad: number): void {
    const rr = Math.min(rad, w / 2, h / 2);
    g.beginPath();
    g.moveTo(x + rr, y);
    g.arcTo(x + w, y, x + w, y + h, rr);
    g.arcTo(x + w, y + h, x, y + h, rr);
    g.arcTo(x, y + h, x, y, rr);
    g.arcTo(x, y, x + w, y, rr);
    g.closePath();
  }

  reset();
  draw(0);
  setData();

  return {
    start() {
      reset();
      started = true;
    },
    pause() {
      hostPaused = true;
    },
    resume() {
      hostPaused = false;
      tiltIn.reset();
    },
    resize() {
      draw(ctx.now());
    },
    destroy() {
      tiltIn.destroy();
      offFrame();
    },
  };
}
