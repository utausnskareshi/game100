// =============================================================
// スライドパズル（No.13）: 1マスあけて数字タイルをスライドし、順番に並べる（8/15/24パズル）
// =============================================================
// - 空きマスの となりのタイルをタップすると スライドする。全部そろえたら クリア。
// - サイズ3段階。配置は必ず解ける（engine.scramble＝完成形から合法手を戻す方式・乱数注入）。
// - 時間は ctx.now・乱数は ctx.random・勝利遷移は onFrame＋期限方式・setTimeout 不使用
// - import してよいのは game-api（types / helpers）と、このフォルダ内（engine）だけ
import type { GameContext, IGame } from '../../game-api/types';
import { elem, makeSeg } from '../../game-api/helpers';
import { scramble, slide, isSolved } from './engine';

type PresetKey = 's3' | 's4' | 's5';
type Mode = 'setup' | 'play' | 'win';

interface Config {
  preset: PresetKey;
}

const END_DELAY = 1800;
const BASE = 150;
const PRESETS: Record<PresetKey, { size: number; label: string; sizeBonus: number; speedFrom: number }> = {
  s3: { size: 3, label: '3×3', sizeBonus: 0, speedFrom: 60 },
  s4: { size: 4, label: '4×4', sizeBonus: 200, speedFrom: 180 },
  s5: { size: 5, label: '5×5', sizeBonus: 500, speedFrom: 420 },
};

// 完成すると1枚になる絵（かんたん・大きな形で 5×5 に割っても分かるように）。
// 各ピースは「自分の完成位置に対応する絵の一部」を背景に表示する。開始ごとに1枚えらぶ。
const PICS: string[] = [
  // にこにこ太陽
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' fill='#8ecbff'/><g stroke='#ffb300' stroke-width='7' stroke-linecap='round'><line x1='50' y1='5' x2='50' y2='19'/><line x1='50' y1='81' x2='50' y2='95'/><line x1='5' y1='50' x2='19' y2='50'/><line x1='81' y1='50' x2='95' y2='50'/><line x1='17' y1='17' x2='27' y2='27'/><line x1='73' y1='73' x2='83' y2='83'/><line x1='83' y1='17' x2='73' y2='27'/><line x1='27' y1='73' x2='17' y2='83'/></g><circle cx='50' cy='50' r='30' fill='#ffd23f'/><circle cx='40' cy='44' r='4.5' fill='#5a3b00'/><circle cx='60' cy='44' r='4.5' fill='#5a3b00'/><path d='M38 58 Q50 70 62 58' stroke='#5a3b00' stroke-width='4' fill='none' stroke-linecap='round'/></svg>",
  // ねこ
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' fill='#ffd9ec'/><polygon points='26,20 40,44 18,44' fill='#9b6b4a'/><polygon points='74,20 82,44 60,44' fill='#9b6b4a'/><circle cx='50' cy='56' r='30' fill='#b9835c'/><circle cx='40' cy='52' r='5' fill='#26160b'/><circle cx='60' cy='52' r='5' fill='#26160b'/><polygon points='50,60 46,66 54,66' fill='#7a3b3b'/><path d='M50 66 q-6 6 -12 4 M50 66 q6 6 12 4' stroke='#26160b' stroke-width='2' fill='none'/><g stroke='#26160b' stroke-width='2'><line x1='30' y1='60' x2='13' y2='56'/><line x1='30' y1='64' x2='13' y2='67'/><line x1='70' y1='60' x2='87' y2='56'/><line x1='70' y1='64' x2='87' y2='67'/></g></svg>",
  // おうち
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' fill='#bfe6ff'/><circle cx='82' cy='18' r='10' fill='#ffd23f'/><rect y='74' width='100' height='26' fill='#7ec850'/><rect x='28' y='48' width='44' height='34' fill='#f4d59a'/><polygon points='22,48 50,22 78,48' fill='#d9482f'/><rect x='44' y='62' width='14' height='20' fill='#8a5a2b'/><rect x='33' y='53' width='10' height='10' fill='#8ecbff'/><rect x='59' y='53' width='10' height='10' fill='#8ecbff'/></svg>",
  // さかな
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' fill='#3ec6e0'/><g fill='#fff' opacity='.55'><circle cx='20' cy='24' r='5'/><circle cx='31' cy='40' r='3'/><circle cx='15' cy='52' r='4'/></g><ellipse cx='52' cy='54' rx='30' ry='20' fill='#ff8a3d'/><polygon points='24,54 5,40 5,68' fill='#ff8a3d'/><circle cx='64' cy='48' r='5.5' fill='#fff'/><circle cx='65' cy='48' r='2.6' fill='#222'/><path d='M40 46 q7 8 0 16' stroke='#e0702a' stroke-width='2.5' fill='none'/></svg>",
];

export function createGame(ctx: GameContext): IGame {
  const saved = ctx.load<Partial<Config>>('config');
  const config: Config = {
    preset: saved?.preset === 's4' || saved?.preset === 's5' ? saved.preset : 's3',
  };

  let mode: Mode = 'setup';
  let hostPaused = false;
  let size = 3;
  let presetKey: PresetKey = config.preset;
  let board: Uint8Array = new Uint8Array(0);
  let moves = 0;
  let startedAt = 0;
  let finishMs = 0;
  let resultScore = 0;
  let endAt = 0;
  let ended = false;
  let picUri = ''; // このプレイの絵（data:image/svg+xml）。各ピースが自分の完成位置の一部を表示

  const style = document.createElement('style');
  style.textContent = CSS;
  const wrap = elem('div', 'sl-wrap');
  ctx.root.append(style, wrap);

  let tiles: HTMLButtonElement[] = [];
  let boardEl: HTMLElement | null = null;
  let timeEl: HTMLElement | null = null;
  let moveEl: HTMLElement | null = null;
  let bannerEl: HTMLElement | null = null;
  let bannerUntil = 0;

  function elapsedMs(): number {
    if (mode === 'win') return finishMs;
    if (mode !== 'play') return 0;
    return ctx.now() - startedAt;
  }
  function fmtTime(ms: number): string {
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  // ---- 設定画面 ----
  function showSetup(): void {
    mode = 'setup';
    const box = elem('div', 'sl-setup');
    box.append(elem('h2', 'sl-h2', 'スライドパズル'));
    box.append(
      makeSeg(
        'sl',
        'おおきさ',
        [
          { v: 's3', t: '3×3' },
          { v: 's4', t: '4×4' },
          { v: 's5', t: '5×5' },
        ],
        () => config.preset,
        (v) => {
          config.preset = v as PresetKey;
        },
      ),
    );
    box.append(elem('p', 'sl-note', '空いている マスの となりの タイルをタップすると スライド。1〜さいごまで 順番に ならべたら クリア！'));
    const start = elem('button', 'sl-btn sl-btn-primary sl-btn-lg', 'スタート ▶') as HTMLButtonElement;
    start.addEventListener('click', () => startMatch());
    box.append(start);
    wrap.replaceChildren(box);
  }

  // ---- 開始 ----
  function startMatch(): void {
    ctx.save('config', { ...config });
    presetKey = config.preset;
    size = PRESETS[presetKey].size;
    picUri = 'data:image/svg+xml,' + encodeURIComponent(PICS[Math.floor(ctx.random() * PICS.length)] ?? PICS[0] ?? '');
    board = scramble(size, ctx.random, size * size * 20);
    moves = 0;
    finishMs = 0;
    resultScore = 0;
    ended = false;
    endAt = 0;
    mode = 'play';
    startedAt = ctx.now();
    buildPlay();
  }

  function buildPlay(): void {
    const play = elem('div', 'sl-play');
    const hud = elem('div', 'sl-hud');
    timeEl = elem('span', 'sl-hud-item', '⏱ 0:00');
    moveEl = elem('span', 'sl-hud-item', 'てすう 0');
    hud.append(timeEl, moveEl);

    const bw = elem('div', 'sl-board-wrap');
    boardEl = elem('div', 'sl-board');
    tiles = [];
    for (let i = 0; i < size * size; i++) {
      const idx = i;
      const t = elem('button', 'sl-tile') as HTMLButtonElement;
      t.append(elem('span', 'sl-num'));
      t.addEventListener('click', () => onTile(idx));
      tiles.push(t);
      boardEl.append(t);
    }
    bw.append(boardEl);

    const tools = elem('div', 'sl-toolrow');
    const shuffleBtn = elem('button', 'sl-tool', '🔀 まぜなおす') as HTMLButtonElement;
    shuffleBtn.addEventListener('click', () => reshuffle());
    tools.append(shuffleBtn);

    play.append(hud, bw, tools);
    wrap.replaceChildren(play);
    paintAll();
    layout();
  }

  function reshuffle(): void {
    if (mode !== 'play' || hostPaused) return;
    board = scramble(size, ctx.random, size * size * 20);
    moves = 0;
    startedAt = ctx.now();
    ctx.sfx('tick');
    paintAll();
  }

  function layout(): void {
    if (!boardEl || !wrap) return;
    const availW = wrap.clientWidth - 20;
    const availH = wrap.clientHeight - 110;
    const cell = Math.max(30, Math.floor(Math.min(availW, availH) / size));
    boardEl.style.gridTemplateColumns = `repeat(${size}, ${cell}px)`;
    boardEl.style.gridAutoRows = `${cell}px`;
    boardEl.style.fontSize = `${Math.round(cell * 0.42)}px`;
  }

  // ---- 操作 ----
  function onTile(idx: number): void {
    if (mode !== 'play' || hostPaused) return;
    if (slide(board, idx, size)) {
      moves++;
      ctx.sfx('tap');
      paintAll();
      checkWin();
    }
  }

  function checkWin(): void {
    if (mode !== 'play' || !isSolved(board, size)) return;
    mode = 'win';
    finishMs = ctx.now() - startedAt;
    const P = PRESETS[presetKey];
    const secs = Math.floor(finishMs / 1000);
    resultScore = BASE + P.sizeBonus + Math.max(0, P.speedFrom - secs);
    ctx.achieve('first-solve');
    if (size === 4) ctx.achieve('clear-normal');
    if (size === 5) ctx.achieve('clear-hard');
    if (size === 4 && finishMs <= 90_000) ctx.achieve('speedy');
    if (size === 4 && moves <= 70) ctx.achieve('sharp');
    const cleared = ctx.load<Record<string, boolean>>('cleared') ?? {};
    cleared[presetKey] = true;
    ctx.save('cleared', cleared);
    if (cleared.s3 && cleared.s4 && cleared.s5) ctx.achieve('all-sizes');
    ctx.sfx('medal');
    ctx.haptic('success');
    boardEl?.classList.add('sl-done');
    showBanner('🎉 クリア！', END_DELAY - 200);
    endAt = ctx.now() + END_DELAY;
    paintAll();
  }

  function showBanner(text: string, ms: number): void {
    hideBanner();
    bannerEl = elem('div', 'sl-banner', text);
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
    for (let i = 0; i < size * size; i++) {
      const el = tiles[i];
      if (!el) continue;
      const v = board[i] ?? 0;
      const correct = v !== 0 && v === i + 1;
      el.className = 'sl-tile' + (v === 0 ? ' sl-gap' : '') + (correct ? ' sl-ok' : '');
      const num = el.firstElementChild as HTMLElement | null;
      if (v === 0) {
        el.style.backgroundImage = 'none';
        if (num) num.textContent = '';
      } else {
        // 各ピースは「完成位置(v-1)」に対応する絵の一部を表示＝そろうと1枚の絵になる
        const home = v - 1;
        const hr = (home / size) | 0;
        const hc = home % size;
        el.style.backgroundImage = `url("${picUri}")`;
        el.style.backgroundSize = `${size * 100}% ${size * 100}%`;
        el.style.backgroundPosition = `${(hc * 100) / (size - 1)}% ${(hr * 100) / (size - 1)}%`;
        if (num) num.textContent = String(v);
      }
      el.disabled = mode !== 'play' || v === 0;
    }
    if (moveEl) moveEl.textContent = `てすう ${moves}`;
  }

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
.sl-wrap{position:absolute;inset:0;overflow:hidden}
.sl-setup{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:safe center;
  gap:14px;padding:20px 16px;box-sizing:border-box;overflow-y:auto;user-select:none;-webkit-user-select:none}
.sl-h2{margin:4px 0;font-size:22px}
.sl-seg-row{width:min(92vw,420px);display:flex;flex-direction:column;gap:6px}
.sl-seg-label{font-size:13px;color:var(--text-dim);font-weight:800}
.sl-seg{display:flex;background:var(--bg-elev2);border-radius:12px;padding:3px;gap:2px}
.sl-seg-btn{flex:1;border:none;background:none;color:var(--text-dim);padding:10px 2px;border-radius:9px;
  font-size:14px;font-weight:800;min-height:44px}
.sl-seg-btn.sl-on{background:var(--accent);color:#fff}
.sl-note{font-size:12px;color:var(--text-dim);text-align:center;max-width:min(92vw,420px);margin:0;line-height:1.7}
.sl-btn{appearance:none;border:none;border-radius:12px;padding:12px 18px;font-size:15px;font-weight:800;
  background:var(--bg-elev2);color:var(--text);min-height:44px}
.sl-btn-primary{background:var(--accent-grad);color:#fff}
.sl-btn-lg{width:100%;max-width:300px;font-size:18px}

.sl-play{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;padding:6px 8px 10px;
  box-sizing:border-box;user-select:none;-webkit-user-select:none}
.sl-hud{display:flex;justify-content:center;gap:20px;align-items:center;min-height:44px;padding:0 64px}
.sl-hud-item{font-size:15px;font-weight:800;white-space:nowrap}
.sl-board-wrap{flex:1 1 auto;min-height:0;display:flex;align-items:center;justify-content:center}
.sl-board{display:grid;gap:5px;background:var(--bg-elev);padding:5px;border-radius:10px}
.sl-tile{position:relative;border:none;margin:0;padding:0;box-sizing:border-box;border-radius:8px;overflow:hidden;
  background-color:#2a2f4a;background-repeat:no-repeat;font-family:inherit;box-shadow:0 2px 4px rgba(0,0,0,.25)}
.sl-num{position:absolute;top:3px;left:4px;font-size:.6em;font-weight:900;line-height:1;color:#fff;
  background:rgba(0,0,0,.55);border-radius:6px;padding:2px 5px;min-height:0}
.sl-num:empty{display:none}
.sl-tile.sl-ok{outline:3px solid #2fbf71;outline-offset:-3px}
.sl-tile.sl-gap{background-color:transparent;box-shadow:none}
.sl-board.sl-done{box-shadow:0 0 0 4px #2fbf71,0 0 22px rgba(47,191,113,.55)}
.sl-toolrow{display:flex;gap:8px;justify-content:center;padding-top:10px}
.sl-tool{appearance:none;border:none;border-radius:12px;min-height:44px;padding:8px 16px;font-size:13px;font-weight:800;
  background:var(--bg-elev2);color:var(--text)}
.sl-banner{position:absolute;left:50%;top:46%;transform:translate(-50%,-50%);background:rgba(16,19,48,.9);color:#fff;
  padding:12px 24px;border-radius:999px;font-weight:800;font-size:22px;pointer-events:none;white-space:nowrap;z-index:5;
  animation:sl-pop .2s ease-out}
@keyframes sl-pop{from{opacity:0;transform:translate(-50%,-42%)}to{opacity:1;transform:translate(-50%,-50%)}}
`;
