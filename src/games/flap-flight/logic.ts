// =============================================================
// ぱたぱたフライト（No.41）の物理と岩柱生成（DOM非依存・純ロジック）
// =============================================================
// - タップで上向きの速度を得て、あとは重力で落ちる。すきまをくぐるほど加点。
// - 岩柱は index が進むほど「すきまがせまく・動く」＝どんどん難しくなる。
// - 乱数は注入（ctx.random）。1区間の抽選で消費する乱数は常に7回
//   （岩柱4回＋⭐3回）＝日替わりで全員同じコース。
// - import してよいのは game-api（types/helpers）と同一フォルダのみ（このファイルは依存なし）。

export type Rng = () => number;

/** 重力（px/s²）と はばたきの上向き速度（px/s） */
export const GRAVITY = 1250;
export const FLAP_VY = -360;
/** 落下の最高速度（px/s） */
export const TERMINAL_VY = 640;
/** とりの当たり半径と画面上の固定x */
export const BIRD_R = 13;
export const BIRD_X = 100;
/** 地面のy（これより下は墜落）・天井は y=0 */
export const GROUND_Y = 580;
/** 岩柱の半幅と中心間かく */
export const PILLAR_HW = 26;
export const GATE_SPACING = 250;
/** 最初の岩柱の worldX */
export const FIRST_GATE_X = 460;
/** ⭐の取得半径と得点 */
export const STAR_R = 26;
export const STAR_PTS = 15;
export const GATE_PTS = 10;

/** スクロール速度（px/s）。45秒かけて 160 → 260 */
export function speedAt(tMs: number): number {
  return 160 + 100 * Math.min(1, tMs / 45_000);
}

/** すきまの大きさ（px）。ゲートが進むほど 150 → 110 */
export function gapAt(index: number): number {
  return 150 - Math.min(40, index * 1.8);
}

export interface Gate {
  /** 岩柱の中心 worldX */
  x: number;
  /** すきま中心yの基準値 */
  baseCy: number;
  gap: number;
  moving: boolean;
  amp: number;
  speed: number;
  phase: number;
}

export interface Star {
  exists: boolean;
  /** worldX（ゲートとゲートの中間） */
  x: number;
  y: number;
}

/** 岩柱1本の抽選（乱数消費は常に4回） */
export function rollGate(rng: Rng, index: number): Gate {
  const baseCy = 130 + rng() * 340; // 130..470
  const movingRoll = rng();
  const amp = 18 + rng() * 24; // 18..42
  const speed = 0.9 + rng() * 0.9; // 0.9..1.8 rad/s
  const moving = index >= 12 && movingRoll < 0.35;
  // うごく岩柱は「通過中のズレ」ぶん すきまを広げる（むずかしいが理不尽にはしない）
  const gap = gapAt(index) + (moving ? amp * 0.6 : 0);
  return {
    x: FIRST_GATE_X + index * GATE_SPACING,
    baseCy,
    gap,
    moving,
    amp: moving ? amp : 0,
    speed: moving ? speed : 0,
    phase: index * 2.1,
  };
}

/** ゲート i と i+1 の間の⭐の抽選（乱数消費は常に3回） */
export function rollStar(rng: Rng, index: number): Star {
  const roll = rng();
  const y = 130 + rng() * 340;
  rng(); // 予備（消費回数を固定するためのダミー）
  return { exists: roll < 0.35, x: FIRST_GATE_X + index * GATE_SPACING + GATE_SPACING / 2, y };
}

/** すきま中心yの現在値（tMs=プレイ経過ms） */
export function gateCy(g: Gate, tMs: number): number {
  const cy = g.moving ? g.baseCy + Math.sin(g.phase + (g.speed * tMs) / 1000) * g.amp : g.baseCy;
  // うごいても すきまが画面外へ出ないように収める
  return Math.max(g.gap / 2 + 40, Math.min(GROUND_Y - g.gap / 2 - 40, cy));
}

/** 円と矩形の当たり判定 */
export function circleRect(
  cx: number,
  cy: number,
  r: number,
  rx: number,
  ry: number,
  rw: number,
  rh: number,
): boolean {
  const nx = Math.max(rx, Math.min(cx, rx + rw));
  const ny = Math.max(ry, Math.min(cy, ry + rh));
  const dx = cx - nx;
  const dy = cy - ny;
  return dx * dx + dy * dy < r * r;
}

/** とりが岩柱（上下2本）にぶつかっているか（birdX/birdY は world 座標） */
export function hitsGate(g: Gate, tMs: number, birdX: number, birdY: number): boolean {
  const cy = gateCy(g, tMs);
  const left = g.x - PILLAR_HW;
  const topH = cy - g.gap / 2;
  const botY = cy + g.gap / 2;
  return (
    circleRect(birdX, birdY, BIRD_R, left, 0, PILLAR_HW * 2, topH) ||
    circleRect(birdX, birdY, BIRD_R, left, botY, PILLAR_HW * 2, GROUND_Y - botY)
  );
}
