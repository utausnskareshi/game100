// =============================================================
// まるばつゲーム（No.51）の盤ロジックとCPU（DOM非依存・純ロジック）
// =============================================================
// - 盤は長さ9の配列（0=空 / 1=〇(先手) / 2=×(後手)）。
// - つよい は negamax の完全読み（3×3は全探索しても極小）＝絶対に負けない。
//   よわい=「置けば勝ち」だけ取る＋あとはランダム（ふさがない）／
//   ふつう=勝ち取り＋ふさぎ＋あとはランダム。
// - 乱数は引数 rng で注入（ctx.random）＝日替わりでも決定論。
// - import してよいのは game-api と同一フォルダのみ（このファイルは依存なし）。

export type Level = 'weak' | 'normal' | 'strong';

/** 3つならびの全ライン（横3・縦3・斜め2） */
export const LINES: readonly (readonly [number, number, number])[] = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];

/** 勝者（1/2）。いなければ 0 */
export function winnerOf(board: ArrayLike<number>): number {
  for (const [a, b, c] of LINES) {
    const v = board[a] ?? 0;
    if (v !== 0 && v === board[b] && v === board[c]) return v;
  }
  return 0;
}

/** 勝ちが決まった3マス（ハイライト用）。勝者がいなければ空配列 */
export function winLine(board: ArrayLike<number>): number[] {
  for (const [a, b, c] of LINES) {
    const v = board[a] ?? 0;
    if (v !== 0 && v === board[b] && v === board[c]) return [a, b, c];
  }
  return [];
}

/** 空きマスの一覧 */
export function emptiesOf(board: ArrayLike<number>): number[] {
  const r: number[] = [];
  for (let i = 0; i < 9; i++) if (!board[i]) r.push(i);
  return r;
}

/** player がそこに置けば「即勝ち」になるマスの一覧（リーチの受け口） */
export function winningMoves(board: ArrayLike<number>, player: number): number[] {
  const r: number[] = [];
  for (const [a, b, c] of LINES) {
    const va = board[a] ?? 0;
    const vb = board[b] ?? 0;
    const vc = board[c] ?? 0;
    // ライン内が「player 2つ＋空き1つ」なら、その空きが即勝ちマス
    if (va === player && vb === player && vc === 0) r.push(c);
    else if (va === player && vc === player && vb === 0) r.push(b);
    else if (vb === player && vc === player && va === 0) r.push(a);
  }
  // 同じマスが複数ライン（＝ダブルリーチの受け口）で出たら1つにまとめる
  return [...new Set(r)];
}

/**
 * turn の手番から見た negamax 値。+側=turnの勝ち / 0=引き分け / -側=負け。
 * |値| は 10-手数 で減衰させ「早い勝ち・遅い負け」を好む。
 */
function negamaxValue(board: number[], turn: number, depth: number): number {
  const opp = turn === 1 ? 2 : 1;
  if (winnerOf(board) === opp) return -(10 - depth); // 直前の相手の手で負け確定
  const empties = emptiesOf(board);
  if (empties.length === 0) return 0;
  let best = -Infinity;
  for (const i of empties) {
    board[i] = turn;
    const v = -negamaxValue(board, opp, depth + 1);
    board[i] = 0;
    if (v > best) best = v;
  }
  return best;
}

/** turn の手番での最善値と、その値になる手の一覧（同値はぜんぶ返す＝バリエーション用） */
export function bestMoves(board: number[], turn: number): { value: number; moves: number[] } {
  const opp = turn === 1 ? 2 : 1;
  let best = -Infinity;
  let moves: number[] = [];
  for (const i of emptiesOf(board)) {
    board[i] = turn;
    const v = -negamaxValue(board, opp, 1);
    board[i] = 0;
    if (v > best) {
      best = v;
      moves = [i];
    } else if (v === best) {
      moves.push(i);
    }
  }
  return { value: best, moves };
}

/** CPUの1手を選ぶ（board は破壊しない） */
export function chooseMove(board: ArrayLike<number>, cpu: number, level: Level, rng: () => number): number {
  const b: number[] = [];
  for (let i = 0; i < 9; i++) b.push(board[i] ?? 0);
  const empties = emptiesOf(b);
  const pick = (arr: number[]): number => {
    if (arr.length === 0) return -1;
    return arr[Math.min(arr.length - 1, Math.floor(rng() * arr.length))] ?? -1;
  };
  // どのレベルでも「置けば勝ち」は取る（よわい でも詰みは見える＝ほどよい緊張感）
  const winNow = winningMoves(b, cpu);
  if (winNow.length > 0) return pick(winNow);
  if (level === 'weak') return pick(empties);
  // 相手のリーチはふさぐ（受け口が2つ以上＝ダブルリーチは1つしかふさげない）
  const opp = cpu === 1 ? 2 : 1;
  const block = winningMoves(b, opp);
  if (block.length > 0) return pick(block);
  if (level === 'normal') return pick(empties);
  const { moves } = bestMoves(b, cpu);
  return moves.length > 0 ? pick(moves) : pick(empties);
}
