// =============================================================
// ババぬき（No.24）のロジック（DOM非依存・乱数注入）
// =============================================================
// - 52枚＋ジョーカー1枚。ジョーカー（rank 0）はぜったいにペアにならない。
// - stripPairs: 同じ数字を2枚ずつ捨てる（3枚なら1枚残る・4枚なら0枚）。
// - すべて注入 rng 由来＝「今日のゲーム」では全員同じ配札になる。
// - import してよいのは game-api（types/helpers）と同一フォルダのみ（このファイルは依存なし）。

export interface Card {
  /** 1..13（A=1, J=11, Q=12, K=13）。ジョーカーは 0 */
  rank: number;
  /** 0..3（♠♥♦♣）。ジョーカーは -1 */
  suit: number;
}

export const SUITS = ['♠', '♥', '♦', '♣'];

export function isJoker(c: Card): boolean {
  return c.rank === 0;
}

/** 52枚＋ジョーカーの53枚デッキ */
export function makeDeck53(): Card[] {
  const d: Card[] = [];
  for (let suit = 0; suit < 4; suit++) {
    for (let rank = 1; rank <= 13; rank++) d.push({ rank, suit });
  }
  d.push({ rank: 0, suit: -1 });
  return d;
}

export function shuffle(deck: Card[], rng: () => number): void {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const a = deck[i];
    const b = deck[j];
    if (a && b) {
      deck[i] = b;
      deck[j] = a;
    }
  }
}

/** 順ぐりに players 人へ配る（枚数は 18/18/17 のように±1枚） */
export function deal(deck: Card[], players: number): Card[][] {
  const hands: Card[][] = Array.from({ length: players }, () => []);
  deck.forEach((c, i) => hands[i % players]!.push(c));
  return hands;
}

/**
 * 同じ数字のペアを2枚ずつ取り除く（ジョーカーは残る）。
 * 返り値は「残った手札」と「捨てたペア数」。
 */
export function stripPairs(hand: Card[]): { hand: Card[]; removedPairs: number } {
  const byRank = new Map<number, Card[]>();
  for (const c of hand) {
    if (!byRank.has(c.rank)) byRank.set(c.rank, []);
    byRank.get(c.rank)!.push(c);
  }
  const out: Card[] = [];
  let removed = 0;
  for (const [rank, cards] of byRank) {
    if (rank === 0) {
      out.push(...cards); // ジョーカーはペアにしない
      continue;
    }
    const keep = cards.length % 2; // 偶数→0枚 / 奇数→1枚
    removed += (cards.length - keep) / 2;
    if (keep) out.push(cards[0]!);
  }
  return { hand: out, removedPairs: removed };
}

/**
 * 引いたカードが手札とペアになるなら、その相方の位置を返す（なければ -1）。
 * ジョーカーはぜったいにペアにならない。
 */
export function pairIndex(hand: Card[], drawn: Card): number {
  if (drawn.rank === 0) return -1;
  return hand.findIndex((c) => c.rank === drawn.rank);
}

/** 手札の表示順（ジョーカー→数字→マーク） */
export function sortHand(hand: Card[]): Card[] {
  return [...hand].sort((a, b) => a.rank - b.rank || a.suit - b.suit);
}
