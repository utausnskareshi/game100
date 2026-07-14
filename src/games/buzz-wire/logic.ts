// =============================================================
// ビリビリワイヤー（No.42）のコース生成と幾何（DOM非依存・純ロジック）
// =============================================================
// - コースは「つづら折り」: 横に長く走る段（ゆらゆら波うち）を、大きなUターンでつなぐ。
//   段の間隔(≈92px) > 通路のふとさ(≤54px) なので、通路どうしが重なって見えない。
// - あたり判定は「たまの中心が、みちの中心線から widht/2 をこえたらビリッ」＝
//   中心線をなぞれば必ず通れる（行きどまり・ピンチが構造的に存在しない）。
// - 乱数は注入（ctx.random）。1コースの消費は 段6×3回=18回で固定＝日替わり同一コース。
// - import してよいのは game-api（types/helpers）と同一フォルダのみ（このファイルは依存なし）。

export type Rng = () => number;

export interface Pt {
  x: number;
  y: number;
}

/** たまの半径 */
export const BALL_R = 8;
/** ゆびの少し上にたまが浮く（ゆびで見えなくならないように） */
export const FINGER_OFFSET_Y = -34;
/** コースごとの通路のふとさ（たま中心の許容 = width/2） */
export const COURSE_WIDTHS = [54, 44, 36] as const;
/** ゴール判定: 終点にこの距離まで近づく＋進みが最後まで */
export const GOAL_DIST = 26;

const ROWS = 6;
const ROW_GAP = 92;
const Y_BOTTOM = 566;
const X_MIN = 88;
const X_MAX = 252;
const ROW_STEP = 23;

/**
 * 1コース生成。段ごとに (yゆらぎ・波の強さ・波の位相) の3回だけ乱数を消費（合計18回固定）。
 * wobbleAmp が大きいほど段がうねる（コース2・3で増える）。
 */
export function generateCourse(rng: Rng, wobbleAmp: number): Pt[] {
  const pts: Pt[] = [];
  const ys: number[] = [];
  const amps: number[] = [];
  const phases: number[] = [];
  for (let i = 0; i < ROWS; i++) {
    ys.push(Y_BOTTOM - i * ROW_GAP + (rng() * 2 - 1) * 6);
    amps.push(wobbleAmp * (0.45 + rng() * 0.55));
    phases.push(rng() * Math.PI * 2);
  }
  for (let i = 0; i < ROWS; i++) {
    const rightward = i % 2 === 0;
    const xFrom = rightward ? X_MIN : X_MAX;
    const xTo = rightward ? X_MAX : X_MIN;
    const dir = rightward ? 1 : -1;
    // 段（波うち）
    for (let x = xFrom; dir > 0 ? x <= xTo : x >= xTo; x += ROW_STEP * dir) {
      const t = (x - xFrom) / (xTo - xFrom);
      pts.push({ x, y: ys[i]! + Math.sin(phases[i]! + t * Math.PI * 3) * amps[i]! });
    }
    // Uターン（次の段へ半円。最後の段のあとは無し）
    if (i < ROWS - 1) {
      const cx = xTo;
      const y1 = ys[i]! + Math.sin(phases[i]! + Math.PI * 3) * amps[i]!;
      const yNext = ys[i + 1]!;
      const y2 = yNext + Math.sin(phases[i + 1]!) * amps[i + 1]!;
      const cy = (y1 + y2) / 2;
      const r = (y1 - y2) / 2;
      for (let k = 1; k <= 7; k++) {
        const a = (k / 8) * Math.PI;
        pts.push({ x: cx + Math.sin(a) * r * dir, y: cy + Math.cos(a) * r });
      }
    }
  }
  return pts;
}

/** 折れ線の累積長（cum[i] = pts[0..i] までの道のり） */
export function cumulative(pts: Pt[]): number[] {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    cum.push(cum[i - 1]! + Math.hypot(b.x - a.x, b.y - a.y));
  }
  return cum;
}

function segProject(p: Pt, a: Pt, b: Pt): { d: number; t: number } {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const wx = p.x - a.x;
  const wy = p.y - a.y;
  const c2 = vx * vx + vy * vy;
  const t = c2 > 0 ? Math.max(0, Math.min(1, (vx * wx + vy * wy) / c2)) : 0;
  const dx = p.x - (a.x + vx * t);
  const dy = p.y - (a.y + vy * t);
  return { d: Math.hypot(dx, dy), t };
}

export interface Projection {
  /** 中心線までの距離 */
  dist: number;
  /** みちの始点からの道のり */
  s: number;
}

/**
 * 点をみちに投影する。sNear（いまの進み）の前後 [sNear-back, sNear+ahead] の区間だけを見る
 * ＝となりの段への「ワープ」やショートカットを構造的に防ぐ。
 */
export function projectNear(pts: Pt[], cum: number[], p: Pt, sNear: number, back = 60, ahead = 110): Projection {
  let best: Projection = { dist: Infinity, s: sNear };
  for (let i = 1; i < pts.length; i++) {
    const s0 = cum[i - 1]!;
    if (s0 > sNear + ahead) break;
    if (cum[i]! < sNear - back) continue;
    const pr = segProject(p, pts[i - 1]!, pts[i]!);
    const s = s0 + (cum[i]! - s0) * pr.t;
    if (pr.d < best.dist) best = { dist: pr.d, s };
  }
  return best;
}

/** チェックポイントの点index（25% / 50% / 75%地点） */
export function checkpointIndices(pts: Pt[]): number[] {
  return [0.25, 0.5, 0.75].map((f) => Math.floor(pts.length * f));
}
