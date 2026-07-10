// =============================================================
// 五目並べ（No.11）の純ロジック（DOM非依存・乱数注入）
// =============================================================
// - 自由五目（禁じ手なし）。縦・横・斜めのどれかで同じ色が5つ連続で勝ち。
// - AI は「脅威ヒューリスティック」: 各空きマスに自分/相手が置いたときの連の価値を数え、
//   自分の攻め＋相手の攻め（＝防ぎ）が最大の手を選ぶ。完全読みではない（casual 想定）。
// - import してよいのは game-api（types/helpers）と同一フォルダのみ（このファイルは依存なし）。

export type Cell = 0 | 1 | 2; // 0=空 / 1=黒(先手) / 2=白(後手)
export type Level = 'weak' | 'normal' | 'strong';

const DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [0, 1],
  [1, 1],
  [1, -1],
];

const WIN = 100_000;

/** idx に player を置いたとき、その手を通る最長連が5以上か（勝ち判定） */
export function isWin(board: Uint8Array, size: number, idx: number, player: number): boolean {
  const r = (idx / size) | 0;
  const c = idx % size;
  for (const [dr, dc] of DIRS) {
    let count = 1;
    for (let s = 1; ; s++) {
      const rr = r + dr * s;
      const cc = c + dc * s;
      if (rr < 0 || rr >= size || cc < 0 || cc >= size || board[rr * size + cc] !== player) break;
      count++;
    }
    for (let s = 1; ; s++) {
      const rr = r - dr * s;
      const cc = c - dc * s;
      if (rr < 0 || rr >= size || cc < 0 || cc >= size || board[rr * size + cc] !== player) break;
      count++;
    }
    if (count >= 5) return true;
  }
  return false;
}

/** 勝った5連（以上）のマス一覧を返す（ハイライト用）。なければ空配列 */
export function winLine(board: Uint8Array, size: number, idx: number, player: number): number[] {
  const r = (idx / size) | 0;
  const c = idx % size;
  for (const [dr, dc] of DIRS) {
    const line = [idx];
    for (let s = 1; ; s++) {
      const rr = r + dr * s;
      const cc = c + dc * s;
      if (rr < 0 || rr >= size || cc < 0 || cc >= size || board[rr * size + cc] !== player) break;
      line.push(rr * size + cc);
    }
    for (let s = 1; ; s++) {
      const rr = r - dr * s;
      const cc = c - dc * s;
      if (rr < 0 || rr >= size || cc < 0 || cc >= size || board[rr * size + cc] !== player) break;
      line.unshift(rr * size + cc);
    }
    if (line.length >= 5) return line;
  }
  return [];
}

function patternValue(len: number, openEnds: number): number {
  if (len >= 5) return WIN;
  if (len === 4) return openEnds === 2 ? 10_000 : openEnds === 1 ? 1_200 : 0;
  if (len === 3) return openEnds === 2 ? 1_000 : openEnds === 1 ? 120 : 0;
  if (len === 2) return openEnds === 2 ? 100 : openEnds === 1 ? 12 : 0;
  if (len === 1) return openEnds === 2 ? 4 : openEnds === 1 ? 1 : 0;
  return 0;
}

/** idx に player を置いたと仮定したときの、その手の価値（4方向の連パターン合計） */
export function placeScore(board: Uint8Array, size: number, idx: number, player: number): number {
  const r = (idx / size) | 0;
  const c = idx % size;
  let total = 0;
  for (const [dr, dc] of DIRS) {
    let len = 1;
    let openF = false;
    let openB = false;
    let s = 1;
    for (; ; s++) {
      const rr = r + dr * s;
      const cc = c + dc * s;
      if (rr < 0 || rr >= size || cc < 0 || cc >= size) break;
      const v = board[rr * size + cc];
      if (v === player) len++;
      else {
        if (v === 0) openF = true;
        break;
      }
    }
    for (s = 1; ; s++) {
      const rr = r - dr * s;
      const cc = c - dc * s;
      if (rr < 0 || rr >= size || cc < 0 || cc >= size) break;
      const v = board[rr * size + cc];
      if (v === player) len++;
      else {
        if (v === 0) openB = true;
        break;
      }
    }
    total += patternValue(len, (openF ? 1 : 0) + (openB ? 1 : 0));
  }
  return total;
}

/** 石の近く（距離2以内）の空きマス。盤が空なら中央だけを返す */
function candidates(board: Uint8Array, size: number): number[] {
  const n = size * size;
  let hasStone = false;
  for (let i = 0; i < n; i++)
    if (board[i]) {
      hasStone = true;
      break;
    }
  if (!hasStone) return [((size / 2) | 0) * size + ((size / 2) | 0)];
  const set = new Set<number>();
  for (let i = 0; i < n; i++) {
    if (board[i] === 0) continue;
    const r = (i / size) | 0;
    const c = i % size;
    for (let dr = -2; dr <= 2; dr++) {
      for (let dc = -2; dc <= 2; dc++) {
        const rr = r + dr;
        const cc = c + dc;
        if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue;
        const j = rr * size + cc;
        if (board[j] === 0) set.add(j);
      }
    }
  }
  return [...set];
}

/**
 * AI の着手を選ぶ。me=自分の色 / opp=相手の色。
 * ①自分が5を作れるなら勝つ ②相手が5/オープン4を作れるなら防ぐ
 * ③それ以外は「攻め＋防ぎ×重み」が最大の手（難易度でランダム量と防ぎ重みが変わる）。
 */
export function chooseMove(
  board: Uint8Array,
  size: number,
  me: number,
  opp: number,
  level: Level,
  rng: () => number,
): number {
  const cands = candidates(board, size);
  if (cands.length === 1) return cands[0] ?? 0;

  const scored = cands.map((i) => ({
    i,
    off: placeScore(board, size, i, me),
    def: placeScore(board, size, i, opp),
  }));

  // ① 自分が勝てる手
  const winMove = scored.find((s) => s.off >= WIN);
  if (winMove) return winMove.i;

  // ② 相手の即勝ち（5）は必ず防ぐ
  const mustBlock = scored.filter((s) => s.def >= WIN);
  if (mustBlock.length) return maxBy(mustBlock, (s) => s.def).i;

  // ②' 相手のオープン4も防ぐ（よわい以外）
  if (level !== 'weak') {
    const block4 = scored.filter((s) => s.def >= 10_000);
    if (block4.length) return maxBy(block4, (s) => s.def).i;
  }

  const defW = level === 'weak' ? 0.4 : level === 'normal' ? 0.9 : 1.05;
  for (const s of scored) (s as { total?: number }).total = s.off + s.def * defW;
  const sorted = [...scored].sort((a, b) => scoreOf(b) - scoreOf(a));

  // 難易度でばらつき: よわい=上位から広くランダム / ふつう=上位2つ / つよい=最善（同点は乱数）
  const topN = level === 'weak' ? Math.min(5, sorted.length) : level === 'normal' ? Math.min(2, sorted.length) : 1;
  if (topN <= 1) {
    // 最善が複数同点なら乱数で1つ
    const best = scoreOf(sorted[0] ?? scored[0]!);
    const ties = sorted.filter((s) => scoreOf(s) === best);
    return (ties[Math.floor(rng() * ties.length)] ?? sorted[0] ?? scored[0]!).i;
  }
  return (sorted[Math.floor(rng() * topN)] ?? sorted[0] ?? scored[0]!).i;
}

function scoreOf(s: { off: number; def: number } & { total?: number }): number {
  return s.total ?? s.off;
}

function maxBy<T>(arr: T[], f: (x: T) => number): T {
  let best = arr[0]!;
  let bv = f(best);
  for (let k = 1; k < arr.length; k++) {
    const v = f(arr[k]!);
    if (v > bv) {
      bv = v;
      best = arr[k]!;
    }
  }
  return best;
}
