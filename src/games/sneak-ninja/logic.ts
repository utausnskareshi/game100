// =============================================================
// こっそりにんじゃ（No.64）のステージと視界判定（DOM非依存・純ロジック）
// =============================================================
// - しげみ（ノード）を線（エッジ）でつないだ夜の庭。見張りの「光の扇」が
//   回転/往復し、ダッシュ中に光に入ると見つかる（しげみの上は安全）。
// - 理不尽防止の保証: どのエッジにも「ダッシュ時間＋余白」以上の安全な窓が
//   くり返し訪れることを、位相を選ぶときに検証する（再抽選は打ち切り付き。
//   だめなら位相0＝手調整済みの既定値に落とす。既定値の健全性はテストで実証）。
// - 乱数は位相選びだけ（ctx.random 注入＝日替わり同一）。時間は呼び出し側が渡す。
// - import してよいのは game-api と同一フォルダのみ（このファイルは依存なし）。

export const DASH_SPEED = 200; // px/s
/** 安全窓に要求する余白（ダッシュ時間に加算・秒） */
export const WINDOW_PAD = 0.45;
export const DANGO_PTS = 20;
export const CLEAR_PTS = 100;
export const NO_FOUND_PTS = 50;
/** クリアの速さボーナス: max(0, TIME_BASE - 経過秒) × TIME_PTS */
export const TIME_BASE = 45;
export const TIME_PTS = 2;

export interface Guard {
  x: number;
  y: number;
  /** 光のとどく距離 */
  r: number;
  /** 扇の半分の角度（ラジアン） */
  half: number;
  kind: 'rot' | 'sweep';
  /** rot: 角速度 rad/s */
  speed: number;
  /** sweep: 中心角・振れ幅・周期 */
  center: number;
  amp: number;
  period: number;
}

export interface StageDef {
  nodes: { x: number; y: number }[];
  edges: [number, number][];
  start: number;
  goal: number;
  dango: number[];
  guards: Guard[];
}

const rot = (x: number, y: number, r: number, half: number, speed: number): Guard => ({
  x, y, r, half, kind: 'rot', speed, center: 0, amp: 0, period: 1,
});
const sweep = (x: number, y: number, r: number, half: number, center: number, amp: number, period: number): Guard => ({
  x, y, r, half, kind: 'sweep', speed: 0, center, amp, period,
});

export function makeStages(): StageDef[] {
  return [
    // ステージ1: 見張り1人（回転）
    {
      nodes: [
        { x: 180, y: 545 }, // 0 start
        { x: 75, y: 470 },
        { x: 285, y: 465 },
        { x: 180, y: 385 },
        { x: 70, y: 295 },
        { x: 290, y: 285 },
        { x: 180, y: 200 },
        { x: 180, y: 105 }, // 7 goal
      ],
      edges: [
        [0, 1], [0, 2], [1, 3], [2, 3], [3, 4], [3, 5], [4, 6], [5, 6], [6, 7],
      ],
      start: 0,
      goal: 7,
      dango: [1, 4, 5],
      guards: [rot(180, 300, 140, 0.5, 1.1)],
    },
    // ステージ2: 見張り2人（回転＋往復）
    {
      nodes: [
        { x: 180, y: 555 }, // 0 start
        { x: 60, y: 480 },
        { x: 300, y: 480 },
        { x: 60, y: 370 },
        { x: 300, y: 370 },
        { x: 180, y: 320 },
        { x: 65, y: 225 },
        { x: 295, y: 225 },
        { x: 180, y: 95 }, // 8 goal
      ],
      edges: [
        [0, 1], [0, 2], [1, 3], [2, 4], [3, 5], [4, 5], [3, 6], [4, 7], [5, 6], [5, 7], [6, 8], [7, 8],
      ],
      start: 0,
      goal: 8,
      dango: [1, 4, 6, 7],
      guards: [rot(180, 410, 120, 0.48, -1.4), sweep(180, 175, 130, 0.55, Math.PI / 2, 1.2, 3.2)],
    },
    // ステージ3: 見張り3人（回転×2＋往復）
    {
      nodes: [
        { x: 180, y: 560 }, // 0 start
        { x: 65, y: 500 },
        { x: 295, y: 500 },
        { x: 180, y: 450 },
        { x: 60, y: 360 },
        { x: 300, y: 360 },
        { x: 180, y: 300 },
        { x: 65, y: 215 },
        { x: 295, y: 215 },
        { x: 180, y: 155 },
        { x: 180, y: 80 }, // 10 goal
      ],
      edges: [
        [0, 1], [0, 2], [1, 3], [2, 3], [3, 4], [3, 5], [4, 6], [5, 6], [6, 7], [6, 8], [7, 9], [8, 9], [9, 10],
      ],
      start: 0,
      goal: 10,
      dango: [2, 4, 5, 7, 8],
      // 数値探索で「全エッジに安全窓が2回以上」×「被覆10エッジ・最大55%」を両立させた配置
      guards: [rot(122, 405, 104, 0.41, 1.52), rot(260, 274, 108, 0.42, -1.47), sweep(81, 109, 95, 0.54, 0.16, 0.93, 3.5)],
    },
  ];
}

/** 角度差を -π〜π に正規化した絶対値 */
export function angDiff(a: number, b: number): number {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return Math.abs(d);
}

/** 見張りの光の向き（tSec 秒時点。phase は位相オフセット） */
export function guardDir(gd: Guard, tSec: number, phase: number): number {
  if (gd.kind === 'rot') return phase + gd.speed * tSec;
  return gd.center + gd.amp * Math.sin((Math.PI * 2 * tSec) / gd.period + phase);
}

/** 点 (px,py) が見張りの光の扇に入っているか */
export function pointInCone(gd: Guard, dir: number, px: number, py: number): boolean {
  const dx = px - gd.x;
  const dy = py - gd.y;
  if (dx * dx + dy * dy > gd.r * gd.r) return false;
  return angDiff(Math.atan2(dy, dx), dir) <= gd.half;
}

export function edgeLen(s: StageDef, ei: number): number {
  const [a, b] = s.edges[ei]!;
  const na = s.nodes[a]!;
  const nb = s.nodes[b]!;
  return Math.hypot(nb.x - na.x, nb.y - na.y);
}

export const dashSec = (s: StageDef, ei: number): number => edgeLen(s, ei) / DASH_SPEED;

/**
 * tSec 時点でエッジが（部分的にでも）光に入っているか。
 * 線分上の9点をサンプルして判定する保守的チェック
 * （「エッジ全体が安全」な窓の間にダッシュすれば必ず安全）。
 */
export function edgeCoveredAt(s: StageDef, phases: number[], ei: number, tSec: number): boolean {
  const [a, b] = s.edges[ei]!;
  const na = s.nodes[a]!;
  const nb = s.nodes[b]!;
  for (let gi = 0; gi < s.guards.length; gi++) {
    const gd = s.guards[gi]!;
    const dir = guardDir(gd, tSec, phases[gi] ?? 0);
    for (let k = 0; k <= 8; k++) {
      const f = k / 8;
      if (pointInCone(gd, dir, na.x + (nb.x - na.x) * f, na.y + (nb.y - na.y) * f)) return true;
    }
  }
  return false;
}

/** fromSec 以降で最初に来る「needSec 連続で安全」な窓の開始時刻（なければ -1） */
export function findWindow(s: StageDef, phases: number[], ei: number, fromSec: number, horizonSec: number, needSec: number): number {
  const dt = 0.05;
  let clearFrom = -1;
  for (let t = fromSec; t <= fromSec + horizonSec; t += dt) {
    if (edgeCoveredAt(s, phases, ei, t)) {
      clearFrom = -1;
    } else {
      if (clearFrom < 0) clearFrom = t;
      if (t - clearFrom >= needSec) return clearFrom;
    }
  }
  return -1;
}

/** すべてのエッジに安全な窓が「くり返し」訪れるか（24秒間に2回以上） */
export function verifyPhases(s: StageDef, phases: number[]): boolean {
  for (let ei = 0; ei < s.edges.length; ei++) {
    const need = dashSec(s, ei) + WINDOW_PAD;
    const w1 = findWindow(s, phases, ei, 0, 24, need);
    if (w1 < 0) return false;
    const w2 = findWindow(s, phases, ei, w1 + need + 0.5, 24, need);
    if (w2 < 0) return false;
  }
  return true;
}

/** 位相を rng で選ぶ（検証つき・再抽選40回で打ち切り→既定の位相0に落とす） */
export function pickPhases(s: StageDef, rng: () => number): number[] {
  for (let tries = 0; tries < 40; tries++) {
    const phases = s.guards.map(() => rng() * Math.PI * 2);
    if (verifyPhases(s, phases)) return phases;
  }
  return s.guards.map(() => 0);
}
