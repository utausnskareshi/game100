// =============================================================
// さかさま おぼえ（No.117・かくれゲーム）: 純ロジック（出題）
// =============================================================
// - 光った じゅんばんを おぼえて、**さいごから 逆に** こたえる。
//   #14 おぼえてピアノ は「同じ順」。逆順は 前から 思い出せないので、
//   頭の使い方が まったく ちがう（数唱の 逆スパン）。
// - 長さは 3 → 7 と のびていく。
// - DOM 非依存・rng 注入＝決定論。
// =============================================================

/** ボタンの数 */
export const PADS = 6;

/** 各ラウンドの 長さ */
export const LENGTHS = [3, 4, 4, 5, 5, 6, 6, 7];
export const ROUNDS = LENGTHS.length;

/** 1つ 光っている 時間 と すきま（ミリ秒） */
export const SHOW_ON = 520;
export const SHOW_GAP = 180;
/** 見せはじめるまでの ま */
export const START_DELAY = 800;
/** こたえる 時間（ミリ秒）。長いほど 長くなる */
export function inputMs(len: number): number {
  return 4000 + len * 1600;
}

/**
 * 光る じゅんばんを作る。
 * 同じボタンが 続けて 光ると「1回か 2回か」が 分かりにくいので さける。
 */
export function makeSeq(rng: () => number, len: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < len; i++) {
    let v = Math.floor(rng() * (i === 0 ? PADS : PADS - 1));
    const prev = out[i - 1];
    if (prev !== undefined && v >= prev) v++;
    out.push(v);
  }
  return out;
}

/** 1プレイぶん */
export function makeSeqs(rng: () => number): number[][] {
  return LENGTHS.map((n) => makeSeq(rng, n));
}

/** 逆にした こたえ */
export function reversed(seq: number[]): number[] {
  return seq.slice().reverse();
}

/** そのラウンドの点（長いほど 高い） */
export function roundPoints(len: number): number {
  return len * 30;
}

/** 満点 */
export function maxScore(): number {
  return LENGTHS.reduce((a, n) => a + roundPoints(n), 0);
}

/** 見せおわるまでの 時間 */
export function showMs(len: number): number {
  return START_DELAY + len * (SHOW_ON + SHOW_GAP);
}
