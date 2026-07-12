// =============================================================
// ぺあさがし（No.21）のロジック（DOM非依存・乱数注入）
// =============================================================
// - buildDeck: 絵柄プールから pairs 種をえらび、2枚ずつにしてシャッフルした山を返す。
//   すべて注入 rng 由来＝「今日のゲーム」では全員同じ盤になる。
// - import してよいのは game-api（types/helpers）と同一フォルダのみ（このファイルは依存なし）。

/** カードの絵柄プール（こども向け・見分けやすい絵文字。最大18ペアぶん以上） */
export const FACE_POOL: string[] = [
  '🍎', '🍌', '🍇', '🍓', '🍊', '🍉', '🍑', '🥝', '🍍', '🥕', '🌽', '🍅',
  '🐶', '🐱', '🐼', '🐸', '🐷', '🐰', '🦁', '🐢', '🐟', '🐝', '🦋', '🌻',
];

function shuffle(arr: string[], rng: () => number): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const a = arr[i];
    const b = arr[j];
    if (a !== undefined && b !== undefined) {
      arr[i] = b;
      arr[j] = a;
    }
  }
}

/**
 * pairs 種 × 2枚 のシャッフル済みデッキを作る（deck[i] = そのマスの絵柄）。
 * 同じ絵柄がちょうど2回ずつ現れることを保証する。
 */
export function buildDeck(rng: () => number, pairs: number): string[] {
  const pool = FACE_POOL.slice();
  shuffle(pool, rng);
  const faces = pool.slice(0, Math.min(pairs, pool.length));
  const deck: string[] = [];
  for (const f of faces) deck.push(f, f);
  shuffle(deck, rng);
  return deck;
}
