// =============================================================
// ことばならべ（No.101・かくれゲーム）: ひらがなを並べて ことばを作る
// =============================================================
// - 絵文字のヒントを見て、バラバラのタイルをタップして こたえの並びを作る。全8問。
// - 出題は logic.makeQuizzes（rng 注入＝決定論）。こちらは描画・入力・採点だけ。
// - 難易度は「ふつう」: まちがえても やり直せる／ヒントの絵文字は出しっぱなし／
//   前半4問は3文字・後半4問は4文字。
// - import してよいのは game-api（types / helpers）と、このフォルダ内（logic）だけ。
import type { GameContext, IGame, PointerInfo } from '../../game-api/types';
import { clamp } from '../../game-api/helpers';
import { ROUNDS, type Quiz, makeQuizzes } from './logic';

const W = 360;
const H = 640;
const HUD_H = 46;
const SLOT_W = 58;
const SLOT_H = 66;
const SLOT_Y = 262;
const TILE_W = 62;
const TILE_H = 62;
const TILE_GAP = 10;
const TILE_Y = 384;
const OK_MS = 900;
const NG_MS = 700;
const END_DELAY = 2200;
const SCORE_HI = 900;
const SPEEDY_MS = 100000;

const C_BG = '#f3ead6';
const C_TEXT = '#4a3a1e';
const C_DIM = '#8a7550';
const C_HUD = '#3d2f1a';
const C_TILE = '#fffdf5';
const C_TILE_LINE = '#c2ac80';
const C_SLOT = '#e8dcc0';
const C_OK = '#2e8f4f';
const C_NG = '#e0483c';

type Mode = 'play' | 'ok' | 'ng' | 'done';

export function createGame(ctx: GameContext): IGame {
  const cv = ctx.canvas2d({ design: { w: W, h: H } });
  const g = cv.ctx;

  const quizzes: Quiz[] = makeQuizzes(ctx.random);
  let round = 0;
  let quiz: Quiz = quizzes[0]!;
  /** スロットに置いた文字（タイルの index。-1 は空き） */
  let slots: number[] = [];
  /** すでに置いたタイルか */
  let used: boolean[] = [];
  let mode: Mode = 'play';
  let started = false;
  let hostPaused = false;
  let ended = false;
  let score = 0;
  let solved = 0;
  let miss = 0;
  let missHere = 0;
  let phaseUntil = 0;
  let startAt = 0;
  let lastEvent = '';

  function loadRound(i: number): void {
    round = i;
    quiz = quizzes[i]!;
    slots = new Array<number>(quiz.answer.length).fill(-1);
    used = new Array<boolean>(quiz.tiles.length).fill(false);
    missHere = 0;
    mode = 'play';
  }
  loadRound(0);

  // ---------- レイアウト ----------
  const slotRect = (i: number): { x: number; y: number; w: number; h: number } => {
    const n = quiz.answer.length;
    const total = n * SLOT_W + (n - 1) * 8;
    return { x: (W - total) / 2 + i * (SLOT_W + 8), y: SLOT_Y, w: SLOT_W, h: SLOT_H };
  };
  const tileRect = (i: number): { x: number; y: number; w: number; h: number } => {
    const n = quiz.tiles.length;
    const total = n * TILE_W + (n - 1) * TILE_GAP;
    return { x: (W - total) / 2 + i * (TILE_W + TILE_GAP), y: TILE_Y, w: TILE_W, h: TILE_H };
  };
  const inRect = (p: { x: number; y: number }, r: { x: number; y: number; w: number; h: number }): boolean =>
    p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;

  // ---------- 入力 ----------
  function placeTile(ti: number): void {
    if (mode !== 'play' || used[ti]) return;
    const empty = slots.indexOf(-1);
    if (empty < 0) return;
    slots[empty] = ti;
    used[ti] = true;
    ctx.sfx('tap');
    lastEvent = `place:${ti}`;
    if (slots.every((s) => s >= 0)) judge();
  }

  function removeSlot(si: number): void {
    if (mode !== 'play') return;
    const ti = slots[si] ?? -1;
    if (ti < 0) return;
    slots[si] = -1;
    used[ti] = false;
    ctx.sfx('tap');
    lastEvent = `remove:${si}`;
  }

  function judge(): void {
    const made = slots.map((s) => quiz.tiles[s] ?? '').join('');
    const now = ctx.now();
    if (made === quiz.answer) {
      // 1問120点。まちがえた回数ぶん少し減るが、40点は必ず残る（やさしさ優先）
      const pts = Math.max(40, 120 - missHere * 20);
      score += pts;
      solved++;
      mode = 'ok';
      phaseUntil = now + OK_MS;
      ctx.sfx('success');
      ctx.haptic('success');
      if (solved === 1) ctx.achieve('first-word');
      if (solved >= 4) ctx.achieve('half');
      lastEvent = `ok:${round}:${pts}`;
    } else {
      miss++;
      missHere++;
      mode = 'ng';
      phaseUntil = now + NG_MS;
      ctx.sfx('fail');
      ctx.haptic('error');
      lastEvent = `ng:${round}:${missHere}`;
    }
  }

  const offTap = ctx.input.onTap((p: PointerInfo) => {
    if (hostPaused || !started || mode !== 'play') return;
    const l = cv.toLocal(p);
    for (let i = 0; i < slots.length; i++) {
      if (inRect(l, slotRect(i))) {
        removeSlot(i);
        return;
      }
    }
    for (let i = 0; i < quiz.tiles.length; i++) {
      if (!used[i] && inRect(l, tileRect(i))) {
        placeTile(i);
        return;
      }
    }
  });

  // ---------- 毎フレーム ----------
  const offFrame = ctx.onFrame(() => {
    if (hostPaused || !started) return;
    const now = ctx.now();
    if (mode === 'ng' && now >= phaseUntil) {
      // まちがえたら置いたぶんを戻して やり直し（減点だけで先へは進めない＝あきらめずに解ける）
      slots = slots.map(() => -1);
      used = used.map(() => false);
      mode = 'play';
    } else if (mode === 'ok' && now >= phaseUntil) {
      if (round + 1 >= ROUNDS) finish(now);
      else loadRound(round + 1);
    } else if (mode === 'done' && !ended && now >= phaseUntil) {
      ended = true;
      ctx.end({ score });
      return;
    }
    draw();
    setData();
  });

  function finish(now: number): void {
    const usedMs = now - startAt;
    // 速さボーナス（180秒より速いぶんだけ）と全問ボーナス
    score += Math.max(0, Math.round((180000 - usedMs) / 1000)) * 2;
    if (solved >= ROUNDS) {
      score += 100;
      ctx.achieve('all-clear');
      if (miss === 0) ctx.achieve('no-miss');
      if (usedMs <= SPEEDY_MS) ctx.achieve('speedy');
    }
    if (score >= SCORE_HI) ctx.achieve('score-hi');
    mode = 'done';
    phaseUntil = now + END_DELAY;
    ctx.sfx('medal');
    lastEvent = `finish:${score}:${solved}/${ROUNDS}`;
  }

  function setData(): void {
    if (!import.meta.env.DEV) return;
    const r = ctx.root as HTMLElement;
    r.dataset.mode = mode;
    r.dataset.round = String(round);
    r.dataset.answer = quiz.answer;
    r.dataset.tiles = quiz.tiles.join('');
    r.dataset.slots = slots.join(',');
    r.dataset.score = String(score);
    r.dataset.solved = String(solved);
    r.dataset.miss = String(miss);
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
    g.fillStyle = '#ffe6b0';
    g.font = 'bold 13px sans-serif';
    g.fillText(`もんだい ${Math.min(round + 1, ROUNDS)}/${ROUNDS}`, 116, HUD_H / 2 - 8);
    g.fillText(`せいかい ${solved}・ミス ${miss}`, 116, HUD_H / 2 + 9);

    if (mode === 'done') {
      g.textAlign = 'center';
      g.fillStyle = C_TEXT;
      g.font = 'bold 26px sans-serif';
      g.fillText(`${solved} / ${ROUNDS} もん せいかい！`, W / 2, 300);
      g.font = 'bold 34px sans-serif';
      g.fillStyle = C_OK;
      g.fillText(`${score}てん`, W / 2, 356);
      g.fillStyle = C_DIM;
      g.font = 'bold 14px sans-serif';
      g.fillText(miss === 0 ? 'ノーミス！ すばらしい' : 'おつかれさま！', W / 2, 400);
      return;
    }

    // ヒントの絵文字
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = '76px sans-serif';
    g.fillText(quiz.emoji, W / 2, 150);
    g.fillStyle = C_DIM;
    g.font = 'bold 13px sans-serif';
    g.fillText('ヒントの え を見て、したの もじを ならべよう', W / 2, 214);

    // スロット
    for (let i = 0; i < slots.length; i++) {
      const r = slotRect(i);
      const ti = slots[i] ?? -1;
      g.fillStyle = mode === 'ng' ? '#f6d9d4' : mode === 'ok' ? '#d9f0e0' : C_SLOT;
      roundRect(r.x, r.y, r.w, r.h, 10);
      g.fill();
      g.strokeStyle = mode === 'ng' ? C_NG : mode === 'ok' ? C_OK : C_TILE_LINE;
      g.lineWidth = 2;
      roundRect(r.x, r.y, r.w, r.h, 10);
      g.stroke();
      if (ti >= 0) {
        g.fillStyle = C_TEXT;
        g.font = 'bold 34px sans-serif';
        g.fillText(quiz.tiles[ti] ?? '', r.x + r.w / 2, r.y + r.h / 2 + 2);
      }
    }

    // タイル
    for (let i = 0; i < quiz.tiles.length; i++) {
      const r = tileRect(i);
      if (used[i]) {
        g.setLineDash([4, 3]);
        g.strokeStyle = 'rgba(122,100,66,.35)';
        g.lineWidth = 1.4;
        roundRect(r.x, r.y, r.w, r.h, 10);
        g.stroke();
        g.setLineDash([]);
        continue;
      }
      g.fillStyle = C_TILE;
      roundRect(r.x, r.y, r.w, r.h, 10);
      g.fill();
      g.strokeStyle = C_TILE_LINE;
      g.lineWidth = 2;
      roundRect(r.x, r.y, r.w, r.h, 10);
      g.stroke();
      g.fillStyle = C_TEXT;
      g.font = 'bold 34px sans-serif';
      g.fillText(quiz.tiles[i] ?? '', r.x + r.w / 2, r.y + r.h / 2 + 2);
    }

    // メッセージ
    g.font = 'bold 15px sans-serif';
    if (mode === 'ok') {
      g.fillStyle = C_OK;
      g.fillText('せいかい！', W / 2, 500);
    } else if (mode === 'ng') {
      g.fillStyle = C_NG;
      g.fillText('うーん、ちがうみたい', W / 2, 500);
    } else {
      g.fillStyle = C_DIM;
      g.fillText('もじを タップ／ならべた もじを タップで もどす', W / 2, 500);
    }

    // 進み具合
    const doneW = clamp(round / ROUNDS, 0, 1);
    g.fillStyle = 'rgba(122,100,66,.18)';
    roundRect(40, 552, W - 80, 10, 5);
    g.fill();
    g.fillStyle = C_OK;
    roundRect(40, 552, (W - 80) * doneW, 10, 5);
    g.fill();
  }

  draw();
  setData();

  return {
    start() {
      started = true;
      startAt = ctx.now();
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
