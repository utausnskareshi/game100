// =============================================================
// すうじがったい（No.18）のロジック（DOM非依存・乱数注入）
// =============================================================
// - N×N の盤（number[]・row-major・0=空き）をスワイプ方向へ詰めて合体する定番ルール。
//   同じ数どうしが合体して倍に（1手で各タイル1回まで）。
// - spawn は空きマスに 2(90%)/4(10%) を置く（rng 注入＝今日のゲームは同じ引き）。
// - import してよいのは game-api（types/helpers）と同一フォルダのみ（このファイルは依存なし）。

export type Dir = 'left' | 'right' | 'up' | 'down';

export interface SlideResult {
  board: number[];
  /** この手で得た点（合体したタイルの値の合計） */
  gained: number;
  /** 盤が動いたか（動かなければ spawn しない） */
  moved: boolean;
  /** この手で合体した回数 */
  merges: number;
}

/** dir の「そろえる先の端」から内側へ向かうセル index を、各ラインぶん返す */
function lineIndices(N: number, dir: Dir): number[][] {
  const lines: number[][] = [];
  for (let a = 0; a < N; a++) {
    const line: number[] = [];
    for (let b = 0; b < N; b++) {
      if (dir === 'left') line.push(a * N + b);
      else if (dir === 'right') line.push(a * N + (N - 1 - b));
      else if (dir === 'up') line.push(b * N + a);
      else line.push((N - 1 - b) * N + a); // down
    }
    lines.push(line);
  }
  return lines;
}

/** 1ライン（先頭＝そろえる先）を詰めて合体する */
function collapse(vals: number[]): { out: number[]; gained: number; merges: number } {
  const nz = vals.filter((v) => v !== 0);
  const out: number[] = [];
  let gained = 0;
  let merges = 0;
  for (let i = 0; i < nz.length; i++) {
    const cur = nz[i]!;
    if (nz[i + 1] !== undefined && nz[i + 1] === cur) {
      const merged = cur * 2;
      out.push(merged);
      gained += merged;
      merges++;
      i++; // 2つ消費（1手1回合体）
    } else {
      out.push(cur);
    }
  }
  while (out.length < vals.length) out.push(0);
  return { out, gained, merges };
}

/** dir 方向へスライド＋合体。新しい board（コピー）と得点・合体数・動いたかを返す */
export function slide(board: number[], N: number, dir: Dir): SlideResult {
  const nb = board.slice();
  let gained = 0;
  let merges = 0;
  let moved = false;
  for (const line of lineIndices(N, dir)) {
    const vals = line.map((idx) => nb[idx] ?? 0);
    const r = collapse(vals);
    gained += r.gained;
    merges += r.merges;
    for (let k = 0; k < line.length; k++) {
      const idx = line[k]!;
      const nv = r.out[k]!;
      if (nb[idx] !== nv) moved = true;
      nb[idx] = nv;
    }
  }
  return { board: nb, gained, moved, merges };
}

/** 空きマスの index 一覧 */
export function emptyCells(board: number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < board.length; i++) if (board[i] === 0) out.push(i);
  return out;
}

/** 空きマスに新タイル（2が90%/4が10%）を置く。置けたら index、置けなければ null */
export function spawn(board: number[], rng: () => number): { board: number[]; placed: number | null } {
  const empties = emptyCells(board);
  const nb = board.slice();
  if (empties.length === 0) return { board: nb, placed: null };
  const pick = empties[Math.floor(rng() * empties.length)] ?? empties[0]!;
  nb[pick] = rng() < 0.9 ? 2 : 4;
  return { board: nb, placed: pick };
}

/** これ以上動かせるか（空きあり or 隣接同値あり） */
export function canMove(board: number[], N: number): boolean {
  for (let i = 0; i < board.length; i++) if (board[i] === 0) return true;
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const v = board[r * N + c] ?? 0;
      if (c + 1 < N && v === (board[r * N + c + 1] ?? 0)) return true;
      if (r + 1 < N && v === (board[(r + 1) * N + c] ?? 0)) return true;
    }
  }
  return false;
}

/** 盤上の最大タイル */
export function maxTile(board: number[]): number {
  let m = 0;
  for (const v of board) if (v > m) m = v;
  return m;
}

/** 空の N×N 盤 */
export function makeBoard(N: number): number[] {
  return new Array(N * N).fill(0);
}
