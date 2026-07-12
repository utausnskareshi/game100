// =============================================================
// はこおしパズル（No.34）: はこを「押して」ぜんぶ⭐の上へ。引けないから1手先を読む！
// =============================================================
// - スワイプ／方向ボタンで1マスずつ移動。はこは押せるが引けない（かべぎわ注意！）。
// - 「まった」で1手もどす（何回でも）・「やりなおし」で最初から。
// - 盤面は gen.ts（完成形から逆に引いて崩す＝必ず解ける・rng注入で日替わり同一）。
// - スコア＝クリア基本点(150/220/300)＋はやさ max(0,120-秒)＋まったいらず+30。
// - startMode:'immediate'＝設定（むずかしさ3段）→即プレイ。時間は ctx.now。
// - import してよいのは game-api（types / helpers）と、このフォルダ内（gen）だけ
import type { GameContext, IGame, SwipeDir } from '../../game-api/types';
import { elem, makeSeg } from '../../game-api/helpers';
import { generatePuzzle, applyMove, isSolved, type Dir, type LevelKey, type Puzzle } from './gen';

type Mode = 'setup' | 'play' | 'over';

interface Config {
  level: LevelKey;
}

const BASE: Record<LevelKey, number> = { easy: 150, normal: 220, hard: 300 };
const SPEED_MAX = 120; // はやさボーナス max(0, 120-秒)
const NO_UNDO_BONUS = 30;
const END_DELAY = 1900;
const SPEEDY_SEC = 60; // 「そくたつびん」実績

export function createGame(ctx: GameContext): IGame {
  // ---- 設定（前回を復元。既定れんしゅう）----
  const saved = ctx.load<Partial<Config>>('config');
  const config: Config = {
    level: saved?.level === 'normal' || saved?.level === 'hard' ? saved.level : 'easy',
  };

  // ---- 状態 ----
  let mode: Mode = 'setup';
  let hostPaused = false;
  let level: LevelKey = config.level;
  let puzzle: Puzzle | null = null;
  let player = 0;
  let boxes: number[] = [];
  let moves = 0;
  let undoUsed = false;
  let playStart = 0;
  let score = 0;
  let endAt = 0;
  let ended = false;
  let lastSec = -1;
  const history: { player: number; boxes: number[] }[] = [];

  // ---- DOM ----
  const style = document.createElement('style');
  style.textContent = CSS;
  const wrap = elem('div', 'bx-wrap');
  ctx.root.append(style, wrap);

  let movesEl: HTMLElement | null = null;
  let timeEl: HTMLElement | null = null;
  let gridEl: HTMLElement | null = null;
  let msgEl: HTMLElement | null = null;
  let undoBtn: HTMLButtonElement | null = null;
  let resetBtn: HTMLButtonElement | null = null;
  let cells: HTMLElement[] = [];

  function devState(): void {
    if (!import.meta.env.DEV) return;
    const ds = wrap.dataset;
    ds.st = mode;
    ds.moves = String(moves);
    ds.undo = undoUsed ? '1' : '0';
    ds.player = String(player);
    ds.score = String(score);
  }

  // ---- 設定画面 ----
  function showSetup(): void {
    mode = 'setup';
    devState();
    const box = elem('div', 'bx-setup');
    box.append(elem('h2', 'bx-h2', 'そうこを おかたづけ！'));
    box.append(
      makeSeg(
        'bx',
        'むずかしさ',
        [
          { v: 'easy', t: 'れんしゅう' },
          { v: 'normal', t: 'ふつう' },
          { v: 'hard', t: 'むずかしい' },
        ],
        () => config.level,
        (v) => {
          config.level = v as LevelKey;
        },
      ),
    );
    box.append(
      elem(
        'p',
        'bx-note',
        '📦はこを 押して、ぜんぶ ⭐の上に のせよう。はこは 押せるけど 引けない！かべぎわに 押しこむと 動かせなくなるよ（そのときは「まった」か「やりなおし」）。',
      ),
    );
    const start = elem('button', 'bx-btn bx-btn-primary bx-btn-lg', 'はじめる ▶') as HTMLButtonElement;
    start.addEventListener('click', () => startPuzzle());
    box.append(start);
    wrap.replaceChildren(box);
  }

  // ---- 開始 ----
  function startPuzzle(): void {
    ctx.save('config', { ...config });
    level = config.level;
    puzzle = generatePuzzle(ctx.random, level);
    player = puzzle.playerStart;
    boxes = puzzle.boxesStart.slice();
    moves = 0;
    undoUsed = false;
    score = 0;
    ended = false;
    lastSec = -1;
    history.length = 0;
    buildPlay();
    mode = 'play';
    playStart = ctx.now();
    ctx.sfx('start');
    devState();
  }

  function buildPlay(): void {
    if (!puzzle) return;
    const n = puzzle.n;
    const play = elem('div', 'bx-play');

    const hud = elem('div', 'bx-hud');
    movesEl = elem('span', 'bx-hud-item', '0手');
    timeEl = elem('span', 'bx-hud-item', '⏱ 0びょう');
    hud.append(movesEl, timeEl);

    gridEl = elem('div', 'bx-grid');
    gridEl.style.setProperty('--n', String(n));
    cells = [];
    for (let i = 0; i < n * n; i++) {
      const cell = elem('div', 'bx-cell');
      if (puzzle.walls[i]) cell.classList.add('bx-wall');
      cells.push(cell);
      gridEl.append(cell);
    }
    msgEl = elem('div', 'bx-msg', 'ぜんぶの📦を ⭐へ！');

    const tools = elem('div', 'bx-tools');
    undoBtn = elem('button', 'bx-tool', '↩ まった') as HTMLButtonElement;
    undoBtn.addEventListener('click', () => undo());
    resetBtn = elem('button', 'bx-tool', '🔄 やりなおし') as HTMLButtonElement;
    resetBtn.addEventListener('click', () => resetPuzzle());
    tools.append(undoBtn, resetBtn);

    const pad = elem('div', 'bx-pad');
    const mk = (dir: Dir, label: string, cls: string): HTMLButtonElement => {
      const b = elem('button', `bx-dir ${cls}`, label) as HTMLButtonElement;
      b.addEventListener('click', () => move(dir));
      return b;
    };
    pad.append(mk('up', '▲', 'bx-up'), mk('left', '◀', 'bx-left'), mk('down', '▼', 'bx-down'), mk('right', '▶', 'bx-right'));

    play.append(hud, gridEl, msgEl, tools, pad);
    wrap.replaceChildren(play);
    paintBoard();
    const cellPx = cells[0]?.clientWidth ?? 0;
    if (cellPx > 0) gridEl.style.fontSize = `${Math.round(cellPx * 0.66)}px`;
  }

  function paintBoard(): void {
    if (!puzzle) return;
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i]!;
      if (puzzle.walls[i]) continue;
      const isGoal = puzzle.goals.includes(i);
      const isBox = boxes.includes(i);
      const isPlayer = player === i;
      c.classList.toggle('bx-goal', isGoal);
      c.classList.toggle('bx-boxon', isBox && isGoal);
      c.textContent = isPlayer ? '🐶' : isBox ? '📦' : isGoal ? '⭐' : '';
    }
  }

  // ---- 操作 ----
  function move(dir: Dir): void {
    if (mode !== 'play' || hostPaused || !puzzle) return;
    const r = applyMove(puzzle.walls, puzzle.n, player, boxes, dir);
    if (!r.moved) {
      ctx.sfx('tick');
      return;
    }
    history.push({ player, boxes });
    player = r.player;
    boxes = r.boxes;
    moves++;
    if (movesEl) movesEl.textContent = `${moves}手`;
    ctx.sfx('tap');
    if (r.pushed) ctx.haptic('light');
    paintBoard();
    devState();
    if (isSolved(boxes, puzzle.goals)) win();
  }

  function undo(): void {
    if (mode !== 'play' || hostPaused || history.length === 0) return;
    const prev = history.pop()!;
    player = prev.player;
    boxes = prev.boxes;
    moves++;
    undoUsed = true;
    if (movesEl) movesEl.textContent = `${moves}手`;
    ctx.sfx('tick');
    paintBoard();
    devState();
  }

  function resetPuzzle(): void {
    if (mode !== 'play' || hostPaused || !puzzle) return;
    history.push({ player, boxes });
    player = puzzle.playerStart;
    boxes = puzzle.boxesStart.slice();
    undoUsed = true;
    ctx.sfx('tick');
    paintBoard();
    devState();
  }

  function win(): void {
    if (!puzzle) return;
    mode = 'over';
    const sec = Math.floor((ctx.now() - playStart) / 1000);
    score = BASE[level] + Math.max(0, SPEED_MAX - sec) + (undoUsed ? 0 : NO_UNDO_BONUS);
    ctx.achieve('first-clear');
    if (level === 'normal') ctx.achieve('clear-normal');
    if (level === 'hard') ctx.achieve('clear-hard');
    if (!undoUsed) ctx.achieve('no-undo');
    if (sec <= SPEEDY_SEC) ctx.achieve('speedy');
    const cleared = ctx.load<Record<string, boolean>>('cleared') ?? {};
    cleared[level] = true;
    ctx.save('cleared', cleared);
    if (cleared.easy && cleared.normal && cleared.hard) ctx.achieve('all-levels');
    if (msgEl) {
      msgEl.className = 'bx-msg bx-msg-win';
      msgEl.textContent = `おかたづけ かんりょう！ 🎉 +${score}`;
    }
    gridEl?.classList.add('bx-win');
    ctx.sfx('medal');
    ctx.haptic('success');
    endAt = ctx.now() + END_DELAY;
    devState();
  }

  // ---- 入力（スワイプ）----
  const swipeToDir: Record<SwipeDir, Dir> = { up: 'up', down: 'down', left: 'left', right: 'right' };
  const offSwipe = ctx.input.onSwipe((dir) => move(swipeToDir[dir]));

  // ---- 毎フレーム（タイマー表示・結果遷移）----
  const offFrame = ctx.onFrame(() => {
    const now = ctx.now();
    if (mode === 'play') {
      const sec = Math.floor((now - playStart) / 1000);
      if (sec !== lastSec) {
        lastSec = sec;
        if (timeEl) timeEl.textContent = `⏱ ${sec}びょう`;
      }
      return;
    }
    if (mode === 'over' && !ended && now >= endAt) {
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
      const cellPx = cells[0]?.clientWidth ?? 0;
      if (cellPx > 0 && gridEl) gridEl.style.fontSize = `${Math.round(cellPx * 0.66)}px`;
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
// スタイル（.bx- プレフィックス。盤はテーマ変数）
// =============================================================
const CSS = `
.bx-wrap{position:absolute;inset:0;overflow:hidden}

/* 設定画面 */
.bx-setup{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:safe center;
  gap:14px;padding:20px 16px;box-sizing:border-box;overflow-y:auto;user-select:none;-webkit-user-select:none}
.bx-h2{margin:4px 0;font-size:22px;text-align:center}
.bx-seg-row{width:min(92vw,420px);display:flex;flex-direction:column;gap:6px}
.bx-seg-label{font-size:13px;color:var(--text-dim);font-weight:800}
.bx-seg{display:flex;background:var(--bg-elev2);border-radius:12px;padding:3px;gap:2px}
.bx-seg-btn{flex:1;border:none;background:none;color:var(--text-dim);padding:10px 2px;border-radius:9px;
  font-size:13px;font-weight:800;min-height:44px}
.bx-seg-btn.bx-on{background:var(--accent);color:#fff}
.bx-note{font-size:12px;color:var(--text-dim);text-align:center;max-width:min(92vw,420px);margin:0;line-height:1.7}
.bx-btn{appearance:none;border:none;border-radius:12px;padding:12px 18px;font-size:15px;font-weight:800;font-family:inherit;
  background:var(--bg-elev2);color:var(--text);min-height:44px}
.bx-btn-primary{background:var(--accent-grad);color:#fff}
.bx-btn-lg{width:100%;max-width:300px;font-size:18px}

/* プレイ画面 */
.bx-play{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;padding:6px 10px 12px;
  box-sizing:border-box;user-select:none;-webkit-user-select:none}
.bx-hud{display:flex;justify-content:center;align-items:center;gap:16px;padding:2px 64px 4px;flex-wrap:wrap;min-height:54px}
.bx-hud-item{font-size:14px;font-weight:800;white-space:nowrap;font-variant-numeric:tabular-nums}
.bx-grid{width:min(88vw,400px);aspect-ratio:1;background:var(--bg-elev2);border-radius:12px;padding:6px;box-sizing:border-box;
  display:grid;grid-template-columns:repeat(var(--n),1fr);grid-template-rows:repeat(var(--n),1fr);gap:2px;line-height:1}
.bx-cell{display:flex;align-items:center;justify-content:center;border-radius:6px;background:var(--bg)}
.bx-cell.bx-wall{background:var(--text-dim);opacity:.55;border-radius:4px}
.bx-cell.bx-goal{box-shadow:inset 0 0 0 2px rgba(255,201,77,.7)}
.bx-cell.bx-boxon{background:rgba(62,211,106,.25)}
@keyframes bx-winpulse{0%,100%{transform:scale(1)}50%{transform:scale(1.02)}}
.bx-grid.bx-win{animation:bx-winpulse .6s ease-in-out 2}
.bx-msg{min-height:24px;font-size:15px;font-weight:900;color:var(--text-dim);margin:8px 0 0;text-align:center}
.bx-msg-win{color:#2fae5e}

/* まった・やりなおし */
.bx-tools{display:flex;gap:10px;margin-top:8px}
.bx-tool{appearance:none;border:none;border-radius:12px;padding:0 16px;font-size:14px;font-weight:800;font-family:inherit;
  background:var(--bg-elev2);color:var(--text);min-height:44px}
.bx-tool:active{transform:scale(.96)}

/* 方向パッド */
.bx-pad{display:grid;grid-template-columns:repeat(3,1fr);grid-template-rows:auto auto;gap:8px;
  width:min(72vw,240px);margin-top:auto;padding-top:10px}
.bx-dir{appearance:none;border:none;border-radius:14px;background:var(--bg-elev2);color:var(--text);
  font-size:24px;font-weight:900;min-height:52px;font-family:inherit}
.bx-dir:active{transform:scale(.95)}
.bx-up{grid-column:2;grid-row:1}
.bx-left{grid-column:1;grid-row:2}
.bx-down{grid-column:2;grid-row:2}
.bx-right{grid-column:3;grid-row:2}
`;
