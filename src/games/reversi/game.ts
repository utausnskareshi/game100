// リバーシ本体。CPU対戦・先攻/後攻選択・3段階のつよさ・待った・合法手ハイライト。
// タイマー（CPUの思考待ち・パス表示・終局の余韻）はすべて onFrame + ctx.now の期限方式
// （setTimeout 不使用 → ポーズで自動停止。maze / hit-and-blow と同一パターン）。
// import してよいのは game-api（types / helpers）と、このフォルダ内モジュール（engine/ai）だけ。
import type { GameContext, IGame, Size } from '../../game-api/types';
import { elem, makeSeg } from '../../game-api/helpers';
import {
  BLACK,
  WHITE,
  applyMove,
  countDiscs,
  hasMove,
  initialBoard,
  legalMoves,
  opponent,
  winner,
  type Color,
} from './engine';
import { chooseMove, type Level } from './ai';

type Phase = 'setup' | 'human' | 'cpu' | 'over';
interface Snapshot {
  board: Int8Array;
  lastMove: number;
}

const CORNERS = [0, 7, 56, 63];

export function createGame(ctx: GameContext): IGame {
  // 前回の設定を復元（既定＝先攻・ふつう）
  const saved = ctx.load<{ humanColor: Color; level: Level }>('config');
  let humanColor: Color = saved?.humanColor === WHITE ? WHITE : BLACK;
  let level: Level = saved?.level === 'easy' || saved?.level === 'hard' ? saved.level : 'normal';
  let cpuColor: Color = opponent(humanColor);

  let board = initialBoard();
  let phase: Phase = 'setup';
  let lastMove = -1;
  let history: Snapshot[] = [];
  let wasBehindLate = false; // 終盤に劣勢だったか（逆転実績用）
  // ---- 期限（すべて ctx.now 基準。ポーズ中は進まず、再開で続きから）----
  let cpuDueAt = Infinity; // CPU が着手する時刻
  let endAt = Infinity; // 終局の余韻ののち結果画面へ自動遷移する時刻
  let resultScore = 0; // endAt 到来時に ctx.end へ渡すスコア（自分の最終石数）
  let flashEl: HTMLElement | null = null; // 「パス！」の一時表示
  let flashUntil = Infinity;

  // ---- DOM ----
  const style = document.createElement('style');
  style.textContent = CSS;
  const wrap = document.createElement('div');
  wrap.className = 'rv-wrap';
  ctx.root.append(style, wrap);

  const cells: HTMLButtonElement[] = [];
  const shown = new Int8Array(64).fill(-1); // 直近に描画した各マスの状態（-1で強制初回描画）
  let hudCounts: HTMLElement | null = null;
  let hudTurn: HTMLElement | null = null;
  let undoBtn: HTMLButtonElement | null = null;

  // ---- 設定画面 ----
  function showSetup(): void {
    phase = 'setup';
    cpuDueAt = Infinity;
    const box = elem('div', 'rv-setup');
    box.append(elem('h2', 'rv-h2', 'たいせん せってい'));
    box.append(
      makeSeg(
        'rv',
        'てばん',
        [
          { v: 'black', t: 'せんこう（黒）' },
          { v: 'white', t: 'こうこう（白）' },
        ],
        () => (humanColor === BLACK ? 'black' : 'white'),
        (v) => {
          humanColor = v === 'white' ? WHITE : BLACK;
          cpuColor = opponent(humanColor);
        },
      ),
      makeSeg(
        'rv',
        'つよさ',
        [
          { v: 'easy', t: 'よわい' },
          { v: 'normal', t: 'ふつう' },
          { v: 'hard', t: 'つよい' },
        ],
        () => level,
        (v) => {
          level = v as Level;
        },
      ),
    );
    const start = elem('button', 'rv-btn rv-btn-primary rv-btn-lg', 'たいせん開始 ▶') as HTMLButtonElement;
    start.addEventListener('click', () => startMatch());
    box.append(start);
    wrap.replaceChildren(box);
  }

  // ---- 対局開始 ----
  function startMatch(): void {
    ctx.save('config', { humanColor, level });
    cpuColor = opponent(humanColor);
    board = initialBoard();
    history = [];
    lastMove = -1;
    wasBehindLate = false;
    buildBoardView();
    setTurn(BLACK); // リバーシは黒が先手
  }

  function buildBoardView(): void {
    cells.length = 0;
    shown.fill(-1);

    const hud = elem('div', 'rv-hud');
    hudCounts = elem('div', 'rv-counts');
    hudTurn = elem('div', 'rv-turn');
    hud.append(hudCounts, hudTurn);

    const grid = elem('div', 'rv-grid');
    for (let i = 0; i < 64; i++) {
      const idx = i;
      const cell = elem('button', 'rv-cell') as HTMLButtonElement;
      cell.addEventListener('click', () => humanMove(idx));
      cells.push(cell);
      grid.append(cell);
    }

    const bar = elem('div', 'rv-bar');
    undoBtn = elem('button', 'rv-btn', '↩ まった') as HTMLButtonElement;
    undoBtn.addEventListener('click', () => undo());
    bar.append(undoBtn);

    wrap.replaceChildren(hud, grid, bar);
  }

  // ---- 描画 ----
  function render(anim?: { placed: number; flips: number[] }): void {
    const legal = phase === 'human' ? new Set(legalMoves(board, humanColor)) : new Set<number>();
    for (let i = 0; i < 64; i++) {
      const cell = cells[i];
      if (!cell) continue;
      const v = board[i] ?? 0;
      if (shown[i] !== v) {
        cell.replaceChildren();
        if (v !== 0) {
          const disc = elem('span', 'rv-disc ' + (v === BLACK ? 'rv-black' : 'rv-white'));
          if (anim) {
            if (i === anim.placed) disc.classList.add('rv-pop');
            else if (anim.flips.includes(i)) disc.classList.add('rv-flip');
          }
          cell.append(disc);
        }
        shown[i] = v;
      }
      cell.classList.toggle('rv-legal', v === 0 && legal.has(i));
      cell.classList.toggle('rv-last', i === lastMove && v !== 0);
      cell.disabled = !(phase === 'human' && legal.has(i));
    }
    updateHud();
  }

  function updateHud(): void {
    const { black, white } = countDiscs(board);
    if (hudCounts) {
      hudCounts.replaceChildren(
        chip('rv-chip-b', '⚫', black, humanColor === BLACK),
        chip('rv-chip-w', '⚪', white, humanColor === WHITE),
      );
    }
    if (hudTurn) {
      hudTurn.textContent = phase === 'human' ? 'あなたのばん' : phase === 'cpu' ? 'CPU が考え中…' : '';
    }
    if (undoBtn) undoBtn.disabled = !(phase === 'human' && history.length > 0);
  }

  function chip(cls: string, mark: string, n: number, you: boolean): HTMLElement {
    const c = elem('div', 'rv-chip ' + cls + (you ? ' rv-you' : ''));
    c.append(elem('span', 'rv-chip-mark', mark), elem('span', 'rv-chip-n', String(n)));
    if (you) c.append(elem('span', 'rv-chip-you', 'あなた'));
    return c;
  }

  // ---- 着手 ----
  function humanMove(i: number): void {
    if (phase !== 'human') return;
    const res = applyMove(board, i, humanColor);
    if (!res) return;
    history.push({ board: board.slice(), lastMove }); // 「まった」用に手を打つ前の状態を保存
    board = res.board;
    lastMove = i;
    ctx.sfx('tap');
    ctx.haptic('light');
    render({ placed: i, flips: res.flips });
    advanceAfter(humanColor);
  }

  /** CPU の着手（cpuDueAt の期限到来で onFrame から呼ばれる） */
  function cpuAct(): void {
    if (phase !== 'cpu') return;
    const mv = chooseMove(board, cpuColor, level, ctx.random);
    if (mv == null) {
      advanceAfter(cpuColor);
      return;
    }
    const res = applyMove(board, mv, cpuColor);
    if (!res) {
      advanceAfter(cpuColor);
      return;
    }
    board = res.board;
    lastMove = mv;
    ctx.sfx('tap');
    render({ placed: mv, flips: res.flips });
    advanceAfter(cpuColor);
  }

  function advanceAfter(mover: Color): void {
    // 終盤の劣勢を記録（逆転実績用）
    const cnt = countDiscs(board);
    if (cnt.empty <= 20) {
      const mine = humanColor === BLACK ? cnt.black : cnt.white;
      const theirs = humanColor === BLACK ? cnt.white : cnt.black;
      if (mine + 8 <= theirs) wasBehindLate = true;
    }
    const next = opponent(mover);
    if (hasMove(board, next)) {
      setTurn(next);
      return;
    }
    if (hasMove(board, mover)) {
      // 相手は打てない＝パス。手番は動かした側に戻る
      flash(next === humanColor ? 'あなたはパス！' : 'CPU はパス！');
      setTurn(mover);
      return;
    }
    endGame();
  }

  function setTurn(color: Color): void {
    if (color === humanColor) {
      phase = 'human';
      render();
    } else {
      phase = 'cpu';
      render();
      cpuDueAt = ctx.now() + 550; // 「考え中…」の間（人間らしい待ち）
    }
  }

  function undo(): void {
    if (phase !== 'human' || history.length === 0) return;
    const snap = history.pop();
    if (!snap) return;
    // 自分の直前の着手（＋それへのCPU応手）をまとめて取り消し、自分の手番に戻す
    board = snap.board;
    lastMove = snap.lastMove;
    ctx.sfx('tick');
    render();
  }

  // ---- 終局 ----
  function endGame(): void {
    phase = 'over';
    cpuDueAt = Infinity;
    render();
    const { black, white } = countDiscs(board);
    const humanDiscs = humanColor === BLACK ? black : white;
    const cpuDiscs = humanColor === BLACK ? white : black;
    const win = winner(board);
    const humanWon = win !== 0 && win === humanColor;
    const draw = win === 0;

    if (humanWon) {
      ctx.achieve('first-win');
      if (level === 'hard') ctx.achieve('beat-hard');
      if (cpuDiscs === 0) ctx.achieve('shutout');
      if (CORNERS.every((c) => board[c] === humanColor)) ctx.achieve('four-corners');
      if (wasBehindLate) ctx.achieve('comeback');
      ctx.sfx('medal');
      ctx.haptic('success');
    } else if (draw) {
      ctx.sfx('success');
    } else {
      ctx.sfx('fail');
      ctx.haptic('error');
    }

    // 勝敗カードを盤の上に出す（盤は見えたまま）。少し余韻をおいて結果画面へ自動遷移する。
    // 自前の「けっか」ボタンを置くと、シェル的には state='playing' のままなので
    // ポーズボタンが重なって残り、そこで「ポーズ→やめる」されると ctx.end() が呼ばれず
    // 勝敗が記録されない。自動遷移にすることでこの競合を無くす。
    const over = elem('div', 'rv-over');
    const title = humanWon ? 'あなたの かち！ 🎉' : draw ? 'ひきわけ' : 'まけ…';
    over.append(elem('div', 'rv-over-title ' + (humanWon ? 'rv-win' : draw ? '' : 'rv-lose'), title));
    over.append(elem('div', 'rv-over-score', `⚫ ${black}  -  ${white} ⚪`));
    wrap.append(over);
    resultScore = humanDiscs;
    endAt = ctx.now() + 1700;
  }

  // ---- 補助 ----
  function flash(text: string): void {
    flashEl?.remove(); // 前の表示が残っていたら差し替える（同時表示は最大1つ）
    flashEl = elem('div', 'rv-flash', text);
    wrap.append(flashEl);
    flashUntil = ctx.now() + 1100;
  }

  // ---- 期限処理 ----
  const offFrame = ctx.onFrame(() => {
    const now = ctx.now();
    if (flashEl && now >= flashUntil) {
      flashEl.remove();
      flashEl = null;
    }
    if (phase === 'cpu' && now >= cpuDueAt) {
      cpuDueAt = Infinity;
      cpuAct();
    }
    if (phase === 'over' && now >= endAt) {
      endAt = Infinity; // 二重 end() を送らない
      ctx.end({ score: resultScore });
    }
  });

  // ---- ライフサイクル ----
  return {
    start() {
      showSetup();
    },
    pause() {
      // 期限はすべて ctx.now 基準（ポーズ中は進まない）ので、止める処理は不要
    },
    resume() {},
    resize(_size: Size) {
      // 盤は CSS（min(vw,vh) 基準）で自動調整するため処理不要
    },
    destroy() {
      offFrame();
      style.remove();
      wrap.remove();
    },
  };
}

// このゲーム専用のスタイル。ctx.root 配下に置くので teardown（clear(gameRoot)）で自動的に消える。
const CSS = `
.rv-wrap{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:8px;overflow:hidden}
.rv-hud{display:flex;flex-direction:column;align-items:center;gap:4px;width:min(92vw,72vh)}
.rv-counts{display:flex;gap:12px}
.rv-chip{display:flex;align-items:center;gap:6px;background:var(--bg-elev);border-radius:999px;padding:5px 14px;font-weight:800}
.rv-chip-mark{font-size:18px;line-height:1}
.rv-chip-n{font-size:18px;min-width:1.3em;text-align:center}
.rv-chip.rv-you{outline:2px solid var(--accent)}
.rv-chip-you{font-size:10px;color:var(--accent);font-weight:800}
.rv-turn{font-size:13px;color:var(--text-dim);font-weight:700;min-height:1.3em}
.rv-grid{width:min(92vw,72vh);height:min(92vw,72vh);display:grid;grid-template-columns:repeat(8,1fr);grid-template-rows:repeat(8,1fr);gap:2px;background:#0d5c3a;padding:6px;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.35)}
.rv-cell{position:relative;border:none;padding:0;margin:0;background:#1a8a5a;border-radius:3px;display:flex;align-items:center;justify-content:center}
.rv-cell:disabled{opacity:1}
.rv-cell.rv-legal::after{content:'';width:26%;height:26%;border-radius:50%;background:rgba(255,255,255,.45)}
.rv-cell.rv-last::before{content:'';position:absolute;inset:8%;border:2px solid var(--accent-2);border-radius:4px;pointer-events:none}
.rv-disc{width:84%;height:84%;border-radius:50%;box-shadow:0 1px 2px rgba(0,0,0,.4)}
.rv-black{background:radial-gradient(circle at 34% 30%,#5a5f6b,#0e1016)}
.rv-white{background:radial-gradient(circle at 34% 30%,#ffffff,#c4cad8)}
.rv-pop{animation:rv-pop .18s ease-out}
.rv-flip{animation:rv-flip .3s ease-in-out}
@keyframes rv-pop{from{transform:scale(0)}to{transform:scale(1)}}
@keyframes rv-flip{0%{transform:scaleX(1)}50%{transform:scaleX(.08)}100%{transform:scaleX(1)}}
.rv-bar{display:flex;gap:10px;width:min(92vw,72vh);justify-content:center}
.rv-btn{appearance:none;border:none;border-radius:12px;padding:12px 20px;font-size:15px;font-weight:700;background:var(--bg-elev2);color:var(--text);min-height:44px}
.rv-btn:disabled{opacity:.4}
.rv-btn-primary{background:var(--accent-grad);color:#fff}
.rv-btn-lg{width:100%;max-width:300px;font-size:17px}
.rv-setup{display:flex;flex-direction:column;align-items:center;gap:18px;width:min(92vw,420px)}
.rv-h2{margin:0;font-size:22px}
.rv-seg-row{width:100%;display:flex;flex-direction:column;gap:8px}
.rv-seg-label{font-size:13px;color:var(--text-dim);font-weight:800}
.rv-seg{display:flex;background:var(--bg-elev2);border-radius:12px;padding:3px;gap:2px}
.rv-seg-btn{flex:1;border:none;background:none;color:var(--text-dim);padding:10px;border-radius:9px;font-size:14px;font-weight:800;min-height:44px}
.rv-seg-btn.rv-on{background:var(--accent);color:#fff}
.rv-flash{position:absolute;top:16%;left:50%;transform:translateX(-50%);background:var(--bg-elev2);color:var(--text);padding:9px 20px;border-radius:999px;font-weight:800;box-shadow:var(--shadow);animation:rv-fade 1.1s ease;pointer-events:none;white-space:nowrap}
@keyframes rv-fade{0%{opacity:0}15%{opacity:1}80%{opacity:1}100%{opacity:0}}
.rv-over{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);display:flex;flex-direction:column;align-items:center;gap:8px;padding:20px 34px;text-align:center;background:var(--bg-elev);border-radius:20px;box-shadow:var(--shadow);pointer-events:none;animation:rv-appear .25s ease-out}
@keyframes rv-appear{from{opacity:0}to{opacity:1}}
.rv-over-title{font-size:28px;font-weight:800}
.rv-win{color:var(--gold)}
.rv-lose{color:var(--text-dim)}
.rv-over-score{font-size:20px;font-weight:800}
`;
