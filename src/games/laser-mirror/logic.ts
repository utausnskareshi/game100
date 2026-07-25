// =============================================================
// はんしゃレーザー（No.98）: 純ロジック（光線トレース・盤面生成・テスト対象）
// =============================================================
// - グリッドの鏡（/ か \）でレーザーを反射させ、全部の宝石を通す（爆弾は避ける）。
//   プレイヤーは鏡をタップして 90°回転（/ ↔ \）。
// - 生成: 発射口からレーザーの通り道を「曲がり角に鏡を置きながら」作る＝その鏡の向きが解。
//   通り道の一部を宝石に、通り道の外を爆弾に。鏡の一部を反対向きにスクランブルして初期状態にする。
//   → 必ず解が存在（元の向き）。可解性はプロパティテストで総当り確認。
// - すべて rng 注入＝決定論（日替わり共通）。
// =============================================================

export type Orient = '/' | '\\';

/** 方向 index: 0=右 1=下 2=左 3=上 */
export const DIRS: [number, number][] = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
];
const SLASH = [3, 2, 1, 0]; // '/' の反射（R→U, D→L, L→D, U→R）
const BACK = [1, 0, 3, 2]; //  '\' の反射（R→D, D→R, L→U, U→L）

export function reflect(dir: number, o: Orient): number {
  return o === '/' ? SLASH[dir]! : BACK[dir]!;
}
/** inDir から outDir へ 90°曲げる鏡の向き */
export function mirrorFor(inDir: number, outDir: number): Orient {
  return SLASH[inDir] === outDir ? '/' : '\\';
}

export interface Mirror {
  x: number;
  y: number;
  sol: Orient; // 解の向き
  init: Orient; // 初期（スクランブル後）の向き
}
export interface Pt {
  x: number;
  y: number;
}
export interface Level {
  cols: number;
  rows: number;
  emit: { x: number; y: number; dir: number }; // 最初にレーザーが入るセルと向き
  mirrors: Mirror[];
  gems: Pt[];
  bombs: Pt[];
}

export interface Stage {
  cols: number;
  rows: number;
  bends: number;
  gems: number;
  bombs: number;
}
export const STAGES: Stage[] = [
  { cols: 5, rows: 5, bends: 2, gems: 2, bombs: 1 },
  { cols: 5, rows: 6, bends: 3, gems: 2, bombs: 1 },
  { cols: 6, rows: 6, bends: 3, gems: 3, bombs: 2 },
  { cols: 6, rows: 7, bends: 4, gems: 3, bombs: 2 },
  { cols: 6, rows: 7, bends: 5, gems: 4, bombs: 3 },
];

/**
 * レーザーをトレース。orient[i] は mirrors[i] の現在の向き。
 * 返り値 path = レーザーが通ったセル列（順）、bombHit = 爆弾に当たったか。
 */
export function trace(level: Level, orient: Orient[]): { path: Pt[]; bombHit: boolean } {
  const { cols, rows } = level;
  const mAt = new Map<number, number>();
  for (let i = 0; i < level.mirrors.length; i++) mAt.set(level.mirrors[i]!.y * cols + level.mirrors[i]!.x, i);
  const bombSet = new Set(level.bombs.map((b) => b.y * cols + b.x));
  let x = level.emit.x;
  let y = level.emit.y;
  let dir = level.emit.dir;
  const path: Pt[] = [];
  const CAP = cols * rows * 4 + 8;
  let bombHit = false;
  for (let steps = 0; steps < CAP; steps++) {
    if (x < 0 || y < 0 || x >= cols || y >= rows) break;
    const ci = y * cols + x;
    path.push({ x, y });
    if (bombSet.has(ci)) {
      bombHit = true;
      break;
    }
    const mi = mAt.get(ci);
    if (mi !== undefined) dir = reflect(dir, orient[mi]!);
    x += DIRS[dir]![0];
    y += DIRS[dir]![1];
  }
  return { path, bombHit };
}

/** その向きで解けているか（全宝石を通り、爆弾に当たらない） */
export function solved(level: Level, orient: Orient[]): boolean {
  const { path, bombHit } = trace(level, orient);
  if (bombHit) return false;
  const lit = new Set(path.map((p) => p.y * level.cols + p.x));
  return level.gems.every((gm) => lit.has(gm.y * level.cols + gm.x));
}

const opp = (o: Orient): Orient => (o === '/' ? '\\' : '/');

function shuffle<T>(a: T[], rng: () => number): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = a[i]!;
    a[i] = a[j]!;
    a[j] = t;
  }
  return a;
}

/** ステージ index の盤面を生成（構成的に可解＋スクランブルで未解状態にする） */
export function makeLevel(rng: () => number, stageIndex: number): Level {
  const st = STAGES[Math.min(stageIndex, STAGES.length - 1)]!;
  const { cols, rows } = st;

  for (let attempt = 0; attempt < 400; attempt++) {
    // 発射口（4辺のどこか）
    const edge = Math.floor(rng() * 4);
    let x: number;
    let y: number;
    let dir: number;
    if (edge === 0) { x = 0; y = Math.floor(rng() * rows); dir = 0; }
    else if (edge === 1) { x = Math.floor(rng() * cols); y = 0; dir = 1; }
    else if (edge === 2) { x = cols - 1; y = Math.floor(rng() * rows); dir = 2; }
    else { x = Math.floor(rng() * cols); y = rows - 1; dir = 3; }

    const visited = new Set<number>([y * cols + x]);
    const pathCells: Pt[] = [{ x, y }];
    const mirrors: Mirror[] = [];
    const inGrid = (px: number, py: number): boolean => px >= 0 && py >= 0 && px < cols && py < rows;

    let ok = true;
    for (let k = 0; k < st.bends; k++) {
      // 直進（1〜3マス・盤内・未訪問のみ）
      let moved = 0;
      const seg = 1 + Math.floor(rng() * 3);
      for (let s = 0; s < seg; s++) {
        const nx = x + DIRS[dir]![0];
        const ny = y + DIRS[dir]![1];
        if (!inGrid(nx, ny) || visited.has(ny * cols + nx)) break;
        x = nx; y = ny; visited.add(y * cols + x); pathCells.push({ x, y }); moved++;
      }
      if (moved === 0) { ok = false; break; } // 曲がる前に1マスも進めない→やり直し
      // 曲がれる向き（未訪問へ）
      const opts = [(dir + 1) % 4, (dir + 3) % 4].filter((nd) => {
        const nx = x + DIRS[nd]![0];
        const ny = y + DIRS[nd]![1];
        return inGrid(nx, ny) && !visited.has(ny * cols + nx);
      });
      if (opts.length === 0) { ok = false; break; }
      const outDir = opts[Math.floor(rng() * opts.length)]!;
      mirrors.push({ x, y, sol: mirrorFor(dir, outDir), init: '/' });
      dir = outDir;
    }
    if (!ok || mirrors.length < Math.min(2, st.bends)) continue;
    // 最後の直進
    for (let s = 0; s < 3; s++) {
      const nx = x + DIRS[dir]![0];
      const ny = y + DIRS[dir]![1];
      if (!inGrid(nx, ny) || visited.has(ny * cols + nx)) break;
      x = nx; y = ny; visited.add(y * cols + x); pathCells.push({ x, y });
    }

    // 宝石：鏡でない通り道セルから
    const mirrorCells = new Set(mirrors.map((m) => m.y * cols + m.x));
    const gemCand = pathCells.filter((p, i) => i > 0 && !mirrorCells.has(p.y * cols + p.x));
    if (gemCand.length < st.gems) continue;
    shuffle(gemCand, rng);
    const gems = gemCand.slice(0, st.gems);

    // 爆弾：通り道の外
    const bombCand: Pt[] = [];
    for (let cy = 0; cy < rows; cy++) for (let cx = 0; cx < cols; cx++) if (!visited.has(cy * cols + cx)) bombCand.push({ x: cx, y: cy });
    shuffle(bombCand, rng);
    const bombs = bombCand.slice(0, st.bombs);

    const level: Level = { cols, rows, emit: { x: pathCells[0]!.x, y: pathCells[0]!.y, dir: (edge + 0) as number }, mirrors, gems, bombs };
    // emit.dir は最初の向き。上のループで dir を書き換えたので、発射向きを復元
    level.emit.dir = edge === 0 ? 0 : edge === 1 ? 1 : edge === 2 ? 2 : 3;

    // スクランブル：解の向きから 1本以上を反転させ、初期状態が未解になるようにする
    const solOrient = mirrors.map((m) => m.sol);
    let init = solOrient.slice();
    for (let tries = 0; tries < 12; tries++) {
      init = solOrient.slice();
      const flipCount = 1 + Math.floor(rng() * mirrors.length);
      const idx = shuffle(mirrors.map((_, i) => i), rng).slice(0, flipCount);
      for (const i of idx) init[i] = opp(solOrient[i]!);
      if (!solved(level, init)) break;
    }
    if (solved(level, init)) {
      // まだ解けてしまう＝全反転で確実に崩す（それでも解なら諦めて次のattempt）
      init = solOrient.map((o) => opp(o));
      if (solved(level, init)) continue;
    }
    for (let i = 0; i < mirrors.length; i++) mirrors[i]!.init = init[i]!;

    // 念のため：解（solOrient）が本当に解けているか確認
    if (!solved(level, solOrient)) continue;
    return level;
  }
  // フォールバック（まず来ない）: 最小の1曲がり盤
  const x0 = 0, y0 = 0;
  const m: Mirror = { x: 1, y: 0, sol: '\\', init: '/' };
  return { cols, rows, emit: { x: x0, y: y0, dir: 0 }, mirrors: [m], gems: [{ x: 1, y: 1 }], bombs: [] };
}
