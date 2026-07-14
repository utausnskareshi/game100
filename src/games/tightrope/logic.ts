// =============================================================
// つなわたりバランス（No.38）の物理と定数（DOM非依存・純ロジック）
// =============================================================
// - 倒立振子: θ''=K·sinθ+u。まっすぐ（θ=0）は不安定＝ほうっておくと必ず倒れる。
// - 距離がのびるほど K（倒れやすさ）と歩く速さが上がる＝だんだん難しくなる。
// - 乱数は注入（ctx.random）。風1回の抽選で消費する乱数は常に3回。
// - import してよいのは game-api（types/helpers）と同一フォルダのみ（このファイルは依存なし）。

export type Rng = () => number;

/** 倒れ判定（40°）。これを超えたら落下 */
export const FALL_RAD = (40 * Math.PI) / 180;
/** 立てなおしボーナス: ここまで傾いてから… */
export const RECOV_IN = (25 * Math.PI) / 180;
/** …ここまで戻すと1回の「立てなおし」 */
export const RECOV_OUT = (5 * Math.PI) / 180;
/** 画面ホールドの復元力（rad/s²） */
export const U_HOLD = 2.8;
/** かたむき（tilt.x=±1）の最大復元力（rad/s²） */
export const U_TILT = 4.0;
/** ゴール距離（m） */
export const GOAL_M = 200;
/** 物理サブステップ（block-break/air-hockey と同じ流儀） */
export const SUBSTEP = 1 / 120;

/** 倒れやすさ K（rad/s²）。0m=2.2 → 200m=3.4 */
export function gravAt(dist: number): number {
  return 2.2 + Math.min(1.2, (dist / 100) * 0.6);
}

/** 歩く速さ（m/s）。0m=1.5 → 80m以降=2.7 */
export function walkAt(dist: number): number {
  return 1.5 + Math.min(1.2, (dist / 80) * 1.2);
}

export interface Pendulum {
  /** 傾き（rad・右が正） */
  th: number;
  /** 角速度（rad/s） */
  om: number;
}

/** 1サブステップ進める（u=そのときの入力+風の合計加速度） */
export function stepPendulum(p: Pendulum, u: number, k: number, dt: number): void {
  p.om += (k * Math.sin(p.th) + u) * dt;
  p.th += p.om * dt;
}

export interface WindRoll {
  /** つぎの風までの待ち（ms） */
  delayMs: number;
  /** 風向き（-1=左へ / +1=右へ押す） */
  dir: -1 | 1;
  /** 基本の強さ（rad/s²）。距離スケールはゲーム側で掛ける */
  base: number;
}

/** 風の抽選。乱数消費は常に3回 */
export function rollWind(rng: Rng): WindRoll {
  const delayMs = 3800 + rng() * 2800;
  const dir: -1 | 1 = rng() < 0.5 ? -1 : 1;
  const base = 1.3 + rng() * 1.0;
  return { delayMs, dir, base };
}

/** 風の強さの距離スケール（遠くへ行くほど強い） */
export function windScaleAt(dist: number): number {
  return 1 + Math.min(0.5, dist / 160);
}

/** 風の予告時間と持続時間（ms） */
export const WIND_TELEGRAPH_MS = 700;
export const WIND_GUST_MS = 900;

/** スコア: 1mごとに10点＋立てなおし1回5点 */
export function scoreOf(dist: number, recoveries: number): number {
  return Math.floor(dist) * 10 + recoveries * 5;
}
