// =============================================================
// いっしゅんナンバー（No.43）のラウンド仕様と配置（DOM非依存・純ロジック）
// =============================================================
// - ラウンドが進むほど「数字が増え・見える時間が縮む」＝瞬間記憶の限界に挑む。
// - 配置は重なりなしのランダム散布。**試行は上限つき**（詰まったら間隔を段階的に
//   ゆるめる＝無限ループを作らない約束・#35の教訓）。
// - 乱数は注入（ctx.random）。同じシードなら同じ配置（日替わりで全員同じ）。
// - import してよいのは game-api（types/helpers）と同一フォルダのみ（このファイルは依存なし）。

export type Rng = () => number;

/** ぜんぶで10ラウンド */
export const ROUNDS = 10;
/** おてつきできる回数（＝ライフ） */
export const LIVES = 2;
/** まるの半径（タップ領域 60px 以上） */
export const CELL_R = 31;
/** 配置フィールド（design 360×640 のうち盤面に使う範囲） */
export const FIELD = { x: 24, y: 150, w: 312, h: 400 };
/** 早解きボーナス: max(0, 4000 - かかったms) / 100 */
export const SPEED_FROM_MS = 4000;

/** ラウンド i（0はじまり）の数字のこ数: 4,5,5,6,6,7,7,8,8,9 */
export function countAt(i: number): number {
  return Math.min(9, 4 + Math.floor((i + 1) / 2));
}

/** ラウンド i の表示時間（ms）: 1250 → 530（下限550...初期値が上限） */
export function exposureAt(i: number): number {
  return Math.max(550, 1250 - i * 80);
}

export interface Cell {
  x: number;
  y: number;
  num: number;
}

/**
 * 数字まるを重なりなしで散布する。50回ためしてダメなら最小間隔を4pxずつゆるめる
 * （合計上限400回＝必ず終わる）。
 */
export function layoutRound(rng: Rng, count: number): Cell[] {
  const cells: Cell[] = [];
  let minDist = 76;
  let tries = 0;
  while (cells.length < count && tries < 400) {
    tries++;
    if (tries % 50 === 0) minDist = Math.max(52, minDist - 4);
    const x = FIELD.x + CELL_R + rng() * (FIELD.w - CELL_R * 2);
    const y = FIELD.y + CELL_R + rng() * (FIELD.h - CELL_R * 2);
    let ok = true;
    for (const c of cells) {
      if (Math.hypot(c.x - x, c.y - y) < minDist) {
        ok = false;
        break;
      }
    }
    if (ok) cells.push({ x, y, num: cells.length + 1 });
  }
  // 万一の詰まりでも count 個は必ず返す（間隔チェックなしで埋める）
  while (cells.length < count) {
    cells.push({
      x: FIELD.x + CELL_R + rng() * (FIELD.w - CELL_R * 2),
      y: FIELD.y + CELL_R + rng() * (FIELD.h - CELL_R * 2),
      num: cells.length + 1,
    });
  }
  return cells;
}

/** ラウンドの得点（count=数字のこ数・msTaken=かくれてから全部おすまでのms） */
export function roundScore(count: number, msTaken: number): number {
  return count * 20 + Math.floor(Math.max(0, SPEED_FROM_MS - msTaken) / 100);
}
