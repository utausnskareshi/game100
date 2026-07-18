// =============================================================
// ダーツ（No.75）のボード幾何と採点（DOM非依存・純ロジック）
// =============================================================
// - 本格ダーツボード（20分割ウェッジ＋ダブル(×2)/トリプル(×3)リング＋アウターブル25/インナーブル50）。
//   刺さった座標 (x,y) から セクション値と倍率を求めて 点数を返す。
// - 乱数は使わない＝完全決定論。時間・入力は game.ts が ctx から渡す。
// - import してよいのは game-api と同一フォルダのみ（このファイルは依存なし）。

export const W = 360;
export const H = 640;

/** ボードの中心と半径（ダブルリング外縁まで＝rn 1.0 の位置） */
export const BOARD = { cx: 180, cy: 250, r: 146 };

// 半径の割合（rn = dist / BOARD.r）。普通の難易度に少し寄せた配分
export const INNER_BULL = 0.055; // 50
export const OUTER_BULL = 0.11; // 25
export const TRIPLE_IN = 0.53;
export const TRIPLE_OUT = 0.61;
export const DOUBLE_IN = 0.9;
export const DOUBLE_OUT = 1.0;

/** 標準ダーツの並び（12時=20 から 時計回り） */
export const WEDGE_ORDER = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];

export const DARTS_TOTAL = 9;
export const ROUND_SIZE = 3;
/** 理論最大 = 9投すべて トリプル20 */
export const MAX_SCORE = DARTS_TOTAL * 60;

export type Ring = 'miss' | 'single' | 'double' | 'triple' | 'bull25' | 'bull50';
export interface HitResult {
  points: number;
  mult: number;
  value: number; // セクション値（ブルは 25/50）
  ring: Ring;
}

/** 三角波 0→1→0（掃引ライン用）。phase は任意の実数 */
export function triWave(phase: number): number {
  const p = ((phase % 1) + 1) % 1;
  return p < 0.5 ? p * 2 : 2 - p * 2;
}

/** ボード中心からの角度（12時=0・時計回り）で ウェッジの添字を返す */
export function wedgeIndexAt(dx: number, dy: number): number {
  let th = Math.atan2(dx, -dy); // 上=0・右(+x)で増加＝時計回り
  th = (th + Math.PI * 2) % (Math.PI * 2);
  const seg = Math.PI / 10; // 18°
  return Math.floor((th + seg / 2) / seg) % 20;
}

/** 画面座標 (x,y) に刺さったときの 点数・倍率・リング */
export function scoreAt(x: number, y: number): HitResult {
  const dx = x - BOARD.cx;
  const dy = y - BOARD.cy;
  const rn = Math.hypot(dx, dy) / BOARD.r;
  if (rn > DOUBLE_OUT) return { points: 0, mult: 0, value: 0, ring: 'miss' };
  if (rn <= INNER_BULL) return { points: 50, mult: 1, value: 50, ring: 'bull50' };
  if (rn <= OUTER_BULL) return { points: 25, mult: 1, value: 25, ring: 'bull25' };
  const value = WEDGE_ORDER[wedgeIndexAt(dx, dy)] ?? 0;
  let mult = 1;
  let ring: Ring = 'single';
  if (rn > TRIPLE_IN && rn <= TRIPLE_OUT) {
    mult = 3;
    ring = 'triple';
  } else if (rn > DOUBLE_IN && rn <= DOUBLE_OUT) {
    mult = 2;
    ring = 'double';
  }
  return { points: value * mult, mult, value, ring };
}
