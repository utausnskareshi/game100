// =============================================================
// いろの かいだん（No.116・かくれゲーム）: 色を 入れかえて グラデーションを 作る
// =============================================================
// - ねらい: #103 いろまぜラボは「まぜて 合わせる」、こちらは「ならべて 秩序を 作る」。
//   4すみだけが 動かせないヒントで、たて・よこが なめらかに つながる ならびは 1とおり。
// - 時間制限も しっぱいも ない のんびり系。うまさは「さいたん手数で できたか」で 出る。
// - import してよいのは game-api（types / helpers）と、このフォルダ内（logic）だけ。
import type { GameContext, IGame, PointerInfo } from '../../game-api/types';
import { BOARD_COUNT, type Board, isSolved, makeBoards, stageScore, toCss } from './logic';

const W = 360;
const H = 640;
const HUD_H = 46;

/** 盤の わく */
const AREA_Y = 112;
const AREA_W = 300;
const AREA_H = 330;

const CLEAR_MS = 1600;
const END_DELAY = 2600;
const SCORE_HI = 570;

const C_BG = '#23202c';
const C_PANEL = '#2f2b3a';
const C_TEXT = '#f2eef8';
const C_DIM = '#a49cba';
const C_SEL = '#ffd54a';
const C_OK = '#5ad08a';
const C_NG = '#e0705a';

type Mode = 'play' | 'cleared' | 'done';

export function createGame(ctx: GameContext): IGame {
  const cv = ctx.canvas2d({ design: { w: W, h: H } });
  const g = cv.ctx;

  const boards: Board[] = makeBoards(ctx.random);
  let boardIdx = 0;
  let board: Board = boards[0]!;
  let sel = -1;
  let swaps = 0;
  let mode: Mode = 'play';
  let started = false;
  let hostPaused = false;
  let ended = false;
  let score = 0;
  let done = 0;
  let minRuns = 0;
  let phaseUntil = 0;
  let hintUntil = 0;
  let hintText = '';
  let lastEvent = '';

  function loadBoard(i: number): void {
    boardIdx = i;
    board = boards[i]!;
    sel = -1;
    swaps = 0;
    mode = 'play';
    lastEvent = `board:${i}`;
  }

  // ---------- レイアウト ----------
  const cellSize = (): number => Math.min(AREA_W / board.cols, AREA_H / board.rows);
  const cellRect = (i: number): { x: number; y: number; s: number } => {
    const s = cellSize();
    const gx = (W - s * board.cols) / 2;
    const gy = AREA_Y + (AREA_H - s * board.rows) / 2;
    return { x: gx + (i % board.cols) * s, y: gy + Math.floor(i / board.cols) * s, s };
  };
  const hitCell = (p: { x: number; y: number }): number => {
    const s = cellSize();
    const gx = (W - s * board.cols) / 2;
    const gy = AREA_Y + (AREA_H - s * board.rows) / 2;
    const c = Math.floor((p.x - gx) / s);
    const r = Math.floor((p.y - gy) / s);
    if (c < 0 || r < 0 || c >= board.cols || r >= board.rows) return -1;
    return r * board.cols + c;
  };

  // ---------- 入力 ----------
  const offTap = ctx.input.onTap((p: PointerInfo) => {
    if (hostPaused || !started || mode !== 'play') return;
    const l = cv.toLocal(p);
    const i = hitCell(l);
    if (i < 0) return;
    const now = ctx.now();
    if (board.locked[i]) {
      hintText = '4すみは 動かせないよ（ヒントの色）';
      hintUntil = now + 1300;
      ctx.sfx('fail');
      lastEvent = `locked:${i}`;
      return;
    }
    if (sel < 0) {
      sel = i;
      ctx.sfx('tap');
      lastEvent = `sel:${i}`;
      return;
    }
    if (sel === i) {
      sel = -1;
      ctx.sfx('tap');
      lastEvent = 'unsel';
      return;
    }
    // 入れかえ
    const t = board.cells[sel]!;
    board.cells[sel] = board.cells[i]!;
    board.cells[i] = t;
    swaps++;
    sel = -1;
    ctx.sfx('tap');
    ctx.haptic('light');
    lastEvent = `swap:${swaps}`;
    if (isSolved(board)) clearBoard(now);
  });

  function clearBoard(now: number): void {
    const pts = stageScore(swaps, board.par);
    score += pts;
    done++;
    if (swaps <= board.par) {
      minRuns++;
      ctx.achieve('min-swaps');
    }
    if (done === 1) ctx.achieve('first-board');
    if (done >= 2) ctx.achieve('half');
    mode = 'cleared';
    phaseUntil = now + CLEAR_MS;
    ctx.sfx('medal');
    ctx.haptic('success');
    lastEvent = `clear:${boardIdx}:${pts}:${swaps}/${board.par}`;
  }

  // ---------- 毎フレーム ----------
  const offFrame = ctx.onFrame(() => {
    if (hostPaused || !started) return;
    const now = ctx.now();
    if (mode === 'cleared' && now >= phaseUntil) {
      if (boardIdx + 1 >= BOARD_COUNT) finish(now);
      else loadBoard(boardIdx + 1);
    } else if (mode === 'done' && !ended && now >= phaseUntil) {
      ended = true;
      ctx.end({ score });
      return;
    }
    draw(now);
    setData();
  });

  function finish(now: number): void {
    ctx.achieve('all-board');
    if (minRuns >= BOARD_COUNT) ctx.achieve('all-min');
    if (score >= SCORE_HI) ctx.achieve('score-hi');
    mode = 'done';
    phaseUntil = now + END_DELAY;
    ctx.sfx('medal');
    lastEvent = `finish:${score}:${minRuns}`;
  }

  function setData(): void {
    if (!import.meta.env.DEV) return;
    const r = ctx.root as HTMLElement;
    r.dataset.mode = mode;
    r.dataset.board = String(boardIdx);
    r.dataset.size = `${board.cols}x${board.rows}`;
    r.dataset.cells = board.cells.join(',');
    r.dataset.locked = board.locked.map((v) => (v ? '1' : '0')).join('');
    r.dataset.sel = String(sel);
    r.dataset.swaps = String(swaps);
    r.dataset.par = String(board.par);
    r.dataset.solved = isSolved(board) ? '1' : '0';
    r.dataset.score = String(score);
    r.dataset.done = String(done);
    r.dataset.minruns = String(minRuns);
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
    g.fillStyle = '#191622';
    g.fillRect(0, 0, W, HUD_H);
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.fillStyle = C_TEXT;
    g.font = 'bold 18px sans-serif';
    g.fillText(`${score}てん`, 12, HUD_H / 2);
    g.fillStyle = C_DIM;
    g.font = 'bold 13px sans-serif';
    g.fillText(`ばん ${Math.min(boardIdx + 1, BOARD_COUNT)}/${BOARD_COUNT}`, 116, HUD_H / 2 - 8);
    g.fillText(`さいたん ${minRuns}かい`, 116, HUD_H / 2 + 9);

    g.textAlign = 'center';

    if (mode === 'done') {
      g.fillStyle = C_TEXT;
      g.font = 'bold 26px sans-serif';
      g.fillText('ぜんぶ そろった！', W / 2, 280);
      g.font = 'bold 34px sans-serif';
      g.fillStyle = C_SEL;
      g.fillText(`${score}てん`, W / 2, 336);
      g.fillStyle = C_DIM;
      g.font = 'bold 14px sans-serif';
      g.fillText(`さいたん手数 ${minRuns} / ${BOARD_COUNT} ばん`, W / 2, 380);
      return;
    }

    // といかけ
    g.fillStyle = C_DIM;
    g.font = 'bold 13px sans-serif';
    g.fillText('たて・よこが なめらかに つながるように ならべよう', W / 2, 70);
    g.fillStyle = C_TEXT;
    g.font = 'bold 15px sans-serif';
    g.fillText(`入れかえ ${swaps}かい（さいたん ${board.par}かい）`, W / 2, 94);

    // 盤
    const s = cellSize();
    for (let i = 0; i < board.cells.length; i++) {
      const r = cellRect(i);
      const col = board.target[board.cells[i]!]!;
      g.fillStyle = toCss(col);
      roundRect(r.x + 2, r.y + 2, s - 4, s - 4, 7);
      g.fill();
      if (board.locked[i]) {
        // 動かせない しるし
        g.fillStyle = 'rgba(255,255,255,.85)';
        g.beginPath();
        g.arc(r.x + s / 2, r.y + s / 2, 5.5, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = 'rgba(0,0,0,.45)';
        g.beginPath();
        g.arc(r.x + s / 2, r.y + s / 2, 2.4, 0, Math.PI * 2);
        g.fill();
      }
      if (sel === i) {
        g.strokeStyle = C_SEL;
        g.lineWidth = 4;
        roundRect(r.x + 3, r.y + 3, s - 6, s - 6, 7);
        g.stroke();
      }
    }
    // 盤のふち
    g.strokeStyle = mode === 'cleared' ? C_OK : C_PANEL;
    g.lineWidth = 3;
    const g0 = cellRect(0);
    roundRect(g0.x, g0.y, s * board.cols, s * board.rows, 10);
    g.stroke();

    // ひとこと
    g.font = 'bold 14px sans-serif';
    if (mode === 'cleared') {
      g.fillStyle = C_OK;
      g.fillText(`そろった！ +${stageScore(swaps, board.par)}てん`, W / 2, 480);
    } else if (now < hintUntil) {
      g.fillStyle = C_NG;
      g.fillText(hintText, W / 2, 480);
    } else if (sel >= 0) {
      g.fillStyle = C_SEL;
      g.fillText('もう1つ タップすると 入れかわる', W / 2, 480);
    } else {
      g.fillStyle = C_DIM;
      g.fillText('入れかえたい 2つを じゅんばんに タップ', W / 2, 480);
    }

    g.fillStyle = C_DIM;
    g.font = 'bold 12px sans-serif';
    g.fillText('4すみの 色は 動かせない（ならびの ヒント）', W / 2, 570);
    g.font = 'bold 11px sans-serif';
    g.fillText('じかん制限も しっぱいも ない。さいたん手数を めざそう', W / 2, 594);
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
