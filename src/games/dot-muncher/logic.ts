// =============================================================
// もぐもぐドット（No.53）の迷路とゴーストの思考（DOM非依存・純ロジック）
// =============================================================
// - 迷路は「柱フィールド」: 外周＋（行奇数かつ列奇数）が壁。それ以外は通路。
//   → 全通路が必ず つながっている（BFSで保証）・行き止まりなし＝プレイヤーがハマらない。
// - ゴーストは各交差点で「進める方向のうち 目標マスへ いちばん近づく向き（逆走はしない）」を選ぶ。
//   目標を変えることで 性格（追いかけ／先回り／きまぐれ）を出す。
// - 乱数は「きまぐれ」ゴーストのみ rng 引数で注入（ctx.random）。迷路自体は固定（乱数なし）。
// - import してよいのは game-api と同一フォルダのみ（このファイルは依存なし）。

export const COLS = 13;
export const ROWS = 11;

export type Dir = 0 | 1 | 2 | 3; // 0=up 1=right 2=down 3=left
export const DC = [0, 1, 0, -1];
export const DR = [-1, 0, 1, 0];
export const opposite = (d: Dir): Dir => ((d + 2) % 4) as Dir;

export const gi = (c: number, r: number): number => r * COLS + c;

/** 壁か（外周＋奇数×奇数の柱） */
export function isWall(c: number, r: number): boolean {
  if (c <= 0 || r <= 0 || c >= COLS - 1 || r >= ROWS - 1) return true;
  return r % 2 === 1 && c % 2 === 1;
}

export interface MazeInfo {
  /** true=壁 */
  walls: boolean[];
  /** ドットを置くマス（通路のうち パワーエサ・初期位置を除く） */
  dotCells: number[];
  /** パワーエサのマス */
  powerCells: number[];
  playerStart: { c: number; r: number };
  ghostStarts: { c: number; r: number }[];
  dotCount: number;
}

const POWER: [number, number][] = [
  [1, 2],
  [COLS - 2, 2],
  [1, ROWS - 3],
  [COLS - 2, ROWS - 3],
];
const PLAYER: [number, number] = [6, ROWS - 2]; // 下段中央
const GHOSTS: [number, number][] = [
  [4, 5],
  [6, 5],
  [8, 5],
];

export function buildMaze(): MazeInfo {
  const walls: boolean[] = [];
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) walls[gi(c, r)] = isWall(c, r);
  const powerSet = new Set(POWER.map(([c, r]) => gi(c, r)));
  const skip = new Set<number>([gi(PLAYER[0], PLAYER[1]), ...GHOSTS.map(([c, r]) => gi(c, r)), ...powerSet]);
  const dotCells: number[] = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const i = gi(c, r);
      if (!walls[i] && !skip.has(i)) dotCells.push(i);
    }
  }
  return {
    walls,
    dotCells,
    powerCells: POWER.map(([c, r]) => gi(c, r)),
    playerStart: { c: PLAYER[0], r: PLAYER[1] },
    ghostStarts: GHOSTS.map(([c, r]) => ({ c, r })),
    dotCount: dotCells.length,
  };
}

/** start（通路）から到達できる通路マスの数（連結性テスト用） */
export function reachableOpenCount(walls: boolean[], startC: number, startR: number): number {
  const seen = new Uint8Array(COLS * ROWS);
  const q: number[] = [gi(startC, startR)];
  seen[gi(startC, startR)] = 1;
  let n = 0;
  while (q.length) {
    const cur = q.pop() as number;
    n++;
    const cc = cur % COLS;
    const cr = (cur / COLS) | 0;
    for (let d = 0; d < 4; d++) {
      const nc = cc + DC[d]!;
      const nr = cr + DR[d]!;
      if (nc < 0 || nr < 0 || nc >= COLS || nr >= ROWS) continue;
      const ni = gi(nc, nr);
      if (!walls[ni] && !seen[ni]) {
        seen[ni] = 1;
        q.push(ni);
      }
    }
  }
  return n;
}

/** 通路マスの総数 */
export function openCellCount(walls: boolean[]): number {
  let n = 0;
  for (let i = 0; i < walls.length; i++) if (!walls[i]) n++;
  return n;
}

/** そのマスから進める方向（壁でない隣） */
export function openDirs(walls: boolean[], c: number, r: number): Dir[] {
  const dirs: Dir[] = [];
  for (let d = 0 as Dir; d < 4; d++) {
    const nc = c + DC[d]!;
    const nr = r + DR[d]!;
    if (nc >= 0 && nr >= 0 && nc < COLS && nr < ROWS && !walls[gi(nc, nr)]) dirs.push(d);
  }
  return dirs;
}

/**
 * ゴーストの次の向き。進める向き（原則 逆走なし）のうち 目標マスへの直線距離が最小の向きを選ぶ。
 * random>=0 のときは「きまぐれ」＝進める向きから rng で1つ選ぶ（reverse は避ける）。
 */
export function chooseGhostDir(
  walls: boolean[],
  c: number,
  r: number,
  curDir: Dir,
  targetC: number,
  targetR: number,
  rng?: () => number,
): Dir {
  let cands = openDirs(walls, c, r).filter((d) => d !== opposite(curDir));
  if (cands.length === 0) cands = openDirs(walls, c, r); // 行き止まり救済（柱フィールドでは起きない）
  if (rng) {
    return cands[Math.floor(rng() * cands.length)] ?? curDir;
  }
  let best = cands[0]!;
  let bestDist = Infinity;
  for (const d of cands) {
    const nc = c + DC[d]!;
    const nr = r + DR[d]!;
    const dist = Math.abs(nc - targetC) + Math.abs(nr - targetR);
    if (dist < bestDist) {
      bestDist = dist;
      best = d;
    }
  }
  return best;
}

/** dir 方向へ1マス進めるか */
export function canGo(walls: boolean[], c: number, r: number, d: Dir): boolean {
  const nc = c + DC[d]!;
  const nr = r + DR[d]!;
  if (nc < 0 || nr < 0 || nc >= COLS || nr >= ROWS) return false;
  return !walls[gi(nc, nr)];
}
