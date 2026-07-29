// =============================================================
// かたむき きんこ（No.113・かくれゲーム）: 純ロジック（ダイヤル・出題）
// =============================================================
// - かたむきを「動かす力」ではなく **ダイヤルの値そのもの** として使う。
//   （既存の傾け系7本は すべて「玉やコップを動かす力」として使っている）
// - 目もりに 合わせて じっと止めると 1つ確定。ぶれたら やり直し。
// - DOM 非依存・rng 注入＝決定論。
// =============================================================

/** 目もりの数（0 〜 MARKS-1） */
export const MARKS = 8;
/** ダイヤルの ふれはば（度）。かたむき -1〜+1 が -MAX_ANGLE〜+MAX_ANGLE に なる */
export const MAX_ANGLE = 140;
/** 目もりと 目もりの あいだ（度） */
export const MARK_STEP = (MAX_ANGLE * 2) / (MARKS - 1);

export interface SafeSpec {
  /** あんしょうばんの けた数 */
  len: number;
  /** 合っていると みなす はば（目もり間かくに対する わりあい） */
  tolFrac: number;
  /** 何ミリ秒 じっとしていれば 確定か */
  holdMs: number;
}

export const SAFES: SafeSpec[] = [
  { len: 3, tolFrac: 0.4, holdMs: 700 },
  { len: 3, tolFrac: 0.34, holdMs: 750 },
  { len: 4, tolFrac: 0.28, holdMs: 800 },
  { len: 5, tolFrac: 0.24, holdMs: 850 },
];

export const SAFE_COUNT = SAFES.length;

/** その目もりの 角度（度） */
export function markAngle(v: number): number {
  return -MAX_ANGLE + (v / (MARKS - 1)) * MAX_ANGLE * 2;
}

/** かたむき（-1〜1）から ダイヤルの角度（度） */
export function angleOf(tiltX: number): number {
  const t = Math.max(-1, Math.min(1, tiltX));
  return t * MAX_ANGLE;
}

/** 合っていると みなす はば（度） */
export function tolDeg(spec: SafeSpec): number {
  return MARK_STEP * spec.tolFrac;
}

/** いま その目もりに 合っているか */
export function onMark(spec: SafeSpec, angleDeg: number, mark: number): boolean {
  return Math.abs(angleDeg - markAngle(mark)) <= tolDeg(spec);
}

/** いちばん近い目もり（合っていなくても 近いものを返す＝表示用） */
export function nearestMark(angleDeg: number): number {
  let best = 0;
  let bd = Infinity;
  for (let v = 0; v < MARKS; v++) {
    const d = Math.abs(angleDeg - markAngle(v));
    if (d < bd) {
      bd = d;
      best = v;
    }
  }
  return best;
}

/**
 * あんしょうばんを作る。
 * - 同じ数字が つづかない（つづくと「もう合っている」状態から 動かさずに 2つ入ってしまう）
 * - となりの目もり どうしにも しない（＝すこしは 動かす必要がある）
 */
export function makeCode(rng: () => number, len: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < len; i++) {
    const cands: number[] = [];
    for (let v = 0; v < MARKS; v++) {
      const prev = out[i - 1];
      if (prev !== undefined && Math.abs(v - prev) < 2) continue;
      cands.push(v);
    }
    out.push(cands[Math.floor(rng() * cands.length)]!);
  }
  return out;
}

/** 1プレイぶんの あんしょうばん */
export function makeCodes(rng: () => number): number[][] {
  return SAFES.map((s) => makeCode(rng, s.len));
}

/** 金庫1つぶんの点（はやく あけるほど 高い） */
export function safeScore(len: number, usedMs: number): number {
  const speed = Math.max(0, 80 - Math.floor(usedMs / 1000) * 4);
  return 80 + len * 40 + speed;
}

/** 満点（ぜんぶ 0びょうで あけたとき） */
export function maxScore(): number {
  return SAFES.reduce((a, s) => a + safeScore(s.len, 0), 0);
}

/** はやわざ の 実績になる 時間（ミリ秒） */
export const SPEEDY_MS = 15000;
