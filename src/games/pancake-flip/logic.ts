// =============================================================
// ぱんけーきめいじん（No.70）の焼き加減と評価（DOM非依存・純ロジック）
// =============================================================
// - 生地は時間とともに焼き色が進む（doneness 0→1が「きつね色」、超えるとこげへ）。
//   きつね色の窓でフリップ/おさらに出すと高評価。両面の評価の合計が1枚の点。
// - 泡（あわ）が出はじめたら もうすぐ食べごろ＝子ども向けの視覚合図。
// - 乱数不使用（純粋な火加減ゲーム）。時間は呼び出し側が ctx.now で与える。
// - import してよいのは game-api と同一フォルダのみ（このファイルは依存なし）。

export const TOTAL_PANCAKES = 8;
/** 2つめのフライパンが使えるようになる枚数（4枚めから同時管理） */
export const SECOND_PAN_AT = 3;

/** 面ごとの焼き時間（doneness 1.0 = きつね色ど真ん中に届くまでのms） */
export const SIDE_A_MS = 4200;
export const SIDE_B_MS = 3200;

/** 泡が出はじめる doneness（合図）。GOLDEN_MIN の少し前 */
export const BUBBLE_AT = 0.78;
/** きつね色の窓（この間にフリップ/サーブで50点） */
export const GOLDEN_MIN = 0.88;
export const GOLDEN_MAX = 1.22;
/** これを超えるとこげ（見た目もまっ黒） */
export const BURNT_AT = 1.5;

/** 面の評価点: きつね色50 / はやい・おそい30 / こげ・なま10 */
export const RATE_GOLDEN = 50;
export const RATE_OK = 30;
export const RATE_BAD = 10;

export type SideRating = 'golden' | 'ok' | 'bad';

/** 経過msから doneness を返す（sideMs=その面の基準時間） */
export function donenessOf(elapsedMs: number, sideMs: number): number {
  return Math.max(0, elapsedMs) / sideMs;
}

/** フリップ/サーブした瞬間の doneness を評価する */
export function rateSide(doneness: number): SideRating {
  if (doneness >= GOLDEN_MIN && doneness <= GOLDEN_MAX) return 'golden';
  if (doneness >= 0.5 && doneness < BURNT_AT) return 'ok';
  return 'bad';
}

export function ratePoints(r: SideRating): number {
  return r === 'golden' ? RATE_GOLDEN : r === 'ok' ? RATE_OK : RATE_BAD;
}

/** 1枚の評価（両面の合計）に対する ことば */
export function gradeWord(total: number): string {
  if (total >= RATE_GOLDEN * 2) return 'ぴったり！';
  if (total >= RATE_GOLDEN + RATE_OK) return 'おいしい！';
  if (total >= RATE_OK * 2) return 'まずまず';
  return 'こげちゃった…';
}

/** 焼き色（doneness → 色）。生地→きつね色→こげ茶→まっ黒 */
export function colorOf(doneness: number): string {
  const stops: [number, [number, number, number]][] = [
    [0, [247, 232, 192]],
    [0.5, [242, 210, 140]],
    [1.0, [226, 168, 74]],
    [1.35, [138, 90, 42]],
    [1.8, [48, 36, 26]],
  ];
  const d = Math.max(0, Math.min(1.8, doneness));
  for (let i = 0; i < stops.length - 1; i++) {
    const [t0, c0] = stops[i]!;
    const [t1, c1] = stops[i + 1]!;
    if (d <= t1) {
      const f = (d - t0) / (t1 - t0);
      const c = c0.map((v, k) => Math.round(v + (c1[k]! - v) * f));
      return `rgb(${c[0]},${c[1]},${c[2]})`;
    }
  }
  return 'rgb(48,36,26)';
}

/** その枚数めのとき、使えるフライパンの数 */
export function pansAvailable(servedCount: number): number {
  return servedCount + 1 > SECOND_PAN_AT ? 2 : 1;
}
