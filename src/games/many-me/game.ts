// =============================================================
// ふえる わたし（No.123・かくれゲーム）: スワイプで 分身ぜんぶが 同じ方向へ
// =============================================================
// - ねらい: #99 かがみワールドは「2人が 左右 反対に 動く」。こちらは
//   「N人が 同じ方向に 動き、かべで ズレていく」。ぜんいんを ゴールへ。
// - 分身どうしは かさならない（前が つまれば 後ろも 止まる）＝詰みが 出ない。
// - 手数は「最短＋2」まで。こえたら やり直し。
// - import してよいのは game-api（types / helpers）と、このフォルダ内（logic）だけ。
import type { GameContext, IGame } from '../../game-api/types';
import { EXTRA_MOVES, STAGES, type Dir, type Stage, isSolved, makeStages, stageScore, step } from './logic';

const W = 360;
const H = 640;
const HUD_H = 46;

const CELL = 48;
const GRID_Y = 150;
const RETRY_BTN = { x: 110, y: 540, w: 140, h: 46 };

const CLEAR_MS = 1400;
const FAIL_MS = 1400;
const END_DELAY = 2600;
const SCORE_HI = 1000;

const C_BG = '#12202a';
const C_FLOOR = '#1e3340';
const C_WALL = '#0a1218';
const C_GOAL = '#3a6b52';
const C_TEXT = '#e9f5fa';
const C_DIM = '#8aa8b6';
const C_ME = '#4ad0b0';
const C_OK = '#43c98a';
const C_NG = '#e0483c';
const C_ACC = '#ffd54a';

type Mode = 'play' | 'cleared' | 'failed' | 'done';

export function createGame(ctx: GameContext): IGame {
  const cv = ctx.canvas2d({ design: { w: W, h: H } });
  const g = cv.ctx;

  const stages: Stage[] = makeStages(ctx.random);
  let stageIdx = 0;
  let stage: Stage = stages[0]!;
  let pos: number[] = stage.starts.slice();
  let moves = 0;
  let mode: Mode = 'play';
  let started = false;
  let hostPaused = false;
  let ended = false;
  let score = 0;
  let cleared = 0;
  let bestRuns = 0;
  let attempts = 1;
  let phaseUntil = 0;
  let lastEvent = '';

  const limit = (): number => stage.par + EXTRA_MOVES;

  function loadStage(i: number): void {
    stageIdx = i;
    stage = stages[i]!;
    pos = stage.starts.slice();
    moves = 0;
    attempts = 1;
    mode = 'play';
    lastEvent = `stage:${i}:par${stage.par}`;
  }

  function resetStage(countAttempt: boolean): void {
    pos = stage.starts.slice();
    moves = 0;
    if (countAttempt) attempts++;
    mode = 'play';
  }

  // ---------- レイアウト ----------
  const cellXY = (i: number): { x: number; y: number } => ({
    x: (W - stage.cols * CELL) / 2 + (i % stage.cols) * CELL,
    y: GRID_Y + Math.floor(i / stage.cols) * CELL,
  });
  const inRect = (p: { x: number; y: number }, r: { x: number; y: number; w: number; h: number }): boolean =>
    p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;

  // ---------- 入力 ----------
  function move(dir: Dir): void {
    if (mode !== 'play') return;
    const next = step(stage, pos, dir);
    if (next.every((v, i) => v === pos[i])) {
      // だれも 動けなかった（手数は へらさない）
      ctx.sfx('fail');
      lastEvent = `stuck:${dir}`;
      return;
    }
    pos = next;
    moves++;
    ctx.sfx('tap');
    lastEvent = `move:${dir}:${moves}`;
    const now = ctx.now();
    if (isSolved(stage, pos)) {
      const pts = stageScore(moves, stage.par);
      score += pts;
      cleared++;
      if (moves <= stage.par) {
        bestRuns++;
        ctx.achieve('shortest');
      }
      if (cleared === 1) ctx.achieve('first-clear');
      if (cleared >= 3) ctx.achieve('half');
      if (stage.starts.length >= 4) ctx.achieve('four-me');
      mode = 'cleared';
      phaseUntil = now + CLEAR_MS;
      ctx.sfx('medal');
      ctx.haptic('success');
      lastEvent = `clear:${stageIdx}:${pts}:${moves}/${stage.par}`;
    } else if (moves >= limit()) {
      mode = 'failed';
      phaseUntil = now + FAIL_MS;
      ctx.sfx('fail');
      ctx.haptic('error');
      lastEvent = `over:${stageIdx}:${moves}`;
    }
  }

  const offSwipe = ctx.input.onSwipe((dir) => {
    if (hostPaused || !started) return;
    move(dir);
  });
  const offTap = ctx.input.onTap((p) => {
    if (hostPaused || !started || mode !== 'play') return;
    if (inRect(cv.toLocal(p), RETRY_BTN)) {
      resetStage(true);
      ctx.sfx('tap');
      lastEvent = `retry:${attempts}`;
    }
  });

  // ---------- 毎フレーム ----------
  const offFrame = ctx.onFrame(() => {
    if (hostPaused || !started) return;
    const now = ctx.now();
    if (mode === 'cleared' && now >= phaseUntil) {
      if (stageIdx + 1 >= STAGES) finish(now);
      else loadStage(stageIdx + 1);
    } else if (mode === 'failed' && now >= phaseUntil) {
      resetStage(true);
    } else if (mode === 'done' && !ended && now >= phaseUntil) {
      ended = true;
      ctx.end({ score });
      return;
    }
    draw();
    setData();
  });

  function finish(now: number): void {
    // ※「ぜんぶクリア」は 実績にしない。このゲームは しっぱいしても やり直すだけで
    //   終わりに たどりつく＝つねに 成立してしまう（恒真）ため。
    if (bestRuns >= STAGES) ctx.achieve('all-shortest');
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
    r.dataset.size = `${stage.cols}x${stage.rows}`;
    r.dataset.walls = stage.walls.map((v) => (v ? '1' : '0')).join('');
    r.dataset.starts = stage.starts.join(',');
    r.dataset.goals = stage.goals.join(',');
    r.dataset.pos = pos.join(',');
    r.dataset.par = String(stage.par);
    r.dataset.moves = String(moves);
    r.dataset.limit = String(limit());
    r.dataset.attempts = String(attempts);
    r.dataset.score = String(score);
    r.dataset.cleared = String(cleared);
    r.dataset.shortest = String(bestRuns);
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
    g.fillStyle = '#0a1620';
    g.fillRect(0, 0, W, HUD_H);
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.fillStyle = C_TEXT;
    g.font = 'bold 18px sans-serif';
    g.fillText(`${score}てん`, 12, HUD_H / 2);
    g.fillStyle = C_DIM;
    g.font = 'bold 13px sans-serif';
    g.fillText(`ステージ ${Math.min(stageIdx + 1, STAGES)}/${STAGES}`, 116, HUD_H / 2 - 8);
    g.fillText(`さいたん ${bestRuns}かい`, 116, HUD_H / 2 + 9);

    g.textAlign = 'center';

    if (mode === 'done') {
      g.fillStyle = C_TEXT;
      g.font = 'bold 26px sans-serif';
      g.fillText('ぜんいん ゴール！', W / 2, 280);
      g.font = 'bold 34px sans-serif';
      g.fillStyle = C_ME;
      g.fillText(`${score}てん`, W / 2, 336);
      g.fillStyle = C_DIM;
      g.font = 'bold 14px sans-serif';
      g.fillText(`さいたん手数 ${bestRuns} / ${STAGES} ステージ`, W / 2, 380);
      return;
    }

    // といかけ
    g.fillStyle = C_DIM;
    g.font = 'bold 13px sans-serif';
    g.fillText('スワイプで ぜんいんが 同じ方向へ 1マス', W / 2, 72);
    g.fillStyle = moves >= limit() ? C_NG : C_TEXT;
    g.font = 'bold 17px sans-serif';
    g.fillText(`手数 ${moves} / ${limit()}（さいたん ${stage.par}）`, W / 2, 100);
    g.fillStyle = C_DIM;
    g.font = 'bold 12px sans-serif';
    g.fillText(`わたしは ${stage.starts.length}人。ゴールも ${stage.goals.length}こ`, W / 2, 124);

    // 盤
    for (let i = 0; i < stage.cols * stage.rows; i++) {
      const { x, y } = cellXY(i);
      const wall = stage.walls[i];
      g.fillStyle = wall ? C_WALL : stage.goals.includes(i) ? C_GOAL : C_FLOOR;
      roundRect(x + 2, y + 2, CELL - 4, CELL - 4, wall ? 4 : 8);
      g.fill();
      if (stage.goals.includes(i) && !wall) {
        g.strokeStyle = 'rgba(255,255,255,.35)';
        g.lineWidth = 2;
        g.beginPath();
        g.arc(x + CELL / 2, y + CELL / 2, 15, 0, Math.PI * 2);
        g.stroke();
      }
    }
    // わたし
    for (const p of pos) {
      const { x, y } = cellXY(p);
      const cx = x + CELL / 2;
      const cy = y + CELL / 2;
      const on = stage.goals.includes(p);
      g.fillStyle = on ? C_OK : C_ME;
      g.beginPath();
      g.arc(cx, cy, 16, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#07231d';
      g.beginPath();
      g.arc(cx - 5, cy - 3, 2.6, 0, Math.PI * 2);
      g.arc(cx + 5, cy - 3, 2.6, 0, Math.PI * 2);
      g.fill();
    }

    // ようす
    const bottom = GRID_Y + stage.rows * CELL + 30;
    g.font = 'bold 16px sans-serif';
    if (mode === 'cleared') {
      g.fillStyle = C_OK;
      g.fillText(`クリア！ +${stageScore(moves, stage.par)}てん`, W / 2, bottom);
    } else if (mode === 'failed') {
      g.fillStyle = C_NG;
      g.fillText('手数が つきた… もう一度', W / 2, bottom);
    } else {
      g.fillStyle = C_DIM;
      g.font = 'bold 13px sans-serif';
      g.fillText('かべに ぶつかった わたしだけ 止まる', W / 2, bottom);
    }

    // やりなおす
    g.fillStyle = mode === 'play' ? '#1e3340' : 'rgba(30,51,64,.5)';
    roundRect(RETRY_BTN.x, RETRY_BTN.y, RETRY_BTN.w, RETRY_BTN.h, 12);
    g.fill();
    g.strokeStyle = 'rgba(138,168,182,.45)';
    g.lineWidth = 1.6;
    roundRect(RETRY_BTN.x, RETRY_BTN.y, RETRY_BTN.w, RETRY_BTN.h, 12);
    g.stroke();
    g.fillStyle = C_TEXT;
    g.font = 'bold 16px sans-serif';
    g.fillText('⟲ はじめから', RETRY_BTN.x + RETRY_BTN.w / 2, RETRY_BTN.y + RETRY_BTN.h / 2);

    g.fillStyle = C_ACC;
    g.font = 'bold 11px sans-serif';
    g.fillText('わたしどうしは かさならない（前が つまれば 後ろも 止まる）', W / 2, 606);
  }

  draw();
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
      draw();
    },
    destroy() {
      offSwipe();
      offTap();
      offFrame();
    },
  };
}
