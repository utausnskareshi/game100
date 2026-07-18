// =============================================================
// てんびんばかりの なぞとき（No.72）の重さと採点（DOM非依存・純ロジック）
// =============================================================
// - 見た目がそっくりな はこたちの「かくれた重さ」を、てんびんで2つずつ
//   くらべて推理する。R1=4こから いちばん重いもの / R2=4こ並べ替え / R3=5こ並べ替え。
// - はかる回数の「めやす」（par）以内で正解するとボーナス満点。
//   par は R1=3（トーナメント）/ R2=5・R3=8（二分挿入で到達可能）＝理不尽なし。
// - 重さは 1..n の順列を rng で並べたもの（ctx.random 注入＝日替わり同一）。
// - import してよいのは game-api と同一フォルダのみ（このファイルは依存なし）。

export const ROUNDS = 3;
export const ITEM_COUNTS = [4, 4, 5] as const;
export const PARS = [3, 5, 8] as const;
export const CORRECT_PTS = 100;
export const WRONG_PTS = 30;
export const PAR_BONUS_MAX = 60;
export const OVER_PENALTY = 12;
/** 理論最大 = (100+60)×3 = 480 */
export const MAX_SCORE = ROUNDS * (CORRECT_PTS + PAR_BONUS_MAX);

export interface ItemDef {
  name: string;
  color: string;
  ribbon: string;
}

export const ITEMS: ItemDef[] = [
  { name: 'あか', color: '#e05a4e', ribbon: '#8a2a20' },
  { name: 'あお', color: '#4a8de0', ribbon: '#1e4a8a' },
  { name: 'きいろ', color: '#e8b23c', ribbon: '#98701e' },
  { name: 'みどり', color: '#66bb6a', ribbon: '#2a6a2e' },
  { name: 'むらさき', color: '#a06ae0', ribbon: '#5a2a8a' },
];

/** そのラウンドのかくれた重さ（1..n の順列。大きいほど重い） */
export function makeWeights(n: number, rng: () => number): number[] {
  const w = Array.from({ length: n }, (_, i) => i + 1);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = w[i]!;
    w[i] = w[j]!;
    w[j] = t;
  }
  return w;
}

/** a と b をくらべて 重いほうの index を返す（重さは順列なので同じにならない） */
export function heavier(weights: number[], a: number, b: number): number {
  return (weights[a] ?? 0) >= (weights[b] ?? 0) ? a : b;
}

/** 重い順の index 列（こたえ） */
export function correctOrder(weights: number[]): number[] {
  return weights
    .map((w, i) => ({ w, i }))
    .sort((x, y) => y.w - x.w)
    .map((x) => x.i);
}

/** par 以内なら満点ボーナス・超えるたびに減点（floor 0） */
export function parBonus(weighs: number, par: number): number {
  return Math.max(0, PAR_BONUS_MAX - OVER_PENALTY * Math.max(0, weighs - par));
}

/** そのラウンドの「こたえスロット数」（R1は1つ＝いちばん重いもの） */
export function answerSlots(roundIdx: number): number {
  return roundIdx === 0 ? 1 : ITEM_COUNTS[roundIdx] ?? 4;
}

/** こたえの判定 */
export function isCorrect(roundIdx: number, weights: number[], answer: number[]): boolean {
  const order = correctOrder(weights);
  if (roundIdx === 0) return answer[0] === order[0];
  if (answer.length !== order.length) return false;
  return answer.every((a, i) => a === order[i]);
}
