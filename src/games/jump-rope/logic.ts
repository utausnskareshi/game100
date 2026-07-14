// =============================================================
// ぴょんぴょんなわとび（No.49）の回転と得点（DOM非依存・純ロジック）
// =============================================================
// - なわは phase（0〜1）で回る。phase=0 が「足もとを通るしゅんかん」。
//   そのときジャンプ中でなければ つまずき。とぶたびに回転が少しずつはやくなる。
// - 乱数は使わない（純粋なリズムのランプ＝毎回同じ試技）。
// - import してよいのは game-api（types/helpers）と同一フォルダのみ（このファイルは依存なし）。

/** ジャンプの滞空時間（ms） */
export const JUMP_MS = 400;
/** つまずいたあと なわが止まる時間（ms） */
export const STUN_MS = 1000;
/** つまずける回数（3回で終了） */
export const MISSES_MAX = 3;
/** スコア: 1回とぶごとに 10 + コンボ2×min(n-1,5)（さいだい+10） */
export const JUMP_PTS = 10;

/** n回とんだあとの なわの周期（ms）: 1400 → 750 */
export function periodAt(jumps: number): number {
  return Math.max(750, 1400 - jumps * 9);
}

/** 1回とんだときの得点（combo=この1回を含めた連続成功数） */
export function jumpPoints(combo: number): number {
  return JUMP_PTS + 2 * Math.min(combo - 1, 5);
}
