// =============================================================
// つなげてパイプ（No.95）: 盤面生成（構成的に可解＋全マス被覆を保証）
// =============================================================
// 生成方針（可解性の保証）:
//  1) グリッド全マスを1回ずつ通る「ランダムなハミルトン路」を作る（乱択DFS＋バックトラック。
//     失敗時はスネーク路にフォールバック＝必ず存在）。
//  2) その1本の路を、長さ2以上の連続セグメントに切る。各セグメント＝1色のペア。
//  3) 同じ1本の非交差路の互いに素な部分列なので、セグメント同士は交差せず、
//     合わせて全マスを覆う ⇒ 「全ペア接続＋全マス被覆」の解が必ず存在する。
//     → セグメント自体が解（solution）なのでテストで直接検証できる。
// すべて rng 注入＝決定論（日替わり共通）。
// =============================================================

/** 色（ペア）の最大数。game.ts の COLORS / SOFT パレットの色数と必ず一致させること */
export const MAX_COLORS = 8;

export interface Stage {
  cols: number;
  rows: number;
  colors: number;
}

/** 5ステージ（だんだん大きく・色が増える） */
export const STAGES: Stage[] = [
  { cols: 4, rows: 5, colors: 4 },
  { cols: 5, rows: 5, colors: 5 },
  { cols: 5, rows: 6, colors: 6 },
  { cols: 6, rows: 6, colors: 6 },
  { cols: 6, rows: 7, colors: 7 },
];

export interface Board {
  cols: number;
  rows: number;
  colors: number;
  /** color -> 端点2つ [a, b]（セルindex） */
  dots: [number, number][];
  /** color -> 解の経路（セルindex列。先頭=a・末尾=b） */
  solution: number[][];
}

export function neighborsOf(cell: number, cols: number, rows: number): number[] {
  const x = cell % cols;
  const y = (cell / cols) | 0;
  const r: number[] = [];
  if (x > 0) r.push(cell - 1);
  if (x < cols - 1) r.push(cell + 1);
  if (y > 0) r.push(cell - cols);
  if (y < rows - 1) r.push(cell + cols);
  return r;
}

export function areAdjacent(a: number, b: number, cols: number, rows: number): boolean {
  return neighborsOf(a, cols, rows).includes(b);
}

function shuffle<T>(arr: T[], rng: () => number): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = t;
  }
  return arr;
}

/** 乱択ハミルトン路（全マス1回ずつ）。見つからなければ null（呼び出し側でスネークへ） */
function hamiltonian(rng: () => number, cols: number, rows: number): number[] | null {
  const N = cols * rows;
  const CAP = 400000;
  for (let attempt = 0; attempt < 60; attempt++) {
    const visited = new Uint8Array(N);
    const path: number[] = [];
    let steps = 0;
    let ok = false;
    const start = Math.floor(rng() * N);
    const dfs = (cell: number): void => {
      if (ok) return;
      visited[cell] = 1;
      path.push(cell);
      if (path.length === N) {
        ok = true;
        return;
      }
      steps++;
      if (steps > CAP) return;
      for (const n of shuffle(neighborsOf(cell, cols, rows), rng)) {
        if (!visited[n]) {
          dfs(n);
          if (ok) return;
        }
      }
      visited[cell] = 0;
      path.pop();
    };
    dfs(start);
    if (ok) return path;
  }
  return null;
}

/** スネーク路（必ず全マスを通る・フォールバック） */
function snake(rng: () => number, cols: number, rows: number): number[] {
  const flip = rng() < 0.5;
  const path: number[] = [];
  if (!flip) {
    for (let y = 0; y < rows; y++) {
      if (y % 2 === 0) for (let x = 0; x < cols; x++) path.push(y * cols + x);
      else for (let x = cols - 1; x >= 0; x--) path.push(y * cols + x);
    }
  } else {
    for (let x = 0; x < cols; x++) {
      if (x % 2 === 0) for (let y = 0; y < rows; y++) path.push(y * cols + x);
      else for (let y = rows - 1; y >= 0; y--) path.push(y * cols + x);
    }
  }
  return path;
}

/** ハミルトン路を長さ2以上のセグメントに切る（色ごとの解経路になる） */
function cutSegments(path: number[], rng: () => number, desiredColors: number): number[][] {
  const N = path.length;
  const target = Math.max(2, Math.round(N / desiredColors));
  const segs: number[][] = [];
  let i = 0;
  while (i < N) {
    let len = target + (Math.floor(rng() * 3) - 1); // ±1 のゆらぎ
    if (len < 2) len = 2;
    const remainAfter = N - (i + len);
    if (remainAfter > 0 && remainAfter < 2) len = N - i; // 長さ1の余りを残さない
    len = Math.min(len, N - i);
    segs.push(path.slice(i, i + len));
    i += len;
  }
  // 念のため：末尾が長さ1なら前へマージ
  if (segs.length > 1 && segs[segs.length - 1]!.length < 2) {
    const last = segs.pop()!;
    segs[segs.length - 1] = segs[segs.length - 1]!.concat(last);
  }
  // 色数がパレット上限を超えないよう、余分な末尾セグメントを直前へ結合する。
  // （ハミルトン路の連続スライスなので隣接＝結合しても1本の経路として妥当。全マス被覆・長さ≥2 は保たれる）
  // 例: 6×7(42マス)・desiredColors=7 で全て最小長を引くと 8×5+2=42 の9本になり得るため必須。
  while (segs.length > MAX_COLORS) {
    const last = segs.pop()!;
    segs[segs.length - 1] = segs[segs.length - 1]!.concat(last);
  }
  return segs;
}

/** ステージ index の盤面を生成（構成的に可解＋全マス被覆） */
export function makeBoard(rng: () => number, stageIndex: number): Board {
  const st = STAGES[Math.min(stageIndex, STAGES.length - 1)]!;
  const { cols, rows } = st;
  const path = hamiltonian(rng, cols, rows) ?? snake(rng, cols, rows);
  const segs = cutSegments(path, rng, st.colors);
  const dots = segs.map((s) => [s[0]!, s[s.length - 1]!] as [number, number]);
  return { cols, rows, colors: segs.length, dots, solution: segs };
}
