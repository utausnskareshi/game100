// =============================================================
// キラキラマッチ3（No.52）: となりの宝石を入れ替えて 3つそろえて消す！30手スコアアタック
// =============================================================
// - 宝石をタップ→となりをタップで 入れ替え。そろえば消えて 落ちてきて れんさ。
//   そろわない入れ替えは 手を消費しない（元にもどる）。30手の合計点で勝負。
// - 盤ロジック・採点・連鎖解決・盤生成は engine.ts に集約（テストと同じ関数＝スコア厳密一致）。
// - 時間は ctx.now（アニメの間）・乱数は ctx.random・setTimeout 不使用。
// - import してよいのは game-api（types / helpers）と、このフォルダ内（engine）だけ
import type { GameContext, IGame } from '../../game-api/types';
import { elem, makeSeg } from '../../game-api/helpers';
import { areAdjacent, commitSwap, findMatches, makeBoard, resolveAll, reshuffleUntilPlayable } from './engine';

const COLS = 8;
const ROWS = 8;
const MOVES = 30;
const FLASH_MS = 170; // 消える宝石が はじける時間
const SETTLE_MS = 130; // 落下後の 表示時間
const SHUFFLE_MS = 700;
const END_DELAY = 1400;
const SCORE_HI = 2000;
const BIG_CLEAR = 10;

// 色（端末非依存の固定パレット）と、色覚サポート用の記号
const GEM_COLORS = ['', '#e6534b', '#f2a63c', '#46b96a', '#4a8de0', '#9b6cf0', '#ec6bb0', '#35c4cf'];
const GEM_SYMBOLS = ['', '●', '◆', '▲', '■', '★', '♥', '✦'];

type Level = 'easy' | 'normal' | 'hard';
type Mode = 'setup' | 'play' | 'over';
interface Config {
  level: Level;
}
const COLORS_OF: Record<Level, number> = { easy: 5, normal: 6, hard: 7 };

interface Frame {
  board: Uint8Array;
  pop: Uint8Array | null;
  shuffle?: boolean;
}

export function createGame(ctx: GameContext): IGame {
  const saved = ctx.load<Partial<Config>>('config');
  const config: Config = { level: saved?.level === 'normal' || saved?.level === 'hard' ? saved.level : 'easy' };

  let mode: Mode = 'setup';
  let hostPaused = false;
  let colors = COLORS_OF[config.level];
  let board: Uint8Array = new Uint8Array(COLS * ROWS);
  let movesLeft = MOVES;
  let score = 0;
  let selected = -1;
  let locked = false;
  let frames: Frame[] = [];
  let frameIdx = 0;
  let nextFrameAt = 0;
  let endAt = 0;
  let ended = false;

  const style = document.createElement('style');
  style.textContent = CSS;
  const wrap = elem('div', 'gx-wrap');
  ctx.root.append(style, wrap);

  let cells: HTMLButtonElement[] = [];
  let boardEl: HTMLElement | null = null;
  let movesEl: HTMLElement | null = null;
  let scoreEl: HTMLElement | null = null;
  let bannerEl: HTMLElement | null = null;
  let bannerUntil = 0;

  function setData(): void {
    if (!import.meta.env.DEV) return;
    const r = ctx.root as HTMLElement;
    r.dataset.mode = mode;
    r.dataset.moves = String(movesLeft);
    r.dataset.score = String(score);
    r.dataset.locked = locked ? '1' : '0';
    r.dataset.board = Array.from(board).join('');
    r.dataset.sel = String(selected);
  }

  // ---- 設定画面 ----
  function showSetup(): void {
    mode = 'setup';
    const box = elem('div', 'gx-setup');
    box.append(elem('h2', 'gx-h2', 'キラキラマッチ3'));
    box.append(
      makeSeg(
        'gx',
        'むずかしさ（色の数）',
        [
          { v: 'easy', t: 'やさしい\n5色' },
          { v: 'normal', t: 'ふつう\n6色' },
          { v: 'hard', t: 'むずかしい\n7色' },
        ],
        () => config.level,
        (v) => {
          config.level = v as Level;
        },
      ),
    );
    box.append(elem('p', 'gx-note', 'となりの宝石を タップして 入れ替え、たて・よこに 同じ色を3つ そろえて消そう！色が多いほど むずかしく、大きく消したときの 点も高いよ。30手 しょうぶ。'));
    const start = elem('button', 'gx-btn gx-btn-primary gx-btn-lg', 'スタート ▶') as HTMLButtonElement;
    start.addEventListener('click', () => startGame());
    box.append(start);
    wrap.replaceChildren(box);
    setData();
  }

  // ---- 開始 ----
  function startGame(): void {
    ctx.save('config', { ...config });
    colors = COLORS_OF[config.level];
    board = makeBoard(COLS, ROWS, colors, ctx.random);
    reshuffleUntilPlayable(board, COLS, ROWS, colors, ctx.random);
    movesLeft = MOVES;
    score = 0;
    selected = -1;
    locked = false;
    frames = [];
    frameIdx = 0;
    ended = false;
    mode = 'play';
    buildPlay();
    paint(board, null);
    setData();
  }

  function buildPlay(): void {
    const play = elem('div', 'gx-play');
    const hud = elem('div', 'gx-hud');
    movesEl = elem('div', 'gx-moves', '');
    scoreEl = elem('div', 'gx-score', '');
    hud.append(movesEl, scoreEl);
    boardEl = elem('div', 'gx-board');
    cells = [];
    for (let i = 0; i < COLS * ROWS; i++) {
      const idx = i;
      const b = elem('button', 'gx-cell') as HTMLButtonElement;
      const gem = elem('span', 'gx-gem');
      b.append(gem);
      b.addEventListener('click', () => onCell(idx));
      cells.push(b);
      boardEl.append(b);
    }
    play.append(hud, boardEl);
    wrap.replaceChildren(play);
    layout();
  }

  function layout(): void {
    if (!boardEl) return;
    const availW = wrap.clientWidth - 20;
    const availH = wrap.clientHeight - 76; // HUD＋余白
    const cell = Math.max(30, Math.floor(Math.min(availW / COLS, availH / ROWS)));
    boardEl.style.gridTemplateColumns = `repeat(${COLS}, ${cell}px)`;
    boardEl.style.gridAutoRows = `${cell}px`;
    boardEl.style.setProperty('--gem', `${Math.round(cell * 0.62)}px`);
  }

  // ---- 入力（タップ選択→となりタップで入れ替え）----
  function onCell(idx: number): void {
    if (mode !== 'play' || hostPaused || locked) return;
    if (selected === -1) {
      selected = idx;
      ctx.sfx('tap');
      paint(board, null);
      setData();
      return;
    }
    if (idx === selected) {
      selected = -1;
      paint(board, null);
      setData();
      return;
    }
    if (areAdjacent(selected, idx, COLS)) {
      trySwap(selected, idx);
    } else {
      selected = idx; // 遠いマスをタップ＝選び直し
      ctx.sfx('tap');
      paint(board, null);
      setData();
    }
  }

  function trySwap(a: number, b: number): void {
    commitSwap(board, a, b);
    if (findMatches(board, COLS, ROWS).count === 0) {
      // そろわない＝無効。元にもどして 手は消費しない
      commitSwap(board, a, b);
      selected = -1;
      ctx.sfx('fail');
      shake(a, b);
      paint(board, null);
      setData();
      return;
    }
    // 有効な手
    selected = -1;
    movesLeft--;
    ctx.sfx('tap');
    const swapped = board.slice();
    const res = resolveAll(board, COLS, ROWS, colors, ctx.random);
    const shuffled = reshuffleUntilPlayable(board, COLS, ROWS, colors, ctx.random) > 0;

    // 得点と実績は結果が確定した「いま」加算・解除する（中断しても取りこぼさない）
    score += res.total;
    if (res.total > 0) ctx.achieve('first-match');
    if (res.bestRun >= 4) ctx.achieve('combo-4');
    if (res.bestRun >= 5) ctx.achieve('combo-5');
    if (res.cascades >= 3) ctx.achieve('cascade-3');
    if (res.totalCleared >= BIG_CLEAR) ctx.achieve('big-clear');
    if (score >= SCORE_HI) ctx.achieve('score-hi');
    ctx.haptic(res.cascades >= 2 ? 'success' : 'light');

    // アニメーション: 入れ替え → 各段（はじけ→落下）→（必要なら）シャッフル
    frames = [];
    let prev: Uint8Array = swapped;
    for (const step of res.steps) {
      frames.push({ board: prev, pop: step.cleared });
      frames.push({ board: step.boardAfter, pop: null });
      prev = step.boardAfter;
    }
    if (shuffled) frames.push({ board: board.slice(), pop: null, shuffle: true });
    frameIdx = 0;
    locked = true;
    nextFrameAt = ctx.now(); // 次フレームで即1枚目を表示
    // まず入れ替え直後を見せる
    paint(swapped, null);
    setData();
  }

  function shake(a: number, b: number): void {
    for (const i of [a, b]) cells[i]?.classList.add('gx-shake');
    // アニメは CSS。次の paint で class は付け直されるので短命でよい
    ctx.haptic('error');
  }

  // ---- バナー ----
  function showBanner(text: string, ms: number): void {
    hideBanner();
    bannerEl = elem('div', 'gx-banner', text);
    wrap.append(bannerEl);
    bannerUntil = ctx.now() + ms;
  }
  function hideBanner(): void {
    bannerEl?.remove();
    bannerEl = null;
    bannerUntil = 0;
  }

  // ---- 描画 ----
  function paint(displayBoard: ArrayLike<number>, pop: Uint8Array | null): void {
    for (let i = 0; i < COLS * ROWS; i++) {
      const el = cells[i];
      if (!el) continue;
      const v = displayBoard[i] ?? 0;
      const gem = el.firstChild as HTMLElement | null;
      if (gem) {
        gem.style.background = GEM_COLORS[v] ?? '#888';
        gem.textContent = GEM_SYMBOLS[v] ?? '';
      }
      let cls = 'gx-cell';
      if (i === selected) cls += ' gx-sel';
      if (pop && pop[i]) cls += ' gx-pop';
      el.className = cls;
      el.disabled = mode !== 'play';
    }
    if (movesEl) movesEl.textContent = `のこり ${movesLeft}手`;
    if (scoreEl) scoreEl.textContent = `${score}点`;
  }

  // ---- 毎フレーム（アニメ進行・バナー・終了。すべて ctx.now 期限）----
  const offFrame = ctx.onFrame(() => {
    if (hostPaused) return;
    const now = ctx.now();
    if (bannerEl && now >= bannerUntil) hideBanner();

    if (locked && now >= nextFrameAt) {
      if (frameIdx < frames.length) {
        const f = frames[frameIdx];
        if (f) {
          paint(f.board, f.pop ?? null);
          if (f.shuffle) showBanner('シャッフル！', SHUFFLE_MS - 100);
          const dur = f.shuffle ? SHUFFLE_MS : f.pop ? FLASH_MS : SETTLE_MS;
          nextFrameAt = now + dur;
        }
        frameIdx++;
      } else {
        // アニメ終了
        locked = false;
        paint(board, null);
        setData();
        if (movesLeft <= 0) {
          mode = 'over';
          endAt = now + END_DELAY;
          showBanner(`おしまい！ ${score}点`, END_DELAY - 100);
        }
      }
    }

    if (mode === 'over' && !ended && now >= endAt) {
      ended = true;
      ctx.end({ score });
    }
  });

  showSetup();

  return {
    start() {
      /* 設定画面から開始（immediate） */
    },
    pause() {
      hostPaused = true;
    },
    resume() {
      hostPaused = false;
    },
    resize() {
      layout();
    },
    destroy() {
      offFrame();
      style.remove();
      wrap.remove();
    },
  };
}

const CSS = `
.gx-wrap{position:absolute;inset:0;overflow:hidden}
.gx-setup{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:safe center;
  gap:16px;padding:20px 16px;box-sizing:border-box;overflow-y:auto;user-select:none;-webkit-user-select:none}
.gx-h2{margin:4px 0;font-size:22px}
.gx-seg-row{width:min(92vw,420px);display:flex;flex-direction:column;gap:6px}
.gx-seg-label{font-size:13px;color:var(--text-dim);font-weight:800}
.gx-seg{display:flex;background:var(--bg-elev2);border-radius:12px;padding:3px;gap:2px}
.gx-seg-btn{flex:1;border:none;background:none;color:var(--text-dim);padding:8px 2px;border-radius:9px;
  font-size:12px;font-weight:800;min-height:44px;white-space:pre-line;line-height:1.3}
.gx-seg-btn.gx-on{background:var(--accent);color:#fff}
.gx-note{font-size:12px;color:var(--text-dim);text-align:center;max-width:min(92vw,420px);margin:0;line-height:1.7}
.gx-btn{appearance:none;border:none;border-radius:12px;padding:12px 18px;font-size:15px;font-weight:800;
  background:var(--bg-elev2);color:var(--text);min-height:44px}
.gx-btn-primary{background:var(--accent-grad);color:#fff}
.gx-btn-lg{width:100%;max-width:300px;font-size:18px}

.gx-play{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;
  gap:10px;padding:6px 8px 12px;box-sizing:border-box;user-select:none;-webkit-user-select:none}
.gx-hud{display:flex;gap:22px;align-items:center;font-weight:800;font-size:17px;padding:0 64px}
.gx-moves{color:var(--text)}
.gx-score{color:var(--accent)}
.gx-board{display:grid;gap:2px;background:var(--bg-elev2);padding:6px;border-radius:14px;flex:0 0 auto}
.gx-cell{border:none;margin:0;padding:0;display:flex;align-items:center;justify-content:center;box-sizing:border-box;
  background:transparent;border-radius:8px}
.gx-cell:disabled{cursor:default}
.gx-gem{width:82%;height:82%;border-radius:26%;display:flex;align-items:center;justify-content:center;
  font-size:var(--gem,22px);line-height:1;color:rgba(255,255,255,.82);
  box-shadow:inset 0 3px 5px rgba(255,255,255,.35),inset 0 -4px 6px rgba(0,0,0,.28);transition:transform .08s}
.gx-sel{background:rgba(255,255,255,.28)}
.gx-sel .gx-gem{transform:scale(1.08)}
.gx-pop .gx-gem{animation:gx-pop ${FLASH_MS}ms ease-in forwards}
@keyframes gx-pop{to{transform:scale(.2);opacity:0}}
.gx-shake .gx-gem{animation:gx-shake .3s}
@keyframes gx-shake{0%,100%{transform:translateX(0)}25%{transform:translateX(-4px)}75%{transform:translateX(4px)}}
.gx-banner{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);background:rgba(16,19,48,.9);color:#fff;
  padding:12px 26px;border-radius:999px;font-weight:800;font-size:22px;pointer-events:none;white-space:nowrap;z-index:5;
  animation:gx-bpop .2s ease-out}
@keyframes gx-bpop{from{opacity:0;transform:translate(-50%,-42%)}to{opacity:1;transform:translate(-50%,-50%)}}
`;
