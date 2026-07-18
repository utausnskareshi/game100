// =============================================================
// ホタルあつめ（No.79）の種類・ふるまい定数と純ロジック（DOM非依存）
// =============================================================
// - あみ（指）を「ゆっくり」近づけないとホタルは逃げる: あみの移動速度（EMA平滑）が
//   おどかし閾値 scare を超えた状態で こわがり半径 fearR に入ると 逃走。
// - あみの中に CATCH_HOLD 秒とどめると つかまえられる（円から出るとゲージは減る）。
// - きんホタルは「光っている間」は超びんかん（そっとでも逃げる）。消えている間に近づく。
// - くもがくれ（3回の固定時間帯）は全員ゆだん＝こわがり半径が縮み、閾値がゆるむ。
// - 失敗ペナルティなしの まったり枠（chill）。乱数は ctx.random 注入＝完全決定論。
// - import してよいのは game-api と同一フォルダのみ（このファイルは依存なし）。

export const W = 360;
export const H = 640;

export const GAME_SEC = 90;
export const NET_R = 44;
/** あみの中にこの秒数とどめたら つかまえ */
export const CATCH_HOLD = 1.1;
/** つかまえたあと 新しいホタルが来るまで */
export const RESPAWN_SEC = 1.5;
/** 同時にいるホタルの数 */
export const POPULATION = 6;

/** ホタルの活動エリア（この外へは誘導で戻る） */
export const AREA = { x0: 24, y0: 78, x1: 336, y1: 552 };

/** くもがくれの時間帯（開始秒・終了秒） */
export const CLOUDS: [number, number][] = [
  [18, 23],
  [43, 48],
  [68, 73],
];

export function inCloud(tSec: number): boolean {
  for (const [a, b] of CLOUDS) if (tSec >= a && tSec < b) return true;
  return false;
}

/** くもがくれ中の こわがり半径倍率と おどかし閾値倍率 */
export const CLOUD_FEAR_MULT = 0.55;
export const CLOUD_SCARE_MULT = 1.6;

/** きんホタルの明滅（光る秒 / 消える秒） */
export const GOLD_ON = 2.4;
export const GOLD_OFF = 1.8;
/** きんホタルが光っている間の おどかし閾値（そっとでも逃げる） */
export const GOLD_ALERT_SCARE = 60;

export interface FlyType {
  name: string;
  pts: number;
  speed: number; // ふだんの移動 px/s
  fearR: number; // こわがり半径
  scare: number; // これより速いあみに おどろく px/s
  color: string;
  weight: number;
}

export const TYPES: FlyType[] = [
  { name: 'みどりホタル', pts: 10, speed: 26, fearR: 70, scare: 260, color: '#9dff6a', weight: 0.6 },
  { name: 'あおホタル', pts: 30, speed: 34, fearR: 95, scare: 170, color: '#6ad8ff', weight: 0.3 },
  { name: 'きんホタル', pts: 100, speed: 30, fearR: 95, scare: 200, color: '#ffd54a', weight: 0.1 },
];

export function rollFlyType(rng: () => number): number {
  const r = rng();
  if (r < 0.6) return 0;
  if (r < 0.9) return 1;
  return 2;
}

/** れんぞく捕獲ボーナス（前の捕獲から8秒以内・n=この捕獲を含む連続数） */
export const STREAK_WINDOW_SEC = 8;
export function streakBonus(n: number): number {
  return 5 * Math.min(Math.max(0, n - 1), 6);
}

export interface Fly {
  type: number;
  x: number;
  y: number;
  heading: number;
  turnF: number; // ふらふらの周波数（個体差）
  seed: number; // ふらふらの位相（個体差）
  glowPhase: number; // 明滅の位相
  state: 'wander' | 'flee';
  fleeUntil: number; // ms
  prog: number; // 捕獲ゲージ（秒）
}

/** きんホタルが光っているか（時間の関数・決定論） */
export function goldGlowOn(tSec: number, glowPhase: number): boolean {
  const cyc = GOLD_ON + GOLD_OFF;
  const p = (tSec + glowPhase) % cyc;
  return p < GOLD_ON;
}

/** ふだんのふらふら移動を dt だけ進める（エリア外では中心へゆるやかに戻す） */
export function wanderStep(f: Fly, tSec: number, dt: number): void {
  const ty = TYPES[f.type] ?? TYPES[0]!;
  f.heading += Math.sin(tSec * f.turnF + f.seed) * 1.9 * dt;
  const inside = f.x >= AREA.x0 && f.x <= AREA.x1 && f.y >= AREA.y0 && f.y <= AREA.y1;
  if (!inside) {
    const want = Math.atan2(330 - f.y, 180 - f.x);
    let d = want - f.heading;
    d = ((d + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    f.heading += Math.max(-3 * dt, Math.min(3 * dt, d));
  }
  const sp = f.state === 'flee' ? 190 : ty.speed;
  f.x += Math.cos(f.heading) * sp * dt;
  f.y += Math.sin(f.heading) * sp * dt;
  // 万一の飛び出しは強制的にエリアへ戻す
  f.x = Math.max(AREA.x0 - 14, Math.min(AREA.x1 + 14, f.x));
  f.y = Math.max(AREA.y0 - 14, Math.min(AREA.y1 + 14, f.y));
}

/**
 * 逃げるべきか（あみの位置・速度に対して）。
 * 戻り値 true なら 呼び出し側が state='flee' にして あみと反対向きへ heading を設定する。
 */
export function shouldFlee(
  f: Fly,
  tSec: number,
  netX: number,
  netY: number,
  netSpeed: number,
  cloud: boolean,
): boolean {
  const ty = TYPES[f.type] ?? TYPES[0]!;
  const fearR = ty.fearR * (cloud ? CLOUD_FEAR_MULT : 1);
  const d = Math.hypot(f.x - netX, f.y - netY);
  if (d > fearR) return false;
  if (f.type === 2 && !cloud && goldGlowOn(tSec, f.glowPhase)) {
    return netSpeed > GOLD_ALERT_SCARE;
  }
  return netSpeed > ty.scare * (cloud ? CLOUD_SCARE_MULT : 1);
}

/** 新しいホタルの出現位置（あみから遠い側の外周から）。rng は位置ゆらぎに使う */
export function spawnPos(rng: () => number, netX: number, netY: number): { x: number; y: number } {
  // 8方位の外周アンカー
  const anchors = [
    { x: AREA.x0 + 10, y: AREA.y0 + 10 },
    { x: 180, y: AREA.y0 + 6 },
    { x: AREA.x1 - 10, y: AREA.y0 + 10 },
    { x: AREA.x0 + 6, y: 320 },
    { x: AREA.x1 - 6, y: 320 },
    { x: AREA.x0 + 10, y: AREA.y1 - 10 },
    { x: 180, y: AREA.y1 - 6 },
    { x: AREA.x1 - 10, y: AREA.y1 - 10 },
  ];
  const idx = Math.min(anchors.length - 1, Math.floor(rng() * anchors.length));
  let a = anchors[idx]!;
  if (Math.hypot(a.x - netX, a.y - netY) < 130) {
    // あみに近すぎたら 反対側のアンカーへ
    a = anchors[anchors.length - 1 - idx]!;
  }
  return { x: a.x + (rng() - 0.5) * 24, y: a.y + (rng() - 0.5) * 24 };
}
