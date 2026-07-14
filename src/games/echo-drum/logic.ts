// =============================================================
// ものまねドラム（No.44）のリズムパターン生成と判定（DOM非依存・純ロジック）
// =============================================================
// - パターン＝ビートの時刻列（ms・先頭は0）。ラウンドが進むほど
//   「音がふえ・はやくなり・8分/付点のシンコペーションが混ざる」。
// - 再現の判定は「1打目を基準に、間（ま）がどれだけ正確か」＝1打目は基準なので常にOK。
// - 乱数は注入（ctx.random）。1ラウンドの消費は (音数-1) 回＝順番固定で日替わり同一。
// - import してよいのは game-api（types/helpers）と同一フォルダのみ（このファイルは依存なし）。

export type Rng = () => number;

/** ぜんぶで10ラウンド */
export const ROUNDS = 10;
/** ミスできる回数（3回で終了） */
export const MISSES_MAX = 3;
/** 判定しきい値（ms） */
export const PERFECT_MS = 55;
export const GOOD_MS = 115;
/** 得点 */
export const PERFECT_PTS = 20;
export const GOOD_PTS = 10;
export const COMPLETE_BONUS = 15; // ラウンドを最後までたたけた
export const ALL_PERFECT_BONUS = 25; // ぜんぶ「ぴったり」だった

/** ラウンド i の音数: 3,3,4,4,5,5,6,6,7,7 */
export function countAt(i: number): number {
  return 3 + Math.floor(i / 2);
}

/** ラウンド i の基本の間（4分音符・ms）: 600 → 402 */
export function baseAt(i: number): number {
  return 600 - i * 22;
}

/**
 * リズムパターンを生成する（ms時刻列・先頭0）。
 * 間の種類: 1=4分 / 0.5=8分 / 1.5=付点 / 2=2分。ラウンドが進むと8分・付点が混ざる。
 */
export function patternAt(rng: Rng, round: number): number[] {
  const count = countAt(round);
  const base = baseAt(round);
  const units = round <= 1 ? [1, 1, 2] : round <= 4 ? [1, 1, 0.5, 2] : [1, 0.5, 0.5, 1.5, 2];
  const times = [0];
  for (let k = 1; k < count; k++) {
    const u = units[Math.min(units.length - 1, Math.floor(rng() * units.length))]!;
    times.push(times[k - 1]! + u * base);
  }
  return times;
}

export type Judge = 'perfect' | 'good' | 'miss';

/** 1打の判定（devMs=期待時刻とのズレの絶対値） */
export function judgeOf(devMs: number): Judge {
  if (devMs <= PERFECT_MS) return 'perfect';
  if (devMs <= GOOD_MS) return 'good';
  return 'miss';
}

/** 判定の得点 */
export function pointsOf(j: Judge): number {
  return j === 'perfect' ? PERFECT_PTS : j === 'good' ? GOOD_PTS : 0;
}
