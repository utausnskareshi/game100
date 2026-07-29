// =============================================================
// みっつの はり（No.118・かくれゲーム）: 純ロジック（3本の針・判定）
// =============================================================
// - 3本の針は 同じ ところ（12時）から 出発し、それぞれ「1周 T ミリ秒の k 倍速」で 回る。
//   k が 整数なので、**T ミリ秒ごとに 3本が ぴったり 12時で そろう**（＝必ず チャンスが来る）。
// - 判定は「そろう 時こく」との 時間差。いちばん速い針が 速いほど 見た目の はばは せまくなる。
// - 乱数を使わない 固定の 出題＝だれでも 同じ問題・満点も 同じ。
// - DOM 非依存。
// =============================================================

export interface RoundSpec {
  /** 3本の 針の 速さ（T ミリ秒に 何周 するか）。整数なので かならず そろう */
  k: [number, number, number];
  /** 3本が そろう 間かく（ミリ秒） */
  periodMs: number;
  /** せいかいと みなす 時間差（ミリ秒） */
  tolMs: number;
}

/**
 * ラウンドの 表。むずかしさは **はりの 組み合わせ**（k）で 上げていき、
 * 判定の はば(tolMs)は 60ms より せまくしない。
 *
 * ★もとは 最後が 38ms だった。判定は `offset <= tolMs/3` で いちばん上の 段になるので、
 *   38ms は「13ms いない」を 要求する＝**人の 指の 精度（子どもで ±80〜120ms、
 *   おとなでも ±50〜70ms）を こえていた**。実測（1万回シミュレーション）でも
 *   ±80ms の人の 平均が 862点（満点1480・金1200）で、金が ほぼ 取れなかった。
 *   はばを ゆるめた あとは ±80ms で 平均1052・銀に とどく（金は ±40〜60ms の うでまえ）。
 */
export const ROUND_SPECS: RoundSpec[] = [
  { k: [1, 2, 3], periodMs: 5000, tolMs: 110 },
  { k: [1, 2, 3], periodMs: 4200, tolMs: 100 },
  { k: [1, 2, 4], periodMs: 4200, tolMs: 92 },
  { k: [1, 3, 4], periodMs: 4000, tolMs: 84 },
  { k: [2, 3, 5], periodMs: 4000, tolMs: 78 },
  { k: [1, 3, 5], periodMs: 3800, tolMs: 72 },
  { k: [2, 3, 7], periodMs: 4200, tolMs: 66 },
  { k: [1, 4, 7], periodMs: 4000, tolMs: 60 },
];

export const ROUNDS = ROUND_SPECS.length;

/** 1しゅう目の そろいは 数えない（はじまった しゅんかんに 押すだけになるため） */
export const EARLY_GUARD = 0.5;
/** これを すぎると 時間ぎれ（そろう 回数） */
export const MAX_LAPS = 4.2;

/** その針の いまの角度（度・0が上・時計まわり） */
export function handAngle(spec: RoundSpec, k: number, tMs: number): number {
  const turns = (tMs / spec.periodMs) * k;
  return ((turns % 1) + 1) % 1 * 360;
}

/** いちばん近い「そろう 時こく」との 時間差（ミリ秒・絶対値） */
export function offsetMs(spec: RoundSpec, tMs: number): number {
  const m = tMs % spec.periodMs;
  return Math.min(m, spec.periodMs - m);
}

/** 押しても よい時間か（1しゅう目の そろいは 数えない） */
export function canAnswer(spec: RoundSpec, tMs: number): boolean {
  return tMs >= spec.periodMs * EARLY_GUARD;
}

/** 時間ぎれか */
export function isTimeUp(spec: RoundSpec, tMs: number): boolean {
  return tMs > spec.periodMs * MAX_LAPS;
}

/** 判定: 0=はずれ 1=セーフ 2=ナイス 3=どんぴしゃ */
export function judge(spec: RoundSpec, offset: number): number {
  if (offset > spec.tolMs) return 0;
  if (offset <= spec.tolMs / 3) return 3;
  if (offset <= (spec.tolMs * 2) / 3) return 2;
  return 1;
}

/** その判定の 点（あとの もんだいほど 高い） */
export function roundPoints(round: number, tier: number): number {
  if (tier === 0) return 0;
  const base = tier === 3 ? 150 : tier === 2 ? 100 : 60;
  return base + round * 10;
}

/** 満点 */
export function maxScore(): number {
  let s = 0;
  for (let i = 0; i < ROUNDS; i++) s += roundPoints(i, 3);
  return s;
}
