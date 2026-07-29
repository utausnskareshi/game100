// =============================================================
// さいごの とびら（No.130・かくれゲーム）: 130本の しめくくり
// =============================================================
// - 3つの とびら（せいかくさ／きおく／ひらめき）を 順に あける。
//   どの試練も この ファイルの 中で 自作している（ほかのゲームは import しない）。
// - 判定は logic の 純関数＝ぶれない。第3の 出題は「こたえの くみが ちょうど1つ」を 保証。
// - ぜんぶ あけると 金の とびらが 開く 演出で しめくくる。
// - import してよいのは game-api（types / helpers）と、このフォルダ内（logic）だけ。
import type { GameContext, IGame, PointerInfo } from '../../game-api/types';
import {
  ALL_BONUS,
  DOORS,
  DOOR_NAMES,
  TRIES,
  MEM_COUNT,
  MEM_INPUT_MS,
  MEM_SHOW_MS,
  PER_DOOR,
  RINGS,
  RING_R0,
  SUM_CARDS,
  SUM_MAX,
  SUM_MS,
  type SumQuiz,
  makeMemory,
  makeSumQuiz,
  ringOk,
  ringRadius,
  trialPoints,
} from './logic';

const W = 360;
const H = 640;
const HUD_H = 46;

const AREA_CY = 330;
const INTRO_MS = 2600;
const OK_MS = 1200;
const NG_MS = 1600;
const END_DELAY = 3200;
const SCORE_HI = 1000;

/** きおくの マス（3×3） */
const MEM_CELL = 78;
const MEM_GAP = 10;
/** ひらめきの カード（3×2） */
const CARD_W = 96;
const CARD_H = 70;
const CARD_GAP = 12;

const C_BG = '#120e1a';
const C_PANEL = '#241c33';
const C_TEXT = '#f6f0ff';
const C_DIM = '#a394c0';
const C_GOLD = '#ffd54a';
const C_OK = '#5ad08a';
const C_NG = '#e0483c';
const C_RING = '#4ad0e0';

type Mode = 'intro' | 'trial' | 'ok' | 'ng' | 'done';
/** 第2の試練の 中の 進みぐあい */
type MemPhase = 'show' | 'input';

export function createGame(ctx: GameContext): IGame {
  const cv = ctx.canvas2d({ design: { w: W, h: H } });
  const g = cv.ctx;

  let door = 0;
  let trial = 0;
  let mode: Mode = 'intro';
  let started = false;
  let hostPaused = false;
  let ended = false;
  let score = 0;
  let passed = 0;
  /** いまの 試練に のこっている ちょうせん回数 */
  let triesLeft = TRIES;
  /** いまの とびらで 通った 試練の数（3つ ぜんぶ 通ったら「あけた」） */
  let doorPasses = 0;
  let misses = 0;
  let tightAim = false;
  let phaseUntil = 0;
  let trialStart = 0;
  let lastEvent = '';
  // 第1: わ
  let ringStopped = -1;
  // 第2: きおく
  let memCells: number[] = [];
  let memPicked: number[] = [];
  let memPhase: MemPhase = 'show';
  // 第3: ひらめき
  let quiz: SumQuiz = makeSumQuiz(ctx.random, SUM_MAX[0]!);
  let quizPicked: number[] = [];

  function beginTrial(now: number): void {
    trialStart = now;
    ringStopped = -1;
    memPicked = [];
    quizPicked = [];
    if (door === 1) {
      memCells = makeMemory(ctx.random, MEM_COUNT[trial]!);
      memPhase = 'show';
    } else if (door === 2) {
      quiz = makeSumQuiz(ctx.random, SUM_MAX[trial]!);
    }
    mode = 'trial';
    lastEvent = `trial:${door}:${trial}`;
  }

  function pass(now: number): void {
    const pts = trialPoints(door);
    score += pts;
    passed++;
    doorPasses++;
    ctx.sfx('medal');
    ctx.haptic('success');
    mode = 'ok';
    phaseUntil = now + OK_MS;
    lastEvent = `pass:${door}:${trial}:${pts}`;
  }

  function fail(now: number, why: string): void {
    triesLeft--;
    misses++;
    ctx.sfx('fail');
    ctx.haptic('error');
    mode = 'ng';
    phaseUntil = now + NG_MS;
    lastEvent = `fail:${door}:${trial}:${why}`;
  }

  /**
   * つぎの 試練（または つぎの とびら）へ すすむ。
   * ★130本の しめくくりなので「**9つの試練を ぜんぶ 体験できる**」ことを 保証する。
   *   むかしは ライフ制で、第1のとびらの 3つ目（ねらえる時間 161ms）で つまずくと
   *   ライフを 使いきって 第2・第3の とびらを 一度も 見られずに 終わっていた。
   */
  function advance(now: number): void {
    if (trial + 1 >= PER_DOOR) {
      // そのとびらの 3つを ぜんぶ 通ったときだけ「あけた」実績。
      // ※ 三項演算子で 1回にまとめず 明示的に 書く（実績IDが 文字列リテラルとして
      //   見えるので、宣言＝解除の 機械チェックが 通る）
      if (doorPasses >= PER_DOOR) {
        if (door === 0) ctx.achieve('door-1');
        else if (door === 1) ctx.achieve('door-2');
        else ctx.achieve('door-3');
      }
      if (door + 1 >= DOORS) {
        finish(now);
        return;
      }
      door++;
      trial = 0;
      doorPasses = 0;
      triesLeft = TRIES;
      mode = 'intro';
      phaseUntil = now + INTRO_MS;
      return;
    }
    trial++;
    triesLeft = TRIES;
    beginTrial(now);
  }

  function afterPhase(now: number): void {
    if (mode === 'ok') {
      advance(now);
      return;
    }
    // しっぱい: のこりが あれば 同じ 試練を もう1回、無ければ つぎの 試練へ
    if (triesLeft > 0) {
      beginTrial(now);
      return;
    }
    advance(now);
  }

  // ---------- 入力 ----------
  const memRect = (i: number): { x: number; y: number } => {
    const total = 3 * MEM_CELL + 2 * MEM_GAP;
    return {
      x: (W - total) / 2 + (i % 3) * (MEM_CELL + MEM_GAP),
      y: AREA_CY - total / 2 + Math.floor(i / 3) * (MEM_CELL + MEM_GAP),
    };
  };
  const cardRect = (i: number): { x: number; y: number } => {
    const total = 3 * CARD_W + 2 * CARD_GAP;
    return {
      x: (W - total) / 2 + (i % 3) * (CARD_W + CARD_GAP),
      y: AREA_CY - 20 + Math.floor(i / 3) * (CARD_H + CARD_GAP) - 60,
    };
  };

  const offTap = ctx.input.onTap((p: PointerInfo) => {
    if (hostPaused || !started || mode !== 'trial') return;
    const l = cv.toLocal(p);
    const now = ctx.now();
    if (door === 0) {
      // 第1: いつでも タップで 止める
      const r = ringRadius(now - trialStart, RINGS[trial]!.totalMs);
      ringStopped = r;
      if (ringOk(r, RINGS[trial]!)) {
        if (trial === PER_DOOR - 1) {
          tightAim = true;
          ctx.achieve('perfect-aim');
        }
        pass(now);
      } else {
        fail(now, r > RINGS[trial]!.bandHi ? 'early' : 'late');
      }
      return;
    }
    if (door === 1) {
      if (memPhase !== 'input') return;
      for (let i = 0; i < 9; i++) {
        const r = memRect(i);
        if (l.x < r.x || l.x > r.x + MEM_CELL || l.y < r.y || l.y > r.y + MEM_CELL) continue;
        if (memPicked.includes(i)) return;
        memPicked.push(i);
        if (!memCells.includes(i)) {
          fail(now, 'wrong-cell');
          return;
        }
        ctx.sfx('tap');
        if (memPicked.length >= memCells.length) pass(now);
        return;
      }
      return;
    }
    // 第3: カードを 2まい
    for (let i = 0; i < SUM_CARDS; i++) {
      const r = cardRect(i);
      if (l.x < r.x || l.x > r.x + CARD_W || l.y < r.y || l.y > r.y + CARD_H) continue;
      if (quizPicked.includes(i)) {
        quizPicked = quizPicked.filter((k) => k !== i);
        ctx.sfx('tap');
        return;
      }
      if (quizPicked.length >= 2) return;
      quizPicked.push(i);
      ctx.sfx('tap');
      if (quizPicked.length === 2) {
        const sum = quiz.nums[quizPicked[0]!]! + quiz.nums[quizPicked[1]!]!;
        if (sum === quiz.target) pass(now);
        else fail(now, `sum${sum}`);
      }
      return;
    }
  });

  // ---------- 毎フレーム ----------
  const offFrame = ctx.onFrame(() => {
    if (hostPaused || !started) return;
    const now = ctx.now();
    if (mode === 'intro' && now >= phaseUntil) {
      beginTrial(now);
    } else if (mode === 'trial') {
      const t = now - trialStart;
      if (door === 0) {
        if (t >= RINGS[trial]!.totalMs) {
          ringStopped = 0;
          fail(now, 'timeup');
        }
      } else if (door === 1) {
        if (memPhase === 'show' && t >= MEM_SHOW_MS[trial]!) {
          memPhase = 'input';
          ctx.sfx('start');
        } else if (memPhase === 'input' && t >= MEM_SHOW_MS[trial]! + MEM_INPUT_MS) {
          fail(now, 'timeup');
        }
      } else if (t >= SUM_MS) {
        fail(now, 'timeup');
      }
    } else if ((mode === 'ok' || mode === 'ng') && now >= phaseUntil) {
      afterPhase(now);
    } else if (mode === 'done' && !ended && now >= phaseUntil) {
      ended = true;
      ctx.end({ score });
      return;
    }
    draw(now);
    setData();
  });

  function finish(now: number): void {
    if (passed >= DOORS * PER_DOOR) {
      score += ALL_BONUS;
      if (misses === 0) ctx.achieve('no-miss');
    }
    if (score >= SCORE_HI) ctx.achieve('score-hi');
    mode = 'done';
    phaseUntil = now + END_DELAY;
    ctx.sfx('medal');
    lastEvent = `finish:${score}:${passed}`;
  }

  function setData(): void {
    if (!import.meta.env.DEV) return;
    const r = ctx.root as HTMLElement;
    r.dataset.mode = mode;
    r.dataset.door = String(door);
    r.dataset.trial = String(trial);
    r.dataset.t = String(Math.round(ctx.now() - trialStart));
    r.dataset.ring = mode === 'trial' && door === 0 ? ringRadius(ctx.now() - trialStart, RINGS[trial]!.totalMs).toFixed(1) : '-';
    r.dataset.band = door === 0 ? `${RINGS[trial]!.bandLo}-${RINGS[trial]!.bandHi}` : '-';
    r.dataset.mem = door === 1 ? memCells.join(',') : '-';
    r.dataset.memphase = door === 1 ? memPhase : '-';
    r.dataset.picked = door === 1 ? memPicked.join(',') : quizPicked.join(',');
    r.dataset.nums = door === 2 ? quiz.nums.join(',') : '-';
    r.dataset.target = door === 2 ? String(quiz.target) : '-';
    r.dataset.pair = door === 2 ? quiz.pair.join(',') : '-';
    r.dataset.tries = String(triesLeft);
    r.dataset.doorpasses = String(doorPasses);
    r.dataset.passed = String(passed);
    r.dataset.misses = String(misses);
    r.dataset.tight = tightAim ? '1' : '0';
    r.dataset.score = String(score);
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

  function drawDoorIcon(cx: number, cy: number, open: boolean): void {
    g.fillStyle = open ? C_GOLD : C_PANEL;
    roundRect(cx - 34, cy - 48, 68, 96, 10);
    g.fill();
    g.strokeStyle = C_GOLD;
    g.lineWidth = 3;
    roundRect(cx - 34, cy - 48, 68, 96, 10);
    g.stroke();
    if (open) {
      g.fillStyle = '#fff8dc';
      roundRect(cx - 22, cy - 34, 44, 68, 6);
      g.fill();
    } else {
      g.fillStyle = C_GOLD;
      g.beginPath();
      g.arc(cx + 18, cy, 4.5, 0, Math.PI * 2);
      g.fill();
    }
  }

  function draw(now: number): void {
    cv.clear(C_BG);
    const t = now - trialStart;

    // HUD
    g.fillStyle = '#0b0812';
    g.fillRect(0, 0, W, HUD_H);
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.fillStyle = C_TEXT;
    g.font = 'bold 18px sans-serif';
    g.fillText(`${score}てん`, 12, HUD_H / 2);
    g.fillStyle = C_DIM;
    g.font = 'bold 13px sans-serif';
    g.fillText(`とびら ${Math.min(door + 1, DOORS)}/${DOORS}`, 116, HUD_H / 2 - 8);
    g.fillText(`試練 ${Math.min(trial + 1, PER_DOOR)}/${PER_DOOR}`, 116, HUD_H / 2 + 9);
    g.textAlign = 'right';
    // この試練に のこっている ちょうせん回数（通しの ライフでは ない＝つぎの試練で 戻る）
    g.fillStyle = C_DIM;
    g.font = 'bold 11px sans-serif';
    g.fillText('のこり', W - 12, HUD_H / 2 - 9);
    g.fillStyle = C_NG;
    g.font = 'bold 15px sans-serif';
    g.fillText('♥'.repeat(Math.max(0, triesLeft)), W - 12, HUD_H / 2 + 8);

    g.textAlign = 'center';

    if (mode === 'done') {
      const all = passed >= DOORS * PER_DOOR;
      for (let i = 0; i < DOORS; i++) drawDoorIcon(80 + i * 100, 210, all || i < door);
      g.fillStyle = all ? C_GOLD : C_TEXT;
      g.font = 'bold 26px sans-serif';
      g.fillText(all ? 'さいごの とびらが 開いた！' : `とびら ${door} つ ぶん とうたつ`, W / 2, 330);
      g.font = 'bold 34px sans-serif';
      g.fillStyle = C_GOLD;
      g.fillText(`${score}てん`, W / 2, 386);
      g.fillStyle = C_DIM;
      g.font = 'bold 14px sans-serif';
      g.fillText(`とっぱした 試練 ${passed} / ${DOORS * PER_DOOR}・しっぱい ${misses}かい`, W / 2, 428);
      if (all) {
        g.fillStyle = C_TEXT;
        g.font = 'bold 15px sans-serif';
        g.fillText('130ばんめの ゲーム、おつかれさま！', W / 2, 470);
      }
      return;
    }

    if (mode === 'intro') {
      drawDoorIcon(W / 2, 250, false);
      g.fillStyle = C_GOLD;
      g.font = 'bold 24px sans-serif';
      g.fillText(`第${door + 1}の とびら`, W / 2, 350);
      g.fillStyle = C_TEXT;
      g.font = 'bold 18px sans-serif';
      g.fillText(DOOR_NAMES[door]!, W / 2, 388);
      g.fillStyle = C_DIM;
      g.font = 'bold 13px sans-serif';
      g.fillText(
        door === 0
          ? 'ちぢむ わを、みどりの はばで 止めよう'
          : door === 1
            ? '光った マスを おぼえて、ぜんぶ タップ'
            : `合計が お題に なる カード 2まいを えらぶ`,
        W / 2,
        426,
      );
      g.fillText(`${PER_DOOR}かい つづけて とっぱ すると 開く`, W / 2, 452);
      return;
    }

    // 試練ごとの 中身
    if (door === 0) {
      const tr = RINGS[trial]!;
      const r = mode === 'trial' ? ringRadius(t, tr.totalMs) : Math.max(0, ringStopped);
      g.fillStyle = C_DIM;
      g.font = 'bold 14px sans-serif';
      g.fillText('ちぢむ わを みどりの はばで タップ', W / 2, 110);
      // はば
      g.strokeStyle = 'rgba(90,208,138,.85)';
      g.lineWidth = tr.bandHi - tr.bandLo;
      g.beginPath();
      g.arc(W / 2, AREA_CY, (tr.bandLo + tr.bandHi) / 2, 0, Math.PI * 2);
      g.stroke();
      // 外の めやす
      g.strokeStyle = 'rgba(163,148,192,.25)';
      g.lineWidth = 2;
      g.beginPath();
      g.arc(W / 2, AREA_CY, RING_R0, 0, Math.PI * 2);
      g.stroke();
      // ちぢむ わ
      g.strokeStyle = mode === 'ng' ? C_NG : mode === 'ok' ? C_OK : C_RING;
      g.lineWidth = 5;
      g.beginPath();
      g.arc(W / 2, AREA_CY, Math.max(1, r), 0, Math.PI * 2);
      g.stroke();
      g.fillStyle = C_DIM;
      g.font = 'bold 12px sans-serif';
      g.fillText(`はば ${tr.bandLo}〜${tr.bandHi}`, W / 2, AREA_CY + RING_R0 + 26);
    } else if (door === 1) {
      g.fillStyle = C_DIM;
      g.font = 'bold 14px sans-serif';
      g.fillText(memPhase === 'show' ? 'よく見て おぼえよう' : `光った ${memCells.length}マスを タップ`, W / 2, 110);
      for (let i = 0; i < 9; i++) {
        const r = memRect(i);
        const lit = memPhase === 'show' && memCells.includes(i);
        const done = memPicked.includes(i);
        const reveal = (mode === 'ng' || mode === 'ok') && memCells.includes(i);
        g.fillStyle = lit || reveal ? C_GOLD : done ? C_OK : C_PANEL;
        roundRect(r.x, r.y, MEM_CELL, MEM_CELL, 12);
        g.fill();
        g.strokeStyle = 'rgba(163,148,192,.35)';
        g.lineWidth = 2;
        roundRect(r.x, r.y, MEM_CELL, MEM_CELL, 12);
        g.stroke();
      }
      if (memPhase === 'input' && mode === 'trial') {
        g.fillStyle = C_DIM;
        g.font = 'bold 12px sans-serif';
        g.fillText(`のこり ${memCells.length - memPicked.length}マス`, W / 2, AREA_CY + 160);
        // のこり時間（第3の試練と 同じ 見せ方。時間切れが あるので 見えるように する）
        const leftM = Math.max(0, 1 - (t - MEM_SHOW_MS[trial]!) / MEM_INPUT_MS);
        g.fillStyle = 'rgba(163,148,192,.22)';
        roundRect(60, 480, 240, 8, 4);
        g.fill();
        g.fillStyle = leftM > 0.3 ? C_OK : C_NG;
        roundRect(60, 480, 240 * leftM, 8, 4);
        g.fill();
      }
    } else {
      g.fillStyle = C_DIM;
      g.font = 'bold 14px sans-serif';
      g.fillText('合計が お題に なる 2まいを えらぶ', W / 2, 110);
      g.fillStyle = C_GOLD;
      g.font = 'bold 40px sans-serif';
      g.fillText(String(quiz.target), W / 2, 168);
      for (let i = 0; i < SUM_CARDS; i++) {
        const r = cardRect(i);
        const on = quizPicked.includes(i);
        const ans = (mode === 'ng' || mode === 'ok') && quiz.pair.includes(i);
        g.fillStyle = ans ? 'rgba(90,208,138,.25)' : on ? 'rgba(255,213,74,.22)' : C_PANEL;
        roundRect(r.x, r.y, CARD_W, CARD_H, 12);
        g.fill();
        g.strokeStyle = ans ? C_OK : on ? C_GOLD : 'rgba(163,148,192,.35)';
        g.lineWidth = on || ans ? 3.4 : 2;
        roundRect(r.x, r.y, CARD_W, CARD_H, 12);
        g.stroke();
        g.fillStyle = C_TEXT;
        g.font = 'bold 30px sans-serif';
        g.fillText(String(quiz.nums[i]), r.x + CARD_W / 2, r.y + CARD_H / 2 + 2);
      }
      if (mode === 'trial') {
        const left = Math.max(0, 1 - t / SUM_MS);
        g.fillStyle = 'rgba(163,148,192,.22)';
        roundRect(60, 480, 240, 8, 4);
        g.fill();
        g.fillStyle = left > 0.3 ? C_OK : C_NG;
        roundRect(60, 480, 240 * left, 8, 4);
        g.fill();
      }
    }

    // ようす
    g.font = 'bold 17px sans-serif';
    if (mode === 'ok') {
      g.fillStyle = C_OK;
      g.fillText(`とっぱ！ +${trialPoints(door)}てん`, W / 2, 546);
    } else if (mode === 'ng') {
      g.fillStyle = C_NG;
      g.fillText(triesLeft > 0 ? 'しっぱい… もう一度' : 'しっぱい… つぎの 試練へ', W / 2, 546);
    } else {
      g.fillStyle = C_DIM;
      g.font = 'bold 13px sans-serif';
      g.fillText(`${DOOR_NAMES[door]}・試練 ${trial + 1}／${PER_DOOR}`, W / 2, 546);
    }
    g.fillStyle = C_DIM;
    g.font = 'bold 11px sans-serif';
    g.fillText('しっぱいすると ライフが へる（3つまで）', W / 2, 596);
    g.fillText('3つの とびらを ぜんぶ あけたら…？', W / 2, 618);
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
