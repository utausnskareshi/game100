// =============================================================
// ぺあさがし（No.21）: ふせたカードを2枚ずつめくって同じ絵をそろえる（神経衰弱）
// =============================================================
// - 不一致は少し見せてから自動で伏せ直す（ctx.now 期限方式＝ポーズで自動停止）
// - れんぞくでペアを当てるとコンボ。配置は ctx.random＝「今日のゲーム」では全員同じ盤
// - むずかしさ＝盤の大きさ（4×4 / 5×6 / 6×6）
// - import してよいのは game-api（types / helpers）と、このフォルダ内（deck）だけ
import type { GameContext, IGame } from '../../game-api/types';
import { elem, makeSeg } from '../../game-api/helpers';
import { buildDeck } from './deck';

type PresetKey = 'p4' | 'p5' | 'p6';
type Mode = 'setup' | 'play' | 'win';

interface Config {
  preset: PresetKey;
}

const MISMATCH_MS = 900; // 不一致カードを見せておく時間
const END_DELAY = 1800; // そろった演出→結果画面までの余韻(ms)
const BASE = 100;
const PAIR_PTS = 20;
const MOVE_PTS = 8; // 手数ボーナス: (par − めくり回数) × これ

// プリセット（速さ基準・実績しきい値は playtest 調整前提の仮値）
const PRESETS: Record<
  PresetKey,
  { cols: number; rows: number; label: string; speedFrom: number; speedy: number }
> = {
  p4: { cols: 4, rows: 4, label: '4×4', speedFrom: 120, speedy: 45 },
  p5: { cols: 5, rows: 6, label: '5×6', speedFrom: 240, speedy: 120 },
  p6: { cols: 6, rows: 6, label: '6×6', speedFrom: 360, speedy: 180 },
};

export function createGame(ctx: GameContext): IGame {
  // ---- 設定（前回を復元。はじめての人向けに既定は 4×4）----
  const saved = ctx.load<Partial<Config>>('config');
  const config: Config = {
    preset: saved?.preset === 'p5' || saved?.preset === 'p6' ? saved.preset : 'p4',
  };

  // ---- 状態 ----
  let mode: Mode = 'setup';
  let hostPaused = false;
  let presetKey: PresetKey = config.preset;
  let cols = 4;
  let rows = 4;
  let pairs = 8;
  let deck: string[] = [];
  let matched: boolean[] = [];
  let open: number[] = []; // いま表になっている未確定カード（0〜2枚）
  let flips = 0; // 「2枚めくって判定」した回数
  let matchedPairs = 0;
  let combo = 0;
  let flipBackAt = 0; // 不一致カードを伏せ直す時刻（0=待ちなし）
  let startedAt = 0;
  let finishMs = 0;
  let resultScore = 0;
  let endAt = 0;
  let ended = false;
  let bannerUntil = 0;

  // ---- DOM ----
  const style = document.createElement('style');
  style.textContent = CSS;
  const wrap = elem('div', 'pm-wrap');
  ctx.root.append(style, wrap);

  let playEl: HTMLElement | null = null;
  let hudEl: HTMLElement | null = null;
  let timeEl: HTMLElement | null = null;
  let flipsEl: HTMLElement | null = null;
  let pairsEl: HTMLElement | null = null;
  let comboEl: HTMLElement | null = null;
  let boardWrap: HTMLElement | null = null;
  let boardEl: HTMLElement | null = null;
  let cards: HTMLButtonElement[] = [];
  let bannerEl: HTMLElement | null = null;

  const par = (): number => Math.ceil(pairs * 2.6);
  const sharpThr = (): number => Math.ceil(pairs * 2.25);

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
    if (import.meta.env.DEV) wrap.dataset.st = 'setup';
    const box = elem('div', 'pm-setup');
    box.append(elem('h2', 'pm-h2', 'おなじ絵を さがそう！'));
    box.append(
      makeSeg(
        'pm',
        'ばんの大きさ',
        [
          { v: 'p4', t: '4×4' },
          { v: 'p5', t: '5×6' },
          { v: 'p6', t: '6×6' },
        ],
        () => config.preset,
        (v) => {
          config.preset = v as PresetKey;
        },
      ),
    );
    box.append(
      elem(
        'p',
        'pm-note',
        'カードを2まいずつ めくって、同じ絵の ペアを ぜんぶ 見つけよう！めくった場所を おぼえるのが コツ。れんぞくで 当てると コンボだよ。',
      ),
    );
    const start = elem('button', 'pm-btn pm-btn-primary pm-btn-lg', 'はじめる ▶') as HTMLButtonElement;
    start.addEventListener('click', () => startMatch());
    box.append(start);
    wrap.replaceChildren(box);
  }

  // ---- 開始 ----
  function startMatch(): void {
    ctx.save('config', { ...config });
    presetKey = config.preset;
    const P = PRESETS[presetKey];
    cols = P.cols;
    rows = P.rows;
    pairs = (cols * rows) / 2;
    deck = buildDeck(ctx.random, pairs);
    matched = new Array(deck.length).fill(false);
    open = [];
    flips = 0;
    matchedPairs = 0;
    combo = 0;
    flipBackAt = 0;
    finishMs = 0;
    resultScore = 0;
    ended = false;
    endAt = 0;
    mode = 'play';
    if (import.meta.env.DEV) wrap.dataset.st = 'play';
    startedAt = ctx.now();
    buildPlay();
  }

  function buildPlay(): void {
    playEl = elem('div', 'pm-play');

    hudEl = elem('div', 'pm-hud');
    timeEl = elem('span', 'pm-hud-item', '⏱ 0:00');
    flipsEl = elem('span', 'pm-hud-item', 'てすう 0');
    pairsEl = elem('span', 'pm-hud-item', `ペア 0/${pairs}`);
    comboEl = elem('span', 'pm-hud-item pm-combo', '');
    hudEl.append(timeEl, flipsEl, pairsEl, comboEl);

    boardWrap = elem('div', 'pm-board-wrap');
    boardEl = elem('div', 'pm-board');
    cards = [];
    for (let i = 0; i < deck.length; i++) {
      const idx = i;
      const c = elem('button', 'pm-card') as HTMLButtonElement;
      c.addEventListener('click', () => onCard(idx));
      cards.push(c);
      boardEl.append(c);
    }
    boardWrap.append(boardEl);

    playEl.append(hudEl, boardWrap);
    wrap.replaceChildren(playEl);
    layout();
    paintAll();
  }

  // セル一辺を「幅・高さの両方に収まる」ように計算（gap/padding を控除して縦あふれ防止）
  function layout(): void {
    if (!playEl || !boardEl || !hudEl) return;
    const GAP = 6; // .pm-board の gap と一致させること
    const PAD = 12; // .pm-board の padding 6px × 2
    const availW = playEl.clientWidth - 8 - (cols - 1) * GAP - PAD;
    const availH = playEl.clientHeight - hudEl.offsetHeight - 22 - (rows - 1) * GAP - PAD;
    const cell = Math.max(34, Math.floor(Math.min(availW / cols, availH / rows)));
    boardEl.style.gridTemplateColumns = `repeat(${cols}, ${cell}px)`;
    boardEl.style.gridAutoRows = `${cell}px`;
    boardEl.style.fontSize = `${Math.round(cell * 0.55)}px`;
  }

  // ---- 操作 ----
  function onCard(i: number): void {
    if (mode !== 'play' || hostPaused) return;
    if (flipBackAt > 0) return; // 不一致の伏せ直し待ち中はめくれない
    if (matched[i] || open.includes(i) || open.length >= 2) return;
    open.push(i);
    paintCard(i);
    ctx.sfx('tick');
    if (open.length < 2) return;

    flips++;
    const [a, b] = open;
    if (a !== undefined && b !== undefined && deck[a] === deck[b]) {
      matched[a] = true;
      matched[b] = true;
      matchedPairs++;
      combo++;
      open = [];
      paintCard(a);
      paintCard(b);
      if (combo === 3) ctx.achieve('combo-3');
      ctx.sfx(combo >= 3 ? 'combo' : 'success');
      ctx.haptic('light');
      if (matchedPairs >= pairs) {
        win(ctx.now());
        return;
      }
    } else {
      combo = 0;
      flipBackAt = ctx.now() + MISMATCH_MS; // 見せてから伏せ直す
    }
    paintHud();
  }

  // ---- 勝利 ----
  function computeScore(): number {
    const P = PRESETS[presetKey];
    const secs = Math.floor(finishMs / 1000);
    let s = BASE + pairs * PAIR_PTS;
    s += Math.max(0, par() - flips) * MOVE_PTS;
    s += Math.max(0, P.speedFrom - secs);
    return s;
  }

  function win(now: number): void {
    mode = 'win';
    if (import.meta.env.DEV) wrap.dataset.st = 'win';
    finishMs = now - startedAt;
    resultScore = computeScore();
    const secs = Math.floor(finishMs / 1000);
    ctx.achieve('first-clear');
    if (presetKey === 'p6') ctx.achieve('big-clear');
    if (flips <= sharpThr()) ctx.achieve('sharp');
    if (secs <= PRESETS[presetKey].speedy) ctx.achieve('speedy');
    // ぜんサイズ制覇（インスタンス跨ぎ。maze / treasure-dig と同じ ctx.save パターン）
    const cleared = ctx.load<Record<string, boolean>>('cleared') ?? {};
    cleared[presetKey] = true;
    ctx.save('cleared', cleared);
    if (cleared.p4 && cleared.p5 && cleared.p6) ctx.achieve('all-sizes');
    ctx.sfx('medal');
    ctx.haptic('success');
    boardEl?.classList.add('pm-done');
    showBanner('🎉 ぜんぶ そろった！', END_DELAY - 200);
    endAt = now + END_DELAY;
    paintHud();
  }

  // ---- バナー ----
  function showBanner(text: string, ms: number): void {
    hideBanner();
    bannerEl = elem('div', 'pm-banner', text);
    wrap.append(bannerEl);
    bannerUntil = ctx.now() + ms;
  }
  function hideBanner(): void {
    bannerEl?.remove();
    bannerEl = null;
    bannerUntil = 0;
  }

  // ---- 描画 ----
  function paintCard(i: number): void {
    const el = cards[i];
    if (!el) return;
    const face = matched[i] || open.includes(i);
    el.className = 'pm-card' + (face ? ' pm-open' : '') + (matched[i] ? ' pm-matched' : '');
    el.textContent = face ? deck[i] ?? '' : '';
    el.disabled = mode !== 'play' || matched[i] === true;
  }
  function paintAll(): void {
    for (let i = 0; i < cards.length; i++) paintCard(i);
    paintHud();
  }
  function paintHud(): void {
    if (flipsEl) flipsEl.textContent = `てすう ${flips}`;
    if (pairsEl) pairsEl.textContent = `ペア ${matchedPairs}/${pairs}`;
    if (comboEl) comboEl.textContent = combo >= 2 ? `🔥 ×${combo}` : '';
  }

  // ---- 毎フレーム（タイマー・伏せ直し・結果遷移。すべて ctx.now 基準＝ポーズで停止）----
  const offFrame = ctx.onFrame(() => {
    const now = ctx.now();
    if (bannerEl && now >= bannerUntil) hideBanner();
    if (flipBackAt > 0 && now >= flipBackAt) {
      const toClose = open;
      open = [];
      flipBackAt = 0;
      for (const i of toClose) paintCard(i);
      ctx.sfx('tick');
    }
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
    },
    resume() {
      hostPaused = false;
    },
    resize() {
      if (mode !== 'setup') layout();
    },
    destroy() {
      offFrame();
      style.remove();
      wrap.remove();
    },
  };
}

// =============================================================
// スタイル（.pm- プレフィックス。テーマ変数でライト/ダーク両対応）
// =============================================================
const CSS = `
.pm-wrap{position:absolute;inset:0;overflow:hidden}

/* 設定画面 */
.pm-setup{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:safe center;
  gap:14px;padding:20px 16px;box-sizing:border-box;overflow-y:auto;user-select:none;-webkit-user-select:none}
.pm-h2{margin:4px 0;font-size:22px;text-align:center}
.pm-seg-row{width:min(92vw,420px);display:flex;flex-direction:column;gap:6px}
.pm-seg-label{font-size:13px;color:var(--text-dim);font-weight:800}
.pm-seg{display:flex;background:var(--bg-elev2);border-radius:12px;padding:3px;gap:2px}
.pm-seg-btn{flex:1;border:none;background:none;color:var(--text-dim);padding:10px 2px;border-radius:9px;
  font-size:14px;font-weight:800;min-height:44px}
.pm-seg-btn.pm-on{background:var(--accent);color:#fff}
.pm-note{font-size:12px;color:var(--text-dim);text-align:center;max-width:min(92vw,420px);margin:0;line-height:1.7}
.pm-btn{appearance:none;border:none;border-radius:12px;padding:12px 18px;font-size:15px;font-weight:800;font-family:inherit;
  background:var(--bg-elev2);color:var(--text);min-height:44px}
.pm-btn-primary{background:var(--accent-grad);color:#fff}
.pm-btn-lg{width:100%;max-width:300px;font-size:18px}

/* プレイ画面 */
.pm-play{position:absolute;inset:0;display:flex;flex-direction:column;padding:6px 4px 10px;box-sizing:border-box;
  user-select:none;-webkit-user-select:none}
/* min-height 54px + 左右64px でポーズ予約領域（右上60×60）を構造的によける */
.pm-hud{display:flex;justify-content:center;align-items:center;gap:14px;padding:2px 64px 6px;flex-wrap:wrap;min-height:54px}
.pm-hud-item{font-size:14px;font-weight:800;white-space:nowrap}
.pm-combo{color:var(--accent-2)}
.pm-board-wrap{flex:1 1 auto;min-height:0;display:flex;align-items:center;justify-content:center;position:relative}
.pm-board{display:grid;gap:6px;background:var(--bg-elev);padding:6px;border-radius:12px}

/* カード */
.pm-card{position:relative;border:none;margin:0;padding:0;border-radius:10px;font-family:inherit;line-height:1;
  background:linear-gradient(135deg,#6c5ce7,#4a58c0);box-shadow:0 2px 5px rgba(0,0,0,.25);
  transition:transform .12s ease;display:flex;align-items:center;justify-content:center}
.pm-card::after{content:'？';font-size:.62em;font-weight:900;color:rgba(255,255,255,.75)}
.pm-card.pm-open{background:#fdfdfd;box-shadow:inset 0 0 0 2px #cdd3e0,0 2px 5px rgba(0,0,0,.18);
  animation:pm-pop .16s ease-out}
.pm-card.pm-open::after{content:''}
.pm-card.pm-matched{background:#eefcf1;box-shadow:inset 0 0 0 2px #2fbf71;opacity:.92}
.pm-card:active{transform:scale(.95)}
.pm-card:disabled{cursor:default}
@keyframes pm-pop{from{transform:scale(.7)}to{transform:scale(1)}}
.pm-board.pm-done{box-shadow:0 0 0 4px #2fbf71,0 0 22px rgba(47,191,113,.55)}

/* バナー */
.pm-banner{position:absolute;left:50%;top:44%;transform:translate(-50%,-50%);background:rgba(16,19,48,.9);color:#fff;
  padding:12px 24px;border-radius:999px;font-weight:800;font-size:20px;pointer-events:none;white-space:nowrap;z-index:5;
  animation:pm-in .2s ease-out}
@keyframes pm-in{from{opacity:0;transform:translate(-50%,-42%)}to{opacity:1;transform:translate(-50%,-50%)}}
`;
