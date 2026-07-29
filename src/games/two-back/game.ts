// =============================================================
// ふたつ まえ（No.107・かくれゲーム）: 流れてくる顔が「n つ前」と同じならタップ
// =============================================================
// - 高難度のねらい: 覚える相手が1枚進むたびにズレていくので、記憶を上書きし続ける必要がある。
//   さいごは「3つ前」＝大人でもかなり難しい。
// - 前に出た顔は いっさい 画面に残さない（残すと 見くらべるだけの遊びになってしまう）。
// - 出題は logic.makeStream（rng 注入＝決定論）。こちらは描画・入力・採点だけ。
// - import してよいのは game-api（types / helpers）と、このフォルダ内（logic）だけ。
import type { GameContext, IGame } from '../../game-api/types';
import { type Card, FACES, FALSE_PENALTY, PHASES, PHASE_BONUS, hitPoints, makeStream } from './logic';

const W = 360;
const H = 640;
const HUD_H = 46;

/** 1まいを見せている時間 */
const CARD_MS = 1350;
/** つぎの1まいまでの すきま（ここでもタップは受けつける） */
const GAP_MS = 400;
const INTRO_MS = 2800;
const END_DELAY = 2400;
const SCORE_HI = 900;

const C_BG = '#151226';
const C_CARD = '#f6f1e4';
const C_CARD_LINE = '#3a3358';
const C_TEXT = '#f0ecff';
const C_DIM = '#9b93c4';
const C_OK = '#43c98a';
const C_NG = '#e0483c';
const C_ACC = '#ffb44a';

type Mode = 'intro' | 'stream' | 'done';

export function createGame(ctx: GameContext): IGame {
  const cv = ctx.canvas2d({ design: { w: W, h: H } });
  const g = cv.ctx;

  const stream: Card[][] = makeStream(ctx.random);
  let phaseIdx = 0;
  let cards: Card[] = stream[0]!;
  let idx = 0;
  let mode: Mode = 'intro';
  let started = false;
  let hostPaused = false;
  let ended = false;
  let score = 0;
  let hits = 0;
  let misses = 0;
  let falses = 0;
  let phaseHits = 0;
  let phaseFalses = 0;
  let answered = false;
  /** 直前のこたえ（表示用）: 0=なし 1=あたり 2=おてつき 3=みのがし */
  let mark = 0;
  let markUntil = 0;
  let cardUntil = 0;
  let phaseUntil = 0;
  let lastEvent = '';

  function loadPhase(i: number): void {
    phaseIdx = i;
    cards = stream[i]!;
    idx = 0;
    answered = false;
    phaseHits = 0;
    phaseFalses = 0;
    mode = 'intro';
    phaseUntil = ctx.now() + INTRO_MS;
  }

  function startPhase(now: number): void {
    mode = 'stream';
    idx = 0;
    answered = false;
    cardUntil = now + CARD_MS + GAP_MS;
    lastEvent = `phase:${phaseIdx}`;
  }

  // ---------- 入力 ----------
  const offTap = ctx.input.onTap(() => {
    if (hostPaused || !started || mode !== 'stream' || answered) return;
    const card = cards[idx];
    if (!card) return;
    answered = true;
    const now = ctx.now();
    const n = PHASES[phaseIdx]!.n;
    if (card.match) {
      const pts = hitPoints(n);
      score += pts;
      hits++;
      phaseHits++;
      mark = 1;
      ctx.sfx('success');
      ctx.haptic('success');
      if (hits === 1) ctx.achieve('first-hit');
      if (n >= 2) ctx.achieve('level2');
      if (n >= 3) ctx.achieve('level3');
      lastEvent = `hit:${phaseIdx}:${idx}:${pts}`;
    } else {
      score = Math.max(0, score - FALSE_PENALTY);
      falses++;
      phaseFalses++;
      mark = 2;
      ctx.sfx('fail');
      ctx.haptic('error');
      lastEvent = `false:${phaseIdx}:${idx}`;
    }
    markUntil = now + 600;
  });

  // ---------- 毎フレーム ----------
  const offFrame = ctx.onFrame(() => {
    if (hostPaused || !started) return;
    const now = ctx.now();
    if (mode === 'intro' && now >= phaseUntil) {
      startPhase(now);
    } else if (mode === 'stream' && now >= cardUntil) {
      // 見のがし（一致だったのに タップしなかった）
      const card = cards[idx];
      if (card && card.match && !answered) {
        misses++;
        mark = 3;
        markUntil = now + 600;
        ctx.sfx('tick');
        lastEvent = `missed:${phaseIdx}:${idx}`;
      }
      idx++;
      answered = false;
      if (idx >= cards.length) {
        // パートの しめくくり
        const p = PHASES[phaseIdx]!;
        if (phaseHits >= p.matches && phaseFalses === 0) {
          score += PHASE_BONUS;
          lastEvent = `perfect:${phaseIdx}`;
          ctx.sfx('medal');
        }
        if (phaseIdx + 1 >= PHASES.length) finish(now);
        else loadPhase(phaseIdx + 1);
      } else {
        cardUntil = now + CARD_MS + GAP_MS;
      }
    } else if (mode === 'done' && !ended && now >= phaseUntil) {
      ended = true;
      ctx.end({ score });
      return;
    }
    draw(now);
    setData();
  });

  function finish(now: number): void {
    if (falses === 0) ctx.achieve('no-false');
    if (misses === 0) ctx.achieve('all-hit');
    if (score >= SCORE_HI) ctx.achieve('score-hi');
    mode = 'done';
    phaseUntil = now + END_DELAY;
    ctx.sfx('medal');
    lastEvent = `finish:${score}:${hits}/${hits + misses}`;
  }

  function setData(): void {
    if (!import.meta.env.DEV) return;
    const r = ctx.root as HTMLElement;
    r.dataset.mode = mode;
    r.dataset.phase = String(phaseIdx);
    r.dataset.n = String(PHASES[phaseIdx]?.n ?? 0);
    r.dataset.idx = String(idx);
    r.dataset.face = mode === 'stream' ? String(cards[idx]?.face ?? -1) : '-1';
    r.dataset.score = String(score);
    r.dataset.hits = String(hits);
    r.dataset.misses = String(misses);
    r.dataset.falses = String(falses);
    r.dataset.answered = answered ? '1' : '0';
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

  const nWord = (n: number): string => (n === 1 ? '1つ まえ' : n === 2 ? '2つ まえ' : '3つ まえ');

  function draw(now: number): void {
    cv.clear(C_BG);

    // HUD
    g.fillStyle = '#0d0a1a';
    g.fillRect(0, 0, W, HUD_H);
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.fillStyle = C_TEXT;
    g.font = 'bold 18px sans-serif';
    g.fillText(`${score}てん`, 12, HUD_H / 2);
    g.fillStyle = C_DIM;
    g.font = 'bold 13px sans-serif';
    g.fillText(`パート ${Math.min(phaseIdx + 1, PHASES.length)}/${PHASES.length}`, 116, HUD_H / 2 - 8);
    g.fillText(`ぴったり ${hits}・おてつき ${falses}`, 116, HUD_H / 2 + 9);

    g.textAlign = 'center';

    if (mode === 'done') {
      g.fillStyle = C_TEXT;
      g.font = 'bold 26px sans-serif';
      g.fillText('ぜんぶ おわり！', W / 2, 280);
      g.font = 'bold 34px sans-serif';
      g.fillStyle = C_ACC;
      g.fillText(`${score}てん`, W / 2, 336);
      g.fillStyle = C_DIM;
      g.font = 'bold 14px sans-serif';
      g.fillText(`ぴったり ${hits} / ${hits + misses}・おてつき ${falses}`, W / 2, 380);
      return;
    }

    if (mode === 'intro') {
      const p = PHASES[phaseIdx]!;
      g.fillStyle = C_DIM;
      g.font = 'bold 15px sans-serif';
      g.fillText(phaseIdx === 0 ? 'まずは かんたんな パートから' : 'ここから むずかしくなるよ', W / 2, 240);
      g.fillStyle = C_ACC;
      g.font = 'bold 44px sans-serif';
      g.fillText(nWord(p.n), W / 2, 300);
      g.fillStyle = C_TEXT;
      g.font = 'bold 17px sans-serif';
      g.fillText('と おなじ 顔が 出たら タップ！', W / 2, 350);
      g.fillStyle = C_DIM;
      g.font = 'bold 13px sans-serif';
      g.fillText(`ぜんぶで ${p.cards}まい`, W / 2, 392);
      return;
    }

    // といかけ
    g.fillStyle = C_DIM;
    g.font = 'bold 15px sans-serif';
    g.fillText(`いま出た顔は ${nWord(PHASES[phaseIdx]!.n)} と おなじ？`, W / 2, 100);

    // 1まいだけ見せる（前の顔は のこさない）
    const showing = now < cardUntil - GAP_MS;
    const cx = W / 2;
    const cy = 300;
    g.fillStyle = showing ? C_CARD : 'rgba(246,241,228,.10)';
    roundRect(cx - 100, cy - 100, 200, 200, 26);
    g.fill();
    g.strokeStyle = C_CARD_LINE;
    g.lineWidth = 3;
    roundRect(cx - 100, cy - 100, 200, 200, 26);
    g.stroke();
    if (showing) {
      g.textBaseline = 'middle';
      g.font = '112px sans-serif';
      g.fillText(FACES[cards[idx]?.face ?? 0] ?? '', cx, cy + 6);
    }

    // こたえの しるし（すぐ消える）
    if (now < markUntil) {
      g.font = 'bold 20px sans-serif';
      if (mark === 1) {
        g.fillStyle = C_OK;
        g.fillText('ぴったり！', cx, 442);
      } else if (mark === 2) {
        g.fillStyle = C_NG;
        g.fillText('おてつき…', cx, 442);
      } else {
        g.fillStyle = C_ACC;
        g.fillText('いまのは 一致だった！', cx, 442);
      }
    } else if (answered) {
      g.fillStyle = C_DIM;
      g.font = 'bold 13px sans-serif';
      g.fillText('この1まいは こたえずみ', cx, 442);
    }

    // すすみ ぐあい（●が今のまい数）
    const n = cards.length;
    const dotW = Math.min(14, 300 / n);
    const x0 = W / 2 - ((n - 1) * dotW) / 2;
    for (let i = 0; i < n; i++) {
      g.beginPath();
      g.arc(x0 + i * dotW, 496, i === idx ? 4.6 : 3, 0, Math.PI * 2);
      g.fillStyle = i === idx ? C_ACC : i < idx ? 'rgba(155,147,196,.75)' : 'rgba(155,147,196,.28)';
      g.fill();
    }

    g.fillStyle = C_DIM;
    g.font = 'bold 12px sans-serif';
    g.fillText('画面の どこを タップしても OK（1まいに 1回だけ）', W / 2, 556);
  }

  draw(0);
  setData();

  return {
    start() {
      started = true;
      phaseUntil = ctx.now() + INTRO_MS;
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
