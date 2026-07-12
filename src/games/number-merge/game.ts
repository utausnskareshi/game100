// =============================================================
// すうじがったい（No.18）: スワイプで同じ数字を合体させて大きな数をめざす
// =============================================================
// - スワイプ（onSwipe）＋画面下の矢印ボタンで上下左右へスライド。同じ数が合体して倍に。
// - 動かせる手がなくなったら終了。とちゅうで やめても「つづきから」で再開できる。
// - 盤操作・合体・スポーン・終了判定は engine.ts の純ロジック（rng 注入＝今日のゲームは同じ引き）。
// - onMove は購読しない＝ gameRoot が setPointerCapture しない → 矢印ボタンのタップが活きる。
// - import してよいのは game-api（types/helpers）と、このフォルダ内（engine）だけ
import type { GameContext, IGame, SwipeDir } from '../../game-api/types';
import { elem, makeSeg } from '../../game-api/helpers';
import { slide, spawn, canMove, maxTile, makeBoard, type Dir } from './engine';

type Mode = 'setup' | 'play' | 'over';

interface Config {
  size: number;
}
interface Progress {
  size: number;
  board: number[];
  score: number;
}

const END_DELAY = 1700; // ゲームオーバー演出→結果画面までの余韻(ms)
const SCORE_HI = 10_000; // 「たかとくてん」実績のしきい値（仮）
const WIN_TILE = 2048; // 「2048たっせい」

export function createGame(ctx: GameContext): IGame {
  // ---- 設定（前回のサイズを復元。既定は 4×4）----
  const saved = ctx.load<Partial<Config>>('config');
  const config: Config = { size: saved?.size === 5 ? 5 : 4 };

  // ---- 状態 ----
  let mode: Mode = 'setup';
  let hostPaused = false;
  let size = config.size;
  let board: number[] = [];
  let score = 0;
  let reachedWin = false;
  let endAt = 0;
  let ended = false;

  // ---- DOM ----
  const style = document.createElement('style');
  style.textContent = CSS;
  const wrap = elem('div', 'nm-wrap');
  ctx.root.append(style, wrap);

  let scoreEl: HTMLElement | null = null;
  let maxEl: HTMLElement | null = null;
  let gridEl: HTMLElement | null = null;
  let cells: HTMLElement[] = [];

  function setMode(m: Mode): void {
    mode = m;
    if (import.meta.env.DEV) wrap.dataset.st = m; // 検証用の状態公開（開発ビルド限定）
  }

  // ---- つづきから（中断セーブの読み込み・形式検証つき）----
  function loadProgress(): Progress | null {
    const p = ctx.load<Partial<Progress>>('progress');
    if (!p || typeof p !== 'object') return null;
    const sz = p.size;
    if (sz !== 4 && sz !== 5) return null;
    const b = p.board;
    if (!Array.isArray(b) || b.length !== sz * sz || !b.every((v) => typeof v === 'number' && v >= 0)) return null;
    const sc = typeof p.score === 'number' && p.score >= 0 ? p.score : 0;
    return { size: sz, board: b.slice(), score: sc };
  }
  function saveProgress(): void {
    ctx.save<Progress>('progress', { size, board: board.slice(), score });
  }
  function clearProgress(): void {
    ctx.save('progress', null);
  }

  // ---- 設定画面 ----
  function showSetup(): void {
    setMode('setup');
    const box = elem('div', 'nm-setup');
    box.append(elem('h2', 'nm-h2', '同じ数を くっつけよう'));
    box.append(
      makeSeg(
        'nm',
        'ばんの大きさ',
        [
          { v: '4', t: '4×4' },
          { v: '5', t: '5×5（ひろい）' },
        ],
        () => String(config.size),
        (v) => {
          config.size = v === '5' ? 5 : 4;
        },
      ),
    );
    box.append(elem('p', 'nm-note', 'スワイプ（または下のボタン）で ぜんぶのタイルを 動かそう。同じ数が くっつくと 倍になるよ。動かせなくなったら おしまい。'));

    const start = elem('button', 'nm-btn nm-btn-primary nm-btn-lg', 'はじめる ▶') as HTMLButtonElement;
    start.addEventListener('click', () => startNew());
    box.append(start);

    const prog = loadProgress();
    if (prog) {
      const cont = elem('button', 'nm-btn nm-btn-lg', `つづきから（${prog.score}てん・${prog.size}×${prog.size}）`) as HTMLButtonElement;
      cont.addEventListener('click', () => resume(prog));
      box.append(cont);
    }
    wrap.replaceChildren(box);
  }

  // ---- 開始 ----
  function startNew(): void {
    ctx.save('config', { ...config });
    size = config.size;
    board = makeBoard(size);
    board = spawn(board, ctx.random).board;
    board = spawn(board, ctx.random).board;
    score = 0;
    reachedWin = false;
    ended = false;
    buildPlay();
    render(null);
    saveProgress();
  }

  function resume(p: Progress): void {
    size = p.size;
    board = p.board.slice();
    score = p.score;
    reachedWin = maxTile(board) >= WIN_TILE;
    ended = false;
    config.size = size;
    buildPlay();
    render(null);
  }

  function buildPlay(): void {
    setMode('play');
    const play = elem('div', 'nm-play');

    const hud = elem('div', 'nm-hud');
    scoreEl = elem('span', 'nm-hud-item', 'スコア 0');
    maxEl = elem('span', 'nm-hud-item', 'さいだい 0');
    hud.append(scoreEl, maxEl);

    gridEl = elem('div', 'nm-board');
    gridEl.style.setProperty('--n', String(size));
    cells = [];
    for (let i = 0; i < size * size; i++) {
      const cell = elem('div', 'nm-cell');
      cells.push(cell);
      gridEl.append(cell);
    }

    const pad = elem('div', 'nm-pad');
    const mk = (dir: Dir, label: string, cls: string): HTMLButtonElement => {
      const b = elem('button', `nm-dir ${cls}`, label) as HTMLButtonElement;
      b.dataset.dir = dir;
      b.addEventListener('click', () => move(dir));
      return b;
    };
    pad.append(mk('up', '▲', 'nm-up'), mk('left', '◀', 'nm-left'), mk('down', '▼', 'nm-down'), mk('right', '▶', 'nm-right'));

    play.append(hud, gridEl, pad);
    wrap.replaceChildren(play);
  }

  // ---- 1手 ----
  function move(dir: Dir): void {
    if (mode !== 'play' || hostPaused) return;
    const res = slide(board, size, dir);
    if (!res.moved) return;
    board = res.board;
    score += res.gained;
    const sp = spawn(board, ctx.random);
    board = sp.board;

    if (res.merges > 0) {
      ctx.achieve('first-merge');
      ctx.sfx('tap');
      ctx.haptic('light');
    } else {
      ctx.sfx('tap');
    }
    if (res.merges >= 3) ctx.achieve('multi-merge');

    const mx = maxTile(board);
    if (mx >= 256) ctx.achieve('reach-256');
    if (mx >= 1024) ctx.achieve('reach-1024');
    if (mx >= WIN_TILE) {
      ctx.achieve('reach-2048');
      if (!reachedWin) {
        reachedWin = true;
        showWin();
      }
    }
    if (score >= SCORE_HI) ctx.achieve('score-hi');

    render(sp.placed);
    saveProgress();

    if (!canMove(board, size)) gameOver();
  }

  function gameOver(): void {
    setMode('over');
    clearProgress();
    const over = elem('div', 'nm-over');
    over.append(
      elem('div', 'nm-over-t', 'おしまい！'),
      elem('div', 'nm-over-s', `スコア ${score}`),
      elem('div', 'nm-over-b', `さいだいタイル ${maxTile(board)}`),
    );
    gridEl?.append(over);
    ctx.sfx('fail');
    ctx.haptic('error');
    endAt = ctx.now() + END_DELAY;
  }

  function showWin(): void {
    if (!gridEl) return;
    const win = elem('div', 'nm-win', '🎉 2048 たっせい！');
    win.addEventListener('animationend', () => win.remove());
    gridEl.append(win);
    ctx.sfx('medal');
    ctx.haptic('success');
  }

  // ---- 描画 ----
  function render(placed: number | null): void {
    const cellPx = cells[0]?.clientWidth ?? 0;
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];
      if (!cell) continue;
      const v = board[i] ?? 0;
      cell.dataset.v = String(v);
      cell.textContent = v === 0 ? '' : String(v);
      cell.className = 'nm-cell' + (v > 0 ? ` nm-v${v <= 2048 ? v : 'big'}` : '');
      if (v > 0 && cellPx > 0) {
        const len = String(v).length;
        const factor = len <= 2 ? 0.46 : len === 3 ? 0.36 : 0.27;
        cell.style.fontSize = `${Math.round(cellPx * factor)}px`;
      }
      if (placed === i) {
        cell.classList.remove('nm-pop');
        void cell.offsetWidth; // アニメ再トリガ
        cell.classList.add('nm-pop');
      }
    }
    if (scoreEl) scoreEl.textContent = `スコア ${score}`;
    if (maxEl) maxEl.textContent = `さいだい ${maxTile(board)}`;
  }

  // ---- 入力（スワイプ）----
  const swipeToDir: Record<SwipeDir, Dir> = { up: 'up', down: 'down', left: 'left', right: 'right' };
  const offSwipe = ctx.input.onSwipe((dir) => move(swipeToDir[dir]));

  // ---- 毎フレーム（ゲームオーバー→結果遷移のみ。ctx.now 基準＝ポーズで停止）----
  const offFrame = ctx.onFrame(() => {
    if (mode === 'over' && !ended && ctx.now() >= endAt) {
      ended = true;
      ctx.end({ score });
    }
  });

  // ---- 起動（startMode:'immediate'。設定画面から始まる）----
  showSetup();

  return {
    start() {
      // シェルのカウントダウンは省略。設定画面（showSetup）から開始する
    },
    pause() {
      hostPaused = true;
    },
    resume() {
      hostPaused = false;
    },
    resize() {
      if (mode === 'play') render(null); // セルサイズ変化に合わせてフォントを調整
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
// スタイル（.nm- プレフィックス。タイル色は固定・盤とUIはテーマ変数）
// =============================================================
const CSS = `
.nm-wrap{position:absolute;inset:0;overflow:hidden}

/* 設定画面 */
.nm-setup{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:safe center;
  gap:14px;padding:20px 16px;box-sizing:border-box;overflow-y:auto;user-select:none;-webkit-user-select:none}
.nm-h2{margin:4px 0;font-size:22px;text-align:center}
.nm-seg-row{width:min(92vw,420px);display:flex;flex-direction:column;gap:6px}
.nm-seg-label{font-size:13px;color:var(--text-dim);font-weight:800}
.nm-seg{display:flex;background:var(--bg-elev2);border-radius:12px;padding:3px;gap:2px}
.nm-seg-btn{flex:1;border:none;background:none;color:var(--text-dim);padding:10px 2px;border-radius:9px;
  font-size:14px;font-weight:800;min-height:44px}
.nm-seg-btn.nm-on{background:var(--accent);color:#fff}
.nm-note{font-size:12px;color:var(--text-dim);text-align:center;max-width:min(92vw,420px);margin:0;line-height:1.7}
.nm-btn{appearance:none;border:none;border-radius:12px;padding:12px 18px;font-size:15px;font-weight:800;font-family:inherit;
  background:var(--bg-elev2);color:var(--text);min-height:44px}
.nm-btn-primary{background:var(--accent-grad);color:#fff}
.nm-btn-lg{width:100%;max-width:320px;font-size:17px}

/* プレイ画面 */
.nm-play{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;padding:6px 10px 14px;box-sizing:border-box;
  user-select:none;-webkit-user-select:none}
.nm-hud{display:flex;justify-content:center;align-items:center;gap:20px;padding:2px 64px 4px;flex-wrap:wrap;min-height:54px}
.nm-hud-item{font-size:16px;font-weight:800;white-space:nowrap}

/* 盤 */
.nm-board{position:relative;width:min(92vw,440px);aspect-ratio:1;background:var(--bg-elev2);border-radius:14px;padding:8px;
  box-sizing:border-box;display:grid;grid-template-columns:repeat(var(--n),1fr);grid-template-rows:repeat(var(--n),1fr);
  gap:8px;margin:auto 0}
.nm-cell{border-radius:9px;background:rgba(127,127,160,.16);display:flex;align-items:center;justify-content:center;
  font-weight:900;font-variant-numeric:tabular-nums;line-height:1;color:#fff}
.nm-pop{animation:nm-pop .16s ease-out}
@keyframes nm-pop{from{transform:scale(.55)}to{transform:scale(1)}}

/* タイル色（固定・ライト/ダーク両方で読める） */
.nm-v2{background:#eee4da;color:#6b6459}
.nm-v4{background:#ede0c8;color:#6b6459}
.nm-v8{background:#f2b179}
.nm-v16{background:#f59563}
.nm-v32{background:#f67c5f}
.nm-v64{background:#f65e3b}
.nm-v128{background:#edcf72}
.nm-v256{background:#edcc61}
.nm-v512{background:#edc850}
.nm-v1024{background:#edc53f}
.nm-v2048{background:#edc22e;box-shadow:0 0 14px rgba(237,194,46,.7)}
.nm-vbig{background:#3c3a32}

/* 方向パッド */
.nm-pad{display:grid;grid-template-columns:repeat(3,1fr);grid-template-rows:auto auto;gap:8px;
  width:min(72vw,240px);margin-top:10px}
.nm-dir{appearance:none;border:none;border-radius:14px;background:var(--bg-elev2);color:var(--text);
  font-size:24px;font-weight:900;min-height:56px;font-family:inherit}
.nm-dir:active{transform:scale(.95)}
.nm-up{grid-column:2;grid-row:1}
.nm-left{grid-column:1;grid-row:2}
.nm-down{grid-column:2;grid-row:2}
.nm-right{grid-column:3;grid-row:2}

/* 勝利バナー・結果 */
.nm-win{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:26px;font-weight:900;
  color:#fff;background:rgba(237,194,46,.35);border-radius:14px;pointer-events:none;animation:nm-winfade 1.6s ease-out forwards}
@keyframes nm-winfade{0%{opacity:0}15%{opacity:1}70%{opacity:1}100%{opacity:0}}
.nm-over{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;
  background:rgba(16,19,48,.88);color:#fff;border-radius:14px;animation:nm-in .2s ease-out;padding:12px}
.nm-over-t{font-size:26px;font-weight:900}
.nm-over-s{font-size:20px;font-weight:800}
.nm-over-b{font-size:15px;font-weight:800;color:#ffd76a}
@keyframes nm-in{from{opacity:0;transform:scale(.96)}to{opacity:1;transform:scale(1)}}
`;
