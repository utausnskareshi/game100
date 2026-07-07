// =============================================================
// スピード: 純ロジック（カード・デッキ・出せる判定）
// =============================================================
// DOMや時間には依存しない。乱数は呼び出し側から注入する（ctx.random）。

export type Suit = 'S' | 'H' | 'D' | 'C' | 'X'; // X = ジョーカー

export interface Card {
  /** 1(A)〜13(K)。ジョーカーは 0 */
  rank: number;
  suit: Suit;
}

export interface Rules {
  /** ±1に加えて「同じ数字」も重ねられる */
  sameRank: boolean;
  /** 各自ジョーカー1枚（何にでも重ねられ、何でも重なる） */
  joker: boolean;
}

export const RANK_LABEL = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'] as const;

export const SUIT_GLYPH: Record<Suit, string> = { S: '♠', H: '♥', D: '♦', C: '♣', X: '🃏' };

export function isRed(card: Card): boolean {
  return card.suit === 'H' || card.suit === 'D';
}

export function isJoker(card: Card): boolean {
  return card.suit === 'X';
}

/** top の上に card を出せるか（K⇔Aは常にループ扱い） */
export function canPlace(card: Card, top: Card, rules: Rules): boolean {
  if (isJoker(card) || isJoker(top)) return true;
  const d = Math.abs(card.rank - top.rank);
  if (d === 1 || d === 12) return true; // となりの数字（AとKもつながる）
  return rules.sameRank && d === 0;
}

/** 片側のデッキ（赤=♥♦ / 黒=♠♣ の26枚＋ジョーカー任意）をシャッフルして返す */
export function buildDeck(color: 'red' | 'black', joker: boolean, random: () => number): Card[] {
  const suits: Suit[] = color === 'red' ? ['H', 'D'] : ['S', 'C'];
  const deck: Card[] = [];
  for (const s of suits) {
    for (let r = 1; r <= 13; r++) deck.push({ rank: r, suit: s });
  }
  if (joker) deck.push({ rank: 0, suit: 'X' });
  // Fisher–Yates
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const a = deck[i];
    const b = deck[j];
    if (a && b) {
      deck[i] = b;
      deck[j] = a;
    }
  }
  return deck;
}
