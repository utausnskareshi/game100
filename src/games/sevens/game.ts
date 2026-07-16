// =============================================================
// 七ならべ（No.57）: あなた＋CPU2人。7から上下へ ならべて 手札を先になくそう！
// =============================================================
// - 出せるカードを タップ→場へ。出せない/出したくないときは パス（3回まで・4回目で脱落）。
// - 盤・配り・CPUは engine.ts（純ロジック・rng注入）。DOM描画・CPUは ctx.now 期限で自動手番。
// - 時間は ctx.now・乱数は ctx.random・setTimeout 不使用。
// - import してよいのは game-api（types / helpers）と、このフォルダ内（engine）だけ
import type { GameContext, IGame } from '../../game-api/types';
import { elem } from '../../game-api/helpers';
import {
  type Board,
  type CardSR,
  RANK_CHARS,
  SUIT_CHARS,
  cpuChoose,
  deal,
  dumpHand,
  isRedSuit,
  place,
  playableOf,
  removeFromHand,
} from './engine';

const PLAYERS = 3;
const PASS_MAX = 3;
const CPU_DELAY = 750;
const RESULT_DELAY = 2200;
const RANK_SCORE = [150, 80, 20];
const OUT_SCORE = 10;
const NAMES = ['あなた', 'CPU1', 'CPU2'];

type Mode = 'play' | 'over';

export function createGame(ctx: GameContext): IGame {
  const d = deal(ctx.random, PLAYERS);
  const board: Board = d.board;
  const hands: CardSR[][] = d.hands;
  const passesLeft = [PASS_MAX, PASS_MAX, PASS_MAX];
  const active = [true, true, true];
  const finishOrder: number[] = []; // あがった順（player index）
  const outOrder: number[] = []; // 脱落した順
  let turn = 0;
  let mode: Mode = 'play';
  let hostPaused = false;
  let cpuActAt = 0;
  let myPasses = 0;
  let myTurnCount = 0;
  let myRank = 0; // 1..3、脱落は 0 のまま扱い
  let myEliminated = false;
  let endAt = 0;
  let ended = false;
  let totalWins = ctx.load<number>('wins') ?? 0;
  let msg = 'あなたのばん';

  const style = document.createElement('style');
  style.textContent = CSS;
  const wrap = elem('div', 'sv-wrap');
  ctx.root.append(style, wrap);

  const myScore = (): number => (myEliminated ? OUT_SCORE : RANK_SCORE[Math.min(myRank - 1, 2)] ?? OUT_SCORE);

  function setData(): void {
    if (!import.meta.env.DEV) return;
    const r = ctx.root as HTMLElement;
    r.dataset.mode = mode;
    r.dataset.turn = String(turn);
    r.dataset.hands = hands.map((h) => h.length).join(',');
    r.dataset.passes = passesLeft.join(',');
    r.dataset.active = active.map((a) => (a ? 1 : 0)).join(',');
    r.dataset.finish = finishOrder.join(',');
    r.dataset.out = outOrder.join(',');
    r.dataset.myrank = String(myRank);
    r.dataset.myelim = myEliminated ? '1' : '0';
    r.dataset.score = String(mode === 'over' ? myScore() : 0);
    let placed = 0;
    for (let s = 0; s < 4; s++) for (let r = 1; r <= 13; r++) if (board.placed[s]![r]) placed++;
    r.dataset.placed = String(placed);
  }

  function nextActive(from: number): number {
    let t = from;
    for (let i = 0; i < PLAYERS; i++) {
      t = (t + 1) % PLAYERS;
      if (active[t]) return t;
    }
    return -1;
  }

  function activeCount(): number {
    return active.filter(Boolean).length;
  }

  // ---- プレイヤーが inactive になったとき（あがり/脱落）----
  function playerDone(p: number, eliminated: boolean): void {
    active[p] = false;
    if (eliminated) {
      outOrder.push(p);
      dumpHand(board, hands[p]!);
    } else {
      finishOrder.push(p);
    }
    if (p === 0) {
      myEliminated = eliminated;
      myRank = eliminated ? 0 : finishOrder.indexOf(0) + 1;
      // 実績（あなたの結果が確定した瞬間）
      if (!eliminated) {
        ctx.achieve('first-agari');
        if (myRank <= 2) ctx.achieve('top2');
        if (myRank === 1) {
          ctx.achieve('win');
          if (myPasses === 0) ctx.achieve('no-pass-win');
          if (myTurnCount <= 8) ctx.achieve('quick-win');
          totalWins++;
          ctx.save('wins', totalWins);
          if (totalWins >= 3) ctx.achieve('win-3');
        }
      }
    }
  }

  // ---- 1手ぶんの処理（play=出すカード or null=パス）----
  function doTurn(p: number, card: CardSR | null): void {
    if (card) {
      place(board, card.s, card.r);
      removeFromHand(hands[p]!, card.s, card.r);
      ctx.sfx('tap');
      if (p === 0) myTurnCount++;
      if (hands[p]!.length === 0) {
        playerDone(p, false);
        if (p === 0) ctx.sfx('medal');
      }
    } else {
      // パス
      if (p === 0) {
        myPasses++;
        myTurnCount++;
      }
      if (passesLeft[p]! > 0) {
        passesLeft[p]!--;
        ctx.sfx('tick');
      } else {
        playerDone(p, true); // 4回目のパス＝脱落
        ctx.sfx('fail');
      }
    }
    advance();
  }

  function advance(): void {
    // 残り1人になったら その人も終了→ゲーム終了
    if (activeCount() <= 1) {
      const last = active.indexOf(true);
      if (last >= 0) playerDone(last, false);
      endGame();
      return;
    }
    turn = nextActive(turn);
    if (turn === 0) {
      msg = 'あなたのばん';
    } else {
      msg = `${NAMES[turn]}が かんがえ中…`;
      cpuActAt = ctx.now() + CPU_DELAY;
    }
    render();
    setData();
  }

  function endGame(): void {
    mode = 'over';
    endAt = ctx.now() + RESULT_DELAY;
    render();
    setData();
  }

  // ---- 入力（あなたの手番）----
  function playCard(c: CardSR): void {
    if (mode !== 'play' || hostPaused || turn !== 0) return;
    if (!playableOf(hands[0]!, board).some((x) => x.s === c.s && x.r === c.r)) return;
    doTurn(0, c);
  }
  function passTurn(): void {
    if (mode !== 'play' || hostPaused || turn !== 0) return;
    if (passesLeft[0]! <= 0 && playableOf(hands[0]!, board).length > 0) return; // 出せるならパス不可
    doTurn(0, null);
  }

  // ---- CPU / 結果 の進行 ----
  const offFrame = ctx.onFrame(() => {
    if (hostPaused) return;
    const now = ctx.now();
    if (mode === 'play' && turn !== 0 && now >= cpuActAt) {
      const p = turn;
      const choose = cpuChoose(hands[p]!, board, ctx.random);
      doTurn(p, choose);
    } else if (mode === 'over' && !ended && now >= endAt) {
      ended = true;
      ctx.end({ score: myScore() });
    }
  });

  // ---- 描画 ----
  function render(): void {
    const playable = turn === 0 && mode === 'play' ? playableOf(hands[0]!, board) : [];
    const playSet = new Set(playable.map((c) => c.s * 100 + c.r));

    // 盤（4スート×13）
    const boardEl = elem('div', 'sv-board');
    for (let s = 0; s < 4; s++) {
      const row = elem('div', 'sv-row');
      row.append(elem('div', 'sv-suit' + (isRedSuit(s) ? ' sv-red' : ''), SUIT_CHARS[s] ?? ''));
      for (let r = 1; r <= 13; r++) {
        const cell = elem('div', 'sv-cell');
        if (board.placed[s]![r]) {
          cell.classList.add('sv-on', isRedSuit(s) ? 'sv-red' : 'sv-black');
          if (r === 7) cell.classList.add('sv-seven');
          cell.textContent = RANK_CHARS[r] ?? '';
        }
        row.append(cell);
      }
      boardEl.append(row);
    }

    // 相手の情報
    const opp = elem('div', 'sv-opp');
    for (let p = 1; p < PLAYERS; p++) {
      const tag = active[p] ? `${hands[p]!.length}枚 / パス${passesLeft[p]}` : finishOrder.includes(p) ? `あがり` : `だつらく`;
      const o = elem('div', 'sv-opp-item' + (turn === p && mode === 'play' ? ' sv-active' : ''), `${NAMES[p]}：${tag}`);
      opp.append(o);
    }

    // メッセージ
    const info = elem('div', 'sv-info', mode === 'over' ? '' : msg);

    // 手札
    const handEl = elem('div', 'sv-hand');
    if (active[0]) {
      for (const c of hands[0]!) {
        const canPlay = playSet.has(c.s * 100 + c.r);
        const ce = elem('button', 'sv-card ' + (isRedSuit(c.s) ? 'sv-red' : 'sv-black') + (canPlay ? ' sv-can' : '')) as HTMLButtonElement;
        ce.append(elem('span', 'sv-rk', RANK_CHARS[c.r] ?? ''), elem('span', 'sv-st', SUIT_CHARS[c.s] ?? ''));
        ce.disabled = !canPlay || turn !== 0 || mode !== 'play';
        ce.addEventListener('click', () => playCard(c));
        handEl.append(ce);
      }
    }

    // パスボタン
    const bar = elem('div', 'sv-bar');
    const passBtn = elem('button', 'sv-pass', `パス（のこり${passesLeft[0]}）`) as HTMLButtonElement;
    const mustPlay = passesLeft[0]! <= 0 && playable.length > 0;
    passBtn.disabled = turn !== 0 || mode !== 'play' || mustPlay;
    passBtn.addEventListener('click', () => passTurn());
    bar.append(passBtn);

    wrap.replaceChildren(boardEl, opp, info, handEl, bar);

    if (mode === 'over') {
      const ov = elem('div', 'sv-over');
      const rankText = myEliminated ? 'だつらく…' : `${myRank}い！`;
      ov.append(
        elem('div', 'sv-over-title', myRank === 1 ? '🎉 1い！ 🎉' : rankText),
        elem('div', 'sv-over-sub', `${myScore()}てん`),
      );
      wrap.append(ov);
    }
  }

  render();
  setData();

  return {
    start() {
      /* immediate */
    },
    pause() {
      hostPaused = true;
    },
    resume() {
      hostPaused = false;
    },
    resize() {
      /* CSS 追従（固定レイアウト） */
    },
    destroy() {
      offFrame();
      style.remove();
      wrap.remove();
    },
  };
}

const CSS = `
.sv-wrap{position:absolute;inset:0;display:flex;flex-direction:column;gap:8px;padding:10px 8px;box-sizing:border-box;
  overflow:hidden;user-select:none;-webkit-user-select:none;background:#123b2a}
.sv-board{display:flex;flex-direction:column;gap:3px;background:rgba(0,0,0,.18);border-radius:10px;padding:6px 4px}
.sv-row{display:flex;gap:2px;align-items:center;justify-content:center}
.sv-suit{width:18px;text-align:center;font-size:15px;font-weight:800;color:#cfe6d8;flex:0 0 auto}
.sv-cell{flex:1;aspect-ratio:2/2.6;max-width:24px;min-height:26px;border-radius:4px;background:rgba(255,255,255,.06);
  display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;color:#88a596}
.sv-on{background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.3)}
.sv-red{color:#d3213a}
.sv-black{color:#1a1a1a}
.sv-cell.sv-red.sv-on{color:#d3213a}
.sv-cell.sv-black.sv-on{color:#1a1a1a}
.sv-seven{outline:2px solid #ffd54a;outline-offset:-2px}
.sv-opp{display:flex;gap:8px;justify-content:center;flex-wrap:wrap}
.sv-opp-item{font-size:12px;font-weight:700;color:#bfe0cf;background:rgba(0,0,0,.2);padding:4px 10px;border-radius:999px}
.sv-active{background:var(--accent,#7c6cf0);color:#fff}
.sv-info{text-align:center;font-size:15px;font-weight:800;color:#fff;min-height:20px}
.sv-hand{display:flex;flex-wrap:wrap;gap:5px;justify-content:center;align-content:flex-start;flex:1 1 auto;overflow-y:auto;padding:2px}
.sv-card{width:38px;height:52px;border-radius:6px;border:1px solid #b9c0d0;background:#fff;display:flex;flex-direction:column;
  align-items:center;justify-content:center;padding:0;line-height:1.05;opacity:.55}
.sv-card.sv-can{opacity:1;border:2px solid #ffd54a;box-shadow:0 2px 6px rgba(255,213,74,.5)}
.sv-card:disabled{cursor:default}
.sv-rk{font-size:16px;font-weight:800}
.sv-st{font-size:13px}
.sv-bar{display:flex;justify-content:center;flex:0 0 auto}
.sv-pass{appearance:none;border:none;border-radius:12px;min-height:44px;padding:8px 22px;font-size:15px;font-weight:800;
  background:var(--accent-grad,#7c6cf0);color:#fff}
.sv-pass:disabled{opacity:.4}
.sv-over{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;
  background:rgba(6,30,20,.8);pointer-events:none}
.sv-over-title{font-size:32px;font-weight:800;color:#ffe08a}
.sv-over-sub{font-size:22px;font-weight:800;color:#fff}
`;
