// =============================================================
// スパッとフルーツ（No.91）: 純ロジック（決定論・rng注入・テスト対象）
// =============================================================
// - 出現（planGroup）は rng を「毎オブジェクト固定回数」だけ引く＝順序が安定＝完全決定論。
//   「今日のゲーム」では日替わり共通シードなので全員おなじ出題になる。
// - 物体の位置は born からの経過秒 t の閉形式（放物運動）で求める＝フレーム間隔に依存しない。
// - ここには platform/shell 非依存の純粋な数学・出題ロジックだけを置く。
// =============================================================

/** 設計解像度（縦） */
export const W = 360;
export const H = 640;

/** 重力加速度（px/s^2）。放物運動の落下に使う */
export const GRAVITY = 900;

/** フルーツの色（見た目の種類）数 */
export const NFRUIT = 6;

/** フルーツ1この基礎点 */
export const FRUIT_PTS = 10;

export type ObjKind = 'fruit' | 'bomb';

/** 1オブジェクトの発射スペック（位置は born + 経過時間から後で計算する） */
export interface SpawnSpec {
  kind: ObjKind;
  /** フルーツの色 index（bomb では無視） */
  color: number;
  /** 発射 x（論理px） */
  x0: number;
  /** 水平速度（px/s） */
  vx: number;
  /** 垂直初速（px/s・上向き＝負） */
  vy: number;
  /** 半径 */
  r: number;
  /** 回転速度（rad/s） */
  vrot: number;
}

export interface GroupPlan {
  specs: SpawnSpec[];
  /** 次のグループまでのミリ秒 */
  nextMs: number;
}

/** elapsedMs から難易度レベル（0〜6）を求める。約12秒で1段上がる */
export function levelOf(elapsedMs: number): number {
  return Math.min(6, Math.floor(Math.max(0, elapsedMs) / 12000));
}

/**
 * 1グループ分の出現を計画する。
 * rng は必ず「グループ人数決定に1回 → 各オブジェクトに7回 → 次回間隔ジッタに1回」の
 * 固定順で引く（difficulty のしきい値を変えても引く回数は不変＝決定論が壊れない）。
 */
export function planGroup(rng: () => number, elapsedMs: number): GroupPlan {
  const level = levelOf(elapsedMs);
  // グループ人数（1〜5）。レベルが上がると増える
  const minC = 1 + Math.floor(level / 3); // 1..3
  const maxC = Math.min(5, 2 + level); // 2..5
  const count = clampInt(minC + Math.floor(rng() * (maxC - minC + 1)), 1, 5);
  // ばくだん確率（最初の6秒は0＝つかみをやさしく）
  const bombP = elapsedMs < 6000 ? 0 : Math.min(0.2, 0.06 + level * 0.022);

  const specs: SpawnSpec[] = [];
  for (let i = 0; i < count; i++) {
    // 毎オブジェクト7回、固定順で引く
    const rB = rng();
    const rx = rng();
    const rvx = rng();
    const rvy = rng();
    const rr = rng();
    const rrot = rng();
    const rcol = rng();
    const kind: ObjKind = rB < bombP ? 'bomb' : 'fruit';
    const x0 = 46 + rx * (W - 92);
    const vx = (rvx * 2 - 1) * (55 + level * 10);
    const vy = -(815 + rvy * 150 + level * 12); // 上向き
    const r = kind === 'bomb' ? 25 : 23 + rr * 6;
    const vrot = (rrot * 2 - 1) * 3;
    const color = Math.floor(rcol * NFRUIT) % NFRUIT;
    specs.push({ kind, color, x0, vx, vy, r, vrot });
  }
  // 次回までの間隔（レベルが上がるほど短い）＋ジッタ
  const base = Math.max(680, 1500 - level * 128);
  const nextMs = Math.round(base * (0.82 + rng() * 0.36));
  return { specs, nextMs };
}

/** 1スワイプで n こ切ったときのコンボ加点（2こ未満は0） */
export function comboBonus(n: number): number {
  return n >= 2 ? n * 15 : 0;
}

/**
 * 放物運動の位置。t = (now - born) / 1000 秒。
 * y0 は「画面下ぎりぎり（H + r）」から上へ打ち上がる前提で呼び出し側が渡す。
 */
export function posAt(
  o: { x0: number; y0: number; vx: number; vy: number },
  now: number,
  born: number,
): { x: number; y: number } {
  const t = (now - born) / 1000;
  return { x: o.x0 + o.vx * t, y: o.y0 + o.vy * t + 0.5 * GRAVITY * t * t };
}

/** 打ち上げてから画面下（開始高さ）へ戻ってくるまでのミリ秒（対称なので -2vy/g） */
export function fallBackMs(vy: number): number {
  return (-2 * vy) / GRAVITY * 1000;
}

/**
 * 線分 (ax,ay)-(bx,by) と 円 (cx,cy,r) が交わるか。
 * スワイプの1区間がフルーツを横切ったかの判定に使う（純幾何・テスト対象）。
 */
export function segCircleHit(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  r: number,
): boolean {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = 0;
  if (len2 > 1e-9) {
    t = ((cx - ax) * dx + (cy - ay) * dy) / len2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
  }
  const px = ax + dx * t;
  const py = ay + dy * t;
  const ex = cx - px;
  const ey = cy - py;
  return ex * ex + ey * ey <= r * r;
}

function clampInt(v: number, min: number, max: number): number {
  const n = Math.round(v);
  return n < min ? min : n > max ? max : n;
}
