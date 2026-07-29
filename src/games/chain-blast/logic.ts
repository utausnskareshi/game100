// =============================================================
// れんさ ばくはつ（No.121・かくれゲーム）: 純ロジック（連鎖の計算・出題）
// =============================================================
// - 玉には「力（1〜3）」がある。タップした玉が はれつすると、上下左右に
//   力のマスぶん 火が とんで、そこにある玉も はれつする＝連鎖。
// - 操作は **1か所 タップするだけ**。そのかわり どこを えらぶかで 結果が 何倍も 変わる。
// - 盤は「いちばん長い連鎖（par）」を全マス試算して作る。
//   ・par が じゅうぶん長い ・par を出せるマスは 3か所いか ・でたらめに押すと 半分いかに しかならない
//   ＝「よく見て 1か所を えらぶ」ことに 意味がある盤 しか出さない。
// - DOM 非依存・rng 注入＝決定論。
// =============================================================

export const COLS = 6;

export interface BoardSpec {
  rows: number;
  /** 玉の数 */
  orbs: number;
}

// ※ 玉を つめこみすぎると「どこを 押しても ぜんぶ つながる」＝えらぶ意味が なくなる。
//   マスの 35〜38% くらいが ちょうど（テストで へいきん連鎖が par の 6割いかに 収まることを確認）。
export const BOARDS: BoardSpec[] = [
  { rows: 5, orbs: 11 },
  { rows: 6, orbs: 13 },
  { rows: 7, orbs: 15 },
  { rows: 7, orbs: 16 },
  { rows: 8, orbs: 17 },
  { rows: 8, orbs: 18 },
];

export const ROUNDS = BOARDS.length;

/** 力の さいだい（＝火が とぶ マスの数） */
export const MAX_POWER = 3;

export interface Board {
  rows: number;
  /** そのマスの 力（0 は 玉なし） */
  power: number[];
  /** いちばん長い連鎖の 数 */
  par: number;
  /** par を出せる マスの ばんごう */
  best: number[];
}

const idx = (c: number, r: number): number => r * COLS + c;

/** その玉から はじまる連鎖を「波」ごとに 返す（波0＝最初の玉） */
export function chainWaves(board: Board, start: number): number[][] {
  if ((board.power[start] ?? 0) <= 0) return [];
  const fired = new Set<number>([start]);
  const waves: number[][] = [[start]];
  let cur = [start];
  while (cur.length > 0) {
    const next: number[] = [];
    for (const at of cur) {
      const p = board.power[at]!;
      const c0 = at % COLS;
      const r0 = Math.floor(at / COLS);
      const dirs: [number, number][] = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ];
      for (const [dc, dr] of dirs) {
        for (let k = 1; k <= p; k++) {
          const c = c0 + dc * k;
          const r = r0 + dr * k;
          if (c < 0 || r < 0 || c >= COLS || r >= board.rows) break;
          const j = idx(c, r);
          if ((board.power[j] ?? 0) > 0 && !fired.has(j)) {
            fired.add(j);
            next.push(j);
          }
        }
      }
    }
    if (next.length > 0) waves.push(next);
    cur = next;
  }
  return waves;
}

/** その玉から はじまる連鎖の 数 */
export function chainSize(board: Board, start: number): number {
  return chainWaves(board, start).reduce((a, w) => a + w.length, 0);
}

/** 玉の数 */
export function orbCount(board: Board): number {
  return board.power.filter((p) => p > 0).length;
}

function analyze(rows: number, power: number[]): { par: number; best: number[]; avg: number } {
  const tmp: Board = { rows, power, par: 0, best: [] };
  let par = 0;
  const sizes: number[] = [];
  for (let i = 0; i < power.length; i++) {
    if ((power[i] ?? 0) <= 0) continue;
    const n = chainSize(tmp, i);
    sizes.push(n);
    if (n > par) par = n;
  }
  const best: number[] = [];
  for (let i = 0; i < power.length; i++) {
    if ((power[i] ?? 0) <= 0) continue;
    if (chainSize(tmp, i) === par) best.push(i);
  }
  const avg = sizes.length > 0 ? sizes.reduce((a, b) => a + b, 0) / sizes.length : 0;
  return { par, best, avg };
}

/**
 * 盤を作る。「えらぶ意味がある盤」だけを 通す。
 */
export function makeBoard(rng: () => number, spec: BoardSpec): Board {
  const n = COLS * spec.rows;
  let fallback: Board | null = null;
  let fallbackRatio = 9;
  for (let attempt = 0; attempt < 600; attempt++) {
    const power = new Array<number>(n).fill(0);
    const cells: number[] = [];
    for (let i = 0; i < n; i++) cells.push(i);
    for (let i = cells.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = cells[i]!;
      cells[i] = cells[j]!;
      cells[j] = t;
    }
    for (let k = 0; k < spec.orbs; k++) {
      // 力1を 多めに（力3ばかりだと 全部つながって えらぶ意味が なくなる）
      const t = rng();
      power[cells[k]!] = t < 0.5 ? 1 : t < 0.83 ? 2 : 3;
    }
    const { par, best, avg } = analyze(spec.rows, power);
    const board: Board = { rows: spec.rows, power, par, best };
    const okPar = par >= Math.max(5, Math.ceil(spec.orbs * 0.5));
    const okPick = best.length <= 3;
    const ratio = par > 0 ? avg / par : 1;
    // 条件を みたす中で いちばん「えらぶ意味がある（へいきんが低い）」ものを 控えに持つ
    if (okPar && okPick && (!fallback || ratio < fallbackRatio)) {
      fallback = board;
      fallbackRatio = ratio;
    }
    if (!okPar) continue; // 連鎖が 短すぎる
    if (!okPick) continue; // どこを 押しても 同じ＝えらぶ意味がない
    if (ratio > 0.6) continue; // でたらめでも 当たる盤は 出さない
    return board;
  }
  return fallback ?? { rows: spec.rows, power: new Array<number>(n).fill(0), par: 0, best: [] };
}

export function makeBoards(rng: () => number): Board[] {
  return BOARDS.map((s) => makeBoard(rng, s));
}

/** 連鎖の 数から 点を出す（par ちょうどが さいこう） */
export function roundPoints(chain: number, par: number): number {
  if (par <= 0) return 0;
  if (chain >= par) return 200;
  if (chain >= par * 0.8) return 130;
  if (chain >= par * 0.5) return 70;
  return 20;
}

/** 満点 */
export function maxScore(): number {
  return ROUNDS * 200;
}
