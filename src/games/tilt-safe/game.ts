// =============================================================
// かたむき きんこ（No.113・かくれゲーム）: かたむきを ダイヤルの値として使う
// =============================================================
// - ねらい: 傾け系の既存7本は すべて「傾き＝動かす力」。ここでは **傾き＝いまの値**。
//   目もりに合わせて「じっと止める」＝止める精度が問われる、まったく別の手ざわり。
// - センサーが無い端末でも遊べるように、ドラッグでも同じ値を作れる（createDragTilt）。
// - import してよいのは game-api（types / helpers）と、このフォルダ内（logic）だけ。
import type { GameContext, IGame, PointerInfo } from '../../game-api/types';
import { clamp, createDragTilt } from '../../game-api/helpers';
import {
  MARKS,
  SAFES,
  SAFE_COUNT,
  SPEEDY_MS,
  angleOf,
  makeCodes,
  markAngle,
  onMark,
  safeScore,
  tolDeg,
} from './logic';

const W = 360;
const H = 640;
const HUD_H = 46;

/** ダイヤルの 中心と 大きさ */
const CX = 180;
const CY = 350;
const R_OUT = 118;
const R_MARK = 96;
const R_HOLD = 62;

const OPEN_MS = 1500;
const END_DELAY = 2400;
const SCORE_HI = 1050;

const CALIB = { x: 20, y: 556, w: 96, h: 44 };

const C_BG = '#1a1710';
const C_DIAL = '#2d2718';
const C_RING = '#8a7233';
const C_TEXT = '#f5efdc';
const C_DIM = '#a89670';
const C_GOLD = '#ffcf5a';
const C_OK = '#5ad08a';

type Mode = 'dial' | 'opened' | 'done';

export function createGame(ctx: GameContext): IGame {
  const cv = ctx.canvas2d({ design: { w: W, h: H } });
  const g = cv.ctx;

  const codes: number[][] = makeCodes(ctx.random);
  let safeIdx = 0;
  let spec = SAFES[0]!;
  let code: number[] = codes[0]!;
  /** いま そろえている けた */
  let step = 0;
  /** 合わせ続けている 時間（ミリ秒） */
  let hold = 0;
  /** このけたで 一度も ぶれていないか */
  let cleanStep = true;
  let mode: Mode = 'dial';
  let started = false;
  let hostPaused = false;
  let ended = false;
  let score = 0;
  let opened = 0;
  let slips = 0;
  let safeStart = 0;
  let phaseUntil = 0;
  let lastEvent = '';
  /** いまの ダイヤル角度（度） */
  let angle = 0;

  // センサー無し端末では ドラッグが そのまま かたむきになる（#4/#105 と同じ作法）
  const tiltIn = createDragTilt(ctx, {
    toLocal: (p) => cv.toLocal(p),
    div: 110,
    enabled: () => started && !hostPaused,
  });

  function loadSafe(i: number, now: number): void {
    safeIdx = i;
    spec = SAFES[i]!;
    code = codes[i]!;
    step = 0;
    hold = 0;
    cleanStep = true;
    safeStart = now;
    mode = 'dial';
    lastEvent = `safe:${i}`;
  }

  // ---------- 入力（すいへい合わせだけ） ----------
  const offTap = ctx.input.onTap((p: PointerInfo) => {
    if (hostPaused || !started) return;
    const l = cv.toLocal(p);
    if (l.x >= CALIB.x && l.x <= CALIB.x + CALIB.w && l.y >= CALIB.y && l.y <= CALIB.y + CALIB.h) {
      ctx.motion?.calibrate();
      tiltIn.reset();
      ctx.sfx('tap');
      lastEvent = 'calibrate';
    }
  });

  // ---------- 毎フレーム ----------
  const offFrame = ctx.onFrame((dt) => {
    if (hostPaused || !started) return;
    const now = ctx.now();
    angle = angleOf(clamp(tiltIn.value().x, -1, 1));

    if (mode === 'dial') {
      const target = code[step]!;
      if (onMark(spec, angle, target)) {
        hold += Math.min(0.1, dt) * 1000;
        if (hold >= spec.holdMs) {
          // 1けた 確定
          if (cleanStep) ctx.achieve('steady-hand');
          step++;
          hold = 0;
          cleanStep = true;
          ctx.sfx('tick');
          ctx.haptic('light');
          lastEvent = `lock:${safeIdx}:${step}`;
          if (step >= code.length) openSafe(now);
        }
      } else if (hold > 0) {
        // ぶれた＝はじめから
        hold = 0;
        cleanStep = false;
        slips++;
        lastEvent = `slip:${safeIdx}:${step}`;
      }
    } else if (mode === 'opened' && now >= phaseUntil) {
      if (safeIdx + 1 >= SAFE_COUNT) finish(now);
      else loadSafe(safeIdx + 1, now);
    } else if (mode === 'done' && !ended && now >= phaseUntil) {
      ended = true;
      ctx.end({ score });
      return;
    }
    draw(now);
    setData();
  });

  function openSafe(now: number): void {
    const used = now - safeStart;
    const pts = safeScore(code.length, used);
    score += pts;
    opened++;
    mode = 'opened';
    phaseUntil = now + OPEN_MS;
    ctx.sfx('medal');
    ctx.haptic('success');
    if (opened === 1) ctx.achieve('first-open');
    if (opened >= 2) ctx.achieve('half');
    if (used <= SPEEDY_MS) ctx.achieve('speedy');
    lastEvent = `open:${safeIdx}:${pts}:${Math.round(used)}`;
  }

  function finish(now: number): void {
    if (opened >= SAFE_COUNT) ctx.achieve('all-open');
    if (score >= SCORE_HI) ctx.achieve('score-hi');
    mode = 'done';
    phaseUntil = now + END_DELAY;
    ctx.sfx('medal');
    lastEvent = `finish:${score}:${opened}`;
  }

  function setData(): void {
    if (!import.meta.env.DEV) return;
    const r = ctx.root as HTMLElement;
    r.dataset.mode = mode;
    r.dataset.safe = String(safeIdx);
    r.dataset.code = code.join('');
    r.dataset.step = String(step);
    r.dataset.angle = angle.toFixed(2);
    r.dataset.hold = hold.toFixed(0);
    r.dataset.need = String(spec.holdMs);
    r.dataset.tol = tolDeg(spec).toFixed(2);
    r.dataset.score = String(score);
    r.dataset.opened = String(opened);
    r.dataset.slips = String(slips);
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

  /** ダイヤルの角度（度・0が上）を キャンバスの角度に */
  const rad = (deg: number): number => ((deg - 90) * Math.PI) / 180;

  function draw(now: number): void {
    cv.clear(C_BG);

    // HUD
    g.fillStyle = '#100e08';
    g.fillRect(0, 0, W, HUD_H);
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.fillStyle = C_TEXT;
    g.font = 'bold 18px sans-serif';
    g.fillText(`${score}てん`, 12, HUD_H / 2);
    g.fillStyle = C_DIM;
    g.font = 'bold 13px sans-serif';
    g.fillText(`きんこ ${Math.min(safeIdx + 1, SAFE_COUNT)}/${SAFE_COUNT}`, 116, HUD_H / 2 - 8);
    g.fillText(`あけた ${opened}・ぶれ ${slips}`, 116, HUD_H / 2 + 9);

    g.textAlign = 'center';

    if (mode === 'done') {
      g.fillStyle = C_TEXT;
      g.font = 'bold 26px sans-serif';
      g.fillText(`きんこ ${opened} / ${SAFE_COUNT} かいじょう`, W / 2, 280);
      g.font = 'bold 34px sans-serif';
      g.fillStyle = C_GOLD;
      g.fillText(`${score}てん`, W / 2, 336);
      g.fillStyle = C_DIM;
      g.font = 'bold 14px sans-serif';
      g.fillText(`ぶれた かいすう ${slips}`, W / 2, 380);
      return;
    }

    // あんしょうばん
    g.fillStyle = C_DIM;
    g.font = 'bold 13px sans-serif';
    g.fillText('この じゅんに 目もりを 合わせて とめる', W / 2, 70);
    const bw = 40;
    const total = code.length * bw + (code.length - 1) * 8;
    for (let i = 0; i < code.length; i++) {
      const x = (W - total) / 2 + i * (bw + 8);
      const doneStep = i < step;
      g.fillStyle = doneStep ? C_OK : i === step ? C_GOLD : 'rgba(168,150,112,.18)';
      roundRect(x, 88, bw, 44, 8);
      g.fill();
      g.fillStyle = doneStep || i === step ? '#1a1710' : C_DIM;
      g.font = 'bold 24px sans-serif';
      g.fillText(String(code[i]), x + bw / 2, 111);
    }

    // ダイヤル
    g.fillStyle = C_DIAL;
    g.beginPath();
    g.arc(CX, CY, R_OUT, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = C_RING;
    g.lineWidth = 4;
    g.beginPath();
    g.arc(CX, CY, R_OUT, 0, Math.PI * 2);
    g.stroke();

    // 目もり
    for (let v = 0; v < MARKS; v++) {
      const a = rad(markAngle(v));
      const isTarget = mode === 'dial' && v === code[step];
      const x1 = CX + Math.cos(a) * (R_MARK - 14);
      const y1 = CY + Math.sin(a) * (R_MARK - 14);
      const x2 = CX + Math.cos(a) * R_MARK;
      const y2 = CY + Math.sin(a) * R_MARK;
      g.strokeStyle = isTarget ? C_GOLD : C_RING;
      g.lineWidth = isTarget ? 5 : 2.5;
      g.beginPath();
      g.moveTo(x1, y1);
      g.lineTo(x2, y2);
      g.stroke();
      g.fillStyle = isTarget ? C_GOLD : C_DIM;
      g.font = isTarget ? 'bold 18px sans-serif' : 'bold 14px sans-serif';
      g.fillText(String(v), CX + Math.cos(a) * (R_MARK - 30), CY + Math.sin(a) * (R_MARK - 30) + 1);
    }

    // 合っている はば（目あて）
    if (mode === 'dial') {
      const t = code[step]!;
      const tol = tolDeg(spec);
      g.strokeStyle = 'rgba(255,207,90,.30)';
      g.lineWidth = 16;
      g.beginPath();
      g.arc(CX, CY, R_MARK - 7, rad(markAngle(t) - tol), rad(markAngle(t) + tol));
      g.stroke();
    }

    // はり
    const a = rad(angle);
    const onIt = mode === 'dial' && onMark(spec, angle, code[step]!);
    g.strokeStyle = onIt ? C_GOLD : C_TEXT;
    g.lineWidth = 5;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(CX, CY);
    g.lineTo(CX + Math.cos(a) * (R_MARK - 4), CY + Math.sin(a) * (R_MARK - 4));
    g.stroke();
    g.fillStyle = onIt ? C_GOLD : C_TEXT;
    g.beginPath();
    g.arc(CX, CY, 10, 0, Math.PI * 2);
    g.fill();

    // とまっている 時間の わ
    if (mode === 'dial') {
      const p = Math.min(1, hold / spec.holdMs);
      g.strokeStyle = 'rgba(255,207,90,.20)';
      g.lineWidth = 8;
      g.beginPath();
      g.arc(CX, CY, R_HOLD, 0, Math.PI * 2);
      g.stroke();
      if (p > 0) {
        g.strokeStyle = C_OK;
        g.lineWidth = 8;
        g.beginPath();
        g.arc(CX, CY, R_HOLD, -Math.PI / 2, -Math.PI / 2 + p * Math.PI * 2);
        g.stroke();
      }
    } else {
      g.fillStyle = C_OK;
      g.font = 'bold 26px sans-serif';
      g.fillText('あいた！', CX, CY - 4);
      g.fillStyle = C_DIM;
      g.font = 'bold 14px sans-serif';
      g.fillText(`+${safeScore(code.length, now - safeStart)}てん`, CX, CY + 26);
    }

    // ようす
    g.font = 'bold 14px sans-serif';
    if (mode === 'dial') {
      g.fillStyle = onIt ? C_OK : C_DIM;
      g.fillText(onIt ? 'そのまま とめて…' : `つぎは ${code[step]} に 合わせよう`, W / 2, 500);
    } else {
      g.fillStyle = C_OK;
      g.fillText('つぎの きんこへ', W / 2, 500);
    }

    // すいへいボタン
    g.fillStyle = 'rgba(138,114,51,.25)';
    roundRect(CALIB.x, CALIB.y, CALIB.w, CALIB.h, 10);
    g.fill();
    g.strokeStyle = C_RING;
    g.lineWidth = 1.6;
    roundRect(CALIB.x, CALIB.y, CALIB.w, CALIB.h, 10);
    g.stroke();
    g.fillStyle = C_TEXT;
    g.font = 'bold 14px sans-serif';
    g.fillText('すいへい', CALIB.x + CALIB.w / 2, CALIB.y + CALIB.h / 2);

    g.fillStyle = C_DIM;
    g.font = 'bold 11px sans-serif';
    g.textAlign = 'right';
    g.fillText('かたむける（または ドラッグ）で ダイヤルを まわす', W - 16, CALIB.y + 14);
    g.fillText('ぶれたら はじめから やり直し', W - 16, CALIB.y + 32);
    g.textAlign = 'center';
  }

  draw(0);
  setData();

  return {
    start() {
      started = true;
      safeStart = ctx.now();
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
      offTap();
      offFrame();
      tiltIn.destroy();
    },
  };
}
