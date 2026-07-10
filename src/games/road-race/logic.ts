// =============================================================
// よけよけレース（No.19）のロジック（DOM非依存・乱数注入）
// =============================================================
// - 縦スクロールのドッジレース。前から来る車/障害物をよけながら距離をのばす。
//   スポーン内容（車・コーン・⭐・🚀）とスピード/間隔カーブ、当たり判定を純関数で提供。
// - スポーンは注入 rng 由来＝「今日のゲーム」では全員同じ交通パターン。
// - import してよいのは game-api（types/helpers）と同一フォルダのみ（このファイルは依存なし）。

export type Diff = 'easy' | 'normal' | 'hard';
export type EntKind = 'car' | 'cone' | 'star' | 'boost';

export interface Spawn {
  kind: EntKind;
  /** 道の左右方向の位置 0〜1 */
  xFrac: number;
}

interface Band {
  baseSpeed: number; // 初速(px/s)
  interval: number; // スポーン間隔(ms)
  obstacle: number; // 障害物(車/コーン)が出る確率（残りがアイテム）
}

const BANDS: Record<Diff, Band> = {
  easy: { baseSpeed: 175, interval: 900, obstacle: 0.72 },
  normal: { baseSpeed: 225, interval: 760, obstacle: 0.8 },
  hard: { baseSpeed: 285, interval: 640, obstacle: 0.86 },
};

/** スクロール速度（＝距離の増加速度・障害物の落下速度）。levelで加速 */
export function speedOf(diff: Diff, level: number): number {
  return BANDS[diff].baseSpeed + level * 34;
}

/** スポーン間隔(ms)。levelで短く（密度UP）。下限あり */
export function intervalOf(diff: Diff, level: number): number {
  return Math.max(300, BANDS[diff].interval - level * 45);
}

/** 1体スポーンする（種類と横位置）。rng 注入＝決定論 */
export function rollSpawn(rng: () => number, diff: Diff): Spawn {
  const b = BANDS[diff];
  let kind: EntKind;
  if (rng() < b.obstacle) {
    kind = rng() < 0.68 ? 'car' : 'cone';
  } else {
    kind = rng() < 0.16 ? 'boost' : 'star';
  }
  return { kind, xFrac: rng() };
}

/** 矩形どうしの重なり判定 */
export function overlap(
  ax: number,
  ay: number,
  aw: number,
  ah: number,
  bx: number,
  by: number,
  bw: number,
  bh: number,
): boolean {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

/** スコア＝距離＋すれちがい×10＋⭐×50（playtest調整前提の仮式。overtakes=すれちがった車の数） */
export function scoreOf(dist: number, overtakes: number, stars: number): number {
  return Math.floor(dist) + overtakes * 10 + stars * 50;
}
