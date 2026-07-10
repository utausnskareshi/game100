// =============================================================
// ポーカー（No.12）: ドローポーカー。5枚配られ→のこす札をえらび→引き直し→役で得点
// =============================================================
// - 賭けなし。5ラウンドの合計スコアをきそう（役が高いほど高得点）
// - シャッフルは ctx.random＝日替わりは全員同じ配札。時間は ctx.now・setTimeout 不使用
// - import してよいのは game-api（types / helpers）と、このフォルダ内（engine）だけ
import type { GameContext, IGame } from '../../game-api/types';
import { elem } from '../../game-api/helpers';
import { makeDeck, shuffle, evaluate, SUITS, type Card } from './engine';

const ROUNDS = 5;
// 役ごとの得点（CAT_NAMES と同じ並び・playtest調整前提の仮値）
const CAT_POINTS = [0, 10, 25, 45, 70, 100, 150, 250, 600, 1000];

type Phase = 'choose' | 'result' | 'over';

const rankChar = (r: number): string => (r === 14 ? 'A' : r === 13 ? 'K' : r === 12 ? 'Q' : r === 11 ? 'J' : String(r));

export function createGame(ctx: GameContext): IGame {
  let deck: Card[] = [];
  let pos = 0;
  let round = 1;
  let total = 0;
  let phase: Phase = 'choose';
  let hand: Card[] = [];
  let held: boolean[] = [false, false, false, false, false];
  let bestCat = 0;
  let gotRole = false;
  let hostPaused = false;
  let lastResultName = '';
  let lastResultPts = 0;

  const style = document.createElement('style');
  style.textContent = CSS;
  const wrap = elem('div', 'pk-wrap');
  ctx.root.append(style, wrap);

  let roundEl: HTMLElement | null = null;
  let scoreEl: HTMLElement | null = null;
  let handEl: HTMLElement | null = null;
  let msgEl: HTMLElement | null = null;
  let actionBtn: HTMLButtonElement | null = null;
  let cardEls: HTMLButtonElement[] = [];

  function build(): void {
    const play = elem('div', 'pk-play');
    const hud = elem('div', 'pk-hud');
    roundEl = elem('span', 'pk-hud-item', '');
    scoreEl = elem('span', 'pk-hud-item', '');
    hud.append(roundEl, scoreEl);

    handEl = elem('div', 'pk-hand');
    cardEls = [];
    for (let i = 0; i < 5; i++) {
      const idx = i;
      const c = elem('button', 'pk-card') as HTMLButtonElement;
      c.addEventListener('click', () => toggleHold(idx));
      cardEls.push(c);
      handEl.append(c);
    }

    msgEl = elem('div', 'pk-msg', '');
    actionBtn = elem('button', 'pk-btn pk-btn-primary', '') as HTMLButtonElement;
    actionBtn.addEventListener('click', () => onAction());

    play.append(hud, handEl, msgEl, actionBtn);
    wrap.replaceChildren(play);
  }

  function startGame(): void {
    deck = makeDeck();
    shuffle(deck, ctx.random);
    pos = 0;
    round = 1;
    total = 0;
    bestCat = 0;
    gotRole = false;
    build();
    deal();
  }

  function deal(): void {
    hand = [deck[pos++]!, deck[pos++]!, deck[pos++]!, deck[pos++]!, deck[pos++]!];
    held = [false, false, false, false, false];
    phase = 'choose';
    ctx.sfx('tick');
    paint();
  }

  function toggleHold(i: number): void {
    if (phase !== 'choose' || hostPaused) return;
    held[i] = !held[i];
    ctx.sfx('tap');
    paint();
  }

  function onAction(): void {
    if (hostPaused) return;
    if (phase === 'choose') draw();
    else if (phase === 'result') {
      if (round >= ROUNDS) finish();
      else {
        round++;
        deal();
      }
    }
  }

  function draw(): void {
    for (let i = 0; i < 5; i++) {
      if (!held[i]) hand[i] = deck[pos++]!;
    }
    const res = evaluate(hand);
    const pts = CAT_POINTS[res.cat] ?? 0;
    total += pts;
    if (total >= 250) ctx.achieve('high-total'); // 到達した瞬間に解除（5R完走前に中断しても取りこぼさない）
    phase = 'result';

    if (res.cat >= 1 && !gotRole) {
      gotRole = true;
      ctx.achieve('first-role');
    }
    if (res.cat === 5) ctx.achieve('flush-made');
    if (res.cat === 6) ctx.achieve('full-made');
    if (res.cat === 7) ctx.achieve('four-made');
    if (res.cat >= 8) ctx.achieve('super');
    if (res.cat > bestCat) bestCat = res.cat;

    ctx.sfx(res.cat >= 5 ? 'medal' : res.cat >= 1 ? 'success' : 'fail');
    if (res.cat >= 1) ctx.haptic('success');
    lastResultName = res.name;
    lastResultPts = pts;
    paint();
  }

  function finish(): void {
    phase = 'over';
    // high-total は draw() の加算直後に live 判定済み（total はそこでしか増えない）
    ctx.end({ score: total });
  }

  function paint(): void {
    if (roundEl) roundEl.textContent = `ラウンド ${Math.min(round, ROUNDS)} / ${ROUNDS}`;
    if (scoreEl) scoreEl.textContent = `スコア ${total}`;
    for (let i = 0; i < 5; i++) {
      const el = cardEls[i];
      const card = hand[i];
      if (!el || !card) continue;
      const red = card.suit === 1 || card.suit === 2;
      el.className = 'pk-card' + (red ? ' pk-red' : '') + (held[i] ? ' pk-held' : '');
      el.replaceChildren(
        elem('span', 'pk-rank', rankChar(card.rank)),
        elem('span', 'pk-suit', SUITS[card.suit] ?? '?'),
        elem('span', 'pk-keep', held[i] ? 'キープ' : ''),
      );
      el.disabled = phase !== 'choose';
    }
    if (msgEl) {
      msgEl.textContent =
        phase === 'choose'
          ? 'のこす カードをタップ → 「ひく」'
          : `${lastResultName}　＋${lastResultPts}点`;
      msgEl.classList.toggle('pk-win', phase === 'result' && lastResultPts > 0);
    }
    if (actionBtn) {
      actionBtn.textContent = phase === 'choose' ? 'ひく ▶' : round >= ROUNDS ? 'けっかへ ▶' : 'つぎへ ▶';
    }
  }

  // 起動（immediate＝設定画面なし。あそぶ→即プレイ）。時間経過の処理はなく全てタップ駆動
  build();

  return {
    start() {
      startGame();
    },
    pause() {
      hostPaused = true;
    },
    resume() {
      hostPaused = false;
    },
    resize() {
      /* Flexレイアウトのみ */
    },
    destroy() {
      style.remove();
      wrap.remove();
    },
  };
}

const CSS = `
.pk-wrap{position:absolute;inset:0;overflow:hidden}
.pk-play{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:safe center;
  gap:18px;padding:16px 12px;box-sizing:border-box;overflow-y:auto;user-select:none;-webkit-user-select:none}
.pk-hud{display:flex;gap:20px;align-items:center;min-height:44px;padding:0 64px}
.pk-hud-item{font-size:16px;font-weight:800;white-space:nowrap}
.pk-hand{display:flex;gap:6px;justify-content:center;flex-wrap:nowrap}
.pk-card{position:relative;appearance:none;border:2px solid #cbd2e0;border-radius:10px;background:#fff;color:#1a1f2e;
  width:60px;height:88px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;
  font-family:inherit;box-shadow:0 3px 8px rgba(0,0,0,.22);padding:0}
.pk-card.pk-red{color:#d3213a}
.pk-rank{font-size:24px;font-weight:900;line-height:1}
.pk-suit{font-size:26px;line-height:1}
.pk-keep{position:absolute;top:-11px;left:50%;transform:translateX(-50%);font-size:11px;font-weight:800;color:#fff;
  background:var(--accent);border-radius:999px;padding:2px 8px;white-space:nowrap;min-height:0}
.pk-keep:empty{display:none}
.pk-card.pk-held{border-color:var(--accent);transform:translateY(-8px);box-shadow:0 8px 14px rgba(0,0,0,.3)}
.pk-msg{min-height:28px;font-size:17px;font-weight:800;text-align:center;color:var(--text)}
.pk-msg.pk-win{color:var(--accent-2);font-size:20px}
.pk-btn{appearance:none;border:none;border-radius:12px;padding:14px 22px;font-size:17px;font-weight:800;
  background:var(--bg-elev2);color:var(--text);min-height:48px;width:min(80vw,280px)}
.pk-btn-primary{background:var(--accent-grad);color:#fff}
`;
