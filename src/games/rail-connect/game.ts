// =============================================================
// せんろつなぎ（No.30）: タイルを回して駅からゴールまで線路をつなぐ
// =============================================================
// - タイルをタップすると時計回りに90°回転。🚉（左）から🏁（右）まで つながると
//   汽車🚂が走ってクリア！少ない回転（めやす=パー以内）とはやさでボーナス。
// - 盤面は rail-gen.ts（正解の道を先に彫ってから崩す＝必ず解ける・rng注入で日替わり同一）。
// - 入力はすべて DOM ボタン（ctx.input 不使用）。時間は ctx.now の期限方式。
// - import してよいのは game-api（types / helpers）と、このフォルダ内（rail-gen）だけ
import type { GameContext, IGame } from '../../game-api/types';
import { elem, makeSeg } from '../../game-api/helpers';
import { generatePuzzle, connectedPath, rotMask, isStraight, type Puzzle } from './rail-gen';

type Mode = 'setup' | 'play' | 'train' | 'over';

interface Config {
  size: number;
}

const BASE = 120; // つないだ基本点
const SIZE_BONUS: Record<number, number> = { 4: 0, 5: 80, 6: 160 };
const PAR_BONUS = 80; // パー以内
const PAR_NEAR_BONUS = 40; // パー+5以内
const SPEED_MAX = 120; // はやさボーナス max(0, 120-秒)
const CELL_MS = 110; // 汽車が1マス進む時間
const END_DELAY = 1900; // クリア演出→結果画面までの余韻(ms)
const SPEEDY_SEC = 60; // 「いそぎのこうじ」実績

export function createGame(ctx: GameContext): IGame {
  // ---- 設定（前回サイズ復元。既定4×4）----
  const saved = ctx.load<Partial<Config>>('config');
  const config: Config = { size: saved?.size === 5 || saved?.size === 6 ? saved.size : 4 };

  // ---- 状態 ----
  let mode: Mode = 'setup';
  let hostPaused = false;
  let puzzle: Puzzle | null = null;
  let masks: number[] = [];
  let moves = 0;
  let playStart = 0;
  let score = 0;
  let trainPath: number[] = [];
  let trainStart = 0;
  let endAt = 0;
  let ended = false;

  // ---- DOM ----
  const style = document.createElement('style');
  style.textContent = CSS;
  const wrap = elem('div', 'rl-wrap');
  ctx.root.append(style, wrap);

  let movesEl: HTMLElement | null = null;
  let timeEl: HTMLElement | null = null;
  let boardBox: HTMLElement | null = null;
  let gridEl: HTMLElement | null = null;
  let trainEl: HTMLElement | null = null;
  let tiles: HTMLButtonElement[] = [];
  let lastSec = -1;

  function devState(): void {
    if (!import.meta.env.DEV) return;
    wrap.dataset.st = mode;
    wrap.dataset.moves = String(moves);
    wrap.dataset.par = String(puzzle?.par ?? 0);
    wrap.dataset.score = String(score);
  }

  // ---- 設定画面 ----
  function showSetup(): void {
    mode = 'setup';
    devState();
    const box = elem('div', 'rl-setup');
    box.append(elem('h2', 'rl-h2', 'せんろを つなげよう'));
    box.append(
      makeSeg(
        'rl',
        'ばんの大きさ',
        [
          { v: '4', t: '4×4' },
          { v: '5', t: '5×5' },
          { v: '6', t: '6×6（ひろい）' },
        ],
        () => String(config.size),
        (v) => {
          config.size = Number(v);
        },
      ),
    );
    box.append(elem('p', 'rl-note', 'タイルをタップすると くるっと回転。🚉えきから 🏁ゴールまで せんろが つながると 汽車が走るよ！少ない回転と はやさで ボーナス。'));
    const start = elem('button', 'rl-btn rl-btn-primary rl-btn-lg', 'はじめる ▶') as HTMLButtonElement;
    start.addEventListener('click', () => startPuzzle());
    box.append(start);
    wrap.replaceChildren(box);
  }

  // ---- 開始 ----
  function startPuzzle(): void {
    ctx.save('config', { ...config });
    puzzle = generatePuzzle(ctx.random, config.size);
    masks = puzzle.masks.slice();
    moves = 0;
    score = 0;
    ended = false;
    lastSec = -1;
    buildPlay();
    mode = 'play';
    playStart = ctx.now();
    ctx.sfx('start');
    devState();
  }

  function buildPlay(): void {
    if (!puzzle) return;
    const n = puzzle.n;
    const play = elem('div', 'rl-play');

    const hud = elem('div', 'rl-hud');
    movesEl = elem('span', 'rl-hud-item', `かいてん 0（めやす ${puzzle.par}）`);
    timeEl = elem('span', 'rl-hud-item', '⏱ 0びょう');
    hud.append(movesEl, timeEl);

    boardBox = elem('div', 'rl-board-box');
    gridEl = elem('div', 'rl-grid');
    gridEl.style.setProperty('--n', String(n));
    tiles = [];
    for (let i = 0; i < n * n; i++) {
      const idx = i;
      const b = elem('button', 'rl-tile') as HTMLButtonElement;
      b.appendChild(tileSvg());
      b.addEventListener('click', () => tapTile(idx));
      tiles.push(b);
      gridEl.append(b);
    }
    const station = elem('div', 'rl-badge rl-station', '🚉');
    const goal = elem('div', 'rl-badge rl-goal', '🏁');
    trainEl = elem('div', 'rl-train', '🚂');
    boardBox.append(gridEl, station, goal, trainEl);

    play.append(hud, boardBox, elem('p', 'rl-hint', '🚉から 🏁まで つなげよう'));
    wrap.replaceChildren(play);
    paintAll();
    layoutBadges();
  }

  /** レールのSVG（縦まっすぐ。カーブは回転クラスで表現するため中身は2種） */
  function tileSvg(): SVGSVGElement {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.classList.add('rl-svg');
    return svg;
  }

  const STRAIGHT_SVG =
    "<rect x='20' y='12' width='60' height='9' rx='4' fill='#8a6d4a'/><rect x='20' y='45' width='60' height='9' rx='4' fill='#8a6d4a'/><rect x='20' y='78' width='60' height='9' rx='4' fill='#8a6d4a'/><rect x='34' y='0' width='9' height='100' fill='#aab3c8'/><rect x='57' y='0' width='9' height='100' fill='#aab3c8'/>";
  const CURVE_SVG =
    "<path d='M38,0 Q38,62 100,62' fill='none' stroke='#aab3c8' stroke-width='9'/><path d='M62,0 Q62,38 100,38' fill='none' stroke='#aab3c8' stroke-width='9'/><path d='M43,22 L60,22' stroke='#8a6d4a' stroke-width='8' stroke-linecap='round'/><path d='M55,45 L72,52' stroke='#8a6d4a' stroke-width='8' stroke-linecap='round'/><path d='M76,60 L80,44' stroke='#8a6d4a' stroke-width='8' stroke-linecap='round'/>";

  /** マスク → 見た目（まっすぐ/カーブ＋回転角）。まっすぐ5=縦/10=横、カーブ3=N→E基準 */
  function paintTile(i: number): void {
    const m = masks[i]!;
    const b = tiles[i]!;
    const svg = b.firstElementChild as SVGSVGElement;
    if (isStraight(m)) {
      svg.innerHTML = STRAIGHT_SVG;
      svg.style.transform = `rotate(${m === 5 ? 0 : 90}deg)`;
    } else {
      svg.innerHTML = CURVE_SVG;
      const rot = m === 3 ? 0 : m === 6 ? 90 : m === 12 ? 180 : 270;
      svg.style.transform = `rotate(${rot}deg)`;
    }
    b.classList.toggle('rl-on-path', false);
  }

  function paintAll(): void {
    for (let i = 0; i < tiles.length; i++) paintTile(i);
  }

  function layoutBadges(): void {
    if (!puzzle || !boardBox || !gridEl) return;
    const rect = gridEl.getBoundingClientRect();
    const boxRect = boardBox.getBoundingClientRect();
    const cell = rect.height / puzzle.n;
    const top = rect.top - boxRect.top;
    const station = boardBox.querySelector('.rl-station') as HTMLElement | null;
    const goal = boardBox.querySelector('.rl-goal') as HTMLElement | null;
    if (station) station.style.top = `${top + cell * (puzzle.entryY + 0.5)}px`;
    if (goal) goal.style.top = `${top + cell * (puzzle.exitY + 0.5)}px`;
  }

  // ---- 1手 ----
  function tapTile(i: number): void {
    if (mode !== 'play' || hostPaused || !puzzle) return;
    masks[i] = rotMask(masks[i]!);
    moves++;
    paintTile(i);
    if (movesEl) movesEl.textContent = `かいてん ${moves}（めやす ${puzzle.par}）`;
    ctx.sfx('tap');
    ctx.haptic('light');
    devState();
    const path = connectedPath(masks, puzzle.n, puzzle.entryY, puzzle.exitY);
    if (path) onConnected(path);
  }

  function onConnected(path: number[]): void {
    if (!puzzle) return;
    mode = 'train';
    trainPath = path;
    trainStart = ctx.now();
    for (const b of tiles) b.disabled = true;
    for (const idx of path) tiles[idx]?.classList.add('rl-on-path');
    // スコア確定
    const sec = Math.floor((ctx.now() - playStart) / 1000);
    const parBonus = moves <= puzzle.par ? PAR_BONUS : moves <= puzzle.par + 5 ? PAR_NEAR_BONUS : 0;
    score = BASE + (SIZE_BONUS[puzzle.n] ?? 0) + parBonus + Math.max(0, SPEED_MAX - sec);
    ctx.achieve('first-connect');
    if (puzzle.n === 5) ctx.achieve('clear-5');
    if (puzzle.n === 6) ctx.achieve('clear-6');
    if (moves <= puzzle.par) ctx.achieve('par-clear');
    if (sec <= SPEEDY_SEC) ctx.achieve('speedy');
    // ぜんサイズ制覇（インスタンス跨ぎ）
    const cleared = ctx.load<Record<string, boolean>>('cleared') ?? {};
    cleared[String(puzzle.n)] = true;
    ctx.save('cleared', cleared);
    if (cleared['4'] && cleared['5'] && cleared['6']) ctx.achieve('all-sizes');
    ctx.sfx('success');
    ctx.haptic('success');
    devState();
  }

  function moveTrain(now: number): void {
    if (!puzzle || !trainEl || !gridEl || !boardBox) return;
    const step = (now - trainStart) / CELL_MS;
    const i = Math.min(trainPath.length - 1, Math.floor(step));
    const frac = Math.min(1, step - i);
    const rect = gridEl.getBoundingClientRect();
    const boxRect = boardBox.getBoundingClientRect();
    const cell = rect.width / puzzle.n;
    const posOf = (idx: number) => {
      const x = idx % puzzle!.n;
      const y = (idx - x) / puzzle!.n;
      return {
        x: rect.left - boxRect.left + cell * (x + 0.5),
        y: rect.top - boxRect.top + cell * (y + 0.5),
      };
    };
    const a = posOf(trainPath[i]!);
    const b = posOf(trainPath[Math.min(trainPath.length - 1, i + 1)]!);
    trainEl.style.left = `${a.x + (b.x - a.x) * frac}px`;
    trainEl.style.top = `${a.y + (b.y - a.y) * frac}px`;
    trainEl.classList.add('rl-train-run');
    if (step >= trainPath.length + 1) {
      finish(now);
    }
  }

  function finish(now: number): void {
    if (!puzzle || mode !== 'train') return;
    mode = 'over';
    const over = elem('div', 'rl-over');
    over.append(
      elem('div', 'rl-over-t', '🚂 かいつう！'),
      elem('div', 'rl-over-s', `スコア ${score}`),
      elem('div', 'rl-over-b', `かいてん ${moves}（めやす ${puzzle.par}）`),
    );
    boardBox?.append(over);
    ctx.sfx('medal');
    endAt = now + END_DELAY;
    devState();
  }

  // ---- 毎フレーム ----
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
    if (mode === 'train') {
      moveTrain(now);
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
      layoutBadges();
    },
    destroy() {
      offFrame();
      style.remove();
      wrap.remove();
    },
  };
}

// =============================================================
// スタイル（.rl- プレフィックス。タイルはテーマ変数・レールは固定色）
// =============================================================
const CSS = `
.rl-wrap{position:absolute;inset:0;overflow:hidden}

/* 設定画面 */
.rl-setup{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:safe center;
  gap:14px;padding:20px 16px;box-sizing:border-box;overflow-y:auto;user-select:none;-webkit-user-select:none}
.rl-h2{margin:4px 0;font-size:22px;text-align:center}
.rl-seg-row{width:min(92vw,420px);display:flex;flex-direction:column;gap:6px}
.rl-seg-label{font-size:13px;color:var(--text-dim);font-weight:800}
.rl-seg{display:flex;background:var(--bg-elev2);border-radius:12px;padding:3px;gap:2px}
.rl-seg-btn{flex:1;border:none;background:none;color:var(--text-dim);padding:10px 2px;border-radius:9px;
  font-size:13px;font-weight:800;min-height:44px}
.rl-seg-btn.rl-on{background:var(--accent);color:#fff}
.rl-note{font-size:12px;color:var(--text-dim);text-align:center;max-width:min(92vw,420px);margin:0;line-height:1.7}
.rl-btn{appearance:none;border:none;border-radius:12px;padding:12px 18px;font-size:15px;font-weight:800;font-family:inherit;
  background:var(--bg-elev2);color:var(--text);min-height:44px}
.rl-btn-primary{background:var(--accent-grad);color:#fff}
.rl-btn-lg{width:100%;max-width:300px;font-size:18px}

/* プレイ画面 */
.rl-play{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;padding:6px 10px 14px;
  box-sizing:border-box;user-select:none;-webkit-user-select:none}
.rl-hud{display:flex;justify-content:center;align-items:center;gap:16px;padding:2px 64px 4px;flex-wrap:wrap;min-height:54px}
.rl-hud-item{font-size:14px;font-weight:800;white-space:nowrap;font-variant-numeric:tabular-nums}
.rl-board-box{position:relative;width:min(84vw,420px);margin:auto 0}
.rl-grid{width:100%;aspect-ratio:1;background:var(--bg-elev2);border-radius:14px;padding:8px;box-sizing:border-box;
  display:grid;grid-template-columns:repeat(var(--n),1fr);grid-template-rows:repeat(var(--n),1fr);gap:4px}
.rl-tile{appearance:none;border:none;border-radius:8px;background:var(--bg);padding:0;overflow:hidden;position:relative;min-width:0;min-height:0}
.rl-tile:active:not(:disabled){transform:scale(.96)}
.rl-tile.rl-on-path{background:rgba(62,211,106,.18)}
.rl-svg{width:100%;height:100%;display:block;transition:transform .12s ease}
.rl-badge{position:absolute;font-size:26px;transform:translateY(-50%);pointer-events:none;line-height:1}
.rl-station{left:-32px}
.rl-goal{right:-32px}
.rl-train{position:absolute;font-size:30px;transform:translate(-50%,-58%);pointer-events:none;opacity:0;line-height:1}
.rl-train.rl-train-run{opacity:1}
.rl-hint{font-size:12px;color:var(--text-dim);font-weight:800;margin:10px 0 0}

/* クリア */
.rl-over{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;
  background:rgba(16,19,48,.86);color:#fff;border-radius:14px;animation:rl-in .2s ease-out;padding:12px}
.rl-over-t{font-size:26px;font-weight:900}
.rl-over-s{font-size:20px;font-weight:800;color:#ffd76a}
.rl-over-b{font-size:14px;font-weight:800}
@keyframes rl-in{from{opacity:0;transform:scale(.96)}to{opacity:1;transform:scale(1)}}
`;
