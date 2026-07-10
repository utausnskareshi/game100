// =============================================================
// スライドパズル（No.13）の純ロジック（DOM非依存・乱数注入）
// =============================================================
// - 盤は Uint8Array（値 1..n-1 がタイル / 0 が空きマス）。完成形は [1,2,…,n-1,0]。
// - scramble は「完成形から合法手をランダムに多数もどす」方式＝必ず解ける配置になる
//   （ランダム順列だと半分は解けないが、この作り方なら可解性を構造的に保証）。
// - import してよいのは game-api（types/helpers）と同一フォルダのみ（このファイルは依存なし）

export function solvedBoard(size: number): Uint8Array {
  const n = size * size;
  const b = new Uint8Array(n);
  for (let i = 0; i < n - 1; i++) b[i] = i + 1;
  b[n - 1] = 0;
  return b;
}

export function isSolved(board: Uint8Array, size: number): boolean {
  const n = size * size;
  for (let i = 0; i < n - 1; i++) if (board[i] !== i + 1) return false;
  return board[n - 1] === 0;
}

export function gapIndex(board: Uint8Array): number {
  for (let i = 0; i < board.length; i++) if (board[i] === 0) return i;
  return -1;
}

/** a と b が上下左右で隣り合っているか */
export function adjacent(a: number, b: number, size: number): boolean {
  const ar = (a / size) | 0;
  const ac = a % size;
  const br = (b / size) | 0;
  const bc = b % size;
  return (ar === br && Math.abs(ac - bc) === 1) || (ac === bc && Math.abs(ar - br) === 1);
}

/** tileIdx が空きマスと隣接していれば、そのタイルを空きへスライド（破壊的）。動いたら true */
export function slide(board: Uint8Array, tileIdx: number, size: number): boolean {
  const gap = gapIndex(board);
  if (gap < 0 || tileIdx === gap || !adjacent(tileIdx, gap, size)) return false;
  board[gap] = board[tileIdx] ?? 0;
  board[tileIdx] = 0;
  return true;
}

function gapNeighbors(gap: number, size: number): number[] {
  const gr = (gap / size) | 0;
  const gc = gap % size;
  const ne: number[] = [];
  if (gr > 0) ne.push(gap - size);
  if (gr < size - 1) ne.push(gap + size);
  if (gc > 0) ne.push(gap - 1);
  if (gc < size - 1) ne.push(gap + 1);
  return ne;
}

/**
 * 完成形から合法手を steps 回ランダムに適用してシャッフルする（＝必ず解ける）。
 * 直前の手をすぐ戻さない（last 除外）ことで効率よく崩す。まれに完成形へ戻ったら追加で崩す。
 */
export function scramble(size: number, rng: () => number, steps: number): Uint8Array {
  const b = solvedBoard(size);
  let gap = size * size - 1;
  let last = -1;
  const step = (): void => {
    const ne = gapNeighbors(gap, size);
    const opts = ne.filter((x) => x !== last);
    const pool = opts.length ? opts : ne;
    const t = pool[Math.floor(rng() * pool.length)] ?? ne[0] ?? gap;
    b[gap] = b[t] ?? 0;
    b[t] = 0;
    last = gap;
    gap = t;
  };
  for (let k = 0; k < steps; k++) step();
  let guard = 0;
  while (isSolved(b, size) && guard++ < 100) {
    for (let k = 0; k < size * 2; k++) step();
  }
  return b;
}
