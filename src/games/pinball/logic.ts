// =============================================================
// ピンボール（No.73）の物理と台レイアウト（DOM非依存・純ロジック）
// =============================================================
// - ボール vs 線分（かべ・スリング・フリッパー）と ボール vs 円（バンパー）の
//   衝突解決を純関数で提供する。台の形（かべ/バンパー/スリング/ターゲット/フリッパー）も定義。
// - 乱数は使わない＝完全決定論（日替わりも同一・検証がミリ秒精度で厳密化）。
//   時間・入力は呼び出し側（game.ts）が ctx から渡す。
// - import してよいのは game-api と同一フォルダのみ（このファイルは依存なし）。

export const W = 360;
export const H = 640;
export const BALL_R = 8.5;
export const GRAVITY = 780; // px/s^2（速めのボール＝少し難しい）
export const MAX_SPEED = 900;
export const WALL_E = 0.6; // かべの反発（0=吸収 1=完全反発）
export const FLIPPER_R = 7;

export interface Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
}
export interface Seg {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}
export interface Circle {
  x: number;
  y: number;
  r: number;
}

// ---- 台レイアウト（360×640・y は下向き）----
/** 発射レーンの仕切り（右）。この左が プレイフィールド */
export const LANE_X = 320;
export const LANE_MID = (LANE_X + W) / 2; // 発射レーンの中央 x
export const BALL_START = { x: LANE_MID, y: 596 };
export const LAUNCH_V = 860; // 発射の初速（上向き・レーン上部を抜けきる強さ）
/** レーン仕切りの上端。ボールはこの上を左へ抜けてプレイフィールドへ入る */
export const DIVIDER_TOP = 175;
/** 発射レーンの上部ガイド: 上りきったボールをこの y で左へ送り出す */
export const LANE_GUIDE_Y = 165;
export const LANE_GUIDE_VX = -150;

/** かべ（外周＋インレーン＋レーン仕切り）。線分の集合。上部は完全にシール */
export const WALLS: Seg[] = [
  // 左かべ（縦）→ 左インレーン（フリッパーへ下る斜め）
  { x1: 16, y1: 96, x2: 16, y2: 452 },
  { x1: 16, y1: 452, x2: 96, y2: 548 },
  // 上壁（全幅・右外かべまでつないでシール）
  { x1: 16, y1: 96, x2: 64, y2: 56 },
  { x1: 64, y1: 56, x2: 296, y2: 56 },
  { x1: 296, y1: 56, x2: W - 6, y2: 96 },
  // 右外かべ（上から底までシール）
  { x1: W - 6, y1: 96, x2: W - 6, y2: 612 },
  // 発射レーンの底
  { x1: LANE_X, y1: 612, x2: W - 6, y2: 612 },
  // レーン仕切り（上端 DIVIDER_TOP から下・上部にgap）→ 右インレーン
  { x1: LANE_X, y1: DIVIDER_TOP, x2: LANE_X, y2: 452 },
  { x1: LANE_X, y1: 452, x2: 264, y2: 548 },
];

/** スリングショット（フリッパー上の三角キッカー・当たると外へ強く弾く） */
export const SLINGS: Seg[] = [
  { x1: 72, y1: 470, x2: 116, y2: 520 }, // 左
  { x1: 288, y1: 470, x2: 244, y2: 520 }, // 右
];
export const SLING_KICK = 300;
export const SLING_PTS = 50;

/** バンパー（当たると +100＋強くはじく） */
export const BUMPERS: Circle[] = [
  { x: 120, y: 210, r: 17 },
  { x: 240, y: 210, r: 17 },
  { x: 180, y: 150, r: 17 },
];
export const BUMPER_KICK = 340;
export const BUMPER_PTS = 100;

/** ドロップターゲット（1列・全部倒すと ジャックポット） */
export interface Target {
  x: number;
  y: number;
  w: number;
  h: number;
}
export const TARGETS: Target[] = [0, 1, 2, 3, 4].map((i) => ({ x: 96 + i * 36, y: 300, w: 26, h: 12 }));
export const TARGET_PTS = 200;
export const JACKPOT_PTS = 2000;
export const TARGET_RESET_MS = 1600;
export const MAX_MULT = 3;

/** 上部レーン通過センサー（この y を上向きに横切ると +30・1回のフライトにつき1回） */
export const TOP_LANE_Y = 108;
export const TOP_LANE_PTS = 30;

// ---- フリッパー ----
export const FLIPPER_LEN = 62;
export const FLIP_SPEED = 22; // rad/s（振り上げの速さ）
export const LEFT_PIVOT = { x: 96, y: 548 };
export const RIGHT_PIVOT = { x: 264, y: 548 };
// 角度（screen座標・y下向き。左=右向きに伸びる / 右=左向きに伸びる）
export const LEFT_REST = 0.32; // 右下がり
export const LEFT_UP = -0.42; // 右上がり
export const RIGHT_REST = Math.PI - 0.32; // 左下がり
export const RIGHT_UP = Math.PI + 0.42; // 左上がり

export function flipperTip(pivot: { x: number; y: number }, angle: number): { x: number; y: number } {
  return { x: pivot.x + Math.cos(angle) * FLIPPER_LEN, y: pivot.y + Math.sin(angle) * FLIPPER_LEN };
}

// ---- 幾何ヘルパー ----
export function closestOnSeg(px: number, py: number, s: Seg): { x: number; y: number } {
  const dx = s.x2 - s.x1;
  const dy = s.y2 - s.y1;
  const len2 = dx * dx + dy * dy || 1;
  let t = ((px - s.x1) * dx + (py - s.y1) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return { x: s.x1 + dx * t, y: s.y1 + dy * t };
}

export function clampSpeed(b: Ball, max = MAX_SPEED): void {
  const sp = Math.hypot(b.vx, b.vy);
  if (sp > max) {
    b.vx = (b.vx / sp) * max;
    b.vy = (b.vy / sp) * max;
  }
}

/**
 * ボール vs 静的な線分。反発 e で反射し、めり込みを押し出す。
 * extraKick>0 なら 反射後に法線方向へ その速度を足す（スリング用）。衝突したら true。
 */
export function collideSeg(b: Ball, br: number, s: Seg, e: number, extraKick = 0): boolean {
  const c = closestOnSeg(b.x, b.y, s);
  let nx = b.x - c.x;
  let ny = b.y - c.y;
  let d = Math.hypot(nx, ny);
  const min = br;
  if (d >= min) return false;
  if (d < 1e-6) {
    // 線分の上に乗っている＝線分の法線を使う
    const sdx = s.x2 - s.x1;
    const sdy = s.y2 - s.y1;
    const sl = Math.hypot(sdx, sdy) || 1;
    nx = -sdy / sl;
    ny = sdx / sl;
    d = 0.01;
  } else {
    nx /= d;
    ny /= d;
  }
  b.x += nx * (min - d);
  b.y += ny * (min - d);
  const vn = b.vx * nx + b.vy * ny;
  if (vn < 0) {
    b.vx -= (1 + e) * vn * nx;
    b.vy -= (1 + e) * vn * ny;
  }
  if (extraKick > 0) {
    b.vx += nx * extraKick;
    b.vy += ny * extraKick;
  }
  return true;
}

/** ボール vs 円（バンパー）。当たると 外向きに固定速度でキック。衝突したら true */
export function collideBumper(b: Ball, br: number, c: Circle, kick: number): boolean {
  let nx = b.x - c.x;
  let ny = b.y - c.y;
  const d = Math.hypot(nx, ny);
  const min = br + c.r;
  if (d >= min) return false;
  if (d < 1e-6) {
    nx = 0;
    ny = -1;
  } else {
    nx /= d;
    ny /= d;
  }
  b.x = c.x + nx * min;
  b.y = c.y + ny * min;
  // 外向きに はじく（入射速度の法線成分を消してから 固定キック）
  const vn = b.vx * nx + b.vy * ny;
  if (vn < 0) {
    b.vx -= vn * nx;
    b.vy -= vn * ny;
  }
  b.vx += nx * kick;
  b.vy += ny * kick;
  return true;
}

/**
 * ボール vs フリッパー（回転する線分）。omega はフリッパーの角速度（rad/s）。
 * 反発＋接触点の面速度で ボールを打ち上げる。衝突したら true。
 */
export function collideFlipper(
  b: Ball,
  br: number,
  pivot: { x: number; y: number },
  tip: { x: number; y: number },
  omega: number,
  e: number,
): boolean {
  const seg: Seg = { x1: pivot.x, y1: pivot.y, x2: tip.x, y2: tip.y };
  const c = closestOnSeg(b.x, b.y, seg);
  let nx = b.x - c.x;
  let ny = b.y - c.y;
  let d = Math.hypot(nx, ny);
  const min = br + FLIPPER_R;
  if (d >= min) return false;
  if (d < 1e-6) {
    nx = 0;
    ny = -1;
    d = 0.01;
  } else {
    nx /= d;
    ny /= d;
  }
  b.x += nx * (min - d);
  b.y += ny * (min - d);
  // 接触点の面速度（omega × (C - pivot)）
  const rx = c.x - pivot.x;
  const ry = c.y - pivot.y;
  const svx = -omega * ry;
  const svy = omega * rx;
  const rvn = (b.vx - svx) * nx + (b.vy - svy) * ny;
  if (rvn < 0) {
    b.vx -= (1 + e) * rvn * nx;
    b.vy -= (1 + e) * rvn * ny;
  }
  return true;
}
