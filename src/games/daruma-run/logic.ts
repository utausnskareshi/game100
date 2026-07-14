// =============================================================
// だるまさんがころんだ（No.50）の読み上げと得点（DOM非依存・純ロジック）
// =============================================================
// - おには「だ・る・ま・さ・ん・が・こ・ろ・ん・だ」を読み上げ、言い終わると振り向く。
//   読み上げの速さはランダム。ときどき途中で止まる「フェイント」あり（止まっても振り向かない）。
// - 振り向きにはわずかな猶予（GRACE_MS）があり、その間に手を離せばセーフ。
// - 乱数は注入（ctx.random）。1サイクルの消費は4回固定＝日替わりで全員同じおに。
// - import してよいのは game-api（types/helpers）と同一フォルダのみ（このファイルは依存なし）。

export type Rng = () => number;

/** ゴールまでの距離（m）と進む速さ（m/s・おしている間） */
export const GOAL_M = 40;
export const RUN_SPEED = 3.2;
/** 振り向きの猶予（この間に離せばセーフ・ms） */
export const GRACE_MS = 180;
/** おにが背中に戻る時間（ms・安全） */
export const BACK_MS = 400;
/** つかまれる回数（3回で終了） */
export const LIVES = 3;
/** フェイントが入る位置（読み上げの進み） */
export const FEINT_AT = 0.55;

/** 読み上げの文字（10文字） */
export const CHANT_TEXT = 'だるまさんがころんだ';

export interface Chant {
  /** 読み上げにかかる時間（フェイントの停止を除く・ms） */
  speakMs: number;
  feint: boolean;
  /** フェイントで止まる時間（ms・feint時のみ） */
  feintPauseMs: number;
  /** 振り向いて見ている時間（ms） */
  watchMs: number;
}

/** 1サイクルの抽選（乱数消費は常に4回） */
export function rollChant(rng: Rng): Chant {
  const speakMs = 1400 + rng() * 2000;
  const feintRoll = rng();
  const feintPauseMs = 600 + rng() * 600;
  const watchMs = 900 + rng() * 700;
  return { speakMs, feint: feintRoll < 0.25, feintPauseMs, watchMs };
}

/** 読み上げの総時間（フェイント停止込み・この時間が過ぎたら振り向く） */
export function chantTotalMs(c: Chant): number {
  return c.speakMs + (c.feint ? c.feintPauseMs : 0);
}

/** 読み上げ開始から elapsed ms 時点で、何文字目まで言っているか（0〜10） */
export function chantChars(c: Chant, elapsed: number): number {
  let spoken = elapsed;
  if (c.feint) {
    const pauseStart = c.speakMs * FEINT_AT;
    if (elapsed > pauseStart) {
      spoken = elapsed < pauseStart + c.feintPauseMs ? pauseStart : elapsed - c.feintPauseMs;
    }
  }
  return Math.max(0, Math.min(CHANT_TEXT.length, Math.floor((spoken / c.speakMs) * CHANT_TEXT.length)));
}

/** ゴール時の得点（sec=かかった秒・caught=つかまった回数0〜2） */
export function goalScore(sec: number, caught: number): number {
  const bonus = [90, 40, 10][Math.min(2, caught)]!;
  return 250 + Math.max(0, 80 - sec) * 4 + bonus;
}

/** 3回つかまって終了したときの部分点 */
export function partialScore(dist: number): number {
  return Math.floor((Math.min(GOAL_M, dist) / GOAL_M) * 120);
}
