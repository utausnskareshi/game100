// =============================================================
// トントンきこり（No.94）: 左右タップで丸太を切る反射ゲーム（左右に切りかえる木こり系）
// =============================================================
// - 画面の左半分／右半分をタップすると、その側から丸太を切る（きこりもその側へ）。
//   切るとスタックが1つ落ち、落ちてきた丸太の枝が自分の側だと ぶつかる＝おしまい。
// - エネルギーゲージは常に減り、切ると回復。切りつづけないと じかんぎれ。
// - 丸太の枝は rng 固定順（枝あり?→左右）で生成＝決定論。枝は最大1本＝必ず安全な側がある。
// - import してよいのは game-api（types / helpers）と、このフォルダ内（logic）だけ。
import type { GameContext, IGame, PointerInfo } from '../../game-api/types';
import { clamp } from '../../game-api/helpers';
import {
  BR_LEFT,
  BR_NONE,
  BR_RIGHT,
  CHOP_GAIN,
  H,
  START_ENERGY,
  VISIBLE,
  W,
  branchHits,
  depRate,
  nextBranch,
  scoreOf,
} from './logic';

const HUD_H = 40;
const LW = 58;
const LH = 62;
const GROUND_Y = H - 54;
const END_DELAY = 1700;
const FLASH_MS = 380;
const CHOP_ANIM = 130;

type Mode = 'play' | 'over';
type OverReason = 'hit' | 'timeout' | '';

interface FlyLog {
  branch: number;
  dir: number; // +1 飛ぶ向き
  at: number;
}
interface FloatFx {
  x: number;
  y: number;
  text: string;
  at: number;
  until: number;
}

export function createGame(ctx: GameContext): IGame {
  const cv = ctx.canvas2d({ design: { w: W, h: H } });
  const g = cv.ctx;

  // 初期スタック（rng 固定順で生成＝決定論）
  const logs: number[] = [];
  let genIndex = 0;
  for (let i = 0; i < VISIBLE; i++) logs.push(nextBranch(ctx.random, genIndex++));

  let mode: Mode = 'play';
  let started = false;
  let hostPaused = false;
  let ended = false;
  let overReason: OverReason = '';

  let playerSide = BR_LEFT;
  let energy = START_ENERGY;
  let chops = 0;
  let startNow = 0;
  let phaseUntil = 0;
  let flashUntil = 0;
  let chopAnimUntil = 0;
  let flyLogs: FlyLog[] = [];
  let effects: FloatFx[] = [];
  let lastEvent = '';

  const trunkX = W / 2;

  function over(now: number, reason: OverReason): void {
    if (mode !== 'play') return;
    mode = 'over';
    overReason = reason;
    phaseUntil = now + END_DELAY;
    flashUntil = now + FLASH_MS;
    ctx.sfx('fail');
    ctx.haptic('error');
    lastEvent = 'over:' + reason;
  }

  function chop(side: number, now: number): void {
    playerSide = side;
    chops++;
    energy = Math.min(1, energy + CHOP_GAIN);
    if (energy >= 1) ctx.achieve('full-power');
    chopAnimUntil = now + CHOP_ANIM;
    // いちばん下の丸太が飛んでいく
    flyLogs.push({ branch: logs[0] ?? BR_NONE, dir: side === BR_LEFT ? 1 : -1, at: now });
    logs.shift();
    logs.push(nextBranch(ctx.random, genIndex++));
    // 落ちてきた丸太（新しい最下段）の枝が自分の側なら ぶつかる
    if (branchHits(logs[0] ?? BR_NONE, side)) {
      over(now, 'hit');
      return;
    }
    if (chops === 1) ctx.achieve('first-chop');
    if (chops >= 25) ctx.achieve('chop-25');
    if (chops >= 50) ctx.achieve('chop-50');
    if (chops >= 90) ctx.achieve('chop-90');
    if (chops >= 15 && now - startNow <= 8000) ctx.achieve('quick-15');
    effects.push({ x: trunkX, y: GROUND_Y - LH, text: '+10', at: now, until: now + 600 });
    ctx.sfx('tap');
    ctx.haptic('light');
    lastEvent = `chop:${chops}`;
  }

  // ---- 入力（左右タップ） ----
  const offDown = ctx.input.onDown((p: PointerInfo) => {
    if (hostPaused || !started || mode !== 'play') return;
    const l = cv.toLocal(p);
    chop(l.x < W / 2 ? BR_LEFT : BR_RIGHT, ctx.now());
  });

  // ---- 毎フレーム ----
  const offFrame = ctx.onFrame((dt: number) => {
    if (hostPaused || !started) return;
    const now = ctx.now();
    if (mode === 'play') {
      energy -= depRate(chops) * dt;
      if (energy <= 0) {
        energy = 0;
        over(now, 'timeout');
      }
    } else if (mode === 'over' && !ended && now >= phaseUntil) {
      ended = true;
      ctx.end({ score: scoreOf(chops) });
      return;
    }
    flyLogs = flyLogs.filter((f) => now - f.at < 600);
    effects = effects.filter((e) => e.until > now);
    draw(now);
    setData();
  });

  function setData(): void {
    if (!import.meta.env.DEV) return;
    const r = ctx.root as HTMLElement;
    r.dataset.mode = mode;
    r.dataset.chops = String(chops);
    r.dataset.score = String(scoreOf(chops));
    r.dataset.energy = energy.toFixed(3);
    r.dataset.side = playerSide === BR_LEFT ? 'L' : 'R';
    r.dataset.incoming = String(logs[1] ?? BR_NONE); // 次に落ちてくる丸太の枝
    r.dataset.logs = JSON.stringify(logs);
    r.dataset.over = overReason;
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
    const sky = og.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#bfe6f0');
    sky.addColorStop(0.7, '#d8f0e0');
    sky.addColorStop(1, '#a9d98a');
    og.fillStyle = sky;
    og.fillRect(0, 0, W, H);
    og.fillStyle = '#7fbf5a';
    og.fillRect(0, GROUND_Y + 8, W, H - GROUND_Y);
    // 遠くの木
    og.fillStyle = 'rgba(90,150,80,.5)';
    for (let i = 0; i < 6; i++) {
      const x = i * 70 + 20;
      og.beginPath();
      og.moveTo(x, GROUND_Y + 8);
      og.lineTo(x - 16, GROUND_Y + 8);
      og.lineTo(x, GROUND_Y - 40);
      og.lineTo(x + 16, GROUND_Y + 8);
      og.closePath();
      og.fill();
    }
  }
  bakeStatic();

  function drawLog(cx: number, topY: number, branch: number): void {
    // 丸太
    g.fillStyle = '#a9713f';
    g.strokeStyle = '#7a4e28';
    g.lineWidth = 2;
    roundRect(cx - LW / 2, topY, LW, LH - 3, 8);
    g.fill();
    g.stroke();
    // 木目
    g.strokeStyle = 'rgba(122,78,40,.5)';
    g.lineWidth = 1.5;
    for (const oy of [0.35, 0.6]) {
      g.beginPath();
      g.moveTo(cx - LW / 2 + 6, topY + LH * oy);
      g.lineTo(cx + LW / 2 - 6, topY + LH * oy);
      g.stroke();
    }
    // 枝
    if (branch !== BR_NONE) {
      const sgn = branch === BR_LEFT ? -1 : 1;
      const by = topY + LH / 2;
      g.strokeStyle = '#8a5a2e';
      g.lineWidth = 8;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(cx + sgn * (LW / 2 - 4), by);
      g.lineTo(cx + sgn * (LW / 2 + 34), by - 6);
      g.stroke();
      // 葉
      g.fillStyle = '#4faa54';
      g.beginPath();
      g.arc(cx + sgn * (LW / 2 + 40), by - 8, 12, 0, Math.PI * 2);
      g.fill();
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

  function drawWoodcutter(now: number): void {
    const onLeft = playerSide === BR_LEFT;
    const px = onLeft ? trunkX - LW / 2 - 26 : trunkX + LW / 2 + 26;
    const py = GROUND_Y - 6;
    const swing = now < chopAnimUntil ? (chopAnimUntil - now) / CHOP_ANIM : 0;
    // 体
    g.fillStyle = '#3d6cc0';
    g.beginPath();
    g.arc(px, py - 20, 11, 0, Math.PI * 2); // 頭
    g.fill();
    g.fillStyle = '#c0472f';
    roundRect(px - 9, py - 12, 18, 22, 5);
    g.fill();
    // 腕＋おの（振り下ろし）
    g.save();
    g.translate(px, py - 8);
    g.rotate((onLeft ? 1 : -1) * (-0.5 + swing * 1.2));
    g.strokeStyle = '#6a4326';
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo((onLeft ? 1 : -1) * 20, -2);
    g.stroke();
    g.fillStyle = '#c9ccd8';
    g.beginPath();
    g.moveTo((onLeft ? 1 : -1) * 20, -8);
    g.lineTo((onLeft ? 1 : -1) * 32, -12);
    g.lineTo((onLeft ? 1 : -1) * 30, 2);
    g.closePath();
    g.fill();
    g.restore();
  }

  function draw(now: number): void {
    g.drawImage(off, 0, 0, W, H);

    // スタック
    for (let i = 0; i < logs.length; i++) {
      drawLog(trunkX, GROUND_Y - (i + 1) * LH, logs[i] ?? BR_NONE);
    }
    // 切り株
    g.fillStyle = '#7a4e28';
    roundRect(trunkX - LW / 2 - 2, GROUND_Y, LW + 4, 12, 4);
    g.fill();

    // 飛んでいく丸太
    for (const f of flyLogs) {
      const t = (now - f.at) / 600;
      const x = trunkX + f.dir * (30 + t * 200);
      const y = GROUND_Y - LH + t * t * 260;
      g.save();
      g.globalAlpha = clamp(1 - t, 0, 1);
      g.translate(x, y);
      g.rotate(f.dir * t * 6);
      drawLog(0, -LH / 2, BR_NONE);
      g.restore();
      g.globalAlpha = 1;
    }

    if (mode === 'play' || overReason === 'timeout') drawWoodcutter(now);

    // フラッシュ
    if (now < flashUntil) {
      const a = (flashUntil - now) / FLASH_MS;
      g.fillStyle = `rgba(220,60,50,${a * 0.4})`;
      g.fillRect(0, 0, W, H);
    }

    // 浮かぶ+10
    for (const e of effects) {
      const a = clamp((e.until - now) / 300, 0, 1);
      g.globalAlpha = a;
      g.fillStyle = '#fff';
      g.font = 'bold 18px sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.strokeStyle = 'rgba(60,40,20,.8)';
      g.lineWidth = 3;
      const rise = (1 - a) * 20;
      g.strokeText(e.text, e.x, e.y - rise);
      g.fillText(e.text, e.x, e.y - rise);
      g.globalAlpha = 1;
    }

    // HUD（スコア＋エネルギーゲージ）
    g.fillStyle = 'rgba(40,30,20,.85)';
    g.fillRect(0, 0, W, HUD_H);
    g.fillStyle = '#fff';
    g.font = 'bold 19px sans-serif';
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.fillText(`${scoreOf(chops)}てん`, 12, HUD_H / 2);
    // ゲージ
    const gx = 120;
    const gw = W - gx - 14;
    g.fillStyle = 'rgba(255,255,255,.2)';
    roundRect(gx, HUD_H / 2 - 7, gw, 14, 7);
    g.fill();
    const ecol = energy > 0.5 ? '#7fe05a' : energy > 0.25 ? '#ffd54a' : '#ff5a5a';
    g.fillStyle = ecol;
    roundRect(gx, HUD_H / 2 - 7, Math.max(2, gw * energy), 14, 7);
    g.fill();

    if (mode === 'play' && chops === 0) {
      g.fillStyle = 'rgba(40,30,20,.8)';
      g.font = 'bold 16px sans-serif';
      g.textAlign = 'center';
      g.fillText('左右タップで 丸太を切る！枝をよけてね', W / 2, GROUND_Y + 36);
    }

    if (mode === 'over') {
      g.fillStyle = 'rgba(40,30,20,.82)';
      g.fillRect(0, 0, W, H);
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = '#fff';
      g.font = 'bold 28px sans-serif';
      g.fillText(overReason === 'hit' ? 'えだに ぶつかった！' : 'じかんぎれ！', W / 2, H / 2 - 46);
      g.font = 'bold 26px sans-serif';
      g.fillText(`${scoreOf(chops)}てん`, W / 2, H / 2 + 2);
      g.fillStyle = '#ffd54a';
      g.font = 'bold 16px sans-serif';
      g.fillText(`${chops}本 きった`, W / 2, H / 2 + 36);
    }
  }

  draw(ctx.now());
  setData();

  return {
    start() {
      started = true;
      startNow = ctx.now();
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
