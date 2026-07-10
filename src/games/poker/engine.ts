// =============================================================
// ポーカー（No.12・ドローポーカー）の純ロジック（DOM非依存・乱数注入）
// =============================================================
// - 52枚デッキ・シャッフル（rng注入＝日替わりは全員同じ配札）
// - evaluate: 5枚の手札の「役」を判定して 0(ノーペア)〜9(ロイヤル) のカテゴリを返す
// - import してよいのは game-api（types/helpers）と同一フォルダのみ（このファイルは依存なし）

export interface Card {
  /** 2..14（11=J / 12=Q / 13=K / 14=A） */
  rank: number;
  /** 0..3（♠♥♦♣） */
  suit: number;
}

export const SUITS = ['♠', '♥', '♦', '♣'];

/** 役カテゴリ名（index = evaluate().cat） */
export const CAT_NAMES = [
  'ノーペア',
  'ワンペア',
  'ツーペア',
  'スリーカード',
  'ストレート',
  'フラッシュ',
  'フルハウス',
  'フォーカード',
  'ストレートフラッシュ',
  'ロイヤルストレートフラッシュ',
];

export interface HandResult {
  cat: number;
  name: string;
}

export function makeDeck(): Card[] {
  const d: Card[] = [];
  for (let suit = 0; suit < 4; suit++) {
    for (let rank = 2; rank <= 14; rank++) d.push({ rank, suit });
  }
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

/** 5枚の手札の役を判定する */
export function evaluate(cards: Card[]): HandResult {
  const ranks = cards.map((c) => c.rank).sort((a, b) => a - b);
  const suits = cards.map((c) => c.suit);
  const isFlush = suits.every((s) => s === suits[0]);

  const uniq = [...new Set(ranks)].sort((a, b) => a - b);
  let isStraight = false;
  let straightHigh = 0;
  if (uniq.length === 5) {
    const lo = uniq[0] ?? 0;
    const hi = uniq[4] ?? 0;
    if (hi - lo === 4) {
      isStraight = true;
      straightHigh = hi;
    } else if (uniq[0] === 2 && uniq[1] === 3 && uniq[2] === 4 && uniq[3] === 5 && uniq[4] === 14) {
      // A-2-3-4-5（ホイール）＝A を1として扱う最小のストレート
      isStraight = true;
      straightHigh = 5;
    }
  }

  const countMap = new Map<number, number>();
  for (const r of ranks) countMap.set(r, (countMap.get(r) ?? 0) + 1);
  const counts = [...countMap.values()].sort((a, b) => b - a);
  const c0 = counts[0] ?? 0;
  const c1 = counts[1] ?? 0;

  let cat: number;
  if (isStraight && isFlush) cat = straightHigh === 14 ? 9 : 8;
  else if (c0 === 4) cat = 7;
  else if (c0 === 3 && c1 === 2) cat = 6;
  else if (isFlush) cat = 5;
  else if (isStraight) cat = 4;
  else if (c0 === 3) cat = 3;
  else if (c0 === 2 && c1 === 2) cat = 2;
  else if (c0 === 2) cat = 1;
  else cat = 0;

  return { cat, name: CAT_NAMES[cat] ?? '' };
}
