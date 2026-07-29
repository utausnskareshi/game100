// =============================================================
// いろまぜラボ（No.103・かくれゲーム）: 赤・青・黄を混ぜて お手本の色を作る
// =============================================================
// - 色ボタンをタップして しずくを足す →「これで けってい」で答え合わせ。全6問。
// - 混色と出題は logic（rng 注入＝決定論）。ここは描画・入力だけ。
// - 難易度は「ふつう」＋のんびり枠: 時間制限なし・失敗なし（はずれても20点は入る）・
//   「もどす」で何度でもやり直せる。お手本は必ず作れる配合から生成している。
// - import してよいのは game-api（types / helpers）と、このフォルダ内（logic）だけ。
import type { GameContext, IGame, PointerInfo } from '../../game-api/types';
import {
  BASES,
  BASE_LABEL,
  PERFECT_DIST,
  ROUNDS,
  type RGB,
  type Target,
  colorDistance,
  makeTargets,
  mixColor,
  scoreFor,
} from './logic';

const W = 360;
const H = 640;
const HUD_H = 46;
const SWATCH_R = 54;
const SWATCH_Y = 168;
const BTN_W = 92;
const BTN_H = 92;
const BTN_GAP = 14;
const BTN_Y = 320;
const UNDO = { x: 30, y: 448, w: 130, h: 52 };
const DECIDE = { x: 176, y: 448, w: 154, h: 52 };
const RESULT_MS = 1500;
const END_DELAY = 2400;
const SCORE_HI = 900;

const C_BG = '#f7f4ee';
const C_TEXT = '#2f3140';
const C_DIM = '#7b7f95';
const C_HUD = '#39405c';
const C_LINE = '#c9cdda';
const C_OK = '#2e8f4f';

type Mode = 'mix' | 'result' | 'done';

const css = (c: RGB): string => `rgb(${c.r},${c.g},${c.b})`;

export function createGame(ctx: GameContext): IGame {
  const cv = ctx.canvas2d({ design: { w: W, h: H } });
  const g = cv.ctx;

  const targets: Target[] = makeTargets(ctx.random);
  let roundIdx = 0;
  let target: Target = targets[0]!;
  let counts = [0, 0, 0];
  /** この問題で「もどす」を使ったか（run 全体の実績用に記録する） */
  let usedUndo = false;
  let mode: Mode = 'mix';
  let started = false;
  let hostPaused = false;
  let ended = false;
  let score = 0;
  let perfects = 0;
  let cleared = 0;
  let lastDist = 0;
  let lastPts = 0;
  let phaseUntil = 0;
  let lastEvent = '';

  function loadRound(i: number): void {
    roundIdx = i;
    target = targets[i]!;
    counts = [0, 0, 0];
    mode = 'mix';
  }

  const btnRect = (i: number): { x: number; y: number; w: number; h: number } => {
    const total = 3 * BTN_W + 2 * BTN_GAP;
    return { x: (W - total) / 2 + i * (BTN_W + BTN_GAP), y: BTN_Y, w: BTN_W, h: BTN_H };
  };
  const inRect = (p: { x: number; y: number }, r: { x: number; y: number; w: number; h: number }): boolean =>
    p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;

  // ---------- 入力 ----------
  const offTap = ctx.input.onTap((p: PointerInfo) => {
    if (hostPaused || !started || mode !== 'mix') return;
    const l = cv.toLocal(p);
    for (let i = 0; i < 3; i++) {
      if (inRect(l, btnRect(i))) {
        // しずくは1色 9滴まで（増やしても比が変わらなくなるので上限を置く）
        if ((counts[i] ?? 0) < 9) {
          counts[i] = (counts[i] ?? 0) + 1;
          ctx.sfx('tap');
          lastEvent = `add:${i}:${counts[i]}`;
        }
        return;
      }
    }
    if (inRect(l, UNDO)) {
      undo();
      return;
    }
    if (inRect(l, DECIDE)) {
      decide();
      return;
    }
  });

  /** 直前に足した色ではなく「いちばん多い色」を1滴もどす（順番を覚えていなくても直感的に効く） */
  function undo(): void {
    let k = -1;
    let max = 0;
    for (let i = 0; i < 3; i++) {
      const c = counts[i] ?? 0;
      if (c > max) {
        max = c;
        k = i;
      }
    }
    if (k < 0) return;
    counts[k] = (counts[k] ?? 0) - 1;
    usedUndo = true;
    ctx.sfx('tap');
    lastEvent = `undo:${k}`;
  }

  function decide(): void {
    const cur = mixColor(counts);
    if (!cur) {
      ctx.sfx('fail');
      lastEvent = 'empty';
      return;
    }
    lastDist = colorDistance(cur, target.color);
    lastPts = scoreFor(lastDist);
    score += lastPts;
    cleared++;
    if (lastDist <= PERFECT_DIST) {
      perfects++;
      ctx.achieve('perfect');
      if (perfects >= 3) ctx.achieve('perfect-3');
      ctx.sfx('medal');
    } else {
      ctx.sfx('success');
    }
    if (cleared === 1) ctx.achieve('first-mix');
    ctx.haptic('success');
    mode = 'result';
    phaseUntil = ctx.now() + RESULT_MS;
    lastEvent = `decide:${roundIdx}:${Math.round(lastDist)}:${lastPts}`;
  }

  // ---------- 毎フレーム ----------
  const offFrame = ctx.onFrame(() => {
    if (hostPaused || !started) return;
    const now = ctx.now();
    if (mode === 'result' && now >= phaseUntil) {
      if (roundIdx + 1 >= ROUNDS) finish(now);
      else loadRound(roundIdx + 1);
    } else if (mode === 'done' && !ended && now >= phaseUntil) {
      ended = true;
      ctx.end({ score });
      return;
    }
    draw();
    setData();
  });

  function finish(now: number): void {
    ctx.achieve('all-clear');
    if (!usedUndo) ctx.achieve('no-undo');
    if (score >= SCORE_HI) ctx.achieve('score-hi');
    mode = 'done';
    phaseUntil = now + END_DELAY;
    ctx.sfx('medal');
    lastEvent = `finish:${score}:${perfects}`;
  }

  function setData(): void {
    if (!import.meta.env.DEV) return;
    const r = ctx.root as HTMLElement;
    const cur = mixColor(counts);
    r.dataset.mode = mode;
    r.dataset.round = String(roundIdx);
    r.dataset.counts = counts.join(',');
    r.dataset.recipe = target.recipe.join(',');
    r.dataset.dist = cur ? String(Math.round(colorDistance(cur, target.color))) : '';
    r.dataset.score = String(score);
    r.dataset.perfects = String(perfects);
    r.dataset.undo = String(usedUndo);
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

  function drawSwatch(cx: number, cy: number, color: RGB | null, label: string): void {
    g.fillStyle = color ? css(color) : '#ffffff';
    g.beginPath();
    g.arc(cx, cy, SWATCH_R, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = C_LINE;
    g.lineWidth = 3;
    g.stroke();
    if (!color) {
      g.fillStyle = C_DIM;
      g.font = 'bold 13px sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('まだ から', cx, cy);
    }
    g.fillStyle = C_DIM;
    g.font = 'bold 13px sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(label, cx, cy + SWATCH_R + 18);
  }

  function draw(): void {
    cv.clear(C_BG);

    // HUD
    g.fillStyle = C_HUD;
    g.fillRect(0, 0, W, HUD_H);
    g.fillStyle = '#fff';
    g.font = 'bold 18px sans-serif';
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.fillText(`${score}てん`, 12, HUD_H / 2);
    g.fillStyle = '#cfd8ff';
    g.font = 'bold 13px sans-serif';
    g.fillText(`もんだい ${Math.min(roundIdx + 1, ROUNDS)}/${ROUNDS}`, 116, HUD_H / 2 - 8);
    g.fillText(`ぴったり ${perfects}かい`, 116, HUD_H / 2 + 9);

    g.textAlign = 'center';
    g.textBaseline = 'middle';

    if (mode === 'done') {
      g.fillStyle = C_TEXT;
      g.font = 'bold 26px sans-serif';
      g.fillText('ぜんぶ まぜられた！', W / 2, 300);
      g.font = 'bold 34px sans-serif';
      g.fillStyle = C_OK;
      g.fillText(`${score}てん`, W / 2, 356);
      g.fillStyle = C_DIM;
      g.font = 'bold 14px sans-serif';
      g.fillText(`ぴったり ${perfects} / ${ROUNDS} かい`, W / 2, 400);
      return;
    }

    // お手本 と いま の色
    drawSwatch(W / 2 - 72, SWATCH_Y, target.color, 'おてほん');
    drawSwatch(W / 2 + 72, SWATCH_Y, mixColor(counts), 'いま');

    // 色ボタン
    for (let i = 0; i < 3; i++) {
      const r = btnRect(i);
      g.fillStyle = css(BASES[i]!);
      roundRect(r.x, r.y, r.w, r.h, 16);
      g.fill();
      g.strokeStyle = 'rgba(0,0,0,.18)';
      g.lineWidth = 2;
      roundRect(r.x, r.y, r.w, r.h, 16);
      g.stroke();
      g.fillStyle = '#fff';
      g.font = 'bold 15px sans-serif';
      g.fillText(BASE_LABEL[i] ?? '', r.x + r.w / 2, r.y + 26);
      g.font = 'bold 30px sans-serif';
      g.fillText(String(counts[i] ?? 0), r.x + r.w / 2, r.y + 62);
    }
    g.fillStyle = C_DIM;
    g.font = 'bold 12px sans-serif';
    g.fillText('タップで しずくを1てき ずつ 足す', W / 2, BTN_Y + BTN_H + 18);

    // ボタン
    const btn = (r: { x: number; y: number; w: number; h: number }, label: string, primary: boolean): void => {
      g.fillStyle = primary ? '#5b6cf0' : '#e6e8f2';
      roundRect(r.x, r.y, r.w, r.h, 14);
      g.fill();
      g.fillStyle = primary ? '#fff' : C_TEXT;
      g.font = 'bold 16px sans-serif';
      g.fillText(label, r.x + r.w / 2, r.y + r.h / 2);
    };
    btn(UNDO, 'すこし もどす', false);
    btn(DECIDE, 'これで けってい', true);

    // 結果
    if (mode === 'result') {
      g.fillStyle = 'rgba(47,49,64,.92)';
      roundRect(W / 2 - 130, 528, 260, 74, 14);
      g.fill();
      g.fillStyle = '#fff';
      g.font = 'bold 20px sans-serif';
      g.fillText(lastDist <= PERFECT_DIST ? 'ぴったり！' : lastDist <= 20 ? 'かなり近い！' : 'いい かんじ', W / 2, 552);
      g.font = 'bold 15px sans-serif';
      g.fillStyle = '#ffe6b0';
      g.fillText(`+${lastPts}てん`, W / 2, 580);
    } else {
      g.fillStyle = C_DIM;
      g.font = 'bold 12px sans-serif';
      g.fillText('じかん せいげんは なし。ゆっくり くらべてね', W / 2, 560);
    }
  }

  loadRound(0);
  draw();
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
      draw();
    },
    destroy() {
      offTap();
      offFrame();
    },
  };
}
