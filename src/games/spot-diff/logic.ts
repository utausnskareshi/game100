// =============================================================
// まちがいさがし（No.62）のシーン生成と判定（DOM非依存・純ロジック）
// =============================================================
// - 2枚の絵（上=お手本 / 下=まちがい入り）をプロシージャル生成する。
//   オブジェクト（絵文字）を重ならないよう散布し、そのうち5つに「まちがい」を仕込む:
//   すり替え（似た絵文字）/ 鏡がえし / 大きさ / 回転 / 消える の5種。
// - 乱数は rng 注入（ctx.random＝日替わりは全員同じ問題）。配置ループは打ち切り＋緩和つき。
// - import してよいのは game-api と同一フォルダのみ（このファイルは依存なし）。

export const PANEL_W = 340;
export const PANEL_H = 222;
export const DIFF_COUNT = 5;
export const FIND_PTS = 40;
export const NO_HINT_BONUS = 40;

/** シーンクリアの速さボーナス（経過ms＋ペナルティms から計算・2点/秒で減衰） */
export function bonusFor(ms: number): number {
  return Math.max(0, 200 - Math.ceil(ms / 1000) * 2);
}

export type Theme = 'park' | 'room' | 'sea';
export const THEMES: Theme[] = ['park', 'room', 'sea'];

interface Pair {
  a: string;
  b: string;
  flip: boolean; // 左右向きがあり 鏡がえしが分かる絵か
}

const PAIRS: Record<Theme, Pair[]> = {
  park: [
    { a: '🌳', b: '🌲', flip: false },
    { a: '🌷', b: '🌻', flip: false },
    { a: '⚽', b: '🏀', flip: false },
    { a: '🐕', b: '🐈', flip: true },
    { a: '🦆', b: '🐦', flip: true },
    { a: '🍎', b: '🍊', flip: false },
    { a: '🧢', b: '👒', flip: true },
    { a: '🚲', b: '🛴', flip: true },
  ],
  room: [
    { a: '📕', b: '📗', flip: false },
    { a: '⏰', b: '⌚', flip: false },
    { a: '🎁', b: '📦', flip: false },
    { a: '🧸', b: '🐻', flip: false },
    { a: '🌂', b: '☂️', flip: false },
    { a: '💡', b: '🕯️', flip: false },
    { a: '🧦', b: '🧤', flip: true },
    { a: '🍪', b: '🍩', flip: false },
  ],
  sea: [
    { a: '🐟', b: '🐠', flip: true },
    { a: '🦀', b: '🦐', flip: true },
    { a: '⛵', b: '🚤', flip: true },
    { a: '🐚', b: '⭐', flip: false },
    { a: '🌴', b: '🌳', flip: false },
    { a: '🍉', b: '🍍', flip: false },
    { a: '⚓', b: '🔱', flip: false },
    { a: '🐢', b: '🐸', flip: true },
  ],
};

export type DiffType = 'swap' | 'flip' | 'size' | 'rotate' | 'remove';

export interface SceneObject {
  x: number;
  y: number;
  emoji: string;
  /** すり替え先（ペアのもう片方） */
  altEmoji: string;
  flippable: boolean;
  size: number;
}

export interface Diff {
  /** objects の index */
  idx: number;
  type: DiffType;
  /** size のときの倍率 / rotate のときの角度(rad) */
  scale: number;
  rot: number;
}

export interface Scene {
  theme: Theme;
  objects: SceneObject[];
  diffs: Diff[];
}

/** 右パネル（まちがい入り）でのオブジェクト描画パラメータ */
export interface RenderParams {
  emoji: string;
  size: number;
  rot: number;
  flip: boolean;
  hidden: boolean;
}

export function baseParams(o: SceneObject): RenderParams {
  return { emoji: o.emoji, size: o.size, rot: 0, flip: false, hidden: false };
}

export function alteredParams(o: SceneObject, d: Diff | undefined): RenderParams {
  const p = baseParams(o);
  if (!d) return p;
  if (d.type === 'swap') p.emoji = o.altEmoji;
  else if (d.type === 'flip') p.flip = true;
  else if (d.type === 'size') p.size = Math.round(o.size * d.scale);
  else if (d.type === 'rotate') p.rot = d.rot;
  else if (d.type === 'remove') p.hidden = true;
  return p;
}

/** ラウンド（0〜）からシーンを作る（rng 注入・決定論） */
export function makeScene(round: number, rng: () => number): Scene {
  const theme = THEMES[round % THEMES.length]!;
  const pairs = PAIRS[theme];
  const count = 10 + Math.min(2, round) * 2; // 10 → 12 → 14
  const objects: SceneObject[] = [];
  let minDist = 46;
  let guard = 0;
  while (objects.length < count && guard++ < 500) {
    if (guard % 120 === 0 && minDist > 30) minDist -= 4; // 段階緩和
    const x = 24 + rng() * (PANEL_W - 48);
    const y = 30 + rng() * (PANEL_H - 54);
    if (objects.some((o) => Math.hypot(o.x - x, o.y - y) < minDist)) continue;
    const pair = pairs[Math.floor(rng() * pairs.length)]!;
    const size = 26 + Math.floor(rng() * 10);
    objects.push({ x, y, emoji: pair.a, altEmoji: pair.b, flippable: pair.flip, size });
  }

  // まちがいにする5つを えらぶ（たがいに はなす＝タップで まぎれない）
  const diffIdx: number[] = [];
  let sep = 58;
  guard = 0;
  while (diffIdx.length < Math.min(DIFF_COUNT, objects.length) && guard++ < 400) {
    if (guard % 100 === 0 && sep > 40) sep -= 6;
    const i = Math.floor(rng() * objects.length);
    if (diffIdx.includes(i)) continue;
    const oi = objects[i]!;
    if (diffIdx.some((j) => Math.hypot(objects[j]!.x - oi.x, objects[j]!.y - oi.y) < sep)) continue;
    diffIdx.push(i);
  }

  // まちがいの種類（remove は1シーン2つまで・後半ラウンドほど 微妙な差に）
  const subtle = round >= 2;
  const diffs: Diff[] = [];
  let removes = 0;
  for (const idx of diffIdx) {
    const o = objects[idx]!;
    const types: DiffType[] = ['swap', 'size', 'rotate'];
    if (o.flippable) types.push('flip');
    if (removes < 2) types.push('remove');
    const type = types[Math.floor(rng() * types.length)]!;
    if (type === 'remove') removes++;
    const scale = type === 'size' ? (rng() < 0.5 ? (subtle ? 1.3 : 1.45) : subtle ? 0.72 : 0.62) : 1;
    const rot = type === 'rotate' ? ((rng() < 0.5 ? -1 : 1) * (subtle ? 30 : 42) * Math.PI) / 180 : 0;
    diffs.push({ idx, type, scale, rot });
  }
  return { theme, objects, diffs };
}

/** タップ位置（パネル内座標）に当たる「まちがい」の diffs index。なければ -1 */
export function hitDiff(scene: Scene, x: number, y: number): number {
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < scene.diffs.length; i++) {
    const o = scene.objects[scene.diffs[i]!.idx]!;
    const r = Math.max(30, o.size * 0.8);
    const d = Math.hypot(o.x - x, o.y - y);
    if (d <= r && d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}
