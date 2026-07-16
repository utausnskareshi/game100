// =============================================================
// キラキラマッチ3（No.52）の盤ロジック（DOM非依存・純ロジック）
// =============================================================
// - 盤は長さ cols*rows の Uint8Array（0=空 / 1..colors=宝石の色）。index = r*cols + c。
// - となり同士を入れ替えて、たて/よこに同じ色が3つ以上そろうと消える → 重力で落下 →
//   上から補充 → また そろえば れんさ（cascade）。
// - 採点・連鎖解決・盤生成すべてをここに集約し、ゲーム(game.ts)とテストが同じ関数を使う
//   ＝スコア厳密一致を構造的に保証する。乱数は rng 引数で注入（ctx.random）。
// - import してよいのは game-api と同一フォルダのみ（このファイルは依存なし）。

export interface Match {
  /** 消えるマスのマスク（1=消える） */
  mask: Uint8Array;
  /** 消える総数 */
  count: number;
  /** その盤にある「1本の連（H or V）」の最長の長さ（4/5そろえのボーナス・実績用） */
  maxRun: number;
}

export interface ResolveStep {
  /** この段で消えたマスのマスク（演出用） */
  cleared: Uint8Array;
  count: number;
  maxRun: number;
  /** この段で得た点（連鎖倍率こみ） */
  gained: number;
  /** この段の落下・補充後の盤（演出用スナップショット） */
  boardAfter: Uint8Array;
}

export interface ResolveResult {
  steps: ResolveStep[];
  /** 全段の合計点 */
  total: number;
  /** 連鎖段数（1手で何段そろったか） */
  cascades: number;
  /** 全段のうち最長の連（4/5実績用） */
  bestRun: number;
  /** 全段の消えた総数（大量消し実績用） */
  totalCleared: number;
}

export const gi = (c: number, r: number, cols: number): number => r * cols + c;

/** 初期マッチのない盤を作る（1マスずつ、左2つ・上2つと3連にならない色を選ぶ）。rng を cols*rows 回消費 */
export function makeBoard(cols: number, rows: number, colors: number, rng: () => number): Uint8Array {
  const b = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const banned = new Set<number>();
      if (c >= 2 && b[r * cols + c - 1] === b[r * cols + c - 2]) banned.add(b[r * cols + c - 1] ?? 0);
      if (r >= 2 && b[(r - 1) * cols + c] === b[(r - 2) * cols + c]) banned.add(b[(r - 1) * cols + c] ?? 0);
      const allowed: number[] = [];
      for (let g = 1; g <= colors; g++) if (!banned.has(g)) allowed.push(g);
      b[r * cols + c] = allowed[Math.floor(rng() * allowed.length)] ?? 1;
    }
  }
  return b;
}

/** たて・よこの3連以上を検出（盤は空きマス 0 なしの前提で呼ぶ） */
export function findMatches(b: ArrayLike<number>, cols: number, rows: number): Match {
  const mask = new Uint8Array(cols * rows);
  let maxRun = 0;
  // よこ
  for (let r = 0; r < rows; r++) {
    let c = 0;
    while (c < cols) {
      const g = b[r * cols + c] ?? 0;
      let e = c + 1;
      while (e < cols && g !== 0 && b[r * cols + e] === g) e++;
      const len = e - c;
      if (g !== 0 && len >= 3) {
        for (let k = c; k < e; k++) mask[r * cols + k] = 1;
        if (len > maxRun) maxRun = len;
      }
      c = e;
    }
  }
  // たて
  for (let c = 0; c < cols; c++) {
    let r = 0;
    while (r < rows) {
      const g = b[r * cols + c] ?? 0;
      let e = r + 1;
      while (e < rows && g !== 0 && b[e * cols + c] === g) e++;
      const len = e - r;
      if (g !== 0 && len >= 3) {
        for (let k = r; k < e; k++) mask[k * cols + c] = 1;
        if (len > maxRun) maxRun = len;
      }
      r = e;
    }
  }
  let count = 0;
  for (let i = 0; i < mask.length; i++) count += mask[i] ?? 0;
  return { mask, count, maxRun };
}

/** 消えたあとの落下＋上からの補充（rng を空きマスの数だけ消費：列は左→右、各列は上→下） */
function gravityRefill(b: Uint8Array, cols: number, rows: number, colors: number, rng: () => number): void {
  for (let c = 0; c < cols; c++) {
    const stay: number[] = [];
    for (let r = 0; r < rows; r++) {
      const v = b[r * cols + c] ?? 0;
      if (v !== 0) stay.push(v);
    }
    const missing = rows - stay.length;
    const col: number[] = [];
    for (let k = 0; k < missing; k++) col.push(1 + Math.floor(rng() * colors));
    for (const v of stay) col.push(v);
    for (let r = 0; r < rows; r++) b[r * cols + c] = col[r] ?? 1;
  }
}

/** 1段の点：消えた数×10 ×連鎖倍率。4そろえ+40 / 5以上+100。倍率は段位（1..5でクランプ） */
export function stepScore(count: number, maxRun: number, level: number): number {
  let base = count * 10;
  if (maxRun >= 5) base += 100;
  else if (maxRun >= 4) base += 40;
  return base * Math.min(Math.max(level, 1), 5);
}

/** 盤を「そろい ⇒ 消し ⇒ 落下 ⇒ 補充」のなくなるまで解決し、各段と合計点を返す（board を最終形に破壊更新） */
export function resolveAll(b: Uint8Array, cols: number, rows: number, colors: number, rng: () => number): ResolveResult {
  const steps: ResolveStep[] = [];
  let level = 1;
  let bestRun = 0;
  let totalCleared = 0;
  // 段数上限（暴走防止・現実には連鎖はすぐ止まる）
  for (let guard = 0; guard < 200; guard++) {
    const fm = findMatches(b, cols, rows);
    if (fm.count === 0) break;
    const cleared = fm.mask.slice();
    for (let i = 0; i < b.length; i++) if (fm.mask[i]) b[i] = 0;
    gravityRefill(b, cols, rows, colors, rng);
    const gained = stepScore(fm.count, fm.maxRun, level);
    steps.push({ cleared, count: fm.count, maxRun: fm.maxRun, gained, boardAfter: b.slice() });
    if (fm.maxRun > bestRun) bestRun = fm.maxRun;
    totalCleared += fm.count;
    level++;
  }
  const total = steps.reduce((s, x) => s + x.gained, 0);
  return { steps, total, cascades: steps.length, bestRun, totalCleared };
}

export const areAdjacent = (i: number, j: number, cols: number): boolean => {
  const ci = i % cols;
  const ri = (i / cols) | 0;
  const cj = j % cols;
  const rj = (j / cols) | 0;
  return (ci === cj && Math.abs(ri - rj) === 1) || (ri === rj && Math.abs(ci - cj) === 1);
};

const swap = (b: Uint8Array, i: number, j: number): void => {
  const t = b[i] ?? 0;
  b[i] = b[j] ?? 0;
  b[j] = t;
};

/** i,j を入れ替えたら「そろい」が生まれるか（判定のみ・盤は元に戻す・rng不使用） */
export function makesMatch(b: Uint8Array, cols: number, rows: number, i: number, j: number): boolean {
  swap(b, i, j);
  const ok = findMatches(b, cols, rows).count > 0;
  swap(b, i, j);
  return ok;
}

/** 有効な手（そろいを生む隣接入れ替え）が1つでもあるか */
export function hasAnyMove(b: Uint8Array, cols: number, rows: number): boolean {
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if (c + 1 < cols && makesMatch(b, cols, rows, i, i + 1)) return true;
      if (r + 1 < rows && makesMatch(b, cols, rows, i, i + cols)) return true;
    }
  }
  return false;
}

/** そろいがなく かつ 有効手のある盤になるまで作り直す（手詰まり救済）。作り直した回数を返す */
export function reshuffleUntilPlayable(
  b: Uint8Array,
  cols: number,
  rows: number,
  colors: number,
  rng: () => number,
): number {
  let n = 0;
  while ((findMatches(b, cols, rows).count > 0 || !hasAnyMove(b, cols, rows)) && n < 50) {
    const fresh = makeBoard(cols, rows, colors, rng);
    b.set(fresh);
    n++;
  }
  return n;
}

/** exec の入れ替え（game.ts が確定後に呼ぶ公開版） */
export function commitSwap(b: Uint8Array, i: number, j: number): void {
  swap(b, i, j);
}
