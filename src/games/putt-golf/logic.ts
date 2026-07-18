// =============================================================
// パターゴルフ（No.74）の転がり物理とコース（DOM非依存・純ロジック）
// =============================================================
// - トップダウンのグリーン。ボールは摩擦で減速し、かべで反射、カップに ゆっくり入ると カップイン。
//   速すぎるとカップの上を通りすぎる（リップアウト）＝強すぎ注意の あそびごたえ。
// - 砂（バンカー）に入ると 強い摩擦で 大きく減速。
// - 乱数は使わない＝完全決定論（検証がミリ秒精度で厳密化）。時間・入力は game.ts が ctx から渡す。
// - import してよいのは game-api と同一フォルダのみ（このファイルは依存なし）。

export const W = 360;
export const H = 640;
export const BALL_R = 7;
/** 通常の摩擦（速度に比例して減速・/s 相当） */
export const FRICTION = 1.55;
/** 砂の中の摩擦（強い） */
export const SAND_FRICTION = 6.5;
export const WALL_E = 0.68; // かべの反発
export const STOP_SPEED = 7; // これ以下で停止
export const CUP_R = 12; // カップ半径（入りやすめ）
export const CAPTURE_SPEED = 235; // これ未満なら カップイン（速いと通りすぎる）
export const MAX_PUTT = 560; // パットの最大初速
export const PULL_SCALE = 4.0; // 引っぱり1pxあたりの初速
export const MIN_PULL = 14; // これ未満は パットしない
export const MAX_STROKES = 8; // 1ホールの上限打数（超えたら次へ）

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
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Hole {
  tee: { x: number; y: number };
  cup: { x: number; y: number };
  par: number;
  walls: Seg[];
  sand: Rect[];
}

// グリーンの外周（内側の遊べる矩形）。全ホール共通で ボールが反射する
const BX0 = 20;
const BX1 = 340;
const BY0 = 100;
const BY1 = 596;
const BOUNDARY: Seg[] = [
  { x1: BX0, y1: BY0, x2: BX1, y2: BY0 }, // 上
  { x1: BX0, y1: BY1, x2: BX1, y2: BY1 }, // 下
  { x1: BX0, y1: BY0, x2: BX0, y2: BY1 }, // 左
  { x1: BX1, y1: BY0, x2: BX1, y2: BY1 }, // 右
];

const bw = (extra: Seg[] = []): Seg[] => [...BOUNDARY, ...extra];

/** 全9ホール。tee=スタート / cup=穴 / par=規定打数 / walls / sand。直線パットで届く素直な配置（普通の難易度） */
export const HOLES: Hole[] = [
  { tee: { x: 180, y: 540 }, cup: { x: 180, y: 230 }, par: 2, walls: bw(), sand: [] },
  { tee: { x: 92, y: 540 }, cup: { x: 266, y: 236 }, par: 2, walls: bw(), sand: [] },
  { tee: { x: 180, y: 556 }, cup: { x: 180, y: 178 }, par: 3, walls: bw(), sand: [{ x: 140, y: 300, w: 80, h: 54 }] },
  { tee: { x: 284, y: 540 }, cup: { x: 96, y: 248 }, par: 2, walls: bw(), sand: [] },
  {
    tee: { x: 176, y: 558 },
    cup: { x: 296, y: 172 },
    par: 3,
    walls: bw([{ x1: 110, y1: 340, x2: 110, y2: 470 }]), // 左の飾りかべ（直線ルートは通す）
    sand: [],
  },
  { tee: { x: 112, y: 520 }, cup: { x: 250, y: 216 }, par: 2, walls: bw(), sand: [] },
  { tee: { x: 60, y: 558 }, cup: { x: 300, y: 190 }, par: 3, walls: bw(), sand: [{ x: 150, y: 330, w: 66, h: 66 }] },
  { tee: { x: 180, y: 540 }, cup: { x: 104, y: 214 }, par: 2, walls: bw(), sand: [] },
  {
    tee: { x: 180, y: 582 },
    cup: { x: 180, y: 152 },
    par: 3,
    walls: bw(),
    sand: [
      { x: 74, y: 300, w: 58, h: 60 },
      { x: 228, y: 300, w: 58, h: 60 },
    ],
  },
];

/** 1ホールの得点（沈めたときの打数 vs パー）。上限打数で未達なら 20 */
export function pointsFor(strokes: number, par: number, sunk: boolean): number {
  if (!sunk) return 20;
  if (strokes <= 1) return 300; // ホールインワン
  if (strokes < par) return 250; // バーディ以上
  if (strokes === par) return 200;
  if (strokes === par + 1) return 120;
  if (strokes === par + 2) return 60;
  return 20;
}

/** 理論最大 = 9ホール すべて ホールインワン */
export function maxScore(): number {
  return HOLES.length * 300;
}

export function inRect(x: number, y: number, r: Rect): boolean {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

// ---- 幾何ヘルパー（ピンボールと同系。ゲーム間importは禁止のため独立実装）----
function closestOnSeg(px: number, py: number, s: Seg): { x: number; y: number } {
  const dx = s.x2 - s.x1;
  const dy = s.y2 - s.y1;
  const len2 = dx * dx + dy * dy || 1;
  let t = ((px - s.x1) * dx + (py - s.y1) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return { x: s.x1 + dx * t, y: s.y1 + dy * t };
}

/** ボール vs 静的な線分。反発 e で反射し、めり込みを押し出す。衝突したら true */
export function collideSeg(b: Ball, br: number, s: Seg, e: number): boolean {
  const c = closestOnSeg(b.x, b.y, s);
  let nx = b.x - c.x;
  let ny = b.y - c.y;
  let d = Math.hypot(nx, ny);
  if (d >= br) return false;
  if (d < 1e-6) {
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
  b.x += nx * (br - d);
  b.y += ny * (br - d);
  const vn = b.vx * nx + b.vy * ny;
  if (vn < 0) {
    b.vx -= (1 + e) * vn * nx;
    b.vy -= (1 + e) * vn * ny;
  }
  return true;
}

export interface StepResult {
  sunk: boolean;
  stopped: boolean;
}

/**
 * ボールを dt 秒 進める（摩擦→移動→かべ反射→カップ判定）。破壊的。
 * カップに ゆっくり重なったら sunk、速度が STOP_SPEED 未満になったら stopped。
 */
export function stepBall(b: Ball, dt: number, hole: Hole): StepResult {
  const inSand = hole.sand.some((r) => inRect(b.x, b.y, r));
  const fr = inSand ? SAND_FRICTION : FRICTION;
  const decay = Math.max(0, 1 - fr * dt);
  b.vx *= decay;
  b.vy *= decay;
  b.x += b.vx * dt;
  b.y += b.vy * dt;
  for (const s of hole.walls) collideSeg(b, BALL_R, s, WALL_E);
  // カップ判定
  const dc = Math.hypot(b.x - hole.cup.x, b.y - hole.cup.y);
  const sp = Math.hypot(b.vx, b.vy);
  if (dc < CUP_R && sp < CAPTURE_SPEED) {
    b.x = hole.cup.x;
    b.y = hole.cup.y;
    b.vx = 0;
    b.vy = 0;
    return { sunk: true, stopped: true };
  }
  if (sp < STOP_SPEED) {
    b.vx = 0;
    b.vy = 0;
    return { sunk: false, stopped: true };
  }
  return { sunk: false, stopped: false };
}
