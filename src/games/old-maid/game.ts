// =============================================================
// ババぬき（No.24）: あなた＋CPU2人の3人戦。最後にジョーカーを持っていたら負け（chill）
// =============================================================
// - となり（次のプレイヤー）の伏せ札から1枚引く→ペアは自動で捨てる→手札0で抜け。
// - あなたの手番は伏せ札をタップ。CPUの手番は ctx.now 期限＋ctx.random で自動。
// - 配札・引く位置は ctx.random＝「今日のゲーム」では全員同じ展開。
// - import してよいのは game-api（types / helpers）と、このフォルダ内（engine）だけ
import type { GameContext, IGame } from '../../game-api/types';
import { elem } from '../../game-api/helpers';
import { makeDeck53, shuffle, deal, stripPairs, pairIndex, sortHand, isJoker, SUITS, type Card } from './engine';

type Mode = 'play' | 'over';
const PLAYERS = 3; // 0=あなた / 1=CPUのアリス / 2=CPUのボブ
const NAMES = ['あなた', 'CPUのアリス', 'CPUのボブ'];
const REVEAL_MS = 700; // 1手ごとの「間」
const CPU_MIN = 700; // CPUが考えるふり(ms)
const CPU_JITTER = 500;
const END_DELAY = 2200;
const PLACE_PTS = [150, 70, 10]; // 1位/2位/3位
const QUICK_DRAWS = 6; // quick-top: この回数以内の自分の引きで1位

const rankChar = (r: number): string =>
  r === 1 ? 'A' : r === 11 ? 'J' : r === 12 ? 'Q' : r === 13 ? 'K' : String(r);

export function createGame(ctx: GameContext): IGame {
  // ---- 状態 ----
  let mode: Mode = 'play';
  let hostPaused = false;
  let hands: Card[][] = [[], [], []];
  let discardPairs = 0;
  let turn = 0; // いま引く人
  let awaiting: 'you' | 'cpu' = 'you';
  let cpuActAt = 0;
  let revealUntil = 0;
  let needsAdvance = false;
  const finished: boolean[] = [false, false, false];
  const places: number[] = []; // あがった順の player index
  let heldJokerEver = false;
  let myDraws = 0;
  let endAt = 0;
  let ended = false;
  let message = '';

  // ---- DOM ----
  const style = document.createElement('style');
  style.textContent = CSS;
  const wrap = elem('div', 'om-wrap');
  ctx.root.append(style, wrap);

  let cpuRows: HTMLElement[] = [];
  let msgEl: HTMLElement | null = null;
  let discardEl: HTMLElement | null = null;
  let takeRow: HTMLElement | null = null;
  let myRow: HTMLElement | null = null;

  const nextActive = (from: number): number => {
    for (let k = 1; k <= PLAYERS; k++) {
      const i = (from + k) % PLAYERS;
      if (!finished[i]) return i;
    }
    return from;
  };
  const activeCount = (): number => finished.filter((f) => !f).length;
  const jokerHolder = (): number => hands.findIndex((h) => h.some(isJoker));

  // ---- 開始 ----
  function startGame(): void {
    const deck = makeDeck53();
    shuffle(deck, ctx.random);
    const dealt = deal(deck, PLAYERS);
    let initialPairs = 0;
    hands = dealt.map((h) => {
      const r = stripPairs(h);
      initialPairs += r.removedPairs;
      return r.hand;
    });
    hands[0] = sortHand(hands[0]!);
    discardPairs = initialPairs;
    heldJokerEver = hands[0]!.some(isJoker);
    myDraws = 0;
    places.length = 0;
    finished.fill(false);
    mode = 'play';
    ended = false;
    message = `はじめのペアを ${initialPairs}くみ すてたよ`;
    // 配りたてで手札0の人がいたら先にあがり（まれ）
    for (let i = 0; i < PLAYERS; i++) if (hands[i]!.length === 0) finish(i);
    if (mode === 'play') {
      turn = finished[0] ? nextActive(0) : 0;
      beginTurn(ctx.now());
    }
    renderAll();
  }

  function beginTurn(now: number): void {
    if (turn === 0) {
      awaiting = 'you';
      message = `あなたの ばん！ ${NAMES[nextActive(0)]}の カードを 1まい えらんでね`;
    } else {
      awaiting = 'cpu';
      cpuActAt = now + CPU_MIN + ctx.random() * CPU_JITTER;
      message = `${NAMES[turn]}が えらんでいる…`;
    }
  }

  // ---- 1手（drawer が src の cardIdx を引く）----
  function doDraw(drawer: number, src: number, cardIdx: number, now: number): void {
    const srcHand = hands[src]!;
    const card = srcHand.splice(cardIdx, 1)[0];
    if (!card) return;
    if (isJoker(card) && src === 0) ctx.achieve('pass-joker'); // あなたからジョーカーが出ていった
    if (isJoker(card) && drawer === 0) heldJokerEver = true;

    const mate = pairIndex(hands[drawer]!, card);
    if (mate >= 0) {
      hands[drawer]!.splice(mate, 1);
      discardPairs++;
      message =
        drawer === 0
          ? `ペア！ ${rankChar(card.rank)}を 2まい すてた`
          : `${NAMES[drawer]}は ペアで すてた`;
      ctx.sfx('combo');
      if (drawer === 0) ctx.haptic('light');
    } else {
      hands[drawer]!.push(card);
      if (drawer === 0) hands[0] = sortHand(hands[0]!);
      message =
        drawer === 0
          ? isJoker(card)
            ? '…ジョーカーを ひいちゃった！'
            : `${rankChar(card.rank)}を ひいた（ペアなし）`
          : `${NAMES[drawer]}は 手札に くわえた`;
      ctx.sfx('tap');
    }
    if (drawer === 0) myDraws++;

    // あがり判定（引いた側→引かれた側の順）
    if (hands[drawer]!.length === 0) finish(drawer);
    if (hands[src]!.length === 0) finish(src);

    revealUntil = now + REVEAL_MS;
    needsAdvance = mode === 'play';
    renderAll();
  }

  function finish(p: number): void {
    if (finished[p]) return;
    finished[p] = true;
    places.push(p);
    if (p === 0) ctx.sfx('success');
    if (activeCount() === 1) {
      const last = hands.findIndex((_, i) => !finished[i]);
      finished[last] = true;
      places.push(last);
      gameOver(ctx.now());
    }
  }

  function gameOver(now: number): void {
    mode = 'over';
    const myPlace = places.indexOf(0) + 1; // 1..3
    if (myPlace === 1) {
      ctx.achieve('first-top');
      if (!heldJokerEver) ctx.achieve('no-joker');
      if (heldJokerEver) ctx.achieve('comeback');
      if (myDraws <= QUICK_DRAWS) ctx.achieve('quick-top');
      // 累計1位（インスタンス跨ぎ）
      const tops = (ctx.load<number>('tops') ?? 0) + 1;
      ctx.save('tops', tops);
      if (tops >= 3) ctx.achieve('top-3');
      ctx.sfx('medal');
      ctx.haptic('success');
    } else {
      ctx.sfx(myPlace === 2 ? 'success' : 'fail');
      if (myPlace === 3) ctx.haptic('error');
    }
    message =
      myPlace === 1 ? '🎉 1位で あがり！' : myPlace === 2 ? '2位で あがり！' : '…ジョーカーで まけ';
    endAt = now + END_DELAY;
    renderAll();
  }

  // ---- 入力（あなたの手番: 相手の伏せ札をタップ）----
  function onTake(cardIdx: number): void {
    if (mode !== 'play' || hostPaused || awaiting !== 'you' || turn !== 0) return;
    if (revealUntil > ctx.now()) return;
    const src = nextActive(0);
    if (cardIdx < 0 || cardIdx >= hands[src]!.length) return;
    doDraw(0, src, cardIdx, ctx.now());
  }

  // ---- 描画 ----
  function renderAll(): void {
    wrap.replaceChildren();
    const play = elem('div', 'om-play');

    // CPU 2人（上段）
    cpuRows = [];
    const cpus = elem('div', 'om-cpus');
    for (const i of [1, 2]) {
      const row = elem('div', 'om-cpu');
      const head = elem('div', 'om-cpu-head');
      head.append(
        elem('span', 'om-cpu-name', NAMES[i]),
        elem(
          'span',
          'om-cpu-state' + (finished[i] ? ' om-done' : ''),
          finished[i] ? `あがり！(${places.indexOf(i) + 1}位)` : `${hands[i]!.length}まい`,
        ),
      );
      const fan = elem('div', 'om-fan');
      const n = Math.min(hands[i]!.length, 18);
      for (let k = 0; k < n; k++) fan.append(elem('div', 'om-mini'));
      row.append(head, fan);
      cpuRows.push(row);
      cpus.append(row);
    }

    // 中央: メッセージ＋すて札
    msgEl = elem('div', 'om-msg', message);
    discardEl = elem('div', 'om-discard', `すてたペア: ${discardPairs}くみ`);

    // 引き取り列（あなたの手番のみ・次のプレイヤーの伏せ札）
    takeRow = elem('div', 'om-take-row');
    if (mode === 'play' && turn === 0 && !finished[0]) {
      const src = nextActive(0);
      const label = elem('div', 'om-take-label', `⬇ ${NAMES[src]}の カード`);
      const rowBtns = elem('div', 'om-take');
      hands[src]!.forEach((_, idx) => {
        const b = elem('button', 'om-card om-back') as HTMLButtonElement;
        b.addEventListener('click', () => onTake(idx));
        rowBtns.append(b);
      });
      takeRow.append(label, rowBtns);
    }

    // あなたの手札（下段・表向き）
    const myWrap = elem('div', 'om-my-wrap');
    myWrap.append(
      elem(
        'div',
        'om-my-label',
        finished[0] ? `あなた: あがり！(${places.indexOf(0) + 1}位)` : `あなたの手札（${hands[0]!.length}まい）`,
      ),
    );
    myRow = elem('div', 'om-my');
    for (const c of hands[0]!) {
      const el = elem('div', 'om-card' + (isJoker(c) ? ' om-joker' : (c.suit === 1 || c.suit === 2) ? ' om-red' : ''));
      if (isJoker(c)) {
        el.append(elem('span', 'om-rank', '🤡'), elem('span', 'om-suit', 'JOKER'));
      } else {
        el.append(elem('span', 'om-rank', rankChar(c.rank)), elem('span', 'om-suit', SUITS[c.suit] ?? ''));
      }
      myRow.append(el);
    }
    myWrap.append(myRow);

    play.append(cpus, msgEl, discardEl, takeRow, myWrap);
    wrap.append(play);

    if (import.meta.env.DEV) {
      wrap.dataset.st = mode;
      wrap.dataset.turn = String(turn);
      wrap.dataset.myn = String(hands[0]!.length);
      wrap.dataset.an = String(hands[1]!.length);
      wrap.dataset.bn = String(hands[2]!.length);
      wrap.dataset.discard = String(discardPairs);
      wrap.dataset.holder = String(jokerHolder());
      wrap.dataset.draws = String(myDraws);
      wrap.dataset.place = mode === 'over' ? String(places.indexOf(0) + 1) : '';
    }
  }

  // ---- 毎フレーム（CPUの手番・間・結果遷移。すべて ctx.now 基準＝ポーズで停止）----
  const offFrame = ctx.onFrame(() => {
    const now = ctx.now();
    if (mode === 'over') {
      if (!ended && now >= endAt) {
        ended = true;
        ctx.end({ score: PLACE_PTS[places.indexOf(0)] ?? 10 });
      }
      return;
    }
    if (revealUntil > now) return;
    if (needsAdvance) {
      needsAdvance = false;
      turn = nextActive(turn);
      beginTurn(now);
      renderAll();
      return;
    }
    if (awaiting === 'cpu' && now >= cpuActAt) {
      const src = nextActive(turn);
      const idx = Math.floor(ctx.random() * hands[src]!.length);
      doDraw(turn, src, idx, now);
    }
  });

  // ---- 起動（startMode:'immediate'。設定なし＝すぐ配る）----
  startGame();

  return {
    start() {
      // 配札は createGame 時に完了。演出はなし（immediate）
    },
    pause() {
      hostPaused = true;
    },
    resume() {
      hostPaused = false;
    },
    resize() {
      // flex/wrap レイアウトのみ
    },
    destroy() {
      offFrame();
      style.remove();
      wrap.remove();
    },
  };
}

// =============================================================
// スタイル（.om- プレフィックス。カードは白地固定・UIはテーマ変数）
// =============================================================
const CSS = `
.om-wrap{position:absolute;inset:0;overflow:hidden}
.om-play{position:absolute;inset:0;display:flex;flex-direction:column;padding:6px 8px 10px;box-sizing:border-box;
  user-select:none;-webkit-user-select:none;overflow-y:auto}

/* CPU（上段） */
.om-cpus{display:flex;flex-direction:column;gap:4px;padding:0 64px 4px 4px;min-height:54px}
.om-cpu-head{display:flex;gap:10px;align-items:center}
.om-cpu-name{font-size:13px;font-weight:800}
.om-cpu-state{font-size:12px;color:var(--text-dim);font-weight:800}
.om-cpu-state.om-done{color:var(--accent-2)}
.om-fan{display:flex;height:26px;margin-top:2px}
.om-mini{width:14px;height:22px;border-radius:3px;margin-right:-6px;
  background:repeating-linear-gradient(45deg,#5b6cd9 0 4px,#4a58c0 4px 8px);border:1px solid #3b478f}

/* 中央 */
.om-msg{min-height:40px;display:flex;align-items:center;justify-content:center;text-align:center;
  font-size:15px;font-weight:800;padding:2px 10px}
.om-discard{text-align:center;font-size:12px;color:var(--text-dim);font-weight:800;min-height:18px}

/* 引き取り列（伏せ札・44px基準） */
.om-take-row{min-height:112px;display:flex;flex-direction:column;align-items:center;gap:4px;padding:4px 0}
.om-take-label{font-size:13px;font-weight:800;color:var(--accent-2)}
.om-take{display:flex;flex-wrap:wrap;justify-content:center;gap:4px;max-width:100%}
.om-card{position:relative;width:46px;height:64px;border-radius:7px;background:#fff;color:#1a1f2e;
  border:1.5px solid #cbd2e0;display:flex;flex-direction:column;align-items:center;justify-content:center;
  font-family:inherit;box-shadow:0 2px 5px rgba(0,0,0,.2);padding:0;flex-shrink:0}
button.om-card{cursor:pointer;min-width:44px;min-height:62px}
button.om-card:active{transform:translateY(-6px)}
.om-back{background:repeating-linear-gradient(45deg,#5b6cd9 0 6px,#4a58c0 6px 12px);border-color:#3b478f}
.om-red{color:#d3213a}
.om-joker{color:#7c3aed;border-color:#c4b5fd;background:#faf5ff}
.om-rank{font-size:20px;font-weight:900;line-height:1}
.om-suit{font-size:15px;line-height:1.3}
.om-joker .om-rank{font-size:24px}
.om-joker .om-suit{font-size:9px;font-weight:900;letter-spacing:.5px}

/* あなたの手札（下段） */
.om-my-wrap{margin-top:auto;padding-top:6px}
.om-my-label{text-align:center;font-size:13px;font-weight:800;padding-bottom:4px}
.om-my{display:flex;flex-wrap:wrap;justify-content:center;gap:4px}
.om-my .om-card{width:42px;height:58px}
.om-my .om-rank{font-size:18px}
.om-my .om-suit{font-size:13px}
`;
