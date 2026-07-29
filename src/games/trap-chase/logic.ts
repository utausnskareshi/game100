// =============================================================
// ちえの たたかい（No.129・かくれゲーム）: 純ロジック（追手の動き・出題・ソルバ）
// =============================================================
// - じぶんと 追手が こうたいで 1マスずつ 動く。**追手は かならず 自分に 近づく**
//   ＝動きが 読める。その性質を つかって 落とし穴へ 誘い込む。
// - 追手は 落とし穴を よけない（だから 誘い込める）。じぶんは 落とし穴に 入れない。
// - 出題は BFS で「かならず 勝てる」ことを 確かめ、最短手数（par）も 出してから 通す。
// - DOM 非依存・rng 注入＝決定論。
// =============================================================

export const COLS = 5;
export const ROWS = 5;
export const CELLS = COLS * ROWS;

export type Dir = 'up' | 'down' | 'left' | 'right';
export const DIRS: Dir[] = ['up', 'down', 'left', 'right'];
export const DELTA: Record<Dir, { dc: number; dr: number }> = {
  up: { dc: 0, dr: -1 },
  down: { dc: 0, dr: 1 },
  left: { dc: -1, dr: 0 },
  right: { dc: 1, dr: 0 },
};

export interface StageSpec {
  /** 追手の 数 */
  chasers: number;
  /** 落とし穴の 数 */
  pits: number;
  parMin: number;
  parMax: number;
}

export const SPECS: StageSpec[] = [
  { chasers: 2, pits: 3, parMin: 3, parMax: 9 },
  { chasers: 2, pits: 4, parMin: 4, parMax: 11 },
  { chasers: 3, pits: 4, parMin: 5, parMax: 12 },
  { chasers: 3, pits: 5, parMin: 5, parMax: 13 },
];

export const STAGE_COUNT = SPECS.length;
/** 手数の よゆう */
export const EXTRA_MOVES = 3;

export interface Stage {
  pits: boolean[];
  start: number;
  chasers: number[];
  par: number;
}

export interface State {
  me: number;
  /** 追手の いる マス（-1 は 落ちた） */
  cs: number[];
}

const col = (i: number): number => i % COLS;
const row = (i: number): number => Math.floor(i / COLS);

/** じぶんが その方向へ 動けるか（そとと 落とし穴は だめ） */
export function canMove(stage: Stage, me: number, dir: Dir): boolean {
  const { dc, dr } = DELTA[dir];
  const c = col(me) + dc;
  const r = row(me) + dr;
  if (c < 0 || r < 0 || c >= COLS || r >= ROWS) return false;
  return !stage.pits[r * COLS + c];
}

/** 追手 1人の つぎの マス（近づく。ふさがれていたら もう一方の じくを ためす） */
export function chaseStep(from: number, me: number, taken: Set<number>): number {
  const dc = col(me) - col(from);
  const dr = row(me) - row(from);
  const tryMove = (ddc: number, ddr: number): number => {
    if (ddc === 0 && ddr === 0) return -2;
    const c = col(from) + ddc;
    const r = row(from) + ddr;
    if (c < 0 || r < 0 || c >= COLS || r >= ROWS) return -2;
    const t = r * COLS + c;
    if (taken.has(t)) return -2;
    return t;
  };
  const hFirst = Math.abs(dc) >= Math.abs(dr);
  const h = tryMove(Math.sign(dc), 0);
  const v = tryMove(0, Math.sign(dr));
  const first = hFirst ? h : v;
  const second = hFirst ? v : h;
  if (first >= 0) return first;
  if (second >= 0) return second;
  return from;
}

/**
 * 1ターン すすめる（じぶんが dir へ 動き、そのあと 追手が 動く）。
 * 返り値: 'ok' | 'caught'（つかまった） | 'blocked'（動けない）
 */
export function turn(stage: Stage, st: State, dir: Dir): 'ok' | 'caught' | 'blocked' {
  if (!canMove(stage, st.me, dir)) return 'blocked';
  const { dc, dr } = DELTA[dir];
  const to = (row(st.me) + dr) * COLS + (col(st.me) + dc);
  // じぶんが 追手の マスへ 入ったら つかまる
  if (st.cs.some((c) => c === to)) {
    st.me = to;
    return 'caught';
  }
  st.me = to;
  // 追手が 動く
  const taken = new Set<number>(st.cs.filter((c) => c >= 0));
  for (let i = 0; i < st.cs.length; i++) {
    const from = st.cs[i]!;
    if (from < 0) continue;
    taken.delete(from);
    const next = chaseStep(from, st.me, taken);
    if (stage.pits[next]) {
      st.cs[i] = -1; // 落とし穴に 落ちた
      continue;
    }
    st.cs[i] = next;
    taken.add(next);
    if (next === st.me) return 'caught';
  }
  return 'ok';
}

export function isWin(st: State): boolean {
  return st.cs.every((c) => c < 0);
}

export function cloneState(st: State): State {
  return { me: st.me, cs: st.cs.slice() };
}

const keyOf = (st: State): string => `${st.me}|${st.cs.slice().sort((a, b) => a - b).join(',')}`;

/** 最短で 勝てる 手数（max 手まで さがす）。勝てなければ -1 */
export function solve(stage: Stage, max: number): number {
  const start: State = { me: stage.start, cs: stage.chasers.slice() };
  if (isWin(start)) return 0;
  const seen = new Set<string>([keyOf(start)]);
  let frontier: State[] = [start];
  for (let d = 1; d <= max; d++) {
    const next: State[] = [];
    for (const st of frontier) {
      for (const dir of DIRS) {
        const ns = cloneState(st);
        const res = turn(stage, ns, dir);
        if (res !== 'ok') continue;
        if (isWin(ns)) return d;
        const k = keyOf(ns);
        if (seen.has(k)) continue;
        seen.add(k);
        next.push(ns);
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

const dist = (a: number, b: number): number => Math.abs(col(a) - col(b)) + Math.abs(row(a) - row(b));

/** 1面を作る。BFS で「かならず 勝てる」ものだけ 通す */
export function makeStage(rng: () => number, spec: StageSpec): Stage {
  let fallback: Stage | null = null;
  for (let attempt = 0; attempt < 600; attempt++) {
    const order = shuffled(rng, CELLS);
    const pits = new Array<boolean>(CELLS).fill(false);
    for (let i = 0; i < spec.pits; i++) pits[order[i]!] = true;
    const free = order.slice(spec.pits);
    const start = free[0]!;
    const chasers = free.slice(1, 1 + spec.chasers);
    if (chasers.length < spec.chasers) continue;
    // はじめから 近すぎると すぐ つかまる
    if (chasers.some((c) => dist(c, start) < 3)) continue;
    const stage: Stage = { pits, start, chasers, par: 0 };
    const par = solve(stage, spec.parMax);
    if (par < 0) continue;
    stage.par = par;
    if (!fallback) fallback = stage;
    if (par < spec.parMin) continue;
    return stage;
  }
  return fallback ?? { pits: new Array<boolean>(CELLS).fill(false), start: 0, chasers: [24], par: -1 };
}

export function makeStages(rng: () => number): Stage[] {
  return SPECS.map((s) => makeStage(rng, s));
}

/** ステージの点（最短で 250点・1手 よぶんで -20・下限100） */
export function stageScore(moves: number, par: number): number {
  return Math.max(100, 250 - Math.max(0, moves - par) * 20);
}

/** 満点 */
export function maxScore(): number {
  return STAGE_COUNT * 250;
}
