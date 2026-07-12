// =============================================================
// きおくのめいろ（No.27）の迷路生成（DOM非依存・乱数注入）
// =============================================================
// - 再帰的バックトラッカ（反復版）による「完全迷路」＝どのマスへも必ず1本道でつながる。
//   ※かたむきメイロ（no.4）と同系のアルゴリズムだが、ゲーム間 import は禁止のため独立実装。
// - ゴールは BFS でスタートから最も遠いマス（覚えごたえのある距離を保証）。
// - rng 注入＝「今日のゲーム」では全員同じ迷路。
// - import してよいのは game-api（types/helpers）と同一フォルダのみ（このファイルは依存なし）。

/** 壁ビット（そのマスの上下左右に壁があるか） */
export const WALL_N = 1;
export const WALL_E = 2;
export const WALL_S = 4;
export const WALL_W = 8;

export type Dir = 'up' | 'right' | 'down' | 'left';

export const DIRS: { dir: Dir; dx: number; dy: number; bit: number; opp: number }[] = [
  { dir: 'up', dx: 0, dy: -1, bit: WALL_N, opp: WALL_S },
  { dir: 'right', dx: 1, dy: 0, bit: WALL_E, opp: WALL_W },
  { dir: 'down', dx: 0, dy: 1, bit: WALL_S, opp: WALL_N },
  { dir: 'left', dx: -1, dy: 0, bit: WALL_W, opp: WALL_E },
];

export interface Maze {
  /** 1辺のマス数 */
  n: number;
  /** 各マスの壁ビットマスク（index = y*n + x） */
  walls: Uint8Array;
  /** スタートのマス index（左下） */
  start: number;
  /** ゴールのマス index（スタートから最遠） */
  goal: number;
}

/** 完全迷路を生成する（start＝左下。goal＝BFS 最遠マス） */
export function generateMaze(rng: () => number, n: number): Maze {
  const walls = new Uint8Array(n * n).fill(WALL_N | WALL_E | WALL_S | WALL_W);
  const visited = new Uint8Array(n * n);
  const start = (n - 1) * n; // 左下 (x=0, y=n-1)
  const stack: number[] = [start];
  visited[start] = 1;
  while (stack.length > 0) {
    const cur = stack[stack.length - 1]!;
    const cx = cur % n;
    const cy = (cur - cx) / n;
    // 未訪問の隣を列挙
    const options: { next: number; bit: number; opp: number }[] = [];
    for (const d of DIRS) {
      const nx = cx + d.dx;
      const ny = cy + d.dy;
      if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
      const ni = ny * n + nx;
      if (!visited[ni]) options.push({ next: ni, bit: d.bit, opp: d.opp });
    }
    if (options.length === 0) {
      stack.pop();
      continue;
    }
    const pick = options[Math.floor(rng() * options.length)]!;
    walls[cur] = (walls[cur]! & ~pick.bit) & 15;
    walls[pick.next] = (walls[pick.next]! & ~pick.opp) & 15;
    visited[pick.next] = 1;
    stack.push(pick.next);
  }
  const dist = bfsDist({ n, walls, start, goal: start }, start);
  let goal = start;
  for (let i = 0; i < dist.length; i++) {
    if (dist[i]! > dist[goal]!) goal = i;
  }
  return { n, walls, start, goal };
}

/** dir 方向へ動けるか（壁がないか）。盤外は壁扱い */
export function canMove(m: Maze, idx: number, dir: Dir): boolean {
  const d = DIRS.find((v) => v.dir === dir)!;
  return (m.walls[idx]! & d.bit) === 0;
}

/** dir 方向の隣マス index（動ける前提で呼ぶ） */
export function nextIndex(m: Maze, idx: number, dir: Dir): number {
  const d = DIRS.find((v) => v.dir === dir)!;
  return idx + d.dy * m.n + d.dx;
}

/** from からの BFS 距離（到達不能は -1。完全迷路なら全マス到達可能） */
export function bfsDist(m: Maze, from: number): Int16Array {
  const dist = new Int16Array(m.n * m.n).fill(-1);
  dist[from] = 0;
  const queue = [from];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    const cx = cur % m.n;
    const cy = (cur - cx) / m.n;
    for (const d of DIRS) {
      if ((m.walls[cur]! & d.bit) !== 0) continue;
      const ni = (cy + d.dy) * m.n + (cx + d.dx);
      if (dist[ni] === -1) {
        dist[ni] = (dist[cur]! + 1) as never;
        queue.push(ni);
      }
    }
  }
  return dist;
}

/** start→goal の最短経路（方向列）。E2E とヒントなし検証用 */
export function solvePath(m: Maze): Dir[] {
  const dist = bfsDist(m, m.goal); // ゴールからの距離を引くと勾配降下で最短路
  const path: Dir[] = [];
  let cur = m.start;
  let guard = m.n * m.n * 2;
  while (cur !== m.goal && guard-- > 0) {
    const cx = cur % m.n;
    const cy = (cur - cx) / m.n;
    for (const d of DIRS) {
      if ((m.walls[cur]! & d.bit) !== 0) continue;
      const ni = (cy + d.dy) * m.n + (cx + d.dx);
      if (dist[ni]! === dist[cur]! - 1) {
        path.push(d.dir);
        cur = ni;
        break;
      }
    }
  }
  return path;
}
