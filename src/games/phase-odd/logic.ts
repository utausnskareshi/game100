// =============================================================
// ひとつだけ ズレてる（No.112・かくれゲーム）: 純ロジック（出題・採点）
// =============================================================
// - たくさんのマルが そろって ふくらんだり しぼんだりしている。
//   その中で 1つだけ「リズムが ズレている」ものを さがす。
// - 色や形の ちがいではなく **位相（タイミング）のズレ** を見つける遊び。
// - ズレは 半周期 → ごくわずか へと 小さくなり、マスの数も ふえていく。
// - DOM 非依存・rng 注入＝決定論。
// =============================================================

export interface RoundSpec {
  cols: number;
  rows: number;
  /** ズレの大きさ（1.0＝1周期ぶん。0.5＝真うら） */
  offset: number;
  /** 1回 ふくらんで しぼむまで（ミリ秒） */
  periodMs: number;
}

export const ROUND_SPECS: RoundSpec[] = [
  { cols: 3, rows: 3, offset: 0.5, periodMs: 1100 },
  { cols: 3, rows: 4, offset: 0.4, periodMs: 1100 },
  { cols: 4, rows: 4, offset: 0.33, periodMs: 1050 },
  { cols: 4, rows: 4, offset: 0.26, periodMs: 1050 },
  { cols: 4, rows: 5, offset: 0.22, periodMs: 1000 },
  { cols: 4, rows: 5, offset: 0.18, periodMs: 1000 },
  { cols: 5, rows: 5, offset: 0.15, periodMs: 950 },
  { cols: 5, rows: 5, offset: 0.12, periodMs: 950 },
  { cols: 5, rows: 6, offset: 0.1, periodMs: 900 },
  { cols: 5, rows: 6, offset: 0.08, periodMs: 900 },
];

export const ROUNDS = ROUND_SPECS.length;
/** 1もんの もちじかん（ミリ秒） */
export const ROUND_MS = 9000;
/** これより はやく 見つけると ボーナス */
export const QUICK_MS = 3000;
export const QUICK_BONUS = 30;
/** すばやい目の 実績になる はやさ */
export const FAST_EYE_MS = 2000;
/** まちがえたときの 減点 */
export const MISS_PENALTY = 20;

export interface Round {
  spec: RoundSpec;
  /** ズレているマスの ばんごう（0 〜 cols*rows-1） */
  odd: number;
}

/** 1もんを作る。ズレているマスは まん中に かたよらないよう ふつうに ランダム */
export function makeRound(rng: () => number, i: number): Round {
  const spec = ROUND_SPECS[Math.min(i, ROUND_SPECS.length - 1)]!;
  const n = spec.cols * spec.rows;
  return { spec, odd: Math.floor(rng() * n) };
}

export function makeRounds(rng: () => number): Round[] {
  const out: Round[] = [];
  for (let i = 0; i < ROUNDS; i++) out.push(makeRound(rng, i));
  return out;
}

/** そのマスの ふくらみ（0〜1）。odd だけ ズレた位相で うごく */
export function pulseOf(round: Round, index: number, elapsedMs: number): number {
  const ph = index === round.odd ? round.spec.offset : 0;
  const t = elapsedMs / round.spec.periodMs + ph;
  return 0.5 - 0.5 * Math.cos(2 * Math.PI * t);
}

/** せいかいの点（あとのもんだいほど 高い） */
export function roundPoints(i: number): number {
  return 60 + i * 10;
}

/** 満点（ぜんもん せいかい＋ぜんぶ はやおし） */
export function maxScore(): number {
  let s = 0;
  for (let i = 0; i < ROUNDS; i++) s += roundPoints(i) + QUICK_BONUS;
  return s;
}
