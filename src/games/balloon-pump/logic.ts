// =============================================================
// ドキドキふうせん（No.86）の出題・採点（DOM非依存・純ロジック）
// =============================================================
// - 押している間だけふくらむふうせんを、はなして確定する度胸くらべ。
//   ふうせんごとに「かくれた限界」があり、限界をこえるとパン＝そのふうせんは0点。
//   限界の TREMBLE_FRAC(72%) でかならず震えはじめる（正直な予告）ので、
//   「震えてからどこまでねばるか」が腕の見せどころ。
// - 理不尽なし保証（プロパティテスト対象）:
//   ①震え→限界の反応猶予 ≥ MIN_REACT_MS（全ふうせん・膨張速度込みで生成規則が保証）
//   ②ゴールデンゾーン(90%〜100%)の滞在時間 ≥ MIN_GOLDEN_MS
// - 限界値は rng 注入（日替わりは全員同じ）・採点は純関数＝完全決定論。
// - import してよいのは game-api と同一フォルダのみ（このファイルは依存なし）。

export const W = 360;
export const H = 640;

export const BALLOONS = 8;
/** 震えはじめる割合（限界に対する比） */
export const TREMBLE_FRAC = 0.72;
/** ゴールデンゾーン（この割合以上で確定するとボーナス） */
export const GOLDEN_FRAC = 0.9;
export const GOLDEN_BONUS = 40;
/** きわきわ実績の割合 */
export const EDGE_FRAC = 0.97;
/** 震え→限界の反応猶予の下限（ms） */
export const MIN_REACT_MS = 350;
/** ゴールデンゾーンの滞在時間の下限（ms） */
export const MIN_GOLDEN_MS = 120;
/** 連続ゴールデンのボーナス（2連続目から +10×(n-1)、上限+40） */
export function streakBonus(n: number): number {
  return Math.min(40, Math.max(0, (n - 1) * 10));
}
/** 実績: ふうせんめいじん の閾値（正直ボット実証値で較正） */
export const SCORE_HI = 1000;

/** ふうせん1個の出題（限界サイズと膨張速度） */
export interface BalloonSpec {
  /** かくれた限界サイズ（サイズ単位） */
  limit: number;
  /** 膨張速度（サイズ単位/秒） */
  rate: number;
}

/**
 * 8個の出題を一括生成（rng 消費順固定＝決定論）。
 * 後半ほど膨張がはやい。反応猶予 (1-TREMBLE_FRAC)*limit/rate ≥ MIN_REACT_MS を
 * 常に満たすよう、limit の下限を rate から逆算して保証する。
 */
export function makePlan(rng: () => number): BalloonSpec[] {
  const specs: BalloonSpec[] = [];
  for (let i = 0; i < BALLOONS; i++) {
    const rate = 1.0 + i * 0.105; // 1.0 → 1.735 サイズ/秒
    // 猶予保証: (1-0.72)*limit/rate ≥ 0.35s → limit ≥ 1.25*rate
    const lo = Math.max(2.2, (MIN_REACT_MS / 1000 / (1 - TREMBLE_FRAC)) * rate);
    const hi = 3.6;
    const limit = lo + rng() * (hi - lo);
    specs.push({ limit, rate });
  }
  return specs;
}

/** サイズ→割合（0〜1）。limit ちょうどでパン */
export const fracOf = (size: number, spec: BalloonSpec): number => size / spec.limit;

/**
 * 確定時の得点（パンは呼び出し側で0点にする）。
 * frac×100 の切り捨て ＋ ゴールデンボーナス ＋ 連続ゴールデンボーナス。
 */
export function releaseScore(frac: number, goldenStreak: number): number {
  const base = Math.floor(Math.max(0, Math.min(1, frac)) * 100);
  if (frac >= GOLDEN_FRAC) return base + GOLDEN_BONUS + streakBonus(goldenStreak);
  return base;
}

/** 参考: 完璧プレイ（毎回 frac=0.99 で確定）の得点 */
export function maxPracticalScore(): number {
  let total = 0;
  for (let i = 1; i <= BALLOONS; i++) total += releaseScore(0.99, i);
  return total;
}
