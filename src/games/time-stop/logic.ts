// =============================================================
// とまった せかい（No.108・かくれゲーム）: 純ロジック（世界時間・ステージ・当たり）
// =============================================================
// - この世界の時間は「指を動かしたぶんだけ」すすむ。指を止めれば 弾も棒も 完全に止まる。
//   ＝反射神経ではなく「どの道を通るか」を考える遊び。
// - じゃまものの位置は 世界時間 wt の関数（積分しない）＝完全に決定論で、巻きもどしても同じ。
// - 動ける きょり（budget）に上限があるので、よけるための むだ動きも コストになる。
// - DOM 非依存。ステージが実際に通れることは、テストのボットで実証している。
// =============================================================

/** 世界時間のサブステップ（秒）。すり抜け防止のため これ以上は一気に進めない */
export const SUB_DT = 1 / 120;
/** 何 px 動かすと 世界が1秒すすむか（240px = 1秒） */
export const SEC_PER_PX = 1 / 240;
/** じぶんの大きさ */
export const PLAYER_R = 9;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Pt {
  x: number;
  y: number;
}

/** まっすぐ 行ったり来たり する たま */
export interface Runner {
  kind: 'runner';
  ax: number;
  ay: number;
  bx: number;
  by: number;
  /** px/秒（世界時間） */
  speed: number;
  /** ずらし（0〜1で 経路上の どこから 始まるか） */
  phase: number;
  r: number;
}

/** まわる ぼう */
export interface Spinner {
  kind: 'spinner';
  cx: number;
  cy: number;
  len: number;
  /** ラジアン/秒（世界時間） */
  omega: number;
  phase: number;
  r: number;
}

export type Hazard = Runner | Spinner;

export interface Stage {
  walls: Rect[];
  stars: Pt[];
  start: Pt;
  hazards: Hazard[];
  /** 動ける きょり（px） */
  budget: number;
}

const wall = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h });

/** 盤のわく（外に出られないようにする） */
const FRAME: Rect[] = [
  wall(-40, -40, 440, 40 + 96),
  wall(-40, 560, 440, 80),
  wall(-40, 56, 40, 520),
  wall(360, 56, 40, 520),
];

/**
 * 全5ステージ。だんだん通り道が細くなり、きょりの余裕も減っていく。
 * ※ 実際に通れること（＝クリアできること）はテストのボットで実証している。
 */
export const STAGES: Stage[] = [
  // 1: たまが1つ 横切るだけ。時間の仕組みに なれる面
  {
    walls: [...FRAME],
    stars: [
      { x: 180, y: 180 },
      { x: 180, y: 460 },
    ],
    start: { x: 60, y: 520 },
    hazards: [{ kind: 'runner', ax: 40, ay: 320, bx: 320, by: 320, speed: 150, phase: 0, r: 12 }],
    budget: 1100,
  },
  // 2: 上下2本の通路と たま2つ
  {
    walls: [...FRAME, wall(80, 240, 200, 18), wall(80, 400, 200, 18)],
    stars: [
      { x: 300, y: 150 },
      { x: 60, y: 330 },
      { x: 300, y: 500 },
    ],
    start: { x: 60, y: 150 },
    hazards: [
      { kind: 'runner', ax: 40, ay: 320, bx: 320, by: 320, speed: 170, phase: 0.35, r: 12 },
      { kind: 'runner', ax: 320, ay: 480, bx: 40, by: 480, speed: 150, phase: 0.1, r: 12 },
    ],
    budget: 1500,
  },
  // 3: まわる ぼうの まわりを 通る
  {
    walls: [...FRAME],
    stars: [
      { x: 60, y: 140 },
      { x: 300, y: 140 },
      { x: 300, y: 500 },
      { x: 60, y: 500 },
    ],
    start: { x: 180, y: 520 },
    hazards: [{ kind: 'spinner', cx: 180, cy: 320, len: 130, omega: 1.5, phase: 0, r: 9 }],
    budget: 1600,
  },
  // 4: 細い たてみち＋よこに走る たま3つ
  {
    walls: [...FRAME, wall(90, 150, 18, 300), wall(252, 150, 18, 300)],
    stars: [
      { x: 180, y: 130 },
      { x: 180, y: 300 },
      { x: 180, y: 480 },
    ],
    start: { x: 180, y: 530 },
    hazards: [
      { kind: 'runner', ax: 130, ay: 220, bx: 230, by: 220, speed: 130, phase: 0, r: 11 },
      { kind: 'runner', ax: 230, ay: 320, bx: 130, by: 320, speed: 150, phase: 0.3, r: 11 },
      { kind: 'runner', ax: 130, ay: 420, bx: 230, by: 420, speed: 170, phase: 0.6, r: 11 },
    ],
    budget: 1500,
  },
  // 5: ぼう2本＋たま2つ。きょりの余裕も いちばん少ない
  {
    walls: [...FRAME, wall(150, 250, 60, 16), wall(150, 380, 60, 16)],
    stars: [
      { x: 60, y: 130 },
      { x: 300, y: 130 },
      { x: 60, y: 520 },
      { x: 300, y: 520 },
    ],
    start: { x: 180, y: 320 },
    hazards: [
      // ※ ぼうの先が スタート地点(180,320)に とどかないよう 位置と長さを決めてある
      { kind: 'spinner', cx: 70, cy: 320, len: 85, omega: 1.8, phase: 0, r: 8 },
      { kind: 'spinner', cx: 290, cy: 320, len: 85, omega: -1.8, phase: 1.2, r: 8 },
      { kind: 'runner', ax: 40, ay: 190, bx: 320, by: 190, speed: 190, phase: 0.2, r: 10 },
      { kind: 'runner', ax: 320, ay: 452, bx: 40, by: 452, speed: 190, phase: 0.7, r: 10 },
    ],
    budget: 1800,
  },
];

/** じゃまものの いまの位置（世界時間 wt の関数＝積分しない） */
export function hazardPos(h: Hazard, wt: number): { x: number; y: number; x2: number; y2: number } {
  if (h.kind === 'runner') {
    const dx = h.bx - h.ax;
    const dy = h.by - h.ay;
    const len = Math.hypot(dx, dy);
    const cycle = len * 2;
    let u = (h.speed * wt + h.phase * cycle) % cycle;
    if (u < 0) u += cycle;
    const s = u <= len ? u : cycle - u;
    const x = h.ax + (dx / len) * s;
    const y = h.ay + (dy / len) * s;
    return { x, y, x2: x, y2: y };
  }
  const a = h.phase + h.omega * wt;
  return {
    x: h.cx,
    y: h.cy,
    x2: h.cx + Math.cos(a) * h.len,
    y2: h.cy + Math.sin(a) * h.len,
  };
}

/** 点と線分の きょり */
export function distToSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-9) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

/** その位置・その世界時間で じゃまものに 当たっているか */
export function isHit(stage: Stage, wt: number, px: number, py: number): boolean {
  for (const h of stage.hazards) {
    const p = hazardPos(h, wt);
    const d = h.kind === 'runner' ? Math.hypot(px - p.x, py - p.y) : distToSeg(px, py, p.x, p.y, p.x2, p.y2);
    if (d < h.r + PLAYER_R) return true;
  }
  return false;
}

/** ステージの点（きょりを のこすほど 高い） */
export function stageScore(remain: number): number {
  return 150 + Math.max(0, Math.floor(remain / 6));
}
