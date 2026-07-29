// =============================================================
// かべの あな（No.119・かくれゲーム）: 純ロジック（形・回転・かべ）
// =============================================================
// - せまってくる かべには「じぶんと 同じ形の あな」が あいている。
//   左右に動かして 位置を、タップで まわして 向きを 合わせて くぐりぬける。
// - #19 よけよけレースは「よける」。こちらは **形を 合わせる**。
// - 形は マスの集まりで あらわし、回転は 90度ずつの 変換。判定は 集合の 一致。
// - DOM 非依存・rng 注入＝決定論。
// =============================================================

export const COLS = 7;
export const CELL = 44;
/** 盤の 左はし */
export const GRID_X = 26;
/** じぶんの 上のはしの 高さ（かべの おびの 上が ここに 来たら 判定） */
export const PLAYER_Y = 430;

/** マス（列, 行） */
export type Cell = [number, number];

/** 形（左上を 0,0 に そろえた マスの集まり） */
export const SHAPES: Cell[][] = [
  // ぼう2
  [
    [0, 0],
    [1, 0],
  ],
  // ぼう3
  [
    [0, 0],
    [1, 0],
    [2, 0],
  ],
  // かぎ形
  [
    [0, 0],
    [1, 0],
    [1, 1],
  ],
];

export const SHAPE_NAMES = ['ぼう2', 'ぼう3', 'かぎ形'];

/** 左上を 0,0 に そろえる */
export function normalize(cells: Cell[]): Cell[] {
  const mc = Math.min(...cells.map((c) => c[0]));
  const mr = Math.min(...cells.map((c) => c[1]));
  return cells.map(([c, r]) => [c - mc, r - mr] as Cell).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
}

/** 90度 右まわり */
export function rotate(cells: Cell[]): Cell[] {
  return normalize(cells.map(([c, r]) => [-r, c] as Cell));
}

/** その形の ちがう向き（同じ形に なるものは まとめる） */
export function rotations(shape: Cell[]): Cell[][] {
  const out: Cell[][] = [];
  let cur = normalize(shape);
  for (let i = 0; i < 4; i++) {
    const key = JSON.stringify(cur);
    if (!out.some((o) => JSON.stringify(o) === key)) out.push(cur);
    cur = rotate(cur);
  }
  return out;
}

export function widthOf(cells: Cell[]): number {
  return Math.max(...cells.map((c) => c[0])) + 1;
}
export function heightOf(cells: Cell[]): number {
  return Math.max(...cells.map((c) => c[1])) + 1;
}

export function sameCells(a: Cell[], b: Cell[]): boolean {
  if (a.length !== b.length) return false;
  const ka = JSON.stringify(normalize(a));
  const kb = JSON.stringify(normalize(b));
  return ka === kb;
}

export interface Wave {
  /** SHAPES の ばんごう */
  shape: number;
  /** その形の 何番目の 向きか */
  rot: number;
  /** あなの 左はしの 列 */
  col: number;
  /** 落ちてくる はやさ（px/秒） */
  speed: number;
}

/** かべの数 */
export const WAVES = 12;
/** ライフ */
export const LIVES = 3;

/** i 番目の かべの はやさ */
export function speedOf(i: number): number {
  return 90 + i * 6;
}

/**
 * かべの ならびを作る。
 * - 同じ「形・向き・列」が 続かない（続くと 何も しなくて 通れてしまう）
 * - あなは かならず 盤の中に おさまる
 */
export function makeWaves(rng: () => number): Wave[] {
  const out: Wave[] = [];
  for (let i = 0; i < WAVES; i++) {
    for (let t = 0; t < 100; t++) {
      const shape = Math.floor(rng() * SHAPES.length);
      const rots = rotations(SHAPES[shape]!);
      const rot = Math.floor(rng() * rots.length);
      const w = widthOf(rots[rot]!);
      const col = Math.floor(rng() * (COLS - w + 1));
      const prev = out[i - 1];
      if (prev && prev.shape === shape && prev.rot === rot && prev.col === col) continue;
      out.push({ shape, rot, col, speed: speedOf(i) });
      break;
    }
    if (out.length <= i) out.push({ shape: 0, rot: 0, col: i % (COLS - 1), speed: speedOf(i) });
  }
  return out;
}

/** その かべの あなの マス（盤の 列・おびの中の 行） */
export function holeCells(w: Wave): Cell[] {
  const cells = rotations(SHAPES[w.shape]!)[w.rot]!;
  return cells.map(([c, r]) => [c + w.col, r] as Cell);
}

/** じぶんの マス */
export function playerCells(shape: number, rot: number, col: number): Cell[] {
  const rots = rotations(SHAPES[shape]!);
  const cells = rots[rot % rots.length]!;
  return cells.map(([c, r]) => [c + col, r] as Cell);
}

/** くぐりぬけられるか（形・向き・位置が ぴったり 合っているか） */
export function passes(w: Wave, shape: number, rot: number, col: number): boolean {
  if (shape !== w.shape) return false;
  const a = playerCells(shape, rot, col);
  const b = holeCells(w);
  if (a.length !== b.length) return false;
  const ka = a
    .slice()
    .sort((p, q) => p[1] - q[1] || p[0] - q[0])
    .map((p) => p.join(','))
    .join(' ');
  const kb = b
    .slice()
    .sort((p, q) => p[1] - q[1] || p[0] - q[0])
    .map((p) => p.join(','))
    .join(' ');
  return ka === kb;
}

/** じぶんが 盤から はみ出さない いちばん右の列 */
export function maxCol(shape: number, rot: number): number {
  const rots = rotations(SHAPES[shape]!);
  return COLS - widthOf(rots[rot % rots.length]!);
}

/** 1まい くぐった ときの点 */
export function wavePoints(i: number): number {
  return 50 + i * 6;
}

/** 一度も ぶつからなかった ときの ボーナス */
export const CLEAN_BONUS = 150;

/** 満点 */
export function maxScore(): number {
  let s = CLEAN_BONUS;
  for (let i = 0; i < WAVES; i++) s += wavePoints(i);
  return s;
}
