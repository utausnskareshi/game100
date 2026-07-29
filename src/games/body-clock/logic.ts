// =============================================================
// たいないどけい（No.104・かくれゲーム）: 純ロジック（お題の秒数・採点）
// =============================================================
// - 「◯びょう ぴったりでタップ」。画面に数字も目もりも出さないので、体の中の時計だけが頼り。
// - お題の秒数は rng 注入＝決定論。DOM 非依存。
// =============================================================

/** 出題する秒数の候補（短すぎ・長すぎは避けて、ふつうの難易度に） */
export const TARGET_POOL = [3, 4, 5, 6, 7, 8];

export const ROUNDS = 5;

/** 5ラウンドぶんのお題（同じ秒数は続けて出さない） */
export function makeTargets(rng: () => number): number[] {
  const out: number[] = [];
  for (let i = 0; i < ROUNDS; i++) {
    let t = TARGET_POOL[Math.floor(rng() * TARGET_POOL.length)]!;
    for (let k = 0; k < 8 && out.length > 0 && t === out[out.length - 1]; k++) {
      t = TARGET_POOL[Math.floor(rng() * TARGET_POOL.length)]!;
    }
    out.push(t);
  }
  return out;
}

/** ズレ（秒・絶対値）から得点。ふつうの難易度なので ±0.5秒でも半分は入る */
export function scoreFor(diffSec: number): number {
  const d = Math.abs(diffSec);
  if (d <= 0.15) return 200;
  if (d <= 0.3) return 150;
  if (d <= 0.5) return 100;
  if (d <= 0.8) return 60;
  if (d <= 1.2) return 30;
  return 10;
}

/** 「ぴったり」とみなすズレ（実績と表示で共通に使う） */
export const JUST_SEC = 0.15;
/** 「大ハズレではない」とみなすズレ */
export const OK_SEC = 0.5;

/** ズレの言い方（はやい／おそい／ぴったり） */
export function diffLabel(diffSec: number): string {
  if (Math.abs(diffSec) <= JUST_SEC) return 'ぴったり！';
  return diffSec < 0 ? `${Math.abs(diffSec).toFixed(2)}びょう はやい` : `${diffSec.toFixed(2)}びょう おそい`;
}
