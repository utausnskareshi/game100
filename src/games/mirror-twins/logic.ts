// =============================================================
// かがみワールド（No.99）: 純ロジック（鏡移動・盤面生成・テスト対象）
// =============================================================
// - 本体を動かすと 鏡の分身が「左右反対」に動く（上下は同じ）。かべに当たった側だけ止まる＝ズレる。
//   2体を同時に それぞれのゴールへ。トゲを踏むとリセット（やり直し）。
// - 生成: 本体＝ランダム位置、分身＝その左右鏡の位置から、鏡ルールでランダムに歩かせる。
//   終点を各ゴールに、歩いた道の外をトゲに＝**その歩きが必ず解になる**（構成的に可解）。
//   可解性はプロパティテストで全数照合。すべて rng 注入＝決定論。
// =============================================================

export type Dir = 'U' | 'D' | 'L' | 'R';
export const mirror = (d: Dir): Dir => (d === 'L' ? 'R' : d === 'R' ? 'L' : d);
export const dxOf = (d: Dir): number => (d === 'L' ? -1 : d === 'R' ? 1 : 0);
export const dyOf = (d: Dir): number => (d === 'U' ? -1 : d === 'D' ? 1 : 0);

export interface Pt {
  x: number;
  y: number;
}
export interface Level {
  cols: number;
  rows: number;
  mainStart: Pt;
  twinStart: Pt;
  mainGoal: Pt;
  twinGoal: Pt;
  walls: number[];
  spikes: number[];
  par: number;
  solution: Dir[];
}
export interface Stage {
  cols: number;
  rows: number;
  walls: number;
  spikes: number;
  moves: number;
}
export const STAGES: Stage[] = [
  { cols: 5, rows: 5, walls: 2, spikes: 1, moves: 6 },
  { cols: 5, rows: 6, walls: 3, spikes: 2, moves: 8 },
  { cols: 6, rows: 6, walls: 4, spikes: 2, moves: 10 },
  { cols: 6, rows: 7, walls: 5, spikes: 3, moves: 12 },
  { cols: 6, rows: 7, walls: 6, spikes: 3, moves: 14 },
];

const DIRS: Dir[] = ['U', 'D', 'L', 'R'];

/** 1体を dir へ動かす（盤内かつ壁でなければ移動、さもなくば留まる） */
export function moveChar(p: Pt, dir: Dir, walls: Set<number>, cols: number, rows: number): Pt {
  const nx = p.x + dxOf(dir);
  const ny = p.y + dyOf(dir);
  if (nx < 0 || ny < 0 || nx >= cols || ny >= rows || walls.has(ny * cols + nx)) return { x: p.x, y: p.y };
  return { x: nx, y: ny };
}

function shuffle<T>(a: T[], rng: () => number): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = a[i]!;
    a[i] = a[j]!;
    a[j] = t;
  }
  return a;
}

const same = (a: Pt, b: Pt): boolean => a.x === b.x && a.y === b.y;

/** ステージ index の盤面を生成（構成的に可解＋トゲは解の道の外） */
export function makeLevel(rng: () => number, stageIndex: number): Level {
  const st = STAGES[Math.min(stageIndex, STAGES.length - 1)]!;
  const { cols, rows } = st;
  const N = cols * rows;

  for (let attempt = 0; attempt < 300; attempt++) {
    // 壁
    const walls = new Set<number>();
    const wc = shuffle(Array.from({ length: N }, (_, i) => i), rng);
    for (let i = 0; i < st.walls; i++) walls.add(wc[i]!);
    // 本体スタート（非壁）と 分身スタート（左右鏡・非壁・別セル）
    const mainStart: Pt = { x: 0, y: 0 };
    let found = false;
    for (const ci of shuffle(Array.from({ length: N }, (_, i) => i), rng)) {
      if (walls.has(ci)) continue;
      const x = ci % cols;
      const y = (ci / cols) | 0;
      const tx = cols - 1 - x;
      if (tx === x) continue; // 中央列は鏡が同じ→不可
      if (walls.has(y * cols + tx)) continue;
      mainStart.x = x; mainStart.y = y;
      found = true;
      break;
    }
    if (!found) continue;
    const twinStart: Pt = { x: cols - 1 - mainStart.x, y: mainStart.y };

    // 鏡ルールで歩く
    let m: Pt = { ...mainStart };
    let t: Pt = { ...twinStart };
    const occupied = new Set<number>([m.y * cols + m.x, t.y * cols + t.x]);
    const solution: Dir[] = [];
    let guard = 0;
    while (solution.length < st.moves && guard++ < st.moves * 5) {
      const cand = DIRS.filter((d) => {
        const nm = moveChar(m, d, walls, cols, rows);
        const nt = moveChar(t, mirror(d), walls, cols, rows);
        return !same(nm, m) || !same(nt, t);
      });
      if (cand.length === 0) break;
      const both = cand.filter((d) => {
        const nm = moveChar(m, d, walls, cols, rows);
        const nt = moveChar(t, mirror(d), walls, cols, rows);
        return !same(nm, m) && !same(nt, t);
      });
      const pool = both.length ? both : cand;
      const d = pool[Math.floor(rng() * pool.length)]!;
      m = moveChar(m, d, walls, cols, rows);
      t = moveChar(t, mirror(d), walls, cols, rows);
      occupied.add(m.y * cols + m.x);
      occupied.add(t.y * cols + t.x);
      solution.push(d);
    }
    if (solution.length < Math.max(3, st.moves - 2)) continue;
    const mainGoal: Pt = { ...m };
    const twinGoal: Pt = { ...t };
    if (same(mainGoal, mainStart) || same(twinGoal, twinStart)) continue; // 動いていない
    if (same(mainGoal, twinGoal)) continue; // ゴールが重なるのは避ける

    // トゲ: 誰も通らなかったセル（＝解の道の外）
    const spikeCand: number[] = [];
    for (let ci = 0; ci < N; ci++) if (!occupied.has(ci) && !walls.has(ci)) spikeCand.push(ci);
    if (spikeCand.length < st.spikes) continue;
    shuffle(spikeCand, rng);
    const spikes = spikeCand.slice(0, st.spikes);

    return { cols, rows, mainStart, twinStart, mainGoal, twinGoal, walls: [...walls], spikes, par: solution.length, solution };
  }
  // フォールバック（まず来ない）
  return { cols, rows, mainStart: { x: 0, y: 0 }, twinStart: { x: cols - 1, y: 0 }, mainGoal: { x: 0, y: 1 }, twinGoal: { x: cols - 1, y: 1 }, walls: [], spikes: [], par: 1, solution: ['D'] };
}
