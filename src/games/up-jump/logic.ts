// =============================================================
// うえうえジャンプ（No.58）の足場生成と物理定数（DOM非依存・純ロジック）
// =============================================================
// - 足場を跳ね上がって 上へ のぼる。足場の たて間隔は「1回のジャンプで届く高さ」より必ず狭い
//   ＝いつでも のぼれる（理不尽な離れ足場を作らない）。のぼるほど 難しく（間隔ひろめ・動く足場増）。
// - 乱数は rng 注入（ctx.random＝日替わり同一）。import は game-api と同一フォルダのみ。

export const W = 360;
export const H = 640;
export const GRAVITY = 1500; // px/s^2
export const JUMP_V = 640; // 通常バウンドの初速（上向き）
export const SPRING_V = 1080; // バネの初速
/** 1回のジャンプで届く最大の高さ（= JUMP_V^2 / (2g)）。足場間隔はこれ未満にする */
export const MAX_REACH = (JUMP_V * JUMP_V) / (2 * GRAVITY); // ≈ 136.5
export const PLAT_W = 62;
export const PLAT_H = 14;

export type PlatType = 'normal' | 'moving' | 'spring';

export interface Platform {
  x: number; // 左端
  y: number;
  type: PlatType;
  vx: number; // moving のときの速度
  used: boolean; // spring 演出などに使用
}

/** climbedPx に応じた 足場の たて間隔（のぼるほど広がるが MAX_REACH 未満を厳守） */
export function gapFor(climbedPx: number, rng: () => number): number {
  const diff = Math.min(1, climbedPx / 6000); // 0→1
  const min = 62 + diff * 24; // 62→86
  const max = 96 + diff * 34; // 96→130（< MAX_REACH 136）
  // 6000px より上（＝金メダル450m・全実績500m を越えたあと）も、ほんの少しだけ広がり続ける。
  // MAX_REACH 136 は超えないので「届かない足場」にはならない（到達可能性は維持）。
  const ex = Math.min(4, Math.max(0, climbedPx - 6000) / 3000); // 0→4px
  return min + rng() * (max + ex - min); // rng の消費回数は従来と同じ1回
}

/** 足場のタイプ（のぼるほど moving/spring が増える。spring はごくたまに） */
export function typeFor(climbedPx: number, rng: () => number): PlatType {
  const diff = Math.min(1, climbedPx / 6000);
  // 6000px より上（全実績・金メダルの圏外）でだけ、動く足場の比率をさらに上げる（40%→70%）。
  const ex = Math.min(1, Math.max(0, climbedPx - 6000) / 9000);
  const r = rng(); // 消費回数は従来と同じ1回
  if (r < 0.08 + diff * 0.04) return 'spring'; // 8%→12%
  if (r < 0.08 + diff * 0.04 + 0.15 + diff * 0.25 + ex * 0.3) return 'moving'; // 15%→40%→70%
  return 'normal';
}

/** 直前の足場 prevY の上に 次の足場を1つ作る（rng 注入・決定論） */
export function nextPlatform(prevY: number, climbedPx: number, rng: () => number): Platform {
  const y = prevY - gapFor(climbedPx, rng);
  const type = typeFor(climbedPx, rng);
  const x = rng() * (W - PLAT_W);
  // 動く足場の速さも 6000px より上でだけ上がる（60〜120 → 最大150〜210px/s）。rng消費は従来と同じ。
  const exSpd = Math.min(90, Math.max(0, climbedPx - 6000) * 0.01);
  const vx = type === 'moving' ? (rng() < 0.5 ? -1 : 1) * (60 + rng() * 60 + exSpd) : 0;
  return { x, y, type, vx, used: false };
}

/** 足場の上面に、落下中(vy>=0)のキャラの足が乗るか（x 重なり＆ y が上面付近） */
export function landsOn(
  charX: number,
  charHalfW: number,
  footPrev: number,
  footNow: number,
  plat: Platform,
): boolean {
  const top = plat.y;
  // 足が この足場の上面を またいで通過したか（前フレーム上→今フレーム下）
  if (footPrev <= top && footNow >= top) {
    return charX + charHalfW > plat.x && charX - charHalfW < plat.x + PLAT_W;
  }
  return false;
}
