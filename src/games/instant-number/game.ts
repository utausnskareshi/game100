// =============================================================
// いっしゅんナンバー（No.43）: 一瞬だけ見える数字の場所をおぼえて、1から順にタップ！
// =============================================================
// - 数字が表示されて一瞬でかくれる（またはがまんできずに「1」を早おししてもよい＝
//   「1」をおした瞬間にかくれて勝負開始）。かくれたら記憶だけで 1→N の順にタップ。
// - おてつき（順番ちがい）でラウンド失敗＝ライフ−1（2回で終了）。全10ラウンド。
// - ラウンド仕様・配置は logic.ts（rng注入・配置ループは打ち切りcapつき）。
// - DOMゲーム（onMove非購読＝ネイティブclickがそのまま効く）。startMode:'immediate'。
// - import してよいのは game-api（types / helpers）と、このフォルダ内（logic）だけ
import type { GameContext, IGame } from '../../game-api/types';
import { elem } from '../../game-api/helpers';
import { CELL_R, LIVES, ROUNDS, countAt, exposureAt, layoutRound, roundScore, type Cell } from './logic';

type Phase = 'memo' | 'recall' | 'reveal' | 'clearwait' | 'over';

const REVEAL_MS = 950; // おてつき時に答えを見せる時間
const NEXT_MS = 1250; // クリア演出→次ラウンド
const END_DELAY = 1900;
const SPEEDY_MS = 2000; // 「いっしゅんの達人」実績

export function createGame(ctx: GameContext): IGame {
  // ---- 状態 ----
  let phase: Phase = 'memo';
  let hostPaused = false;
  let round = 0;
  let cells: Cell[] = [];
  let tapped: boolean[] = [];
  let nextNum = 1;
  let lives = LIVES;
  let missCount = 0;
  let score = 0;
  let hideAt = 0; // 自動でかくれる時刻
  let recallStart = 0; // かくれた瞬間（スピード計測の起点）
  let revealUntil = 0;
  let nextAt = 0;
  let endAt = 0;
  let ended = false;
  let overReason: 'lives' | 'done' = 'done';

  // ---- DOM ----
  const style = document.createElement('style');
  style.textContent = CSS;
  const wrap = elem('div', 'in-wrap');
  ctx.root.append(style, wrap);

  let hudRoundEl: HTMLElement | null = null;
  let hudLivesEl: HTMLElement | null = null;
  let hudScoreEl: HTMLElement | null = null;
  let msgEl: HTMLElement | null = null;
  let fieldEl: HTMLElement | null = null;
  let cellEls: HTMLButtonElement[] = [];

  function devState(): void {
    if (!import.meta.env.DEV) return;
    const ds = wrap.dataset;
    ds.st = phase;
    ds.round = String(round);
    ds.lives = String(lives);
    ds.score = String(score);
    ds.next = String(nextNum);
    ds.layout = JSON.stringify(cells.map((c) => [Math.round(c.x), Math.round(c.y), c.num]));
  }

  function buildUi(): void {
    const hud = elem('div', 'in-hud');
    hudRoundEl = elem('span', 'in-hud-item', `ラウンド 1/${ROUNDS}`);
    hudLivesEl = elem('span', 'in-hud-item', '');
    hudScoreEl = elem('span', 'in-hud-item', 'スコア 0');
    hud.append(hudRoundEl, hudLivesEl, hudScoreEl);
    msgEl = elem('div', 'in-msg', '');
    fieldEl = elem('div', 'in-field');
    wrap.append(hud, msgEl, fieldEl);
    paintHud();
  }

  function paintHud(): void {
    if (hudRoundEl) hudRoundEl.textContent = `ラウンド ${Math.min(round + 1, ROUNDS)}/${ROUNDS}`;
    if (hudLivesEl) {
      let h = '';
      for (let i = 0; i < LIVES; i++) h += i < lives ? '❤️' : '🤍';
      hudLivesEl.textContent = h;
    }
    if (hudScoreEl) hudScoreEl.textContent = `スコア ${score}`;
  }

  // ---- ラウンド ----
  function startRound(): void {
    cells = layoutRound(ctx.random, countAt(round));
    tapped = new Array(cells.length).fill(false);
    nextNum = 1;
    phase = 'memo';
    hideAt = ctx.now() + exposureAt(round);
    if (!fieldEl) return;
    fieldEl.replaceChildren();
    cellEls = [];
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i]!;
      const b = elem('button', 'in-cell', String(c.num)) as HTMLButtonElement;
      b.style.left = `${c.x - CELL_R}px`;
      b.style.top = `${c.y - CELL_R}px`;
      b.addEventListener('click', () => onCell(i));
      cellEls.push(b);
      fieldEl.append(b);
    }
    if (msgEl) {
      msgEl.className = 'in-msg';
      msgEl.textContent = '👀 おぼえて！（「1」を早おししてもOK）';
    }
    paintHud();
    devState();
  }

  function hideNumbers(now: number): void {
    phase = 'recall';
    recallStart = now;
    for (let i = 0; i < cellEls.length; i++) {
      if (!tapped[i]) {
        cellEls[i]!.textContent = '?';
        cellEls[i]!.classList.add('in-hidden');
      }
    }
    if (msgEl) msgEl.textContent = '🫵 1から じゅんばんに タップ！';
    ctx.sfx('tick');
    devState();
  }

  function onCell(i: number): void {
    if (hostPaused) return;
    const c = cells[i]!;
    if (phase === 'memo') {
      // 「1」の早おし＝その瞬間にかくして勝負開始（1はおしたことになる）
      if (c.num === 1) {
        hideNumbers(ctx.now());
        markCorrect(i);
      }
      return;
    }
    if (phase !== 'recall' || tapped[i]) return;
    if (c.num === nextNum) {
      markCorrect(i);
    } else {
      fail(i);
    }
  }

  function markCorrect(i: number): void {
    tapped[i] = true;
    const el = cellEls[i]!;
    el.textContent = String(cells[i]!.num);
    el.className = 'in-cell in-ok';
    nextNum++;
    ctx.sfx('tap');
    if (nextNum > cells.length) {
      roundClear();
    }
    devState();
  }

  function roundClear(): void {
    const now = ctx.now();
    const msTaken = Math.max(0, now - recallStart);
    const s = roundScore(cells.length, msTaken);
    score += s;
    phase = 'clearwait';
    nextAt = now + NEXT_MS;
    // 実績（クリア・加算箇所で即解除）
    ctx.achieve('first-clear');
    if (cells.length >= 7) ctx.achieve('clear-7');
    if (cells.length >= 9) ctx.achieve('clear-9');
    if (msTaken <= SPEEDY_MS) ctx.achieve('speed-2s');
    if (score >= 1000) ctx.achieve('total-1000');
    if (msgEl) {
      msgEl.className = 'in-msg in-msg-win';
      msgEl.textContent = `せいかい！ +${s}てん 🎉`;
    }
    ctx.sfx('success');
    ctx.haptic('light');
    if (round >= ROUNDS - 1) {
      if (missCount === 0) ctx.achieve('no-miss-all');
      overReason = 'done';
      phase = 'over';
      endAt = now + END_DELAY;
      ctx.sfx('medal');
      showOverMsg();
    }
    paintHud();
    devState();
  }

  function showOverMsg(): void {
    if (!msgEl) return;
    if (overReason === 'done') {
      msgEl.className = 'in-msg in-msg-win';
      msgEl.textContent = `🏆 10ラウンド完走！ ごうけい ${score}てん`;
    } else {
      msgEl.className = 'in-msg in-msg-bad';
      msgEl.textContent = `おしまい… ごうけい ${score}てん`;
    }
  }

  function fail(wrongIdx: number): void {
    const now = ctx.now();
    missCount++;
    lives--;
    phase = 'reveal';
    revealUntil = now + REVEAL_MS;
    // ぜんぶ見せる（おてつきは赤）
    for (let i = 0; i < cellEls.length; i++) {
      const el = cellEls[i]!;
      el.textContent = String(cells[i]!.num);
      el.classList.remove('in-hidden');
      if (i === wrongIdx) el.classList.add('in-bad');
    }
    if (msgEl) {
      msgEl.className = 'in-msg in-msg-bad';
      msgEl.textContent = 'おてつき…！';
    }
    ctx.sfx('fail');
    ctx.haptic('error');
    if (lives <= 0) {
      overReason = 'lives';
      phase = 'over';
      endAt = now + REVEAL_MS + END_DELAY;
      showOverMsg();
    }
    paintHud();
    devState();
  }

  // ---- 毎フレーム（期限方式）----
  const offFrame = ctx.onFrame(() => {
    const now = ctx.now();
    if (phase === 'memo' && now >= hideAt) hideNumbers(now);
    if (phase === 'reveal' && now >= revealUntil) {
      if (round >= ROUNDS - 1) {
        // 最終ラウンドをおてつきで終えた（ライフ残あり）→ ここで10ラウンド終了
        overReason = 'done';
        phase = 'over';
        endAt = now + END_DELAY;
        showOverMsg();
        devState();
      } else {
        round++;
        startRound();
      }
      return;
    }
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

  // ---- 起動（startMode:'immediate'＝すぐラウンド1）----
  buildUi();
  startRound();

  return {
    start() {
      // カウントダウンなし。ラウンド1の「おぼえて！」から始まる
    },
    pause() {
      hostPaused = true;
    },
    resume() {
      hostPaused = false;
    },
    resize() {
      // 盤は design 座標の絶対配置（in-field が縮む端末でもそのまま。360px 設計）
    },
    destroy() {
      offFrame();
      style.remove();
      wrap.remove();
    },
  };
}

// =============================================================
// スタイル（.in- プレフィックス。テーマ変数でライト/ダーク両対応）
// =============================================================
const CSS = `
.in-wrap{position:absolute;inset:0;overflow:hidden;user-select:none;-webkit-user-select:none}
.in-hud{display:flex;justify-content:center;align-items:center;gap:14px;padding:8px 64px 4px;flex-wrap:wrap;min-height:54px}
.in-hud-item{font-size:14px;font-weight:800;white-space:nowrap;font-variant-numeric:tabular-nums}
.in-msg{min-height:24px;font-size:15px;font-weight:900;color:var(--text-dim);text-align:center;margin:2px 0 0}
.in-msg-win{color:#2fae5e}
.in-msg-bad{color:#e0524a}
/* 盤面は design 360px 幅の帯を中央寄せ（広い端末でも中央に来る） */
.in-field{position:absolute;left:50%;top:0;bottom:0;width:360px;transform:translateX(-50%);pointer-events:none}
.in-cell{position:absolute;width:62px;height:62px;border-radius:50%;border:none;margin:0;padding:0;
  font-family:inherit;font-size:26px;font-weight:900;line-height:1;pointer-events:auto;
  background:var(--accent);color:#fff;box-shadow:0 3px 8px rgba(0,0,0,.28)}
.in-cell.in-hidden{background:var(--bg-elev2);color:var(--text-dim);font-size:22px}
.in-cell.in-ok{background:#2fae5e;color:#fff}
.in-cell.in-bad{background:#e0524a;color:#fff;animation:in-shake .3s}
.in-cell:active{transform:scale(.94)}
@keyframes in-shake{0%,100%{transform:translateX(0)}25%{transform:translateX(-4px)}75%{transform:translateX(4px)}}
`;
