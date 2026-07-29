// =============================================================
// れんさ ばくはつ（No.121・かくれゲーム）: 1か所タップで どこまで つながるか
// =============================================================
// - 操作は「1もんに 1か所 タップ」だけ。そのかわり どこを えらぶかで 結果が 何倍も 変わる。
// - 盤は logic 側で「par がじゅうぶん長い／par を出せるのは3か所いか／でたらめでは半分いか」
//   を満たすものだけを 作っている＝よく見て えらぶ意味がある。
// - import してよいのは game-api（types / helpers）と、このフォルダ内（logic）だけ。
import type { GameContext, IGame, PointerInfo } from '../../game-api/types';
import { COLS, ROUNDS, type Board, chainWaves, makeBoards, roundPoints } from './logic';

const W = 360;
const H = 640;
const HUD_H = 46;

const CELL = 44;
const GRID_Y = 130;
/** 1波の 演出時間 */
const WAVE_MS = 190;
const AFTER_MS = 600;
const RESULT_MS = 1800;
const END_DELAY = 2600;
const SCORE_HI = 950;

const C_BG = '#191225';
const C_CELL = 'rgba(255,255,255,.05)';
const C_TEXT = '#f3ecff';
const C_DIM = '#a294c4';
const C_OK = '#5ad08a';
const C_ACC = '#ffd54a';
/** 力ごとの 色（1=小さい 3=大きい） */
const ORB_COLORS = ['#4ac9e0', '#ffa63a', '#ff5f8a'];

type Mode = 'play' | 'blast' | 'result' | 'done';

export function createGame(ctx: GameContext): IGame {
  const cv = ctx.canvas2d({ design: { w: W, h: H } });
  const g = cv.ctx;

  const boards: Board[] = makeBoards(ctx.random);
  let roundIdx = 0;
  let board: Board = boards[0]!;
  let mode: Mode = 'play';
  let started = false;
  let hostPaused = false;
  let ended = false;
  let score = 0;
  let cleared = 0;
  let perfects = 0;
  let bestChain = 0;
  /** 連鎖の 波 */
  let waves: number[][] = [];
  let waveIdx = -1;
  let waveUntil = 0;
  let chain = 0;
  let phaseUntil = 0;
  let lastEvent = '';

  function loadRound(i: number): void {
    roundIdx = i;
    board = boards[i]!;
    waves = [];
    waveIdx = -1;
    chain = 0;
    mode = 'play';
    lastEvent = `round:${i}:par${board.par}`;
  }

  // ---------- レイアウト ----------
  const cellXY = (i: number): { x: number; y: number } => ({
    x: (W - COLS * CELL) / 2 + (i % COLS) * CELL,
    y: GRID_Y + Math.floor(i / COLS) * CELL,
  });
  const hitCell = (p: { x: number; y: number }): number => {
    const x0 = (W - COLS * CELL) / 2;
    const c = Math.floor((p.x - x0) / CELL);
    const r = Math.floor((p.y - GRID_Y) / CELL);
    if (c < 0 || r < 0 || c >= COLS || r >= board.rows) return -1;
    return r * COLS + c;
  };
  /** その玉が もう はれつしたか */
  const burst = (i: number): boolean => {
    for (let w = 0; w <= waveIdx && w < waves.length; w++) if (waves[w]!.includes(i)) return true;
    return false;
  };

  // ---------- 入力 ----------
  const offTap = ctx.input.onTap((p: PointerInfo) => {
    if (hostPaused || !started || mode !== 'play') return;
    const i = hitCell(cv.toLocal(p));
    if (i < 0 || (board.power[i] ?? 0) <= 0) return;
    const now = ctx.now();
    waves = chainWaves(board, i);
    chain = waves.reduce((a, w) => a + w.length, 0);
    waveIdx = 0;
    waveUntil = now + WAVE_MS;
    mode = 'blast';
    ctx.sfx('powerup');
    ctx.haptic('medium');
    lastEvent = `tap:${i}:${chain}/${board.par}`;
  });

  // ---------- 毎フレーム ----------
  const offFrame = ctx.onFrame(() => {
    if (hostPaused || !started) return;
    const now = ctx.now();
    if (mode === 'blast' && now >= waveUntil) {
      if (waveIdx + 1 < waves.length) {
        waveIdx++;
        waveUntil = now + WAVE_MS;
        ctx.sfx('combo');
      } else {
        settle(now);
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

  function settle(now: number): void {
    const pts = roundPoints(chain, board.par);
    score += pts;
    cleared++;
    bestChain = Math.max(bestChain, chain);
    if (chain >= board.par) {
      perfects++;
      ctx.achieve('perfect-chain');
    }
    if (cleared === 1) ctx.achieve('first-chain');
    if (cleared >= 3) ctx.achieve('half');
    // ※ 10 は「どのシードでも 1プレイ中に par が 10いじょうの盤が必ずある」ことを実測して決めた値
    if (chain >= 10) ctx.achieve('big-chain');
    mode = 'result';
    phaseUntil = now + RESULT_MS + AFTER_MS;
    ctx.sfx(chain >= board.par ? 'medal' : 'tap');
    lastEvent = `chain:${roundIdx}:${chain}/${board.par}:${pts}`;
  }

  function finish(now: number): void {
    if (perfects >= ROUNDS) ctx.achieve('all-perfect');
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
    r.dataset.round = String(roundIdx);
    r.dataset.rows = String(board.rows);
    r.dataset.power = board.power.join('');
    r.dataset.par = String(board.par);
    r.dataset.bestcells = board.best.join(',');
    r.dataset.chain = String(chain);
    r.dataset.score = String(score);
    r.dataset.perfects = String(perfects);
    r.dataset.best = String(bestChain);
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
    g.fillStyle = '#100b18';
    g.fillRect(0, 0, W, HUD_H);
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.fillStyle = C_TEXT;
    g.font = 'bold 18px sans-serif';
    g.fillText(`${score}てん`, 12, HUD_H / 2);
    g.fillStyle = C_DIM;
    g.font = 'bold 13px sans-serif';
    g.fillText(`もんだい ${Math.min(roundIdx + 1, ROUNDS)}/${ROUNDS}`, 116, HUD_H / 2 - 8);
    g.fillText(`さいこう ${bestChain}れんさ`, 116, HUD_H / 2 + 9);

    g.textAlign = 'center';

    if (mode === 'done') {
      g.fillStyle = C_TEXT;
      g.font = 'bold 26px sans-serif';
      g.fillText('ぜんぶ ばくはつ！', W / 2, 280);
      g.font = 'bold 34px sans-serif';
      g.fillStyle = C_ACC;
      g.fillText(`${score}てん`, W / 2, 336);
      g.fillStyle = C_DIM;
      g.font = 'bold 14px sans-serif';
      g.fillText(`さいこう れんさ ${bestChain}こ・満点 ${perfects} / ${ROUNDS} もん`, W / 2, 380);
      return;
    }

    // といかけ
    g.fillStyle = C_DIM;
    g.font = 'bold 13px sans-serif';
    g.fillText('1か所だけ タップ。ぜんぶ つながる 起点を さがそう', W / 2, 72);
    g.fillStyle = mode === 'play' ? C_TEXT : chain >= board.par ? C_OK : C_ACC;
    g.font = 'bold 17px sans-serif';
    g.fillText(mode === 'play' ? `さいこう ${board.par}れんさ` : `${chain} / ${board.par} れんさ`, W / 2, 100);

    // 盤
    for (let i = 0; i < COLS * board.rows; i++) {
      const { x, y } = cellXY(i);
      g.fillStyle = C_CELL;
      roundRect(x + 2, y + 2, CELL - 4, CELL - 4, 6);
      g.fill();
      const p = board.power[i] ?? 0;
      if (p <= 0) continue;
      const cx = x + CELL / 2;
      const cy = y + CELL / 2;
      if (burst(i)) {
        // はれつ後: 火の とんだ 方向を 見せる
        g.strokeStyle = 'rgba(255,213,74,.55)';
        g.lineWidth = 3;
        g.beginPath();
        g.moveTo(cx - CELL * 0.3, cy);
        g.lineTo(cx + CELL * 0.3, cy);
        g.moveTo(cx, cy - CELL * 0.3);
        g.lineTo(cx, cy + CELL * 0.3);
        g.stroke();
        continue;
      }
      const r = 8 + p * 3.4;
      g.fillStyle = ORB_COLORS[p - 1]!;
      g.beginPath();
      g.arc(cx, cy, r, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = 'rgba(255,255,255,.5)';
      g.beginPath();
      g.arc(cx - r * 0.3, cy - r * 0.3, r * 0.28, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#1a1024';
      g.font = 'bold 13px sans-serif';
      g.fillText(String(p), cx, cy + 1);
    }

    // 波の 広がり（いま はれつした玉を 光らせる）
    if (mode === 'blast' && waveIdx >= 0 && waveIdx < waves.length) {
      const t = 1 - Math.max(0, (waveUntil - now) / WAVE_MS);
      for (const i of waves[waveIdx]!) {
        const { x, y } = cellXY(i);
        g.strokeStyle = `rgba(255,213,74,${(1 - t).toFixed(2)})`;
        g.lineWidth = 4;
        g.beginPath();
        g.arc(x + CELL / 2, y + CELL / 2, 6 + t * 26, 0, Math.PI * 2);
        g.stroke();
      }
    }

    // ようす
    const bottom = GRID_Y + board.rows * CELL + 34;
    g.font = 'bold 16px sans-serif';
    if (mode === 'result') {
      const pts = roundPoints(chain, board.par);
      g.fillStyle = chain >= board.par ? C_OK : C_ACC;
      g.fillText(chain >= board.par ? `さいこう れんさ！ +${pts}てん` : `${chain}れんさ +${pts}てん`, W / 2, bottom);
    } else if (mode === 'blast') {
      g.fillStyle = C_ACC;
      g.fillText(`${waves.slice(0, waveIdx + 1).reduce((a, w) => a + w.length, 0)} れんさ…`, W / 2, bottom);
    } else {
      g.fillStyle = C_DIM;
      g.font = 'bold 13px sans-serif';
      g.fillText('玉の数字＝火が とぶ マスの数（上下左右）', W / 2, bottom);
    }

    g.fillStyle = C_DIM;
    g.font = 'bold 11px sans-serif';
    g.fillText('1もんに 1回だけ タップできる', W / 2, 620);
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
