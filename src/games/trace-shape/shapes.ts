// =============================================================
// まねっこおえかき（No.39）のお手本図形と採点（DOM非依存・純ロジック）
// =============================================================
// - 図形は単位空間（0..1）の折れ線で定義。ゲーム側で design 座標に変換する。
// - 採点＝「せいかくさ」（描いた点がお手本からどれだけ離れていないか）×
//   「ぜんぶなぞれたか」（お手本の各点の近くを描けたか）。各図形200点満点。
// - 乱数は使わない（毎回同じお題＝「今日のゲーム」でも全員同じ）。
// - import してよいのは game-api（types/helpers）と同一フォルダのみ（このファイルは依存なし）。

export interface Pt {
  x: number;
  y: number;
}

export interface ShapeDef {
  key: string;
  name: string;
  closed: boolean;
  /** 単位空間（0..1）の頂点列 */
  pts: Pt[];
}

/** 採点パラメータ（design px 基準） */
export const PERFECT_DIST = 7; // 平均距離がここまでなら「せいかくさ」満点
export const LIMIT_DIST = 34; // ここまで離れると「せいかくさ」0
export const COVER_EPS = 16; // お手本の点がこの距離内に描かれていれば「なぞれた」
export const MIN_STROKE = 30; // これより短いなぞりは無視（誤タッチ対策）
export const ROUND_MAX = 200;

/** ランクしきい値 */
export const RANK_HANAMARU = 170;
export const RANK_MARU = 120;
export const RANK_OSHII = 70;

function circle(): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * Math.PI * 2 - Math.PI / 2;
    pts.push({ x: 0.5 + 0.46 * Math.cos(a), y: 0.5 + 0.46 * Math.sin(a) });
  }
  return pts;
}

function polygonEdges(verts: Pt[], perEdge: number): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i < verts.length; i++) {
    const a = verts[i]!;
    const b = verts[(i + 1) % verts.length]!;
    for (let k = 0; k < perEdge; k++) {
      const t = k / perEdge;
      pts.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }
  return pts;
}

function square(): Pt[] {
  return polygonEdges(
    [
      { x: 0.09, y: 0.09 },
      { x: 0.91, y: 0.09 },
      { x: 0.91, y: 0.91 },
      { x: 0.09, y: 0.91 },
    ],
    8,
  );
}

function triangle(): Pt[] {
  return polygonEdges(
    [
      { x: 0.5, y: 0.06 },
      { x: 0.93, y: 0.86 },
      { x: 0.07, y: 0.86 },
    ],
    10,
  );
}

function star(): Pt[] {
  const verts: Pt[] = [];
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const r = i % 2 === 0 ? 0.48 : 0.19;
    verts.push({ x: 0.5 + r * Math.cos(a), y: 0.52 + r * Math.sin(a) });
  }
  return polygonEdges(verts, 4);
}

function spiral(): Pt[] {
  const pts: Pt[] = [];
  const turns = 2.25;
  const n = 56;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const a = t * turns * Math.PI * 2;
    const r = 0.05 + 0.42 * t;
    pts.push({ x: 0.5 + r * Math.cos(a), y: 0.5 + r * Math.sin(a) });
  }
  return pts;
}

/** 出題順（5ラウンド固定＝だんだん むずかしく） */
export const SHAPES: ShapeDef[] = [
  { key: 'circle', name: 'まる', closed: true, pts: circle() },
  { key: 'square', name: 'しかく', closed: true, pts: square() },
  { key: 'triangle', name: 'さんかく', closed: true, pts: triangle() },
  { key: 'star', name: 'ほし', closed: true, pts: star() },
  { key: 'spiral', name: 'うずまき', closed: false, pts: spiral() },
];

/** 点と線分の距離 */
function segDist(p: Pt, a: Pt, b: Pt): number {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const wx = p.x - a.x;
  const wy = p.y - a.y;
  const c1 = vx * wx + vy * wy;
  if (c1 <= 0) return Math.hypot(wx, wy);
  const c2 = vx * vx + vy * vy;
  if (c2 <= c1) return Math.hypot(p.x - b.x, p.y - b.y);
  const t = c1 / c2;
  return Math.hypot(p.x - (a.x + vx * t), p.y - (a.y + vy * t));
}

/** 点と折れ線の距離（closed なら終点→始点の辺も含む） */
export function distToPolyline(p: Pt, poly: Pt[], closed: boolean): number {
  let best = Infinity;
  const n = poly.length;
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const d = segDist(p, poly[i]!, poly[(i + 1) % n]!);
    if (d < best) best = d;
  }
  return best;
}

export interface TraceResult {
  /** 描いた点のお手本からの平均距離（px） */
  meanDist: number;
  /** お手本のうち「近くを描けた」点の割合 0..1 */
  coverage: number;
  /** このラウンドの得点（0..200） */
  score: number;
}

/**
 * なぞり採点。target/drawn とも design px 座標。
 * せいかくさ = clamp(1-(平均距離-7)/(34-7)) × なぞれた率^1.3 × 200点。
 */
export function scoreTrace(target: Pt[], closed: boolean, drawn: Pt[]): TraceResult {
  if (drawn.length < 2) return { meanDist: Infinity, coverage: 0, score: 0 };
  let sum = 0;
  for (const p of drawn) sum += distToPolyline(p, target, closed);
  const meanDist = sum / drawn.length;
  let covered = 0;
  for (const t of target) {
    if (distToPolyline(t, drawn, false) <= COVER_EPS) covered++;
  }
  const coverage = covered / target.length;
  const acc = Math.max(0, Math.min(1, 1 - (meanDist - PERFECT_DIST) / (LIMIT_DIST - PERFECT_DIST)));
  const score = Math.round(ROUND_MAX * acc * Math.pow(coverage, 1.3));
  return { meanDist, coverage, score };
}

/** ランク表示 */
export function rankOf(score: number): { emoji: string; label: string } {
  if (score >= RANK_HANAMARU) return { emoji: '💮', label: 'はなまる！' };
  if (score >= RANK_MARU) return { emoji: '⭕', label: 'まる！' };
  if (score >= RANK_OSHII) return { emoji: '🔶', label: 'おしい！' };
  return { emoji: '💦', label: 'がんばろう' };
}
