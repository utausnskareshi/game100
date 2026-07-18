// =============================================================
// ゆうびんやさんの おとどけ（No.68）のラウンド生成（DOM非依存・純ロジック）
// =============================================================
// - どうぶつたちが それぞれの おうちに入るのを見て覚え、そのあと届く手紙
//   （どうぶつの顔つき封筒）を 正しいおうちへ配達する「対応づけ」記憶。
// - ラウンド生成＝使うおうち・どうぶつ・割当（全単射）・手紙の順番を rng で決める
//   （ctx.random 注入＝日替わりは全員同じ問題）。
// - import してよいのは game-api と同一フォルダのみ（このファイルは依存なし）。

/** ラウンドごとのペア数（全5ラウンド・ふつう難易度のゆるやかなランプ） */
export const ROUND_PAIRS = [3, 4, 4, 5, 6] as const;
export const LIVES = 3;
export const DELIVER_PTS = 30;
export const ROUND_BONUS = 40;
export const PERFECT_BONUS = 30;

/** 理論最大 = 手紙22通×30 + (40+30)×5 = 1010 */
export function maxScore(): number {
  const letters = ROUND_PAIRS.reduce((a, b) => a + b, 0);
  return letters * DELIVER_PTS + ROUND_PAIRS.length * (ROUND_BONUS + PERFECT_BONUS);
}

/** 村のおうちスロット（最大6軒ぶんの固定レイアウト・Canvas 360×640想定） */
export interface HouseSlot {
  x: number; // 家の中心
  y: number; // 家の底辺
  color: string;
  roof: 'tri' | 'round' | 'flat';
}

export const HOUSE_SLOTS: HouseSlot[] = [
  { x: 70, y: 208, color: '#e0736a', roof: 'tri' },
  { x: 180, y: 190, color: '#5b9fe0', roof: 'round' },
  { x: 292, y: 210, color: '#66bb6a', roof: 'flat' },
  { x: 66, y: 340, color: '#c99bf0', roof: 'round' },
  { x: 182, y: 326, color: '#e8b23c', roof: 'flat' },
  { x: 294, y: 344, color: '#4fc3c7', roof: 'tri' },
];

export const ANIMALS = ['🐶', '🐱', '🐰', '🐻', '🦊', '🐼', '🐸', '🐷', '🐨', '🐭'] as const;

export interface Round {
  /** 使うおうち（HOUSE_SLOTS の index・pairs 軒） */
  houses: number[];
  /** 使うどうぶつ（ANIMALS の index・pairs 匹） */
  animals: number[];
  /** assignment[k] = animals[k] が入る houses の添字k → houses[k]（見せる順は k 順） */
  /** 手紙が届く順（0..pairs-1 の順列。animals の添字） */
  letterOrder: number[];
}

/** 0..n-1 の順列を rng で作る（Fisher-Yates） */
export function shuffled(n: number, rng: () => number): number[] {
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = a[i]!;
    a[i] = a[j]!;
    a[j] = t;
  }
  return a;
}

/**
 * ラウンドを生成する。houses[k] に animals[k] が住む（k=見せる順）。
 * 手紙は letterOrder の順で「animals[letterOrder[i]] あての手紙」が届く。
 */
export function makeRound(roundIdx: number, rng: () => number): Round {
  const pairs = ROUND_PAIRS[Math.min(roundIdx, ROUND_PAIRS.length - 1)]!;
  const houses = shuffled(HOUSE_SLOTS.length, rng).slice(0, pairs);
  const animals = shuffled(ANIMALS.length, rng).slice(0, pairs);
  const letterOrder = shuffled(pairs, rng);
  return { houses, animals, letterOrder };
}
