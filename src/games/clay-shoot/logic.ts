// =============================================================
// クレーしゃげき（No.81）の弾道・ボレー計画・採点（DOM非依存・純ロジック）
// =============================================================
// - 「プル！」の合図で放出台からクレー（円盤）が放物線で飛ぶ。タップ＝その場所へ発射（即時判定）。
//   弾数制（単発ボレー2発・ダブル3発）＝連打では勝てない。撃ち落とせず画面外へ逃げたらミス。
// - クレーの軌道（放出側・横速度・打ち上げ速度）は rng 注入（ctx.random＝日替わりは全員同じ）。
//   弾道は純関数 clayPos(t) の等加速度運動＝完全決定論（検証がミリ秒精度で厳密化）。
// - import してよいのは game-api と同一フォルダのみ（このファイルは依存なし）。

export const W = 360;
export const H = 640;

/** 重力（px/s^2）。ゆるやかな放物線で滞空 約2.5〜3秒 */
export const GRAVITY = 300;
export const CLAY_R = 14;
/** 命中判定の距離（タップ点とクレー中心）。ふつう難易度のねらいやすさ */
export const HIT_DIST = 36;

export const SINGLE_VOLLEYS = 8;
export const DOUBLE_VOLLEYS = 6;
/** 全クレー数 = 単発8 + ダブル6×2 = 20 */
export const TOTAL_CLAYS = SINGLE_VOLLEYS + DOUBLE_VOLLEYS * 2;
export const SHELLS_SINGLE = 2;
export const SHELLS_DOUBLE = 3;

export const HIT_PTS = 20;
/** むだ撃ちなしで当てたボーナス（そのボレーでミスショットする前の命中） */
export const CLEAN_BONUS = 10;
/** ダブル両取りボーナス */
export const PAIR_BONUS = 20;

/** れんぞくヒットボーナス（n = この命中を含む連続数） */
export function streakBonus(n: number): number {
  return 2 * Math.min(Math.max(n - 1, 0), 10);
}

/** 理論最大 = 全20枚をむだ撃ちなしで命中（20×30 + ペア6×20 + 連続290）= 1010 */
export function maxScore(): number {
  let streak = 0;
  for (let k = 1; k <= TOTAL_CLAYS; k++) streak += streakBonus(k);
  return TOTAL_CLAYS * (HIT_PTS + CLEAN_BONUS) + DOUBLE_VOLLEYS * PAIR_BONUS + streak;
}

/** 放出台（左・右）。クレーはここから内向き上方へ飛ぶ */
export const TRAPS = [
  { x: 46, y: 560 },
  { x: 314, y: 560 },
] as const;

/** これより下へ落ちる（または左右へ出る）と「にげられた」 */
export const ESCAPE_Y = 585;

export interface ClayDef {
  x0: number;
  y0: number;
  vx: number; // 右向き正
  vy: number; // 発射時は負（上向き）
}

export interface Volley {
  clays: ClayDef[]; // 1枚（単発）か 2枚（ダブル）
}

/** クレー1枚の軌道パラメータを引く（side: 0=左台から右上へ / 1=右台から左上へ） */
function rollClay(rng: () => number, side: 0 | 1): ClayDef {
  const trap = TRAPS[side];
  const vx = (40 + rng() * 90) * (side === 0 ? 1 : -1);
  const vy = -(380 + rng() * 80);
  return { x0: trap.x, y0: trap.y - 6, vx, vy };
}

/**
 * ボレー計画（前半＝単発8回・後半＝ダブル6回。rng 消費順は固定＝決定論）。
 * ダブルは左右の台から1枚ずつ＝交差する2つの弧。
 */
export function makePlan(rng: () => number): Volley[] {
  const volleys: Volley[] = [];
  for (let i = 0; i < SINGLE_VOLLEYS; i++) {
    const side: 0 | 1 = rng() < 0.5 ? 0 : 1;
    volleys.push({ clays: [rollClay(rng, side)] });
  }
  for (let i = 0; i < DOUBLE_VOLLEYS; i++) {
    volleys.push({ clays: [rollClay(rng, 0), rollClay(rng, 1)] });
  }
  return volleys;
}

/** 発射から t 秒後のクレー位置（等加速度・純関数） */
export function clayPos(c: ClayDef, t: number): { x: number; y: number } {
  return { x: c.x0 + c.vx * t, y: c.y0 + c.vy * t + 0.5 * GRAVITY * t * t };
}

/** にげられたか（下へ落ちきった・左右へ出た） */
export function isEscaped(c: ClayDef, t: number): boolean {
  const p = clayPos(c, t);
  const falling = c.vy + GRAVITY * t > 0;
  return (p.y > ESCAPE_Y && falling) || p.x < -24 || p.x > W + 24;
}

/** タップ (tx,ty) が t 秒時点のクレーに命中するか */
export function hitTest(c: ClayDef, t: number, tx: number, ty: number): boolean {
  const p = clayPos(c, t);
  return Math.hypot(p.x - tx, p.y - ty) <= HIT_DIST;
}
