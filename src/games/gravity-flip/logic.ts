// =============================================================
// じゅうりょくスイッチ（No.96）: 純ロジック（決定論・rng注入・テスト対象）
// =============================================================
// - 縦のコリドーを「登る」ランナー。重力は左右方向で、タップで反転。
//   キャラは左右どちらかの壁に張り付き、反転すると反対の壁へ加速して移る。
// - 壁から出るトゲを、反対の壁にいる（or 横断中に中央を通る）ことで避ける。1ヒットでおしまい。
// - トゲ列は rng を「side→gap の固定順」で引いて生成＝決定論（日替わり共通）。
//   間隔は「時間換算 interval × 速度」で決めるので、速くなっても最短反応時間は確保され必ず通過可能。
// - 物理は固定サブステップ(1/120s)＝実時間で決定論（同じ経過時間＋同じタップ列→同じ結果）。
// =============================================================

export const W = 360;
export const H = 640;

/** コリドーの左右の壁のX、キャラ半径、キャラの固定スクリーンY */
export const WALL_L = 44;
export const WALL_R = 316;
export const CHAR_R = 15;
export const CHAR_Y = 432;
/** 壁に張り付いたときのキャラ中心X */
export const REST_L = WALL_L + CHAR_R;
export const REST_R = WALL_R - CHAR_R;

/** 横方向の重力加速度（px/s^2） */
export const GRAV = 2600;

/** トゲのY方向の長さと、壁からの突き出し量 */
export const SPIKE_H = 46;
export const SPIKE_DEPTH = 34;

export type Side = 'L' | 'R';

/** 進んだ距離 dist(px) におけるスクロール速度（px/s）。だんだん速く */
export function speedAt(dist: number): number {
  // 〜4300px は従来どおり 165→380（この範囲の手触りは不変）。
  // それ以降も止まらず速くなる（＝上手い人でも永遠には続かない）。
  return 165 + Math.min(215, dist * 0.05) + Math.max(0, dist - 4300) * 0.012;
}

/**
 * トゲ間の時間間隔（秒）。だんだん短く。
 * 〜3000px は従来どおり 0.92→0.56（不変）。それ以降も少しずつ詰めるが、
 * 壁の横断に必要な約0.43秒（=sqrt(2*242/2600)）＋余裕0.03秒＝**0.46秒を下限**にして
 * 「理論上は避けられるが、いずれ人間の限界に達する」カーブにする。
 */
export function intervalAt(dist: number): number {
  const base = Math.max(0.56, 0.92 - dist * 0.00012);
  return Math.max(0.46, base - Math.max(0, dist - 3000) * 0.000012);
}

/**
 * 次のトゲ（side と、直前トゲからの距離 gapDist(px)）。rng は side→gap の固定順で2回引く。
 * gapDist = 速度 × 時間間隔 なので、速くなっても「避けるのに十分な時間」は保たれる。
 */
export function nextSpike(rng: () => number, dist: number): { side: Side; gapDist: number } {
  const rSide = rng();
  const rGap = rng();
  const iv = intervalAt(dist) * (0.88 + rGap * 0.24);
  return { side: rSide < 0.5 ? 'L' : 'R', gapDist: speedAt(dist) * iv };
}

/** 距離(px) → 表示スコア（10pxで1点） */
export const scoreOf = (dist: number): number => Math.floor(dist / 10);
