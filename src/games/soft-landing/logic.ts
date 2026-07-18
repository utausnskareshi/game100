// =============================================================
// ふんわりちゃくりく（No.77）のステージ定義と物理（DOM非依存・純ロジック）
// =============================================================
// - ロケットは「押している間だけ上向き噴射」の1ボタン操作。よこ位置は ゆらゆらと
//   自動でスイング（sin波）するので、「いつ降りるか」のタイミングが よこ位置を決める。
// - 着陸パッドに 接地速度 vOk 以下で降りると成功。速すぎ・パッド外は クラッシュ。
// - 乱数は使わない＝完全決定論（スイングもパッドの動きも時間の関数）。
// - import してよいのは game-api と同一フォルダのみ（このファイルは依存なし）。

export const W = 360;
export const H = 640;
/** パッド上面の y。ロケットの下端（y+ROCKET_HALF）がここに着く */
export const PAD_TOP = 560;
export const ROCKET_HALF = 14;
/** 物理の固定サブステップ（フレームレート非依存） */
export const STEP = 1 / 120;
/** 天井（これより上へは行けない） */
export const CEIL_Y = 60;
export const START_Y = 90;
/** ⭐の取得半径 */
export const STAR_R = 22;

export interface StageDef {
  name: string;
  gravity: number; // px/s²
  thrust: number; // 噴射の上向き加速度 px/s²（gravity より大きい＝ホバリング可能）
  burnSec: number; // 満タンで噴射できる秒数
  padX: number;
  padW: number;
  /** パッドが左右にうごく（ステージ5） */
  padMove?: { amp: number; period: number };
  sway: { cx: number; amp: number; period: number };
  vOk: number; // 接地速度がこれ以下なら成功
  stars: { x: number; y: number }[];
}

export const STAGES: StageDef[] = [
  {
    name: 'れんしゅう',
    gravity: 115,
    thrust: 250,
    burnSec: 6.0,
    padX: 180,
    padW: 110,
    sway: { cx: 180, amp: 60, period: 6.0 },
    vOk: 80,
    stars: [
      { x: 216, y: 290 },
      { x: 150, y: 410 },
    ],
  },
  {
    name: 'ずらしパッド',
    gravity: 125,
    thrust: 260,
    burnSec: 5.0,
    padX: 252,
    padW: 86,
    sway: { cx: 180, amp: 85, period: 5.2 },
    vOk: 75,
    stars: [
      { x: 118, y: 280 },
      { x: 238, y: 404 },
    ],
  },
  {
    name: 'ねんりょうせつやく',
    gravity: 95,
    thrust: 240,
    burnSec: 3.4,
    padX: 108,
    padW: 80,
    sway: { cx: 180, amp: 80, period: 5.6 },
    vOk: 75,
    stars: [
      { x: 246, y: 270 },
      { x: 128, y: 392 },
    ],
  },
  {
    name: 'おもいじゅうりょく',
    gravity: 150,
    thrust: 300,
    burnSec: 5.2,
    padX: 196,
    padW: 72,
    sway: { cx: 180, amp: 95, period: 4.6 },
    vOk: 70,
    stars: [
      { x: 104, y: 296 },
      { x: 262, y: 420 },
    ],
  },
  {
    name: 'うごくパッド',
    gravity: 130,
    thrust: 270,
    burnSec: 4.6,
    padX: 180,
    padW: 76,
    padMove: { amp: 70, period: 7.0 },
    sway: { cx: 180, amp: 80, period: 5.0 },
    vOk: 70,
    stars: [
      { x: 124, y: 268 },
      { x: 238, y: 398 },
    ],
  },
];

// ---- スコア ----
export const STAGE_BASE = 100;
export const SOFT_MAX = 60;
export const CENTER_MAX = 50;
export const FUEL_MAX = 50;
export const STAR_PTS = 20;
/** 理論上限（すべて満点＝実際は燃料とふんわりの両立で届かない） */
export const MAX_PER_STAGE = STAGE_BASE + SOFT_MAX + CENTER_MAX + FUEL_MAX + STAR_PTS * 2;

/** 着陸成功時のステージ得点（⭐は別加算） */
export function stagePoints(vy: number, adx: number, padW: number, fuelFrac: number, vOk: number): number {
  const soft = Math.round(SOFT_MAX * Math.max(0, 1 - vy / vOk));
  const center = Math.round(CENTER_MAX * Math.max(0, 1 - adx / (padW / 2)));
  const fuel = Math.round(FUEL_MAX * Math.max(0, Math.min(1, fuelFrac)));
  return STAGE_BASE + soft + center + fuel;
}

/** ロケットの よこ位置（時間の関数・完全決定論） */
export function swayX(st: StageDef, t: number): number {
  return st.sway.cx + st.sway.amp * Math.sin((Math.PI * 2 * t) / st.sway.period);
}

/** パッド中心の よこ位置（うごくパッドは時間の関数） */
export function padXAt(st: StageDef, t: number): number {
  if (!st.padMove) return st.padX;
  return st.padX + st.padMove.amp * Math.sin((Math.PI * 2 * t) / st.padMove.period);
}

export interface FlightState {
  t: number; // ステージ内の物理時間（秒）
  y: number;
  vy: number; // 下向きが正
  fuel: number; // 0〜1
}

export function initialFlight(): FlightState {
  return { t: 0, y: START_Y, vy: 0, fuel: 1 };
}

/**
 * 物理を dt だけ進める（呼び出し側が STEP 刻みで呼ぶ）。
 * thrustHeld＝押している間だけ、燃料を消費して上向き加速。天井では止まる。
 */
export function stepPhysics(s: FlightState, thrustHeld: boolean, st: StageDef, dt: number): void {
  s.t += dt;
  const canThrust = thrustHeld && s.fuel > 0;
  const a = st.gravity - (canThrust ? st.thrust : 0);
  s.vy += a * dt;
  if (canThrust) s.fuel = Math.max(0, s.fuel - dt / st.burnSec);
  s.y += s.vy * dt;
  if (s.y < CEIL_Y) {
    s.y = CEIL_Y;
    if (s.vy < 0) s.vy = 0;
  }
}
