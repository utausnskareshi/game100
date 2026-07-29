// =============================================================
// たいないどけい（No.104・かくれゲーム）: 見えない時間を数えてタップする
// =============================================================
// - 「◯びょう ぴったりで タップ」。数字も目もりも動く物も出さない＝体内時計だけが頼り。
//   （数えている間に動くものを描くと、それを見て測れてしまうので描かない）
// - 最初の1びょうだけ リングが縮んで「1秒の長さ」を教える（ふつうの難易度にするための補助）。
// - 時間は ctx.now＝ポーズ中は止まるので、ポーズしても有利にならない。
// - import してよいのは game-api（types / helpers）と、このフォルダ内（logic）だけ。
import type { GameContext, IGame } from '../../game-api/types';
import { clamp } from '../../game-api/helpers';
import { JUST_SEC, OK_SEC, ROUNDS, diffLabel, makeTargets, scoreFor } from './logic';

const W = 360;
const H = 640;
const HUD_H = 46;
const HINT_MS = 1000; // 最初の1秒だけ出す補助リング
const RESULT_MS = 2000;
const END_DELAY = 2400;
const SCORE_HI = 700;

const C_BG = '#101a2e';
const C_TEXT = '#eef3ff';
const C_DIM = '#8fa0c4';
const C_HUD = '#0a1120';
const C_RING = '#4ad0e0';
const C_OK = '#5ce08a';
const C_NG = '#ff9a7a';

type Mode = 'ready' | 'count' | 'result' | 'done';

export function createGame(ctx: GameContext): IGame {
  const cv = ctx.canvas2d({ design: { w: W, h: H } });
  const g = cv.ctx;

  const targets = makeTargets(ctx.random);
  let roundIdx = 0;
  let target = targets[0]!;
  let mode: Mode = 'ready';
  let started = false;
  let hostPaused = false;
  let ended = false;
  let score = 0;
  let justCount = 0;
  let okAll = true;
  let countStart = 0;
  let lastDiff = 0;
  let lastPts = 0;
  let phaseUntil = 0;
  let lastEvent = '';

  function loadRound(i: number): void {
    roundIdx = i;
    target = targets[i]!;
    mode = 'ready';
  }

  // ---------- 入力（画面のどこをタップしてもよい＝いちばん単純な操作） ----------
  const offTap = ctx.input.onTap(() => {
    if (hostPaused || !started) return;
    const now = ctx.now();
    if (mode === 'ready') {
      countStart = now;
      mode = 'count';
      ctx.sfx('tick');
      lastEvent = `start:${roundIdx}:${target}`;
      return;
    }
    if (mode === 'count') {
      const elapsed = (now - countStart) / 1000;
      lastDiff = elapsed - target;
      lastPts = scoreFor(lastDiff);
      score += lastPts;
      if (Math.abs(lastDiff) <= JUST_SEC) {
        justCount++;
        ctx.achieve('just');
        if (justCount >= 3) ctx.achieve('just-3');
        ctx.sfx('medal');
      } else {
        ctx.sfx(Math.abs(lastDiff) <= OK_SEC ? 'success' : 'fail');
      }
      if (Math.abs(lastDiff) > OK_SEC) okAll = false;
      if (roundIdx === 0) ctx.achieve('first-stop');
      ctx.haptic('light');
      mode = 'result';
      phaseUntil = now + RESULT_MS;
      lastEvent = `stop:${roundIdx}:${lastDiff.toFixed(2)}:${lastPts}`;
    }
  });

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
    draw(now);
    setData();
  });

  function finish(now: number): void {
    ctx.achieve('all-rounds');
    if (okAll) ctx.achieve('steady');
    if (score >= SCORE_HI) ctx.achieve('score-hi');
    mode = 'done';
    phaseUntil = now + END_DELAY;
    ctx.sfx('medal');
    lastEvent = `finish:${score}:${justCount}`;
  }

  function setData(): void {
    if (!import.meta.env.DEV) return;
    const r = ctx.root as HTMLElement;
    r.dataset.mode = mode;
    r.dataset.round = String(roundIdx);
    r.dataset.target = String(target);
    r.dataset.score = String(score);
    r.dataset.just = String(justCount);
    r.dataset.diff = lastDiff.toFixed(2);
    r.dataset.pts = String(lastPts);
    r.dataset.last = lastEvent;
  }

  // ---------- 描画 ----------
  function draw(now: number): void {
    cv.clear(C_BG);

    g.fillStyle = C_HUD;
    g.fillRect(0, 0, W, HUD_H);
    g.fillStyle = '#fff';
    g.font = 'bold 18px sans-serif';
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.fillText(`${score}てん`, 12, HUD_H / 2);
    g.fillStyle = '#a9d8ff';
    g.font = 'bold 13px sans-serif';
    g.fillText(`ラウンド ${Math.min(roundIdx + 1, ROUNDS)}/${ROUNDS}`, 116, HUD_H / 2 - 8);
    g.fillText(`ぴったり ${justCount}かい`, 116, HUD_H / 2 + 9);

    g.textAlign = 'center';
    g.textBaseline = 'middle';

    if (mode === 'done') {
      g.fillStyle = C_TEXT;
      g.font = 'bold 26px sans-serif';
      g.fillText('ぜんぶ 数えた！', W / 2, 290);
      g.font = 'bold 34px sans-serif';
      g.fillStyle = C_RING;
      g.fillText(`${score}てん`, W / 2, 346);
      g.fillStyle = C_DIM;
      g.font = 'bold 14px sans-serif';
      g.fillText(`ぴったり ${justCount} / ${ROUNDS} かい`, W / 2, 390);
      return;
    }

    // お題
    g.fillStyle = C_DIM;
    g.font = 'bold 15px sans-serif';
    g.fillText('つぎの じかんを 数えて タップ', W / 2, 120);
    g.fillStyle = C_TEXT;
    g.font = 'bold 64px sans-serif';
    g.fillText(`${target}びょう`, W / 2, 186);

    // まん中の円（数えている間は「動くもの」を出さない＝見て測れないようにする）
    const cx = W / 2;
    const cy = 340;
    g.fillStyle = mode === 'count' ? 'rgba(74,208,224,.14)' : 'rgba(255,255,255,.06)';
    g.beginPath();
    g.arc(cx, cy, 96, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = mode === 'count' ? C_RING : 'rgba(255,255,255,.25)';
    g.lineWidth = 4;
    g.stroke();

    if (mode === 'ready') {
      g.fillStyle = C_TEXT;
      g.font = 'bold 22px sans-serif';
      g.fillText('タップで', cx, cy - 14);
      g.fillText('スタート', cx, cy + 18);
    } else if (mode === 'count') {
      // 最初の1びょうだけ、リングが縮んで「1秒の長さ」を教える
      const el = now - countStart;
      if (el < HINT_MS) {
        const t = clamp(el / HINT_MS, 0, 1);
        g.strokeStyle = C_RING;
        g.lineWidth = 6;
        g.beginPath();
        g.arc(cx, cy, 96 * (1 - t) + 20 * t, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (1 - t));
        g.stroke();
        g.fillStyle = C_DIM;
        g.font = 'bold 13px sans-serif';
        g.fillText('これが 1びょう', cx, cy + 130);
      } else {
        g.fillStyle = C_DIM;
        g.font = 'bold 13px sans-serif';
        g.fillText('心の中で 数えよう…', cx, cy + 130);
      }
      g.fillStyle = C_TEXT;
      g.font = 'bold 24px sans-serif';
      g.fillText('タップで', cx, cy - 14);
      g.fillText('ストップ', cx, cy + 18);
    } else {
      const just = Math.abs(lastDiff) <= JUST_SEC;
      g.fillStyle = just ? C_OK : Math.abs(lastDiff) <= OK_SEC ? C_TEXT : C_NG;
      g.font = 'bold 26px sans-serif';
      g.fillText(diffLabel(lastDiff), cx, cy - 16);
      g.fillStyle = C_DIM;
      g.font = 'bold 16px sans-serif';
      g.fillText(`じっさい ${(target + lastDiff).toFixed(2)}びょう`, cx, cy + 18);
      g.fillStyle = C_RING;
      g.font = 'bold 20px sans-serif';
      g.fillText(`+${lastPts}てん`, cx, cy + 52);
    }

    // ラウンドの進み具合
    for (let i = 0; i < ROUNDS; i++) {
      g.fillStyle = i < roundIdx ? C_OK : i === roundIdx ? C_RING : 'rgba(255,255,255,.2)';
      g.beginPath();
      g.arc(W / 2 - (ROUNDS - 1) * 11 + i * 22, 512, 6, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = C_DIM;
    g.font = 'bold 12px sans-serif';
    g.fillText('画面の どこを タップしても OK', W / 2, 560);
  }

  draw(0);
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
      draw(ctx.now());
    },
    destroy() {
      offTap();
      offFrame();
    },
  };
}
