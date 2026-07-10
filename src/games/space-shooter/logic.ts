// =============================================================
// うちゅうシューティング（No.20）のロジック（DOM非依存・乱数注入）
// =============================================================
// - 縦シューティング。敵の種類・出現・速度・ウェーブ構成、当たり判定を純関数で提供。
//   自機の自動連射や弾の動きは game 側（ctx.now 期限方式）。
// - スポーン（敵の種類・横位置）は注入 rng 由来＝「今日のゲーム」では全員同じ。
// - import してよいのは game-api（types/helpers）と同一フォルダのみ（このファイルは依存なし）。

export type Diff = 'easy' | 'normal' | 'hard';
export type EnemyType = 'grunt' | 'tough' | 'boss';

export const ENEMY: Record<EnemyType, { hp: number; points: number; w: number; h: number; emoji: string }> = {
  grunt: { hp: 1, points: 10, w: 34, h: 30, emoji: '👾' },
  tough: { hp: 3, points: 30, w: 40, h: 34, emoji: '👽' },
  boss: { hp: 26, points: 300, w: 130, h: 74, emoji: '🛸' },
};

interface Band {
  speed: number; // 敵の落下速度(px/s)
  interval: number; // スポーン間隔(ms)
  toughP: number; // tough が出る確率
}
const BANDS: Record<Diff, Band> = {
  easy: { speed: 50, interval: 880, toughP: 0.15 },
  normal: { speed: 64, interval: 740, toughP: 0.24 },
  hard: { speed: 80, interval: 620, toughP: 0.34 },
};

export function enemySpeed(diff: Diff, wave: number): number {
  return BANDS[diff].speed + wave * 4;
}
export function spawnInterval(diff: Diff, wave: number): number {
  return Math.max(300, BANDS[diff].interval - wave * 28);
}
/** そのウェーブで出る通常敵の数 */
export function waveSize(wave: number): number {
  return 3 + wave;
}
/** ボスウェーブ（5の倍数） */
export function isBossWave(wave: number): boolean {
  return wave > 0 && wave % 5 === 0;
}
/** 敵の種類を抽選（wave/難易度が上がるほど tough が増える） */
export function rollEnemyType(rng: () => number, diff: Diff, wave: number): 'grunt' | 'tough' {
  const p = Math.min(0.6, BANDS[diff].toughP + wave * 0.02);
  return rng() < p ? 'tough' : 'grunt';
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
