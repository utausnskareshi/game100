// =============================================================
// ソリティア（No.56・クロンダイク）の純ロジック（DOM非依存・乱数注入）
// =============================================================
// - カード: rank 1..13（1=A / 11=J / 12=Q / 13=K）・suit 0..3（0♠ 1♥ 2♦ 3♣）。赤=♥♦。
// - 場札(tableau)7列は「色ちがい・1つずつ小さく」重ねる。組札(foundation)4つは同スートをA→K。
// - シャッフル・配りは rng 注入（ctx.random＝日替わりは全員同じ配り）。
// - import してよいのは game-api（types/helpers）と同一フォルダのみ（このファイルは依存なし）。

export interface Card {
  rank: number; // 1..13
  suit: number; // 0..3
  up: boolean; // 表向きか
}

export const SUIT_CHARS = ['♠', '♥', '♦', '♣'];
export const RANK_CHARS = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

export const isRed = (c: Card): boolean => c.suit === 1 || c.suit === 2;

export interface GameState {
  stock: Card[]; // 山札（表示は裏・末尾が一番上）
  waste: Card[]; // めくり札（表・末尾が一番上）
  foundations: Card[][]; // 4つ（index=suit で使う運用にはしない。空きに置ける仕組み）
  tableau: Card[][]; // 7列（末尾が手前）
}

export function makeDeck(): Card[] {
  const d: Card[] = [];
  for (let suit = 0; suit < 4; suit++) {
    for (let rank = 1; rank <= 13; rank++) d.push({ rank, suit, up: false });
  }
  return d;
}

/** Fisher-Yates（rng 注入・破壊的） */
export function shuffle(deck: Card[], rng: () => number): void {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = deck[i]!;
    deck[i] = deck[j]!;
    deck[j] = t;
  }
}

/** クロンダイク初期配置。tableau 列 i に i+1 枚（末尾のみ表）。残り24枚は stock（裏）。 */
export function deal(rng: () => number): GameState {
  const deck = makeDeck();
  shuffle(deck, rng);
  const tableau: Card[][] = [[], [], [], [], [], [], []];
  let p = 0;
  for (let col = 0; col < 7; col++) {
    for (let k = 0; k <= col; k++) {
      const c = deck[p++]!;
      c.up = k === col;
      tableau[col]!.push(c);
    }
  }
  const stock: Card[] = [];
  while (p < deck.length) {
    const c = deck[p++]!;
    c.up = false;
    stock.push(c);
  }
  return { stock, waste: [], foundations: [[], [], [], []], tableau };
}

/** card を foundation 列 f に置けるか（同スートを A から順に） */
export function canToFoundation(card: Card, foundation: Card[]): boolean {
  if (foundation.length === 0) return card.rank === 1;
  const top = foundation[foundation.length - 1]!;
  return top.suit === card.suit && card.rank === top.rank + 1;
}

/** card（列の先頭カード）を tableau の dest 列に置けるか（空きは K のみ・以外は色ちがいで1小さい） */
export function canToTableau(card: Card, dest: Card[]): boolean {
  if (dest.length === 0) return card.rank === 13;
  const top = dest[dest.length - 1]!;
  if (!top.up) return false;
  return isRed(card) !== isRed(top) && card.rank === top.rank - 1;
}

/** 表向きカードの並びが「色ちがい・1つずつ小さく」の正しいランか（複数枚移動の可否） */
export function isValidRun(cards: Card[]): boolean {
  for (let i = 0; i < cards.length; i++) {
    if (!cards[i]!.up) return false;
    if (i > 0) {
      const a = cards[i - 1]!;
      const b = cards[i]!;
      if (!(isRed(a) !== isRed(b) && b.rank === a.rank - 1)) return false;
    }
  }
  return true;
}

/** 組札に乗っている総数（勝利・スコア用） */
export function foundationCount(s: GameState): number {
  return s.foundations.reduce((n, f) => n + f.length, 0);
}

export function isWin(s: GameState): boolean {
  return foundationCount(s) === 52;
}

export interface Move {
  /** 移動元: 'waste' | 'tableau' | null（手なし） */
  from: 'waste' | 'tableau';
  fromCol: number; // tableau のとき列 / waste のとき -1
  fromIndex: number; // tableau のとき掴む位置 / waste のとき -1
  /** 移動先: 'foundation' | 'tableau' */
  to: 'foundation' | 'tableau';
  toCol: number; // foundation/tableau の列 index
  count: number; // 動かす枚数
}

/**
 * 「タップしたカード」から 最善の自動移動を求める（子ども向けタップ移動）。
 * - waste 上札 / tableau の表向きカードを起点にする。
 * - 単札は 組札を優先→なければ場札。複数枚のランは 場札のみ（正しいランのときだけ）。
 * - 見つからなければ null。
 */
export function findAutoMove(s: GameState, from: 'waste' | 'tableau', col: number, index: number): Move | null {
  let group: Card[];
  if (from === 'waste') {
    if (s.waste.length === 0) return null;
    group = [s.waste[s.waste.length - 1]!];
    index = s.waste.length - 1;
    col = -1;
  } else {
    const pile = s.tableau[col];
    if (!pile || index < 0 || index >= pile.length || !pile[index]!.up) return null;
    group = pile.slice(index);
  }
  const head = group[0]!;
  const single = group.length === 1;

  // 単札なら組札を優先（4列のうち置けるところ）
  if (single) {
    for (let f = 0; f < 4; f++) {
      if (canToFoundation(head, s.foundations[f]!)) {
        return { from, fromCol: col, fromIndex: index, to: 'foundation', toCol: f, count: 1 };
      }
    }
  }
  // 複数枚は正しいランのときだけ動かせる
  if (!single && !isValidRun(group)) return null;
  // 場札へ（自分の列以外・左から。空き列へは K のみ）
  for (let t = 0; t < 7; t++) {
    if (from === 'tableau' && t === col) continue;
    if (canToTableau(head, s.tableau[t]!)) {
      // 「空き列へ、すでに一番下が K の1枚だけ」の無意味な移動は避ける
      if (from === 'tableau' && index === 0 && s.tableau[t]!.length === 0) continue;
      return { from, fromCol: col, fromIndex: index, to: 'tableau', toCol: t, count: group.length };
    }
  }
  return null;
}

/** 移動を適用（破壊的）。移動後、元の tableau 列の新しい一番上が裏なら表に返す */
export function applyMove(s: GameState, m: Move): Card[] {
  let moved: Card[];
  if (m.from === 'waste') {
    moved = s.waste.splice(s.waste.length - m.count, m.count);
  } else {
    moved = s.tableau[m.fromCol]!.splice(m.fromIndex, m.count);
  }
  if (m.to === 'foundation') s.foundations[m.toCol]!.push(...moved);
  else s.tableau[m.toCol]!.push(...moved);
  // めくり
  if (m.from === 'tableau') {
    const pile = s.tableau[m.fromCol]!;
    const top = pile[pile.length - 1];
    if (top && !top.up) top.up = true;
  }
  return moved;
}

/** 山札をめくる（1枚 waste へ）。空なら waste を裏返して山札に戻す（リサイクル）。戻り値: 'draw' | 'recycle' | 'none' */
export function drawStock(s: GameState): 'draw' | 'recycle' | 'none' {
  if (s.stock.length > 0) {
    const c = s.stock.pop()!;
    c.up = true;
    s.waste.push(c);
    return 'draw';
  }
  if (s.waste.length > 0) {
    while (s.waste.length > 0) {
      const c = s.waste.pop()!;
      c.up = false;
      s.stock.push(c);
    }
    return 'recycle';
  }
  return 'none';
}
