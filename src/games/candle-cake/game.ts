// =============================================================
// くるくるキャンドル（No.92）: 回るケーキにタップでロウソクをさす timing ゲーム
// =============================================================
// - タップで、いま画面下（さし込み位置）に来ているケーキの場所にロウソクを1本さす。
//   さした所が すでにあるロウソクに近すぎると「ぶつかった！」＝ライフ−1（3つでおしまい）。
// - ステージの本数をさしきると クリア→ケーキがふえて 回転が速く・本数が増える。
// - 回転は ctx.now からの閉形式（θ=ω·経過秒）＝フレーム非依存・ポーズで自動停止。
// - import してよいのは game-api（types / helpers）と、このフォルダ内（logic）だけ。
import type { GameContext, IGame, PointerInfo } from '../../game-api/types';
import { clamp } from '../../game-api/helpers';
import {
  A_INS,
  CANDLE_PTS,
  CX,
  CY,
  GAP,
  H,
  PERFECT_BONUS,
  R,
  SCORE_HI,
  W,
  insertPhi,
  marginTo,
  stageBonus,
  stageConfig,
  thetaAt,
} from './logic';

const HUD_H = 40;
const TAP_COOLDOWN = 170; // 連打で同じ場所に2本置くのを防ぐ
const FLASH_MS = 340;
const CELEBRATE_MS = 950;
const END_DELAY = 1800;

type Mode = 'play' | 'over';

interface FloatFx {
  x: number;
  y: number;
  text: string;
  color: string;
  at: number;
  until: number;
}

const CANDLE_COLORS = ['#ff6b8a', '#ffd54a', '#7ec8f0', '#8ae05a', '#c99af5', '#ffb14a', '#ff9ad5'];

export function createGame(ctx: GameContext): IGame {
  const cv = ctx.canvas2d({ design: { w: W, h: H } });
  const g = cv.ctx;

  let mode: Mode = 'play';
  let started = false;
  let hostPaused = false;
  let ended = false;

  let stage = 1;
  let placed = 0; // このステージで置いた数
  let target = 4;
  let omega = 1.2;
  let stageStartNow = 0;
  let candles: number[] = []; // 局所角 φ（ケーキと一緒に回る）
  let candleCols: number[] = []; // candles と同じ長さの色 index

  let lives = 3;
  let score = 0;
  let total = 0; // 置いたロウソク総数
  let perfectStage = true;

  let celebrating = false;
  let phaseUntil = 0;
  let flashUntil = 0;
  let tapCooldownUntil = 0;
  let effects: FloatFx[] = [];
  let lastEvent = '';

  const theta = (now: number): number => thetaAt(omega, now, stageStartNow);

  function beginStage(n: number, now: number): void {
    const cfg = stageConfig(n, ctx.random);
    stage = n;
    target = cfg.target;
    omega = cfg.omega;
    stageStartNow = now;
    candles = [cfg.initPhase];
    candleCols = [0];
    placed = 0;
    perfectStage = true;
    celebrating = false;
    if (n >= 5) ctx.achieve('stage-5');
    ctx.sfx('start');
  }

  function toOver(now: number): void {
    if (mode !== 'play') return;
    mode = 'over';
    phaseUntil = now + END_DELAY;
    ctx.sfx('fail');
    ctx.haptic('error');
    lastEvent = 'over';
  }

  function stageClear(now: number): void {
    celebrating = true;
    phaseUntil = now + CELEBRATE_MS;
    let bonus = stageBonus(stage);
    if (perfectStage) {
      bonus += PERFECT_BONUS;
      ctx.achieve('perfect-stage');
    }
    score += bonus;
    ctx.achieve('clear-stage');
    if (score >= SCORE_HI) ctx.achieve('score-hi');
    effects.push({ x: CX, y: CY, text: 'できた！', color: '#fff', at: now, until: now + CELEBRATE_MS });
    effects.push({ x: CX, y: CY + 30, text: `+${bonus}`, color: '#ffd54a', at: now + 120, until: now + CELEBRATE_MS });
    ctx.sfx('medal');
    ctx.haptic('success');
    lastEvent = `clear:${stage}:${bonus}`;
  }

  function place(now: number): void {
    if (now < tapCooldownUntil) return;
    tapCooldownUntil = now + TAP_COOLDOWN;
    const phi = insertPhi(theta(now));
    const m = marginTo(phi, candles);
    if (m < GAP) {
      // ぶつかった
      lives--;
      perfectStage = false;
      flashUntil = now + FLASH_MS;
      effects.push({ x: CX, y: CY - R - 6, text: 'ぶつかった！', color: '#ff6b6b', at: now, until: now + 800 });
      ctx.sfx('fail');
      ctx.haptic('error');
      lastEvent = 'hit';
      if (lives <= 0) toOver(now);
      return;
    }
    candles.push(phi);
    candleCols.push((total + 1) % CANDLE_COLORS.length);
    placed++;
    total++;
    score += CANDLE_PTS;
    if (total === 1) ctx.achieve('first-candle');
    if (total >= 30) ctx.achieve('candles-30');
    if (score >= SCORE_HI) ctx.achieve('score-hi');
    // ちょうど良い間隔だと ちょっと気持ちいい音
    ctx.sfx(m > GAP * 2.4 ? 'success' : 'tap');
    ctx.haptic('light');
    lastEvent = `place:${placed}/${target}`;
    if (placed >= target) stageClear(now);
  }

  // ---- 入力（タップでさす） ----
  const offDown = ctx.input.onDown((_p: PointerInfo) => {
    if (hostPaused || !started || mode !== 'play' || celebrating) return;
    place(ctx.now());
  });

  // ---- 毎フレーム ----
  const offFrame = ctx.onFrame(() => {
    if (hostPaused || !started) return;
    const now = ctx.now();
    if (mode === 'play') {
      if (celebrating && now >= phaseUntil) beginStage(stage + 1, now);
    } else if (mode === 'over' && !ended && now >= phaseUntil) {
      ended = true;
      ctx.end({ score });
      return;
    }
    effects = effects.filter((e) => e.until > now);
    draw(now);
    setData(now);
  });

  function setData(now: number): void {
    if (!import.meta.env.DEV) return;
    const r = ctx.root as HTMLElement;
    const phi = insertPhi(theta(now));
    r.dataset.mode = mode;
    r.dataset.stage = String(stage);
    r.dataset.placed = String(placed);
    r.dataset.target = String(target);
    r.dataset.lives = String(lives);
    r.dataset.score = String(score);
    r.dataset.total = String(total);
    r.dataset.celebrating = celebrating ? '1' : '0';
    r.dataset.margin = marginTo(phi, candles).toFixed(4); // 今さしたら空くまでの角度差
    r.dataset.gap = GAP.toFixed(4);
    r.dataset.cool = now < tapCooldownUntil ? '1' : '0';
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
    bg.addColorStop(0, '#3a2a4a');
    bg.addColorStop(0.5, '#4a3560');
    bg.addColorStop(1, '#2a1e3a');
    og.fillStyle = bg;
    og.fillRect(0, 0, W, H);
    // 星のかざり
    og.fillStyle = 'rgba(255,255,255,.12)';
    for (let i = 0; i < 26; i++) {
      const x = (i * 71 + 20) % W;
      const y = (i * 53 + 30) % (H - 120);
      og.fillRect(x, y, 2, 2);
    }
  }
  bakeStatic();

  function drawCandle(rad: number, colIdx: number, lit: boolean, now: number): void {
    // rad = ケーキ中心からの角度（描画時は既に θ 回転済みの座標系）
    const bx = Math.cos(rad) * R;
    const by = Math.sin(rad) * R;
    const ox = Math.cos(rad);
    const oy = Math.sin(rad);
    const len = 26;
    g.strokeStyle = CANDLE_COLORS[colIdx % CANDLE_COLORS.length]!;
    g.lineWidth = 7;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(bx, by);
    g.lineTo(bx + ox * len, by + oy * len);
    g.stroke();
    // しんの先＝ほのお
    const tx = bx + ox * (len + 5);
    const ty = by + oy * (len + 5);
    if (lit) {
      const fl = 3.4 + Math.sin(now / 90 + rad * 3) * 1.1;
      g.fillStyle = '#ffd54a';
      g.beginPath();
      g.arc(tx, ty, fl, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = 'rgba(255,120,40,.7)';
      g.beginPath();
      g.arc(tx, ty, fl * 0.55, 0, Math.PI * 2);
      g.fill();
    } else {
      g.fillStyle = '#3a2a2a';
      g.beginPath();
      g.arc(tx, ty, 1.6, 0, Math.PI * 2);
      g.fill();
    }
  }

  function draw(now: number): void {
    g.drawImage(off, 0, 0, W, H);
    const th = theta(now);

    // 皿
    g.fillStyle = 'rgba(255,255,255,.14)';
    g.beginPath();
    g.ellipse(CX, CY + 6, R + 26, R + 18, 0, 0, Math.PI * 2);
    g.fill();

    // ケーキ本体（回転）
    g.save();
    g.translate(CX, CY);
    g.rotate(th);
    // 側面クリーム
    g.fillStyle = '#f6d9c0';
    g.beginPath();
    g.arc(0, 0, R, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#ffb3c6';
    g.beginPath();
    g.arc(0, 0, R - 10, 0, Math.PI * 2);
    g.fill();
    // いちご風のかざり（回転の目印）
    g.fillStyle = '#e0483c';
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      g.beginPath();
      g.arc(Math.cos(a) * (R - 34), Math.sin(a) * (R - 34), 7, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = '#ff8fa8';
    g.beginPath();
    g.arc(0, 0, 24, 0, Math.PI * 2);
    g.fill();
    // ロウソク（クリア時は全部ともす）
    for (let i = 0; i < candles.length; i++) {
      drawCandle(candles[i]!, candleCols[i]!, celebrating || i === 0, now);
    }
    g.restore();

    // さし込みガイド（画面下・固定）: これから置くロウソクのゴースト＋着地点
    if (mode === 'play' && !celebrating) {
      const gx = CX + Math.cos(A_INS) * R;
      const gy = CY + Math.sin(A_INS) * R;
      // ふちの着地点マーカー
      g.fillStyle = 'rgba(255,255,255,.85)';
      g.beginPath();
      g.arc(gx, gy, 4, 0, Math.PI * 2);
      g.fill();
      // ゴーストのロウソク（下向きに立つ）
      g.strokeStyle = 'rgba(255,255,255,.5)';
      g.lineWidth = 7;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(gx, gy + 6);
      g.lineTo(gx, gy + 34);
      g.stroke();
      g.fillStyle = 'rgba(255,255,255,.85)';
      g.font = 'bold 13px sans-serif';
      g.textAlign = 'center';
      g.fillText('タップでさす', CX, CY + R + 58);
    }

    // 衝突フラッシュ
    if (now < flashUntil) {
      const a = (flashUntil - now) / FLASH_MS;
      g.fillStyle = `rgba(220,60,50,${a * 0.4})`;
      g.fillRect(0, 0, W, H);
    }

    // 浮かぶテキスト
    for (const e of effects) {
      if (now < e.at) continue;
      const a = clamp((e.until - now) / 400, 0, 1);
      g.globalAlpha = a;
      g.fillStyle = e.color;
      g.font = 'bold 22px sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.strokeStyle = 'rgba(40,25,50,.85)';
      g.lineWidth = 3.5;
      g.strokeText(e.text, e.x, e.y);
      g.fillText(e.text, e.x, e.y);
      g.globalAlpha = 1;
    }

    // HUD
    g.fillStyle = 'rgba(40,25,50,.86)';
    g.fillRect(0, 0, W, HUD_H);
    g.fillStyle = '#fff';
    g.font = 'bold 19px sans-serif';
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.fillText(`${score}てん`, 12, HUD_H / 2);
    g.fillStyle = '#ffd7e6';
    g.font = 'bold 14px sans-serif';
    g.fillText(`ステージ${stage}  ${placed}/${target}本`, 104, HUD_H / 2);
    for (let i = 0; i < 3; i++) {
      const x = W - 20 - i * 22;
      g.fillStyle = i < lives ? '#ff5a76' : 'rgba(255,255,255,.22)';
      g.beginPath();
      g.arc(x, HUD_H / 2, 6, 0, Math.PI * 2);
      g.fill();
    }

    // おしまい
    if (mode === 'over') {
      g.fillStyle = 'rgba(40,25,50,.82)';
      g.fillRect(0, 0, W, H);
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = '#fff';
      g.font = 'bold 30px sans-serif';
      g.fillText('おしまい！', W / 2, H / 2 - 46);
      g.font = 'bold 26px sans-serif';
      g.fillText(`${score}てん`, W / 2, H / 2);
      g.fillStyle = '#ffd54a';
      g.font = 'bold 16px sans-serif';
      g.fillText(`ステージ${stage}・ロウソク${total}本`, W / 2, H / 2 + 34);
    }
  }

  draw(ctx.now());
  setData(ctx.now());

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
      offFrame();
    },
  };
}
