// =============================================================
// スタードロップ（No.15）の純ロジック（DOM非依存・乱数注入）
// =============================================================
// - 落ちものパズル（4マスのブロック7種）。回転・衝突・横1列そろい消し・ボム爆発を扱う。
// - 落ちもの系の消しパズル。名前・実装は独自で、一般名（ブロック/落ちもの）で表現する。
// - ⭐スター（消すとボーナス）と💣ボム（着地でまわり3×3を消して列を詰める）＝アレンジ要素。
// - import してよいのは game-api（types/helpers）と同一フォルダのみ（このファイルは依存なし）。

export type PieceType = 'I' | 'O' | 'T' | 'S' | 'Z' | 'J' | 'L';
export const TYPES: PieceType[] = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];

/** ブロックの色（id 1..7 = index 0..6） */
export const COLORS = ['#25d0e6', '#f4c81e', '#a860f0', '#4bd267', '#f0524a', '#4a74f0', '#f39a2e'];
export const COLOR_OF: Record<PieceType, number> = { I: 1, O: 2, T: 3, S: 4, Z: 5, J: 6, L: 7 };

// 各ブロックの基本形（箱サイズ N と、埋まるマス [r,c]）
const SHAPES: Record<PieceType, { N: number; cells: [number, number][] }> = {
  I: { N: 4, cells: [[1, 0], [1, 1], [1, 2], [1, 3]] },
  O: { N: 2, cells: [[0, 0], [0, 1], [1, 0], [1, 1]] },
  T: { N: 3, cells: [[0, 1], [1, 0], [1, 1], [1, 2]] },
  S: { N: 3, cells: [[0, 1], [0, 2], [1, 0], [1, 1]] },
  Z: { N: 3, cells: [[0, 0], [0, 1], [1, 1], [1, 2]] },
  J: { N: 3, cells: [[0, 0], [1, 0], [1, 1], [1, 2]] },
  L: { N: 3, cells: [[0, 2], [1, 0], [1, 1], [1, 2]] },
};

function rot90(cells: [number, number][], N: number): [number, number][] {
  return cells.map(([r, c]) => [c, N - 1 - r] as [number, number]);
}

// 4回転ぶんを前計算（ROT[type][state] = [[r,c],...]）
export const ROT: Record<PieceType, [number, number][][]> = {} as Record<PieceType, [number, number][][]>;
for (const t of TYPES) {
  const { N, cells } = SHAPES[t];
  const states: [number, number][][] = [cells];
  for (let i = 0; i < 3; i++) states.push(rot90(states[states.length - 1] ?? cells, N));
  ROT[t] = states;
}

export interface Board {
  cols: number;
  rows: number;
  color: Uint8Array; // 0=空 / 1..7=ブロック色
  special: Uint8Array; // 0=なし / 1=⭐ / 2=💣
}

export function makeBoard(cols: number, rows: number): Board {
  return { cols, rows, color: new Uint8Array(cols * rows), special: new Uint8Array(cols * rows) };
}

export function cells(type: PieceType, state: number): [number, number][] {
  const st = ROT[type];
  return st[((state % 4) + 4) % 4] ?? st[0] ?? [];
}

/** そのブロックを (px,py,state) に置けないか（枠外/重なり）。天井より上(y<0)は空きとして許容 */
export function collides(board: Board, type: PieceType, state: number, px: number, py: number): boolean {
  for (const [r, c] of cells(type, state)) {
    const x = px + c;
    const y = py + r;
    if (x < 0 || x >= board.cols || y >= board.rows) return true;
    if (y >= 0 && board.color[y * board.cols + x] !== 0) return true;
  }
  return false;
}

/**
 * ブロックを盤に固定する。specialIdx 番目のマスに special(1=⭐/2=💣) を付ける。
 * 固定した💣マスの位置一覧を返す（着地爆発の対象）。
 */
export function lock(
  board: Board,
  type: PieceType,
  state: number,
  px: number,
  py: number,
  special: number,
  specialIdx: number,
): [number, number][] {
  const cs = cells(type, state);
  const color = COLOR_OF[type];
  const bombs: [number, number][] = [];
  cs.forEach(([r, c], i) => {
    const x = px + c;
    const y = py + r;
    if (y < 0) return;
    const idx = y * board.cols + x;
    board.color[idx] = color;
    const sp = i === specialIdx ? special : 0;
    board.special[idx] = sp;
    if (sp === 2) bombs.push([x, y]);
  });
  return bombs;
}

/** そろった横列を消して上を詰める。消えた列数と、消えた列にあった⭐の数を返す */
export function clearLines(board: Board): { cleared: number; stars: number } {
  const { cols, rows } = board;
  let cleared = 0;
  let stars = 0;
  for (let y = rows - 1; y >= 0; ) {
    let full = true;
    for (let x = 0; x < cols; x++)
      if (board.color[y * cols + x] === 0) {
        full = false;
        break;
      }
    if (!full) {
      y--;
      continue;
    }
    for (let x = 0; x < cols; x++) if (board.special[y * cols + x] === 1) stars++;
    for (let yy = y; yy > 0; yy--) {
      for (let x = 0; x < cols; x++) {
        board.color[yy * cols + x] = board.color[(yy - 1) * cols + x] ?? 0;
        board.special[yy * cols + x] = board.special[(yy - 1) * cols + x] ?? 0;
      }
    }
    for (let x = 0; x < cols; x++) {
      board.color[x] = 0;
      board.special[x] = 0;
    }
    cleared++;
    // y はそのまま（詰めた後の同じ行を再チェック）
  }
  return { cleared, stars };
}

/** (cx,cy) を中心に3×3を消し、その3列を下に詰める。消したマス数を返す */
export function bombExplode(board: Board, cx: number, cy: number): number {
  const { cols, rows } = board;
  let removed = 0;
  for (let y = cy - 1; y <= cy + 1; y++) {
    for (let x = cx - 1; x <= cx + 1; x++) {
      if (x < 0 || x >= cols || y < 0 || y >= rows) continue;
      const idx = y * cols + x;
      if (board.color[idx] !== 0) {
        board.color[idx] = 0;
        board.special[idx] = 0;
        removed++;
      }
    }
  }
  // 影響した3列を下詰め（浮いたブロックを落とす＝救済感）
  for (let x = Math.max(0, cx - 1); x <= Math.min(cols - 1, cx + 1); x++) {
    let write = rows - 1;
    for (let y = rows - 1; y >= 0; y--) {
      const idx = y * cols + x;
      if (board.color[idx] !== 0) {
        const w = write * cols + x;
        if (w !== idx) {
          board.color[w] = board.color[idx] ?? 0;
          board.special[w] = board.special[idx] ?? 0;
          board.color[idx] = 0;
          board.special[idx] = 0;
        }
        write--;
      }
    }
  }
  return removed;
}

/** 今の位置から真下に落とせる y（ゴースト・ハードドロップ用） */
export function dropY(board: Board, type: PieceType, state: number, px: number, py: number): number {
  let y = py;
  while (!collides(board, type, state, px, y + 1)) y++;
  return y;
}
