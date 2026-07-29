// =============================================================
// ゆきだま ころころ（No.115・かくれゲーム）: 純ロジック（雪原・大きさ）
// =============================================================
// - なぞって 雪玉を 転がす。雪のあるマスを通ると 大きくなり、
//   雪のない ところを 転がすと すこし 小さくなる（＝行きすぎても やり直せる）。
// - しっぱいも 時間制限も ない。ねらった 大きさに「ぴったり」止めるのが 遊び。
// - DOM 非依存・rng 注入＝決定論。
// =============================================================

export const COLS = 9;
export const ROWS = 10;
export const CELL = 36;
/** 雪原の 左上 */
export const FIELD_X = 18;
export const FIELD_Y = 150;

/** はじめの 大きさ と 上限 */
export const START_SIZE = 10;
export const MAX_SIZE = 46;
/** 雪マス1つで ふえる 大きさ */
export const GAIN = 1.2;
/** 雪のない ところを 1px 転がすと へる 大きさ */
export const SHRINK_PER_PX = 0.012;
/** 何ミリ秒に 1マス 雪が ふるか（＝雪切れで つまらないように） */
export const SNOW_MS = 2500;

export interface Part {
  /** ねらう 大きさ */
  target: number;
  /** ここまでなら「合っている」 */
  tol: number;
  name: string;
}

export const PARTS: Part[] = [
  { target: 34, tol: 3, name: 'したの たま' },
  { target: 24, tol: 2.5, name: 'まん中の たま' },
  { target: 16, tol: 2, name: 'あたま' },
];

export const PART_COUNT = PARTS.length;

/** はじめの 雪原（true＝雪がある）。ふちは 雪なしにして 逃げ場を作る */
export function makeField(rng: () => number): boolean[] {
  const out: boolean[] = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const edge = r === 0 || c === 0 || r === ROWS - 1 || c === COLS - 1;
      out.push(edge ? rng() < 0.35 : rng() < 0.78);
    }
  }
  return out;
}

/** マスの まん中 */
export function cellCenter(index: number): { x: number; y: number } {
  const c = index % COLS;
  const r = Math.floor(index / COLS);
  return { x: FIELD_X + c * CELL + CELL / 2, y: FIELD_Y + r * CELL + CELL / 2 };
}

/** その位置・大きさで 重なっている マスの ばんごう */
export function cellsUnder(x: number, y: number, size: number): number[] {
  const out: number[] = [];
  const c0 = Math.max(0, Math.floor((x - size - FIELD_X) / CELL));
  const c1 = Math.min(COLS - 1, Math.floor((x + size - FIELD_X) / CELL));
  const r0 = Math.max(0, Math.floor((y - size - FIELD_Y) / CELL));
  const r1 = Math.min(ROWS - 1, Math.floor((y + size - FIELD_Y) / CELL));
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const i = r * COLS + c;
      const p = cellCenter(i);
      if (Math.hypot(p.x - x, p.y - y) <= size) out.push(i);
    }
  }
  return out;
}

/** その大きさが ねらいに 合っているか */
export function fits(part: Part, size: number): boolean {
  return Math.abs(size - part.target) <= part.tol;
}

/** ぴったり ぐあいの点（ちょうどで 200点・はしで 60点） */
export function partScore(part: Part, size: number): number {
  const d = Math.abs(size - part.target);
  if (d <= 0.5) return 200;
  return Math.max(60, Math.round(200 - (d / part.tol) * 140));
}

/** ぜんぶ 作りきった ときの ボーナス */
export const DONE_BONUS = 150;

/** 満点 */
export function maxScore(): number {
  return PART_COUNT * 200 + DONE_BONUS;
}
