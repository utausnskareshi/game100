// =============================================================
// ぜんけしスイッチ（No.45）: おすと十字に反転！ぜんぶの明かりを消すパズル
// =============================================================
// - マスをおすと「そのマス＋上下左右」の明かりが反転する。全部消したらクリア。
// - 「さいたん」（最短手数＝chase-light法で厳密計算）ぴったりでクリアすると大ボーナス。
// - 3問構成（4×4→5×5→5×5むずかしい）。やりなおし自由（手数はそのまま増える）。
// - 盤面・ソルバは logic.ts（rng注入・消費固定＝日替わり同一）。
// - DOMゲーム（onMove非購読=ネイティブclick）。startMode:'immediate'。
// - import してよいのは game-api（types / helpers）と、このフォルダ内（logic）だけ
import type { GameContext, IGame } from '../../game-api/types';
import { elem } from '../../game-api/helpers';
import { ROUNDS, generatePuzzle, isAllOff, pressAt, roundScore, type SwitchPuzzle } from './logic';

type Phase = 'play' | 'clearwait' | 'over';

const NEXT_MS = 1500;
const END_DELAY = 1900;
const SPEEDY_SEC = 60;

export function createGame(ctx: GameContext): IGame {
  // ---- 状態 ----
  let phase: Phase = 'play';
  let hostPaused = false;
  let round = 0;
  let puzzle: SwitchPuzzle | null = null;
  let bits: boolean[] = [];
  let moves = 0;
  let roundStart = 0;
  let score = 0;
  let parEvery = true;
  let lastSec = -1;
  let nextAt = 0;
  let endAt = 0;
  let ended = false;

  // ---- DOM ----
  const style = document.createElement('style');
  style.textContent = CSS;
  const wrap = elem('div', 'sw-wrap');
  ctx.root.append(style, wrap);

  let hudRoundEl: HTMLElement | null = null;
  let hudMoveEl: HTMLElement | null = null;
  let hudTimeEl: HTMLElement | null = null;
  let hudScoreEl: HTMLElement | null = null;
  let gridEl: HTMLElement | null = null;
  let msgEl: HTMLElement | null = null;
  let cellEls: HTMLButtonElement[] = [];

  function devState(): void {
    if (!import.meta.env.DEV) return;
    const ds = wrap.dataset;
    ds.st = phase;
    ds.round = String(round);
    ds.moves = String(moves);
    ds.par = String(puzzle?.par ?? 0);
    ds.score = String(score);
    ds.bits = bits.map((b) => (b ? 1 : 0)).join('');
  }

  function buildUi(): void {
    const hud = elem('div', 'sw-hud');
    hudRoundEl = elem('span', 'sw-hud-item', '');
    hudMoveEl = elem('span', 'sw-hud-item', '');
    hudTimeEl = elem('span', 'sw-hud-item', '');
    hudScoreEl = elem('span', 'sw-hud-item', '');
    hud.append(hudRoundEl, hudMoveEl, hudTimeEl, hudScoreEl);
    gridEl = elem('div', 'sw-grid');
    msgEl = elem('div', 'sw-msg', '');
    const tools = elem('div', 'sw-tools');
    const resetBtn = elem('button', 'sw-tool', '🔄 やりなおし') as HTMLButtonElement;
    resetBtn.addEventListener('click', () => resetRound());
    tools.append(resetBtn);
    wrap.append(hud, gridEl, msgEl, tools);
  }

  function paintHud(): void {
    if (hudRoundEl) hudRoundEl.textContent = `もん ${Math.min(round + 1, ROUNDS.length)}/${ROUNDS.length}`;
    if (hudMoveEl) hudMoveEl.textContent = `${moves}手（さいたん${puzzle?.par ?? '-'}）`;
    if (hudScoreEl) hudScoreEl.textContent = `スコア ${score}`;
  }

  // ---- ラウンド ----
  function startRound(): void {
    const spec = ROUNDS[round]!;
    puzzle = generatePuzzle(ctx.random, spec.n, spec.k);
    bits = puzzle.bits.slice();
    moves = 0;
    lastSec = -1;
    phase = 'play';
    roundStart = ctx.now();
    if (gridEl) {
      gridEl.replaceChildren();
      gridEl.style.setProperty('--n', String(spec.n));
      cellEls = [];
      for (let i = 0; i < spec.n * spec.n; i++) {
        const idx = i;
        const b = elem('button', 'sw-cell') as HTMLButtonElement;
        b.addEventListener('click', () => onCell(idx));
        cellEls.push(b);
        gridEl.append(b);
      }
    }
    if (msgEl) {
      msgEl.className = 'sw-msg';
      msgEl.textContent = 'おすと 十字に はんてん。ぜんぶ けそう！';
    }
    paintBoard();
    paintHud();
    devState();
  }

  function paintBoard(): void {
    for (let i = 0; i < cellEls.length; i++) {
      const el = cellEls[i]!;
      el.className = 'sw-cell' + (bits[i] ? ' sw-lit' : '');
      el.textContent = bits[i] ? '💡' : '';
    }
  }

  function onCell(i: number): void {
    if (phase !== 'play' || hostPaused || !puzzle) return;
    pressAt(bits, puzzle.n, i);
    moves++;
    ctx.sfx('tap');
    ctx.haptic('light');
    paintBoard();
    paintHud();
    devState();
    if (isAllOff(bits)) roundClear();
  }

  function resetRound(): void {
    if (phase !== 'play' || hostPaused || !puzzle) return;
    bits = puzzle.bits.slice();
    ctx.sfx('tick');
    if (msgEl) msgEl.textContent = 'さいしょから（手数は つづき）';
    paintBoard();
    devState();
  }

  function roundClear(): void {
    if (!puzzle) return;
    const now = ctx.now();
    const sec = Math.floor((now - roundStart) / 1000);
    const s = roundScore(moves, puzzle.par, sec);
    score += s;
    const isPar = moves <= puzzle.par;
    if (!isPar) parEvery = false;
    phase = 'clearwait';
    nextAt = now + NEXT_MS;
    // 実績（加算箇所で即解除）
    ctx.achieve('first-clear');
    if (isPar) ctx.achieve('par-round');
    if (sec <= SPEEDY_SEC) ctx.achieve('speedy');
    if (score >= 900) ctx.achieve('total-900');
    if (msgEl) {
      msgEl.className = 'sw-msg sw-msg-win';
      msgEl.textContent = `ぜんけし！ +${s}てん${isPar ? '（さいたん！🌟）' : ''}`;
    }
    ctx.sfx(isPar ? 'combo' : 'success');
    ctx.haptic('success');
    if (round >= ROUNDS.length - 1) {
      ctx.achieve('clear-all');
      if (parEvery) ctx.achieve('par-all');
      phase = 'over';
      endAt = now + END_DELAY;
      ctx.sfx('medal');
      if (msgEl) msgEl.textContent = `🏆 3もん完走！ ごうけい ${score}てん`;
    }
    paintHud();
    devState();
  }

  // ---- 毎フレーム（タイマー・遷移。期限方式）----
  const offFrame = ctx.onFrame(() => {
    const now = ctx.now();
    if (phase === 'play') {
      const sec = Math.floor((now - roundStart) / 1000);
      if (sec !== lastSec) {
        lastSec = sec;
        if (hudTimeEl) hudTimeEl.textContent = `⏱ ${sec}びょう`;
      }
      return;
    }
    if (phase === 'clearwait' && now >= nextAt) {
      round++;
      startRound();
      return;
    }
    if (phase === 'over' && !ended && now >= endAt) {
      ended = true;
      ctx.end({ score });
    }
  });

  // ---- 起動（startMode:'immediate'＝すぐ1問目）----
  buildUi();
  startRound();

  return {
    start() {
      // カウントダウンなし。1問目から始まる
    },
    pause() {
      hostPaused = true;
    },
    resume() {
      hostPaused = false;
    },
    resize() {
      // グリッドは可変幅CSS（min(88vw,400px)）のため何もしない
    },
    destroy() {
      offFrame();
      style.remove();
      wrap.remove();
    },
  };
}

// =============================================================
// スタイル（.sw- プレフィックス。テーマ変数でライト/ダーク両対応）
// =============================================================
const CSS = `
.sw-wrap{position:absolute;inset:0;overflow:hidden;display:flex;flex-direction:column;align-items:center;
  user-select:none;-webkit-user-select:none}
.sw-hud{display:flex;justify-content:center;align-items:center;gap:12px;padding:8px 64px 4px;flex-wrap:wrap;min-height:54px}
.sw-hud-item{font-size:13.5px;font-weight:800;white-space:nowrap;font-variant-numeric:tabular-nums}
.sw-grid{width:min(88vw,400px);aspect-ratio:1;margin-top:8px;background:var(--bg-elev);border-radius:14px;padding:8px;
  box-sizing:border-box;display:grid;grid-template-columns:repeat(var(--n),1fr);grid-template-rows:repeat(var(--n),1fr);gap:6px}
.sw-cell{border:none;margin:0;padding:0;border-radius:12px;font-family:inherit;font-size:26px;line-height:1;
  background:var(--bg-elev2);box-shadow:inset 0 0 0 2px rgba(120,130,180,.25);transition:background .12s}
.sw-cell.sw-lit{background:#ffc94d;box-shadow:inset 0 0 0 2px #e8a11e,0 0 14px rgba(255,201,77,.55)}
.sw-cell:active{transform:scale(.95)}
.sw-msg{min-height:24px;font-size:15px;font-weight:900;color:var(--text-dim);text-align:center;margin:12px 0 0;padding:0 10px}
.sw-msg-win{color:#2fae5e}
.sw-tools{display:flex;gap:10px;margin-top:10px}
.sw-tool{appearance:none;border:none;border-radius:12px;padding:0 16px;font-size:14px;font-weight:800;font-family:inherit;
  background:var(--bg-elev2);color:var(--text);min-height:44px}
.sw-tool:active{transform:scale(.96)}
`;
