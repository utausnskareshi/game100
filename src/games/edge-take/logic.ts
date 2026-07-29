// =============================================================
// はしから とる（No.124・かくれゲーム）: 純ロジック（対戦・完全解析）
// =============================================================
// - ならんだ数字の **両はしの どちらか** を こうたいで とる。合計が 多いほうが かち。
// - 独自ルール: **相手が 直前に とった数字と 同じ数字は とれない**。
//   （どちらの はしも とれないときは パス。つぎの人は 何でも とれる）
// - CPU は ミニマックスで **完全に 読みきる**（手加減なし）。
// - そのかわり 出題は「**先手（プレイヤー）が 最善を つくせば かならず 勝てる**」盤
//   だけを 通す＝ぜんぶ 勝てる。ただし 1手 まちがえると ひっくり返る。
// - DOM 非依存・rng 注入＝決定論。
// =============================================================

/** 1プレイの 試合数 */
export const LENGTHS = [8, 9, 10, 10];
export const MATCHES = LENGTHS.length;

/** 数字の はんい */
export const MIN_N = 1;
export const MAX_N = 9;

/** 勝ったときの 点（差では 変えない＝満点が いつも 同じ） */
export const WIN_PTS = 180;
export const DRAW_PTS = 60;
export const LOSE_PTS = 20;
/** ぜんぶ 勝ったときの ボーナス */
export const ALL_WIN_BONUS = 200;

export interface Match {
  nums: number[];
  /** 先手（プレイヤー）が 最善を つくしたときの 差（プラスなら 勝てる） */
  value: number;
}

/** ばんの じょうたい（のこっている はんい と きんし数字） */
export interface State {
  i: number;
  j: number;
  /** 相手が 直前に とった数字（0 は なし＝何でも とれる） */
  banned: number;
}

const keyOf = (s: State): number => (s.i * 16 + s.j) * 16 + s.banned;

/**
 * いまの 手番の人 から見た「これから つく 差」の 最善値。
 * 取れる はしが 無ければ パス（きんしは 解除されて 相手の手番）。
 */
export function bestValue(nums: number[], s: State, memo?: Map<number, number>): number {
  if (s.i > s.j) return 0;
  const m = memo ?? new Map<number, number>();
  const k = keyOf(s);
  const hit = m.get(k);
  if (hit !== undefined) return hit;
  let best = -Infinity;
  const left = nums[s.i]!;
  const right = nums[s.j]!;
  if (left !== s.banned) {
    best = Math.max(best, left - bestValue(nums, { i: s.i + 1, j: s.j, banned: left }, m));
  }
  if (s.j !== s.i && right !== s.banned) {
    best = Math.max(best, right - bestValue(nums, { i: s.i, j: s.j - 1, banned: right }, m));
  }
  if (best === -Infinity) {
    // どちらも とれない＝パス（つぎの人は 何でも とれる）
    best = -bestValue(nums, { i: s.i, j: s.j, banned: 0 }, m);
  }
  m.set(k, best);
  return best;
}

export type Move = 'L' | 'R' | 'pass';

/** いまの 手番の 最善手 */
export function bestMove(nums: number[], s: State, memo?: Map<number, number>): Move {
  if (s.i > s.j) return 'pass';
  const m = memo ?? new Map<number, number>();
  const left = nums[s.i]!;
  const right = nums[s.j]!;
  let best = -Infinity;
  let mv: Move = 'pass';
  if (left !== s.banned) {
    const v = left - bestValue(nums, { i: s.i + 1, j: s.j, banned: left }, m);
    if (v > best) {
      best = v;
      mv = 'L';
    }
  }
  if (s.j !== s.i && right !== s.banned) {
    const v = right - bestValue(nums, { i: s.i, j: s.j - 1, banned: right }, m);
    if (v > best) {
      best = v;
      mv = 'R';
    }
  }
  return mv;
}

/** とれる手が あるか */
export function canTake(nums: number[], s: State): boolean {
  if (s.i > s.j) return false;
  if (nums[s.i]! !== s.banned) return true;
  if (s.j !== s.i && nums[s.j]! !== s.banned) return true;
  return false;
}

/** 先手（プレイヤー）が 最善で つける 差 */
export function matchValue(nums: number[]): number {
  return bestValue(nums, { i: 0, j: nums.length - 1, banned: 0 });
}

/** ほしい 差の はんい（勝てるが 楽勝でもない・大差実績も とどく） */
export const VALUE_MIN = 4;
export const VALUE_MAX = 9;

/**
 * 試合を作る。「先手が 最善なら かならず 勝てる」盤だけ 通す。
 */
export function makeMatch(rng: () => number, len: number): Match {
  let fallback: Match | null = null;
  for (let attempt = 0; attempt < 600; attempt++) {
    const nums: number[] = [];
    for (let i = 0; i < len; i++) nums.push(MIN_N + Math.floor(rng() * (MAX_N - MIN_N + 1)));
    const value = matchValue(nums);
    if (value > 0 && (!fallback || value > fallback.value)) fallback = { nums, value };
    if (value < VALUE_MIN || value > VALUE_MAX) continue;
    return { nums, value };
  }
  return fallback ?? { nums: [9, 1, 1, 1], value: matchValue([9, 1, 1, 1]) };
}

export function makeMatches(rng: () => number): Match[] {
  return LENGTHS.map((n) => makeMatch(rng, n));
}

/** 試合の点 */
export function matchPoints(mine: number, theirs: number): number {
  if (mine > theirs) return WIN_PTS;
  if (mine === theirs) return DRAW_PTS;
  return LOSE_PTS;
}

/** 満点 */
export function maxScore(): number {
  return MATCHES * WIN_PTS + ALL_WIN_BONUS;
}
