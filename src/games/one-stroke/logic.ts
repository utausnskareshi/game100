// =============================================================
// ひとふでがき（No.36）の盤面生成（DOM非依存・純ロジック）
// =============================================================
// - 「岩以外の全マスを一度ずつ通る道」を先に作ってから盤にする＝必ず解ける。
// - 生成は 蛇行路 → backbite 変形（端点の反転）を固定回数くり返す。
//   反復は固定回数＝打ち切り上限あり（配置系ループに無限ループを作らない約束）。
// - 乱数は注入（ctx.random）。「今日のゲーム」では全員同じ盤になる。
// - import してよいのは game-api（types/helpers）と同一フォルダのみ（このファイルは依存なし）。

export type Rng = () => number;

export interface StrokePuzzle {
  cols: number;
  rows: number;
  /** cols*rows。true=岩（通れない） */
  blocked: boolean[];
  /** 岩以外の全マスを一度ずつ通る道（解の実在証明。プレイヤーは別解でもクリアできる） */
  path: number[];
}

/** 蛇行（ジグザグ）でグリッド全マスを通る初期路 */
function serpentine(cols: number, rows: number): number[] {
  const p: number[] = [];
  for (let y = 0; y < rows; y++) {
    if (y % 2 === 0) for (let x = 0; x < cols; x++) p.push(y * cols + x);
    else for (let x = cols - 1; x >= 0; x--) p.push(y * cols + x);
  }
  return p;
}

/** グリッド上の上下左右の隣接マス */
export function neighborsOf(i: number, cols: number, rows: number): number[] {
  const x = i % cols;
  const y = (i / cols) | 0;
  const out: number[] = [];
  if (x > 0) out.push(i - 1);
  if (x < cols - 1) out.push(i + 1);
  if (y > 0) out.push(i - cols);
  if (y < rows - 1) out.push(i + cols);
  return out;
}

/** 2マスが上下左右に隣接しているか */
export function isAdjacent(a: number, b: number, cols: number): boolean {
  const ax = a % cols;
  const ay = (a / cols) | 0;
  const bx = b % cols;
  const by = (b / cols) | 0;
  return Math.abs(ax - bx) + Math.abs(ay - by) === 1;
}

/**
 * backbite 法で「全マスを通る道」をランダム化する。
 * 端点 e の隣接マス n（路上で e のすぐ隣以外）を選び、n から端点側の区間を反転する
 * —— 道は全マスを通ったまま形だけ変わる。反復は n*12 回固定（必ず終わる）。
 */
export function generatePath(rng: Rng, cols: number, rows: number): number[] {
  const path = serpentine(cols, rows);
  const n = path.length;
  const pos = new Array<number>(n); // マス番号 → 路上の位置
  for (let i = 0; i < n; i++) pos[path[i]!] = i;

  const reverse = (a: number, b: number): void => {
    while (a < b) {
      const va = path[a]!;
      const vb = path[b]!;
      path[a] = vb;
      path[b] = va;
      pos[vb] = a;
      pos[va] = b;
      a++;
      b--;
    }
  };

  const iters = n * 12;
  for (let k = 0; k < iters; k++) {
    const fromTail = rng() < 0.5;
    const end = fromTail ? path[n - 1]! : path[0]!;
    const nbs = neighborsOf(end, cols, rows);
    // 路上で端点のすぐ隣（= 反転しても変化が小さい）は除外
    const cand = nbs.filter((c) => (fromTail ? pos[c]! !== n - 2 : pos[c]! !== 1));
    if (cand.length === 0) continue;
    const pick = cand[Math.min(cand.length - 1, Math.floor(rng() * cand.length))]!;
    const pi = pos[pick]!;
    if (fromTail) reverse(pi + 1, n - 1);
    else reverse(0, pi - 1);
  }
  return path;
}

/**
 * パズルを生成する。blocks 個の岩は「生成した道の末尾 blocks マス」＝
 * 残りの道は岩以外の全マスをちょうど一度ずつ通る（＝解が必ず存在する）。
 */
export function generatePuzzle(rng: Rng, cols: number, rows: number, blocks: number): StrokePuzzle {
  const full = generatePath(rng, cols, rows);
  const open = full.length - blocks;
  const blocked = new Array<boolean>(full.length).fill(false);
  for (let i = open; i < full.length; i++) blocked[full[i]!] = true;
  return { cols, rows, blocked, path: full.slice(0, open) };
}
