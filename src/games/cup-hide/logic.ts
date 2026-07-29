// =============================================================
// どこに かくれた？（No.102・かくれゲーム）: 純ロジック（ラウンド生成・シャッフル）
// =============================================================
// - カップの下にボールを隠し、カップ同士を入れかえる。最後にどれか当てる。
// - 生成は rng 注入＝決定論。DOM 非依存。
// - むずかしさは「カップの数」と「入れかえの回数」だけで決まる（速さは一定＝目で追える）。
// =============================================================

export interface RoundSpec {
  /** カップの数 */
  cups: number;
  /** 入れかえる回数 */
  swaps: number;
}

/** 全8ラウンド。3カップ→4→5 と増え、入れかえも少しずつ増える（ふつうの難易度） */
export const ROUND_SPECS: RoundSpec[] = [
  { cups: 3, swaps: 3 },
  { cups: 3, swaps: 4 },
  { cups: 3, swaps: 5 },
  { cups: 4, swaps: 4 },
  { cups: 4, swaps: 5 },
  { cups: 4, swaps: 6 },
  { cups: 5, swaps: 5 },
  { cups: 5, swaps: 6 },
];

export const ROUNDS = ROUND_SPECS.length;

export interface Round {
  cups: number;
  /** 入れかえる2つの位置の列（順に適用する） */
  swaps: [number, number][];
  /** ボールを最初に置く位置 */
  startSlot: number;
}

/** ラウンドを作る（同じ組み合わせが続けて出ないよう、毎回2つの位置を選び直す） */
export function makeRound(rng: () => number, index: number): Round {
  const spec = ROUND_SPECS[Math.min(index, ROUND_SPECS.length - 1)]!;
  const n = spec.cups;
  const swaps: [number, number][] = [];
  let prev = -1;
  for (let i = 0; i < spec.swaps; i++) {
    let a = Math.floor(rng() * n);
    let b = Math.floor(rng() * (n - 1));
    if (b >= a) b++; // a とちがう位置にする
    // 直前とまったく同じ入れかえが続くと見た目が戻るだけなので避ける
    const key = Math.min(a, b) * 10 + Math.max(a, b);
    if (key === prev) {
      a = (a + 1) % n;
      b = (b + 1) % n;
      if (a === b) b = (b + 1) % n;
    }
    prev = Math.min(a, b) * 10 + Math.max(a, b);
    swaps.push([a, b]);
  }
  return { cups: n, swaps, startSlot: Math.floor(rng() * n) };
}

/** 入れかえを全部適用したあと、ボールがある位置を返す（純関数＝答え合わせの正） */
export function finalSlot(round: Round): number {
  let at = round.startSlot;
  for (const [a, b] of round.swaps) {
    if (at === a) at = b;
    else if (at === b) at = a;
  }
  return at;
}

/** 1ラウンドの得点（カップが多いほど・入れかえが多いほど高い） */
export function roundScore(round: Round): number {
  return 100 + (round.cups - 3) * 30 + round.swaps.length * 10;
}
