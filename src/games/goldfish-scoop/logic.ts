// =============================================================
// きんぎょすくい（No.55）の魚・ポイの純ロジック（DOM非依存）
// =============================================================
// - 魚は水中を ゆっくり泳ぎ、ポイ（網）が近づくと そっと逃げる。ポイで すくって
//   おわんへ はこぶ。ポイの紙は「水につけた時間＋のせた魚の重さ」で やぶれる。
// - 乱数は魚の湧き・泳ぎに rng 注入（ctx.random）。判定・重さ・耐久・採点は純粋関数。
// - import してよいのは game-api と同一フォルダのみ（このファイルは依存なし）。

export interface FishType {
  key: string;
  value: number;
  color: string;
  speed: number;
  rare: boolean;
  weight: number; // 湧きやすさ
}

export const FISH_TYPES: FishType[] = [
  { key: 'kokin', value: 20, color: '#ff8a3c', speed: 26, rare: false, weight: 6 }, // こきん（オレンジ）
  { key: 'aka', value: 30, color: '#e0483c', speed: 30, rare: false, weight: 4 }, // あか
  { key: 'demekin', value: 45, color: '#3a3a44', speed: 24, rare: false, weight: 3 }, // でめきん（黒）
  { key: 'ranchu', value: 80, color: '#ffd24a', speed: 40, rare: true, weight: 1 }, // らんちゅう（レア・金）
];

export const WATER_Y = 168; // これより下が水
export const POI_R = 30; // 網の半径
/** ポイの耐久の減り: 水中で毎秒この割合＋のせた魚1匹ごと */
export const BASE_TEAR = 0.05;
export const LOAD_TEAR = 0.055;

export interface Fish {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  type: FishType;
  caught: boolean; // ポイの上か
  gone: boolean; // 逃げた/届けた
}

export function typeByWeight(rng: () => number): FishType {
  const total = FISH_TYPES.reduce((s, t) => s + t.weight, 0);
  let r = rng() * total;
  for (const t of FISH_TYPES) {
    r -= t.weight;
    if (r < 0) return t;
  }
  return FISH_TYPES[0]!;
}

/** 初期の魚の群れ（rng 注入・決定論）。w×h は水面の下の遊泳域 */
export function makeSchool(rng: () => number, n: number, w: number, h: number): Fish[] {
  const fish: Fish[] = [];
  for (let i = 0; i < n; i++) {
    const t = typeByWeight(rng);
    const ang = rng() * Math.PI * 2;
    fish.push({
      id: i,
      x: 30 + rng() * (w - 60),
      y: WATER_Y + 24 + rng() * (h - WATER_Y - 48),
      vx: Math.cos(ang) * t.speed,
      vy: Math.sin(ang) * t.speed,
      type: t,
      caught: false,
      gone: false,
    });
  }
  return fish;
}

/** ポイが近いと逃げる速度成分（弱い反発）。返り値を vx,vy に足す */
export function fleeAccel(fx: number, fy: number, netX: number, netY: number, netR: number): { ax: number; ay: number } {
  const dx = fx - netX;
  const dy = fy - netY;
  const d = Math.hypot(dx, dy);
  const range = netR + 46;
  if (d >= range || d < 0.001) return { ax: 0, ay: 0 };
  const force = (1 - d / range) * 120; // 近いほど強く
  return { ax: (dx / d) * force, ay: (dy / d) * force };
}

/** ポイの網に入っているか（すくえる範囲） */
export function overlaps(fx: number, fy: number, netX: number, netY: number, netR: number): boolean {
  return Math.hypot(fx - netX, fy - netY) <= netR;
}

/** 耐久の1フレーム更新。inWater のときだけ減る（load=のせた魚の数） */
export function tearStep(dur: number, inWater: boolean, load: number, dt: number): number {
  if (!inWater) return dur;
  return Math.max(0, dur - dt * (BASE_TEAR + load * LOAD_TEAR));
}
