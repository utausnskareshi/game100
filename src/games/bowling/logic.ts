// =============================================================
// ボウリング（No.60）の得点計算とピン配置（DOM非依存・純ロジック）
// =============================================================
// - 得点は「flat rolls（1投ごとの たおしたピン数）」から 標準ルールで計算する。
//   ストライク=10＋次2投 / スペア=10＋次1投 / それ以外=2投の和。全10フレーム。
// - ピン配置は トップダウンの三角形（手前が 1本＝アペックス）。乱数は使わない。
// - import してよいのは game-api と同一フォルダのみ（このファイルは依存なし）。

export interface Vec {
  x: number;
  y: number;
}

export const LANE_W = 360;
export const PIN_R = 9;
export const BALL_R = 13;
/** ピンが 定位置から この距離いじょう動いたら「たおれた」（本物のピンは 少し当たれば たおれる） */
export const KNOCK_DIST = 8;
/** 動いている たおれピンが この距離いない の立ちピンを なぎ倒す（連鎖・なだれ） */
export const CASCADE_DIST = 12;

/** 10本のピンの定位置（トップダウン・手前=1本 / 奥=4本） */
export function pinLayout(): Vec[] {
  const cx = LANE_W / 2;
  const rowGap = 23;
  const colGap = 22;
  const frontY = 215; // 手前のピン（アペックス）
  const pins: Vec[] = [];
  for (let row = 0; row < 4; row++) {
    const count = row + 1;
    const y = frontY - row * rowGap;
    const startX = cx - ((count - 1) * colGap) / 2;
    for (let c = 0; c < count; c++) pins.push({ x: startX + c * colGap, y });
  }
  return pins; // 10本
}

/**
 * 標準ボウリングの合計得点（rolls = 1投ごとの たおしたピン数の並び）。
 * 途中経過にも使える（未確定のボーナスは 未来の投球ぶん 0 として計算）。
 */
export function bowlingScore(rolls: number[]): number {
  const r = (i: number): number => rolls[i] ?? 0;
  let score = 0;
  let i = 0;
  for (let frame = 0; frame < 10; frame++) {
    if (i >= rolls.length) break;
    if (r(i) === 10) {
      // ストライク
      score += 10 + r(i + 1) + r(i + 2);
      i += 1;
    } else if (r(i) + r(i + 1) === 10) {
      // スペア
      score += 10 + r(i + 2);
      i += 2;
    } else {
      score += r(i) + r(i + 1);
      i += 2;
    }
  }
  return score;
}

/** 円と円の弾性ぎみ衝突を解決（半径 ra,rb・質量比 impart で速度を移す）。重なっていれば true */
export function resolveCircles(
  a: Vec & { vx: number; vy: number },
  ra: number,
  b: Vec & { vx: number; vy: number },
  rb: number,
  impart: number,
): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d = Math.hypot(dx, dy);
  const min = ra + rb;
  if (d >= min || d < 1e-6) return false;
  const nx = dx / d;
  const ny = dy / d;
  // 押し出し（重なり解消）
  const overlap = min - d;
  a.x -= nx * overlap * 0.5;
  a.y -= ny * overlap * 0.5;
  b.x += nx * overlap * 0.5;
  b.y += ny * overlap * 0.5;
  // 法線方向の相対速度
  const rvx = b.vx - a.vx;
  const rvy = b.vy - a.vy;
  const vn = rvx * nx + rvy * ny;
  if (vn < 0) {
    const j = -vn * impart;
    a.vx -= j * nx;
    a.vy -= j * ny;
    b.vx += j * nx;
    b.vy += j * ny;
  }
  return true;
}
