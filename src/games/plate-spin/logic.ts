// =============================================================
// おさらまわし（No.78）の定数・純ロジック（DOM非依存）
// =============================================================
// - 棒の上の皿は回転(spin 1→0)がだんだん弱まり、WOBBLE を下回るとぐらぐら、0 で落ちて割れる。
//   タップで回し直し(spin=1)。「まだ元気（FRESH以上）」の皿はタップしても回し直せない
//   （＝連打では守れない。窓を見て回すゲーム性・スパム得点も構造的に不可能）。
// - 得点: ぐらぐら救出 RESCUE_PTS / ふつうの回し直し RESPIN_PTS / 金の皿は×3。
//   全皿が SAFE 以上のまま1秒経過するごとに 安定ボーナス STAB_PTS。75秒完走で CLEAR_PTS。
// - 皿は2枚から始まり SPAWN_INTERVAL ごとに増えて最大6枚。割れた棒には少しあとで新しい皿。
// - 乱数（皿の種類・初期位相）は ctx.random 注入＝完全決定論。
// - import してよいのは game-api と同一フォルダのみ（このファイルは依存なし）。

export const W = 360;
export const H = 640;

export const GAME_SEC = 75;
export const BROKEN_LIMIT = 3;

/** これ未満で ぐらぐら（救出ボーナス対象） */
export const WOBBLE = 0.32;
/** 安定ボーナスの下限（全皿がこれ以上で +STAB_PTS/秒） */
export const SAFE = 0.4;
/** これ以上は「まだ元気」＝タップしても回し直せない */
export const FRESH = 0.6;

export const RESCUE_PTS = 15;
export const RESPIN_PTS = 8;
export const GOLD_MULT = 3;
export const STAB_PTS = 5;
export const CLEAR_PTS = 150;

export const SPAWN_INTERVAL = 11; // 秒。2枚目以降の追加間隔
export const FALL_MS = 600;
export const RESPAWN_MS = 3000;
export const TAP_R = 52;

export interface Pole {
  x: number;
  y: number; // 皿の中心（棒の先端）
}

export const POLES: Pole[] = [
  { x: 78, y: 270 },
  { x: 180, y: 270 },
  { x: 282, y: 270 },
  { x: 78, y: 480 },
  { x: 180, y: 480 },
  { x: 282, y: 480 },
];

/** 皿が増えていく棒の順番（まん中→外へ） */
export const SPAWN_ORDER = [1, 4, 0, 5, 2, 3];

export interface PlateType {
  name: string;
  decay: number; // spin の減り／秒
  gold?: boolean;
  rim: string; // ふちの色
  size: number; // 半径（横）
}

export const TYPES: PlateType[] = [
  { name: 'おおざら', decay: 0.055, rim: '#3d7df0', size: 38 },
  { name: 'ちゅうざら', decay: 0.085, rim: '#3a9d54', size: 33 },
  { name: 'こざら', decay: 0.125, rim: '#ff8a4a', size: 28 },
  { name: 'きんのさら', decay: 0.2, gold: true, rim: '#ffd54a', size: 30 },
];

/** 追加皿の種類を引く（大35% / 中30% / 小25% / 金10%） */
export function rollType(rng: () => number): number {
  const r = rng();
  if (r < 0.35) return 0;
  if (r < 0.65) return 1;
  if (r < 0.9) return 2;
  return 3;
}

/** タップ時の得点（FRESH 以上は回し直し不可＝0 を返し、呼び出し側は何もしない） */
export function tapPoints(spin: number, gold: boolean): number {
  if (spin >= FRESH) return 0;
  const base = spin < WOBBLE ? RESCUE_PTS : RESPIN_PTS;
  return gold ? base * GOLD_MULT : base;
}

export function decayStep(spin: number, decay: number, dt: number): number {
  return Math.max(0, spin - decay * dt);
}
