// =============================================================
// ナンプレ（No.7）: たて・よこ・ブロックに 1つずつ数字を入れる定番パズル
// =============================================================
// - 4×4／6×6／9×9（ふつう・むずかしい）の4プリセット。全問「解がただ1つ」を保証
// - 子ども向けアシスト: 同じ数字・行/列/ブロックのハイライト、まちがい即時表示（設定でOFF可）、
//   ✏️メモ（確定時に同じ行/列/ブロックのメモを自動で消す）、のこり数つき数字パッド、💡ヒント×3
// - 🆕中断セーブ: 盤面・メモ・経過時間を ctx.save に自動保存 → 次回「つづきから」を選べる
// - 時間は ctx.now・乱数は ctx.random・勝利後の遷移は onFrame＋期限方式（setTimeout 不使用）
// - import してよいのは game-api（types / helpers）と、このフォルダ内（engine）だけ
import type { GameContext, IGame } from '../../game-api/types';
import { elem, makeSeg } from '../../game-api/helpers';
import { generatePuzzle, type Puzzle } from './engine';

type PresetKey = 'p4' | 'p6' | 'n9' | 'h9';
type Mode = 'setup' | 'play' | 'win';

interface Config {
  preset: PresetKey;
  showErrors: boolean;
}

/** 中断セーブ（ctx.save('progress')）の形 */
interface Progress {
  preset: PresetKey;
  givens: number[];
  solution: number[];
  board: number[];
  memos: number[];
  mistakes: number;
  hintsUsed: number;
  hintsLeft: number;
  elapsed: number;
}

const END_DELAY_WIN = 2000; // かんせい演出→結果画面までの余韻(ms・ctx.now基準)
const HINT_MAX = 3;
const CLEAR_BASE = 200;
const BONUS_NO_MISTAKE = 50;
const BONUS_NO_HINT = 50;

// プリセット（ヒント数 target・ボーナス・はやさ基準秒は playtest 調整前提の仮値）
const PRESETS: Record<
  PresetKey,
  { size: number; blockW: number; blockH: number; target: number; base: number; speedFrom: number; label: string }
> = {
  p4: { size: 4, blockW: 2, blockH: 2, target: 7, base: 0, speedFrom: 180, label: 'れんしゅう 4×4' },
  p6: { size: 6, blockW: 3, blockH: 2, target: 15, base: 80, speedFrom: 300, label: 'かんたん 6×6' },
  n9: { size: 9, blockW: 3, blockH: 3, target: 38, base: 200, speedFrom: 600, label: 'ふつう 9×9' },
  h9: { size: 9, blockW: 3, blockH: 3, target: 28, base: 300, speedFrom: 900, label: 'むずかしい 9×9' },
};

export function createGame(ctx: GameContext): IGame {
  // ---- 設定（前回を復元。はじめての人向けに既定は「れんしゅう」）----
  const savedCfg = ctx.load<Partial<Config>>('config');
  const config: Config = {
    preset:
      savedCfg?.preset === 'p6' || savedCfg?.preset === 'n9' || savedCfg?.preset === 'h9' ? savedCfg.preset : 'p4',
    showErrors: savedCfg?.showErrors !== false,
  };

  // ---- 状態 ----
  let mode: Mode = 'setup';
  let hostPaused = false; // ポーズ中の入力ガード（シェルのオーバーレイに加える二重防御）
  let presetKey: PresetKey = config.preset; // 実際にプレイ中のプリセット（つづきからは保存側を優先）
  let puzzle: Puzzle | null = null;
  let board = new Uint8Array(0);
  let memos = new Uint16Array(0); // 各マスの候補メモ（bit d-1 = 数字 d）
  let selected = -1;
  let memoMode = false;
  let mistakes = 0;
  let hintsUsed = 0;
  let hintsLeft = HINT_MAX;
  let baseElapsed = 0; // つづきから再開ぶんの経過時間
  let startedAt = 0; // play に入った時刻（ctx.now 基準）
  let finishMs = 0;
  let resultScore = 0;
  let endAt = 0;
  let ended = false;
  let bannerUntil = 0;

  // ---- DOM ----
  const style = document.createElement('style');
  style.textContent = CSS;
  const wrap = elem('div', 'np-wrap');
  ctx.root.append(style, wrap);

  let cells: HTMLButtonElement[] = [];
  let cellBase: string[] = []; // ブロック境界の太線クラスを含む基本クラス（マスごとに固定）
  let cellSig: string[] = []; // マスの表示内容（値/メモ）の署名。選択移動だけの再描画で中身DOMを作り直さないため
  let playEl: HTMLElement | null = null;
  let hudEl: HTMLElement | null = null;
  let timeEl: HTMLElement | null = null;
  let leftEl: HTMLElement | null = null;
  let boardWrap: HTMLElement | null = null;
  let boardEl: HTMLElement | null = null;
  let padEl: HTMLElement | null = null;
  let toolsEl: HTMLElement | null = null;
  let padBtns: HTMLButtonElement[] = [];
  let memoBtn: HTMLButtonElement | null = null;
  let eraseBtn: HTMLButtonElement | null = null;
  let hintBtn: HTMLButtonElement | null = null;
  let bannerEl: HTMLElement | null = null;

  function elapsedMs(): number {
    if (mode === 'win') return finishMs;
    if (mode !== 'play') return 0;
    return baseElapsed + (ctx.now() - startedAt);
  }

  function fmtTime(ms: number): string {
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  // ---- 中断セーブ ----
  function saveProgress(): void {
    if (mode !== 'play' || !puzzle) return;
    ctx.save<Progress>('progress', {
      preset: presetKey,
      givens: Array.from(puzzle.givens),
      solution: Array.from(puzzle.solution),
      board: Array.from(board),
      memos: Array.from(memos),
      mistakes,
      hintsUsed,
      hintsLeft,
      elapsed: elapsedMs(),
    });
  }

  function clearProgress(): void {
    ctx.save('progress', null);
  }

  /** 保存された途中経過を検証つきで読む（形が崩れていたら null＝「つづきから」を出さない） */
  function loadProgress(): Progress | null {
    const p = ctx.load<Partial<Progress>>('progress');
    if (!p || typeof p !== 'object') return null;
    const key = p.preset;
    if (key !== 'p4' && key !== 'p6' && key !== 'n9' && key !== 'h9') return null;
    const size = PRESETS[key].size;
    const n = size * size;
    const arrs = [p.givens, p.solution, p.board, p.memos];
    for (const a of arrs) {
      if (!Array.isArray(a) || a.length !== n) return null;
      if (!a.every((v) => typeof v === 'number' && Number.isFinite(v) && v >= 0)) return null;
    }
    const solution = p.solution as number[];
    if (!solution.every((v) => v >= 1 && v <= size)) return null;
    const boardArr = p.board as number[];
    if (!boardArr.every((v) => v <= size)) return null;
    if (!boardArr.some((v, i) => v !== solution[i])) return null; // すでに完成済みなら出さない
    return {
      preset: key,
      givens: p.givens as number[],
      solution,
      board: boardArr,
      memos: p.memos as number[],
      mistakes: typeof p.mistakes === 'number' && p.mistakes >= 0 ? p.mistakes : 0,
      hintsUsed: typeof p.hintsUsed === 'number' && p.hintsUsed >= 0 ? p.hintsUsed : 0,
      hintsLeft:
        typeof p.hintsLeft === 'number' && p.hintsLeft >= 0 && p.hintsLeft <= HINT_MAX ? p.hintsLeft : 0,
      elapsed: typeof p.elapsed === 'number' && p.elapsed >= 0 ? p.elapsed : 0,
    };
  }

  // ---- 設定画面 ----
  function showSetup(): void {
    mode = 'setup';
    const box = elem('div', 'np-setup');
    box.append(elem('h2', 'np-h2', 'すうじを ならべよう'));

    const prog = loadProgress();
    if (prog) {
      const empty = prog.board.filter((v) => !v).length;
      const resume = elem(
        'button',
        'np-btn np-btn-resume',
        `▶ つづきから（${PRESETS[prog.preset].label}・のこり${empty}マス）`,
      ) as HTMLButtonElement;
      resume.addEventListener('click', () => restoreMatch(prog));
      box.append(resume);
    }

    box.append(
      makeSeg(
        'np',
        'もんだい',
        [
          { v: 'p4', t: 'れんしゅう' },
          { v: 'p6', t: 'かんたん' },
          { v: 'n9', t: 'ふつう' },
          { v: 'h9', t: 'むずかしい' },
        ],
        () => config.preset,
        (v) => {
          config.preset = v as PresetKey;
        },
      ),
      makeSeg(
        'np',
        'まちがいを すぐ教える',
        [
          { v: 'on', t: 'ON' },
          { v: 'off', t: 'OFF' },
        ],
        () => (config.showErrors ? 'on' : 'off'),
        (v) => {
          config.showErrors = v === 'on';
        },
      ),
    );
    box.append(
      elem(
        'p',
        'np-note',
        'たて・よこ・ふとわくの中に、同じ数字は1つだけ。れんしゅうは4×4・かんたんは6×6・ふつう/むずかしいは9×9だよ。とちゅうでやめても「つづきから」であそべる！',
      ),
    );
    const start = elem('button', 'np-btn np-btn-primary np-btn-lg', 'はじめる ▶') as HTMLButtonElement;
    start.addEventListener('click', () => startMatch());
    box.append(start);
    wrap.replaceChildren(box);
  }

  // ---- 開始 ----
  function startMatch(): void {
    ctx.save('config', { ...config });
    presetKey = config.preset;
    const P = PRESETS[presetKey];
    puzzle = generatePuzzle(P.size, P.blockW, P.blockH, P.target, ctx.random);
    board = puzzle.givens.slice();
    memos = new Uint16Array(P.size * P.size);
    beginPlay(0);
    saveProgress(); // 開始直後から「つづきから」できるように
  }

  function restoreMatch(prog: Progress): void {
    presetKey = prog.preset;
    const P = PRESETS[presetKey];
    puzzle = {
      size: P.size,
      blockW: P.blockW,
      blockH: P.blockH,
      givens: Uint8Array.from(prog.givens),
      solution: Uint8Array.from(prog.solution),
    };
    board = Uint8Array.from(prog.board);
    memos = Uint16Array.from(prog.memos);
    mistakes = prog.mistakes;
    hintsUsed = prog.hintsUsed;
    hintsLeft = prog.hintsLeft;
    beginPlay(prog.elapsed);
  }

  function beginPlay(elapsed: number): void {
    if (elapsed === 0) {
      mistakes = 0;
      hintsUsed = 0;
      hintsLeft = HINT_MAX;
    }
    selected = -1;
    memoMode = false;
    baseElapsed = elapsed;
    finishMs = 0;
    resultScore = 0;
    ended = false;
    mode = 'play';
    startedAt = ctx.now();
    buildPlay();
  }

  function buildPlay(): void {
    if (!puzzle) return;
    const size = puzzle.size;
    playEl = elem('div', 'np-play');

    hudEl = elem('div', 'np-hud');
    timeEl = elem('span', 'np-hud-item', '⏱ 0:00');
    leftEl = elem('span', 'np-hud-item', '');
    hudEl.append(timeEl, leftEl);

    boardWrap = elem('div', 'np-board-wrap');
    boardEl = elem('div', 'np-board');
    boardEl.style.setProperty('--np-mc', String(puzzle.blockW));
    cells = [];
    cellBase = [];
    cellSig = [];
    for (let i = 0; i < size * size; i++) {
      const idx = i;
      const r = (i / size) | 0;
      const c = i % size;
      let base = 'np-cell';
      if (c === size - 1) base += ' np-er';
      else if ((c + 1) % puzzle.blockW === 0) base += ' np-br';
      if (r === size - 1) base += ' np-eb';
      else if ((r + 1) % puzzle.blockH === 0) base += ' np-bb';
      cellBase.push(base);
      const cell = elem('button', base) as HTMLButtonElement;
      cell.addEventListener('click', () => select(idx));
      cells.push(cell);
      boardEl.append(cell);
    }
    boardWrap.append(boardEl);

    padEl = elem('div', `np-pad np-pad-${size}`);
    padBtns = [];
    for (let d = 1; d <= size; d++) {
      const digit = d;
      const b = elem('button', 'np-num') as HTMLButtonElement;
      b.append(elem('span', 'np-num-v', String(d)), elem('span', 'np-num-rest', ''));
      b.addEventListener('click', () => onPad(digit));
      padBtns.push(b);
      padEl.append(b);
    }

    toolsEl = elem('div', 'np-toolrow');
    memoBtn = elem('button', 'np-tool', '✏️ メモ') as HTMLButtonElement;
    memoBtn.addEventListener('click', () => {
      if (mode !== 'play' || hostPaused) return;
      memoMode = !memoMode;
      ctx.sfx('tick');
      paintTools();
    });
    eraseBtn = elem('button', 'np-tool', '⌫ けす') as HTMLButtonElement;
    eraseBtn.addEventListener('click', () => onErase());
    hintBtn = elem('button', 'np-tool', '') as HTMLButtonElement;
    hintBtn.addEventListener('click', () => onHint());
    toolsEl.append(memoBtn, eraseBtn, hintBtn);

    playEl.append(hudEl, boardWrap, padEl, toolsEl);
    wrap.replaceChildren(playEl);
    // レイアウト計測は文言・パッドをすべて描いてから（折り返しで高さが変わるため）
    paintAll();
    paintTools();
    layout();
  }

  // セルの一辺を計算（9×9はSEで約39px＝既知のトレードオフ。4×4/6×6は44px以上になる）
  function layout(): void {
    if (!puzzle || !playEl || !boardEl || !hudEl || !padEl || !toolsEl) return;
    const size = puzzle.size;
    const availW = playEl.clientWidth - 8 - 4; // 横padding + 盤の外枠2px×2
    const availH =
      playEl.clientHeight - hudEl.offsetHeight - padEl.offsetHeight - toolsEl.offsetHeight - 30 - 4;
    const cell = Math.max(28, Math.floor(Math.min(availW / size, availH / size)));
    boardEl.style.gridTemplateColumns = `repeat(${size}, ${cell}px)`;
    boardEl.style.gridAutoRows = `${cell}px`;
    boardEl.style.fontSize = `${Math.round(cell * 0.55)}px`;
  }

  // ---- 描画 ----
  function paintAll(): void {
    if (!puzzle) return;
    const size = puzzle.size;
    const selR = selected >= 0 ? (selected / size) | 0 : -1;
    const selC = selected >= 0 ? selected % size : -1;
    const bpr = size / puzzle.blockW;
    const blkOf = (r: number, c: number): number => ((r / puzzle!.blockH) | 0) * bpr + ((c / puzzle!.blockW) | 0);
    const selB = selected >= 0 ? blkOf(selR, selC) : -1;
    const sameVal = selected >= 0 ? board[selected] ?? 0 : 0;

    let emptyCount = 0;
    for (let i = 0; i < size * size; i++) {
      const el = cells[i];
      if (!el) continue;
      const v = board[i] ?? 0;
      if (!v) emptyCount++;
      const given = (puzzle.givens[i] ?? 0) !== 0;
      const r = (i / size) | 0;
      const c = i % size;
      let cls = cellBase[i] ?? 'np-cell';
      cls += given ? ' np-given' : ' np-user';
      if (i === selected) cls += ' np-sel';
      else if (selR >= 0 && (r === selR || c === selC || blkOf(r, c) === selB)) cls += ' np-peer';
      if (v && sameVal && v === sameVal && i !== selected) cls += ' np-same';
      if (config.showErrors && v && v !== (puzzle.solution[i] ?? 0)) cls += ' np-err';
      el.className = cls;
      // 中身（数字/メモ）は値・メモが変わったときだけ作り直す。選択移動だけの再描画では
      // クラスだけ更新し、メモの入れ子DOM（9×9で最大729要素）を毎回作らない＝連続タップを軽くする
      const memo = memos[i] ?? 0;
      const sig = v ? `v${v}` : memo ? `m${memo}` : 'e';
      if (cellSig[i] !== sig) {
        cellSig[i] = sig;
        if (v) {
          el.textContent = String(v);
        } else if (memo) {
          const grid = elem('span', 'np-memo');
          for (let d = 1; d <= size; d++) {
            grid.append(elem('span', 'np-memo-d', memo & (1 << (d - 1)) ? String(d) : ''));
          }
          el.replaceChildren(grid);
        } else {
          el.textContent = '';
        }
      }
    }
    if (leftEl) leftEl.textContent = `のこり ${emptyCount}`;
    paintPad(sameVal);
  }

  function paintPad(sameVal: number): void {
    if (!puzzle) return;
    const size = puzzle.size;
    const counts = new Array<number>(size + 1).fill(0);
    for (let i = 0; i < size * size; i++) counts[board[i] ?? 0] = (counts[board[i] ?? 0] ?? 0) + 1;
    for (let d = 1; d <= size; d++) {
      const b = padBtns[d - 1];
      if (!b) continue;
      const rest = size - (counts[d] ?? 0);
      const restEl = b.querySelector('.np-num-rest');
      if (restEl) restEl.textContent = rest > 0 ? `あと${rest}` : 'OK';
      b.classList.toggle('np-done', rest <= 0);
      b.classList.toggle('np-hl', d === sameVal);
      b.disabled = mode !== 'play' || rest <= 0;
    }
  }

  function paintTools(): void {
    memoBtn?.classList.toggle('np-active', memoMode);
    if (hintBtn) {
      hintBtn.textContent = `💡 ヒント ×${hintsLeft}`;
      hintBtn.disabled = mode !== 'play' || hintsLeft <= 0;
    }
    if (eraseBtn) eraseBtn.disabled = mode !== 'play';
  }

  // ---- バナー ----
  function showBanner(text: string, ms: number): void {
    hideBanner();
    if (!boardWrap) return;
    bannerEl = elem('div', 'np-banner', text);
    boardWrap.append(bannerEl);
    bannerUntil = ctx.now() + ms;
  }

  function hideBanner(): void {
    bannerEl?.remove();
    bannerEl = null;
    bannerUntil = 0;
  }

  // ---- 操作 ----
  function select(i: number): void {
    if (mode !== 'play' || hostPaused) return;
    selected = i;
    ctx.sfx('tick');
    paintAll();
  }

  function onPad(d: number): void {
    if (mode !== 'play' || hostPaused || !puzzle) return;
    if (selected < 0) {
      showBanner('まず マスをえらんでね', 1200);
      return;
    }
    if ((puzzle.givens[selected] ?? 0) !== 0) {
      showBanner('そこは さいしょからある数字だよ', 1200);
      return;
    }
    if (memoMode) {
      if ((board[selected] ?? 0) !== 0) return; // メモは空マスにだけ
      memos[selected] = (memos[selected] ?? 0) ^ (1 << (d - 1));
      ctx.sfx('tick');
      paintAll();
      saveProgress();
      return;
    }
    const prev = board[selected] ?? 0;
    if (prev === d) {
      board[selected] = 0; // 同じ数字をもう一度おすと消す
      ctx.sfx('tick');
    } else {
      board[selected] = d;
      memos[selected] = 0;
      if ((puzzle.solution[selected] ?? 0) === d) {
        ctx.sfx('tap');
        ctx.haptic('light');
        cleanPeerMemos(selected, d);
        checkDigitComplete(d);
      } else {
        mistakes++;
        ctx.sfx('tick');
      }
    }
    paintAll();
    saveProgress();
    checkWin();
  }

  /** 数字を確定したとき、同じ行・列・ブロックのメモからその数字を消す（定番のQoL） */
  function cleanPeerMemos(i: number, d: number): void {
    if (!puzzle) return;
    const size = puzzle.size;
    const bit = 1 << (d - 1);
    const r = (i / size) | 0;
    const c = i % size;
    const bpr = size / puzzle.blockW;
    const b = ((r / puzzle.blockH) | 0) * bpr + ((c / puzzle.blockW) | 0);
    for (let j = 0; j < size * size; j++) {
      if (!(memos[j] ?? 0)) continue;
      const jr = (j / size) | 0;
      const jc = j % size;
      const jb = ((jr / puzzle.blockH) | 0) * bpr + ((jc / puzzle.blockW) | 0);
      if (jr === r || jc === c || jb === b) memos[j] = (memos[j] ?? 0) & ~bit;
    }
  }

  function checkDigitComplete(d: number): void {
    if (!puzzle) return;
    const size = puzzle.size;
    let placed = 0;
    for (let i = 0; i < size * size; i++) {
      if ((board[i] ?? 0) === d && (puzzle.solution[i] ?? 0) === d) placed++;
    }
    if (placed === size) {
      showBanner(`✨ ${d} を ぜんぶおいた！`, 1200);
      ctx.sfx('combo');
    }
  }

  function onErase(): void {
    if (mode !== 'play' || hostPaused || !puzzle || selected < 0) return;
    if ((puzzle.givens[selected] ?? 0) !== 0) return;
    if ((board[selected] ?? 0) === 0 && (memos[selected] ?? 0) === 0) return;
    board[selected] = 0;
    memos[selected] = 0;
    ctx.sfx('tick');
    paintAll();
    saveProgress();
  }

  function onHint(): void {
    if (mode !== 'play' || hostPaused || !puzzle || hintsLeft <= 0) return;
    const size = puzzle.size;
    const wrongOrEmpty = (i: number): boolean =>
      (puzzle!.givens[i] ?? 0) === 0 && (board[i] ?? 0) !== (puzzle!.solution[i] ?? 0);
    let target = selected;
    if (target < 0 || !wrongOrEmpty(target)) {
      const cand: number[] = [];
      for (let i = 0; i < size * size; i++) if (wrongOrEmpty(i)) cand.push(i);
      if (cand.length === 0) return;
      target = cand[Math.floor(ctx.random() * cand.length)] ?? cand[0] ?? -1;
      if (target < 0) return;
    }
    hintsLeft--;
    hintsUsed++;
    const d = puzzle.solution[target] ?? 0;
    board[target] = d;
    memos[target] = 0;
    selected = target;
    cleanPeerMemos(target, d);
    ctx.sfx('powerup');
    showBanner('💡 ここは これ！', 1200);
    checkDigitComplete(d);
    paintAll();
    paintTools();
    saveProgress();
    checkWin();
  }

  // ---- 勝利 ----
  function computeScore(): number {
    const P = PRESETS[presetKey];
    const secs = Math.floor(finishMs / 1000);
    let s = CLEAR_BASE + P.base + Math.max(0, P.speedFrom - secs);
    if (mistakes === 0) s += BONUS_NO_MISTAKE;
    if (hintsUsed === 0) s += BONUS_NO_HINT;
    return s;
  }

  function checkWin(): void {
    if (mode !== 'play' || !puzzle) return;
    const n = puzzle.size * puzzle.size;
    for (let i = 0; i < n; i++) {
      if ((board[i] ?? 0) !== (puzzle.solution[i] ?? 0)) return;
    }
    mode = 'win';
    finishMs = baseElapsed + (ctx.now() - startedAt);
    resultScore = computeScore();
    ctx.achieve('first-clear');
    if (puzzle.size === 9) ctx.achieve('clear-9');
    if (mistakes === 0) ctx.achieve('no-mistake');
    if (hintsUsed === 0) ctx.achieve('no-hint');
    if (puzzle.size === 9 && finishMs <= 12 * 60_000) ctx.achieve('speedy');
    // ぜんサイズ制覇（インスタンス跨ぎ。treasure-dig / maze と同じ ctx.save パターン）
    const clearedSizes = ctx.load<Record<string, boolean>>('cleared') ?? {};
    clearedSizes[`s${puzzle.size}`] = true;
    ctx.save('cleared', clearedSizes);
    if (clearedSizes.s4 && clearedSizes.s6 && clearedSizes.s9) ctx.achieve('all-sizes');
    clearProgress(); // かんせいした盤面は「つづきから」に出さない
    ctx.sfx('success');
    ctx.haptic('success');
    boardEl?.classList.add('np-winwave');
    showBanner('🎉 かんせい！', END_DELAY_WIN - 200);
    endAt = ctx.now() + END_DELAY_WIN;
    paintAll();
    paintTools();
  }

  // ---- 毎フレーム（タイマー・バナー期限・結果画面への遷移。すべて ctx.now 基準＝ポーズで停止）----
  const offFrame = ctx.onFrame(() => {
    const now = ctx.now();
    if (bannerEl && now >= bannerUntil) hideBanner();
    if (mode === 'play') {
      const label = `⏱ ${fmtTime(elapsedMs())}`;
      if (timeEl && timeEl.textContent !== label) timeEl.textContent = label;
    } else if (mode === 'win' && !ended && now >= endAt) {
      ended = true;
      ctx.end({ score: resultScore });
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
      saveProgress(); // ポーズ（やめる操作の入口）でも経過時間ごと保存しておく
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

// =============================================================
// スタイル（.np- プレフィックス。テーマ変数でライト/ダーク両対応）
// =============================================================
const CSS = `
.np-wrap{position:absolute;inset:0;overflow:hidden}

/* 設定画面（低い画面でもスクロールできる safe center 方式） */
.np-setup{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:safe center;
  gap:14px;padding:20px 16px;box-sizing:border-box;overflow-y:auto;user-select:none;-webkit-user-select:none}
.np-h2{margin:4px 0;font-size:22px}
.np-seg-row{width:min(92vw,420px);display:flex;flex-direction:column;gap:6px}
.np-seg-label{font-size:13px;color:var(--text-dim);font-weight:800}
.np-seg{display:flex;background:var(--bg-elev2);border-radius:12px;padding:3px;gap:2px}
.np-seg-btn{flex:1;border:none;background:none;color:var(--text-dim);padding:10px 2px;border-radius:9px;
  font-size:13px;font-weight:800;min-height:44px}
.np-seg-btn.np-on{background:var(--accent);color:#fff}
.np-note{font-size:12px;color:var(--text-dim);text-align:center;max-width:min(92vw,420px);margin:0;line-height:1.7}
.np-btn{appearance:none;border:none;border-radius:12px;padding:12px 18px;font-size:15px;font-weight:800;
  background:var(--bg-elev2);color:var(--text);min-height:44px}
.np-btn-primary{background:var(--accent-grad);color:#fff}
.np-btn-lg{width:100%;max-width:300px;font-size:18px}
.np-btn-resume{width:100%;max-width:300px;background:var(--bg-elev);outline:2px solid var(--accent-2);color:var(--text)}

/* プレイ画面 */
.np-play{position:absolute;inset:0;display:flex;flex-direction:column;padding:6px 4px 10px;box-sizing:border-box;
  user-select:none;-webkit-user-select:none}
/* min-height 54px でポーズボタン予約領域（右上60×60）を盤面が構造的によける */
.np-hud{display:flex;justify-content:center;align-items:center;gap:16px;padding:2px 64px 6px;flex-wrap:wrap;min-height:54px}
.np-hud-item{font-size:14px;font-weight:800;white-space:nowrap}
.np-board-wrap{flex:1 1 auto;min-height:0;display:flex;align-items:center;justify-content:center;position:relative}
.np-board{display:grid;background:var(--bg-elev);border:2px solid var(--text-dim);border-radius:8px;overflow:hidden}

/* マス（テーマ追従。太線＝ブロック境界） */
.np-cell{border:none;padding:0;margin:0;display:flex;align-items:center;justify-content:center;box-sizing:border-box;
  background:var(--bg-elev);color:var(--text);font-weight:800;line-height:1;font-family:inherit;
  border-right:1px solid var(--line);border-bottom:1px solid var(--line)}
.np-br{border-right:2px solid var(--text-dim)}
.np-bb{border-bottom:2px solid var(--text-dim)}
.np-er{border-right:none}
.np-eb{border-bottom:none}
.np-given{background:var(--bg-elev2);font-weight:900}
.np-user{color:var(--accent-2)}
.np-peer{box-shadow:inset 0 0 0 99px rgba(124,108,240,.10)}
.np-same{box-shadow:inset 0 0 0 99px rgba(34,211,238,.20)}
.np-sel{box-shadow:inset 0 0 0 99px rgba(124,108,240,.26);outline:2px solid var(--accent);outline-offset:-2px}
.np-err{color:var(--danger) !important;box-shadow:inset 0 0 0 99px rgba(255,93,115,.16)}
.np-memo{display:grid;grid-template-columns:repeat(var(--np-mc),1fr);width:100%;height:100%;
  font-size:.3em;color:var(--text-dim);font-weight:800;line-height:1;align-items:center;justify-items:center;
  padding:8%;box-sizing:border-box}
@keyframes np-wave{0%{filter:brightness(1)}40%{filter:brightness(1.5)}100%{filter:brightness(1)}}
.np-winwave .np-cell{animation:np-wave .7s ease-out}

/* バナー */
.np-banner{position:absolute;left:50%;top:44%;transform:translate(-50%,-50%);background:rgba(16,19,48,.9);color:#fff;
  padding:10px 18px;border-radius:999px;font-weight:800;font-size:15px;pointer-events:none;white-space:nowrap;z-index:5;
  animation:np-pop .18s ease-out;max-width:94%;overflow:hidden;text-overflow:ellipsis}
@keyframes np-pop{from{opacity:0;transform:translate(-50%,-40%)}to{opacity:1;transform:translate(-50%,-50%)}}

/* 数字パッド（44px基準。9×9は自動で2段に折り返し） */
.np-pad{display:flex;flex-wrap:wrap;gap:6px;justify-content:center;padding-top:8px}
.np-num{appearance:none;border:none;border-radius:10px;min-height:48px;background:var(--bg-elev2);color:var(--text);
  display:flex;flex-direction:column;align-items:center;justify-content:center;line-height:1;font-family:inherit;padding:4px 0}
.np-pad-4 .np-num{flex:0 0 22%}
.np-pad-6 .np-num{flex:0 0 15%}
.np-pad-9 .np-num{flex:0 0 17.5%}
.np-num-v{font-size:20px;font-weight:900}
.np-num-rest{font-size:9px;color:var(--text-dim);font-weight:700;margin-top:2px}
.np-num.np-done{opacity:.35}
.np-num.np-hl{outline:2px solid var(--accent-2);outline-offset:-2px}
.np-num:disabled{opacity:.35}

/* ツール行 */
.np-toolrow{display:flex;gap:8px;justify-content:center;padding-top:6px;flex-wrap:wrap}
.np-tool{appearance:none;border:none;border-radius:12px;min-height:44px;padding:8px 14px;
  font-size:13px;font-weight:800;background:var(--bg-elev2);color:var(--text)}
.np-tool.np-active{background:var(--accent);color:#fff}
.np-tool:disabled{opacity:.4}
`;
