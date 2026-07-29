// =============================================================
// どこに かくれた？（No.102・かくれゲーム）: カップの下のボールを目で追う
// =============================================================
// - ボールを見せる → カップを入れかえる → どれか タップで当てる。全8ラウンド。
// - 入れかえの中身は logic.makeRound（rng 注入＝決定論）。ここは見た目と入力だけ。
//   「どこにボールがあるか」は logic.finalSlot と同じ計算をアニメと分けて持つので、
//   演出がずれても答え合わせは狂わない。
// - 難易度は「ふつう」: 入れかえの速さは一定・はずれてもライフは減らず次のラウンドへ進む。
// - import してよいのは game-api（types / helpers）と、このフォルダ内（logic）だけ。
import type { GameContext, IGame, PointerInfo } from '../../game-api/types';
import { clamp } from '../../game-api/helpers';
import { ROUNDS, type Round, makeRound, roundScore } from './logic';

const W = 360;
const H = 640;
const HUD_H = 46;
const CUP_W = 56;
const CUP_H = 74;
const CUP_GAP = 8;
const CUP_Y = 300;
const LIFT = 46; // ボールを見せるときにカップを持ち上げる高さ
const REVEAL_MS = 1300;
const SWAP_MS = 420;
const RESULT_MS = 1100;
const END_DELAY = 2200;
const SCORE_HI = 900;

const C_BG = '#20304a';
const C_TEXT = '#eaf0ff';
const C_DIM = '#9fb0d0';
const C_HUD = '#16233a';
const C_CUP = '#e0483c';
const C_CUP_DARK = '#a8332a';
const C_BALL = '#ffd54a';
const C_OK = '#5ce08a';
const C_NG = '#ff8a7a';

type Mode = 'reveal' | 'shuffle' | 'pick' | 'result' | 'done';

export function createGame(ctx: GameContext): IGame {
  const cv = ctx.canvas2d({ design: { w: W, h: H } });
  const g = cv.ctx;

  let roundIdx = 0;
  let round: Round = makeRound(ctx.random, 0);
  /** slotCup[スロット] = カップのID（入れかえで中身が動く） */
  let slotCup: number[] = [];
  /** ボールが入っているカップのID */
  let ballCup = 0;
  let mode: Mode = 'reveal';
  let started = false;
  let hostPaused = false;
  let ended = false;
  let score = 0;
  let correct = 0;
  let streak = 0;
  let bestStreak = 0;
  let phaseUntil = 0;
  let swapIdx = 0;
  let swapStart = 0;
  /** 入れかえアニメ中の2つのスロット（-1 は動いていない） */
  let animA = -1;
  let animB = -1;
  let pickedSlot = -1;
  let lastOk = false;
  let lastEvent = '';

  function loadRound(i: number): void {
    roundIdx = i;
    round = makeRound(ctx.random, i);
    slotCup = Array.from({ length: round.cups }, (_, k) => k);
    ballCup = slotCup[round.startSlot]!;
    swapIdx = 0;
    animA = -1;
    animB = -1;
    pickedSlot = -1;
    mode = 'reveal';
    phaseUntil = ctx.now() + REVEAL_MS;
  }

  // ---------- レイアウト ----------
  const slotX = (slot: number): number => {
    const n = round.cups;
    const total = n * CUP_W + (n - 1) * CUP_GAP;
    return (W - total) / 2 + slot * (CUP_W + CUP_GAP);
  };
  const cupRect = (slot: number): { x: number; y: number; w: number; h: number } => ({
    x: slotX(slot),
    y: CUP_Y,
    w: CUP_W,
    h: CUP_H,
  });
  const inRect = (p: { x: number; y: number }, r: { x: number; y: number; w: number; h: number }): boolean =>
    p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;

  // ---------- 入力 ----------
  const offTap = ctx.input.onTap((p: PointerInfo) => {
    if (hostPaused || !started || mode !== 'pick') return;
    const l = cv.toLocal(p);
    for (let slot = 0; slot < round.cups; slot++) {
      // タップ判定はカップの見た目より少し広めに取る（指で押しやすいように）
      const r = cupRect(slot);
      if (inRect(l, { x: r.x - 4, y: r.y - 10, w: r.w + 8, h: r.h + 20 })) {
        pick(slot);
        return;
      }
    }
  });

  function pick(slot: number): void {
    pickedSlot = slot;
    lastOk = slotCup[slot] === ballCup;
    if (lastOk) {
      const pts = roundScore(round);
      score += pts;
      correct++;
      streak++;
      if (streak > bestStreak) bestStreak = streak;
      ctx.sfx('success');
      ctx.haptic('success');
      if (correct === 1) ctx.achieve('first-find');
      if (correct >= 4) ctx.achieve('half');
      if (streak >= 3) ctx.achieve('streak-3');
      if (round.cups >= 5) ctx.achieve('five-cup');
      lastEvent = `ok:${roundIdx}:${pts}`;
    } else {
      streak = 0;
      ctx.sfx('fail');
      ctx.haptic('error');
      lastEvent = `ng:${roundIdx}`;
    }
    mode = 'result';
    phaseUntil = ctx.now() + RESULT_MS;
  }

  // ---------- 毎フレーム ----------
  const offFrame = ctx.onFrame(() => {
    if (hostPaused || !started) return;
    const now = ctx.now();
    if (mode === 'reveal' && now >= phaseUntil) {
      mode = 'shuffle';
      swapIdx = 0;
      swapStart = now;
      const sw = round.swaps[0];
      animA = sw ? sw[0] : -1;
      animB = sw ? sw[1] : -1;
    } else if (mode === 'shuffle' && now >= swapStart + SWAP_MS) {
      // 1回ぶんの入れかえを確定して、次へ
      if (animA >= 0 && animB >= 0) {
        const t = slotCup[animA]!;
        slotCup[animA] = slotCup[animB]!;
        slotCup[animB] = t;
      }
      swapIdx++;
      if (swapIdx >= round.swaps.length) {
        animA = -1;
        animB = -1;
        mode = 'pick';
      } else {
        const sw = round.swaps[swapIdx]!;
        animA = sw[0];
        animB = sw[1];
        swapStart = now;
      }
    } else if (mode === 'result' && now >= phaseUntil) {
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
    if (correct >= ROUNDS) {
      score += 150;
      ctx.achieve('all-clear');
    }
    if (score >= SCORE_HI) ctx.achieve('score-hi');
    mode = 'done';
    phaseUntil = now + END_DELAY;
    ctx.sfx('medal');
    lastEvent = `finish:${score}:${correct}/${ROUNDS}`;
  }

  function setData(): void {
    if (!import.meta.env.DEV) return;
    const r = ctx.root as HTMLElement;
    r.dataset.mode = mode;
    r.dataset.round = String(roundIdx);
    r.dataset.cups = String(round.cups);
    r.dataset.answer = String(slotCup.indexOf(ballCup));
    r.dataset.score = String(score);
    r.dataset.correct = String(correct);
    r.dataset.streak = String(streak);
    r.dataset.picked = String(pickedSlot);
    r.dataset.last = lastEvent;
  }

  // ---------- 描画 ----------
  function drawCup(x: number, y: number, lifted: boolean): void {
    const top = y + (lifted ? -LIFT : 0);
    // 影
    g.fillStyle = 'rgba(0,0,0,.25)';
    g.beginPath();
    g.ellipse(x + CUP_W / 2, y + CUP_H + 6, CUP_W * 0.42, 6, 0, 0, Math.PI * 2);
    g.fill();
    // 本体（台形）
    g.fillStyle = C_CUP;
    g.beginPath();
    g.moveTo(x + CUP_W * 0.16, top);
    g.lineTo(x + CUP_W * 0.84, top);
    g.lineTo(x + CUP_W, top + CUP_H);
    g.lineTo(x, top + CUP_H);
    g.closePath();
    g.fill();
    // 縁と影
    g.fillStyle = C_CUP_DARK;
    g.fillRect(x, top + CUP_H - 7, CUP_W, 7);
    g.fillStyle = 'rgba(255,255,255,.22)';
    g.beginPath();
    g.moveTo(x + CUP_W * 0.22, top + 4);
    g.lineTo(x + CUP_W * 0.34, top + 4);
    g.lineTo(x + CUP_W * 0.24, top + CUP_H - 10);
    g.lineTo(x + CUP_W * 0.14, top + CUP_H - 10);
    g.closePath();
    g.fill();
  }

  function drawBall(cx: number, cy: number): void {
    g.fillStyle = C_BALL;
    g.beginPath();
    g.arc(cx, cy, 13, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(255,255,255,.55)';
    g.beginPath();
    g.arc(cx - 4, cy - 4, 4.5, 0, Math.PI * 2);
    g.fill();
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
    g.fillStyle = '#bcd0ff';
    g.font = 'bold 13px sans-serif';
    g.fillText(`ラウンド ${Math.min(roundIdx + 1, ROUNDS)}/${ROUNDS}`, 116, HUD_H / 2 - 8);
    g.fillText(`せいかい ${correct}・れんぞく ${streak}`, 116, HUD_H / 2 + 9);

    g.textAlign = 'center';
    if (mode === 'done') {
      g.fillStyle = C_TEXT;
      g.font = 'bold 26px sans-serif';
      g.fillText(`${correct} / ${ROUNDS} かい せいかい！`, W / 2, 300);
      g.font = 'bold 34px sans-serif';
      g.fillStyle = C_BALL;
      g.fillText(`${score}てん`, W / 2, 356);
      g.fillStyle = C_DIM;
      g.font = 'bold 14px sans-serif';
      g.fillText(`さいこう れんぞく ${bestStreak}かい`, W / 2, 400);
      return;
    }

    // 説明
    g.fillStyle = C_TEXT;
    g.font = 'bold 17px sans-serif';
    const msg =
      mode === 'reveal'
        ? 'ボールの ばしょを おぼえて！'
        : mode === 'shuffle'
          ? 'よーく 見ていて…'
          : mode === 'pick'
            ? 'ボールは どこ？ タップして！'
            : lastOk
              ? 'せいかい！'
              : 'ざんねん…';
    if (mode === 'result') g.fillStyle = lastOk ? C_OK : C_NG;
    g.fillText(msg, W / 2, 150);
    g.fillStyle = C_DIM;
    g.font = 'bold 13px sans-serif';
    g.fillText(`カップ ${round.cups}こ・入れかえ ${round.swaps.length}かい`, W / 2, 182);

    // カップ（入れかえ中は2つが弧を描いて入れかわる）
    const t = mode === 'shuffle' ? clamp((now - swapStart) / SWAP_MS, 0, 1) : 0;
    for (let slot = 0; slot < round.cups; slot++) {
      let x = slotX(slot);
      let dy = 0;
      if (mode === 'shuffle' && (slot === animA || slot === animB)) {
        const other = slot === animA ? animB : animA;
        x = slotX(slot) + (slotX(other) - slotX(slot)) * t;
        // 片方は上、片方は下を通る（重ならずに見える）
        dy = Math.sin(t * Math.PI) * (slot === animA ? -18 : 14);
      }
      const cup = slotCup[slot]!;
      const isBall = cup === ballCup;
      const revealing = mode === 'reveal' && isBall;
      // こたえ合わせでは「選んだカップ」と「本当のカップ」の両方を持ち上げる。
      // ボールを描くのは 本当のカップだけ（選んだカップにも描くと ボールが2個あるように見える）
      const lifted = revealing || (mode === 'result' && (slot === pickedSlot || isBall));
      if (isBall && (revealing || mode === 'result')) {
        drawBall(x + CUP_W / 2, CUP_Y + CUP_H - 14);
      }
      g.save();
      g.translate(0, dy);
      drawCup(x, CUP_Y, lifted);
      g.restore();
      // 選んだカップに印
      if (mode === 'result' && slot === pickedSlot) {
        g.strokeStyle = lastOk ? C_OK : C_NG;
        g.lineWidth = 3;
        g.strokeRect(x - 4, CUP_Y - 8, CUP_W + 8, CUP_H + 16);
      }
    }

    // ラウンドの進み具合
    for (let i = 0; i < ROUNDS; i++) {
      g.fillStyle = i < roundIdx ? C_OK : i === roundIdx ? C_BALL : 'rgba(255,255,255,.2)';
      g.beginPath();
      g.arc(W / 2 - (ROUNDS - 1) * 9 + i * 18, 520, 5, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = C_DIM;
    g.font = 'bold 12px sans-serif';
    g.fillText('はずれても つぎの ラウンドへ すすめるよ', W / 2, 560);
  }

  loadRound(0);
  draw(0);
  setData();

  return {
    start() {
      started = true;
      // start() までは時間が進まないので、演出の期限をここで引き直す
      phaseUntil = ctx.now() + REVEAL_MS;
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
