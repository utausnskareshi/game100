// =============================================================
// ぬりえタッチ（No.47）: 数字とおなじ色をえらんで、ドット絵をぬりあげよう！
// =============================================================
// - パレットで色をえらぶ → その番号のマスをタップでぬれる。ちがう番号は ぷるぷる（ミス）。
// - ぜんぶぬると絵が完成！まちがえてもへっちゃら（チル）。はやさ・せいかくさでボーナス。
// - 絵データは art.ts（自作ドット絵3枚・ctx.random で1枚選択＝日替わり同一）。
// - DOMゲーム（onMove非購読=ネイティブclick）。startMode:'immediate'。
// - import してよいのは game-api（types / helpers）と、このフォルダ内（art）だけ
import type { GameContext, IGame } from '../../game-api/types';
import { elem } from '../../game-api/helpers';
import { ARTS, GRID, artScore, cellNum, paintableCount, pickArt, type ArtDef } from './art';

type Phase = 'paint' | 'over';

const END_DELAY = 2200;
const SPEEDY_SEC = 90;
const STREAK_ACH = 20;

export function createGame(ctx: GameContext): IGame {
  // ---- 状態 ----
  let phase: Phase = 'paint';
  let hostPaused = false;
  const artIdx = pickArt(ctx.random);
  const art: ArtDef = ARTS[artIdx]!;
  const total = paintableCount(art);
  const painted: boolean[] = new Array(GRID * GRID).fill(false);
  let paintedCount = 0;
  let selected = 1;
  let mistakes = 0;
  let streak = 0;
  let score = 0;
  let startAt = 0;
  let lastSec = -1;
  let endAt = 0;
  let ended = false;

  // ---- DOM ----
  const style = document.createElement('style');
  style.textContent = CSS;
  const wrap = elem('div', 'cl-wrap');
  ctx.root.append(style, wrap);

  let hudTitleEl: HTMLElement | null = null;
  let hudTimeEl: HTMLElement | null = null;
  let hudLeftEl: HTMLElement | null = null;
  let gridEl: HTMLElement | null = null;
  let msgEl: HTMLElement | null = null;
  let cellEls: HTMLButtonElement[] = [];
  let palEls: HTMLButtonElement[] = [];

  function devState(): void {
    if (!import.meta.env.DEV) return;
    const ds = wrap.dataset;
    ds.st = phase;
    ds.art = String(artIdx);
    ds.painted = String(paintedCount);
    ds.total = String(total);
    ds.mistakes = String(mistakes);
    ds.score = String(score);
    ds.selected = String(selected);
  }

  function remainOf(n: number): number {
    let c = 0;
    for (let i = 0; i < GRID * GRID; i++) if (!painted[i] && cellNum(art, i) === n) c++;
    return c;
  }

  function buildUi(): void {
    const hud = elem('div', 'cl-hud');
    hudTitleEl = elem('span', 'cl-hud-item', `「${art.title}」をぬろう！`);
    hudTimeEl = elem('span', 'cl-hud-item', '⏱ 0びょう');
    hudLeftEl = elem('span', 'cl-hud-item', `のこり ${total}`);
    hud.append(hudTitleEl, hudTimeEl, hudLeftEl);

    gridEl = elem('div', 'cl-grid');
    cellEls = [];
    for (let i = 0; i < GRID * GRID; i++) {
      const idx = i;
      const n = cellNum(art, i);
      const b = elem('button', 'cl-cell') as HTMLButtonElement;
      if (n === 0) {
        b.classList.add('cl-blank');
        b.disabled = true;
      } else {
        b.textContent = String(n);
        b.addEventListener('click', () => onCell(idx));
      }
      cellEls.push(b);
      gridEl.append(b);
    }

    const pal = elem('div', 'cl-palette');
    palEls = [];
    for (const p of art.palette) {
      const b = elem('button', 'cl-pal') as HTMLButtonElement;
      b.style.background = p.color;
      b.append(elem('span', 'cl-pal-n', String(p.n)), elem('span', 'cl-pal-count', String(remainOf(p.n))));
      b.addEventListener('click', () => {
        if (phase !== 'paint' || hostPaused) return;
        selected = p.n;
        paintPalette();
        ctx.sfx('tick');
      });
      palEls.push(b);
      pal.append(b);
    }

    msgEl = elem('div', 'cl-msg', '色をえらんで、おなじ数字のマスをタップ！');
    wrap.append(hud, gridEl, msgEl, pal);
    paintPalette();
  }

  function paintPalette(): void {
    for (let i = 0; i < palEls.length; i++) {
      const p = art.palette[i]!;
      palEls[i]!.classList.toggle('cl-pal-on', p.n === selected);
      const cnt = palEls[i]!.querySelector('.cl-pal-count');
      if (cnt) cnt.textContent = String(remainOf(p.n));
      palEls[i]!.classList.toggle('cl-pal-done', remainOf(p.n) === 0);
    }
  }

  // ---- ぬり ----
  function onCell(i: number): void {
    if (phase !== 'paint' || hostPaused || painted[i]) return;
    const n = cellNum(art, i);
    const el = cellEls[i]!;
    if (n === selected) {
      painted[i] = true;
      paintedCount++;
      streak++;
      el.textContent = '';
      el.classList.add('cl-done');
      el.style.background = art.palette[n - 1]!.color;
      ctx.sfx('tap');
      if (streak >= STREAK_ACH) ctx.achieve('streak-20');
      if (hudLeftEl) hudLeftEl.textContent = `のこり ${total - paintedCount}`;
      // その色をぬりおえたら つぎの色へ自動でうつる
      if (remainOf(selected) === 0 && paintedCount < total) {
        const next = art.palette.find((p) => remainOf(p.n) > 0);
        if (next) selected = next.n;
        ctx.sfx('success');
      }
      paintPalette();
      if (paintedCount >= total) complete();
    } else {
      mistakes++;
      streak = 0;
      el.classList.remove('cl-shake');
      void el.offsetWidth;
      el.classList.add('cl-shake');
      ctx.sfx('tick');
      ctx.haptic('light');
      if (msgEl) msgEl.textContent = `そこは「${n}」のマス。パレットを見てみよう`;
    }
    devState();
  }

  function complete(): void {
    const now = ctx.now();
    const sec = Math.floor((now - startAt) / 1000);
    score = artScore(sec, mistakes);
    phase = 'over';
    endAt = now + END_DELAY;
    // 実績（完成時に即解除）
    ctx.achieve('first-complete');
    if (mistakes === 0) ctx.achieve('no-miss');
    if (sec <= SPEEDY_SEC) ctx.achieve('speedy-90');
    if (mistakes === 0 && sec <= SPEEDY_SEC) ctx.achieve('perfect');
    const cleared = ctx.load<Record<string, boolean>>('cleared') ?? {};
    cleared[art.key] = true;
    ctx.save('cleared', cleared);
    if (ARTS.every((a) => cleared[a.key])) ctx.achieve('all-arts');
    gridEl?.classList.add('cl-finish');
    if (msgEl) {
      msgEl.className = 'cl-msg cl-msg-win';
      msgEl.textContent = `「${art.title}」かんせい！ 🎨 +${score}てん`;
    }
    ctx.sfx('medal');
    ctx.haptic('success');
    devState();
  }

  // ---- 毎フレーム（タイマー・終了遷移）----
  const offFrame = ctx.onFrame(() => {
    const now = ctx.now();
    if (phase === 'paint') {
      const sec = Math.floor((now - startAt) / 1000);
      if (sec !== lastSec) {
        lastSec = sec;
        if (hudTimeEl) hudTimeEl.textContent = `⏱ ${sec}びょう`;
      }
      return;
    }
    if (phase === 'over' && !ended && now >= endAt) {
      ended = true;
      ctx.end({ score });
    }
  });

  // ---- 起動（startMode:'immediate'）----
  buildUi();
  startAt = ctx.now();
  devState();

  return {
    start() {
      // カウントダウンなし。ぬりえはすぐ始まる
      startAt = ctx.now();
    },
    pause() {
      hostPaused = true;
    },
    resume() {
      hostPaused = false;
    },
    resize() {
      // グリッドは可変幅CSS（min(94vw,420px)）
    },
    destroy() {
      offFrame();
      style.remove();
      wrap.remove();
    },
  };
}

// =============================================================
// スタイル（.cl- プレフィックス。テーマ変数でライト/ダーク両対応）
// =============================================================
const CSS = `
.cl-wrap{position:absolute;inset:0;overflow:hidden;display:flex;flex-direction:column;align-items:center;
  user-select:none;-webkit-user-select:none}
.cl-hud{display:flex;justify-content:center;align-items:center;gap:12px;padding:8px 64px 4px;flex-wrap:wrap;min-height:54px}
.cl-hud-item{font-size:13.5px;font-weight:800;white-space:nowrap;font-variant-numeric:tabular-nums}
.cl-grid{width:min(94vw,420px);aspect-ratio:1;margin-top:2px;background:var(--bg-elev);border-radius:12px;padding:6px;
  box-sizing:border-box;display:grid;grid-template-columns:repeat(10,1fr);grid-template-rows:repeat(10,1fr);gap:1px}
.cl-cell{border:none;margin:0;padding:0;border-radius:4px;font-family:inherit;font-size:13px;font-weight:800;line-height:1;
  background:var(--bg-elev2);color:var(--text-dim)}
.cl-cell.cl-blank{background:transparent}
.cl-cell.cl-done{color:transparent}
@keyframes cl-shakeanim{0%,100%{transform:translateX(0)}25%{transform:translateX(-3px)}75%{transform:translateX(3px)}}
.cl-cell.cl-shake{animation:cl-shakeanim .25s}
@keyframes cl-pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.015)}}
.cl-grid.cl-finish{animation:cl-pulse .6s ease-in-out 2}
.cl-msg{min-height:22px;font-size:14px;font-weight:900;color:var(--text-dim);text-align:center;margin:8px 0 0;padding:0 10px}
.cl-msg-win{color:#2fae5e}
.cl-palette{display:flex;gap:12px;margin-top:8px}
.cl-pal{position:relative;width:56px;height:56px;border-radius:14px;border:none;margin:0;font-family:inherit;
  box-shadow:0 2px 6px rgba(0,0,0,.25);display:flex;align-items:center;justify-content:center}
.cl-pal-n{font-size:20px;font-weight:900;color:rgba(0,0,0,.55);background:rgba(255,255,255,.72);border-radius:50%;
  width:28px;height:28px;display:flex;align-items:center;justify-content:center}
.cl-pal-count{position:absolute;right:-4px;top:-6px;background:var(--bg-elev2);color:var(--text);font-size:11px;
  font-weight:800;border-radius:999px;padding:2px 6px}
.cl-pal.cl-pal-on{outline:3px solid var(--accent);outline-offset:2px}
.cl-pal.cl-pal-done{opacity:.4}
`;
