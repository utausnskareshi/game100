// =============================================================
// りょうてポリリズム（No.109・かくれゲーム）: 左右の手で ちがうリズムを同時に
// =============================================================
// - 高難度のねらい: 左右で周期がちがう（2:3 / 3:4 / 3:5 / 4:5）。
//   さらに ガイドは最初だけで、途中から画面も音も 何も出なくなる。
//   ＝自分の中のリズムだけが たより（#104 たいないどけい と同じ設計思想）。
// - 時間は ctx.now()（＝playedMs）だけを使う。ポーズ中は止まるので有利にならない。
// - import してよいのは game-api（types / helpers）と、このフォルダ内（logic）だけ。
import type { GameContext, IGame, PointerInfo } from '../../game-api/types';
import {
  BEAT_MS,
  EXTRA_PENALTY,
  INTRO_BEATS,
  OK_MS,
  PERFECT_MS,
  STAGES,
  type RhythmStage,
  beatsOf,
  judgePoints,
} from './logic';

const W = 360;
const H = 640;
const HUD_H = 46;

const LANE_Y = 300;
const LANE_R = 62;
const LX = 96;
const RX = 264;
const SPLIT_Y = 120;

const RESULT_MS = 1800;
const END_DELAY = 2400;
const SCORE_HI = 950;

const C_BG = '#12131f';
const C_LEFT = '#4aa3ff';
const C_RIGHT = '#ff8a4a';
const C_TEXT = '#eef1ff';
const C_DIM = '#8b90b4';
const C_OK = '#43c98a';
const C_NG = '#e0483c';
const C_ACC = '#ffd54a';

type Side = 'L' | 'R';
type Mode = 'count' | 'play' | 'result' | 'done';

interface Note {
  side: Side;
  beat: number;
  /** たたく時こく（ミリ秒・ctx.now と同じ時計） */
  at: number;
  /** 0=まだ 1=ぴったり 2=セーフ 3=みのがし */
  state: number;
  /** ガイドの音を鳴らしたか */
  ticked: boolean;
}

export function createGame(ctx: GameContext): IGame {
  const cv = ctx.canvas2d({ design: { w: W, h: H } });
  const g = cv.ctx;

  let stageIdx = 0;
  let stage: RhythmStage = STAGES[0]!;
  let notes: Note[] = [];
  let stageStart = 0;
  let stageEnd = 0;
  let mode: Mode = 'count';
  let started = false;
  let hostPaused = false;
  let ended = false;
  let score = 0;
  let perfects = 0;
  let oks = 0;
  let misses = 0;
  let extras = 0;
  let combo = 0;
  let bestCombo = 0;
  let blindPerfects = 0;
  let hitL = 0;
  let hitR = 0;
  let stagePerfects = 0;
  let stageMiss = 0;
  let stageExtra = 0;
  let cleanStages = 0;
  /** 直前の判定（表示用） */
  let flashSide: Side = 'L';
  let flashKind = 0;
  let flashUntil = 0;
  let phaseUntil = 0;
  let lastEvent = '';

  function loadStage(i: number, now: number): void {
    stageIdx = i;
    stage = STAGES[i]!;
    stageStart = now + INTRO_BEATS * BEAT_MS;
    stageEnd = stageStart + stage.beats * BEAT_MS;
    notes = [];
    for (const b of beatsOf(stage.left, stage.beats)) {
      notes.push({ side: 'L', beat: b, at: stageStart + b * BEAT_MS, state: 0, ticked: false });
    }
    for (const b of beatsOf(stage.right, stage.beats)) {
      notes.push({ side: 'R', beat: b, at: stageStart + b * BEAT_MS, state: 0, ticked: false });
    }
    notes.sort((a, b) => a.at - b.at);
    stagePerfects = 0;
    stageMiss = 0;
    stageExtra = 0;
    mode = 'count';
    lastEvent = `stage:${i}`;
  }

  /** ガイドが出ている時間か */
  const guideUntil = (): number => stageStart + stage.guideBeats * BEAT_MS;

  // ---------- 入力 ----------
  // ※ リズム判定は「押した瞬間」で行う（onTap は指を離した時に来るので、
  //   押している時間ぶん すべての判定が遅れてしまう。既存のリズム系2本と同じ作法）
  const offDown = ctx.input.onDown((p: PointerInfo) => {
    if (hostPaused || !started || mode !== 'play') return;
    const l = cv.toLocal(p);
    if (l.y < SPLIT_Y) return; // うえの せつめい部分は 反応しない
    const side: Side = l.x < W / 2 ? 'L' : 'R';
    const now = ctx.now();
    // いちばん近い「まだ たたいていない」音符
    let target: Note | null = null;
    let bestD = Infinity;
    for (const n of notes) {
      if (n.side !== side || n.state !== 0) continue;
      const d = Math.abs(now - n.at);
      if (d < bestD) {
        bestD = d;
        target = n;
      }
    }
    if (!target || bestD > OK_MS) {
      // よけいな たたき
      extras++;
      stageExtra++;
      score = Math.max(0, score - EXTRA_PENALTY);
      combo = 0;
      flashSide = side;
      flashKind = 3;
      flashUntil = now + 320;
      ctx.sfx('fail');
      lastEvent = `extra:${side}`;
      return;
    }
    const pts = judgePoints(bestD);
    score += pts;
    if (pts === 20) {
      target.state = 1;
      perfects++;
      stagePerfects++;
      combo++;
      bestCombo = Math.max(bestCombo, combo);
      if (now > guideUntil()) blindPerfects++;
      if (side === 'L') hitL++;
      else hitR++;
      flashKind = 1;
      ctx.sfx('success');
      ctx.haptic('light');
      if (perfects === 1) ctx.achieve('first-perfect');
      if (hitL > 0 && hitR > 0) ctx.achieve('both-hands');
      if (blindPerfects >= 5) ctx.achieve('blind-5');
      if (combo >= 10) ctx.achieve('combo-10');
    } else {
      target.state = 2;
      oks++;
      combo = 0;
      if (side === 'L') hitL++;
      else hitR++;
      flashKind = 2;
      ctx.sfx('tap');
    }
    flashSide = side;
    flashUntil = now + 320;
    lastEvent = `${pts === 20 ? 'perfect' : 'ok'}:${side}:${Math.round(bestD)}`;
  });

  // ---------- 毎フレーム ----------
  const offFrame = ctx.onFrame(() => {
    if (hostPaused || !started) return;
    const now = ctx.now();
    if (mode === 'count') {
      if (now >= stageStart) {
        mode = 'play';
        lastEvent = `play:${stageIdx}`;
      }
    } else if (mode === 'play') {
      const gu = guideUntil();
      for (const n of notes) {
        // ガイドの間は 拍を 音で 知らせる
        if (!n.ticked && n.at <= gu && now >= n.at) {
          n.ticked = true;
          ctx.sfx('tick');
        }
        if (n.state === 0 && now > n.at + OK_MS) {
          n.state = 3;
          misses++;
          stageMiss++;
          combo = 0;
          lastEvent = `miss:${n.side}:${n.beat}`;
        }
      }
      if (now >= stageEnd + OK_MS) {
        if (stageMiss === 0 && stageExtra === 0) {
          cleanStages++;
          ctx.achieve('stage-perfect');
        }
        mode = 'result';
        phaseUntil = now + RESULT_MS;
        ctx.sfx('medal');
        lastEvent = `stage-end:${stageIdx}:${stagePerfects}`;
      }
    } else if (mode === 'result' && now >= phaseUntil) {
      if (stageIdx + 1 >= STAGES.length) finish(now);
      else loadStage(stageIdx + 1, now);
    } else if (mode === 'done' && !ended && now >= phaseUntil) {
      ended = true;
      ctx.end({ score });
      return;
    }
    draw(now);
    setData();
  });

  function finish(now: number): void {
    if (score >= SCORE_HI) ctx.achieve('score-hi');
    mode = 'done';
    phaseUntil = now + END_DELAY;
    ctx.sfx('medal');
    lastEvent = `finish:${score}:${perfects}`;
  }

  function setData(): void {
    if (!import.meta.env.DEV) return;
    const r = ctx.root as HTMLElement;
    r.dataset.mode = mode;
    r.dataset.stage = String(stageIdx);
    r.dataset.score = String(score);
    r.dataset.perfects = String(perfects);
    r.dataset.oks = String(oks);
    r.dataset.misses = String(misses);
    r.dataset.extras = String(extras);
    r.dataset.combo = String(combo);
    r.dataset.best = String(bestCombo);
    r.dataset.blind = String(blindPerfects);
    r.dataset.clean = String(cleanStages);
    r.dataset.start = String(Math.round(stageStart));
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

  /** つぎに たたく音符（ガイド用） */
  function nextNote(side: Side, now: number): Note | null {
    let best: Note | null = null;
    for (const n of notes) {
      if (n.side !== side || n.state !== 0) continue;
      if (n.at < now - OK_MS) continue;
      if (!best || n.at < best.at) best = n;
    }
    return best;
  }

  function drawLane(side: Side, now: number, guide: boolean): void {
    const cx = side === 'L' ? LX : RX;
    const col = side === 'L' ? C_LEFT : C_RIGHT;
    // 近づいてくる わ（ガイドの間だけ）
    if (guide && mode === 'play') {
      const n = nextNote(side, now);
      if (n) {
        const left = n.at - now;
        const t = Math.max(0, Math.min(1, left / (BEAT_MS * 2)));
        const rr = LANE_R + t * 46;
        g.strokeStyle = col;
        g.globalAlpha = 0.28 + (1 - t) * 0.5;
        g.lineWidth = 3;
        g.beginPath();
        g.arc(cx, LANE_Y, rr, 0, Math.PI * 2);
        g.stroke();
        g.globalAlpha = 1;
      }
    }
    // 本体
    const flashing = now < flashUntil && flashSide === side;
    g.fillStyle = flashing ? (flashKind === 1 ? C_OK : flashKind === 2 ? '#c9a94a' : C_NG) : 'rgba(255,255,255,.06)';
    g.beginPath();
    g.arc(cx, LANE_Y, LANE_R, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = col;
    g.lineWidth = 4;
    g.beginPath();
    g.arc(cx, LANE_Y, LANE_R, 0, Math.PI * 2);
    g.stroke();
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = C_TEXT;
    g.font = 'bold 20px sans-serif';
    g.fillText(side === 'L' ? 'ひだり' : 'みぎ', cx, LANE_Y - 12);
    g.fillStyle = C_DIM;
    g.font = 'bold 15px sans-serif';
    g.fillText(`${side === 'L' ? stage.left : stage.right}はく に 1かい`, cx, LANE_Y + 16);
  }

  function draw(now: number): void {
    cv.clear(C_BG);

    // HUD
    g.fillStyle = '#0a0b14';
    g.fillRect(0, 0, W, HUD_H);
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.fillStyle = C_TEXT;
    g.font = 'bold 18px sans-serif';
    g.fillText(`${score}てん`, 12, HUD_H / 2);
    g.fillStyle = C_DIM;
    g.font = 'bold 13px sans-serif';
    g.fillText(`ステージ ${Math.min(stageIdx + 1, STAGES.length)}/${STAGES.length}`, 116, HUD_H / 2 - 8);
    g.fillText(`ぴったり ${perfects}・れんぞく ${combo}`, 116, HUD_H / 2 + 9);

    g.textAlign = 'center';

    if (mode === 'done') {
      g.fillStyle = C_TEXT;
      g.font = 'bold 26px sans-serif';
      g.fillText('えんそう しゅうりょう！', W / 2, 268);
      g.font = 'bold 34px sans-serif';
      g.fillStyle = C_ACC;
      g.fillText(`${score}てん`, W / 2, 324);
      g.fillStyle = C_DIM;
      g.font = 'bold 14px sans-serif';
      g.fillText(`ぴったり ${perfects}・セーフ ${oks}・見のがし ${misses}`, W / 2, 368);
      g.fillText(`さいこう れんぞく ${bestCombo}かい`, W / 2, 392);
      return;
    }

    if (mode === 'result') {
      g.fillStyle = C_TEXT;
      g.font = 'bold 24px sans-serif';
      g.fillText(`ステージ ${stageIdx + 1} おわり`, W / 2, 250);
      g.fillStyle = stageMiss === 0 && stageExtra === 0 ? C_OK : C_DIM;
      g.font = 'bold 16px sans-serif';
      g.fillText(
        stageMiss === 0 && stageExtra === 0 ? 'ノーミス！ すばらしい' : `見のがし ${stageMiss}・よけい ${stageExtra}`,
        W / 2,
        292,
      );
      g.fillStyle = C_DIM;
      g.font = 'bold 14px sans-serif';
      g.fillText(`ぴったり ${stagePerfects}かい`, W / 2, 324);
      return;
    }

    // せつめい
    const guide = now <= guideUntil();
    g.fillStyle = C_DIM;
    g.font = 'bold 13px sans-serif';
    g.fillText('左半分＝ひだりの手・右半分＝みぎの手', W / 2, 72);
    if (mode === 'count') {
      const k = Math.min(INTRO_BEATS, Math.max(0, Math.floor((now - (stageStart - INTRO_BEATS * BEAT_MS)) / BEAT_MS) + 1));
      g.fillStyle = C_ACC;
      g.font = 'bold 22px sans-serif';
      g.fillText(`カウント ${k} / ${INTRO_BEATS}`, W / 2, 100);
    } else if (guide) {
      g.fillStyle = C_OK;
      g.font = 'bold 20px sans-serif';
      g.fillText('ガイド あり（音と わ）', W / 2, 100);
    } else {
      g.fillStyle = C_NG;
      g.font = 'bold 20px sans-serif';
      g.fillText('ガイド なし！ じぶんの リズムで', W / 2, 100);
    }

    // まん中の しきり
    g.strokeStyle = 'rgba(255,255,255,.10)';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(W / 2, SPLIT_Y);
    g.lineTo(W / 2, 596);
    g.stroke();

    drawLane('L', now, guide);
    drawLane('R', now, guide);

    // すすみ ぐあい
    if (mode === 'play') {
      const t = Math.max(0, Math.min(1, (now - stageStart) / (stage.beats * BEAT_MS)));
      g.fillStyle = 'rgba(139,144,180,.22)';
      roundRect(30, 470, 300, 8, 4);
      g.fill();
      g.fillStyle = guide ? C_OK : C_NG;
      roundRect(30, 470, 300 * t, 8, 4);
      g.fill();
    }

    // 判定の ことば
    if (now < flashUntil) {
      g.fillStyle = flashKind === 1 ? C_OK : flashKind === 2 ? C_ACC : C_NG;
      g.font = 'bold 22px sans-serif';
      g.fillText(flashKind === 1 ? 'ぴったり！' : flashKind === 2 ? 'セーフ' : 'いま じゃない', W / 2, 512);
    }

    g.fillStyle = C_DIM;
    g.font = 'bold 12px sans-serif';
    g.fillText('りょうての おやゆびで、べつべつの リズムを きざもう', W / 2, 566);
    g.font = 'bold 11px sans-serif';
    g.fillText(`ぴったり ±${PERFECT_MS}ミリびょう ／ セーフ ±${OK_MS}ミリびょう`, W / 2, 590);
  }

  draw(0);
  setData();

  return {
    start() {
      started = true;
      loadStage(0, ctx.now());
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
