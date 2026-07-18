// =============================================================
// くるくるおすしキャッチ（No.69）の出現抽選と定数（DOM非依存・純ロジック）
// =============================================================
// - ベルトを流れるおすしの皿から、注文パネルの品だけをタップで取る75秒。
// - 皿の出現は「注文でまだ足りない品を55%優先」＝ほしい皿が必ず流れてくる
//   （残りはランダム＋まれに金の皿）。rng 注入（ctx.random）。
// - import してよいのは game-api と同一フォルダのみ（このファイルは依存なし）。

export interface SushiDef {
  name: string;
  /** ネタの色（しゃりの上に描く） */
  color: string;
  /** ネタのハイライト色 */
  hi: string;
  /** のりまきタイプ（丸く描く） */
  roll?: boolean;
}

export const SUSHI: SushiDef[] = [
  { name: 'たまご', color: '#f2c84b', hi: '#ffe89a' },
  { name: 'まぐろ', color: '#e05a4e', hi: '#f0887c' },
  { name: 'サーモン', color: '#f09048', hi: '#ffb878' },
  { name: 'えび', color: '#ef7f62', hi: '#ffe0d0' },
  { name: 'いか', color: '#eeeee6', hi: '#ffffff' },
  { name: 'のりまき', color: '#2e2e34', hi: '#e8e0c8', roll: true },
];

export const SESSION_MS = 75_000;
export const GRAB_PTS = 25;
export const ORDER_PTS = 60;
export const GOLD_PTS = 80;
/** 金の皿の出現率（1皿ごと） */
export const GOLD_RATE = 0.045;
/** 注文でまだ足りない品を優先して流す確率 */
export const NEED_RATE = 0.55;
/** 注文コンプ後、次の注文が来るまでの間 */
export const ORDER_GAP_MS = 700;

/** コンボボーナス: 2連続め+5, 3連続め+10, …（さいだい+25） */
export const comboBonus = (combo: number): number => 5 * Math.min(Math.max(combo - 1, 0), 5);

/** ベルトの速さ px/s（75秒で 64→96 のゆるやかなランプ＝ふつう難易度） */
export function beltSpeed(tMs: number): number {
  return 64 + 32 * Math.min(1, Math.max(0, tMs) / SESSION_MS);
}

/** 皿の出現間隔 ms（1300→950） */
export function spawnInterval(tMs: number): number {
  return 1300 - 350 * Math.min(1, Math.max(0, tMs) / SESSION_MS);
}

/** 注文を作る（最初の3回は2品・以降3品。品はかぶりなし） */
export function makeOrder(orderNo: number, rng: () => number): number[] {
  const size = orderNo < 3 ? 2 : 3;
  const pool = Array.from({ length: SUSHI.length }, (_, i) => i);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = pool[i]!;
    pool[i] = pool[j]!;
    pool[j] = t;
  }
  return pool.slice(0, size);
}

export interface PlateRoll {
  type: number;
  gold: boolean;
}

/**
 * つぎに流す皿を決める。needs=注文でまだ埋まっていない品（重複なしでよい）。
 * 金の皿 → 注文優先 → ランダム の順で抽選する。
 */
export function rollPlate(needs: number[], rng: () => number): PlateRoll {
  if (rng() < GOLD_RATE) {
    return { type: Math.floor(rng() * SUSHI.length), gold: true };
  }
  if (needs.length > 0 && rng() < NEED_RATE) {
    return { type: needs[Math.floor(rng() * needs.length)]!, gold: false };
  }
  return { type: Math.floor(rng() * SUSHI.length), gold: false };
}
