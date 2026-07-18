// =============================================================
// エレベーターさばき（No.71）のスポーンと定数（DOM非依存・純ロジック）
// =============================================================
// - 5階だてのビル。お客さんが かいだんホールに現れ、行き先階へ運んでほしがる。
//   エレベーターは タップした階へ動く。定員3。がまんゲージが切れると帰ってしまう。
// - お客さんの出現（階・行き先・顔）は rng 注入（ctx.random＝日替わり同一の流れ）。
// - import してよいのは game-api と同一フォルダのみ（このファイルは依存なし）。

export const FLOORS = 5;
export const CAPACITY = 3;
export const SESSION_MS = 90_000;
/** がまんゲージ（この時間で帰ってしまう。乗っている間は減らない） */
export const PATIENCE_MS = 24_000;
export const DELIVER_PTS = 30;
/** がまんゲージが半分いじょう残っていたら ごきげんボーナス */
export const HAPPY_PTS = 15;
export const HAPPY_RATIO = 0.5;
/** ドアの開いている時間 */
export const DOOR_MS = 900;
/** エレベーターの速さ（階/秒） */
export const CAR_SPEED = 1.7;

export const FACES = ['🐶', '🐱', '🐰', '🐻', '🦊', '🐼', '🐷', '🐸'] as const;

/** お客さんの出現間隔 ms（90秒で 2700→2100 のゆるやかなランプ） */
export function spawnInterval(tMs: number): number {
  return 2700 - 600 * Math.min(1, Math.max(0, tMs) / SESSION_MS);
}

export interface PassengerRoll {
  floor: number; // 1..5
  dest: number; // 1..5（floor と異なる）
  face: string;
}

/** お客さんを1人抽選する（rng 消費は常に3回） */
export function rollPassenger(rng: () => number): PassengerRoll {
  const floor = 1 + Math.floor(rng() * FLOORS);
  let dest = 1 + Math.floor(rng() * (FLOORS - 1));
  if (dest >= floor) dest++;
  const face = FACES[Math.floor(rng() * FACES.length)]!;
  return { floor, dest, face };
}
