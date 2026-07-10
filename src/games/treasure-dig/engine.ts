// =============================================================
// ほりほりたからじま（No.6）の純ロジック（DOM非依存・乱数注入）
// =============================================================
// - 盤面は開始前にすべて確定する（「今日のゲーム」では全員同じ島になる）。
//   ばくだんは ⭐スタートマスの周囲3×3を除外して配置 → ⭐は必ず「まわり0」になり、
//   最初のひと掘りで大きくひらける（初手死の防止と日替わり決定論の両立）。
// - たから・アイテムは安全マス（⭐周囲を除く）に埋まる。
// - import してよいのは game-api（types/helpers）と同一フォルダのみ（このファイルは依存なし）。

/** マスの中身 */
export const EMPTY = 0;
export const BOMB = 1;
export const TREASURE = 2;
export const ITEM_RADAR = 3;
export const ITEM_SHOVEL = 4;
export const ITEM_SHIELD = 5;

export interface Board {
  cols: number;
  rows: number;
  /** 実際に配置されたばくだんの数 */
  bombs: number;
  /** ⭐スタートマス（必ず まわり0 の安全マス） */
  start: number;
  /** 各マスの中身（EMPTY/BOMB/TREASURE/ITEM_*） */
  content: Uint8Array;
  /** まわり8マスのばくだん数（0〜8。BOMBマス自身は0のまま） */
  counts: Uint8Array;
}

/** i のまわり8マス（盤外は除く） */
export function neighborsOf(i: number, cols: number, rows: number): number[] {
  const x = i % cols;
  const y = (i / cols) | 0;
  const out: number[] = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      out.push(ny * cols + nx);
    }
  }
  return out;
}

function shuffle(arr: number[], rng: () => number): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const a = arr[i];
    const b = arr[j];
    if (a !== undefined && b !== undefined) {
      arr[i] = b;
      arr[j] = a;
    }
  }
}

export function generateBoard(opts: {
  cols: number;
  rows: number;
  bombs: number;
  treasures: number;
  radars: number;
  shovels: number;
  shields: number;
  rng: () => number;
}): Board {
  const { cols, rows, rng } = opts;
  const n = cols * rows;
  const content = new Uint8Array(n);
  const counts = new Uint8Array(n);

  // ⭐スタートマスと、その周囲3×3（ばくだん禁止ゾーン）
  const start = Math.floor(rng() * n);
  const safeZone = new Set<number>([start, ...neighborsOf(start, cols, rows)]);

  // ばくだん配置（⭐ゾーン以外から抽選）
  const bombCandidates: number[] = [];
  for (let i = 0; i < n; i++) if (!safeZone.has(i)) bombCandidates.push(i);
  shuffle(bombCandidates, rng);
  const bombs = Math.min(opts.bombs, bombCandidates.length);
  for (let k = 0; k < bombs; k++) {
    const idx = bombCandidates[k];
    if (idx !== undefined) content[idx] = BOMB;
  }

  // 数字（まわり8マスのばくだん数）
  for (let i = 0; i < n; i++) {
    if (content[i] === BOMB) continue;
    let c = 0;
    for (const nb of neighborsOf(i, cols, rows)) if (content[nb] === BOMB) c++;
    counts[i] = c;
  }

  // たから・アイテム（安全マス。⭐ゾーンは除く＝開幕で無料入手にならないように）
  const goodies: number[] = [];
  for (let i = 0; i < n; i++) if (content[i] === EMPTY && !safeZone.has(i)) goodies.push(i);
  shuffle(goodies, rng);
  let p = 0;
  const place = (kind: number, count: number): void => {
    for (let k = 0; k < count && p < goodies.length; k++, p++) {
      const idx = goodies[p];
      if (idx !== undefined) content[idx] = kind;
    }
  };
  place(TREASURE, opts.treasures);
  place(ITEM_RADAR, opts.radars);
  place(ITEM_SHOVEL, opts.shovels);
  place(ITEM_SHIELD, opts.shields);

  return { cols, rows, bombs, start, content, counts };
}

/**
 * from を掘ったときに新しくひらくマスの一覧（from 自身を含む）。
 * 「まわり0」のマスは隣へ連鎖する（0マスの隣にばくだんは存在しないため常に安全）。
 * 旗の立っているマスはひらかない（プレイヤーの印を尊重する）。
 * revealed は変更しない（反映は呼び出し側が行う）。
 */
export function floodReveal(board: Board, revealed: Uint8Array, flags: Uint8Array, from: number): number[] {
  if (revealed[from] || flags[from]) return [];
  const out: number[] = [from];
  const seen = new Set<number>([from]);
  if ((board.counts[from] ?? 0) !== 0) return out;
  const queue = [from];
  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++] ?? 0;
    for (const nb of neighborsOf(cur, board.cols, board.rows)) {
      if (seen.has(nb) || revealed[nb] || flags[nb]) continue;
      seen.add(nb);
      out.push(nb);
      if ((board.counts[nb] ?? 0) === 0) queue.push(nb);
    }
  }
  return out;
}
