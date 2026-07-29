// =============================================================
// ちえの たたかい（No.129・かくれゲーム）: 追手を 落とし穴へ 誘い込む
// =============================================================
// - 追手は かならず 自分に 近づく＝動きが 読める。落とし穴は よけないので 誘い込める。
// - 出題は BFS で「かならず 勝てる」ことを 確かめてある（＝理不尽さゼロ）。
//   手数は「最短＋3」まで。こえたら やり直し。
// - import してよいのは game-api（types / helpers）と、このフォルダ内（logic）だけ。
import type { GameContext, IGame } from '../../game-api/types';
import {
  COLS,
  EXTRA_MOVES,
  ROWS,
  STAGE_COUNT,
  type Dir,
  type Stage,
  type State,
  canMove,
  isWin,
  makeStages,
  stageScore,
  turn,
} from './logic';

const W = 360;
const H = 640;
const HUD_H = 46;

const CELL = 60;
const GRID_Y = 170;
const RETRY_BTN = { x: 110, y: 540, w: 140, h: 46 };

const CLEAR_MS = 1500;
const FAIL_MS = 1500;
const END_DELAY = 2600;
const SCORE_HI = 800;

const C_BG = '#1a1420';
const C_FLOOR = '#2a2033';
const C_PIT = '#08050c';
const C_TEXT = '#f2ecf8';
const C_DIM = '#a494b8';
const C_ME = '#4ad0b0';
const C_CHASER = '#e0607a';
const C_OK = '#5ad08a';
const C_NG = '#e0483c';
const C_ACC = '#ffd54a';

type Mode = 'play' | 'cleared' | 'failed' | 'done';

export function createGame(ctx: GameContext): IGame {
  const cv = ctx.canvas2d({ design: { w: W, h: H } });
  const g = cv.ctx;

  const stages: Stage[] = makeStages(ctx.random);
  let stageIdx = 0;
  let stage: Stage = stages[0]!;
  let st: State = { me: stage.start, cs: stage.chasers.slice() };
  let moves = 0;
  let mode: Mode = 'play';
  let started = false;
  let hostPaused = false;
  let ended = false;
  let score = 0;
  let cleared = 0;
  let parRuns = 0;
  let attempts = 1;
  let phaseUntil = 0;
  let noteUntil = 0;
  let lastEvent = '';

  const limit = (): number => stage.par + EXTRA_MOVES;

  function loadStage(i: number): void {
    stageIdx = i;
    stage = stages[i]!;
    st = { me: stage.start, cs: stage.chasers.slice() };
    moves = 0;
    attempts = 1;
    mode = 'play';
    lastEvent = `stage:${i}:par${stage.par}`;
  }

  function resetStage(): void {
    st = { me: stage.start, cs: stage.chasers.slice() };
    moves = 0;
    attempts++;
    mode = 'play';
  }

  // ---------- レイアウト ----------
  const cellXY = (i: number): { x: number; y: number } => ({
    x: (W - COLS * CELL) / 2 + (i % COLS) * CELL,
    y: GRID_Y + Math.floor(i / COLS) * CELL,
  });
  const inRect = (p: { x: number; y: number }, r: { x: number; y: number; w: number; h: number }): boolean =>
    p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;

  // ---------- 入力 ----------
  function move(dir: Dir): void {
    if (mode !== 'play') return;
    const now = ctx.now();
    if (!canMove(stage, st.me, dir)) {
      noteUntil = now + 900;
      ctx.sfx('fail');
      lastEvent = `blocked:${dir}`;
      return;
    }
    const res = turn(stage, st, dir);
    moves++;
    ctx.sfx('tap');
    lastEvent = `move:${dir}:${moves}`;
    if (isWin(st)) {
      const pts = stageScore(moves, stage.par);
      score += pts;
      cleared++;
      if (moves <= stage.par) {
        parRuns++;
        ctx.achieve('par-clear');
      }
      if (cleared === 1) ctx.achieve('first-win');
      if (cleared >= 2) ctx.achieve('half');
      if (stage.chasers.length >= 3) ctx.achieve('three-chasers');
      mode = 'cleared';
      phaseUntil = now + CLEAR_MS;
      ctx.sfx('medal');
      ctx.haptic('success');
      lastEvent = `clear:${stageIdx}:${pts}:${moves}/${stage.par}`;
    } else if (res === 'caught') {
      mode = 'failed';
      phaseUntil = now + FAIL_MS;
      ctx.sfx('fail');
      ctx.haptic('error');
      lastEvent = `caught:${stageIdx}`;
    } else if (moves >= limit()) {
      mode = 'failed';
      phaseUntil = now + FAIL_MS;
      ctx.sfx('fail');
      lastEvent = `over:${stageIdx}`;
    }
  }

  const offSwipe = ctx.input.onSwipe((dir) => {
    if (hostPaused || !started) return;
    move(dir);
  });
  const offTap = ctx.input.onTap((p) => {
    if (hostPaused || !started || mode !== 'play') return;
    if (inRect(cv.toLocal(p), RETRY_BTN)) {
      resetStage();
      ctx.sfx('tap');
      lastEvent = `retry:${attempts}`;
    }
  });

  // ---------- 毎フレーム ----------
  const offFrame = ctx.onFrame(() => {
    if (hostPaused || !started) return;
    const now = ctx.now();
    if (mode === 'cleared' && now >= phaseUntil) {
      if (stageIdx + 1 >= STAGE_COUNT) finish(now);
      else loadStage(stageIdx + 1);
    } else if (mode === 'failed' && now >= phaseUntil) {
      resetStage();
    } else if (mode === 'done' && !ended && now >= phaseUntil) {
      ended = true;
      ctx.end({ score });
      return;
    }
    draw(now);
    setData();
  });

  function finish(now: number): void {
    if (parRuns >= STAGE_COUNT) ctx.achieve('all-par');
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
    r.dataset.pits = stage.pits.map((v) => (v ? '1' : '0')).join('');
    r.dataset.me = String(st.me);
    r.dataset.cs = st.cs.join(',');
    r.dataset.par = String(stage.par);
    r.dataset.moves = String(moves);
    r.dataset.limit = String(limit());
    r.dataset.attempts = String(attempts);
    r.dataset.score = String(score);
    r.dataset.cleared = String(cleared);
    r.dataset.parruns = String(parRuns);
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

  function draw(now: number): void {
    cv.clear(C_BG);

    // HUD
    g.fillStyle = '#120d17';
    g.fillRect(0, 0, W, HUD_H);
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.fillStyle = C_TEXT;
    g.font = 'bold 18px sans-serif';
    g.fillText(`${score}てん`, 12, HUD_H / 2);
    g.fillStyle = C_DIM;
    g.font = 'bold 13px sans-serif';
    g.fillText(`ステージ ${Math.min(stageIdx + 1, STAGE_COUNT)}/${STAGE_COUNT}`, 116, HUD_H / 2 - 8);
    g.fillText(`さいたん ${parRuns}かい`, 116, HUD_H / 2 + 9);

    g.textAlign = 'center';

    if (mode === 'done') {
      g.fillStyle = C_TEXT;
      g.font = 'bold 26px sans-serif';
      g.fillText('ぜんぶ おとした！', W / 2, 280);
      g.font = 'bold 34px sans-serif';
      g.fillStyle = C_ME;
      g.fillText(`${score}てん`, W / 2, 336);
      g.fillStyle = C_DIM;
      g.font = 'bold 14px sans-serif';
      g.fillText(`さいたん手数 ${parRuns} / ${STAGE_COUNT} ステージ`, W / 2, 380);
      return;
    }

    // といかけ
    g.fillStyle = C_DIM;
    g.font = 'bold 13px sans-serif';
    g.fillText('追手を 落とし穴へ 誘い込もう（スワイプで 1マス）', W / 2, 74);
    g.fillStyle = moves >= limit() ? C_NG : C_TEXT;
    g.font = 'bold 17px sans-serif';
    g.fillText(`手数 ${moves} / ${limit()}（さいたん ${stage.par}）`, W / 2, 102);
    g.fillStyle = C_DIM;
    g.font = 'bold 12px sans-serif';
    g.fillText(`のこりの 追手 ${st.cs.filter((c) => c >= 0).length}人`, W / 2, 128);

    // 盤
    for (let i = 0; i < COLS * ROWS; i++) {
      const { x, y } = cellXY(i);
      const pit = stage.pits[i];
      g.fillStyle = pit ? C_PIT : C_FLOOR;
      roundRect(x + 2, y + 2, CELL - 4, CELL - 4, pit ? 26 : 8);
      g.fill();
      if (pit) {
        g.strokeStyle = 'rgba(255,255,255,.14)';
        g.lineWidth = 2;
        roundRect(x + 2, y + 2, CELL - 4, CELL - 4, 26);
        g.stroke();
      }
    }
    // 追手
    for (const c of st.cs) {
      if (c < 0) continue;
      const { x, y } = cellXY(c);
      const cx = x + CELL / 2;
      const cy = y + CELL / 2;
      g.fillStyle = C_CHASER;
      g.beginPath();
      g.arc(cx, cy, 20, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#3a0a16';
      g.beginPath();
      g.arc(cx - 6, cy - 4, 3, 0, Math.PI * 2);
      g.arc(cx + 6, cy - 4, 3, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = '#3a0a16';
      g.lineWidth = 2.4;
      g.beginPath();
      g.moveTo(cx - 7, cy + 8);
      g.lineTo(cx + 7, cy + 8);
      g.stroke();
    }
    // じぶん
    {
      const { x, y } = cellXY(st.me);
      const cx = x + CELL / 2;
      const cy = y + CELL / 2;
      g.fillStyle = mode === 'failed' ? C_NG : C_ME;
      g.beginPath();
      g.arc(cx, cy, 21, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#07231d';
      g.beginPath();
      g.arc(cx - 6, cy - 4, 3.2, 0, Math.PI * 2);
      g.arc(cx + 6, cy - 4, 3.2, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = '#07231d';
      g.lineWidth = 2.4;
      g.beginPath();
      g.arc(cx, cy + 4, 6, 0.15 * Math.PI, 0.85 * Math.PI);
      g.stroke();
    }

    // ようす
    g.font = 'bold 16px sans-serif';
    if (mode === 'cleared') {
      g.fillStyle = C_OK;
      g.fillText(`クリア！ +${stageScore(moves, stage.par)}てん`, W / 2, 500);
    } else if (mode === 'failed') {
      g.fillStyle = C_NG;
      g.fillText(lastEvent.startsWith('caught') ? 'つかまった… もう一度' : '手数が つきた… もう一度', W / 2, 500);
    } else if (now < noteUntil) {
      g.fillStyle = C_NG;
      g.fillText('そっちへは 行けない（そと か 落とし穴）', W / 2, 500);
    } else {
      g.fillStyle = C_ACC;
      g.font = 'bold 13px sans-serif';
      g.fillText('追手は かならず 近づいてくる。落とし穴は よけない', W / 2, 500);
    }

    // やりなおす
    g.fillStyle = mode === 'play' ? C_FLOOR : 'rgba(42,32,51,.5)';
    roundRect(RETRY_BTN.x, RETRY_BTN.y, RETRY_BTN.w, RETRY_BTN.h, 12);
    g.fill();
    g.strokeStyle = 'rgba(164,148,184,.45)';
    g.lineWidth = 1.6;
    roundRect(RETRY_BTN.x, RETRY_BTN.y, RETRY_BTN.w, RETRY_BTN.h, 12);
    g.stroke();
    g.fillStyle = C_TEXT;
    g.font = 'bold 16px sans-serif';
    g.fillText('⟲ はじめから', RETRY_BTN.x + RETRY_BTN.w / 2, RETRY_BTN.y + RETRY_BTN.h / 2);

    g.fillStyle = C_DIM;
    g.font = 'bold 11px sans-serif';
    g.fillText('じぶんは 落とし穴に 入れない（入ろうとしても 動かない）', W / 2, 606);
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
      offSwipe();
      offTap();
      offFrame();
    },
  };
}
