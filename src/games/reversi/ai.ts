// リバーシのCPU思考。3段階のつよさ。乱数は必ず引数 rng（= ctx.random）を使う（Math.random 禁止）。
import { applyMove, countDiscs, hasMove, legalMoves, opponent, BLACK, type Color } from './engine';

export type Level = 'easy' | 'normal' | 'hard';

// 位置の価値（角=最強、角のとなり=危険）。リバーシの定番の重みテーブル。
const WEIGHTS: number[] = [
  120, -20, 20, 5, 5, 20, -20, 120,
  -20, -40, -5, -5, -5, -5, -40, -20,
  20, -5, 15, 3, 3, 15, -5, 20,
  5, -5, 3, 3, 3, 3, -5, 5,
  5, -5, 3, 3, 3, 3, -5, 5,
  20, -5, 15, 3, 3, 15, -5, 20,
  -20, -40, -5, -5, -5, -5, -40, -20,
  120, -20, 20, 5, 5, 20, -20, 120,
];

// 終局（両者打てない）到達時、最終石差をこの倍率で評価＝「実際の勝ち」を最優先させる
const DISC_WEIGHT = 10000;

/** color 視点の盤面評価（位置価値＋機動力） */
function evaluate(board: Int8Array, color: Color): number {
  const opp = opponent(color);
  let pos = 0;
  for (let i = 0; i < 64; i++) {
    const v = board[i];
    const w = WEIGHTS[i] ?? 0;
    if (v === color) pos += w;
    else if (v === opp) pos -= w;
  }
  const myMob = legalMoves(board, color).length;
  const oppMob = legalMoves(board, opp).length;
  const mob = myMob + oppMob > 0 ? (myMob - oppMob) / (myMob + oppMob) : 0;
  return pos + Math.round(mob * 30);
}

/** αβ法（ネガマックス）。endgame のときは深さ無制限で終局まで読み、石差を最大化する */
function negamax(
  board: Int8Array,
  color: Color,
  depth: number,
  alpha: number,
  beta: number,
  endgame: boolean,
): number {
  const moves = legalMoves(board, color);
  if (moves.length === 0) {
    if (!hasMove(board, opponent(color))) {
      // 両者打てない＝終局。最終石差（color 視点）
      const { black, white } = countDiscs(board);
      const diff = color === BLACK ? black - white : white - black;
      return diff * DISC_WEIGHT;
    }
    // パス（手番だけ相手へ）
    return -negamax(board, opponent(color), endgame ? depth : depth - 1, -beta, -alpha, endgame);
  }
  if (!endgame && depth <= 0) return evaluate(board, color);

  moves.sort((a, b) => (WEIGHTS[b] ?? 0) - (WEIGHTS[a] ?? 0)); // 良さそうな手から見て枝刈り効率UP
  let best = -Infinity;
  for (const m of moves) {
    const res = applyMove(board, m, color);
    if (!res) continue;
    const s = -negamax(res.board, opponent(color), endgame ? depth : depth - 1, -beta, -alpha, endgame);
    if (s > best) best = s;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}

/** 手を選ぶ。合法手がなければ null（＝パス） */
export function chooseMove(board: Int8Array, color: Color, level: Level, rng: () => number): number | null {
  const moves = legalMoves(board, color);
  if (moves.length === 0) return null;
  if (moves.length === 1) return moves[0] ?? null;

  if (level === 'easy') {
    // 合法手からランダム（角を避けたりしない＝人が勝ちやすい）
    const idx = Math.floor(rng() * moves.length);
    return moves[idx] ?? moves[0] ?? null;
  }

  if (level === 'normal') {
    // 1手先の盤面評価が最大の手（同点は乱数でばらつかせる）
    let best = moves[0] ?? null;
    let bestScore = -Infinity;
    for (const m of moves) {
      const res = applyMove(board, m, color);
      if (!res) continue;
      const s = evaluate(res.board, color);
      if (s > bestScore || (s === bestScore && rng() < 0.4)) {
        bestScore = s;
        best = m;
      }
    }
    return best;
  }

  // hard: αβ探索。終盤（空き≤10）は完全読み
  const empties = countDiscs(board).empty;
  const endgame = empties <= 10;
  const searchDepth = 4;
  const ordered = [...moves].sort((a, b) => (WEIGHTS[b] ?? 0) - (WEIGHTS[a] ?? 0));
  let best = ordered[0] ?? null;
  let alpha = -Infinity;
  for (const m of ordered) {
    const res = applyMove(board, m, color);
    if (!res) continue;
    const s = -negamax(res.board, opponent(color), endgame ? empties : searchDepth - 1, -Infinity, -alpha, endgame);
    if (s > alpha) {
      alpha = s;
      best = m;
    }
  }
  return best;
}
