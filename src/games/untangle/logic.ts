// =============================================================
// ひもを ほどく（No.127・かくれゲーム）: 純ロジック（グラフ生成・交差の数）
// =============================================================
// - 点を ドラッグして、ひも（線）の **交差を ゼロ** にする。
// - グラフは「円のうえに ならべると 交差しない」ように 作る（外平面グラフ）。
//   ＝**かならず ほどける**（円ならびが 答えの1つ）。そこから 位置を ばらまく。
// - 交差の数は 線分どうしの まじわりを 数えるだけ＝判定が はっきりしている。
// - 時間制限も しっぱいも ない のんびり系。
// - DOM 非依存・rng 注入＝決定論。
// =============================================================

export interface Graph {
  n: number;
  edges: [number, number][];
}

export interface Layout {
  x: number[];
  y: number[];
}

export interface StageSpec {
  /** 点の数 */
  n: number;
  /** 円の中を またぐ ひもの数 */
  chords: number;
}

export const SPECS: StageSpec[] = [
  { n: 6, chords: 2 },
  { n: 8, chords: 3 },
  { n: 10, chords: 4 },
];

export const STAGE_COUNT = SPECS.length;

/** 点を おける はんい */
export const FIELD = { x0: 34, y0: 132, x1: 326, y1: 500 };
/** 点の 大きさ */
export const NODE_R = 15;
/** 点どうしを これいじょう 近づけない（生成時） */
export const MIN_GAP = 54;

/** 円ならび（交差しない ならべ方の 1つ） */
export function circleLayout(n: number): Layout {
  const cx = (FIELD.x0 + FIELD.x1) / 2;
  const cy = (FIELD.y0 + FIELD.y1) / 2;
  const r = Math.min((FIELD.x1 - FIELD.x0) / 2, (FIELD.y1 - FIELD.y0) / 2) - NODE_R - 4;
  const x: number[] = [];
  const y: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    x.push(cx + Math.cos(a) * r);
    y.push(cy + Math.sin(a) * r);
  }
  return { x, y };
}

/** 円のうえで、ひも (a,b) と (c,d) が 交差するか（はしを 共有していれば しない） */
function chordCross(a: number, b: number, c: number, d: number, n: number): boolean {
  if (a === c || a === d || b === c || b === d) return false;
  const between = (lo: number, hi: number, v: number): boolean => {
    // 円周じょうで lo→hi（時計まわり）の あいだに v が あるか
    let k = (v - lo + n) % n;
    let len = (hi - lo + n) % n;
    return k > 0 && k < len;
  };
  const cIn = between(a, b, c);
  const dIn = between(a, b, d);
  return cIn !== dIn;
}

/**
 * グラフを作る。まわりの ぐるっと1周（0-1-2-…-0）＋交差しない ひもを 何本か。
 * ＝円ならびでは 交差ゼロに なる。
 */
export function makeGraph(rng: () => number, spec: StageSpec): Graph {
  const { n } = spec;
  const edges: [number, number][] = [];
  for (let i = 0; i < n; i++) edges.push([i, (i + 1) % n]);
  // またぐ ひもの 候補（となりどうしは のぞく）
  const cand: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      cand.push([i, j]);
    }
  }
  for (let i = cand.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = cand[i]!;
    cand[i] = cand[j]!;
    cand[j] = t;
  }
  const chords: [number, number][] = [];
  for (const c of cand) {
    if (chords.length >= spec.chords) break;
    let ok = true;
    for (const e of chords) {
      if (chordCross(c[0], c[1], e[0], e[1], n)) {
        ok = false;
        break;
      }
    }
    if (ok) chords.push(c);
  }
  return { n, edges: [...edges, ...chords] };
}

/** 線分 p1-p2 と p3-p4 が まじわるか（はしを 共有する ばあいは false） */
export function segCross(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  x3: number,
  y3: number,
  x4: number,
  y4: number,
): boolean {
  const d = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number =>
    (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const d1 = d(x3, y3, x4, y4, x1, y1);
  const d2 = d(x3, y3, x4, y4, x2, y2);
  const d3 = d(x1, y1, x2, y2, x3, y3);
  const d4 = d(x1, y1, x2, y2, x4, y4);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  return false;
}

/** いまの ならべ方での 交差の数 */
export function crossings(g: Graph, lay: Layout): number {
  let n = 0;
  for (let i = 0; i < g.edges.length; i++) {
    const [a, b] = g.edges[i]!;
    for (let j = i + 1; j < g.edges.length; j++) {
      const [c, d] = g.edges[j]!;
      if (a === c || a === d || b === c || b === d) continue;
      if (segCross(lay.x[a]!, lay.y[a]!, lay.x[b]!, lay.y[b]!, lay.x[c]!, lay.y[c]!, lay.x[d]!, lay.y[d]!)) n++;
    }
  }
  return n;
}

/**
 * ばらまいた ならべ方を作る。点どうしは MIN_GAP いじょう はなし、
 * 交差が 1つ いじょう ある（＝ほどく仕事が ある）ものを 返す。
 */
export function scramble(rng: () => number, g: Graph): Layout {
  let best: Layout | null = null;
  let bestCross = -1;
  for (let attempt = 0; attempt < 400; attempt++) {
    const x: number[] = [];
    const y: number[] = [];
    let ok = true;
    for (let i = 0; i < g.n && ok; i++) {
      let placed = false;
      for (let t = 0; t < 200 && !placed; t++) {
        const px = FIELD.x0 + NODE_R + rng() * (FIELD.x1 - FIELD.x0 - NODE_R * 2);
        const py = FIELD.y0 + NODE_R + rng() * (FIELD.y1 - FIELD.y0 - NODE_R * 2);
        let far = true;
        for (let k = 0; k < x.length; k++) {
          if (Math.hypot(px - x[k]!, py - y[k]!) < MIN_GAP) {
            far = false;
            break;
          }
        }
        if (far) {
          x.push(px);
          y.push(py);
          placed = true;
        }
      }
      if (!placed) ok = false;
    }
    if (!ok) continue;
    const lay: Layout = { x, y };
    const c = crossings(g, lay);
    if (c > bestCross) {
      bestCross = c;
      best = lay;
    }
    if (c >= Math.max(2, g.n / 3)) return lay;
  }
  return best ?? circleLayout(g.n);
}

/** ステージの点（ドラッグが 少ないほど 高い。目安を こえた ぶんだけ へる） */
export function stageScore(drags: number, n: number): number {
  const free = n * 2;
  return Math.max(100, 250 - Math.max(0, drags - free) * 10);
}

/** 満点 */
export function maxScore(): number {
  return STAGE_COUNT * 250;
}
