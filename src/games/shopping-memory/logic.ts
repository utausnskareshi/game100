// =============================================================
// おつかいメモリー（No.48）の出題（DOM非依存・純ロジック）
// =============================================================
// - おつかいリスト（3→6品）をおぼえて、棚（12マス・ダミー入り）から同じ品を選ぶ。
// - 1ラウンドの乱数消費は 23回固定（棚12品の部分シャッフル12回＋並べ替え11回）
//   ＝日替わりで全員同じおつかい。
// - import してよいのは game-api（types/helpers）と同一フォルダのみ（このファイルは依存なし）。

export type Rng = () => number;

export interface Item {
  emoji: string;
  name: string;
}

/** しなもの図鑑（20種） */
export const POOL: Item[] = [
  { emoji: '🍎', name: 'りんご' },
  { emoji: '🍌', name: 'バナナ' },
  { emoji: '🥚', name: 'たまご' },
  { emoji: '🥛', name: 'ぎゅうにゅう' },
  { emoji: '🍞', name: 'パン' },
  { emoji: '🧀', name: 'チーズ' },
  { emoji: '🍅', name: 'トマト' },
  { emoji: '🥕', name: 'にんじん' },
  { emoji: '🍇', name: 'ぶどう' },
  { emoji: '🍓', name: 'いちご' },
  { emoji: '🐟', name: 'さかな' },
  { emoji: '🍙', name: 'おにぎり' },
  { emoji: '🍪', name: 'クッキー' },
  { emoji: '🍬', name: 'あめ' },
  { emoji: '🧃', name: 'ジュース' },
  { emoji: '🥦', name: 'ブロッコリー' },
  { emoji: '🌽', name: 'とうもろこし' },
  { emoji: '🍊', name: 'みかん' },
  { emoji: '🥔', name: 'じゃがいも' },
  { emoji: '🍦', name: 'アイス' },
];

/** 棚のマス数 */
export const SHELF_SIZE = 12;
/** ぜんぶで5ラウンド */
export const ROUNDS = 5;

/** ラウンド i のリスト品数: 3,4,4,5,6 */
export function listCountAt(i: number): number {
  return [3, 4, 4, 5, 6][Math.min(4, i)]!;
}

/** ラウンド i のリスト表示時間（ms）: 3200 → 2600 */
export function showMsAt(i: number): number {
  return [3200, 3200, 2800, 2800, 2600][Math.min(4, i)]!;
}

export interface RoundDef {
  /** おぼえる品（pool の index） */
  list: number[];
  /** 棚に並ぶ品（pool の index・12マス・list を含む） */
  shelf: number[];
}

/** 1ラウンドの出題（乱数消費は常に 12+11=23回） */
export function rollRound(rng: Rng, round: number): RoundDef {
  const n = listCountAt(round);
  // 部分Fisher-Yatesで棚の12品をえらぶ（先頭 n 品がリスト）
  const pool = POOL.map((_, i) => i);
  for (let i = 0; i < SHELF_SIZE; i++) {
    const j = i + Math.min(pool.length - 1 - i, Math.floor(rng() * (pool.length - i)));
    const t = pool[i]!;
    pool[i] = pool[j]!;
    pool[j] = t;
  }
  const picked = pool.slice(0, SHELF_SIZE);
  const list = picked.slice(0, n);
  // 棚の並びをシャッフル（リスト品が先頭に固まらないように）
  const shelf = picked.slice();
  for (let i = SHELF_SIZE - 1; i >= 1; i--) {
    const j = Math.min(i, Math.floor(rng() * (i + 1)));
    const t = shelf[i]!;
    shelf[i] = shelf[j]!;
    shelf[j] = t;
  }
  return { list, shelf };
}

/** ラウンド得点: 品数×20 + ミスなし20 + はやさ max(0,15-秒)×2 */
export function roundScore(listCount: number, sec: number, misses: number): number {
  return listCount * 20 + (misses === 0 ? 20 : 0) + Math.max(0, 15 - sec) * 2;
}
