// =============================================================
// ひとふでがき（No.36）: 岩いがいのマスを、1本の線でぜんぶ通る一筆書きパズル
// =============================================================
// - ドラッグ（またはタップ）で線をのばす。線上のマスに戻ると、そこまで巻き戻し（かきなおし）。
// - どのマスから始めてもよい。1プレイ3問（だんだん大きく）。
// - 盤面は logic.ts（道を先に作ってから岩を置く＝必ず解ける・rng注入で日替わり同一）。
// - スコア＝問ごと 100＋マス数×2＋はやさ max(0,(30+マス数)−秒)×2＋やりなおし無し+50。
// - startMode:'immediate'＝設定（むずかしさ3段）→即プレイ。時間は ctx.now 期限方式。
// - import してよいのは game-api（types / helpers）と、このフォルダ内（logic）だけ
import type { GameContext, IGame, PointerInfo } from '../../game-api/types';
import { elem, makeSeg } from '../../game-api/helpers';
import { generatePuzzle, isAdjacent, type StrokePuzzle } from './logic';

type Preset = 'easy' | 'normal' | 'hard';
type Mode = 'setup' | 'play' | 'win';

interface Config {
  preset: Preset;
}

interface RoundSpec {
  cols: number;
  rows: number;
  blocks: number;
}

const ROUNDS: Record<Preset, RoundSpec[]> = {
  easy: [
    { cols: 4, rows: 4, blocks: 0 },
    { cols: 5, rows: 4, blocks: 1 },
    { cols: 5, rows: 5, blocks: 2 },
  ],
  normal: [
    { cols: 5, rows: 5, blocks: 2 },
    { cols: 6, rows: 5, blocks: 3 },
    { cols: 6, rows: 6, blocks: 4 },
  ],
  hard: [
    { cols: 6, rows: 6, blocks: 3 },
    { cols: 7, rows: 6, blocks: 4 },
    { cols: 7, rows: 7, blocks: 5 },
  ],
};

const ROUND_BASE = 100;
const NO_RETRY_BONUS = 50; // 問ごと・やりなおし未使用
const NEXT_MS = 1500; // 問クリア演出→次の問まで
const END_DELAY = 1900; // 3問クリア演出→結果画面まで
const SPEEDY_SEC = 20; // 「いっきがき」実績

export function createGame(ctx: GameContext): IGame {
  // ---- 設定（前回を復元。既定やさしい）----
  const saved = ctx.load<Partial<Config>>('config');
  const config: Config = {
    preset: saved?.preset === 'normal' || saved?.preset === 'hard' ? saved.preset : 'easy',
  };

  // ---- 状態 ----
  let mode: Mode = 'setup';
  let hostPaused = false;
  let preset: Preset = config.preset;
  let roundIdx = 0;
  let puzzle: StrokePuzzle | null = null;
  let line: number[] = []; // プレイヤーの線（マス番号列）
  let onLine: boolean[] = []; // マス番号 → 線上か
  let roundDone = false; // クリア演出中は入力を止める
  let retriedRound = false;
  let retriesTotal = 0;
  let roundStart = 0;
  let total = 0;
  let nextRoundAt = 0;
  let endAt = 0;
  let ended = false;
  let activePid: number | null = null;
  let lastSec = -1;

  // ---- DOM ----
  const style = document.createElement('style');
  style.textContent = CSS;
  const wrap = elem('div', 'os-wrap');
  ctx.root.append(style, wrap);

  let playEl: HTMLElement | null = null;
  let hudRoundEl: HTMLElement | null = null;
  let hudTimeEl: HTMLElement | null = null;
  let hudScoreEl: HTMLElement | null = null;
  let boardEl: HTMLElement | null = null;
  let msgEl: HTMLElement | null = null;
  let cells: HTMLElement[] = [];

  function devState(): void {
    if (!import.meta.env.DEV) return;
    const ds = wrap.dataset;
    ds.st = mode;
    ds.round = String(roundIdx);
    ds.total = String(total);
    ds.retries = String(retriesTotal);
    ds.len = String(line.length);
    ds.open = String(puzzle?.path.length ?? 0);
  }

  // ---- 設定画面 ----
  function showSetup(): void {
    mode = 'setup';
    devState();
    const box = elem('div', 'os-setup');
    box.append(elem('h2', 'os-h2', 'ひとふでがき ✍️'));
    box.append(
      makeSeg(
        'os',
        'むずかしさ',
        [
          { v: 'easy', t: 'やさしい' },
          { v: 'normal', t: 'ふつう' },
          { v: 'hard', t: 'むずかしい' },
        ],
        () => config.preset,
        (v) => {
          config.preset = v as Preset;
        },
      ),
    );
    box.append(
      elem(
        'p',
        'os-note',
        '岩🪨いがいのマスを、1本の線で ぜんぶ通ろう。線は じぶんと交差できないよ。どのマスから始めてもOK！ぜんぶで3もん。',
      ),
    );
    const start = elem('button', 'os-btn os-btn-primary os-btn-lg', 'はじめる ▶') as HTMLButtonElement;
    start.addEventListener('click', () => startRun());
    box.append(start);
    wrap.replaceChildren(box);
  }

  // ---- 開始 ----
  function startRun(): void {
    ctx.save('config', { ...config });
    preset = config.preset;
    roundIdx = 0;
    total = 0;
    retriesTotal = 0;
    ended = false;
    endAt = 0;
    mode = 'play';
    ctx.sfx('start');
    startRound();
  }

  function startRound(): void {
    const spec = ROUNDS[preset][roundIdx]!;
    puzzle = generatePuzzle(ctx.random, spec.cols, spec.rows, spec.blocks);
    line = [];
    onLine = new Array(spec.cols * spec.rows).fill(false);
    roundDone = false;
    retriedRound = false;
    lastSec = -1;
    buildPlay();
    roundStart = ctx.now();
    devState();
  }

  function buildPlay(): void {
    if (!puzzle) return;
    playEl = elem('div', 'os-play');

    const hud = elem('div', 'os-hud');
    hudRoundEl = elem('span', 'os-hud-item', `もん ${roundIdx + 1}/3`);
    hudTimeEl = elem('span', 'os-hud-item', '⏱ 0びょう');
    hudScoreEl = elem('span', 'os-hud-item', `スコア ${total}`);
    hud.append(hudRoundEl, hudTimeEl, hudScoreEl);

    const boardWrap = elem('div', 'os-board-wrap');
    boardEl = elem('div', 'os-board');
    cells = [];
    for (let i = 0; i < puzzle.cols * puzzle.rows; i++) {
      const c = elem('div', 'os-cell');
      if (puzzle.blocked[i]) {
        c.classList.add('os-rock');
        c.textContent = '🪨';
      }
      cells.push(c);
      boardEl.append(c);
    }
    boardWrap.append(boardEl);

    msgEl = elem('div', 'os-msg', 'すきなマスから スタート！');

    const tools = elem('div', 'os-tools');
    const retryBtn = elem('button', 'os-tool', '🔄 やりなおし') as HTMLButtonElement;
    retryBtn.addEventListener('click', () => retryRound());
    tools.append(retryBtn);

    playEl.append(hud, boardWrap, msgEl, tools);
    wrap.replaceChildren(playEl);
    layout();
  }

  // セル一辺を「幅・高さの両方に収まる」ように計算（pair-match と同方式）
  function layout(): void {
    if (!playEl || !boardEl || !puzzle) return;
    const GAP = 4; // .os-board の gap と一致させること
    const PAD = 12; // .os-board の padding 6px × 2
    const hudH = 54;
    const bottomH = 96; // msg + tools
    const availW = playEl.clientWidth - 8 - (puzzle.cols - 1) * GAP - PAD;
    const availH = playEl.clientHeight - hudH - bottomH - (puzzle.rows - 1) * GAP - PAD;
    const cell = Math.max(34, Math.min(64, Math.floor(Math.min(availW / puzzle.cols, availH / puzzle.rows))));
    boardEl.style.gridTemplateColumns = `repeat(${puzzle.cols}, ${cell}px)`;
    boardEl.style.gridAutoRows = `${cell}px`;
    boardEl.style.fontSize = `${Math.round(cell * 0.58)}px`;
  }

  // ---- 線の描画 ----
  const DIR_CLASSES = ['os-cl', 'os-cr', 'os-cu', 'os-cd'];
  function connClass(from: number, to: number): string {
    if (!puzzle) return '';
    const d = to - from;
    if (d === 1) return 'os-cl'; // 左の前任から来た → 左へブリッジ
    if (d === -1) return 'os-cr';
    if (d === puzzle.cols) return 'os-cu';
    return 'os-cd';
  }

  function paintLine(): void {
    if (!puzzle) return;
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i]!;
      if (puzzle.blocked[i]) continue;
      c.classList.toggle('os-on', onLine[i] === true);
      c.classList.remove('os-head', ...DIR_CLASSES);
    }
    for (let k = 0; k < line.length; k++) {
      const cell = cells[line[k]!]!;
      if (k > 0) cell.classList.add(connClass(line[k - 1]!, line[k]!));
      if (k === line.length - 1) cell.classList.add('os-head');
    }
    devState();
  }

  // ---- 入力 ----
  function cellFromPoint(p: PointerInfo): number {
    if (!boardEl || !puzzle) return -1;
    const b = boardEl.getBoundingClientRect();
    const r = ctx.root.getBoundingClientRect();
    const x = p.x - (b.left - r.left) - 6; // padding 6px
    const y = p.y - (b.top - r.top) - 6;
    if (x < 0 || y < 0) return -1;
    const cellPx = (b.width - 12 - (puzzle.cols - 1) * 4) / puzzle.cols;
    const pitch = cellPx + 4;
    const cx = Math.floor(x / pitch);
    const cy = Math.floor(y / pitch);
    if (cx < 0 || cx >= puzzle.cols || cy < 0 || cy >= puzzle.rows) return -1;
    return cy * puzzle.cols + cx;
  }

  function handleCell(i: number): void {
    if (mode !== 'play' || hostPaused || roundDone || !puzzle) return;
    if (i < 0 || puzzle.blocked[i]) return;
    const last = line[line.length - 1];
    if (i === last) return;
    if (onLine[i]) {
      // 線上のマスへ戻った → そこまで巻き戻し（かきなおし）
      const at = line.indexOf(i);
      for (let k = at + 1; k < line.length; k++) onLine[line[k]!] = false;
      line.length = at + 1;
      ctx.sfx('tick');
      paintLine();
      return;
    }
    if (line.length === 0) {
      line.push(i);
      onLine[i] = true;
      ctx.sfx('tap');
      paintLine();
      return;
    }
    if (last !== undefined && isAdjacent(last, i, puzzle.cols)) {
      line.push(i);
      onLine[i] = true;
      if (line.length % 3 === 0) ctx.sfx('tap');
      paintLine();
      if (line.length === puzzle.path.length) roundClear();
    }
  }

  const offDown = ctx.input.onDown((p) => {
    if (activePid !== null) return;
    activePid = p.id;
    handleCell(cellFromPoint(p));
  });
  const offMove = ctx.input.onMove((p) => {
    if (p.id !== activePid) return;
    handleCell(cellFromPoint(p));
  });
  const offUp = ctx.input.onUp((p) => {
    if (p.id === activePid) activePid = null;
  });

  function retryRound(): void {
    if (mode !== 'play' || hostPaused || roundDone || line.length === 0) return;
    for (const i of line) onLine[i] = false;
    line = [];
    retriedRound = true;
    retriesTotal++;
    ctx.sfx('tick');
    if (msgEl) msgEl.textContent = 'もういちど！すきなマスから どうぞ';
    paintLine();
  }

  // ---- 問クリア ----
  function roundScore(sec: number, open: number): number {
    let s = ROUND_BASE + open * 2;
    s += Math.max(0, 30 + open - sec) * 2;
    if (!retriedRound) s += NO_RETRY_BONUS;
    return s;
  }

  function roundClear(): void {
    if (!puzzle) return;
    roundDone = true;
    const now = ctx.now();
    const sec = Math.floor((now - roundStart) / 1000);
    const s = roundScore(sec, puzzle.path.length);
    total += s;
    ctx.achieve('first-clear');
    if (sec <= SPEEDY_SEC) ctx.achieve('speedy');
    boardEl?.classList.add('os-clear');
    if (msgEl) {
      msgEl.className = 'os-msg os-msg-win';
      msgEl.textContent = `かけた！ +${s}てん 🎉`;
    }
    if (hudScoreEl) hudScoreEl.textContent = `スコア ${total}`;
    ctx.haptic('success');
    if (roundIdx >= 2) {
      // 3問完走
      mode = 'win';
      ctx.achieve('all-rounds');
      if (retriesTotal === 0) ctx.achieve('no-retry');
      if (preset === 'hard') ctx.achieve('hard-clear');
      const cleared = ctx.load<Record<string, boolean>>('cleared') ?? {};
      cleared[preset] = true;
      ctx.save('cleared', cleared);
      if (cleared.easy && cleared.normal && cleared.hard) ctx.achieve('all-presets');
      ctx.sfx('medal');
      endAt = now + END_DELAY;
    } else {
      ctx.sfx('success');
      nextRoundAt = now + NEXT_MS;
    }
    devState();
  }

  // ---- 毎フレーム（タイマー表示・問送り・結果遷移。すべて ctx.now 基準）----
  const offFrame = ctx.onFrame(() => {
    const now = ctx.now();
    if (mode === 'play') {
      if (roundDone) {
        if (nextRoundAt > 0 && now >= nextRoundAt) {
          nextRoundAt = 0;
          roundIdx++;
          startRound();
        }
        return;
      }
      const sec = Math.floor((now - roundStart) / 1000);
      if (sec !== lastSec) {
        lastSec = sec;
        if (hudTimeEl) hudTimeEl.textContent = `⏱ ${sec}びょう`;
      }
      return;
    }
    if (mode === 'win' && !ended && now >= endAt) {
      ended = true;
      ctx.end({ score: total });
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
      activePid = null;
    },
    resume() {
      hostPaused = false;
    },
    resize() {
      if (mode !== 'setup') layout();
    },
    destroy() {
      offDown();
      offMove();
      offUp();
      offFrame();
      style.remove();
      wrap.remove();
    },
  };
}

// =============================================================
// スタイル（.os- プレフィックス。テーマ変数でライト/ダーク両対応）
// =============================================================
const CSS = `
.os-wrap{position:absolute;inset:0;overflow:hidden}

/* 設定画面 */
.os-setup{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:safe center;
  gap:14px;padding:20px 16px;box-sizing:border-box;overflow-y:auto;user-select:none;-webkit-user-select:none}
.os-h2{margin:4px 0;font-size:22px;text-align:center}
.os-seg-row{width:min(92vw,420px);display:flex;flex-direction:column;gap:6px}
.os-seg-label{font-size:13px;color:var(--text-dim);font-weight:800}
.os-seg{display:flex;background:var(--bg-elev2);border-radius:12px;padding:3px;gap:2px}
.os-seg-btn{flex:1;border:none;background:none;color:var(--text-dim);padding:10px 2px;border-radius:9px;
  font-size:13px;font-weight:800;min-height:44px}
.os-seg-btn.os-on{background:var(--accent);color:#fff}
.os-note{font-size:12px;color:var(--text-dim);text-align:center;max-width:min(92vw,420px);margin:0;line-height:1.7}
.os-btn{appearance:none;border:none;border-radius:12px;padding:12px 18px;font-size:15px;font-weight:800;font-family:inherit;
  background:var(--bg-elev2);color:var(--text);min-height:44px}
.os-btn-primary{background:var(--accent-grad);color:#fff}
.os-btn-lg{width:100%;max-width:300px;font-size:18px}

/* プレイ画面 */
.os-play{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;padding:6px 4px 12px;
  box-sizing:border-box;user-select:none;-webkit-user-select:none}
.os-hud{display:flex;justify-content:center;align-items:center;gap:14px;padding:2px 64px 4px;flex-wrap:wrap;min-height:54px}
.os-hud-item{font-size:14px;font-weight:800;white-space:nowrap;font-variant-numeric:tabular-nums}
.os-board-wrap{flex:1 1 auto;min-height:0;display:flex;align-items:center;justify-content:center}
.os-board{display:grid;gap:4px;background:var(--bg-elev);padding:6px;border-radius:12px;line-height:1}

/* マス。線（os-on）は accent で塗り、前のマスとの間は ::before のブリッジでつなぐ */
.os-cell{position:relative;border-radius:9px;background:var(--bg-elev2);display:flex;align-items:center;justify-content:center}
.os-cell.os-rock{background:transparent;opacity:.9}
.os-cell.os-on{background:var(--accent)}
.os-cell.os-cl::before,.os-cell.os-cr::before,.os-cell.os-cu::before,.os-cell.os-cd::before{
  content:'';position:absolute;background:var(--accent)}
.os-cell.os-cl::before{left:-5px;top:30%;bottom:30%;width:7px}
.os-cell.os-cr::before{right:-5px;top:30%;bottom:30%;width:7px}
.os-cell.os-cu::before{top:-5px;left:30%;right:30%;height:7px}
.os-cell.os-cd::before{bottom:-5px;left:30%;right:30%;height:7px}
.os-cell.os-head{box-shadow:0 0 0 3px var(--accent-2),0 0 12px rgba(124,140,255,.55)}
@keyframes os-winpulse{0%,100%{transform:scale(1)}50%{transform:scale(1.02)}}
.os-board.os-clear{animation:os-winpulse .5s ease-in-out 2}

.os-msg{min-height:24px;font-size:15px;font-weight:900;color:var(--text-dim);margin:8px 0 0;text-align:center}
.os-msg-win{color:#2fae5e}
.os-tools{display:flex;gap:10px;margin-top:8px}
.os-tool{appearance:none;border:none;border-radius:12px;padding:0 16px;font-size:14px;font-weight:800;font-family:inherit;
  background:var(--bg-elev2);color:var(--text);min-height:44px}
.os-tool:active{transform:scale(.96)}
`;
