// =============================================================
// ソリティア（No.56・クロンダイク）: タップで自動移動の やさしいUI
// =============================================================
// - 場札の表向きカードを タップ→ 置ける場所（組札を優先→場札）へ自動で動く。
//   山札を タップ→ 1枚めくる。全部 組札にそろえたら クリア！
// - 盤ロジック・移動判定・自動移動は engine.ts（純ロジック・rng注入）。DOM描画・タップ駆動。
// - 時間は ctx.now・乱数は ctx.random・setTimeout 不使用。
// - import してよいのは game-api（types / helpers）と、このフォルダ内（engine）だけ
import type { GameContext, IGame } from '../../game-api/types';
import { clamp, elem } from '../../game-api/helpers';
import {
  RANK_CHARS,
  SUIT_CHARS,
  type Card,
  type GameState,
  applyMove,
  deal,
  drawStock,
  findAutoMove,
  foundationCount,
  isRed,
  isWin,
} from './engine';

const FOUND_PTS = 15;
const WIN_BONUS = 300;
const SPEED_WIN_SEC = 300;
const END_DELAY = 1900;

type Mode = 'play' | 'won';

export function createGame(ctx: GameContext): IGame {
  let s: GameState = deal(ctx.random);
  let mode: Mode = 'play';
  let hostPaused = false;
  let startAt = 0;
  let recycled = false;
  let firstFoundationDone = false;
  let ended = false;
  let winAt = 0;

  const style = document.createElement('style');
  style.textContent = CSS;
  const wrap = elem('div', 'so-wrap');
  ctx.root.append(style, wrap);

  const scoreNow = (): number => foundationCount(s) * FOUND_PTS;

  function setData(): void {
    if (!import.meta.env.DEV) return;
    const r = ctx.root as HTMLElement;
    r.dataset.mode = mode;
    r.dataset.found = String(foundationCount(s));
    r.dataset.score = String(scoreNow());
    r.dataset.stock = String(s.stock.length);
    r.dataset.waste = String(s.waste.length);
    r.dataset.recycled = recycled ? '1' : '0';
    r.dataset.cols = s.tableau.map((c) => c.length).join(',');
    r.dataset.foundcols = s.foundations.map((f) => f.length).join(',');
  }

  // ---- 実績（到達した瞬間に解除）----
  function checkAchievements(): void {
    const fc = foundationCount(s);
    if (fc >= 1 && !firstFoundationDone) {
      firstFoundationDone = true;
      ctx.achieve('first-foundation');
    }
    if (s.foundations.some((f) => f.length === 13)) ctx.achieve('suit-done');
    if (fc >= 26) ctx.achieve('half');
    if (isWin(s)) {
      ctx.achieve('win');
      const sec = (ctx.now() - startAt) / 1000;
      if (sec <= SPEED_WIN_SEC) ctx.achieve('speed-win');
      if (!recycled) ctx.achieve('no-recycle');
    }
  }

  // ---- 操作 ----
  function onStock(): void {
    if (mode !== 'play' || hostPaused) return;
    const r = drawStock(s);
    if (r === 'recycle') recycled = true;
    if (r !== 'none') ctx.sfx('tap');
    render();
    setData();
  }

  function tapCard(from: 'waste' | 'tableau', col: number, index: number): void {
    if (mode !== 'play' || hostPaused) return;
    const m = findAutoMove(s, from, col, index);
    if (!m) {
      ctx.sfx('fail');
      return;
    }
    applyMove(s, m);
    ctx.sfx(m.to === 'foundation' ? 'success' : 'tap');
    ctx.haptic('light');
    checkAchievements();
    if (isWin(s)) {
      mode = 'won';
      winAt = ctx.now();
      ctx.sfx('medal');
      ctx.haptic('success');
    }
    render();
    setData();
  }

  function finish(): void {
    if (ended) return;
    ended = true;
    ctx.end({ score: mode === 'won' ? winScore() : scoreNow() });
  }

  function winScore(): number {
    const sec = Math.floor((winAt - startAt) / 1000);
    return 52 * FOUND_PTS + WIN_BONUS + Math.max(0, 400 - sec);
  }

  // ---- 描画（タップ駆動なので都度フル再構築）----
  function render(): void {
    const W = wrap.clientWidth || 360;
    const H = wrap.clientHeight || 560;
    const gap = 6;
    const cw = clamp(Math.floor((W - gap * 8) / 7), 34, 60);
    const ch = Math.round(cw * 1.4);

    const top = elem('div', 'so-top');
    // 山札
    const stockEl = elem('div', 'so-slot' + (s.stock.length ? ' so-back' : ' so-empty'));
    stockEl.style.width = `${cw}px`;
    stockEl.style.height = `${ch}px`;
    stockEl.textContent = s.stock.length ? '' : '↻';
    stockEl.addEventListener('click', () => onStock());
    // めくり札（上1枚）
    const wasteEl = elem('div', 'so-slot');
    wasteEl.style.width = `${cw}px`;
    wasteEl.style.height = `${ch}px`;
    const wtop = s.waste[s.waste.length - 1];
    if (wtop) {
      paintFace(wasteEl, wtop);
      wasteEl.addEventListener('click', () => tapCard('waste', -1, -1));
    } else {
      wasteEl.classList.add('so-empty');
    }
    const spacer = elem('div', 'so-spacer');
    top.append(stockEl, wasteEl, spacer);
    // 組札4つ
    for (let f = 0; f < 4; f++) {
      const fe = elem('div', 'so-slot so-found');
      fe.style.width = `${cw}px`;
      fe.style.height = `${ch}px`;
      const ft = s.foundations[f]![s.foundations[f]!.length - 1];
      if (ft) paintFace(fe, ft);
      else fe.textContent = SUIT_CHARS[f] ?? '';
      top.append(fe);
    }

    // 場札7列
    const board = elem('div', 'so-board');
    const availH = H - ch - 24; // top 行ぶんを引く
    for (let col = 0; col < 7; col++) {
      const colEl = elem('div', 'so-col');
      colEl.style.width = `${cw}px`;
      const pile = s.tableau[col]!;
      const n = pile.length;
      // 重なり量（列が高くなりすぎないよう圧縮）
      const upStep = Math.round(ch * 0.34);
      const downStep = Math.round(ch * 0.16);
      let offs: number[] = [];
      let y = 0;
      for (let i = 0; i < n; i++) {
        offs.push(y);
        y += pile[i]!.up ? upStep : downStep;
      }
      const totalH = y + ch;
      if (totalH > availH && n > 1) {
        const scale = (availH - ch) / (y || 1);
        offs = offs.map((o) => Math.round(o * scale));
      }
      if (n === 0) {
        const empty = elem('div', 'so-slot so-empty');
        empty.style.width = `${cw}px`;
        empty.style.height = `${ch}px`;
        empty.addEventListener('click', () => tapCard('tableau', col, 0)); // 空列（Kのみ受け入れ、findAutoMoveでは移動元にならない）
        colEl.append(empty);
      }
      for (let i = 0; i < n; i++) {
        const card = pile[i]!;
        const ce = elem('div', 'so-card');
        ce.style.width = `${cw}px`;
        ce.style.height = `${ch}px`;
        ce.style.top = `${offs[i]}px`;
        if (card.up) {
          paintFace(ce, card);
          const idx = i;
          ce.addEventListener('click', () => tapCard('tableau', col, idx));
        } else {
          ce.classList.add('so-back');
        }
        colEl.append(ce);
      }
      colEl.style.height = `${(offs[n - 1] ?? 0) + ch}px`;
      board.append(colEl);
    }

    // 下部バー
    const bar = elem('div', 'so-bar');
    bar.append(elem('span', 'so-score', `${scoreNow()}てん`));
    const finishBtn = elem('button', 'so-btn', mode === 'won' ? 'クリア！' : 'ここでおわる') as HTMLButtonElement;
    finishBtn.addEventListener('click', () => finish());
    bar.append(finishBtn);

    wrap.replaceChildren(top, board, bar);

    if (mode === 'won') {
      const ov = elem('div', 'so-win');
      ov.append(elem('div', 'so-win-title', '🎉 クリア！ 🎉'), elem('div', 'so-win-sub', `${winScore()}てん`));
      wrap.append(ov);
    }
  }

  function paintFace(el: HTMLElement, card: Card): void {
    el.classList.add('so-up', isRed(card) ? 'so-red' : 'so-black');
    el.innerHTML = '';
    el.append(elem('span', 'so-rk', RANK_CHARS[card.rank] ?? '?'), elem('span', 'so-st', SUIT_CHARS[card.suit] ?? '?'));
  }

  // ---- 毎フレーム（勝利演出→結果画面。ctx.now 期限）----
  const offFrame = ctx.onFrame(() => {
    if (hostPaused) return;
    if (mode === 'won' && !ended && ctx.now() >= winAt + END_DELAY) finish();
  });

  return {
    start() {
      startAt = ctx.now();
      render();
      setData();
    },
    pause() {
      hostPaused = true;
    },
    resume() {
      hostPaused = false;
    },
    resize() {
      render();
    },
    destroy() {
      offFrame();
      style.remove();
      wrap.remove();
    },
  };
}

const CSS = `
.so-wrap{position:absolute;inset:0;display:flex;flex-direction:column;padding:8px 6px 6px;box-sizing:border-box;
  overflow:hidden;user-select:none;-webkit-user-select:none;background:#0e6b3d}
.so-top{display:flex;gap:6px;align-items:flex-start;flex:0 0 auto}
.so-spacer{flex:1}
.so-slot{border-radius:6px;box-sizing:border-box;display:flex;align-items:center;justify-content:center;
  font-size:20px;color:rgba(255,255,255,.5)}
.so-empty{border:2px dashed rgba(255,255,255,.35);background:rgba(0,0,0,.12)}
.so-found{border:2px solid rgba(255,255,255,.4);background:rgba(0,0,0,.12)}
.so-back{background:linear-gradient(135deg,#2a5cd0,#1b3a8c);border:2px solid #cdd8ff;border-radius:6px;box-sizing:border-box}
.so-board{flex:1 1 auto;display:flex;gap:6px;justify-content:center;align-items:flex-start;padding-top:8px;position:relative;overflow:hidden}
.so-col{position:relative;flex:0 0 auto}
.so-card{position:absolute;left:0;border-radius:6px;box-sizing:border-box;background:#fff;border:1px solid #b9c0d0;
  display:flex;flex-direction:column;align-items:flex-start;justify-content:flex-start;padding:2px 3px;line-height:1;
  box-shadow:0 1px 2px rgba(0,0,0,.25)}
.so-card.so-back{background:linear-gradient(135deg,#2a5cd0,#1b3a8c);border:1px solid #cdd8ff}
.so-up{background:#fff}
.so-red{color:#d3213a}
.so-black{color:#1a1a1a}
.so-rk{font-weight:800;font-size:15px}
.so-st{font-size:14px}
.so-bar{flex:0 0 auto;display:flex;align-items:center;justify-content:space-between;padding:6px 8px 2px;gap:10px}
.so-score{color:#fff;font-weight:800;font-size:17px}
.so-btn{appearance:none;border:none;border-radius:12px;min-height:44px;padding:8px 18px;font-size:15px;font-weight:800;
  background:var(--accent-grad,#7c6cf0);color:#fff}
.so-win{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;
  background:rgba(6,40,24,.78);pointer-events:none}
.so-win-title{font-size:34px;font-weight:800;color:#ffe08a}
.so-win-sub{font-size:22px;font-weight:800;color:#fff}
`;
