// =============================================================
// ふたつ まえ（No.107・かくれゲーム）: 純ロジック（出題の列）
// =============================================================
// - どうぶつの顔が1枚ずつ流れてくる。「n つ前と同じ」ならタップ。
// - n は 1 → 2 → 3 と上がる。3つ前は 大人でもかなり難しい（＝高難度のねらい）。
// - 一致の数はパートごとに固定＝完璧に答えたときの点がいつも同じ（メダルが公平）。
// - 一致は「ちょうど n つ前」だけに起きるよう作る（うっかり一致が混ざると答えが2通りになる）。
// - DOM 非依存・rng 注入＝決定論。
// =============================================================

/** 出てくる顔（見分けやすい6種） */
export const FACES = ['🐶', '🐱', '🐰', '🐼', '🦊', '🐸'];

export interface Phase {
  /** いくつ前と くらべるか */
  n: number;
  /** この パートの まい数 */
  cards: number;
  /** この パートに しこむ 一致の数 */
  matches: number;
}

/** 前半は肩ならし、後半で一気に難しくなる */
export const PHASES: Phase[] = [
  { n: 1, cards: 8, matches: 3 },
  { n: 2, cards: 18, matches: 6 },
  { n: 3, cards: 12, matches: 4 },
];

export interface Card {
  /** 顔の番号（FACES の index） */
  face: number;
  /** n つ前と同じか（＝タップが正解か） */
  match: boolean;
}

/** 当たり1回の点（前をたくさん覚えるほど高い） */
export function hitPoints(n: number): number {
  return 20 + n * 20;
}

/** おてつき1回の減点 */
export const FALSE_PENALTY = 20;
/** パートを 完璧に こなしたときの ボーナス */
export const PHASE_BONUS = 100;

/** 完璧に答えたときの満点（メダル較正用） */
export function maxScore(): number {
  return PHASES.reduce((a, p) => a + p.matches * hitPoints(p.n) + PHASE_BONUS, 0);
}

function pick(rng: () => number, max: number): number {
  return Math.floor(rng() * max);
}

/**
 * 1パートぶんの列を作る。
 * - はじめの n まいは くらべる相手がいないので 一致にしない。
 * - 一致にしない札は「n つ前とちがう顔」から選ぶ＝うっかり一致は起きない。
 */
export function makePhase(rng: () => number, phase: Phase): Card[] {
  const { n, cards, matches } = phase;
  // 一致の位置をえらぶ（n 以降から重複なしで）
  const pool: number[] = [];
  for (let i = n; i < cards; i++) pool.push(i);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = pick(rng, i + 1);
    const t = pool[i]!;
    pool[i] = pool[j]!;
    pool[j] = t;
  }
  const hit = new Set(pool.slice(0, Math.min(matches, pool.length)));

  const out: Card[] = [];
  for (let i = 0; i < cards; i++) {
    if (i >= n && hit.has(i)) {
      out.push({ face: out[i - n]!.face, match: true });
    } else if (i >= n) {
      const ban = out[i - n]!.face;
      let f = pick(rng, FACES.length - 1);
      if (f >= ban) f++; // ban を のぞいた中から えらぶ
      out.push({ face: f, match: false });
    } else {
      out.push({ face: pick(rng, FACES.length), match: false });
    }
  }
  return out;
}

/** 1プレイぶん（全パート） */
export function makeStream(rng: () => number): Card[][] {
  return PHASES.map((p) => makePhase(rng, p));
}

/** 検証用: 実際に「n つ前と同じ」かを数え直す */
export function realMatches(cards: Card[], n: number): number[] {
  const out: number[] = [];
  for (let i = n; i < cards.length; i++) {
    if (cards[i]!.face === cards[i - n]!.face) out.push(i);
  }
  return out;
}
