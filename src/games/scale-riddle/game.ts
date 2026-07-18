// =============================================================
// てんびんばかりの なぞとき（No.72）: 2つずつ くらべて、かくれた重さを 推理！
// =============================================================
// - 「はかる」モード: はこを2つタップ→てんびんが かたむいて どちらが重いか わかる。
//   「こたえる」モード: 重いと思う順に はこをタップして「けってい！」。
//   はかった回数が めやす以内なら ボーナス満点。全3もん。
// - 重さ生成・判定・採点は logic.ts（純ロジック・rng注入）。
// - 全画面 Canvas・onTap のみ。時間は ctx.now 期限方式・setTimeout 不使用。
// - import してよいのは game-api（types / helpers）と、このフォルダ内（logic）だけ
import type { GameContext, IGame } from '../../game-api/types';
import {
  CORRECT_PTS,
  ITEMS,
  ITEM_COUNTS,
  PARS,
  ROUNDS,
  WRONG_PTS,
  answerSlots,
  correctOrder,
  heavier,
  isCorrect,
  makeWeights,
  parBonus,
} from './logic';

const W = 360;
const H = 640;
const HUD_H = 44;
const ITEM_Y = 108;
const SCALE_CX = 180;
const SCALE_CY = 236;
const BEAM_HALF = 92;
const TILT_RAD = 0.2;
const TILT_MS = 620;
const REVEAL_MS = 2400;
const END_DELAY = 1800;
const SCORE_HI = 440;

const MODE_BTN = { x: 18, y: 388, w: 158, h: 50 };
const RESET_BTN = { x: 250, y: 388, w: 92, h: 50 };
const SUBMIT_BTN = { x: 96, y: 540, w: 168, h: 54 };
const SLOT_Y = 476;

type Phase = 'work' | 'reveal' | 'over';
type UiMode = 'weigh' | 'answer';

export function createGame(ctx: GameContext): IGame {
  const cv = ctx.canvas2d({ design: { w: W, h: H } });
  const g = cv.ctx;

  let phase: Phase = 'work';
  let hostPaused = false;
  let roundIdx = 0;
  let weights: number[] = [];
  let uiMode: UiMode = 'weigh';
  let selected: number[] = []; // はかりに載せる選択（最大2）
  let pans: [number, number] | null = null; // 直近ではかった2つ（表示継続）
  let tiltT0 = 0;
  let tiltDir = 0; // -1=左が重い / 1=右が重い
  let weighs = 0;
  let answer: number[] = [];
  let score = 0;
  let correctCount = 0;
  let parAll = true;
  let lastResult: { ok: boolean; pts: number } | null = null;
  let revealUntil = 0;
  let endAt = 0;
  let ended = false;

  function initRound(idx: number, now: number): void {
    roundIdx = idx;
    weights = makeWeights(ITEM_COUNTS[idx] ?? 4, ctx.random);
    uiMode = 'weigh';
    selected = [];
    pans = null;
    weighs = 0;
    answer = [];
    lastResult = null;
    phase = 'work';
    void now;
  }

  function addScore(n: number): void {
    score += n;
    if (score >= SCORE_HI) ctx.achieve('score-hi');
  }

  const n = (): number => weights.length;
  const itemX = (i: number): number => {
    const count = n();
    const gap = count === 5 ? 66 : 80;
    return W / 2 + (i - (count - 1) / 2) * gap;
  };

  function doWeigh(a: number, b: number, now: number): void {
    weighs++;
    pans = [a, b];
    tiltT0 = now;
    tiltDir = heavier(weights, a, b) === a ? -1 : 1;
    selected = [];
    ctx.sfx('tick');
    ctx.haptic('light');
  }

  function submit(now: number): void {
    const ok = isCorrect(roundIdx, weights, answer);
    const par = PARS[roundIdx] ?? 3;
    const pts = ok ? CORRECT_PTS + parBonus(weighs, par) : WRONG_PTS;
    addScore(pts);
    lastResult = { ok, pts };
    if (ok) {
      correctCount++;
      ctx.achieve('first-solve');
      if (weighs <= par) ctx.achieve('par-1');
      else parAll = false;
      if (roundIdx === 2) ctx.achieve('sort-master');
      ctx.sfx('success');
      ctx.haptic('success');
    } else {
      parAll = false;
      ctx.sfx('fail');
      ctx.haptic('error');
    }
    phase = 'reveal';
    revealUntil = now + REVEAL_MS;
  }

  // ---- 入力 ----
  const inRect = (l: { x: number; y: number }, r: { x: number; y: number; w: number; h: number }): boolean =>
    l.x >= r.x && l.x <= r.x + r.w && l.y >= r.y && l.y <= r.y + r.h;

  const offTap = ctx.input.onTap((p) => {
    if (hostPaused || phase !== 'work') return;
    const l = cv.toLocal(p);
    const now = ctx.now();
    // モード切替
    if (inRect(l, MODE_BTN)) {
      uiMode = uiMode === 'weigh' ? 'answer' : 'weigh';
      selected = [];
      ctx.sfx('tap');
      return;
    }
    // やりなおす（こたえを消す）
    if (inRect(l, RESET_BTN)) {
      answer = [];
      selected = [];
      ctx.sfx('tick');
      return;
    }
    // けってい
    if (uiMode === 'answer' && inRect(l, SUBMIT_BTN)) {
      if (answer.length === answerSlots(roundIdx)) submit(now);
      else ctx.sfx('fail');
      return;
    }
    // こたえスロット（タップでそこから消す）
    if (uiMode === 'answer') {
      const slots = answerSlots(roundIdx);
      for (let s = 0; s < slots; s++) {
        const sx = W / 2 + (s - (slots - 1) / 2) * 64;
        if (Math.abs(l.x - sx) <= 30 && Math.abs(l.y - SLOT_Y) <= 32 && s < answer.length) {
          answer = answer.slice(0, s);
          ctx.sfx('tick');
          return;
        }
      }
    }
    // はこ
    for (let i = 0; i < n(); i++) {
      if (Math.abs(l.x - itemX(i)) <= 30 && Math.abs(l.y - ITEM_Y) <= 34) {
        if (uiMode === 'weigh') {
          if (selected.includes(i)) {
            selected = selected.filter((x) => x !== i);
          } else {
            if (selected.length === 0) pans = null; // 新しいはかりへ
            selected.push(i);
            if (selected.length === 2) doWeigh(selected[0]!, selected[1]!, now);
          }
          ctx.sfx('tap');
        } else {
          if (!answer.includes(i) && answer.length < answerSlots(roundIdx)) {
            answer.push(i);
            ctx.sfx('tap');
          }
        }
        return;
      }
    }
  });

  // ---- 毎フレーム ----
  const offFrame = ctx.onFrame(() => {
    if (hostPaused) return;
    const now = ctx.now();
    if (phase === 'reveal') {
      if (now >= revealUntil) {
        if (roundIdx >= ROUNDS - 1) {
          if (correctCount === ROUNDS) ctx.achieve('all-correct');
          if (correctCount === ROUNDS && parAll) ctx.achieve('all-par');
          phase = 'over';
          endAt = now + END_DELAY;
          ctx.sfx('medal');
        } else {
          initRound(roundIdx + 1, now);
        }
      }
    } else if (phase === 'over') {
      if (!ended && now >= endAt) {
        ended = true;
        ctx.end({ score });
        return;
      }
    }
    draw(now);
    setData();
  });

  function setData(): void {
    if (!import.meta.env.DEV) return;
    const r = ctx.root as HTMLElement;
    r.dataset.phase = phase;
    r.dataset.uimode = uiMode;
    r.dataset.round = String(roundIdx);
    r.dataset.score = String(score);
    r.dataset.weighs = String(weighs);
    r.dataset.par = String(PARS[roundIdx] ?? 0);
    r.dataset.weightsHidden = weights.join(',');
    r.dataset.answer = answer.join(',');
    r.dataset.selected = selected.join(',');
    r.dataset.lastcmp = pans ? `${pans[0]}v${pans[1]}:${tiltDir < 0 ? pans[0] : pans[1]}` : '';
    r.dataset.correct = String(correctCount);
  }

  // ---- 描画 ----
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

  function drawBox(x: number, y: number, i: number, size: number): void {
    const def = ITEMS[i]!;
    g.fillStyle = def.color;
    roundRect(x - size / 2, y - size / 2, size, size, 7);
    g.fill();
    g.fillStyle = def.ribbon;
    g.fillRect(x - size / 2, y - 3, size, 6);
    g.fillRect(x - 3, y - size / 2, 6, size);
    g.fillStyle = 'rgba(255,255,255,.35)';
    g.beginPath();
    g.arc(x, y - size / 2 + 1, 6, Math.PI, 0);
    g.fill();
  }

  function tiltNow(now: number): number {
    const t = Math.min(1, (now - tiltT0) / TILT_MS);
    const e = 1 - (1 - t) * (1 - t);
    return tiltDir * TILT_RAD * e;
  }

  function draw(now: number): void {
    // 書斎ふう背景
    g.fillStyle = '#f2e8d8';
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#e2d2b8';
    g.fillRect(0, 0, W, 64);
    g.fillStyle = '#caa878';
    g.fillRect(0, 352, W, 8);

    // はこたち
    for (let i = 0; i < n(); i++) {
      const x = itemX(i);
      const onPan = pans && (pans[0] === i || pans[1] === i);
      const inAns = answer.includes(i);
      if (!onPan) drawBox(x, ITEM_Y, i, 44);
      if (selected.includes(i)) {
        g.strokeStyle = '#e08a2a';
        g.lineWidth = 3.5;
        roundRect(x - 27, ITEM_Y - 27, 54, 54, 9);
        g.stroke();
      }
      if (inAns) {
        g.fillStyle = 'rgba(0,0,0,.35)';
        g.font = 'bold 13px sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(`${answer.indexOf(i) + 1}`, x + 20, ITEM_Y - 20);
      }
      g.fillStyle = '#6a5a40';
      g.font = 'bold 11px sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(ITEMS[i]!.name, x, ITEM_Y + 34);
    }

    // てんびん
    const tilt = pans ? tiltNow(now) : 0;
    g.strokeStyle = '#8a6a45';
    g.lineWidth = 8;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(SCALE_CX, SCALE_CY + 92);
    g.lineTo(SCALE_CX, SCALE_CY);
    g.stroke();
    g.fillStyle = '#8a6a45';
    g.beginPath();
    g.moveTo(SCALE_CX - 34, SCALE_CY + 96);
    g.lineTo(SCALE_CX + 34, SCALE_CY + 96);
    g.lineTo(SCALE_CX + 22, SCALE_CY + 86);
    g.lineTo(SCALE_CX - 22, SCALE_CY + 86);
    g.closePath();
    g.fill();
    // うで
    const lx = SCALE_CX - Math.cos(tilt) * BEAM_HALF;
    const ly = SCALE_CY - Math.sin(tilt) * BEAM_HALF;
    const rx = SCALE_CX + Math.cos(tilt) * BEAM_HALF;
    const ry = SCALE_CY + Math.sin(tilt) * BEAM_HALF;
    g.strokeStyle = '#6a4a2a';
    g.lineWidth = 6;
    g.beginPath();
    g.moveTo(lx, ly);
    g.lineTo(rx, ry);
    g.stroke();
    g.fillStyle = '#e8b23c';
    g.beginPath();
    g.arc(SCALE_CX, SCALE_CY, 7, 0, Math.PI * 2);
    g.fill();
    // 皿（ひも＋おさら）
    for (const side of [-1, 1] as const) {
      const px2 = side < 0 ? lx : rx;
      const py2 = side < 0 ? ly : ry;
      const panY = py2 + 46;
      g.strokeStyle = 'rgba(90,70,40,.8)';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(px2, py2);
      g.lineTo(px2 - 20, panY);
      g.moveTo(px2, py2);
      g.lineTo(px2 + 20, panY);
      g.stroke();
      g.fillStyle = '#caa878';
      g.beginPath();
      g.ellipse(px2, panY + 4, 30, 9, 0, 0, Math.PI * 2);
      g.fill();
      // 載っているはこ
      if (pans) {
        const item = side < 0 ? pans[0]! : pans[1]!;
        drawBox(px2, panY - 16, item, 38);
      }
    }
    // はかった結果のことば
    if (pans && now >= tiltT0 + TILT_MS) {
      const hv = tiltDir < 0 ? pans[0]! : pans[1]!;
      g.fillStyle = '#6a4a2a';
      g.font = 'bold 15px sans-serif';
      g.textAlign = 'center';
      g.fillText(`${ITEMS[hv]!.name}のほうが おもい！`, SCALE_CX, SCALE_CY - 28);
    }

    // はかった回数 / めやす
    g.fillStyle = '#6a5a40';
    g.font = 'bold 14px sans-serif';
    g.textAlign = 'left';
    g.fillText(`はかった: ${weighs}回`, 18, 344);
    g.fillStyle = weighs <= (PARS[roundIdx] ?? 3) ? '#43a047' : '#e08a2a';
    g.fillText(`めやす: ${PARS[roundIdx]}回`, 150, 344);

    // モード切替・やりなおすボタン
    g.fillStyle = uiMode === 'weigh' ? '#7c6cf0' : '#43a047';
    roundRect(MODE_BTN.x, MODE_BTN.y, MODE_BTN.w, MODE_BTN.h, 12);
    g.fill();
    g.fillStyle = '#fff';
    g.font = 'bold 15px sans-serif';
    g.textAlign = 'center';
    g.fillText(uiMode === 'weigh' ? '⚖️ はかるモード' : '✏️ こたえるモード', MODE_BTN.x + MODE_BTN.w / 2, MODE_BTN.y + 20);
    g.font = 'bold 11px sans-serif';
    g.fillText('タップで きりかえ', MODE_BTN.x + MODE_BTN.w / 2, MODE_BTN.y + 38);
    g.fillStyle = 'rgba(0,0,0,.12)';
    roundRect(RESET_BTN.x, RESET_BTN.y, RESET_BTN.w, RESET_BTN.h, 12);
    g.fill();
    g.fillStyle = '#6a5a40';
    g.font = 'bold 14px sans-serif';
    g.fillText('やりなおす', RESET_BTN.x + RESET_BTN.w / 2, RESET_BTN.y + RESET_BTN.h / 2);

    // こたえスロット
    const slots = answerSlots(roundIdx);
    g.fillStyle = '#6a5a40';
    g.font = 'bold 13px sans-serif';
    g.fillText(roundIdx === 0 ? 'いちばん おもいのは？' : 'おもい じゅんに ならべよう', W / 2, 442);
    for (let s = 0; s < slots; s++) {
      const sx = W / 2 + (s - (slots - 1) / 2) * 64;
      g.strokeStyle = uiMode === 'answer' ? '#43a047' : 'rgba(0,0,0,.25)';
      g.setLineDash(answer.length > s ? [] : [5, 4]);
      g.lineWidth = 2.5;
      roundRect(sx - 26, SLOT_Y - 26, 52, 52, 8);
      g.stroke();
      g.setLineDash([]);
      if (answer.length > s) drawBox(sx, SLOT_Y, answer[s]!, 40);
      else {
        g.fillStyle = 'rgba(0,0,0,.3)';
        g.font = 'bold 13px sans-serif';
        g.fillText(`${s + 1}`, sx, SLOT_Y);
      }
    }

    // けってい
    if (uiMode === 'answer') {
      const ready = answer.length === slots;
      g.fillStyle = ready ? '#e08a2a' : 'rgba(224,138,42,.35)';
      roundRect(SUBMIT_BTN.x, SUBMIT_BTN.y, SUBMIT_BTN.w, SUBMIT_BTN.h, 14);
      g.fill();
      g.fillStyle = '#fff';
      g.font = 'bold 19px sans-serif';
      g.fillText('けってい！', SUBMIT_BTN.x + SUBMIT_BTN.w / 2, SUBMIT_BTN.y + SUBMIT_BTN.h / 2);
    } else {
      g.fillStyle = 'rgba(106,90,64,.55)';
      g.font = 'bold 12px sans-serif';
      g.fillText('はこを 2つタップすると てんびんに のるよ', W / 2, SUBMIT_BTN.y + 26);
    }

    // HUD
    g.fillStyle = 'rgba(74,58,36,.9)';
    g.fillRect(0, 0, W, HUD_H);
    g.textAlign = 'left';
    g.fillStyle = '#fff';
    g.font = 'bold 19px sans-serif';
    g.fillText(`${score}てん`, 12, HUD_H / 2);
    g.fillStyle = '#ffe0b0';
    g.font = 'bold 15px sans-serif';
    g.fillText(`もんだい${roundIdx + 1}/${ROUNDS}`, 130, HUD_H / 2);

    // リビール
    if (phase === 'reveal' && lastResult) {
      g.fillStyle = 'rgba(40,28,10,.66)';
      g.fillRect(0, 0, W, H);
      g.textAlign = 'center';
      g.fillStyle = lastResult.ok ? '#8affc0' : '#ff9a8a';
      g.font = 'bold 30px sans-serif';
      g.fillText(lastResult.ok ? 'せいかい！' : 'ざんねん…', W / 2, 210);
      g.fillStyle = '#fff';
      g.font = 'bold 20px sans-serif';
      g.fillText(`+${lastResult.pts}てん`, W / 2, 248);
      // 正しい順（重い→軽い）と本当の重さ
      const order = correctOrder(weights);
      g.font = 'bold 14px sans-serif';
      g.fillText('ほんとうの おもさ（おもい じゅん）', W / 2, 300);
      for (let k = 0; k < order.length; k++) {
        const i = order[k]!;
        const x = W / 2 + (k - (order.length - 1) / 2) * 64;
        drawBox(x, 348, i, 40);
        g.fillStyle = '#ffe0b0';
        g.font = 'bold 13px sans-serif';
        g.fillText('■'.repeat(weights[i] ?? 0), x, 388);
      }
    }
    if (phase === 'over') {
      g.fillStyle = 'rgba(40,28,10,.72)';
      g.fillRect(0, 0, W, H);
      g.textAlign = 'center';
      g.fillStyle = '#fff';
      g.font = 'bold 30px sans-serif';
      g.fillText('なぞとき しゅうりょう！', W / 2, H / 2 - 40);
      g.font = 'bold 22px sans-serif';
      g.fillText(`${correctCount}/3もん せいかい / ${score}てん`, W / 2, H / 2 + 6);
    }
  }

  return {
    start() {
      initRound(0, ctx.now());
      draw(ctx.now());
      setData();
    },
    pause() {
      hostPaused = true;
    },
    resume() {
      hostPaused = false;
    },
    resize() {
      if (weights.length > 0) draw(ctx.now());
    },
    destroy() {
      offTap();
      offFrame();
    },
  };
}
