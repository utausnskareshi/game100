// =============================================================
// いろの かいだん（No.116・かくれゲーム）: 純ロジック（グラデーション盤）
// =============================================================
// - 4すみの色は 動かせない。ほかの色を 入れかえて、たて・よこが
//   なめらかな グラデーションに なるように ならべる。
// - 正解の色は 4すみからの「二方向の まぜあわせ（バイリニア）」で 決まる。
//   ＝ならびは 1とおりに 決まる（同じ色が 2つ できないよう 生成時に 確かめる）。
// - 最短の 入れかえ回数は 置換の サイクル数から 厳密に 出せる（n - サイクル数）。
// - DOM 非依存・rng 注入＝決定論。
// =============================================================

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface BoardSpec {
  cols: number;
  rows: number;
}

export const BOARDS: BoardSpec[] = [
  { cols: 3, rows: 4 },
  { cols: 4, rows: 4 },
  { cols: 4, rows: 5 },
];

export const BOARD_COUNT = BOARDS.length;

/** 同じに見える色を 作らないための 最小の 色の差 */
export const MIN_DIST = 34;

export interface Board {
  cols: number;
  rows: number;
  /** そのマスの 正しい色 */
  target: Rgb[];
  /** いま そのマスに 置かれている 色の ばんごう（正解は cells[i] === i） */
  cells: number[];
  /** 動かせないマス（4すみ） */
  locked: boolean[];
  /** 最短の 入れかえ回数 */
  par: number;
}

export function colorDist(a: Rgb, b: Rgb): number {
  return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
}

export function toCss(c: Rgb): string {
  return `rgb(${Math.round(c.r)},${Math.round(c.g)},${Math.round(c.b)})`;
}

/** 4すみから バイリニアで 中を うめる */
export function fillGrid(cols: number, rows: number, corner: [Rgb, Rgb, Rgb, Rgb]): Rgb[] {
  const [tl, tr, bl, br] = corner;
  const out: Rgb[] = [];
  for (let r = 0; r < rows; r++) {
    const v = rows === 1 ? 0 : r / (rows - 1);
    for (let c = 0; c < cols; c++) {
      const u = cols === 1 ? 0 : c / (cols - 1);
      const mix = (a: number, b: number, cc: number, d: number): number =>
        a * (1 - u) * (1 - v) + b * u * (1 - v) + cc * (1 - u) * v + d * u * v;
      out.push({
        r: mix(tl.r, tr.r, bl.r, br.r),
        g: mix(tl.g, tr.g, bl.g, br.g),
        b: mix(tl.b, tr.b, bl.b, br.b),
      });
    }
  }
  return out;
}

/** 4すみのマスか */
export function isCornerIndex(cols: number, rows: number, i: number): boolean {
  const c = i % cols;
  const r = Math.floor(i / cols);
  return (c === 0 || c === cols - 1) && (r === 0 || r === rows - 1);
}

/**
 * 最短の 入れかえ回数。
 * 置換を サイクルに 分けると、長さ L の サイクルは L-1 回で そろう。
 * ＝（ずれている マスの数） -（ずれている マスの サイクル数）
 */
export function minSwaps(cells: number[]): number {
  const seen = new Array(cells.length).fill(false) as boolean[];
  let swaps = 0;
  for (let i = 0; i < cells.length; i++) {
    if (seen[i] || cells[i] === i) continue;
    let len = 0;
    let j = i;
    while (!seen[j]) {
      seen[j] = true;
      j = cells[j]!;
      len++;
    }
    swaps += len - 1;
  }
  return swaps;
}

export function isSolved(b: Board): boolean {
  return b.cells.every((v, i) => v === i);
}

function randColor(rng: () => number): Rgb {
  return { r: 40 + rng() * 190, g: 40 + rng() * 190, b: 40 + rng() * 190 };
}

/**
 * 盤を作る。
 * ① 4すみを えらび、バイリニアで 中を うめる
 * ② どの2マスも 見分けが つく（色の差が MIN_DIST いじょう）か 確かめる
 * ③ 4すみ以外を まぜる（ずれが 少なすぎたら やり直し）
 */
export function makeBoard(rng: () => number, spec: BoardSpec): Board {
  const { cols, rows } = spec;
  const n = cols * rows;
  const locked: boolean[] = [];
  for (let i = 0; i < n; i++) locked.push(isCornerIndex(cols, rows, i));
  const movable: number[] = [];
  for (let i = 0; i < n; i++) if (!locked[i]) movable.push(i);

  let target: Rgb[] = [];
  for (let attempt = 0; attempt < 200; attempt++) {
    const corner: [Rgb, Rgb, Rgb, Rgb] = [randColor(rng), randColor(rng), randColor(rng), randColor(rng)];
    const grid = fillGrid(cols, rows, corner);
    let ok = true;
    for (let i = 0; i < n && ok; i++) {
      for (let j = i + 1; j < n; j++) {
        if (colorDist(grid[i]!, grid[j]!) < MIN_DIST) {
          ok = false;
          break;
        }
      }
    }
    if (ok) {
      target = grid;
      break;
    }
  }
  if (target.length === 0) {
    // ここに来ることは まず無い（来ても 見分けの つく 4すみで 作る）
    target = fillGrid(cols, rows, [
      { r: 230, g: 60, b: 60 },
      { r: 60, g: 90, b: 230 },
      { r: 240, g: 220, b: 70 },
      { r: 60, g: 190, b: 120 },
    ]);
  }

  // 4すみ以外を まぜる。
  // ※「ずれているマスの数」ではなく **最短手数（par）** で 見ること。
  //   2マスの 入れかえが いくつも あると、ずれは 多いのに par は 小さい＝かんたんすぎる盤になる。
  let cells: number[] = [];
  let best: number[] = [];
  let bestPar = -1;
  const wantPar = Math.ceil(movable.length * 0.6);
  for (let attempt = 0; attempt < 200; attempt++) {
    cells = [];
    for (let i = 0; i < n; i++) cells.push(i);
    const vals = movable.slice();
    for (let i = vals.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = vals[i]!;
      vals[i] = vals[j]!;
      vals[j] = t;
    }
    movable.forEach((pos, k) => {
      cells[pos] = vals[k]!;
    });
    const par = minSwaps(cells);
    if (par > bestPar) {
      bestPar = par;
      best = cells.slice();
    }
    if (par >= wantPar) break;
  }
  if (minSwaps(cells) < wantPar) cells = best;

  return { cols, rows, target, cells, locked, par: minSwaps(cells) };
}

/** 1プレイぶん */
export function makeBoards(rng: () => number): Board[] {
  return BOARDS.map((s) => makeBoard(rng, s));
}

/** ステージの点（さいたん手数で 250点・1手 よぶんで -10・下限60） */
export function stageScore(used: number, par: number): number {
  const extra = Math.max(0, used - par);
  return Math.max(60, 250 - extra * 10);
}

/** 満点 */
export function maxScore(): number {
  return BOARD_COUNT * 250;
}
