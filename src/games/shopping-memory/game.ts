// =============================================================
// おつかいメモリー（No.48）: おつかいリストをおぼえて、棚から同じ品をえらぼう！
// =============================================================
// - リスト（3→6品）が数秒表示→消える→棚（12マス）からリストの品だけをタップ。
//   ちがう品をとると ミス（へらないけど ボーナスがなくなる）。全5ラウンド。
// - 「おぼえた！」で表示を早めに切り上げてもOK（まちじかん短縮）。
// - 出題は logic.ts（rng注入・消費23回固定＝日替わり同一）。
// - DOMゲーム（onMove非購読=ネイティブclick）。startMode:'immediate'。
// - import してよいのは game-api（types / helpers）と、このフォルダ内（logic）だけ
import type { GameContext, IGame } from '../../game-api/types';
import { elem } from '../../game-api/helpers';
import { POOL, ROUNDS, rollRound, roundScore, showMsAt, type RoundDef } from './logic';

type Phase = 'list' | 'shop' | 'clearwait' | 'over';

const NEXT_MS = 1400;
const END_DELAY = 1900;
const SPEEDY_SEC = 8;

export function createGame(ctx: GameContext): IGame {
  // ---- 状態 ----
  let phase: Phase = 'list';
  let hostPaused = false;
  let round = 0;
  let def: RoundDef = { list: [], shelf: [] };
  let found: boolean[] = [];
  let foundCount = 0;
  let roundMisses = 0;
  let missesTotal = 0;
  let score = 0;
  let hideAt = 0;
  let shopStart = 0;
  let nextAt = 0;
  let endAt = 0;
  let ended = false;

  // ---- DOM ----
  const style = document.createElement('style');
  style.textContent = CSS;
  const wrap = elem('div', 'sm-wrap');
  ctx.root.append(style, wrap);

  let hudRoundEl: HTMLElement | null = null;
  let hudBasketEl: HTMLElement | null = null;
  let hudScoreEl: HTMLElement | null = null;
  let stageEl: HTMLElement | null = null;
  let msgEl: HTMLElement | null = null;

  function devState(): void {
    if (!import.meta.env.DEV) return;
    const ds = wrap.dataset;
    ds.st = phase;
    ds.round = String(round);
    ds.score = String(score);
    ds.found = String(foundCount);
    ds.miss = String(roundMisses);
    ds.list = JSON.stringify(def.list);
    ds.shelf = JSON.stringify(def.shelf);
  }

  function buildUi(): void {
    const hud = elem('div', 'sm-hud');
    hudRoundEl = elem('span', 'sm-hud-item', '');
    hudBasketEl = elem('span', 'sm-hud-item', '');
    hudScoreEl = elem('span', 'sm-hud-item', '');
    hud.append(hudRoundEl, hudBasketEl, hudScoreEl);
    stageEl = elem('div', 'sm-stage');
    msgEl = elem('div', 'sm-msg', '');
    wrap.append(hud, stageEl, msgEl);
  }

  function paintHud(): void {
    if (hudRoundEl) hudRoundEl.textContent = `おつかい ${Math.min(round + 1, ROUNDS)}/${ROUNDS}`;
    if (hudBasketEl) hudBasketEl.textContent = `かご ${foundCount}/${def.list.length}`;
    if (hudScoreEl) hudScoreEl.textContent = `スコア ${score}`;
  }

  // ---- ラウンド ----
  function startRound(): void {
    def = rollRound(ctx.random, round);
    found = new Array(def.list.length).fill(false);
    foundCount = 0;
    roundMisses = 0;
    phase = 'list';
    hideAt = ctx.now() + showMsAt(round);
    showList();
    paintHud();
    devState();
  }

  function showList(): void {
    if (!stageEl) return;
    const card = elem('div', 'sm-card');
    card.append(elem('h2', 'sm-card-title', '📝 おつかいリスト'));
    for (const idx of def.list) {
      const it = POOL[idx]!;
      const row = elem('div', 'sm-item');
      row.append(elem('span', 'sm-item-emoji', it.emoji), elem('span', 'sm-item-name', it.name));
      card.append(row);
    }
    const ok = elem('button', 'sm-btn', 'おぼえた！ ▶') as HTMLButtonElement;
    ok.addEventListener('click', () => {
      if (phase === 'list' && !hostPaused) openShop();
    });
    card.append(ok);
    stageEl.replaceChildren(card);
    if (msgEl) {
      msgEl.className = 'sm-msg';
      msgEl.textContent = '👀 なにを たのまれたか おぼえてね';
    }
  }

  function openShop(): void {
    phase = 'shop';
    shopStart = ctx.now();
    if (!stageEl) return;
    const shelf = elem('div', 'sm-shelf');
    for (const idx of def.shelf) {
      const it = POOL[idx]!;
      const b = elem('button', 'sm-good') as HTMLButtonElement;
      b.append(elem('span', 'sm-good-emoji', it.emoji), elem('span', 'sm-good-name', it.name));
      b.addEventListener('click', () => onGood(idx, b));
      shelf.append(b);
    }
    stageEl.replaceChildren(shelf);
    if (msgEl) msgEl.textContent = '🛒 リストにあった品を ぜんぶ タップ！';
    ctx.sfx('start');
    devState();
  }

  function onGood(poolIdx: number, el: HTMLButtonElement): void {
    if (phase !== 'shop' || hostPaused || el.classList.contains('sm-got')) return;
    const li = def.list.indexOf(poolIdx);
    if (li >= 0 && !found[li]) {
      found[li] = true;
      foundCount++;
      el.classList.add('sm-got');
      ctx.sfx('tap');
      ctx.haptic('light');
      paintHud();
      if (foundCount >= def.list.length) roundClear();
    } else {
      roundMisses++;
      missesTotal++;
      el.classList.remove('sm-bad');
      void el.offsetWidth;
      el.classList.add('sm-bad');
      ctx.sfx('tick');
      if (msgEl) msgEl.textContent = 'それは たのまれてないかも…？';
    }
    devState();
  }

  function roundClear(): void {
    const now = ctx.now();
    const sec = Math.floor((now - shopStart) / 1000);
    const s = roundScore(def.list.length, sec, roundMisses);
    score += s;
    phase = 'clearwait';
    nextAt = now + NEXT_MS;
    // 実績（クリア時に即解除）
    ctx.achieve('first-round');
    if (roundMisses === 0) ctx.achieve('no-miss-round');
    if (def.list.length >= 6) ctx.achieve('list-6');
    if (sec <= SPEEDY_SEC) ctx.achieve('speedy-round');
    if (msgEl) {
      msgEl.className = 'sm-msg sm-msg-win';
      msgEl.textContent = `おつかい かんりょう！ +${s}てん 🎉`;
    }
    ctx.sfx('success');
    ctx.haptic('success');
    if (round >= ROUNDS - 1) {
      ctx.achieve('all-rounds');
      if (missesTotal === 0) ctx.achieve('no-miss-all');
      phase = 'over';
      endAt = now + END_DELAY;
      ctx.sfx('medal');
      if (msgEl) msgEl.textContent = `🏆 ぜんぶのおつかい かんりょう！ ${score}てん`;
    }
    paintHud();
    devState();
  }

  // ---- 毎フレーム（期限方式）----
  const offFrame = ctx.onFrame(() => {
    const now = ctx.now();
    if (phase === 'list' && now >= hideAt) openShop();
    if (phase === 'clearwait' && now >= nextAt) {
      round++;
      startRound();
      return;
    }
    if (phase === 'over' && !ended && now >= endAt) {
      ended = true;
      ctx.end({ score });
    }
  });

  // ---- 起動（startMode:'immediate'＝すぐリスト表示）----
  buildUi();
  startRound();

  return {
    start() {
      // カウントダウンなし。おつかい1のリストから始まる
    },
    pause() {
      hostPaused = true;
    },
    resume() {
      hostPaused = false;
    },
    resize() {
      // DOMフレックス配置のため何もしない
    },
    destroy() {
      offFrame();
      style.remove();
      wrap.remove();
    },
  };
}

// =============================================================
// スタイル（.sm- プレフィックス。テーマ変数でライト/ダーク両対応）
// =============================================================
const CSS = `
.sm-wrap{position:absolute;inset:0;overflow:hidden;display:flex;flex-direction:column;align-items:center;
  user-select:none;-webkit-user-select:none}
.sm-hud{display:flex;justify-content:center;align-items:center;gap:14px;padding:8px 64px 4px;flex-wrap:wrap;min-height:54px}
.sm-hud-item{font-size:14px;font-weight:800;white-space:nowrap;font-variant-numeric:tabular-nums}
.sm-stage{flex:1 1 auto;min-height:0;width:100%;display:flex;align-items:center;justify-content:center;padding:0 10px;box-sizing:border-box}

/* リストカード */
.sm-card{width:min(86vw,340px);background:var(--bg-elev);border-radius:16px;padding:14px 18px;display:flex;
  flex-direction:column;gap:8px;max-height:100%;overflow-y:auto}
.sm-card-title{margin:0 0 2px;font-size:18px;text-align:center}
.sm-item{display:flex;align-items:center;gap:12px;background:var(--bg-elev2);border-radius:10px;padding:6px 12px}
.sm-item-emoji{font-size:26px}
.sm-item-name{font-size:16px;font-weight:800}
.sm-btn{appearance:none;border:none;border-radius:12px;padding:12px 18px;font-size:16px;font-weight:800;font-family:inherit;
  background:var(--accent-grad);color:#fff;min-height:44px;margin-top:6px}

/* 棚 */
.sm-shelf{width:min(94vw,420px);display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
.sm-good{border:none;margin:0;border-radius:12px;font-family:inherit;background:var(--bg-elev2);color:var(--text);
  display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;padding:8px 2px;min-height:72px}
.sm-good-emoji{font-size:30px;line-height:1}
.sm-good-name{font-size:11px;font-weight:800;color:var(--text-dim)}
.sm-good.sm-got{background:rgba(62,211,106,.25);box-shadow:inset 0 0 0 2px #2fae5e}
.sm-good.sm-got .sm-good-name{color:#2fae5e}
@keyframes sm-shake{0%,100%{transform:translateX(0)}25%{transform:translateX(-4px)}75%{transform:translateX(4px)}}
.sm-good.sm-bad{animation:sm-shake .25s}
.sm-good:active{transform:scale(.96)}
.sm-msg{min-height:24px;font-size:14px;font-weight:900;color:var(--text-dim);text-align:center;margin:8px 0 12px;padding:0 10px}
.sm-msg-win{color:#2fae5e}
`;
