// =============================================================
// ひとつだけ うそ（No.128・かくれゲーム）: 純ロジック（ヒント・唯一解の保証）
// =============================================================
// - はこが n こ。たからは 1つ。ヒントが 4つ あって、**そのうち 1つだけが うそ**。
// - こたえの 決め方: 「その はこに たからが あると したとき、うそに なる ヒントの数」が
//   ちょうど 1 に なる はこ。**それが 1つだけに なる 出題**しか 通さない
//   ＝答えは かならず 1つに 決まる（＝理不尽さゼロ）。
// - #72 てんびん推理は「はかって くらべる」。こちらは「言っている ことの 矛盾」を つく。
// - DOM 非依存・rng 注入＝決定論。
// =============================================================

export type Stmt =
  | { kind: 'gt'; k: number }
  | { kind: 'lt'; k: number }
  | { kind: 'eq'; k: number }
  | { kind: 'ne'; k: number }
  | { kind: 'even' }
  | { kind: 'odd' }
  | { kind: 'edge' }
  | { kind: 'inner' };

/** そのヒントは「たからが idx にある」として 正しいか */
export function holds(s: Stmt, idx: number, n: number): boolean {
  switch (s.kind) {
    case 'gt':
      return idx > s.k;
    case 'lt':
      return idx < s.k;
    case 'eq':
      return idx === s.k;
    case 'ne':
      return idx !== s.k;
    case 'even':
      return (idx + 1) % 2 === 0;
    case 'odd':
      return (idx + 1) % 2 === 1;
    case 'edge':
      return idx === 0 || idx === n - 1;
    case 'inner':
      return idx !== 0 && idx !== n - 1;
  }
}

/** ヒントの 文 */
export function stmtText(s: Stmt): string {
  switch (s.kind) {
    case 'gt':
      return `たからは ${s.k + 1}ばんめより 右に ある`;
    case 'lt':
      return `たからは ${s.k + 1}ばんめより 左に ある`;
    case 'eq':
      return `たからは ${s.k + 1}ばんめに ある`;
    case 'ne':
      return `たからは ${s.k + 1}ばんめには ない`;
    case 'even':
      return 'たからの ばんごうは ぐうすう';
    case 'odd':
      return 'たからの ばんごうは きすう';
    case 'edge':
      return 'たからは はしっこ（1ばんめ か さいご）に ある';
    case 'inner':
      return 'たからは はしっこ では ない';
  }
}

/** 1もんの ヒントの数 */
export const HINTS = 4;
/** 1もんの もちじかん（ミリ秒） */
export const ROUND_MS = 30000;
/** これより はやいと ボーナス */
export const QUICK_MS = 10000;
export const QUICK_BONUS = 25;

/** ラウンドごとの はこの数 */
export const BOXES = [4, 5, 5, 6, 6, 6];
export const ROUNDS = BOXES.length;

export interface Round {
  n: number;
  stmts: Stmt[];
  /** たからの ばしょ */
  answer: number;
  /** うそを 言っている ヒントの ばんごう */
  liar: number;
}

function pick(rng: () => number, n: number): number {
  return Math.floor(rng() * n);
}

/** その はこに たからが あると したときに うそに なる ヒントの数 */
export function lieCount(stmts: Stmt[], idx: number, n: number): number {
  let c = 0;
  for (const s of stmts) if (!holds(s, idx, n)) c++;
  return c;
}

/** 「うそが ちょうど1つ」で こたえが 1つに 決まるか */
export function isWellPosed(stmts: Stmt[], n: number): { ok: boolean; answer: number } {
  let found = -1;
  for (let c = 0; c < n; c++) {
    if (lieCount(stmts, c, n) === 1) {
      if (found >= 0) return { ok: false, answer: -1 };
      found = c;
    }
  }
  return { ok: found >= 0, answer: found };
}

function randStmt(rng: () => number, n: number): Stmt {
  const t = pick(rng, 8);
  if (t === 0) return { kind: 'gt', k: pick(rng, n - 1) };
  if (t === 1) return { kind: 'lt', k: 1 + pick(rng, n - 1) };
  if (t === 2) return { kind: 'eq', k: pick(rng, n) };
  if (t === 3) return { kind: 'ne', k: pick(rng, n) };
  if (t === 4) return { kind: 'even' };
  if (t === 5) return { kind: 'odd' };
  if (t === 6) return { kind: 'edge' };
  return { kind: 'inner' };
}

const keyOf = (s: Stmt): string => ('k' in s ? `${s.kind}${s.k}` : s.kind);

/**
 * 1もんを作る。ヒントを ためして「うそ1つで こたえが 1つに 決まる」ものだけ 通す。
 */
export function makeRound(rng: () => number, n: number): Round {
  for (let attempt = 0; attempt < 4000; attempt++) {
    const stmts: Stmt[] = [];
    const used = new Set<string>();
    for (let i = 0; i < HINTS; i++) {
      for (let t = 0; t < 40; t++) {
        const s = randStmt(rng, n);
        const k = keyOf(s);
        if (used.has(k)) continue;
        used.add(k);
        stmts.push(s);
        break;
      }
    }
    if (stmts.length < HINTS) continue;
    const { ok, answer } = isWellPosed(stmts, n);
    if (!ok) continue;
    const liar = stmts.findIndex((s) => !holds(s, answer, n));
    if (liar < 0) continue;
    return { n, stmts, answer, liar };
  }
  // ここに来ることは まず無い（来ても はっきり わかる 出題を 返す）
  const stmts: Stmt[] = [{ kind: 'eq', k: 0 }, { kind: 'eq', k: 1 }, { kind: 'ne', k: 2 }, { kind: 'ne', k: 3 }];
  const { answer } = isWellPosed(stmts, n);
  return { n, stmts, answer: Math.max(0, answer), liar: 0 };
}

export function makeRounds(rng: () => number): Round[] {
  return BOXES.map((n) => makeRound(rng, n));
}

/** せいかいの点 */
export function roundPoints(round: number): number {
  return 100 + round * 15;
}

/** ぜんもん せいかいの ボーナス */
export const ALL_BONUS = 175;

/** 満点 */
export function maxScore(): number {
  let s = ALL_BONUS;
  for (let i = 0; i < ROUNDS; i++) s += roundPoints(i) + QUICK_BONUS;
  return s;
}
