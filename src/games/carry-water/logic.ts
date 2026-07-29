// =============================================================
// こぼさないで（No.105・かくれゲーム）: 純ロジック（コップの物理・ステージ）
// =============================================================
// - かたむけると コップが動くが、水面もゆれる。ゆれが大きいと こぼれる。
//   ＝「動かすために かたむける」と「こぼさないために かたむけたくない」のジレンマが遊び。
// - 物理は固定サブステップ（1/120秒）＝フレームレートに関係なく同じ結果（決定論）。
// - 数値は「なめらかに かたむければ こぼれない」ように選んである（テストで実証）。
// =============================================================

/** かたむき1のときの加速度（px/秒^2） */
export const ACC = 520;
/** 速度の減衰（1秒あたり） */
export const DAMP = 2.2;
/** 水面のばね（かたむきに追いつく速さ） */
export const SPRING = 26;
/** 水面のゆれの減衰 */
export const WDAMP = 5.2;
/** これ以上ゆれると こぼれる */
export const SPILL_LIMIT = 0.55;
/** こぼれる速さ（%/秒・超えた量に比例） */
export const SPILL_RATE = 90;
/** 固定サブステップ */
export const SUB_DT = 1 / 120;

/** コップが動ける範囲（design px） */
export const MIN_X = 45;
export const MAX_X = 315;
/** ゴール範囲 */
export const GOAL_X1 = 292;
export const GOAL_X2 = MAX_X;
/** ゴールで止まったと見なす速さ */
export const STOP_VX = 42;
/** ゴールに止まっていないといけない時間（秒） */
export const HOLD_SEC = 0.45;

export interface StageSpec {
  /** クリアに必要な水の量（%） */
  minWater: number;
}

/** 全5ステージ。必要な水の量だけが増えていく（＝だんだん ていねいに運ぶ必要がある） */
export const STAGES: StageSpec[] = [
  { minWater: 30 },
  { minWater: 45 },
  { minWater: 60 },
  { minWater: 72 },
  { minWater: 82 },
];

export interface CupState {
  /** コップの位置 */
  x: number;
  /** 横の速さ */
  vx: number;
  /** 水面のかたむき（-1〜1くらい） */
  w: number;
  /** 水面のかたむきの変化 */
  wv: number;
  /** 水の量（0〜100） */
  level: number;
  /** ゴール範囲で止まっている時間（秒） */
  hold: number;
  /** このステージでこぼした量（%） */
  spilled: number;
}

export function initialState(): CupState {
  return { x: MIN_X, vx: 0, w: 0, wv: 0, level: 100, hold: 0, spilled: 0 };
}

/**
 * 1サブステップ進める（tilt は -1〜1）。返り値は「こぼれたか」。
 * ※ 呼び出し側は dt を SUB_DT ずつに割って呼ぶこと（決定論のため）。
 */
export function step(s: CupState, tilt: number, dt: number): boolean {
  const t = Math.max(-1, Math.min(1, tilt));
  // コップの動き
  const a = t * ACC;
  s.vx += a * dt;
  s.vx -= s.vx * DAMP * dt;
  s.x += s.vx * dt;
  if (s.x < MIN_X) {
    s.x = MIN_X;
    s.vx = 0;
  } else if (s.x > MAX_X) {
    s.x = MAX_X;
    s.vx = 0;
  }
  // 水面のゆれ（かたむきに向かうばね＋減衰＝急に動かすと行きすぎる）
  s.wv += (t - s.w) * SPRING * dt;
  s.wv -= s.wv * WDAMP * dt;
  s.w += s.wv * dt;
  // こぼれ。※ ゆれ(w)を上限で切ってはいけない（切ると「超えた量」が毎ステップ分しか
  // 残らず、実質こぼれなくなる）。超えたぶんに比例して こぼし、こぼしている間は
  // ゆれを少し余分に落ち着かせる（水が出ていく＝ゆれが収まる）。
  let spilled = false;
  const over = Math.abs(s.w) - SPILL_LIMIT;
  if (over > 0) {
    if (s.level > 0) {
      const lost = over * SPILL_RATE * dt;
      s.level = Math.max(0, s.level - lost);
      s.spilled += lost;
      spilled = true;
    }
    s.wv -= s.wv * 3 * dt;
  }
  // 数値が発散しないための安全な上限（ばねの目標は±1なので通常ここには当たらない）
  s.w = Math.max(-1.8, Math.min(1.8, s.w));
  // ゴールで止まっているか
  if (s.x >= GOAL_X1 && s.x <= GOAL_X2 && Math.abs(s.vx) <= STOP_VX) s.hold += dt;
  else s.hold = 0;
  return spilled;
}

/** ステージをクリアしたか（ゴールで止まりきって、水が足りている） */
export function isCleared(s: CupState, stage: StageSpec): boolean {
  return s.hold >= HOLD_SEC && s.level >= stage.minWater;
}

/**
 * もう成功できない＝やり直し。
 * 水は減るだけで増えないので、必要量を下回った瞬間に そのステージは詰み。
 * （ゴールまで歩かせてから知らせるのはムダなので、その場で やり直しにする）
 */
export function isFailed(s: CupState, stage: StageSpec): boolean {
  return s.level < stage.minWater;
}

/** ステージの得点（残った水が多いほど高い） */
export function stageScore(s: CupState): number {
  return 100 + Math.round(s.level) * 2;
}
