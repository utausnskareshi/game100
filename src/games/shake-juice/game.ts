// =============================================================
// シェイクジュース（No.46）: ちょうどいい強さでふって、おいしいジュースをつくろう！
// =============================================================
// - シェイク強度（ctx.motion.shakeLevel）を「ちょうどいい帯」にキープするとミックスが進む。
//   強すぎると あわだって、満タンで こぼれる（ミックスが減る）。3杯つくったらゴール。
// - センサーなしでもOK: タップ連打の速さ＝強度（連打をゆるめて微調整）。
// - レシピ・ミックス計算は logic.ts（乱数不使用＝毎回同じ3杯）。
// - Canvas 360×640。シェルの3-2-1のあとレシピ表示→ミックス開始。
// - import してよいのは game-api（types / helpers）と、このフォルダ内（logic）だけ
import type { GameContext, IGame } from '../../game-api/types';
import { clamp } from '../../game-api/helpers';
import { RECIPES, TAP_DECAY, TAP_IMPULSE, juiceScore, stepMix, type MixState } from './logic';

const W = 360;
const H = 640;
const RECIPE_MS = 1600; // レシピ紹介の間
const DONE_MS = 1500; // 1杯完成の余韻
const END_DELAY = 1900;
const QUICK_SEC = 12; // 「はやづくり」実績

type Mode = 'ready' | 'recipe' | 'mix' | 'done' | 'over';

export function createGame(ctx: GameContext): IGame {
  const cv = ctx.canvas2d({ design: { w: W, h: H } });
  const g = cv.ctx;

  // ---- 状態 ----
  let mode: Mode = 'ready';
  let hostPaused = false;
  let juiceIdx = 0;
  const st: MixState = { mix: 0, foam: 0, spills: 0 };
  let tapLevel = 0;
  let usedTap = false;
  let level = 0;
  let juiceStart = 0;
  let score = 0;
  let spillsTotal = 0;
  let spillFlashUntil = 0;
  let phaseAt = 0; // recipe/done の期限
  let endAt = 0;
  let ended = false;

  function setData(): void {
    const r = ctx.root as HTMLElement;
    r.dataset.mode = mode;
    r.dataset.juice = String(juiceIdx);
    r.dataset.score = String(score);
    if (!import.meta.env.DEV) return;
    r.dataset.mix = st.mix.toFixed(2);
    r.dataset.foam = st.foam.toFixed(2);
    r.dataset.spills = String(st.spills);
    r.dataset.level = level.toFixed(3);
  }

  // ---- 入力（タップ代替。センサーがあれば max() で合成）----
  const offDown = ctx.input.onDown(() => {
    if (mode !== 'mix' || hostPaused) return;
    tapLevel = clamp(tapLevel + TAP_IMPULSE, 0, 1);
    usedTap = true;
  });

  // ---- 進行 ----
  function startJuice(): void {
    st.mix = 0;
    st.foam = 0;
    st.spills = 0;
    tapLevel = 0;
    mode = 'recipe';
    phaseAt = ctx.now() + RECIPE_MS;
    ctx.sfx('tick');
    setData();
  }

  function beginMix(now: number): void {
    mode = 'mix';
    juiceStart = now;
    ctx.sfx('start');
    setData();
  }

  function finishJuice(now: number): void {
    const sec = Math.floor((now - juiceStart) / 1000);
    const s = juiceScore(sec, st.spills);
    score += s;
    spillsTotal += st.spills;
    mode = 'done';
    phaseAt = now + DONE_MS;
    const recipe = RECIPES[juiceIdx]!;
    // 実績（完成時に即解除）
    ctx.achieve('first-juice');
    if (sec <= QUICK_SEC) ctx.achieve('quick-12');
    if (recipe.label.startsWith('そーっと') && st.spills === 0) ctx.achieve('gentle-pro');
    ctx.sfx('medal');
    ctx.haptic('success');
    if (juiceIdx >= RECIPES.length - 1) {
      ctx.achieve('all-juice');
      if (spillsTotal === 0) ctx.achieve('no-spill');
      if (!usedTap && ctx.motion) ctx.achieve('shake-only');
      mode = 'over';
      endAt = now + END_DELAY;
    }
    setData();
  }

  // ---- 毎フレーム ----
  const offFrame = ctx.onFrame((dt) => {
    const now = ctx.now();
    if (!hostPaused) {
      // タップ強度の減衰と、センサーとの合成
      tapLevel *= Math.exp(-TAP_DECAY * dt);
      if (tapLevel < 0.005) tapLevel = 0;
      level = clamp(Math.max(ctx.motion?.shakeLevel ?? 0, tapLevel), 0, 1);

      if (mode === 'recipe' && now >= phaseAt) beginMix(now);
      if (mode === 'mix') {
        const recipe = RECIPES[juiceIdx]!;
        const ev = stepMix(st, level, recipe, dt);
        if (ev === 'spill') {
          spillFlashUntil = now + 700;
          ctx.sfx('fail');
          ctx.haptic('error');
        }
        if (st.mix >= 100) finishJuice(now);
      }
      if (mode === 'done' && now >= phaseAt) {
        juiceIdx++;
        startJuice();
      }
      if (mode === 'over' && !ended && now >= endAt) {
        ended = true;
        ctx.end({ score });
        return;
      }
    }
    draw(now);
    setData();
  });

  // ---- 描画（ジューススタンドの固定パレット＝両テーマ共通）----
  function rr(x: number, y: number, w: number, h: number, r: number): void {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  function draw(now: number): void {
    const recipe = RECIPES[Math.min(juiceIdx, RECIPES.length - 1)]!;
    // 背景（ジュースやさん）
    g.fillStyle = '#fdf1dc';
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#f6ddb7';
    g.fillRect(0, 520, W, H - 520);

    // レシピカード
    g.fillStyle = '#ffffff';
    rr(40, 92, 280, 64, 14);
    g.fill();
    g.strokeStyle = '#e0c9a4';
    g.lineWidth = 2;
    rr(40, 92, 280, 64, 14);
    g.stroke();
    g.fillStyle = '#5a4636';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = 'bold 19px sans-serif';
    g.fillText(`${recipe.emoji} ${recipe.name}`, W / 2, 116);
    g.font = 'bold 14px sans-serif';
    g.fillStyle = '#a0703c';
    g.fillText(`✨ ${recipe.label} ✨`, W / 2, 140);

    // グラス（ミックス＝液面・あわ＝上の白層）
    const gx = 96;
    const gy = 210;
    const gw = 118;
    const gh = 250;
    const lvH = (st.mix / 100) * (gh - 16);
    g.fillStyle = recipe.color;
    g.fillRect(gx + 8, gy + gh - 8 - lvH, gw - 16, lvH);
    const foamH = (st.foam / 100) * 74;
    if (foamH > 1) {
      g.fillStyle = '#fff7ea';
      g.fillRect(gx + 8, gy + gh - 8 - lvH - foamH, gw - 16, foamH);
    }
    g.strokeStyle = '#8a93c8';
    g.lineWidth = 5;
    g.beginPath();
    g.moveTo(gx, gy);
    g.lineTo(gx + 12, gy + gh);
    g.lineTo(gx + gw - 12, gy + gh);
    g.lineTo(gx + gw, gy);
    g.stroke();
    // ストロー
    g.strokeStyle = '#f0524a';
    g.lineWidth = 8;
    g.beginPath();
    g.moveTo(gx + gw - 30, gy + 26);
    g.lineTo(gx + gw + 2, gy - 26);
    g.stroke();
    // ミックス%
    g.fillStyle = '#5a4636';
    g.font = 'bold 18px sans-serif';
    g.fillText(`${Math.floor(st.mix)}%`, gx + gw / 2, gy + gh + 26);

    // シェイクメーター（右・帯をハイライト）
    const mx = 268;
    const my = 210;
    const mh = 250;
    g.fillStyle = '#efe2c8';
    rr(mx, my, 34, mh, 10);
    g.fill();
    const bandTop = my + (1 - recipe.hi) * mh;
    const bandH = (recipe.hi - recipe.lo) * mh;
    g.fillStyle = 'rgba(62,211,106,.45)';
    g.fillRect(mx, bandTop, 34, bandH);
    // いまの強度
    const ly = my + (1 - level) * mh;
    g.fillStyle = level > recipe.hi ? '#f0524a' : level >= recipe.lo ? '#2fae5e' : '#8a93c8';
    rr(mx - 5, ly - 5, 44, 10, 5);
    g.fill();
    g.fillStyle = '#5a4636';
    g.font = 'bold 12px sans-serif';
    g.fillText('つよさ', mx + 17, my + mh + 20);

    // HUD（左上）
    g.textAlign = 'left';
    g.fillStyle = '#5a4636';
    g.font = 'bold 18px sans-serif';
    g.fillText(`${score}てん`, 14, 34);
    g.font = 'bold 13px sans-serif';
    g.fillText(`ジュース ${Math.min(juiceIdx + 1, 3)}/3`, 14, 58);
    if (mode === 'mix') {
      const sec = Math.floor((now - juiceStart) / 1000);
      g.fillText(`⏱ ${sec}`, 120, 58);
    }

    // メッセージ
    g.textAlign = 'center';
    if (mode === 'recipe') {
      g.fillStyle = '#a0703c';
      g.font = 'bold 20px sans-serif';
      g.fillText('レシピを チェック…', W / 2, 560);
    } else if (mode === 'mix') {
      g.fillStyle = '#5a4636';
      g.font = 'bold 15px sans-serif';
      g.fillText('スマホをふる（またはタップ連打）で ミックス！', W / 2, 560);
      if (level > recipe.hi) {
        g.fillStyle = '#e0524a';
        g.font = 'bold 18px sans-serif';
        g.fillText('⚠ つよすぎ！ あわが…！', W / 2, 588);
      }
    } else if (mode === 'done') {
      g.fillStyle = '#2fae5e';
      g.font = 'bold 22px sans-serif';
      g.fillText('かんせい！ 🥤', W / 2, 560);
    }
    if (now < spillFlashUntil) {
      g.fillStyle = '#e0524a';
      g.font = 'bold 26px sans-serif';
      g.fillText('💦 こぼれた〜！', W / 2, 300);
    }

    if (mode === 'over') {
      g.fillStyle = 'rgba(70,50,30,.62)';
      g.fillRect(0, 0, W, H);
      g.fillStyle = '#fff';
      g.font = 'bold 32px sans-serif';
      g.fillText('3ばい かんせい！ 🎉', W / 2, H / 2 - 40);
      g.font = 'bold 24px sans-serif';
      g.fillText(`${score}てん`, W / 2, H / 2 + 8);
    }
  }

  // ---- 起動（シェルの 3-2-1 のあと start()）----
  draw(0);
  setData();

  return {
    start() {
      startJuice();
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
