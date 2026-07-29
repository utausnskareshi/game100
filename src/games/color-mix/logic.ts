// =============================================================
// いろまぜラボ（No.103・かくれゲーム）: 純ロジック（色の混ぜ方・出題・採点）
// =============================================================
// - 赤・青・黄の3色を「しずく」で足していき、お手本の色に近づける。
// - 混ぜた色は「入れた しずくの平均」。同じ比なら同じ色になる（2:1:0 と 4:2:0 は同じ）ので、
//   少ないしずくでも正解にたどり着ける＝やさしい。
// - お手本は「実際に作れる配合」から作るので、必ず ぴったり合わせられる（構成的に保証）。
// - rng 注入＝決定論。DOM 非依存。
// =============================================================

export interface RGB {
  r: number;
  g: number;
  b: number;
}

/** 混ぜる元の3色（赤・青・黄） */
export const BASES: RGB[] = [
  { r: 230, g: 60, b: 60 },
  { r: 60, g: 110, b: 230 },
  { r: 245, g: 205, b: 60 },
];

export const BASE_LABEL = ['あか', 'あお', 'きいろ'];

/** しずくの数（[赤,青,黄]）から混ざった色を出す。0滴なら null（まだ空） */
export function mixColor(counts: number[]): RGB | null {
  const total = counts.reduce((a, b) => a + b, 0);
  if (total <= 0) return null;
  let r = 0;
  let g = 0;
  let b = 0;
  for (let i = 0; i < BASES.length; i++) {
    const c = BASES[i]!;
    const n = counts[i] ?? 0;
    r += c.r * n;
    g += c.g * n;
    b += c.b * n;
  }
  return { r: Math.round(r / total), g: Math.round(g / total), b: Math.round(b / total) };
}

/** 2色の離れぐあい（0がぴったり） */
export function colorDistance(a: RGB, b: RGB): number {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

/** 離れぐあいから得点（ぴったり200点。はずれても20点は入る＝のんびり枠） */
export function scoreFor(dist: number): number {
  if (dist <= 8) return 200;
  if (dist <= 20) return 150;
  if (dist <= 40) return 100;
  if (dist <= 70) return 60;
  return 20;
}

/** ぴったり判定のしきい値（scoreFor と合わせる） */
export const PERFECT_DIST = 8;

export interface Target {
  /** お手本の配合（[赤,青,黄]のしずく数）。答えそのものなので画面には出さない */
  recipe: number[];
  /** お手本の色 */
  color: RGB;
}

export const ROUNDS = 6;

/** 各ラウンドで使う色数としずくの上限（だんだん複雑になる） */
const SPECS: { colors: number; max: number }[] = [
  { colors: 2, max: 3 },
  { colors: 2, max: 4 },
  { colors: 2, max: 5 },
  { colors: 3, max: 5 },
  { colors: 3, max: 6 },
  { colors: 3, max: 7 },
];

function shuffle<T>(a: T[], rng: () => number): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = a[i]!;
    a[i] = a[j]!;
    a[j] = t;
  }
  return a;
}

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

/** 配合を「いちばん小さい比」にした文字列（色は比だけで決まるので、これが同じ＝同じ色） */
function ratioKey(counts: number[]): string {
  const d = counts.reduce((a, b) => gcd(a, b), 0) || 1;
  return counts.map((c) => c / d).join(':');
}

/**
 * 6問ぶんのお手本を作る。
 * - 配合は「実際に混ぜられる数」だけなので、必ず ぴったり合わせられる
 * - **同じ比（＝同じ色）は2回出さない**。色は比だけで決まるので、比の重複を弾けば
 *   「まったく同じお手本が2回出る」ことが構造的に起きない
 * - そのうえで、できるだけ 見分けのつく色（前の問題から離れた色）を選ぶ
 */
export function makeTargets(rng: () => number): Target[] {
  const out: Target[] = [];
  const usedRatios = new Set<string>();
  for (let i = 0; i < ROUNDS; i++) {
    const spec = SPECS[Math.min(i, SPECS.length - 1)]!;
    let fallback: Target | null = null;
    let picked: Target | null = null;
    for (let attempt = 0; attempt < 80; attempt++) {
      const idx = shuffle([0, 1, 2], rng).slice(0, spec.colors);
      const counts = [0, 0, 0];
      // 使う色それぞれに1滴以上入れる（1色だけの色にならないように）
      for (const k of idx) counts[k] = 1;
      const rest = Math.max(0, spec.max - spec.colors);
      // 残りのしずくをランダムに配る
      for (let n = 0; n < rest; n++) {
        if (rng() < 0.35) continue;
        const k = idx[Math.floor(rng() * idx.length)]!;
        counts[k] = (counts[k] ?? 0) + 1;
      }
      const key = ratioKey(counts);
      if (usedRatios.has(key)) continue; // 同じ色は出さない
      const color = mixColor(counts)!;
      const cand: Target = { recipe: counts, color };
      if (!fallback) fallback = cand;
      // 前の問題から十分に離れていれば即採用（見分けやすさ優先）
      if (out.every((t) => colorDistance(t.color, color) >= 40)) {
        picked = cand;
        break;
      }
    }
    const chosen = picked ?? fallback;
    if (chosen) {
      usedRatios.add(ratioKey(chosen.recipe));
      out.push(chosen);
    } else {
      // ここへは来ない想定（比の候補が尽きるほど狭い spec にはしていない）
      const counts = [1, 1, 1];
      out.push({ recipe: counts, color: mixColor(counts)! });
    }
  }
  return out;
}
