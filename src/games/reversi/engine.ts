// リバーシの盤面ロジック。純粋関数のみで副作用なし＝テスト・AIから安全に使える。
// 盤面は Int8Array(64)。index = row*8 + col。値 0=空 / 1=黒 / 2=白。
export type Color = 1 | 2;
export const BLACK: Color = 1;
export const WHITE: Color = 2;
export const opponent = (c: Color): Color => (c === BLACK ? WHITE : BLACK);

// 8方向（行・列の増分）
const DIRS: ReadonlyArray<readonly [number, number]> = [
  [-1, -1], [-1, 0], [-1, 1],
  [0, -1], [0, 1],
  [1, -1], [1, 0], [1, 1],
];

export function initialBoard(): Int8Array {
  const b = new Int8Array(64);
  b[27] = WHITE; // (3,3)
  b[28] = BLACK; // (3,4)
  b[35] = BLACK; // (4,3)
  b[36] = WHITE; // (4,4)
  return b;
}

/** idx に color を置いたとき裏返るマスの一覧。置けない（空でない/どこも挟めない）なら空配列 */
export function flipsFor(board: Int8Array, idx: number, color: Color): number[] {
  if ((board[idx] ?? -1) !== 0) return [];
  const r0 = (idx / 8) | 0;
  const c0 = idx % 8;
  const opp = opponent(color);
  const out: number[] = [];
  for (const [dr, dc] of DIRS) {
    let r = r0 + dr;
    let c = c0 + dc;
    const line: number[] = [];
    while (r >= 0 && r < 8 && c >= 0 && c < 8 && board[r * 8 + c] === opp) {
      line.push(r * 8 + c);
      r += dr;
      c += dc;
    }
    // 相手石が続いたあと自分の石で閉じられていれば、その区間は裏返る
    if (line.length > 0 && r >= 0 && r < 8 && c >= 0 && c < 8 && board[r * 8 + c] === color) {
      for (const i of line) out.push(i);
    }
  }
  return out;
}

export function legalMoves(board: Int8Array, color: Color): number[] {
  const out: number[] = [];
  for (let i = 0; i < 64; i++) {
    if ((board[i] ?? -1) !== 0) continue;
    if (flipsFor(board, i, color).length > 0) out.push(i);
  }
  return out;
}

export function hasMove(board: Int8Array, color: Color): boolean {
  for (let i = 0; i < 64; i++) {
    if ((board[i] ?? -1) === 0 && flipsFor(board, i, color).length > 0) return true;
  }
  return false;
}

/** 着手を適用した「新しい盤面」と裏返ったマスを返す。非合法なら null（元の盤面は変更しない） */
export function applyMove(
  board: Int8Array,
  idx: number,
  color: Color,
): { board: Int8Array; flips: number[] } | null {
  const flips = flipsFor(board, idx, color);
  if (flips.length === 0) return null;
  const nb = board.slice();
  nb[idx] = color;
  for (const i of flips) nb[i] = color;
  return { board: nb, flips };
}

export function countDiscs(board: Int8Array): { black: number; white: number; empty: number } {
  let black = 0;
  let white = 0;
  let empty = 0;
  for (let i = 0; i < 64; i++) {
    const v = board[i];
    if (v === BLACK) black++;
    else if (v === WHITE) white++;
    else empty++;
  }
  return { black, white, empty };
}

/** 勝者を返す（引き分けは 0）。両者とも打てない＝終局の判定は hasMove を併用する */
export function winner(board: Int8Array): Color | 0 {
  const { black, white } = countDiscs(board);
  if (black > white) return BLACK;
  if (white > black) return WHITE;
  return 0;
}
