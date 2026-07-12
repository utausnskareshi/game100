// =============================================================
// はこおしパズル（No.34）の盤面生成・移動ロジック（DOM非依存・乱数注入）
// =============================================================
// - 生成は「完成形（はこ＝ゴール上）から、はこを逆に引いて崩す」方式。
//   引き（pull）の列を逆再生すると必ず押し（push）で解けるので、可解性が構造的に保証される。
// - 内壁は「床の連結を壊さない場所」にだけ置く（置いてみて BFS で確認、だめなら戻す）。
// - rng 注入＝「今日のゲーム」では全員同じ倉庫。
// - import してよいのは game-api（types/helpers）と同一フォルダのみ（このファイルは依存なし）。

export type Dir = 'up' | 'right' | 'down' | 'left';

export const OPPOSITE: Record<Dir, Dir> = { up: 'down', down: 'up', left: 'right', right: 'left' };

const DIRS: { dir: Dir; dx: number; dy: number }[] = [
  { dir: 'up', dx: 0, dy: -1 },
  { dir: 'right', dx: 1, dy: 0 },
  { dir: 'down', dx: 0, dy: 1 },
  { dir: 'left', dx: -1, dy: 0 },
];

export type LevelKey = 'easy' | 'normal' | 'hard';

interface LevelDef {
  n: number;
  boxes: number;
  walls: number;
  pullsMin: number;
  pullsVar: number;
}

export const LEVELS: Record<LevelKey, LevelDef> = {
  easy: { n: 6, boxes: 2, walls: 4, pullsMin: 8, pullsVar: 5 },
  normal: { n: 7, boxes: 3, walls: 6, pullsMin: 12, pullsVar: 7 },
  hard: { n: 8, boxes: 4, walls: 8, pullsMin: 16, pullsVar: 9 },
};

/** idx から dir へ1歩すすんだ idx（盤外は -1） */
export function stepIdx(idx: number, dir: Dir, n: number): number {
  const d = DIRS.find((v) => v.dir === dir)!;
  const x = idx % n;
  const y = (idx - x) / n;
  const nx = x + d.dx;
  const ny = y + d.dy;
  if (nx < 0 || ny < 0 || nx >= n || ny >= n) return -1;
  return ny * n + nx;
}

export interface Puzzle {
  n: number;
  /** 1=内壁 */
  walls: Uint8Array;
  goals: number[];
  boxesStart: number[];
  playerStart: number;
  /** 生成器が知っている解（前から順に入力すると必ず解ける。最短とは限らない） */
  solution: Dir[];
  /** 解に含まれる「押し」の回数 */
  pushes: number;
}

export interface MoveResult {
  player: number;
  boxes: number[];
  /** 何かしら動いたか */
  moved: boolean;
  /** はこを押したか */
  pushed: boolean;
}

/** 1歩の移動（押し込み判定込み・純関数）。動けなければ moved=false のまま返す */
export function applyMove(walls: Uint8Array, n: number, player: number, boxes: number[], dir: Dir): MoveResult {
  const t = stepIdx(player, dir, n);
  if (t < 0 || walls[t]) return { player, boxes, moved: false, pushed: false };
  const bi = boxes.indexOf(t);
  if (bi < 0) return { player: t, boxes, moved: true, pushed: false };
  const t2 = stepIdx(t, dir, n);
  if (t2 < 0 || walls[t2] || boxes.includes(t2)) return { player, boxes, moved: false, pushed: false };
  const nb = boxes.slice();
  nb[bi] = t2;
  return { player: t, boxes: nb, moved: true, pushed: true };
}

/** すべての はこが ゴールの上か */
export function isSolved(boxes: number[], goals: number[]): boolean {
  return boxes.every((b) => goals.includes(b));
}

/** 床（壁でないマス）がぜんぶつながっているか */
function floorConnected(walls: Uint8Array, n: number): boolean {
  const total = n * n;
  let start = -1;
  let floors = 0;
  for (let i = 0; i < total; i++) {
    if (!walls[i]) {
      floors++;
      if (start < 0) start = i;
    }
  }
  if (start < 0) return false;
  const seen = new Uint8Array(total);
  seen[start] = 1;
  const queue = [start];
  let count = 1;
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const d of DIRS) {
      const t = stepIdx(cur, d.dir, n);
      if (t < 0 || walls[t] || seen[t]) continue;
      seen[t] = 1;
      count++;
      queue.push(t);
    }
  }
  return count === floors;
}

/** floors から distinct に k 個えらぶ（rng注入） */
function pickDistinct(rng: () => number, pool: number[], k: number, exclude: Set<number>): number[] {
  const cand = pool.filter((c) => !exclude.has(c));
  const out: number[] = [];
  while (out.length < k && cand.length > 0) {
    const i = Math.floor(rng() * cand.length);
    out.push(cand.splice(i, 1)[0]!);
  }
  return out;
}

/** パズルを生成する（必ず解ける・開始時点では未完成を保証） */
export function generatePuzzle(rng: () => number, level: LevelKey): Puzzle {
  const def = LEVELS[level];
  const n = def.n;
  for (let attempt = 0; attempt < 60; attempt++) {
    // 1) 内壁（床の連結を保つ場所だけ）
    const walls = new Uint8Array(n * n);
    let placed = 0;
    let tries = 0;
    while (placed < def.walls && tries++ < def.walls * 10) {
      const c = Math.floor(rng() * n * n);
      if (walls[c]) continue;
      walls[c] = 1;
      if (!floorConnected(walls, n)) {
        walls[c] = 0;
        continue;
      }
      placed++;
    }
    const floors: number[] = [];
    for (let i = 0; i < n * n; i++) if (!walls[i]) floors.push(i);
    if (floors.length < def.boxes * 2 + 4) continue;

    // 2) 完成形: ゴール＝はこ。プレイヤーはそれ以外の床
    const goals = pickDistinct(rng, floors, def.boxes, new Set());
    if (goals.length < def.boxes) continue;
    let boxes = goals.slice();
    const pStart = pickDistinct(rng, floors, 1, new Set(boxes));
    if (pStart.length < 1) continue;
    let player = pStart[0]!;

    // 3) 逆再生: 引き（pull）と歩きをまぜて崩す
    const ops: { kind: 'walk' | 'pull'; dir: Dir }[] = [];
    let pulls = 0;
    const target = def.pullsMin + Math.floor(rng() * (def.pullsVar + 1));
    let guard = 0;
    while (pulls < target && guard++ < target * 50) {
      const wantPull = rng() < 0.6;
      // 方向をシャッフル
      const order = [...DIRS];
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        const t = order[i]!;
        order[i] = order[j]!;
        order[j] = t;
      }
      let done = false;
      if (wantPull) {
        for (const d of order) {
          const behind = stepIdx(player, OPPOSITE[d.dir], n); // 引かれる はこ
          const ahead = stepIdx(player, d.dir, n); // プレイヤーの下がり先
          if (behind < 0 || ahead < 0) continue;
          if (!boxes.includes(behind)) continue;
          if (walls[ahead] || boxes.includes(ahead)) continue;
          boxes = boxes.slice();
          boxes[boxes.indexOf(behind)] = player;
          player = ahead;
          ops.push({ kind: 'pull', dir: d.dir });
          pulls++;
          done = true;
          break;
        }
      }
      if (!done) {
        for (const d of order) {
          const t = stepIdx(player, d.dir, n);
          if (t < 0 || walls[t] || boxes.includes(t)) continue;
          player = t;
          ops.push({ kind: 'walk', dir: d.dir });
          done = true;
          break;
        }
      }
      if (!done) break; // 完全に詰まった（きわめて稀）→ このまま判定へ
    }
    if (pulls < def.pullsMin) continue;
    if (isSolved(boxes, goals)) continue; // 偶然もどってしまったら作り直し

    // 4) 解＝逆順＋逆方向（pull→push / walk→walk）
    const solution = ops
      .slice()
      .reverse()
      .map((o) => OPPOSITE[o.dir]);
    return { n, walls, goals, boxesStart: boxes, playerStart: player, solution, pushes: pulls };
  }
  // 60回失敗は事実上起きない（保険: 乱数列に頼らない固定の1手盤）
  return {
    n: def.n,
    walls: new Uint8Array(def.n * def.n),
    goals: [1],
    boxesStart: [2],
    playerStart: 3,
    solution: ['left'],
    pushes: 1,
  };
}
