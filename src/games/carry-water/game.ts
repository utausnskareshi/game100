// =============================================================
// こぼさないで（No.105・かくれゲーム）: 水をこぼさずコップを運ぶ
// =============================================================
// - かたむける（センサー）か 画面ドラッグで コップが動く。動かすには かたむけるしかないが、
//   かたむけると水面がゆれて こぼれる＝「なめらかに運ぶ」ゲーム。
// - 物理は logic.step（固定サブステップ1/120秒＝実時間に依存しない決定論）。
// - センサーが無い／許可しない端末でも、ドラッグだけで まったく同じように遊べる
//   （共通ヘルパー createDragTilt。傾け系ゲームの実証済みパターン）。
// - import してよいのは game-api（types / helpers）と、このフォルダ内（logic）だけ。
import type { GameContext, IGame } from '../../game-api/types';
import { clamp, createDragTilt } from '../../game-api/helpers';
import {
  GOAL_X1,
  GOAL_X2,
  HOLD_SEC,
  SPILL_LIMIT,
  STAGES,
  SUB_DT,
  type CupState,
  initialState,
  isCleared,
  isFailed,
  stageScore,
  step,
} from './logic';

const W = 360;
const H = 640;
const HUD_H = 46;
const FLOOR_Y = 400;
const CUP_W = 54;
const CUP_H = 62;
const LEVEL_BAR = { x: 24, y: 92, w: W - 48, h: 16 };
const CALIB = { x: 20, y: 556, w: 120, h: 48 };
const CLEAR_MS = 1400;
const FAIL_MS = 1500;
const END_DELAY = 2400;
const SCORE_HI = 1100;

const C_BG = '#eaf4fb';
const C_TEXT = '#22384a';
const C_DIM = '#6b829a';
const C_HUD = '#1d3a4f';
const C_WATER = '#3aa6e0';
const C_WATER_DK = '#2b83b5';
const C_CUP = 'rgba(255,255,255,.86)';
const C_CUP_LINE = '#7fa6bd';
const C_OK = '#2e8f4f';
const C_NG = '#e0483c';

type Mode = 'carry' | 'cleared' | 'failed' | 'done';

export function createGame(ctx: GameContext): IGame {
  const cv = ctx.canvas2d({ design: { w: W, h: H } });
  const g = cv.ctx;

  let stageIdx = 0;
  let st: CupState = initialState();
  let mode: Mode = 'carry';
  let started = false;
  let hostPaused = false;
  let ended = false;
  let score = 0;
  let cleared = 0;
  let retries = 0;
  let fullClears = 0;
  let acc = 0; // サブステップの端数
  let phaseUntil = 0;
  let spillFlash = -9999; // 開始直後に「こぼれた！」が出ないよう、十分に過去にしておく
  let lastEvent = '';

  const tiltIn = createDragTilt(ctx, {
    toLocal: (p) => cv.toLocal(p),
    div: 90, // 画面の90px ドラッグで かたむき1（ゆるめ＝ていねいに動かしやすい）
    enabled: () => started && !hostPaused && mode === 'carry',
  });

  function loadStage(i: number): void {
    stageIdx = i;
    st = initialState();
    acc = 0;
    mode = 'carry';
    // ここで tiltIn.reset() はしない。ドラッグしたままステージが切り替わったときに
    // 「指を離して押し直すまで動かない」状態になってしまうため（センサー操作は
    // そもそも傾きが持ち越されるので、ドラッグもそれに合わせる）。
    // 水面は initialState() でまっすぐに戻っているので、持ち越しても急にはこぼれない。
  }

  const offTap = ctx.input.onTap((p) => {
    if (hostPaused || !started) return;
    const l = cv.toLocal(p);
    if (l.x >= CALIB.x && l.x <= CALIB.x + CALIB.w && l.y >= CALIB.y && l.y <= CALIB.y + CALIB.h) {
      // 「すいへい」＝いまの持ち方をまっすぐとして覚え直す（傾け系ゲーム共通の作法）
      ctx.motion?.calibrate();
      tiltIn.reset();
      ctx.sfx('tap');
      lastEvent = 'calibrate';
    }
  });

  const offFrame = ctx.onFrame((dt) => {
    if (hostPaused || !started) return;
    const now = ctx.now();
    if (mode === 'carry') {
      const tilt = clamp(tiltIn.value().x, -1, 1);
      acc += Math.min(0.1, dt); // 復帰直後の巨大 dt を切る
      while (acc >= SUB_DT) {
        acc -= SUB_DT;
        if (step(st, tilt, SUB_DT)) spillFlash = now;
      }
      const stage = STAGES[stageIdx]!;
      if (isCleared(st, stage)) {
        const pts = stageScore(st);
        score += pts;
        cleared++;
        if (st.level >= 99.5) fullClears++;
        mode = 'cleared';
        phaseUntil = now + CLEAR_MS;
        ctx.sfx('medal');
        ctx.haptic('success');
        if (cleared === 1) ctx.achieve('first-carry');
        if (cleared >= 3) ctx.achieve('half');
        if (st.level >= 99.5) ctx.achieve('full-water');
        lastEvent = `clear:${stageIdx}:${pts}:${st.level.toFixed(1)}`;
      } else if (isFailed(st, stage)) {
        retries++;
        mode = 'failed';
        phaseUntil = now + FAIL_MS;
        ctx.sfx('fail');
        ctx.haptic('error');
        lastEvent = `fail:${stageIdx}:${st.level.toFixed(1)}`;
      }
    } else if (mode === 'cleared' && now >= phaseUntil) {
      if (stageIdx + 1 >= STAGES.length) finish(now);
      else loadStage(stageIdx + 1);
    } else if (mode === 'failed' && now >= phaseUntil) {
      loadStage(stageIdx); // 同じステージをやり直し（ライフは減らない）
    } else if (mode === 'done' && !ended && now >= phaseUntil) {
      ended = true;
      ctx.end({ score });
      return;
    }
    draw(now);
    setData();
  });

  function finish(now: number): void {
    ctx.achieve('all-clear');
    if (retries === 0) ctx.achieve('no-retry');
    if (score >= SCORE_HI) ctx.achieve('score-hi');
    mode = 'done';
    phaseUntil = now + END_DELAY;
    ctx.sfx('medal');
    lastEvent = `finish:${score}:${cleared}`;
  }

  function setData(): void {
    if (!import.meta.env.DEV) return;
    const r = ctx.root as HTMLElement;
    r.dataset.mode = mode;
    r.dataset.stage = String(stageIdx);
    r.dataset.need = String(STAGES[stageIdx]?.minWater ?? 0);
    r.dataset.level = st.level.toFixed(1);
    r.dataset.x = st.x.toFixed(1);
    r.dataset.vx = st.vx.toFixed(1);
    r.dataset.wave = st.w.toFixed(2);
    r.dataset.hold = st.hold.toFixed(2);
    r.dataset.score = String(score);
    r.dataset.cleared = String(cleared);
    r.dataset.retries = String(retries);
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

  function drawCup(): void {
    const cx = st.x;
    const top = FLOOR_Y - CUP_H;
    // 水（コップの中）。水面は ゆれ(w) の分だけ かたむく
    const fill = clamp(st.level / 100, 0, 1);
    const innerH = CUP_H - 10;
    const surfaceY = top + 6 + innerH * (1 - fill);
    const lean = clamp(st.w, -1, 1) * 16;
    g.save();
    g.beginPath();
    g.moveTo(cx - CUP_W / 2 + 4, top + 4);
    g.lineTo(cx + CUP_W / 2 - 4, top + 4);
    g.lineTo(cx + CUP_W / 2 - 6, FLOOR_Y - 4);
    g.lineTo(cx - CUP_W / 2 + 6, FLOOR_Y - 4);
    g.closePath();
    g.clip();
    if (fill > 0) {
      g.fillStyle = C_WATER;
      g.beginPath();
      g.moveTo(cx - CUP_W, surfaceY + lean);
      g.lineTo(cx + CUP_W, surfaceY - lean);
      g.lineTo(cx + CUP_W, FLOOR_Y);
      g.lineTo(cx - CUP_W, FLOOR_Y);
      g.closePath();
      g.fill();
      g.strokeStyle = C_WATER_DK;
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(cx - CUP_W, surfaceY + lean);
      g.lineTo(cx + CUP_W, surfaceY - lean);
      g.stroke();
    }
    g.restore();
    // コップ
    g.fillStyle = C_CUP;
    g.beginPath();
    g.moveTo(cx - CUP_W / 2, top);
    g.lineTo(cx + CUP_W / 2, top);
    g.lineTo(cx + CUP_W / 2 - 6, FLOOR_Y);
    g.lineTo(cx - CUP_W / 2 + 6, FLOOR_Y);
    g.closePath();
    g.fill();
    g.strokeStyle = C_CUP_LINE;
    g.lineWidth = 3;
    g.stroke();
  }

  function draw(now: number): void {
    cv.clear(C_BG);

    // HUD
    g.fillStyle = C_HUD;
    g.fillRect(0, 0, W, HUD_H);
    g.fillStyle = '#fff';
    g.font = 'bold 18px sans-serif';
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.fillText(`${score}てん`, 12, HUD_H / 2);
    g.fillStyle = '#bfe4ff';
    g.font = 'bold 13px sans-serif';
    g.fillText(`ステージ ${Math.min(stageIdx + 1, STAGES.length)}/${STAGES.length}`, 116, HUD_H / 2 - 8);
    g.fillText(`やりなおし ${retries}かい`, 116, HUD_H / 2 + 9);

    g.textAlign = 'center';
    g.textBaseline = 'middle';

    if (mode === 'done') {
      g.fillStyle = C_TEXT;
      g.font = 'bold 26px sans-serif';
      g.fillText('ぜんぶ 運べた！', W / 2, 290);
      g.font = 'bold 34px sans-serif';
      g.fillStyle = C_WATER_DK;
      g.fillText(`${score}てん`, W / 2, 346);
      g.fillStyle = C_DIM;
      g.font = 'bold 14px sans-serif';
      g.fillText(`まんぱいクリア ${fullClears} / ${STAGES.length}・やりなおし ${retries}かい`, W / 2, 390);
      return;
    }

    const need = STAGES[stageIdx]!.minWater;

    // 水の量のゲージ（必要ラインつき）
    g.fillStyle = 'rgba(45,90,120,.14)';
    roundRect(LEVEL_BAR.x, LEVEL_BAR.y, LEVEL_BAR.w, LEVEL_BAR.h, 8);
    g.fill();
    g.fillStyle = st.level >= need ? C_WATER : C_NG;
    roundRect(LEVEL_BAR.x, LEVEL_BAR.y, (LEVEL_BAR.w * clamp(st.level, 0, 100)) / 100, LEVEL_BAR.h, 8);
    g.fill();
    const needX = LEVEL_BAR.x + (LEVEL_BAR.w * need) / 100;
    g.strokeStyle = C_TEXT;
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(needX, LEVEL_BAR.y - 5);
    g.lineTo(needX, LEVEL_BAR.y + LEVEL_BAR.h + 5);
    g.stroke();
    g.fillStyle = C_DIM;
    g.font = 'bold 12px sans-serif';
    g.textAlign = 'left';
    g.fillText(`水 ${Math.round(st.level)}%`, LEVEL_BAR.x, LEVEL_BAR.y - 16);
    g.textAlign = 'right';
    g.fillText(`ひつよう ${need}%`, LEVEL_BAR.x + LEVEL_BAR.w, LEVEL_BAR.y - 16);

    // 説明
    g.textAlign = 'center';
    g.fillStyle = C_TEXT;
    g.font = 'bold 15px sans-serif';
    g.fillText('かたむけて（または ドラッグで）ゴールまで はこぶ', W / 2, 148);
    g.fillStyle = C_DIM;
    g.font = 'bold 12px sans-serif';
    g.fillText('急に かたむけると 水が こぼれる。そっと 動かそう', W / 2, 172);

    // ゆかとゴール
    g.fillStyle = '#cfe6f4';
    g.fillRect(0, FLOOR_Y, W, 14);
    g.fillStyle = 'rgba(46,143,79,.18)';
    g.fillRect(GOAL_X1 - CUP_W / 2, FLOOR_Y - 96, GOAL_X2 - GOAL_X1 + CUP_W, 96);
    g.strokeStyle = C_OK;
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(GOAL_X1 - CUP_W / 2, FLOOR_Y - 96);
    g.lineTo(GOAL_X1 - CUP_W / 2, FLOOR_Y);
    g.stroke();
    g.fillStyle = C_OK;
    g.font = 'bold 13px sans-serif';
    g.fillText('ゴール', (GOAL_X1 + GOAL_X2) / 2 + 6, FLOOR_Y - 106);

    drawCup();

    // ゆれメーター（あとどれくらいで こぼれるか）
    const wr = Math.min(1, Math.abs(st.w) / SPILL_LIMIT);
    g.fillStyle = 'rgba(45,90,120,.14)';
    roundRect(W / 2 - 70, 452, 140, 10, 5);
    g.fill();
    g.fillStyle = wr > 0.85 ? C_NG : C_WATER;
    roundRect(W / 2 - 70, 452, 140 * wr, 10, 5);
    g.fill();
    g.fillStyle = C_DIM;
    g.font = 'bold 11px sans-serif';
    g.fillText('ゆれ', W / 2, 440);

    // こぼれた瞬間の合図
    if (now - spillFlash < 260) {
      g.fillStyle = C_NG;
      g.font = 'bold 18px sans-serif';
      g.fillText('こぼれた！', st.x, FLOOR_Y - CUP_H - 22);
    }

    // ゴールで止まっている進み具合
    if (st.hold > 0 && mode === 'carry') {
      g.fillStyle = C_OK;
      roundRect(W / 2 - 50, 486, 100 * clamp(st.hold / HOLD_SEC, 0, 1), 8, 4);
      g.fill();
      g.fillStyle = C_DIM;
      g.font = 'bold 11px sans-serif';
      g.fillText('そのまま とめて…', W / 2, 476);
    }

    // 「すいへい」ボタン
    g.fillStyle = '#ffffff';
    roundRect(CALIB.x, CALIB.y, CALIB.w, CALIB.h, 12);
    g.fill();
    g.strokeStyle = C_CUP_LINE;
    g.lineWidth = 2;
    roundRect(CALIB.x, CALIB.y, CALIB.w, CALIB.h, 12);
    g.stroke();
    g.fillStyle = C_TEXT;
    g.font = 'bold 15px sans-serif';
    g.fillText('すいへい', CALIB.x + CALIB.w / 2, CALIB.y + CALIB.h / 2);

    // ステージの進み具合
    for (let i = 0; i < STAGES.length; i++) {
      g.fillStyle = i < stageIdx ? C_OK : i === stageIdx ? C_WATER : 'rgba(45,90,120,.25)';
      g.beginPath();
      g.arc(W - 30 - (STAGES.length - 1 - i) * 18, CALIB.y + CALIB.h / 2, 5.5, 0, Math.PI * 2);
      g.fill();
    }

    // 結果メッセージ
    if (mode === 'cleared') {
      g.fillStyle = C_OK;
      g.font = 'bold 24px sans-serif';
      g.fillText(`クリア！ 水 ${Math.round(st.level)}% のこった`, W / 2, 250);
    } else if (mode === 'failed') {
      g.fillStyle = C_NG;
      g.font = 'bold 22px sans-serif';
      g.fillText(st.level <= 0 ? 'ぜんぶ こぼれちゃった…' : `こぼしすぎ！（${need}% ひつよう）`, W / 2, 250);
      g.fillStyle = C_DIM;
      g.font = 'bold 14px sans-serif';
      g.fillText('もう一度 はじめから', W / 2, 278);
    }
  }

  loadStage(0);
  draw(0);
  setData();

  return {
    start() {
      started = true;
      ctx.motion?.calibrate();
    },
    pause() {
      hostPaused = true;
    },
    resume() {
      hostPaused = false;
      // 持ち方が変わっていることがあるので、復帰時に基準を取り直す（傾け系の作法）
      ctx.motion?.calibrate();
      tiltIn.reset();
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
