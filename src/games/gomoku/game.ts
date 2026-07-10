// =============================================================
// 五目並べ（No.11）: CPU対戦。縦・横・斜めに5つ先に並べたら勝ち（自由五目・禁じ手なし）
// =============================================================
// - 先手/後手 と つよさ（3段階）を設定。石は直接タップで着手、「まった」で1手（相手ぶんも）もどせる
// - CPU の思考は engine.ts（脅威ヒューリスティック・乱数注入）。CPUの間は ctx.now 期限で少し待つ
// - 時間は ctx.now・乱数は ctx.random・setTimeout 不使用
// - import してよいのは game-api（types / helpers）と、このフォルダ内（engine）だけ
import type { GameContext, IGame } from '../../game-api/types';
import { elem, makeSeg } from '../../game-api/helpers';
import { chooseMove, isWin, winLine, type Level } from './engine';

const SIZE = 9;
const CPU_DELAY = 380; // CPUが考えるふり(ms・ctx.now基準)
const END_DELAY = 2000; // 勝敗演出→結果画面(ms)

type Side = 'black' | 'white';
type Mode = 'setup' | 'play' | 'over';
interface Config {
  side: Side;
  level: Level;
}
interface Move {
  idx: number;
  player: number;
}

const DIFF_BONUS: Record<Level, number> = { weak: 0, normal: 60, strong: 150 };
const BASE = 150;

export function createGame(ctx: GameContext): IGame {
  const saved = ctx.load<Partial<Config>>('config');
  const config: Config = {
    side: saved?.side === 'white' ? 'white' : 'black',
    level: saved?.level === 'normal' || saved?.level === 'strong' ? saved.level : 'weak',
  };

  let mode: Mode = 'setup';
  let hostPaused = false;
  let board = new Uint8Array(SIZE * SIZE);
  let turn = 1; // 1=黒(先手) / 2=白(後手)
  let me = 1; // プレイヤーの色
  let cpu = 2;
  let level: Level = config.level;
  const history: Move[] = [];
  let undoCount = 0;
  let pendingCpu = false;
  let cpuAt = 0;
  let result: 'win' | 'lose' | 'draw' | null = null;
  let winCells: number[] = [];
  let endAt = 0;
  let ended = false;
  let bannerUntil = 0;

  const style = document.createElement('style');
  style.textContent = CSS;
  const wrap = elem('div', 'gm-wrap');
  ctx.root.append(style, wrap);

  let cells: HTMLButtonElement[] = [];
  let boardEl: HTMLElement | null = null;
  let turnEl: HTMLElement | null = null;
  let undoBtn: HTMLButtonElement | null = null;
  let bannerEl: HTMLElement | null = null;

  const stoneChar = (v: number): string => (v === 1 ? '⚫' : v === 2 ? '⚪' : '');

  // ---- 設定画面 ----
  function showSetup(): void {
    mode = 'setup';
    const box = elem('div', 'gm-setup');
    box.append(elem('h2', 'gm-h2', '五目ならべ'));
    box.append(
      makeSeg(
        'gm',
        'あなたの手番',
        [
          { v: 'black', t: '先手（⚫）' },
          { v: 'white', t: '後手（⚪）' },
        ],
        () => config.side,
        (v) => {
          config.side = v as Side;
        },
      ),
      makeSeg(
        'gm',
        'CPUのつよさ',
        [
          { v: 'weak', t: 'よわい' },
          { v: 'normal', t: 'ふつう' },
          { v: 'strong', t: 'つよい' },
        ],
        () => config.level,
        (v) => {
          config.level = v as Level;
        },
      ),
    );
    box.append(elem('p', 'gm-note', 'たて・よこ・ななめ どれかに 同じ色を5つ 先にならべたら かち！先手（⚫）から はじめるよ。'));
    const start = elem('button', 'gm-btn gm-btn-primary gm-btn-lg', 'たいきょく ▶') as HTMLButtonElement;
    start.addEventListener('click', () => startMatch());
    box.append(start);
    wrap.replaceChildren(box);
  }

  // ---- 開始 ----
  function startMatch(): void {
    ctx.save('config', { ...config });
    level = config.level;
    me = config.side === 'black' ? 1 : 2;
    cpu = me === 1 ? 2 : 1;
    board = new Uint8Array(SIZE * SIZE);
    history.length = 0;
    undoCount = 0;
    turn = 1;
    result = null;
    winCells = [];
    ended = false;
    endAt = 0;
    pendingCpu = false;
    mode = 'play';
    buildPlay();
    if (turn === cpu) scheduleCpu(); // プレイヤーが後手なら CPU(黒) が先に打つ
    paintAll();
  }

  function buildPlay(): void {
    const play = elem('div', 'gm-play');
    turnEl = elem('div', 'gm-turn', '');
    boardEl = elem('div', 'gm-board');
    cells = [];
    for (let i = 0; i < SIZE * SIZE; i++) {
      const idx = i;
      const b = elem('button', 'gm-cell') as HTMLButtonElement;
      b.addEventListener('click', () => onCell(idx));
      cells.push(b);
      boardEl.append(b);
    }
    const tools = elem('div', 'gm-toolrow');
    undoBtn = elem('button', 'gm-tool', '↩ まった') as HTMLButtonElement;
    undoBtn.addEventListener('click', () => undo());
    tools.append(undoBtn);
    play.append(turnEl, boardEl, tools);
    wrap.replaceChildren(play);
    layout();
  }

  function layout(): void {
    if (!boardEl || !wrap) return;
    const availW = wrap.clientWidth - 16;
    const availH = wrap.clientHeight - 100; // HUD＋ツール＋余白
    const cell = Math.max(24, Math.floor(Math.min(availW, availH) / SIZE));
    boardEl.style.gridTemplateColumns = `repeat(${SIZE}, ${cell}px)`;
    boardEl.style.gridAutoRows = `${cell}px`;
    boardEl.style.fontSize = `${Math.round(cell * 0.78)}px`;
  }

  // ---- 着手 ----
  function onCell(idx: number): void {
    if (mode !== 'play' || hostPaused || turn !== me || pendingCpu) return;
    if ((board[idx] ?? 0) !== 0) return;
    place(idx, me);
    if (finishIfDone(idx, me)) return;
    turn = cpu;
    scheduleCpu();
    paintAll();
  }

  function place(idx: number, player: number): void {
    board[idx] = player;
    history.push({ idx, player });
    ctx.sfx('tap');
  }

  function scheduleCpu(): void {
    pendingCpu = true;
    cpuAt = ctx.now() + CPU_DELAY;
  }

  function doCpu(): void {
    pendingCpu = false;
    if (mode !== 'play') return;
    const idx = chooseMove(board, SIZE, cpu, me, level, ctx.random);
    place(idx, cpu);
    if (finishIfDone(idx, cpu)) return;
    turn = me;
    paintAll();
  }

  /** idx の着手で勝敗が決まったか。決まったら over へ進めて true */
  function finishIfDone(idx: number, player: number): boolean {
    if (isWin(board, SIZE, idx, player)) {
      winCells = winLine(board, SIZE, idx, player);
      over(player === me ? 'win' : 'lose');
      return true;
    }
    if (history.length >= SIZE * SIZE) {
      over('draw');
      return true;
    }
    return false;
  }

  function over(r: 'win' | 'lose' | 'draw'): void {
    mode = 'over';
    result = r;
    pendingCpu = false;
    if (r === 'win') {
      ctx.achieve('first-win');
      if (level === 'strong') ctx.achieve('beat-strong');
      if (me === 2) ctx.achieve('gote-win');
      if (undoCount === 0) ctx.achieve('no-undo');
      const myStones = history.filter((m) => m.player === me).length;
      if (myStones <= 8) ctx.achieve('quick');
      if (isDiagonal(winCells)) ctx.achieve('diagonal');
      ctx.sfx('medal');
      ctx.haptic('success');
    } else {
      ctx.sfx('fail');
      ctx.haptic('error');
    }
    showBanner(r === 'win' ? '🎉 かち！' : r === 'lose' ? 'まけ…' : 'ひきわけ', END_DELAY - 200);
    endAt = ctx.now() + END_DELAY;
    paintAll();
  }

  function isDiagonal(line: number[]): boolean {
    if (line.length < 2) return false;
    const a = line[0] ?? 0;
    const b = line[1] ?? 0;
    return ((a / SIZE) | 0) !== ((b / SIZE) | 0) && a % SIZE !== b % SIZE;
  }

  function computeScore(): number {
    if (result !== 'win') return result === 'draw' ? 60 : 0;
    const myStones = history.filter((m) => m.player === me).length;
    return BASE + DIFF_BONUS[level] + Math.max(0, (40 - myStones) * 4);
  }

  // ---- まった（プレイヤー手＋直前のCPU手をもどす）----
  function undo(): void {
    if (mode !== 'play' || hostPaused || turn !== me || pendingCpu) return;
    // 末尾が [自分, CPU] の並びのときだけ2手もどす
    const last = history[history.length - 1];
    const prev = history[history.length - 2];
    if (!last || !prev || last.player !== cpu || prev.player !== me) return;
    board[last.idx] = 0;
    board[prev.idx] = 0;
    history.pop();
    history.pop();
    undoCount++;
    turn = me;
    ctx.sfx('tick');
    paintAll();
  }

  // ---- バナー ----
  function showBanner(text: string, ms: number): void {
    hideBanner();
    if (!boardEl) return;
    bannerEl = elem('div', 'gm-banner', text);
    wrap.append(bannerEl);
    bannerUntil = ctx.now() + ms;
  }
  function hideBanner(): void {
    bannerEl?.remove();
    bannerEl = null;
    bannerUntil = 0;
  }

  // ---- 描画 ----
  function paintAll(): void {
    const lastIdx = history[history.length - 1]?.idx ?? -1;
    const winSet = new Set(winCells);
    for (let i = 0; i < SIZE * SIZE; i++) {
      const el = cells[i];
      if (!el) continue;
      const v = board[i] ?? 0;
      let cls = 'gm-cell';
      if (v) cls += ' gm-stone';
      if (i === lastIdx && mode !== 'over') cls += ' gm-last';
      if (winSet.has(i)) cls += ' gm-win';
      el.className = cls;
      el.textContent = stoneChar(v);
      el.disabled = mode !== 'play' || v !== 0 || turn !== me;
    }
    if (turnEl) {
      turnEl.textContent =
        mode === 'over'
          ? result === 'win'
            ? 'あなたの かち！'
            : result === 'lose'
              ? 'CPUの かち'
              : 'ひきわけ'
          : turn === me
            ? `あなたの ばん（${stoneChar(me)}）`
            : 'CPUが かんがえ中…';
    }
    if (undoBtn) {
      const last = history[history.length - 1];
      const prev = history[history.length - 2];
      undoBtn.disabled =
        mode !== 'play' || turn !== me || pendingCpu || !last || !prev || last.player !== cpu || prev.player !== me;
    }
  }

  // ---- 毎フレーム（CPU思考の間・バナー期限・結果遷移。すべて ctx.now）----
  const offFrame = ctx.onFrame(() => {
    const now = ctx.now();
    if (bannerEl && now >= bannerUntil) hideBanner();
    if (mode === 'play' && pendingCpu && now >= cpuAt) doCpu();
    else if (mode === 'over' && !ended && now >= endAt) {
      ended = true;
      ctx.end({ score: computeScore() });
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
.gm-wrap{position:absolute;inset:0;overflow:hidden}
.gm-setup{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:safe center;
  gap:14px;padding:20px 16px;box-sizing:border-box;overflow-y:auto;user-select:none;-webkit-user-select:none}
.gm-h2{margin:4px 0;font-size:22px}
.gm-seg-row{width:min(92vw,420px);display:flex;flex-direction:column;gap:6px}
.gm-seg-label{font-size:13px;color:var(--text-dim);font-weight:800}
.gm-seg{display:flex;background:var(--bg-elev2);border-radius:12px;padding:3px;gap:2px}
.gm-seg-btn{flex:1;border:none;background:none;color:var(--text-dim);padding:10px 2px;border-radius:9px;
  font-size:13px;font-weight:800;min-height:44px}
.gm-seg-btn.gm-on{background:var(--accent);color:#fff}
.gm-note{font-size:12px;color:var(--text-dim);text-align:center;max-width:min(92vw,420px);margin:0;line-height:1.7}
.gm-btn{appearance:none;border:none;border-radius:12px;padding:12px 18px;font-size:15px;font-weight:800;
  background:var(--bg-elev2);color:var(--text);min-height:44px}
.gm-btn-primary{background:var(--accent-grad);color:#fff}
.gm-btn-lg{width:100%;max-width:300px;font-size:18px}

.gm-play{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;padding:6px 8px 10px;
  box-sizing:border-box;user-select:none;-webkit-user-select:none}
.gm-turn{min-height:40px;display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:800;
  padding:0 64px;text-align:center}
.gm-board{display:grid;background:#d9a441;border:2px solid #a9761f;border-radius:6px;overflow:hidden;flex:0 0 auto}
.gm-cell{border:none;margin:0;padding:0;display:flex;align-items:center;justify-content:center;box-sizing:border-box;
  background:transparent;line-height:1;font-family:inherit;color:#111;
  border-right:1px solid rgba(90,50,10,.5);border-bottom:1px solid rgba(90,50,10,.5)}
.gm-cell:disabled{cursor:default}
.gm-stone{text-shadow:0 1px 2px rgba(0,0,0,.35)}
.gm-last{background:rgba(124,108,240,.30)}
.gm-win{background:rgba(255,201,77,.75)}
.gm-toolrow{display:flex;gap:8px;justify-content:center;padding-top:10px}
.gm-tool{appearance:none;border:none;border-radius:12px;min-height:44px;padding:8px 18px;font-size:14px;font-weight:800;
  background:var(--bg-elev2);color:var(--text)}
.gm-tool:disabled{opacity:.4}
.gm-banner{position:absolute;left:50%;top:46%;transform:translate(-50%,-50%);background:rgba(16,19,48,.9);color:#fff;
  padding:12px 24px;border-radius:999px;font-weight:800;font-size:22px;pointer-events:none;white-space:nowrap;z-index:5;
  animation:gm-pop .2s ease-out}
@keyframes gm-pop{from{opacity:0;transform:translate(-50%,-42%)}to{opacity:1;transform:translate(-50%,-50%)}}
`;
