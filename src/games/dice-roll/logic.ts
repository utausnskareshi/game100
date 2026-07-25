// =============================================================
// コロコロダイス（No.97）: 純ロジック（サイコロ回転・盤面生成・テスト対象）
// =============================================================
// - サイコロを1マスずつ転がすと「上の目」が変わる（向き追跡パズル）。
//   目標マスに「指定の目」で乗ると スタンプ。全部スタンプでクリア。
// - 盤面生成: スタート位置からランダムに転がす「歩き」を作り、通ったマスの
//   （マス, その時の上の目）を目標として記録＝**その歩きが必ず解になる**（構成的に可解）。
//   壁は歩きが通らなかったマスにだけ置く＝解を塞がない。可解性はプロパティテストで全数照合。
// - すべて rng 注入＝決定論（日替わり共通）。
// =============================================================

/** サイコロの向き。T=上/N=北(奥)/E=東(右) の目。反対面は 7-x（1↔6/2↔5/3↔4） */
export interface Die {
  T: number;
  N: number;
  E: number;
}

export type Dir = 'U' | 'D' | 'L' | 'R';

/** dir 方向へ1マス転がしたあとの向き */
export function roll(d: Die, dir: Dir): Die {
  switch (dir) {
    case 'U':
      return { T: 7 - d.N, N: d.T, E: d.E };
    case 'D':
      return { T: d.N, N: 7 - d.T, E: d.E };
    case 'R':
      return { T: 7 - d.E, N: d.N, E: d.T };
    case 'L':
      return { T: d.E, N: d.N, E: 7 - d.T };
  }
}

export const START_DIE: Die = { T: 1, N: 2, E: 3 };

export const dxOf = (dir: Dir): number => (dir === 'L' ? -1 : dir === 'R' ? 1 : 0);
export const dyOf = (dir: Dir): number => (dir === 'U' ? -1 : dir === 'D' ? 1 : 0);

export interface Goal {
  x: number;
  y: number;
  face: number;
}
export interface Level {
  cols: number;
  rows: number;
  start: { x: number; y: number };
  startDie: Die;
  goals: Goal[];
  walls: number[]; // cell index
  par: number;
  solution: Dir[];
}

export interface Stage {
  cols: number;
  rows: number;
  goals: number;
  walls: number;
}
export const STAGES: Stage[] = [
  { cols: 4, rows: 4, goals: 2, walls: 0 },
  { cols: 4, rows: 5, goals: 3, walls: 1 },
  { cols: 5, rows: 5, goals: 3, walls: 2 },
  { cols: 5, rows: 6, goals: 4, walls: 3 },
  { cols: 6, rows: 6, goals: 4, walls: 4 },
];

const DIRS: Dir[] = ['U', 'D', 'L', 'R'];

function shuffle<T>(arr: T[], rng: () => number): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = t;
  }
  return arr;
}

/** ステージ index の盤面を生成（構成的に可解＋壁は解を塞がない） */
export function makeLevel(rng: () => number, stageIndex: number): Level {
  const st = STAGES[Math.min(stageIndex, STAGES.length - 1)]!;
  const { cols, rows, goals: numGoals, walls: numWalls } = st;
  const N = cols * rows;
  const sx = Math.floor(rng() * cols);
  const sy = Math.floor(rng() * rows);
  const startCell = sy * cols + sx;

  let die: Die = { ...START_DIE };
  let x = sx;
  let y = sy;
  const solution: Dir[] = [];
  const firstFace = new Map<number, number>(); // cell -> 初訪問時の上の目
  firstFace.set(startCell, die.T);

  const targetDistinct = numGoals + 2;
  const maxSteps = 90;
  let steps = 0;
  while (steps < maxSteps && firstFace.size < targetDistinct) {
    const valid = DIRS.filter((d) => {
      const nx = x + dxOf(d);
      const ny = y + dyOf(d);
      return nx >= 0 && nx < cols && ny >= 0 && ny < rows;
    });
    const unvis = valid.filter((d) => !firstFace.has((y + dyOf(d)) * cols + (x + dxOf(d))));
    const pool = unvis.length ? unvis : valid;
    const pick = pool[Math.floor(rng() * pool.length)]!;
    die = roll(die, pick);
    x += dxOf(pick);
    y += dyOf(pick);
    steps++;
    solution.push(pick);
    const ci = y * cols + x;
    if (!firstFace.has(ci)) firstFace.set(ci, die.T);
  }

  // 目標: スタート以外の訪問マスから numGoals 個（初訪問時の目を要求）
  const cells = [...firstFace.keys()].filter((ci) => ci !== startCell);
  shuffle(cells, rng);
  const goals: Goal[] = cells.slice(0, numGoals).map((ci) => ({ x: ci % cols, y: (ci / cols) | 0, face: firstFace.get(ci)! }));

  // 壁: 一度も通らなかったマスにだけ置く（解を塞がない）
  const wallCand: number[] = [];
  for (let ci = 0; ci < N; ci++) if (!firstFace.has(ci)) wallCand.push(ci);
  shuffle(wallCand, rng);
  const walls = wallCand.slice(0, numWalls);

  return { cols, rows, start: { x: sx, y: sy }, startDie: { ...START_DIE }, goals, walls, par: steps, solution };
}
