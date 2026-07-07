// =============================================================
// スピード（No.3）: CPUとリアルタイム対戦するトランプゲーム
// =============================================================
// - 設定画面でローカルルール（つよさ・同じ数字・ジョーカー・ヒント）を選択（前回設定を記憶）
// - ターン制ではない: 出せるカードは早い者勝ち。CPUは難易度別の反応時間で動く
// - タイマーはすべて onFrame + ctx.now の期限方式（setTimeout不使用 → ポーズで自動停止）
// - import してよいのは game-api（types / helpers）と、このフォルダ内（engine）だけ
// =============================================================
import type { GameContext, IGame } from '../../game-api/types';
import { createCountdown, elem, makeSeg } from '../../game-api/helpers';
import {
  RANK_LABEL,
  SUIT_GLYPH,
  buildDeck,
  canPlace,
  isJoker,
  isRed,
  type Card,
  type Rules,
} from './engine';

type Level = 'easy' | 'normal' | 'hard';
type Mode = 'setup' | 'count' | 'play' | 'seno' | 'over';

interface Config {
  level: Level;
  sameRank: boolean;
  joker: boolean;
  hint: boolean;
}

interface Side {
  deck: Card[];
  slots: (Card | null)[]; // 場札4（空スロットは詰めない）
}

interface MoveOpt {
  slot: number;
  pile: number;
}

const SLOT_N = 4;
const STUCK_WAIT = 600; // 両者出せない状態がこの時間続いたら「せーの」
const SENO_FLIP_WAIT = 900; // 「せーの！」表示からめくりまで
const COUNT_STEP = 650; // カウントダウンの1刻み
const OVER_WAIT = 1600; // 勝敗バナー表示時間
const WIN_BONUS = 30;
const TIME_BONUS_FROM = 150; // この秒数より早く勝つほどボーナス（×2点/秒）

// CPUの反応時間（ミリ秒）。よわいはたまに見送る
const CPU_DELAY: Record<Level, { min: number; range: number }> = {
  easy: { min: 1500, range: 800 },
  normal: { min: 950, range: 550 },
  hard: { min: 550, range: 350 },
};

export function createGame(ctx: GameContext): IGame {
  // ---- 設定（前回の選択を復元）----
  const saved = ctx.load<Partial<Config>>('config');
  const config: Config = {
    level: saved?.level === 'easy' || saved?.level === 'hard' ? saved.level : 'normal',
    sameRank: saved?.sameRank === true,
    joker: saved?.joker === true,
    hint: saved?.hint !== false, // 既定ON
  };
  const rules: Rules = { sameRank: config.sameRank, joker: config.joker };

  // ---- 対戦状態 ----
  let mode: Mode = 'setup';
  let you: Side = { deck: [], slots: [] };
  let cpu: Side = { deck: [], slots: [] };
  let piles: [Card[], Card[]] = [[], []];
  let initialCount = 26;

  let matchStart = 0; // 「スピード！」の瞬間（経過タイムの起点）
  let cpuNextAt = 0; // 0 = 出せる手ができるのを待っている
  let stuckSince = 0;
  let senoFlipAt = 0;
  let overEndAt = 0;
  let finishAt = 0; // 勝敗が決まった時刻（タイムボーナスの経過秒計算に使う）
  let ended = false;
  let won = false;
  let hostPaused = false; // ポーズ中の合成クリック等でも状態が動かないようにする防御
  let senoCount = 0;
  let youStreak = 0; // CPUに割り込まれず連続で出した枚数
  let shownTenth = -1; // タイマー表示の更新間引き

  // ---- DOM ----
  const style = document.createElement('style');
  style.textContent = CSS;
  const wrap = document.createElement('div');
  wrap.className = 'sp-wrap';
  ctx.root.append(style, wrap);

  const youSlotEls: HTMLButtonElement[] = [];
  const cpuSlotEls: HTMLElement[] = [];
  const pileEls: HTMLElement[] = [];
  let youDeckEl: HTMLElement | null = null;
  let cpuDeckEl: HTMLElement | null = null;
  let timeEl: HTMLElement | null = null;
  let midEl: HTMLElement | null = null;
  let boardEl: HTMLElement | null = null;
  const floats: { el: HTMLElement; until: number }[] = []; // せーの・コンボ等の一時表示

  // ---- 設定画面 ----
  function showSetup(): void {
    mode = 'setup';
    const box = elem('div', 'sp-setup');
    box.append(elem('h2', 'sp-h2', 'ローカルルール'));
    const onoff = (v: boolean): string => (v ? 'on' : 'off');
    box.append(
      makeSeg(
        'sp',
        'つよさ',
        [
          { v: 'easy', t: 'よわい' },
          { v: 'normal', t: 'ふつう' },
          { v: 'hard', t: 'つよい' },
        ],
        () => config.level,
        (v) => {
          config.level = v as Level;
        },
      ),
      makeSeg(
        'sp',
        'おなじ数字',
        [
          { v: 'off', t: 'なし' },
          { v: 'on', t: 'あり' },
        ],
        () => onoff(config.sameRank),
        (v) => {
          config.sameRank = v === 'on';
          rules.sameRank = config.sameRank;
        },
      ),
      makeSeg(
        'sp',
        'ジョーカー',
        [
          { v: 'off', t: 'なし' },
          { v: 'on', t: 'あり' },
        ],
        () => onoff(config.joker),
        (v) => {
          config.joker = v === 'on';
          rules.joker = config.joker;
        },
      ),
      makeSeg(
        'sp',
        'ヒント',
        [
          { v: 'on', t: 'あり' },
          { v: 'off', t: 'なし' },
        ],
        () => onoff(config.hint),
        (v) => {
          config.hint = v === 'on';
        },
      ),
    );
    box.append(elem('p', 'sp-note', '「となりの数字」はいつでも出せるよ。KとAはつながってる！'));
    const start = elem('button', 'sp-btn sp-btn-primary sp-btn-lg', 'たいせん開始 ▶') as HTMLButtonElement;
    start.addEventListener('click', () => startMatch());
    box.append(start);
    wrap.replaceChildren(box);
  }

  // ---- カード描画 ----
  function paintCard(el: HTMLElement, card: Card | null): void {
    el.className = el.className
      .split(' ')
      .filter((c) => c === 'sp-card' || c === 'sp-slot')
      .join(' ');
    el.replaceChildren();
    if (!card) {
      el.classList.add('sp-empty');
      return;
    }
    if (isJoker(card)) {
      el.classList.add('sp-joker');
      el.append(elem('span', 'sp-rank', '🃏'), elem('span', 'sp-suit', 'JOKER'));
      return;
    }
    if (isRed(card)) el.classList.add('sp-red');
    el.append(elem('span', 'sp-rank', RANK_LABEL[card.rank] ?? '?'), elem('span', 'sp-suit', SUIT_GLYPH[card.suit]));
  }

  function paintDeck(el: HTMLElement, side: Side): void {
    el.replaceChildren();
    el.classList.toggle('sp-empty', side.deck.length === 0);
    if (side.deck.length > 0) {
      el.append(elem('span', 'sp-count', String(side.deck.length)));
    }
  }

  function paintPile(pileIdx: number, from?: 'you' | 'cpu'): void {
    const el = pileEls[pileIdx];
    if (!el) return;
    const pile = piles[pileIdx];
    const top = pile && pile.length > 0 ? pile[pile.length - 1] ?? null : null;
    paintCard(el, top);
    if (top && from) {
      el.classList.remove('sp-in-you', 'sp-in-cpu');
      void el.offsetWidth; // アニメ再トリガ
      el.classList.add(from === 'you' ? 'sp-in-you' : 'sp-in-cpu');
    }
  }

  function paintSlot(side: 'you' | 'cpu', i: number, pop = false): void {
    const el = side === 'you' ? youSlotEls[i] : cpuSlotEls[i];
    const s = side === 'you' ? you : cpu;
    if (!el) return;
    paintCard(el, s.slots[i] ?? null);
    if (pop && s.slots[i]) {
      el.classList.remove('sp-pop');
      void el.offsetWidth;
      el.classList.add('sp-pop');
    }
  }

  function paintHints(): void {
    const active = mode === 'play' && config.hint;
    for (let i = 0; i < SLOT_N; i++) {
      const el = youSlotEls[i];
      const card = you.slots[i];
      const can = !!(active && card && (canTop(card, 0) || canTop(card, 1)));
      el?.classList.toggle('sp-can', can);
    }
  }

  function paintAll(): void {
    for (let i = 0; i < SLOT_N; i++) {
      paintSlot('you', i);
      paintSlot('cpu', i);
    }
    paintPile(0);
    paintPile(1);
    if (youDeckEl) paintDeck(youDeckEl, you);
    if (cpuDeckEl) paintDeck(cpuDeckEl, cpu);
    paintHints();
  }

  /** 両者が同時に台札をめくった後の中央（台札2山＋山札2つ）の描画。開始時とせーので共用 */
  function repaintCenter(): void {
    paintPile(0, 'you');
    paintPile(1, 'cpu');
    if (youDeckEl) paintDeck(youDeckEl, you);
    if (cpuDeckEl) paintDeck(cpuDeckEl, cpu);
  }

  // ---- 対戦ビュー ----
  function buildMatchView(): void {
    youSlotEls.length = 0;
    cpuSlotEls.length = 0;
    pileEls.length = 0;

    const hud = elem('div', 'sp-hud');
    timeEl = elem('div', 'sp-time', '0.0');
    hud.append(timeEl);

    const cpuRow = elem('div', 'sp-row');
    cpuDeckEl = elem('div', 'sp-card sp-back sp-deck');
    const cpuSlots = elem('div', 'sp-slots');
    for (let i = 0; i < SLOT_N; i++) {
      const el = elem('div', 'sp-card sp-slot');
      cpuSlotEls.push(el);
      cpuSlots.append(el);
    }
    cpuRow.append(cpuDeckEl, cpuSlots);

    midEl = elem('div', 'sp-mid');
    for (let p = 0; p < 2; p++) {
      const el = elem('div', 'sp-card sp-slot');
      pileEls.push(el);
      midEl.append(el);
    }

    const youRow = elem('div', 'sp-row');
    const youSlots = elem('div', 'sp-slots');
    for (let i = 0; i < SLOT_N; i++) {
      const idx = i;
      const b = elem('button', 'sp-card sp-slot') as HTMLButtonElement;
      b.addEventListener('click', () => onSlotTap(idx));
      youSlotEls.push(b);
      youSlots.append(b);
    }
    youDeckEl = elem('div', 'sp-card sp-back sp-deck');
    youRow.append(youSlots, youDeckEl);

    boardEl = elem('div', 'sp-board');
    boardEl.append(
      elem('div', 'sp-label', `CPU（${config.level === 'easy' ? 'よわい' : config.level === 'hard' ? 'つよい' : 'ふつう'}）`),
    );
    boardEl.append(cpuRow, midEl, youRow);
    boardEl.append(elem('div', 'sp-label', 'あなた'));

    wrap.replaceChildren(hud, boardEl);
    paintAll();
  }

  // ---- 進行 ----
  function startMatch(): void {
    ctx.save('config', { ...config });
    you = { deck: buildDeck('red', config.joker, ctx.random), slots: [] };
    cpu = { deck: buildDeck('black', config.joker, ctx.random), slots: [] };
    initialCount = you.deck.length; // 26 or 27
    for (let i = 0; i < SLOT_N; i++) {
      you.slots.push(you.deck.pop() ?? null);
      cpu.slots.push(cpu.deck.pop() ?? null);
    }
    piles = [[], []];
    senoCount = 0;
    youStreak = 0;
    cpuNextAt = 0;
    stuckSince = 0;
    won = false;
    buildMatchView();
    // カウントダウン（3・2・1・スピード！）
    mode = 'count';
    countdown.start(ctx.now());
  }

  function showCenter(text: string, cls: string, ms: number): void {
    if (!boardEl) return;
    const el = elem('div', 'sp-center ' + cls, text);
    boardEl.append(el);
    floats.push({ el, until: ctx.now() + ms });
  }

  const countdown = createCountdown({
    stepMs: COUNT_STEP,
    onCount: (n) => {
      showCenter(String(n), 'sp-count-num', COUNT_STEP - 60);
      ctx.sfx('tick');
    },
    onGo: (now) => {
      // 台札を同時にめくって開始！
      flipLead(you, 0);
      flipLead(cpu, 1);
      showCenter('スピード！', 'sp-go', 700);
      ctx.sfx('start');
      matchStart = now;
      shownTenth = -1;
      mode = 'play';
      // 開いた台札と、減った山札の枚数を描画する。これがないと最初の1手が出るまで
      // 中央がからっぽに見えてしまう（せーのと同じ repaintCenter を共用）
      repaintCenter();
      paintHints();
    },
  });

  function top(pileIdx: number): Card | null {
    const pile = piles[pileIdx];
    return pile && pile.length > 0 ? pile[pile.length - 1] ?? null : null;
  }

  function canTop(card: Card, pileIdx: number): boolean {
    const t = top(pileIdx);
    return !!t && canPlace(card, t, rules);
  }

  function listMoves(s: Side): MoveOpt[] {
    const out: MoveOpt[] = [];
    for (let i = 0; i < SLOT_N; i++) {
      const c = s.slots[i];
      if (!c) continue;
      if (canTop(c, 0)) out.push({ slot: i, pile: 0 });
      if (canTop(c, 1)) out.push({ slot: i, pile: 1 });
    }
    return out;
  }

  function remaining(s: Side): number {
    let n = s.deck.length;
    for (const c of s.slots) if (c) n++;
    return n;
  }

  /** 出した後に「残りの場札から続けて出せる手」の数（台選びの1手先読み用） */
  function followUps(s: Side, usedSlot: number, newTop: Card, newTopPile: number): number {
    let n = 0;
    for (let i = 0; i < SLOT_N; i++) {
      if (i === usedSlot) continue;
      const c = s.slots[i];
      if (!c) continue;
      const t0 = newTopPile === 0 ? newTop : top(0);
      const t1 = newTopPile === 1 ? newTop : top(1);
      if ((t0 && canPlace(c, t0, rules)) || (t1 && canPlace(c, t1, rules))) n++;
    }
    return n;
  }

  function playCard(side: 'you' | 'cpu', slotIdx: number, pileIdx: number): void {
    const s = side === 'you' ? you : cpu;
    const card = s.slots[slotIdx];
    const t = top(pileIdx);
    if (!card || !t || !canPlace(card, t, rules)) return; // 実行時再検証（同時衝突対策）
    s.slots[slotIdx] = s.deck.pop() ?? null;
    piles[pileIdx]?.push(card);

    if (side === 'you') {
      youStreak++;
      ctx.haptic('light');
      if (youStreak >= 3) {
        showCenter(`×${youStreak} れんぞく！`, 'sp-combo', 700);
        if (youStreak === 5) {
          ctx.achieve('combo-5');
          ctx.sfx('combo');
        }
      }
    } else {
      youStreak = 0;
    }
    ctx.sfx('tap');

    paintPile(pileIdx, side);
    paintSlot(side, slotIdx, true);
    const deckEl = side === 'you' ? youDeckEl : cpuDeckEl;
    if (deckEl) paintDeck(deckEl, s);
    paintHints();
    stuckSince = 0;

    if (remaining(s) === 0) finish(side === 'you', card);
  }

  // ---- せーの（両者手詰まり時の同時めくり）----
  function enterSeno(now: number): void {
    mode = 'seno';
    senoFlipAt = now + SENO_FLIP_WAIT;
    showCenter('せーの！', 'sp-seno', SENO_FLIP_WAIT - 50);
    ctx.sfx('tick');
    paintHints(); // ヒント消灯
  }

  function flipLead(s: Side, pileIdx: number): Card | null {
    let card: Card | null = s.deck.pop() ?? null;
    if (!card) {
      // 山札切れ: 場札からランダムに1枚めくる（空スロットは詰めない）
      const idxs: number[] = [];
      for (let i = 0; i < SLOT_N; i++) if (s.slots[i]) idxs.push(i);
      const pick = idxs[Math.floor(ctx.random() * idxs.length)];
      if (pick == null) return null; // カードが1枚もない（＝すでに勝敗がついている）
      card = s.slots[pick] ?? null;
      s.slots[pick] = null;
      paintSlot(s === you ? 'you' : 'cpu', pick);
    }
    if (card) piles[pileIdx]?.push(card);
    return card;
  }

  function doSenoFlip(): void {
    senoCount++;
    youStreak = 0;
    const youCard = flipLead(you, 0);
    const cpuCard = flipLead(cpu, 1);
    repaintCenter();
    ctx.sfx('tap');
    mode = 'play';
    stuckSince = 0;
    paintHints();
    // めくりで出し切ったら上がり（同時なら先にあなたの勝ち）
    if (remaining(you) === 0) finish(true, youCard ?? undefined);
    else if (remaining(cpu) === 0) finish(false, cpuCard ?? undefined);
  }

  // ---- プレイヤー操作（タップで自動配置）----
  function onSlotTap(i: number): void {
    if (mode !== 'play' || hostPaused) return;
    const card = you.slots[i];
    if (!card) return;
    const opts: number[] = [];
    if (canTop(card, 0)) opts.push(0);
    if (canTop(card, 1)) opts.push(1);
    const el = youSlotEls[i];
    if (opts.length === 0) {
      // 出せない: ぷるっと振って教える（ペナルティなし）
      if (el) {
        el.classList.remove('sp-shake');
        void el.offsetWidth;
        el.classList.add('sp-shake');
      }
      return;
    }
    let pile = opts[0] ?? 0;
    if (opts.length === 2) {
      // 両方出せる: 次につながる台を1手先読みで選ぶ（同点ならランダム）
      const a = followUps(you, i, card, 0);
      const b = followUps(you, i, card, 1);
      pile = a > b ? 0 : b > a ? 1 : ctx.random() < 0.5 ? 0 : 1;
    }
    playCard('you', i, pile);
  }

  // ---- CPU ----
  function cpuDelay(): number {
    const d = CPU_DELAY[config.level];
    return d.min + ctx.random() * d.range;
  }

  function pickCpuMove(moves: MoveOpt[]): MoveOpt {
    if (config.level === 'hard') {
      // つよい: 出した後に自分の後続手が多くなる台を選ぶ
      let best = moves[0] as MoveOpt;
      let bestScore = -1;
      for (const m of moves) {
        const c = cpu.slots[m.slot];
        if (!c) continue;
        const sc = followUps(cpu, m.slot, c, m.pile);
        if (sc > bestScore) {
          bestScore = sc;
          best = m;
        }
      }
      return best;
    }
    return moves[Math.floor(ctx.random() * moves.length)] as MoveOpt;
  }

  // ---- 勝敗 ----
  function finish(youWin: boolean, lastCard?: Card): void {
    if (mode === 'over') return;
    mode = 'over';
    won = youWin;
    const now = ctx.now();
    finishAt = now;
    overEndAt = now + OVER_WAIT;
    paintHints();
    if (youWin) {
      ctx.achieve('first-win');
      if (config.level === 'hard') ctx.achieve('beat-hard');
      if (now - matchStart <= 45_000) ctx.achieve('speed-45');
      if (senoCount === 0) ctx.achieve('no-seno');
      if (lastCard && isJoker(lastCard)) ctx.achieve('joker-fin');
      showCenter('かち！', 'sp-win', OVER_WAIT - 100);
      ctx.sfx('success');
      ctx.haptic('success');
    } else {
      showCenter('まけ…', 'sp-lose', OVER_WAIT - 100);
      ctx.sfx('fail');
      ctx.haptic('error');
    }
  }

  function computeScore(): number {
    const played = initialCount - remaining(you);
    let score = played * 4;
    if (won) {
      const secs = Math.floor((finishAt - matchStart) / 1000);
      score += WIN_BONUS + Math.max(0, TIME_BONUS_FROM - secs) * 2;
    }
    return score;
  }

  // ---- 毎フレーム ----
  const offFrame = ctx.onFrame(() => {
    const now = ctx.now();

    // 一時表示の片づけ
    for (let i = floats.length - 1; i >= 0; i--) {
      const f = floats[i];
      if (f && now >= f.until) {
        f.el.remove();
        floats.splice(i, 1);
      }
    }

    if (mode === 'count') {
      countdown.tick(now);
      return;
    }
    if (mode === 'seno') {
      if (now >= senoFlipAt) doSenoFlip();
      return;
    }
    if (mode === 'over') {
      if (now >= overEndAt && !ended) {
        ended = true;
        ctx.end({ score: computeScore() });
      }
      return;
    }
    if (mode !== 'play') return;

    // タイマー表示（0.1秒刻みで更新）
    const tenth = Math.floor((now - matchStart) / 100);
    if (tenth !== shownTenth && timeEl) {
      shownTenth = tenth;
      timeEl.textContent = (tenth / 10).toFixed(1);
    }

    // CPU: 出せる手ができたら反応時間をセットし、期限が来たら実行（実行時に再検証）
    const cpuMoves = listMoves(cpu);
    if (cpuMoves.length === 0) {
      cpuNextAt = 0;
    } else if (cpuNextAt === 0) {
      cpuNextAt = now + cpuDelay();
    } else if (now >= cpuNextAt) {
      cpuNextAt = 0;
      if (config.level === 'easy' && ctx.random() < 0.25) {
        cpuNextAt = now + 900; // よわい: たまに見送る
      } else {
        const mv = pickCpuMove(cpuMoves);
        playCard('cpu', mv.slot, mv.pile);
      }
    }

    // 手詰まり判定 → せーの
    const youCan = listMoves(you).length > 0;
    if (!youCan && cpuMoves.length === 0) {
      if (stuckSince === 0) stuckSince = now;
      else if (now - stuckSince >= STUCK_WAIT) enterSeno(now);
    } else {
      stuckSince = 0;
    }
  });

  // ---- 起動 ----
  showSetup();

  return {
    start() {
      // startMode:'immediate' なので即呼ばれる。設定画面から開始する
    },
    pause() {
      // 期限はすべて ctx.now 基準（ポーズ中は進まない）。入力だけ防御的に締める
      hostPaused = true;
    },
    resume() {
      hostPaused = false;
    },
    resize() {
      // レイアウトはCSS（%とclamp）で追従
    },
    destroy() {
      offFrame();
      style.remove();
      wrap.remove();
    },
  };
}

// =============================================================
// スタイル（.sp- プレフィックス / テーマ変数があれば利用）
// =============================================================
const CSS = `
.sp-wrap{position:absolute;inset:0;display:flex;flex-direction:column;padding:10px 12px;box-sizing:border-box;
  user-select:none;-webkit-user-select:none;overflow:hidden}
.sp-h2{margin:0 0 14px;font-size:20px;text-align:center}
.sp-setup{margin:auto;width:min(88vw,340px);display:flex;flex-direction:column;gap:12px}
.sp-seg-row{display:flex;flex-direction:column;gap:6px}
.sp-seg-label{font-size:13px;color:var(--text-dim,#8b93a8)}
.sp-seg{display:flex;gap:6px}
.sp-seg-btn{flex:1;padding:10px 4px;border-radius:12px;border:2px solid var(--text-dim,#8b93a8);
  background:transparent;color:inherit;font-weight:700;font-size:14px;min-height:44px}
.sp-seg-btn.sp-on{border-color:#38bdf8;background:rgba(56,189,248,.16)}
.sp-note{font-size:12px;color:var(--text-dim,#8b93a8);margin:0;text-align:center}
.sp-btn{padding:12px;border-radius:14px;border:none;background:rgba(128,128,160,.22);color:inherit;font-weight:800;font-size:16px}
.sp-btn-primary{background:linear-gradient(135deg,#3b82f6,#22d3ee);color:#fff}
.sp-btn-lg{padding:14px;font-size:18px}

.sp-hud{display:flex;justify-content:center;padding:2px 60px 0 60px}
.sp-time{font-variant-numeric:tabular-nums;font-weight:800;font-size:16px;color:var(--text-dim,#8b93a8)}
.sp-board{flex:1;display:flex;flex-direction:column;justify-content:space-evenly;position:relative}
.sp-label{text-align:center;font-size:12px;color:var(--text-dim,#8b93a8)}
.sp-row{display:flex;gap:10px;align-items:center;justify-content:center}
.sp-slots{display:flex;gap:8px}
.sp-mid{display:flex;gap:22px;justify-content:center;align-items:center}

.sp-card{width:min(17.5vw,72px);aspect-ratio:5/7;border-radius:10px;background:#fff;color:#16181f;
  border:2px solid rgba(20,20,40,.18);display:flex;flex-direction:column;align-items:center;justify-content:center;
  gap:2px;font-weight:800;padding:0;position:relative;box-shadow:0 2px 6px rgba(0,0,0,.18)}
button.sp-card{cursor:pointer;-webkit-tap-highlight-color:transparent}
.sp-rank{font-size:clamp(18px,6vw,26px);line-height:1}
.sp-suit{font-size:clamp(13px,4.2vw,18px);line-height:1}
.sp-red{color:#dc2626}
.sp-joker .sp-rank{font-size:clamp(22px,7vw,30px)}
.sp-joker .sp-suit{font-size:9px;letter-spacing:1px}
.sp-back{background:repeating-linear-gradient(45deg,#5b6cd9 0 6px,#4a58c0 6px 12px);border-color:#3b478f}
.sp-empty{background:transparent;border-style:dashed;border-color:var(--text-dim,#8b93a8);box-shadow:none;opacity:.45}
.sp-count{position:absolute;bottom:-7px;right:-7px;background:#16181f;color:#fff;border-radius:999px;
  font-size:12px;font-weight:800;padding:2px 8px;border:2px solid #fff}
.sp-can{box-shadow:0 0 0 3px #fbbf24,0 0 16px rgba(251,191,36,.55)}

@keyframes sp-in-you{from{transform:translateY(44px) scale(.72);opacity:.3}to{transform:none;opacity:1}}
@keyframes sp-in-cpu{from{transform:translateY(-44px) scale(.72);opacity:.3}to{transform:none;opacity:1}}
.sp-in-you{animation:sp-in-you .18s ease-out}
.sp-in-cpu{animation:sp-in-cpu .18s ease-out}
@keyframes sp-pop{from{transform:scale(.55);opacity:0}to{transform:none;opacity:1}}
.sp-pop{animation:sp-pop .18s ease-out}
@keyframes sp-shake{0%,100%{transform:none}25%{transform:translateX(-6px)}75%{transform:translateX(6px)}}
.sp-shake{animation:sp-shake .22s ease-in-out}

.sp-center{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;
  font-weight:900;text-shadow:0 2px 10px rgba(0,0,0,.45);animation:sp-pop .22s ease-out;z-index:5}
.sp-count-num{font-size:64px;color:#fff}
.sp-go{font-size:40px;color:#fbbf24}
.sp-seno{font-size:38px;color:#fff}
.sp-combo{font-size:24px;color:#fbbf24;align-items:flex-end;padding-bottom:26vh}
.sp-win{font-size:46px;color:#4ade80}
.sp-lose{font-size:44px;color:#f87171}
`;
