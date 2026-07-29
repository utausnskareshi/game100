// =============================================================
// きまりを 見ぬけ（No.120・かくれゲーム）: 純ロジック（出題・唯一解の保証）
// =============================================================
// - 形・色・大きさが それぞれ「◯個ごとの くりかえし」で 変わる列を見せ、
//   つぎに 来るものを 4つから えらぶ。
// - 生成したら **「1〜3個ごと の どの周期で 読んでも 同じ答えになる」** ことを
//   確かめる（そうでないと 答えが 2とおりに なってしまう）。
// - えらぶ 4つのうち 正解は 1つだけ（ほかは かならず ちがう）。
// - DOM 非依存・rng 注入＝決定論。
// =============================================================

export const SHAPES = 4;
export const COLORS = 4;
export const SIZES = 3;

export interface Item {
  shape: number;
  color: number;
  size: number;
}

/** 見せる 個数（この あとに 来るものを あてる） */
export const SHOWN = 6;
/** 1もんの もちじかん（ミリ秒） */
export const ROUND_MS = 20000;
/** これより はやいと ボーナス */
export const QUICK_MS = 6000;
export const QUICK_BONUS = 20;

/** 各ラウンドで 変わる ところ（周期。1 は 変わらない） */
export interface RoundRule {
  shapeP: number;
  colorP: number;
  sizeP: number;
}

export const ROUND_RULES: RoundRule[] = [
  { shapeP: 2, colorP: 1, sizeP: 1 },
  { shapeP: 1, colorP: 2, sizeP: 1 },
  { shapeP: 3, colorP: 1, sizeP: 1 },
  { shapeP: 1, colorP: 3, sizeP: 1 },
  { shapeP: 2, colorP: 3, sizeP: 1 },
  { shapeP: 1, colorP: 2, sizeP: 3 },
  { shapeP: 3, colorP: 2, sizeP: 2 },
  { shapeP: 2, colorP: 3, sizeP: 3 },
];

export const ROUNDS = ROUND_RULES.length;

export interface Round {
  /** 見せる ならび（SHOWN 個） */
  items: Item[];
  /** 正解（つぎに 来るもの） */
  answer: Item;
  /** えらぶ 4つ（正解を ふくむ） */
  choices: Item[];
  /** 正解が 何番目か */
  correct: number;
  rule: RoundRule;
}

function pickDistinct(rng: () => number, count: number, max: number): number[] {
  const pool: number[] = [];
  for (let i = 0; i < max; i++) pool.push(i);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = pool[i]!;
    pool[i] = pool[j]!;
    pool[j] = t;
  }
  return pool.slice(0, count);
}

/** その属性の 列を作る（周期 p の くりかえし） */
function series(rng: () => number, p: number, max: number, len: number): number[] {
  const cyc = pickDistinct(rng, p, max);
  const out: number[] = [];
  for (let i = 0; i < len; i++) out.push(cyc[i % p]!);
  return out;
}

/**
 * その並びが「周期 p」で読めるか（p ごとに 同じ値か）
 */
function fitsPeriod(vals: number[], p: number): boolean {
  for (let i = p; i < vals.length; i++) if (vals[i] !== vals[i - p]) return false;
  return true;
}

/**
 * 1〜3の どの周期で 読んでも つぎの値が 同じか（＝答えが 1とおりに 決まるか）。
 * どの周期でも 読めない場合は false（そもそも きまりが 見えない）。
 */
export function nextIsUnique(vals: number[]): { ok: boolean; next: number } {
  let next = -1;
  let found = false;
  for (let p = 1; p <= 3; p++) {
    if (!fitsPeriod(vals, p)) continue;
    const v = vals[vals.length - p]!;
    if (!found) {
      next = v;
      found = true;
    } else if (v !== next) {
      return { ok: false, next: -1 };
    }
  }
  return { ok: found, next };
}

export function sameItem(a: Item, b: Item): boolean {
  return a.shape === b.shape && a.color === b.color && a.size === b.size;
}

/** 1もんを作る */
export function makeRound(rng: () => number, i: number): Round {
  const rule = ROUND_RULES[Math.min(i, ROUND_RULES.length - 1)]!;
  for (let attempt = 0; attempt < 200; attempt++) {
    const sh = series(rng, rule.shapeP, SHAPES, SHOWN + 1);
    const co = series(rng, rule.colorP, COLORS, SHOWN + 1);
    const si = series(rng, rule.sizeP, SIZES, SHOWN + 1);
    const items: Item[] = [];
    for (let k = 0; k < SHOWN; k++) items.push({ shape: sh[k]!, color: co[k]!, size: si[k]! });
    const answer: Item = { shape: sh[SHOWN]!, color: co[SHOWN]!, size: si[SHOWN]! };

    // 答えが 1とおりに 決まるか（属性ごとに 確かめる）
    const a = nextIsUnique(sh.slice(0, SHOWN));
    const b = nextIsUnique(co.slice(0, SHOWN));
    const c = nextIsUnique(si.slice(0, SHOWN));
    if (!a.ok || !b.ok || !c.ok) continue;
    if (a.next !== answer.shape || b.next !== answer.color || c.next !== answer.size) continue;
    // 直前と まったく 同じ＝考えなくても わかる、は さける
    if (sameItem(items[SHOWN - 1]!, answer)) continue;

    // まちがいの えらびを 3つ（かならず 正解と ちがう・おたがいにも ちがう）
    const choices: Item[] = [answer];
    for (let t = 0; t < 400 && choices.length < 4; t++) {
      const which = Math.floor(rng() * 3);
      const cand: Item = { ...answer };
      if (which === 0) cand.shape = (cand.shape + 1 + Math.floor(rng() * (SHAPES - 1))) % SHAPES;
      else if (which === 1) cand.color = (cand.color + 1 + Math.floor(rng() * (COLORS - 1))) % COLORS;
      else cand.size = (cand.size + 1 + Math.floor(rng() * (SIZES - 1))) % SIZES;
      if (choices.some((x) => sameItem(x, cand))) continue;
      choices.push(cand);
    }
    if (choices.length < 4) continue;
    // ならべかえ
    for (let k = choices.length - 1; k > 0; k--) {
      const j = Math.floor(rng() * (k + 1));
      const t = choices[k]!;
      choices[k] = choices[j]!;
      choices[j] = t;
    }
    const correct = choices.findIndex((x) => sameItem(x, answer));
    return { items, answer, choices, correct, rule };
  }
  // ここに来ることは まず無い（来ても 単純な形の くりかえしで 出す）
  const items: Item[] = [];
  for (let k = 0; k < SHOWN; k++) items.push({ shape: k % 2, color: 0, size: 1 });
  const answer: Item = { shape: SHOWN % 2, color: 0, size: 1 };
  const choices: Item[] = [
    answer,
    { shape: (SHOWN + 1) % 2, color: 0, size: 1 },
    { shape: 2, color: 0, size: 1 },
    { shape: 3, color: 0, size: 1 },
  ];
  return { items, answer, choices, correct: 0, rule };
}

export function makeRounds(rng: () => number): Round[] {
  const out: Round[] = [];
  for (let i = 0; i < ROUNDS; i++) out.push(makeRound(rng, i));
  return out;
}

/** せいかいの点 */
export function roundPoints(i: number): number {
  return 80 + i * 10;
}

/** ぜんもん せいかいの ボーナス */
export const ALL_BONUS = 150;

/** 満点 */
export function maxScore(): number {
  let s = ALL_BONUS;
  for (let i = 0; i < ROUNDS; i++) s += roundPoints(i) + QUICK_BONUS;
  return s;
}
