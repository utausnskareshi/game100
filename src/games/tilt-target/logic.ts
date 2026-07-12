// =============================================================
// かたむきまとあて（No.29）のロジック（DOM非依存・乱数注入）
// =============================================================
// - まと（的）の出現位置と半径を決める。rng 注入＝「今日のゲーム」では全員同じまとの列。
// - import してよいのは game-api（types/helpers）と同一フォルダのみ（このファイルは依存なし）。

export const W = 360;
export const H = 640;
export const BALL_R = 16;
/** まとの初期半径〜最小半径（とるたびに2pxちぢむ） */
export const TARGET_R_START = 54;
export const TARGET_R_MIN = 34;
export const TARGET_SHRINK = 2;
/** まとの中にいつづける時間(ms)＝キャッチ成立 */
export const KEEP_MS = 1600;
/** 出現からこの時間(ms)以内にとると「すばやい」ボーナス */
export const QUICK_MS = 4000;
export const CAPTURE_POINTS = 100;
export const QUICK_BONUS = 30;
/** まとが画面端から離れる余白 */
export const MARGIN = 64;
/** ボールの真上に出ない最小距離 */
export const MIN_DIST_FROM_BALL = 140;

export interface Target {
  x: number;
  y: number;
  r: number;
}

/** とった枚数→まとの半径 */
export function radiusFor(captures: number): number {
  return Math.max(TARGET_R_MIN, TARGET_R_START - captures * TARGET_SHRINK);
}

/**
 * 次のまとの位置を決める。ボールの近すぎる場所を避けて最大8回引き直す
 * （rng は1回の試行で2消費。引き直し回数は盤面状態に依存＝同じ操作なら全員同じ）。
 */
export function spawnTarget(rng: () => number, ball: { x: number; y: number }, captures: number): Target {
  const r = radiusFor(captures);
  let x = W / 2;
  let y = H / 2;
  for (let t = 0; t < 8; t++) {
    x = MARGIN + rng() * (W - MARGIN * 2);
    y = MARGIN + 40 + rng() * (H - MARGIN * 2 - 80); // 上下はHUD/下端ぶん少し内側
    const dx = x - ball.x;
    const dy = y - ball.y;
    if (dx * dx + dy * dy >= MIN_DIST_FROM_BALL * MIN_DIST_FROM_BALL) break;
  }
  return { x, y, r };
}
