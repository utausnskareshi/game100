// =============================================================
// ふえる わたし（No.123・かくれゲーム）: 純ロジック（同時移動・出題・ソルバ）
// =============================================================
// - スワイプすると **分身ぜんぶが 同じ方向へ 1マス** 動く。かべや はしに ぶつかった
//   分身だけ 止まるので、だんだん ズレていく。ぜんいんを ゴールに 乗せたら クリア。
// - **分身どうしは かさならない**（前の分身が つまっていれば 後ろも 止まる）。
//   かさなると 二度と はなれられず 詰みになるので、そうならない ルールにしてある。
// - 出題は BFS（幅ゆうせん探索）で 最短手数を 出し、手数が ちょうどよい盤だけ 通す。
// - #99 かがみワールドは「2人が 左右 反対に 動く」。こちらは「N人が 同じ方向に 動く」。
// - DOM 非依存・rng 注入＝決定論。
// =============================================================

export type Dir = 'up' | 'down' | 'left' | 'right';
export const DIRS: Dir[] = ['up', 'down', 'left', 'right'];

export const DELTA: Record<Dir, { dc: number; dr: number }> = {
  up: { dc: 0, dr: -1 },
  down: { dc: 0, dr: 1 },
  left: { dc: -1, dr: 0 },
  right: { dc: 1, dr: 0 },
};

export interface StageSpec {
  cols: number;
  rows: number;
  /** 分身の 数 */
  count: number;
  /** かべの わりあい */
  wallRate: number;
  /** ほしい 最短手数（この はんいに 入る盤だけ 出す） */
  parMin: number;
  parMax: number;
}

export const SPECS: StageSpec[] = [
  { cols: 5, rows: 5, count: 2, wallRate: 0.12, parMin: 4, parMax: 7 },
  { cols: 5, rows: 5, count: 3, wallRate: 0.14, parMin: 5, parMax: 8 },
  { cols: 6, rows: 6, count: 3, wallRate: 0.16, parMin: 6, parMax: 9 },
  { cols: 6, rows: 6, count: 4, wallRate: 0.16, parMin: 7, parMax: 10 },
  { cols: 6, rows: 6, count: 4, wallRate: 0.2, parMin: 8, parMax: 12 },
];

export const STAGES = SPECS.length;
/** 手数の よゆう（最短＋これまで うごかせる） */
export const EXTRA_MOVES = 2;

export interface Stage {
  cols: number;
  rows: number;
  walls: boolean[];
  starts: number[];
  goals: number[];
  par: number;
}

/**
 * 1手 動かす。前に いる分身から 順に 動かすので、
 * 「前が つまっていれば 後ろも 止まる」＝かさならない。
 */
export function step(stage: Stage, pos: number[], dir: Dir): number[] {
  const { dc, dr } = DELTA[dir];
  const { cols, rows, walls } = stage;
  // 進む方向の 前に いるものから 順に
  const order = pos
    .map((p, i) => ({ p, i }))
    .sort((a, b) => {
      const ka = (a.p % cols) * dc + Math.floor(a.p / cols) * dr;
      const kb = (b.p % cols) * dc + Math.floor(b.p / cols) * dr;
      return kb - ka;
    });
  const next = pos.slice();
  const taken = new Set<number>(pos);
  for (const { p, i } of order) {
    const c = (p % cols) + dc;
    const r = Math.floor(p / cols) + dr;
    if (c < 0 || r < 0 || c >= cols || r >= rows) continue;
    const t = r * cols + c;
    if (walls[t]) continue;
    if (taken.has(t)) continue;
    taken.delete(p);
    taken.add(t);
    next[i] = t;
  }
  return next;
}

/** ぜんいんが ゴールに 乗っているか */
export function isSolved(stage: Stage, pos: number[]): boolean {
  return pos.every((p) => stage.goals.includes(p));
}

const key = (pos: number[]): string => pos.slice().sort((a, b) => a - b).join(',');

/** 最短手数（max 手まで さがす）。とけなければ -1 */
export function solve(stage: Stage, max: number): number {
  if (isSolved(stage, stage.starts)) return 0;
  const seen = new Set<string>([key(stage.starts)]);
  let frontier: number[][] = [stage.starts];
  for (let d = 1; d <= max; d++) {
    const next: number[][] = [];
    for (const pos of frontier) {
      for (const dir of DIRS) {
        const np = step(stage, pos, dir);
        const k = key(np);
        if (seen.has(k)) continue;
        seen.add(k);
        if (isSolved(stage, np)) return d;
        next.push(np);
      }
    }
    if (next.length === 0) break;
    frontier = next;
  }
  return -1;
}

function shuffled(rng: () => number, n: number): number[] {
  const a: number[] = [];
  for (let i = 0; i < n; i++) a.push(i);
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = a[i]!;
    a[i] = a[j]!;
    a[j] = t;
  }
  return a;
}

/**
 * 1面を作る。かべ・スタート・ゴールを ちらして、BFS で 最短手数を 見る。
 * 手数が ちょうどよい（parMin〜parMax）ものだけ 通す。
 */
export function makeStage(rng: () => number, spec: StageSpec): Stage {
  const n = spec.cols * spec.rows;
  let fallback: Stage | null = null;
  for (let attempt = 0; attempt < 300; attempt++) {
    const cells = shuffled(rng, n);
    const walls = new Array<boolean>(n).fill(false);
    const wallCount = Math.round(n * spec.wallRate);
    for (let i = 0; i < wallCount; i++) walls[cells[i]!] = true;
    const free = cells.slice(wallCount);
    if (free.length < spec.count * 2) continue;
    const starts = free.slice(0, spec.count);
    const goals = free.slice(spec.count, spec.count * 2);
    const stage: Stage = { cols: spec.cols, rows: spec.rows, walls, starts, goals, par: 0 };
    if (isSolved(stage, starts)) continue;
    const par = solve(stage, spec.parMax);
    if (par < 0) continue;
    stage.par = par;
    if (!fallback) fallback = stage;
    if (par < spec.parMin) continue;
    return stage;
  }
  return fallback ?? { cols: spec.cols, rows: spec.rows, walls: new Array<boolean>(n).fill(false), starts: [0], goals: [1], par: 1 };
}

export function makeStages(rng: () => number): Stage[] {
  return SPECS.map((s) => makeStage(rng, s));
}

/** ステージの点（最短で 250点・1手 よぶんで -40・下限100） */
export function stageScore(moves: number, par: number): number {
  return Math.max(100, 250 - Math.max(0, moves - par) * 40);
}

/** 満点 */
export function maxScore(): number {
  return STAGES * 250;
}
