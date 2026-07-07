// =============================================================
// かたむきメイロ: 迷路の生成ロジック（純粋・DOM/時間非依存）
// =============================================================
// 乱数は呼び出し側から注入する（ctx.random）。
// 生成は再帰的バックトラッカ（穴掘り法）＝必ず全セルがつながる「完全迷路」。
// ゴールはBFSでスタートから最遠のセルに置き、毎回そこそこの長さを保証する。

// セルの壁ビット（そのセルの各辺に壁があるか）
export const N = 1;
export const E = 2;
export const S = 4;
export const W = 8;

export interface Maze {
  cols: number;
  rows: number;
  /** セルごとの壁ビットマスク（N|E|S|W）。長さ cols*rows */
  walls: Uint8Array;
  /** スタートセルのインデックス（左上=0で固定） */
  start: number;
  /** ゴールセルのインデックス（スタートから最遠） */
  goal: number;
  /** スタート→ゴールの正解ルート（セルインデックス列・ヒント表示用） */
  solution: number[];
}

const DX = [0, 1, 0, -1]; // N,E,S,W
const DY = [-1, 0, 1, 0];
const DIR = [N, E, S, W];
const OPP = [S, W, N, E]; // 反対側の壁

export function generateMaze(cols: number, rows: number, random: () => number): Maze {
  const n = cols * rows;
  const walls = new Uint8Array(n).fill(N | E | S | W);
  const visited = new Uint8Array(n);
  const idx = (x: number, y: number): number => y * cols + x;

  // ---- 穴掘り（反復DFS）----
  const stack: number[] = [0];
  visited[0] = 1;
  while (stack.length > 0) {
    const cur = stack[stack.length - 1] ?? 0;
    const cx = cur % cols;
    const cy = (cur / cols) | 0;
    const opts: number[] = []; // 進める方向（未訪問の隣）
    for (let d = 0; d < 4; d++) {
      const nx = cx + (DX[d] ?? 0);
      const ny = cy + (DY[d] ?? 0);
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      if (!visited[idx(nx, ny)]) opts.push(d);
    }
    if (opts.length === 0) {
      stack.pop();
      continue;
    }
    const d = opts[Math.floor(random() * opts.length)] ?? 0;
    const nx = cx + (DX[d] ?? 0);
    const ny = cy + (DY[d] ?? 0);
    const nb = idx(nx, ny);
    walls[cur] = (walls[cur] ?? 15) & ~(DIR[d] ?? 0); // 自分側の壁を抜く
    walls[nb] = (walls[nb] ?? 15) & ~(OPP[d] ?? 0); // 隣側の壁を抜く
    visited[nb] = 1;
    stack.push(nb);
  }

  // ---- BFSで最遠セル＋親をたどる（ゴールと正解ルート）----
  const start = 0;
  const dist = new Int32Array(n).fill(-1);
  const parent = new Int32Array(n).fill(-1);
  dist[start] = 0;
  const queue: number[] = [start];
  let head = 0;
  let far = start;
  while (head < queue.length) {
    const cur = queue[head++] ?? 0;
    if ((dist[cur] ?? 0) > (dist[far] ?? 0)) far = cur;
    const cx = cur % cols;
    const cy = (cur / cols) | 0;
    for (let d = 0; d < 4; d++) {
      if ((walls[cur] ?? 15) & (DIR[d] ?? 0)) continue; // 壁があれば進めない
      const nx = cx + (DX[d] ?? 0);
      const ny = cy + (DY[d] ?? 0);
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      const nb = idx(nx, ny);
      if ((dist[nb] ?? -1) !== -1) continue;
      dist[nb] = (dist[cur] ?? 0) + 1;
      parent[nb] = cur;
      queue.push(nb);
    }
  }

  const goal = far;
  const solution: number[] = [];
  let c = goal;
  while (c !== -1) {
    solution.push(c);
    c = parent[c] ?? -1;
  }
  solution.reverse();

  return { cols, rows, walls, start, goal, solution };
}

/** セル cell の dir 方向に壁があるか */
export function hasWall(m: Maze, cell: number, dir: number): boolean {
  return ((m.walls[cell] ?? 15) & dir) !== 0;
}
