// =============================================================
// ルールが ふえる（No.125・かくれゲーム）: 純ロジック（ルール・出題・正解数）
// =============================================================
// - ラウンドごとに **ルールが 1つ ずつ 積み重なる**。さいごは 5つ 同時。
//   ルールは いつも 画面に 出ているので「覚えゲー」ではなく「さばく」遊び。
// - #26 いろよみチャレンジ は ルールが 1つ（文字と色）。こちらは ルールが ふえる。
// - 1つの 品に 何回 タップすべきかは 純関数で 決まる（needTaps）＝判定が ぶれない。
// - DOM 非依存・rng 注入＝決定論。
// =============================================================

export const SHAPES = 2; // 0=まる 1=四角
export const COLORS = 4; // 0=あか 1=あお 2=きいろ 3=みどり
export const SIZES = 2; // 0=大きい 1=小さい
export const FRAMES = 2; // 0=ふつう 1=点線

export const COLOR_NAMES = ['あか', 'あお', 'きいろ', 'みどり'];

export interface Item {
  shape: number;
  color: number;
  size: number;
  frame: number;
}

/** ルールの 文（ラウンドごとに 1つ ふえる） */
export const RULES = [
  'まるを タップ（四角は しない）',
  'あおは タップしない',
  '小さいものは 2回 タップ',
  '点線の わくは タップしない',
  '四角でも きいろなら タップ',
];

/** 1ラウンドの 品数 */
export const PER_ROUND = 6;
/** ラウンド数（ルール1つ→5つ、さいごは 5つのまま はやくなる） */
export const ROUNDS = 6;

/** そのラウンドで 使う ルールの数 */
export function ruleCount(round: number): number {
  return Math.min(RULES.length, round + 1);
}

/** 1つの 品を 見せる 時間（ミリ秒） */
export const ITEM_MS = [1700, 1600, 1500, 1400, 1300, 1150];

/** せいかい1つの 点 */
export const HIT_PTS = 20;
/** ラウンドを ノーミスで こなした ボーナス */
export const ROUND_BONUS = 60;

/**
 * その品に 何回 タップすべきか（0/1/2）。
 * ルールは 上から 順に 適用し、あとの ルールが 前を 上書きする ところは
 * 文どおり「四角でも きいろなら タップ」だけ。
 */
export function needTaps(it: Item, rules: number): number {
  // まるなら タップ（ルール1）
  let target = it.shape === 0;
  // ルール5: 四角でも きいろなら タップ
  if (rules >= 5 && it.shape === 1 && it.color === 2) target = true;
  // ルール2: あおは タップしない
  if (rules >= 2 && it.color === 1) target = false;
  // ルール4: 点線は タップしない
  if (rules >= 4 && it.frame === 1) target = false;
  if (!target) return 0;
  // ルール3: 小さいものは 2回
  if (rules >= 3 && it.size === 1) return 2;
  return 1;
}

function pick(rng: () => number, n: number): number {
  return Math.floor(rng() * n);
}

function randItem(rng: () => number, rules: number): Item {
  return {
    shape: pick(rng, SHAPES),
    color: pick(rng, COLORS),
    size: rules >= 3 ? pick(rng, SIZES) : 0,
    frame: rules >= 4 ? pick(rng, FRAMES) : 0,
  };
}

/**
 * 1ラウンドぶんの 品を作る。
 * 「タップする品」と「しない品」が どちらも 2つ以上、
 * ルール3が あるときは「2回 タップ」も 1つ以上 入るようにする
 * ＝そのラウンドの ルールが ちゃんと 出番を 持つ。
 */
export function makeRound(rng: () => number, round: number): Item[] {
  const rules = ruleCount(round);
  for (let attempt = 0; attempt < 300; attempt++) {
    const items: Item[] = [];
    for (let i = 0; i < PER_ROUND; i++) items.push(randItem(rng, rules));
    const needs = items.map((it) => needTaps(it, rules));
    const zero = needs.filter((n) => n === 0).length;
    const one = needs.filter((n) => n === 1).length;
    const two = needs.filter((n) => n === 2).length;
    if (zero < 2 || one + two < 2) continue;
    if (rules >= 3 && two < 1) continue;
    return items;
  }
  // ここに来ることは まず無い
  const items: Item[] = [];
  for (let i = 0; i < PER_ROUND; i++) items.push(randItem(rng, rules));
  return items;
}

export function makeRounds(rng: () => number): Item[][] {
  const out: Item[][] = [];
  for (let r = 0; r < ROUNDS; r++) out.push(makeRound(rng, r));
  return out;
}

/** 満点 */
export function maxScore(): number {
  return ROUNDS * PER_ROUND * HIT_PTS + ROUNDS * ROUND_BONUS;
}
