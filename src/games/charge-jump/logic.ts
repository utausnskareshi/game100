// =============================================================
// ためてジャンプ（No.40）の足場生成とジャンプ計算（DOM非依存・純ロジック）
// =============================================================
// - おしている長さ→パワー→とび距離は単調（ためるほど遠くへ）。
// - 足場は index が進むほど「せまく・遠く・動く」＝だんだん難しくなる。
// - 乱数は注入（ctx.random）。足場1枚の抽選で消費する乱数は常に4回＝日替わりで全員同じコース。
// - import してよいのは game-api（types/helpers）と同一フォルダのみ（このファイルは依存なし）。

export type Rng = () => number;

/** ためきるまでの時間（ms） */
export const CHARGE_MS = 900;
/** とび距離 = DIST_MIN + power × DIST_RANGE（px） */
export const DIST_MIN = 40;
export const DIST_RANGE = 220;
/** 滞空時間 = 430 + power × 170（ms） */
export const JUMP_MS_BASE = 430;
export const JUMP_MS_RANGE = 170;
/** 「ピタッ」＝足場中心から 幅×この割合 いない */
export const PITA_FRAC = 0.22;

/** power(0..1) → とび距離（px）。単調増加 */
export function jumpDist(power: number): number {
  const p = Math.max(0, Math.min(1, power));
  return DIST_MIN + p * DIST_RANGE;
}

/** power(0..1) → 滞空時間（ms） */
export function jumpMs(power: number): number {
  const p = Math.max(0, Math.min(1, power));
  return JUMP_MS_BASE + p * JUMP_MS_RANGE;
}

export interface Platform {
  /** 足場中心の基準x（world px） */
  baseCx: number;
  /** 幅（px） */
  w: number;
  moving: boolean;
  /** 動く足場の振れ幅（px）と速さ（rad/s）・位相 */
  amp: number;
  speed: number;
  phase: number;
}

/** index → 難しさ 0..1（25枚で最大） */
export function rampAt(index: number): number {
  return Math.min(1, index / 25);
}

/** index → 足場の幅（70 → 34px。乱数なしの決定的ランプ） */
export function widthAt(index: number): number {
  return Math.round(70 - rampAt(index) * 36);
}

/**
 * 次の足場を抽選する（乱数消費は常に4回）。
 * 中心間かくは「両方の半幅＋26〜136px」＝最悪の立ち位置からでも最大ジャンプ260pxで届き、
 * 最小ジャンプ40pxで近すぎて飛びこせないことがない範囲に収まる。
 */
export function rollPlatform(rng: Rng, index: number, prev: Platform): Platform {
  const t = rampAt(index);
  const w = widthAt(index);
  const gap = (prev.w + w) / 2 + 26 + rng() * 50 + t * 60;
  const movingRoll = rng();
  const amp = 10 + rng() * 14;
  const speed = 1.2 + rng() * 1.4;
  const moving = index >= 8 && movingRoll < 0.15 + 0.4 * t;
  return {
    baseCx: prev.baseCx + gap,
    w,
    moving,
    amp: moving ? amp : 0,
    speed: moving ? speed : 0,
    phase: index * 1.7,
  };
}

/** 最初の足場（乱数なし） */
export function firstPlatform(): Platform {
  return { baseCx: 90, w: 80, moving: false, amp: 0, speed: 0, phase: 0 };
}

/** 足場中心の現在x（tMs=プレイ経過ms） */
export function platformCx(p: Platform, tMs: number): number {
  return p.moving ? p.baseCx + Math.sin(p.phase + (p.speed * tMs) / 1000) * p.amp : p.baseCx;
}

/** 着地の得点（pita=ピタッだったか・streak=この着地を含めた連続ピタッ数） */
export function landPoints(pita: boolean, streak: number): number {
  return 10 + (pita ? 10 + 3 * Math.min(streak - 1, 5) : 0);
}
