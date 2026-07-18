// =============================================================
// まるばつゲーム（No.51）: CPUと〇×の5番勝負！3つならべたら かち
// =============================================================
// - 先手/後手（1局め）と つよさ（3段階）を設定。先手が〇（局ごとに先手交代＝しるしも交代）。
// - CPU の思考は engine.ts（つよい=完全読み・乱数注入）。CPUの間は ctx.now 期限で少し待つ。
// - スコア=5局の合計（勝ち/引き分けに つよさボーナス）。時間は ctx.now・setTimeout 不使用。
// - import してよいのは game-api（types / helpers）と、このフォルダ内（engine）だけ
import type { GameContext, IGame } from '../../game-api/types';
import { elem, makeSeg } from '../../game-api/helpers';
import { chooseMove, winLine, winnerOf, winningMoves, type Level } from './engine';

const ROUNDS = 5;
const CPU_DELAY = 420; // CPUが考えるふり(ms・ctx.now基準)
const ROUND_START_MS = 950; // 局はじめのバナー表示
const ROUND_END_MS = 1650; // 局おわりのバナー→次の局
const END_DELAY = 1500; // 最終局→結果画面
const TOTAL_WINS_GOAL = 15; // 通算実績

// 1局ごとの得点（勝ち/引き分け × つよさ）。理論最大=ふつう5勝600/つよいは全引き分け400が上限
const WIN_PTS: Record<Level, number> = { weak: 100, normal: 120, strong: 160 };
const DRAW_PTS: Record<Level, number> = { weak: 40, normal: 55, strong: 80 };

type Mode = 'setup' | 'play' | 'between' | 'over';
type RoundResult = 'win' | 'lose' | 'draw';
interface Config {
  first: 'me' | 'cpu';
  level: Level;
}

export function createGame(ctx: GameContext): IGame {
  const saved = ctx.load<Partial<Config>>('config');
  const config: Config = {
    first: saved?.first === 'cpu' ? 'cpu' : 'me',
    level: saved?.level === 'normal' || saved?.level === 'strong' ? saved.level : 'weak',
  };
  let totalWins = ctx.load<number>('wins') ?? 0;

  let mode: Mode = 'setup';
  let hostPaused = false;
  let level: Level = config.level;
  let board: number[] = new Array<number>(9).fill(0);
  let round = 1;
  let meMark = 1; // 1=〇(先手) / 2=×(後手)。先手は局ごとに交代
  let cpuMark = 2;
  let turn = 1; // いま置く番のしるし（〇=1 から）
  let score = 0;
  const results: RoundResult[] = [];
  let winCells: number[] = [];
  let pendingCpu = false;
  let cpuAt = 0;
  let nextRoundAt = 0;
  let roundStartUntil = 0; // 局はじめバナーの間は入力を受けない
  let endAt = 0;
  let ended = false;

  const style = document.createElement('style');
  style.textContent = CSS;
  const wrap = elem('div', 'tt-wrap');
  ctx.root.append(style, wrap);

  let cells: HTMLButtonElement[] = [];
  let boardEl: HTMLElement | null = null;
  let headEl: HTMLElement | null = null;
  let pipsEl: HTMLElement | null = null;
  let bannerEl: HTMLElement | null = null;
  let bannerUntil = 0;

  const markChar = (v: number): string => (v === 1 ? '〇' : v === 2 ? '×' : '');

  function setData(): void {
    if (!import.meta.env.DEV) return;
    const r = ctx.root as HTMLElement;
    r.dataset.mode = mode;
    r.dataset.round = String(round);
    r.dataset.score = String(score);
    r.dataset.turn = String(turn);
    r.dataset.me = String(meMark);
    r.dataset.board = board.join('');
    r.dataset.results = results.join(',');
    r.dataset.wins = String(totalWins);
  }

  // ---- 設定画面 ----
  function showSetup(): void {
    mode = 'setup';
    const box = elem('div', 'tt-setup');
    box.append(elem('h2', 'tt-h2', 'まるばつゲーム'));
    box.append(
      makeSeg(
        'tt',
        '1局めの手番',
        [
          { v: 'me', t: '先手（〇）' },
          { v: 'cpu', t: '後手（×）' },
        ],
        () => config.first,
        (v) => {
          config.first = v as Config['first'];
        },
      ),
      makeSeg(
        'tt',
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
    box.append(elem('p', 'tt-note', 'たて・よこ・ななめに 自分のしるしを 3つ ならべたら かち！ぜんぶで5局、先手は 1局ごとに こうたいするよ。'));
    const start = elem('button', 'tt-btn tt-btn-primary tt-btn-lg', '5番勝負 ▶') as HTMLButtonElement;
    start.addEventListener('click', () => startMatch());
    box.append(start);
    wrap.replaceChildren(box);
    setData();
  }

  // ---- 5番勝負の開始 ----
  function startMatch(): void {
    ctx.save('config', { ...config });
    level = config.level;
    score = 0;
    results.length = 0;
    ended = false;
    endAt = 0;
    buildPlay();
    startRound(1);
  }

  function buildPlay(): void {
    const play = elem('div', 'tt-play');
    headEl = elem('div', 'tt-head', '');
    pipsEl = elem('div', 'tt-pips');
    boardEl = elem('div', 'tt-board');
    cells = [];
    for (let i = 0; i < 9; i++) {
      const idx = i;
      const b = elem('button', 'tt-cell') as HTMLButtonElement;
      b.addEventListener('click', () => onCell(idx));
      cells.push(b);
      boardEl.append(b);
    }
    play.append(headEl, pipsEl, boardEl);
    wrap.replaceChildren(play);
    layout();
  }

  function layout(): void {
    if (!boardEl) return;
    const availW = wrap.clientWidth - 24;
    const availH = wrap.clientHeight - 130; // 見出し＋ピップ＋余白
    const cell = Math.max(56, Math.min(110, Math.floor(Math.min(availW, availH) / 3) - 6));
    boardEl.style.gridTemplateColumns = `repeat(3, ${cell}px)`;
    boardEl.style.gridAutoRows = `${cell}px`;
    boardEl.style.fontSize = `${Math.round(cell * 0.8)}px`;
  }

  // ---- 局の進行 ----
  function startRound(n: number): void {
    round = n;
    board = new Array<number>(9).fill(0);
    winCells = [];
    pendingCpu = false;
    turn = 1;
    // 先手（〇）は1局ごとに交代。1局めは設定どおり
    const meFirst = (config.first === 'me') === (n % 2 === 1);
    meMark = meFirst ? 1 : 2;
    cpuMark = meFirst ? 2 : 1;
    mode = 'play';
    roundStartUntil = ctx.now() + ROUND_START_MS;
    showBanner(`だい${n}きょく ▶ あなたは ${markChar(meMark)}`, ROUND_START_MS - 100);
    if (!meFirst) scheduleCpu(ROUND_START_MS + CPU_DELAY);
    paintAll();
    setData();
  }

  function onCell(idx: number): void {
    if (mode !== 'play' || hostPaused || pendingCpu) return;
    if (ctx.now() < roundStartUntil) return;
    if (turn !== meMark || board[idx] !== 0) return;
    // ダブルリーチ検出: この手を打つ前に「即勝ちマス」が2つ以上→ふさぎ切れない形を作っていた
    const forkBefore = winningMoves(board, meMark).length;
    board[idx] = meMark;
    ctx.sfx('tap');
    if (finishIfDone()) {
      if (winnerOf(board) === meMark && forkBefore >= 2) ctx.achieve('fork-win');
      return;
    }
    turn = cpuMark;
    scheduleCpu(CPU_DELAY);
    paintAll();
    setData();
  }

  function scheduleCpu(delay: number): void {
    pendingCpu = true;
    cpuAt = ctx.now() + delay;
  }

  function doCpu(): void {
    pendingCpu = false;
    if (mode !== 'play') return;
    const idx = chooseMove(board, cpuMark, level, ctx.random);
    if (idx >= 0) board[idx] = cpuMark;
    ctx.sfx('tick');
    if (finishIfDone()) return;
    turn = meMark;
    paintAll();
    setData();
  }

  /** 勝敗 or 引き分けが決まったら局を締めて true */
  function finishIfDone(): boolean {
    const w = winnerOf(board);
    if (w !== 0) {
      winCells = winLine(board);
      roundOver(w === meMark ? 'win' : 'lose');
      return true;
    }
    if (board.every((v) => v !== 0)) {
      roundOver('draw');
      return true;
    }
    return false;
  }

  function roundOver(r: RoundResult): void {
    mode = 'between';
    pendingCpu = false;
    results.push(r);
    let gained = 0;
    if (r === 'win') {
      gained = WIN_PTS[level];
      ctx.sfx('success');
      ctx.haptic('success');
      ctx.achieve('first-win');
      totalWins++;
      ctx.save('wins', totalWins);
      if (totalWins >= TOTAL_WINS_GOAL) ctx.achieve('total-15');
    } else if (r === 'draw') {
      gained = DRAW_PTS[level];
      ctx.sfx('tick');
      if (level === 'strong') ctx.achieve('draw-strong');
    } else {
      ctx.sfx('fail');
      ctx.haptic('error');
    }
    score += gained;
    const text = r === 'win' ? `かち！ +${gained}` : r === 'draw' ? `ひきわけ +${gained}` : 'まけ…';
    showBanner(text, ROUND_END_MS - 150);
    if (round >= ROUNDS) {
      // 5局めは 勝ち/負け/引き分け どの終わり方でも ここで必ず締める
      const wins = results.filter((x) => x === 'win').length;
      const losses = results.filter((x) => x === 'lose').length;
      if (wins === ROUNDS) ctx.achieve('sweep');
      if (losses === 0) ctx.achieve('no-loss');
      mode = 'over';
      endAt = ctx.now() + END_DELAY;
    } else {
      nextRoundAt = ctx.now() + ROUND_END_MS;
    }
    paintAll();
    setData();
  }

  // ---- バナー ----
  function showBanner(text: string, ms: number): void {
    hideBanner();
    bannerEl = elem('div', 'tt-banner', text);
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
    const winSet = new Set(winCells);
    for (let i = 0; i < 9; i++) {
      const el = cells[i];
      if (!el) continue;
      const v = board[i] ?? 0;
      let cls = 'tt-cell';
      if (v === 1) cls += ' tt-o';
      if (v === 2) cls += ' tt-x';
      if (winSet.has(i)) cls += ' tt-wincell';
      el.className = cls;
      el.textContent = markChar(v);
      el.disabled = mode !== 'play' || v !== 0 || turn !== meMark || pendingCpu;
    }
    if (headEl) {
      const who =
        mode === 'play'
          ? turn === meMark
            ? `あなたの ばん（${markChar(meMark)}）`
            : 'CPUが かんがえ中…'
          : mode === 'over'
            ? '5番勝負 おわり！'
            : `つぎの局へ…`;
      headEl.textContent = `だい${round}きょく/${ROUNDS}　${who}`;
    }
    if (pipsEl) {
      pipsEl.replaceChildren(
        ...Array.from({ length: ROUNDS }, (_, i) => {
          const r = results[i];
          const p = elem('span', 'tt-pip' + (r === 'win' ? ' tt-pip-w' : r === 'lose' ? ' tt-pip-l' : r === 'draw' ? ' tt-pip-d' : ''));
          p.textContent = r === 'win' ? '○' : r === 'lose' ? '●' : r === 'draw' ? '－' : '・';
          return p;
        }),
        elem('span', 'tt-score', `スコア ${score}`),
      );
    }
  }

  // ---- 毎フレーム（CPU思考・局間・終了。すべて ctx.now 期限）----
  const offFrame = ctx.onFrame(() => {
    if (hostPaused) return;
    const now = ctx.now();
    if (bannerEl && now >= bannerUntil) hideBanner();
    if (mode === 'play' && pendingCpu && now >= cpuAt) doCpu();
    else if (mode === 'between' && now >= nextRoundAt && nextRoundAt > 0) {
      nextRoundAt = 0;
      startRound(round + 1);
    } else if (mode === 'over' && !ended && now >= endAt) {
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
.tt-wrap{position:absolute;inset:0;overflow:hidden}
.tt-setup{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:safe center;
  gap:14px;padding:20px 16px;box-sizing:border-box;overflow-y:auto;user-select:none;-webkit-user-select:none}
.tt-h2{margin:4px 0;font-size:22px}
.tt-seg-row{width:min(92vw,420px);display:flex;flex-direction:column;gap:6px}
.tt-seg-label{font-size:13px;color:var(--text-dim);font-weight:800}
.tt-seg{display:flex;background:var(--bg-elev2);border-radius:12px;padding:3px;gap:2px}
.tt-seg-btn{flex:1;border:none;background:none;color:var(--text-dim);padding:10px 2px;border-radius:9px;
  font-size:13px;font-weight:800;min-height:44px}
.tt-seg-btn.tt-on{background:var(--accent);color:#fff}
.tt-note{font-size:12px;color:var(--text-dim);text-align:center;max-width:min(92vw,420px);margin:0;line-height:1.7}
.tt-btn{appearance:none;border:none;border-radius:12px;padding:12px 18px;font-size:15px;font-weight:800;
  background:var(--bg-elev2);color:var(--text);min-height:44px}
.tt-btn-primary{background:var(--accent-grad);color:#fff}
.tt-btn-lg{width:100%;max-width:300px;font-size:18px}

.tt-play{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;
  gap:12px;padding:8px 10px 14px;box-sizing:border-box;user-select:none;-webkit-user-select:none}
.tt-head{min-height:40px;display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:800;
  padding:0 64px;text-align:center}
.tt-pips{display:flex;align-items:center;gap:8px;font-size:18px;font-weight:800;color:var(--text-dim)}
.tt-pip-w{color:#2fae60}
.tt-pip-l{color:#e0524a}
.tt-pip-d{color:#d99a1f}
.tt-score{margin-left:10px;font-size:14px;color:var(--text)}
.tt-board{display:grid;gap:6px;background:var(--bg-elev2);padding:10px;border-radius:16px}
.tt-cell{border:none;margin:0;padding:0;display:flex;align-items:center;justify-content:center;box-sizing:border-box;
  background:var(--bg-elev1,rgba(255,255,255,.06));border-radius:12px;line-height:1;font-family:inherit;font-size:inherit;
  font-weight:800;color:var(--text);overflow:hidden}
.tt-cell:disabled{cursor:default;opacity:1}
.tt-o{color:#e0524a}
.tt-x{color:#4a7de0}
.tt-wincell{background:rgba(255,201,77,.55)}
.tt-banner{position:absolute;left:50%;top:44%;transform:translate(-50%,-50%);background:rgba(16,19,48,.9);color:#fff;
  padding:12px 24px;border-radius:999px;font-weight:800;font-size:20px;pointer-events:none;white-space:nowrap;z-index:5;
  animation:tt-pop .2s ease-out}
@keyframes tt-pop{from{opacity:0;transform:translate(-50%,-42%)}to{opacity:1;transform:translate(-50%,-50%)}}
`;
