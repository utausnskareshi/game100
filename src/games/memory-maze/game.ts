// =============================================================
// きおくのめいろ（No.27）: 迷路を覚えて、壁が霧に消えたあと記憶だけで進む
// =============================================================
// - ラウンド制: 5×5 → 6×6 → … → 9×9 →（以降9×9で覚える時間が短くなる）エンドレス。
// - 「おぼえて…」の間だけ壁が見える → 霧で壁が透明に → スワイプ／矢印ボタンで1マスずつ移動。
// - 見えない壁にぶつかると「ゴツン💥」＝ライフ−1（その壁だけ一瞬見える＝学べる失敗）。ライフ3。
// - スコア: ラウンドクリア 80 +（サイズ−5）×40 ＋ そのラウンドぶつかり0なら+40。
// - 迷路生成は maze-gen.ts（rng注入＝日替わりは全員同じ迷路）。移動に乱数は使わない。
// - 時間はすべて ctx.now の期限方式（setTimeout 不使用＝ポーズで自動停止）。
// - startMode 省略＝シェルの3-2-1のあと start() でラウンド1が始まる。
// - import してよいのは game-api（types / helpers）と、このフォルダ内（maze-gen）だけ
import type { GameContext, IGame, SwipeDir } from '../../game-api/types';
import { elem } from '../../game-api/helpers';
import { generateMaze, canMove, nextIndex, type Maze, type Dir } from './maze-gen';

type Phase = 'idle' | 'show' | 'fog' | 'clear' | 'over';

const MAX_LIVES = 3;
const CLEAR_MS = 1100; // ゴール演出→次ラウンドまで(ms)
const END_DELAY = 1600; // ゲームオーバー演出→結果画面までの余韻(ms)
const BUMP_FLASH_MS = 450; // ぶつかった壁を見せる時間(ms)
const CLEAR_BASE = 80; // ラウンドクリアの基本点
const SIZE_STEP = 40; // （サイズ−5）×これ
const NO_BUMP_BONUS = 40; // そのラウンドぶつかり0ボーナス
const SCORE_HI = 1200; // 「きおくチャンピオン」実績のしきい値（仮）

/** ラウンド→盤サイズ */
const roundSize = (r: number): number => Math.min(9, 5 + r);
/** ラウンド→おぼえる時間(ms)。9×9以降はだんだん短く（下限3秒） */
const showTime = (r: number): number => {
  const table = [5000, 5000, 4500, 4000, 4000];
  if (r < table.length) return table[r]!;
  return Math.max(3000, 4000 - 500 * (r - 4));
};

export function createGame(ctx: GameContext): IGame {
  // ---- 状態 ----
  let phase: Phase = 'idle';
  let hostPaused = false;
  let round = 0; // 0始まり（表示は+1）
  let maze: Maze | null = null;
  let player = 0;
  let lives = MAX_LIVES;
  let score = 0;
  let roundBumps = 0;
  let totalBumps = 0;
  let showUntil = 0;
  let clearUntil = 0;
  let endAt = 0;
  let ended = false;
  const flashes: { el: HTMLElement; cls: string; until: number }[] = [];

  // ---- DOM ----
  const style = document.createElement('style');
  style.textContent = CSS;
  const wrap = elem('div', 'mm-wrap');
  ctx.root.append(style, wrap);

  const hud = elem('div', 'mm-hud');
  const roundEl = elem('span', 'mm-hud-item', 'ラウンド 1');
  const livesEl = elem('span', 'mm-hud-item', '❤️❤️❤️');
  const scoreEl = elem('span', 'mm-hud-item', 'スコア 0');
  hud.append(roundEl, livesEl, scoreEl);

  const barEl = elem('div', 'mm-bar');
  const barFill = elem('div', 'mm-bar-fill');
  barEl.append(barFill);

  const boardBox = elem('div', 'mm-board-box');
  const grid = elem('div', 'mm-grid');
  const msgEl = elem('div', 'mm-msg', '');
  boardBox.append(grid, msgEl);

  const pad = elem('div', 'mm-pad');
  const padBtns = new Map<Dir, HTMLButtonElement>();
  const mkBtn = (dir: Dir, label: string, cls: string): HTMLButtonElement => {
    const b = elem('button', `mm-dir ${cls}`, label) as HTMLButtonElement;
    b.addEventListener('click', () => move(dir));
    padBtns.set(dir, b);
    return b;
  };
  pad.append(mkBtn('up', '▲', 'mm-up'), mkBtn('left', '◀', 'mm-left'), mkBtn('down', '▼', 'mm-down'), mkBtn('right', '▶', 'mm-right'));

  wrap.append(hud, barEl, boardBox, pad);

  let cells: HTMLElement[] = [];

  function devState(): void {
    if (!import.meta.env.DEV) return;
    wrap.dataset.st = phase;
    wrap.dataset.round = String(round + 1);
    wrap.dataset.n = String(maze?.n ?? 0);
    wrap.dataset.lives = String(lives);
    wrap.dataset.score = String(score);
    wrap.dataset.bumps = String(totalBumps);
    wrap.dataset.player = String(player);
  }

  // ---- ラウンド構築 ----
  function buildRound(): void {
    maze = generateMaze(ctx.random, roundSize(round));
    player = maze.start;
    roundBumps = 0;
    const n = maze.n;
    if (n >= 7) ctx.achieve('reach-7');
    if (n >= 9) ctx.achieve('reach-9');

    grid.style.setProperty('--n', String(n));
    grid.classList.remove('mm-fog');
    cells = [];
    grid.replaceChildren();
    for (let i = 0; i < n * n; i++) {
      const w = maze.walls[i]!;
      const cell = elem('div', 'mm-cell');
      if (w & 1) cell.classList.add('mm-wn');
      if (w & 2) cell.classList.add('mm-we');
      if (w & 4) cell.classList.add('mm-ws');
      if (w & 8) cell.classList.add('mm-ww');
      cells.push(cell);
      grid.append(cell);
    }
    paintTokens();
    // 文字サイズをセル実寸に合わせる（文言・盤を全部入れてから測る）
    const cellPx = cells[0]?.clientWidth ?? 0;
    if (cellPx > 0) grid.style.fontSize = `${Math.round(cellPx * 0.62)}px`;

    phase = 'show';
    showUntil = ctx.now() + showTime(round);
    setMsg(`おぼえて… 👀`, 'mm-msg-show');
    barEl.style.visibility = 'visible';
    paintHud();
    setPadEnabled(false);
    ctx.sfx('tick');
    devState();
  }

  function startFog(): void {
    phase = 'fog';
    grid.classList.add('mm-fog');
    setMsg('すすめ！ 🌫️', 'mm-msg-go');
    barEl.style.visibility = 'hidden';
    setPadEnabled(true);
    ctx.sfx('start');
    ctx.haptic('light');
    devState();
  }

  function setMsg(text: string, cls: string): void {
    msgEl.textContent = text;
    msgEl.className = `mm-msg ${cls}`;
    if (text) {
      msgEl.classList.remove('mm-msg-in');
      void msgEl.offsetWidth;
      msgEl.classList.add('mm-msg-in');
    }
  }

  function setPadEnabled(on: boolean): void {
    for (const b of padBtns.values()) b.disabled = !on;
  }

  function paintTokens(): void {
    if (!maze) return;
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i]!;
      const isP = i === player;
      const isG = i === maze.goal;
      c.textContent = isP ? '🐥' : isG ? '🏁' : '';
      c.classList.toggle('mm-player', isP);
      c.classList.toggle('mm-goal', isG);
      if (isP) c.classList.add('mm-trail');
    }
  }

  function paintHud(): void {
    roundEl.textContent = `ラウンド ${round + 1}（${maze?.n ?? 5}×${maze?.n ?? 5}）`;
    livesEl.textContent = '❤️'.repeat(lives) + '🖤'.repeat(Math.max(0, MAX_LIVES - lives));
    scoreEl.textContent = `スコア ${score}`;
  }

  // ---- 移動 ----
  function move(dir: Dir): void {
    if (phase !== 'fog' || hostPaused || !maze) return;
    if (canMove(maze, player, dir)) {
      player = nextIndex(maze, player, dir);
      paintTokens();
      ctx.sfx('tap');
      if (player === maze.goal) roundClear();
    } else {
      bump(dir);
    }
    devState();
  }

  function bump(dir: Dir): void {
    if (!maze) return;
    roundBumps++;
    totalBumps++;
    lives--;
    // ぶつかった壁を一瞬だけ見せる（学べる失敗）
    const cell = cells[player];
    const cls = dir === 'up' ? 'mm-bn' : dir === 'right' ? 'mm-be' : dir === 'down' ? 'mm-bs' : 'mm-bw';
    if (cell) {
      cell.classList.add(cls);
      flashes.push({ el: cell, cls, until: ctx.now() + BUMP_FLASH_MS });
    }
    setMsg('ゴツン！ 💥', 'mm-msg-bump');
    ctx.sfx('fail');
    ctx.haptic('error');
    paintHud();
    if (lives <= 0) gameOver();
  }

  function roundClear(): void {
    if (!maze) return;
    phase = 'clear';
    const gain = CLEAR_BASE + (maze.n - 5) * SIZE_STEP + (roundBumps === 0 ? NO_BUMP_BONUS : 0);
    score += gain;
    ctx.achieve('first-clear');
    if (roundBumps === 0) ctx.achieve('no-bump');
    if (round >= 4 && totalBumps === 0) ctx.achieve('perfect-5');
    if (score >= SCORE_HI) ctx.achieve('score-hi');
    setMsg(`ゴール！ 🎉 +${gain}`, 'mm-msg-clear');
    setPadEnabled(false);
    grid.classList.remove('mm-fog'); // ごほうびに迷路を見せる
    clearUntil = ctx.now() + CLEAR_MS;
    ctx.sfx('success');
    ctx.haptic('success');
    paintHud();
    devState();
  }

  function gameOver(): void {
    phase = 'over';
    setPadEnabled(false);
    grid.classList.remove('mm-fog'); // 答えの迷路を見せる
    setMsg(`ライフが なくなった… スコア ${score}`, 'mm-msg-over');
    endAt = ctx.now() + END_DELAY;
    ctx.sfx('fail');
    devState();
  }

  // ---- 入力（スワイプ＝どこでも1歩）----
  const swipeToDir: Record<SwipeDir, Dir> = { up: 'up', down: 'down', left: 'left', right: 'right' };
  const offSwipe = ctx.input.onSwipe((dir) => move(swipeToDir[dir]));

  // ---- 毎フレーム（フェーズ進行・おぼえるバー・壁フラッシュ。すべて ctx.now 基準）----
  const offFrame = ctx.onFrame(() => {
    const now = ctx.now();
    // ぶつかり壁フラッシュの後始末
    for (let i = flashes.length - 1; i >= 0; i--) {
      const f = flashes[i]!;
      if (now >= f.until) {
        f.el.classList.remove(f.cls);
        flashes.splice(i, 1);
      }
    }
    if (phase === 'show') {
      const left = showUntil - now;
      if (left <= 0) {
        startFog();
      } else {
        barFill.style.width = `${Math.max(0, Math.min(100, (left / showTime(round)) * 100))}%`;
      }
      return;
    }
    if (phase === 'clear' && now >= clearUntil) {
      round++;
      buildRound();
      return;
    }
    if (phase === 'over' && !ended && now >= endAt) {
      ended = true;
      ctx.end({ score });
    }
  });

  return {
    start() {
      buildRound(); // シェルの3-2-1のあと、ラウンド1の「おぼえて…」から始まる
    },
    pause() {
      hostPaused = true;
    },
    resume() {
      hostPaused = false;
    },
    resize() {
      // セル実寸に合わせた文字サイズだけ追従
      const cellPx = cells[0]?.clientWidth ?? 0;
      if (cellPx > 0) grid.style.fontSize = `${Math.round(cellPx * 0.62)}px`;
    },
    destroy() {
      offSwipe();
      offFrame();
      style.remove();
      wrap.remove();
    },
  };
}

// =============================================================
// スタイル（.mm- プレフィックス。盤はテーマ変数・壁は霧クラスで透明化）
// =============================================================
const CSS = `
.mm-wrap{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;padding:6px 10px 14px;
  box-sizing:border-box;overflow:hidden;user-select:none;-webkit-user-select:none}
.mm-hud{display:flex;justify-content:center;align-items:center;gap:14px;padding:2px 64px 4px;flex-wrap:wrap;min-height:54px}
.mm-hud-item{font-size:14px;font-weight:800;white-space:nowrap}

/* おぼえるバー */
.mm-bar{width:min(88vw,400px);height:8px;border-radius:4px;background:var(--bg-elev2);overflow:hidden;margin-bottom:6px}
.mm-bar-fill{height:100%;width:100%;border-radius:4px;background:var(--accent);transition:width .1s linear}

/* 盤 */
.mm-board-box{position:relative;width:min(88vw,400px)}
.mm-grid{width:100%;aspect-ratio:1;background:var(--bg-elev2);border-radius:12px;padding:6px;box-sizing:border-box;
  display:grid;grid-template-columns:repeat(var(--n),1fr);grid-template-rows:repeat(var(--n),1fr);line-height:1}
.mm-cell{display:flex;align-items:center;justify-content:center;border:2px solid transparent;box-sizing:border-box;
  transition:border-color .25s ease}
/* 壁（見えているとき） */
.mm-grid:not(.mm-fog) .mm-cell.mm-wn{border-top-color:var(--text)}
.mm-grid:not(.mm-fog) .mm-cell.mm-we{border-right-color:var(--text)}
.mm-grid:not(.mm-fog) .mm-cell.mm-ws{border-bottom-color:var(--text)}
.mm-grid:not(.mm-fog) .mm-cell.mm-ww{border-left-color:var(--text)}
/* 霧: 壁は消え、通ったあと・ぶつかった壁だけ見える */
.mm-grid.mm-fog .mm-cell{border-color:transparent}
.mm-cell.mm-trail{background:rgba(124,108,240,.14);border-radius:6px}
.mm-cell.mm-goal{background:rgba(62,211,106,.16);border-radius:6px}
.mm-grid .mm-cell.mm-bn{border-top-color:#ff5a5a !important}
.mm-grid .mm-cell.mm-be{border-right-color:#ff5a5a !important}
.mm-grid .mm-cell.mm-bs{border-bottom-color:#ff5a5a !important}
.mm-grid .mm-cell.mm-bw{border-left-color:#ff5a5a !important}
@keyframes mm-pop{from{transform:scale(.6)}to{transform:scale(1)}}
.mm-cell.mm-player{animation:mm-pop .12s ease-out}

/* メッセージ */
.mm-msg{position:absolute;left:0;right:0;bottom:-2px;transform:translateY(100%);text-align:center;
  font-size:16px;font-weight:900;padding:6px 4px 0;pointer-events:none}
.mm-msg-show{color:var(--accent-2)}
.mm-msg-go{color:var(--text)}
.mm-msg-bump{color:#ff5a5a}
.mm-msg-clear{color:var(--accent-2)}
.mm-msg-over{color:var(--text-dim)}
@keyframes mm-msg-in{from{opacity:0;transform:translateY(100%) scale(.9)}to{opacity:1;transform:translateY(100%) scale(1)}}
.mm-msg-in{animation:mm-msg-in .18s ease-out}

/* 方向パッド（number-merge と同型・44px超） */
.mm-pad{display:grid;grid-template-columns:repeat(3,1fr);grid-template-rows:auto auto;gap:8px;
  width:min(72vw,240px);margin-top:auto;padding-top:26px}
.mm-dir{appearance:none;border:none;border-radius:14px;background:var(--bg-elev2);color:var(--text);
  font-size:24px;font-weight:900;min-height:56px;font-family:inherit}
.mm-dir:disabled{opacity:.4}
.mm-dir:active:not(:disabled){transform:scale(.95)}
.mm-up{grid-column:2;grid-row:1}
.mm-left{grid-column:1;grid-row:2}
.mm-down{grid-column:2;grid-row:2}
.mm-right{grid-column:3;grid-row:2}
`;
