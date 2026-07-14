// =============================================================
// シェイクジュース（No.46）のレシピとミックス計算（DOM非依存・純ロジック）
// =============================================================
// - シェイク強度（0〜1）を「ちょうどいい帯」にキープするとミックスが進む。
//   強すぎると あわ が増え、満タンで こぼれる（ミックスが減る）。弱いと進まない。
// - 3杯のレシピは固定（乱数不使用＝毎回同じ。強さの帯がだんだんシビアに）。
// - import してよいのは game-api（types/helpers）と同一フォルダのみ（このファイルは依存なし）。

/** ミックスの進む速さ（%/秒・帯の中にいるとき） */
export const MIX_RATE = 22;
/** あわの増える速さ（%/秒・帯より強いとき） */
export const FOAM_RATE = 34;
/** あわの引く速さ（%/秒・帯内または帯より弱いとき） */
export const FOAM_DECAY = 22;
/** こぼれたときに失うミックス（%） */
export const SPILL_MIX_LOSS = 20;
/** 1杯の得点: 100 + はやさ max(0,30-秒)×3 + こぼしなし40 */
export const JUICE_BASE = 100;
export const SPEED_FROM_SEC = 30;
export const SPEED_MULT = 3;
export const NO_SPILL_BONUS = 40;

/** タップ代替: 1タップの強度アップ / 毎秒の減衰（exp(-TAP_DECAY×dt)） */
export const TAP_IMPULSE = 0.18;
export const TAP_DECAY = 1.9;

export interface Recipe {
  name: string;
  emoji: string;
  /** ちょうどいい強さの帯 */
  lo: number;
  hi: number;
  /** 帯のよびかた（そっと/ふつう/つよく） */
  label: string;
  /** グラスの色 */
  color: string;
}

/** 3杯のレシピ（だんだんデリケートに） */
export const RECIPES: Recipe[] = [
  { name: 'いちごミルク', emoji: '🍓', lo: 0.3, hi: 0.62, label: 'ふつうに ふる', color: '#ff9eb0' },
  { name: 'バナナスムージー', emoji: '🍌', lo: 0.55, hi: 0.88, label: 'つよく ふる', color: '#ffd23e' },
  { name: 'メロンソーダ', emoji: '🍈', lo: 0.14, hi: 0.4, label: 'そーっと ふる', color: '#7ddf8e' },
];

export interface MixState {
  /** ミックスの進み 0〜100 */
  mix: number;
  /** あわ 0〜100（100でこぼれ） */
  foam: number;
  /** こぼした回数 */
  spills: number;
}

/**
 * 1フレームぶんミックスを進める。こぼれが起きたら 'spill' を返す。
 * level=いまのシェイク強度（0〜1）。
 */
export function stepMix(st: MixState, level: number, recipe: Recipe, dt: number): 'spill' | null {
  if (level > recipe.hi) {
    st.foam += FOAM_RATE * dt;
    if (st.foam >= 100) {
      st.foam = 0;
      st.mix = Math.max(0, st.mix - SPILL_MIX_LOSS);
      st.spills++;
      return 'spill';
    }
    return null;
  }
  if (level >= recipe.lo) {
    st.mix = Math.min(100, st.mix + MIX_RATE * dt);
  }
  st.foam = Math.max(0, st.foam - FOAM_DECAY * dt);
  return null;
}

/** 1杯の得点（sec=かかった秒・spills=この杯でこぼした回数） */
export function juiceScore(sec: number, spills: number): number {
  let s = JUICE_BASE + Math.max(0, SPEED_FROM_SEC - sec) * SPEED_MULT;
  if (spills === 0) s += NO_SPILL_BONUS;
  return s;
}
