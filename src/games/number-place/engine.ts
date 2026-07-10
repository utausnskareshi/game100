// =============================================================
// ナンプレ（No.7）の純ロジック（DOM非依存・乱数注入）
// =============================================================
// - generatePuzzle: 完成盤をランダム生成 → 対称にマスを間引き、
//   「解がただ1つ」を保ったまま目標ヒント数まで減らす。
//   すべて注入 rng 由来＝「今日のゲーム」では全員同じ問題になる。
// - countSolutions: ビットマスク＋MRV のバックトラックで解の個数を数える
//   （limit=2 で「2解目が見つかった瞬間」に打ち切り＝唯一解チェック用）。
// - 4×4(2×2) / 6×6(3×2) / 9×9(3×3) に対応（size ≤ 9・ビットは下位9bit）。
// - import してよいのは game-api（types/helpers）と同一フォルダのみ（このファイルは依存なし）。

export interface Puzzle {
  size: number;
  blockW: number;
  blockH: number;
  /** 出題（0=空マス、1..size=最初から見えている数字） */
  givens: Uint8Array;
  /** 唯一解 */
  solution: Uint8Array;
}

function shuffle(arr: number[], rng: () => number): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const a = arr[i];
    const b = arr[j];
    if (a !== undefined && b !== undefined) {
      arr[i] = b;
      arr[j] = a;
    }
  }
}

function popcount(v: number): number {
  let c = 0;
  while (v) {
    v &= v - 1;
    c++;
  }
  return c;
}

/** マスク3表（行・列・ブロック）を初期化する。既存の重複があれば null（不正盤面） */
function buildMasks(
  size: number,
  blockW: number,
  blockH: number,
  grid: Uint8Array,
): { rowM: number[]; colM: number[]; blkM: number[] } | null {
  const rowM = new Array<number>(size).fill(0);
  const colM = new Array<number>(size).fill(0);
  const blkM = new Array<number>(size).fill(0);
  const bpr = size / blockW; // 横方向のブロック数
  for (let i = 0; i < size * size; i++) {
    const v = grid[i] ?? 0;
    if (!v) continue;
    const r = (i / size) | 0;
    const c = i % size;
    const b = ((r / blockH) | 0) * bpr + ((c / blockW) | 0);
    const bit = 1 << (v - 1);
    if ((rowM[r] ?? 0) & bit || (colM[c] ?? 0) & bit || (blkM[b] ?? 0) & bit) return null;
    rowM[r] = (rowM[r] ?? 0) | bit;
    colM[c] = (colM[c] ?? 0) | bit;
    blkM[b] = (blkM[b] ?? 0) | bit;
  }
  return { rowM, colM, blkM };
}

/**
 * 解の個数を limit まで数える（limit 到達で即打ち切り）。
 * MRV（候補が最少のマスから埋める）で高速化。grid は変更しない。
 */
export function countSolutions(size: number, blockW: number, blockH: number, grid: Uint8Array, limit = 2): number {
  const n = size * size;
  const FULL = (1 << size) - 1;
  const bpr = size / blockW;
  const masks = buildMasks(size, blockW, blockH, grid);
  if (!masks) return 0;
  const { rowM, colM, blkM } = masks;
  const work = grid.slice();
  let count = 0;

  const rec = (): void => {
    if (count >= limit) return;
    // 候補が最少の空きマスを探す（MRV）
    let best = -1;
    let bestMask = 0;
    let bestCnt = 99;
    for (let i = 0; i < n; i++) {
      if (work[i]) continue;
      const r = (i / size) | 0;
      const c = i % size;
      const b = ((r / blockH) | 0) * bpr + ((c / blockW) | 0);
      const mask = ~((rowM[r] ?? 0) | (colM[c] ?? 0) | (blkM[b] ?? 0)) & FULL;
      if (mask === 0) return; // 置ける数字がない＝この枝は解なし
      const cnt = popcount(mask);
      if (cnt < bestCnt) {
        bestCnt = cnt;
        best = i;
        bestMask = mask;
        if (cnt === 1) break;
      }
    }
    if (best < 0) {
      count++; // 空きマスなし＝1解
      return;
    }
    const r = (best / size) | 0;
    const c = best % size;
    const b = ((r / blockH) | 0) * bpr + ((c / blockW) | 0);
    for (let d = 1; d <= size; d++) {
      const bit = 1 << (d - 1);
      if (!(bestMask & bit)) continue;
      work[best] = d;
      rowM[r] = (rowM[r] ?? 0) | bit;
      colM[c] = (colM[c] ?? 0) | bit;
      blkM[b] = (blkM[b] ?? 0) | bit;
      rec();
      work[best] = 0;
      rowM[r] = (rowM[r] ?? 0) & ~bit;
      colM[c] = (colM[c] ?? 0) & ~bit;
      blkM[b] = (blkM[b] ?? 0) & ~bit;
      if (count >= limit) return;
    }
  };

  rec();
  return count;
}

/** 完成盤をランダムに1つ作る（バックトラック。探索順・数字順を rng でシャッフル） */
function fillSolution(size: number, blockW: number, blockH: number, rng: () => number): Uint8Array {
  const n = size * size;
  const bpr = size / blockW;
  const grid = new Uint8Array(n);
  const rowM = new Array<number>(size).fill(0);
  const colM = new Array<number>(size).fill(0);
  const blkM = new Array<number>(size).fill(0);
  // 各マスで試す数字の順番をマスごとにシャッフル（盤面ごとに十分ランダムになる）
  const digitsBase: number[] = [];
  for (let d = 1; d <= size; d++) digitsBase.push(d);

  const rec = (i: number): boolean => {
    if (i >= n) return true;
    const r = (i / size) | 0;
    const c = i % size;
    const b = ((r / blockH) | 0) * bpr + ((c / blockW) | 0);
    const used = (rowM[r] ?? 0) | (colM[c] ?? 0) | (blkM[b] ?? 0);
    const digits = digitsBase.slice();
    shuffle(digits, rng);
    for (const d of digits) {
      const bit = 1 << (d - 1);
      if (used & bit) continue;
      grid[i] = d;
      rowM[r] = (rowM[r] ?? 0) | bit;
      colM[c] = (colM[c] ?? 0) | bit;
      blkM[b] = (blkM[b] ?? 0) | bit;
      if (rec(i + 1)) return true;
      grid[i] = 0;
      rowM[r] = (rowM[r] ?? 0) & ~bit;
      colM[c] = (colM[c] ?? 0) & ~bit;
      blkM[b] = (blkM[b] ?? 0) & ~bit;
    }
    return false;
  };

  rec(0); // 全探索なので必ず成功する
  return grid;
}

/**
 * 唯一解のナンプレを1問作る。
 * 完成盤から「点対称のペア」でマスを消していき、解が複数になる消し方は取り消す。
 * targetGivens は目標のヒント数（対称消しの都合で±1〜2ずれることがある）。
 */
export function generatePuzzle(
  size: number,
  blockW: number,
  blockH: number,
  targetGivens: number,
  rng: () => number,
): Puzzle {
  const n = size * size;
  const solution = fillSolution(size, blockW, blockH, rng);
  const givens = solution.slice();
  const order: number[] = [];
  for (let i = 0; i < n; i++) order.push(i);
  shuffle(order, rng);

  let remaining = n;
  for (const i of order) {
    if (remaining <= targetGivens) break;
    const j = n - 1 - i; // 点対称の相方
    const vi = givens[i] ?? 0;
    if (!vi) continue;
    const vj = i === j ? 0 : givens[j] ?? 0;
    givens[i] = 0;
    if (vj) givens[j] = 0;
    if (countSolutions(size, blockW, blockH, givens, 2) !== 1) {
      // 唯一解が壊れた → もとに戻す
      givens[i] = vi;
      if (vj) givens[j] = vj;
    } else {
      remaining -= vj ? 2 : 1;
    }
  }

  return { size, blockW, blockH, givens, solution };
}
