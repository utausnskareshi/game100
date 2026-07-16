// =============================================================
// ぐるっとめいろ（No.65）の盤面生成と重力解決（DOM非依存・純ロジック）
// =============================================================
// - 迷路の世界ごと90°回転させ、ボールを重力で転がしてゴールへ導くパズル。
// - 内部表現は「迷路座標は固定・重力の向きが回る」。画面をCW（▶）に回すと、
//   画面の下＝迷路の東になる（幾何: 回転行列の逆写像。S→E→N→W の順）。
// - 生成は「BFS(セル×重力4方向)で解けること＋最短回転数(par)が範囲内」を
//   満たすまで再抽選（打ち切り＋段階緩和＋手作りフォールバック）。
// - ほうせきは「最短解が実際に通るセル」にだけ置く＝最短プレイで全回収できる。
// - 乱数は rng 注入（ctx.random＝日替わり同一）。
// - import してよいのは game-api と同一フォルダのみ（このファイルは依存なし）。

/** 重力の向き（迷路座標）。▶(CW)で +1、◀(CCW)で +3 (mod 4) */
export type Grav = 0 | 1 | 2 | 3; // 0:S(+y) 1:E(+x) 2:N(-y) 3:W(-x)
export const DX = [0, 1, 0, -1] as const;
export const DY = [1, 0, -1, 0] as const;

export const GEM_PTS = 15;
export const CLEAR_PTS = 100;
/** さいたんぴったりのボーナス／1回転オーバーごとの減点 */
export const PAR_BONUS = 100;
export const OVER_PENALTY = 15;

export interface Board {
  n: number;
  wall: boolean[];
  spike: boolean[];
  start: number;
  goal: number;
  gems: number[];
  par: number;
  solution: ('L' | 'R')[];
  /** 生成が打ち切りに達して手作り盤面に落ちたか（テスト観測用） */
  fallback: boolean;
}

export interface PuzzleCfg {
  n: number;
  spikes: number;
  parMin: number;
  parMax: number;
  gems: number;
}

export const PUZZLES: PuzzleCfg[] = [
  { n: 7, spikes: 1, parMin: 3, parMax: 5, gems: 3 },
  { n: 8, spikes: 2, parMin: 4, parMax: 7, gems: 4 },
  { n: 9, spikes: 3, parMin: 5, parMax: 9, gems: 5 },
];

export const rotR = (g: Grav): Grav => (((g + 1) % 4) as Grav);
export const rotL = (g: Grav): Grav => (((g + 3) % 4) as Grav);

export interface FallResult {
  /** 入ったセルの列（最後のセル＝end も含む。動かなければ空） */
  path: number[];
  end: number;
  outcome: 'settle' | 'spike' | 'goal';
}

/** cell から重力 g の向きへ転がす（かべで止まる・トゲ/ゴールに入ると終了） */
export function fall(board: Pick<Board, 'n' | 'wall' | 'spike' | 'goal'>, cell: number, g: Grav): FallResult {
  const n = board.n;
  const path: number[] = [];
  let cur = cell;
  for (;;) {
    const cx = cur % n;
    const cy = Math.floor(cur / n);
    const nx = cx + DX[g];
    const ny = cy + DY[g];
    if (nx < 0 || ny < 0 || nx >= n || ny >= n) return { path, end: cur, outcome: 'settle' };
    const ni = ny * n + nx;
    if (board.wall[ni]) return { path, end: cur, outcome: 'settle' };
    path.push(ni);
    cur = ni;
    if (board.spike[ni]) return { path, end: ni, outcome: 'spike' };
    if (ni === board.goal) return { path, end: ni, outcome: 'goal' };
  }
}

/** BFS で最短回転数と解を求める（解なしは null）。開始は (start, 重力S・settle済み) */
export function solve(board: Pick<Board, 'n' | 'wall' | 'spike' | 'start' | 'goal'>): { par: number; moves: ('L' | 'R')[] } | null {
  const n = board.n;
  const total = n * n * 4;
  const seen = new Uint8Array(total);
  const parent = new Int32Array(total).fill(-1);
  const parentMove: ('L' | 'R')[] = new Array(total);
  const key = (cell: number, g: Grav): number => cell * 4 + g;
  const q: number[] = [key(board.start, 0)];
  seen[key(board.start, 0)] = 1;
  let head = 0;
  while (head < q.length) {
    const k = q[head++]!;
    const cell = Math.floor(k / 4);
    const g = (k % 4) as Grav;
    for (const mv of ['L', 'R'] as const) {
      const g2 = mv === 'L' ? rotL(g) : rotR(g);
      const f = fall(board, cell, g2);
      if (f.outcome === 'spike') continue;
      if (f.outcome === 'goal') {
        // 復元
        const moves: ('L' | 'R')[] = [mv];
        let cur = k;
        while ((parent[cur] ?? -1) >= 0) {
          moves.unshift(parentMove[cur]!);
          cur = parent[cur]!;
        }
        return { par: moves.length, moves };
      }
      const k2 = key(f.end, g2);
      if (!seen[k2]) {
        seen[k2] = 1;
        parent[k2] = k;
        parentMove[k2] = mv;
        q.push(k2);
      }
    }
  }
  return null;
}

/** 最短解を再生して、ボールが通る（enterする）セルの集合を返す */
export function traversedCells(board: Board): Set<number> {
  const cells = new Set<number>();
  let cur = board.start;
  let g: Grav = 0;
  for (const mv of board.solution) {
    g = mv === 'L' ? rotL(g) : rotR(g);
    const f = fall(board, cur, g);
    for (const c of f.path) cells.add(c);
    cur = f.end;
  }
  return cells;
}

// 生成器の実出力から固定したフォールバック（生成打ち切り時の保険。解けることはテストで実証）
export const FALLBACK_ROWS: Record<number, string[]> = {
  7: ['#######', '#..G..#', '#...^.#', '#.....#', '#.#...#', '#...S.#', '#######'],
  8: ['########', '#...##.#', '#.^...G#', '#..#...#', '#.....##', '#.#^..##', '#S#..#.#', '########'],
  9: ['#########', '#..G..###', '##......#', '#.#...^.#', '#..^....#', '#.#..^#.#', '#S..##..#', '##......#', '#########'],
};

export function parseBoard(rows: string[]): Omit<Board, 'par' | 'solution' | 'gems' | 'fallback'> {
  const n = rows.length;
  const wall: boolean[] = new Array(n * n).fill(false);
  const spike: boolean[] = new Array(n * n).fill(false);
  let start = -1;
  let goal = -1;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const ch = rows[y]?.[x] ?? '#';
      const i = y * n + x;
      if (ch === '#') wall[i] = true;
      else if (ch === 'S') start = i;
      else if (ch === 'G') goal = i;
      else if (ch === '^') spike[i] = true;
    }
  }
  return { n, wall, spike, start, goal };
}

function pickGems(board: Board, count: number, rng: () => number): number[] | null {
  const cand = [...traversedCells(board)].filter((c) => c !== board.goal && !board.spike[c] && c !== board.start);
  if (cand.length < count) return null;
  const gems: number[] = [];
  while (gems.length < count && cand.length > 0) {
    const i = Math.floor(rng() * cand.length);
    gems.push(cand[i]!);
    cand.splice(i, 1);
  }
  return gems;
}

/** 盤面を生成する（打ち切り400回・250回で緩和・保険は手作り盤面） */
export function generate(cfg: PuzzleCfg, rng: () => number): Board {
  let spikes = cfg.spikes;
  let parMin = cfg.parMin;
  for (let tries = 0; tries < 400; tries++) {
    if (tries === 250 && spikes > 0) spikes--;
    if (tries === 320 && parMin > 2) parMin--;
    const n = cfg.n;
    const wall: boolean[] = new Array(n * n).fill(false);
    const spike: boolean[] = new Array(n * n).fill(false);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const i = y * n + x;
        if (x === 0 || y === 0 || x === n - 1 || y === n - 1) wall[i] = true;
        else if (rng() < 0.17) wall[i] = true;
      }
    }
    // スタートは「下がかべ＝最初から settle 済み」のセルから選ぶ（初期落下なし）
    const startCands: number[] = [];
    for (let y = 1; y < n - 1; y++) {
      for (let x = 1; x < n - 1; x++) {
        const i = y * n + x;
        if (!wall[i] && wall[i + n]) startCands.push(i);
      }
    }
    if (startCands.length === 0) continue;
    const start = startCands[Math.floor(rng() * startCands.length)]!;
    const floor: number[] = [];
    for (let i = 0; i < n * n; i++) if (!wall[i] && i !== start) floor.push(i);
    if (floor.length < spikes + 2) continue;
    const goal = floor[Math.floor(rng() * floor.length)]!;
    const sx = start % n;
    const sy = Math.floor(start / n);
    const gx = goal % n;
    const gy = Math.floor(goal / n);
    if (Math.abs(sx - gx) + Math.abs(sy - gy) < n - 2) continue;
    const spikeCells: number[] = [];
    let guard = 0;
    while (spikeCells.length < spikes && guard++ < 80) {
      const c = floor[Math.floor(rng() * floor.length)]!;
      if (c === goal || spikeCells.includes(c)) continue;
      spikeCells.push(c);
    }
    for (const c of spikeCells) spike[c] = true;
    const partial = { n, wall, spike, start, goal };
    const sol = solve(partial);
    if (!sol || sol.par < parMin || sol.par > cfg.parMax) continue;
    const board: Board = { n, wall, spike, start, goal, gems: [], par: sol.par, solution: sol.moves, fallback: false };
    const gems = pickGems(board, cfg.gems, rng);
    if (!gems) continue;
    board.gems = gems;
    return board;
  }
  // 保険: 手作り盤面
  const p = parseBoard(FALLBACK_ROWS[cfg.n] ?? FALLBACK_ROWS[7]!);
  const sol = solve(p);
  const board: Board = { ...p, gems: [], par: sol?.par ?? 1, solution: sol?.moves ?? [], fallback: true };
  board.gems = pickGems(board, Math.min(cfg.gems, 2), rng) ?? [];
  return board;
}
