// =============================================================
// さいごの とびら（No.130・かくれゲーム）: 純ロジック（3つの 試練）
// =============================================================
// - 130本の しめくくり。3つの とびらを 順に あける。
//   第1「せいかくさ」＝ちぢむ わを ねらった はばで 止める
//   第2「きおく」＝光った マスを 思い出す
//   第3「ひらめき」＝合計が お題に なる 2まいを えらぶ
// - どの試練も 判定は 純関数＝ぶれない。第3の 出題は「合う 2まいの くみが
//   ちょうど 1くみ」に なることを 確かめてから 出す。
// - ほかのゲームの コードは 一切 import しない（契約どおり・この中で 自作している）。
// - DOM 非依存・rng 注入＝決定論。
// =============================================================

/** とびらの 数 */
export const DOORS = 3;
/** 1つの とびらに ある 試練の 数 */
export const PER_DOOR = 3;
/** ライフ */
/**
 * 1つの試練に ちょうせんできる 回数。
 * ★ライフ制（通しで3回まで）を やめた理由: 130本の しめくくりなのに、
 *   第1のとびらの 3つ目（ねらえる時間 161ms）で つまずくと ライフを 使いきって
 *   第2・第3の とびらを 一度も 見られずに 終わってしまっていた。
 *   いまは 試練ごとに 2回まで ちょうせんし、2回 しっぱいしても つぎへ すすむ
 *   ＝**9つの試練を ぜんぶ 体験できる**。しっぱいの 代償は その試練の 点（と実績）。
 */
export const TRIES = 2;

export const DOOR_NAMES = ['せいかくさの とびら', 'きおくの とびら', 'ひらめきの とびら'];

// ---------- 第1の試練: ちぢむ わ ----------
export interface RingTrial {
  /** わが ゼロに なるまでの 時間（ミリ秒） */
  totalMs: number;
  /** 止めたい はば（わの 半径） */
  bandLo: number;
  bandHi: number;
}

export const RING_R0 = 124;

export const RINGS: RingTrial[] = [
  { totalMs: 2700, bandLo: 26, bandHi: 48 },
  { totalMs: 2300, bandLo: 28, bandHi: 43 },
  { totalMs: 2000, bandLo: 30, bandHi: 40 },
];

/** その時こくの わの 半径 */
export function ringRadius(elapsedMs: number, totalMs: number): number {
  const t = Math.max(0, Math.min(1, elapsedMs / totalMs));
  return RING_R0 * (1 - t);
}

/** はばの 中に 入っているか */
export function ringOk(r: number, tr: RingTrial): boolean {
  return r >= tr.bandLo && r <= tr.bandHi;
}

// ---------- 第2の試練: きおく ----------
export const MEM_CELLS = 9;
export const MEM_COUNT = [4, 5, 6];
/** 見せている 時間（ミリ秒） */
export const MEM_SHOW_MS = [1700, 1700, 1800];
/**
 * 第2の試練で こたえる 時間。
 * ★これが 無いと、思い出せずに 手が 止まった人の ゲームが **永久に 終わらない**
 *   （第1は わが 縮みきる・第3は SUM_MS で 時間切れに なるのに、ここだけ 無かった）。
 *   おぼえるマスは 4〜6こなので、1こ 3秒以上 使える 長さに してある。
 */
export const MEM_INPUT_MS = 20000;

export function makeMemory(rng: () => number, n: number): number[] {
  const pool: number[] = [];
  for (let i = 0; i < MEM_CELLS; i++) pool.push(i);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = pool[i]!;
    pool[i] = pool[j]!;
    pool[j] = t;
  }
  return pool.slice(0, n).sort((a, b) => a - b);
}

// ---------- 第3の試練: ひらめき（合計が お題に なる 2まい） ----------
export interface SumQuiz {
  nums: number[];
  target: number;
  /** こたえの くみ（nums の ばんごう） */
  pair: [number, number];
}

export const SUM_CARDS = 6;
/** 1もんの もちじかん（ミリ秒） */
export const SUM_MS = 20000;

/** その ならびで 合計が target に なる くみの 数 */
export function countPairs(nums: number[], target: number): number {
  let c = 0;
  for (let i = 0; i < nums.length; i++) {
    for (let j = i + 1; j < nums.length; j++) {
      if (nums[i]! + nums[j]! === target) c++;
    }
  }
  return c;
}

/**
 * 出題を作る。合計が お題に なる くみが **ちょうど 1くみ** の ものだけ 通す。
 */
export function makeSumQuiz(rng: () => number, maxNum: number): SumQuiz {
  for (let attempt = 0; attempt < 800; attempt++) {
    const nums: number[] = [];
    for (let i = 0; i < SUM_CARDS; i++) nums.push(1 + Math.floor(rng() * maxNum));
    const i = Math.floor(rng() * SUM_CARDS);
    let j = Math.floor(rng() * (SUM_CARDS - 1));
    if (j >= i) j++;
    const target = nums[i]! + nums[j]!;
    if (countPairs(nums, target) !== 1) continue;
    return { nums, target, pair: i < j ? [i, j] : [j, i] };
  }
  // ここに来ることは まず無い
  const nums = [1, 2, 4, 8, 16, 32];
  return { nums, target: 3, pair: [0, 1] };
}

export const SUM_MAX = [9, 12, 15];

// ---------- 点 ----------
/** 1つの 試練を 通したときの 点（あとの とびらほど 高い） */
export function trialPoints(door: number): number {
  return 90 + door * 20;
}

/** 3つの とびら ぜんぶ あけた ときの ボーナス */
export const ALL_BONUS = 250;

/** 満点 */
export function maxScore(): number {
  let s = ALL_BONUS;
  for (let d = 0; d < DOORS; d++) s += trialPoints(d) * PER_DOOR;
  return s;
}
