// =============================================================
// エアホッケー（No.25）の物理（DOM非依存・純関数）
// =============================================================
// - パック（円）の壁反射・ゴール判定・マレット（円）との衝突応答。
// - import してよいのは game-api（types/helpers）と同一フォルダのみ（このファイルは依存なし）。

export interface Puck {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
}

export interface Mallet {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
}

/**
 * 壁で反射させ、上下端ではゴール開口（goalL..goalR）に入っていれば 'top' / 'bottom' を返す
 * （'top'=上のゴールに入った＝あなたの得点）。ゴールでなければ null。
 */
export function reflectWalls(
  p: Puck,
  left: number,
  right: number,
  top: number,
  bottom: number,
  goalL: number,
  goalR: number,
): 'top' | 'bottom' | null {
  if (p.x - p.r < left) {
    p.x = left + p.r;
    p.vx = Math.abs(p.vx);
  } else if (p.x + p.r > right) {
    p.x = right - p.r;
    p.vx = -Math.abs(p.vx);
  }
  if (p.y - p.r < top) {
    if (p.x > goalL && p.x < goalR) return 'top';
    p.y = top + p.r;
    p.vy = Math.abs(p.vy);
  } else if (p.y + p.r > bottom) {
    if (p.x > goalL && p.x < goalR) return 'bottom';
    p.y = bottom - p.r;
    p.vy = -Math.abs(p.vy);
  }
  return null;
}

/**
 * マレットとパックの円円衝突。重なっていたらパックを押し出し、
 * 「法線方向へ max(パックの速さ, マレットの速さ×1.05 + boost)」の速度を与える。
 * bounds を渡すと壁ぎわの押し出しを「壁に沿ってスライド」させる（マレットと壁に
 * はさまれても角にハマらず、広いほうへ横に逃がす）。当たったら true。
 */
export function collideMallet(
  p: Puck,
  m: Mallet,
  boost: number,
  maxSpeed: number,
  bounds?: { l: number; r: number; t: number; b: number },
): boolean {
  const dx = p.x - m.x;
  const dy = p.y - m.y;
  const rr = p.r + m.r;
  const d2 = dx * dx + dy * dy;
  if (d2 >= rr * rr) return false;
  const d = Math.max(Math.sqrt(d2), 0.0001);
  // 押し出し先（マレット中心から法線方向に rr）
  let px = m.x + (dx / d) * rr;
  let py = m.y + (dy / d) * rr;

  // 壁ぎわ補正：押し出し先が場外になるなら、壁に沿って横へずらす。
  // これをしないと「マレットで壁に押し付けられたパック」の法線が壁を向き、
  // reflectWalls に押し戻されるだけで角から抜けられなくなる（＝隅でハマる）。
  if (bounds) {
    const minX = bounds.l + p.r;
    const maxX = bounds.r - p.r;
    const minY = bounds.t + p.r;
    const maxY = bounds.b - p.r;
    if (px < minX || px > maxX) {
      px = px < minX ? minX : maxX;
      // この x で中心間距離 rr を保つ縦オフセット（＝壁に沿う成分）
      const off = Math.sqrt(Math.max(0, rr * rr - (px - m.x) * (px - m.x)));
      // 近いほうの横壁から離れる向き（＝広いほう）へ逃がす
      py = m.y - minY > maxY - m.y ? m.y - off : m.y + off;
      py = py < minY ? minY : py > maxY ? maxY : py;
    } else if (py < minY || py > maxY) {
      py = py < minY ? minY : maxY;
      const off = Math.sqrt(Math.max(0, rr * rr - (py - m.y) * (py - m.y)));
      px = m.x - minX > maxX - m.x ? m.x - off : m.x + off;
      px = px < minX ? minX : px > maxX ? maxX : px;
    }
  }

  p.x = px;
  p.y = py;
  // 補正後の位置から法線を取り直す（壁ぎわでは壁に沿った向きになる＝角から横に飛ぶ）
  const ndx = px - m.x;
  const ndy = py - m.y;
  const nd = Math.max(Math.hypot(ndx, ndy), 0.0001);
  const nx = ndx / nd;
  const ny = ndy / nd;
  // 速度付与（マレットの勢いを反映しつつ最低 boost で飛ばす）
  const puckSpeed = Math.hypot(p.vx, p.vy);
  const malletSpeed = Math.hypot(m.vx, m.vy);
  const speed = Math.min(maxSpeed, Math.max(puckSpeed, malletSpeed * 1.05 + boost));
  p.vx = nx * speed + m.vx * 0.25;
  p.vy = ny * speed + m.vy * 0.25;
  clampSpeed(p, maxSpeed);
  return true;
}

/** 速度の上限（トンネリング・暴走防止） */
export function clampSpeed(p: Puck, max: number): void {
  const s = Math.hypot(p.vx, p.vy);
  if (s > max) {
    p.vx = (p.vx / s) * max;
    p.vy = (p.vy / s) * max;
  }
}

/** 摩擦（毎秒 k 割合の減速） */
export function applyFriction(p: Puck, k: number, dt: number): void {
  const f = Math.max(0, 1 - k * dt);
  p.vx *= f;
  p.vy *= f;
}
