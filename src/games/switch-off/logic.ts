// =============================================================
// ぜんけしスイッチ（No.45）の盤面生成と最短解ソルバ（DOM非依存・純ロジック）
// =============================================================
// - おすと「そのマス＋上下左右（十字）」の明かりが反転する定番の反転パズル。
// - 生成は「全消灯からランダムに K マスおす」＝必ず解ける（解＝おした集合そのもの）。
// - 最短手数（par）は chase-light 法で厳密に計算する:
//   1行目のおし方 2^n 通りを総当たり → 2行目以降は「上の行の点灯を消す」一手に確定
//   → 任意の解は1行目で一意に決まるため、これで全解を尽くし最小を得る。
// - 乱数は注入（ctx.random）。1盤面の消費は K 回固定（部分Fisher-Yates）＝日替わり同一。
// - import してよいのは game-api（types/helpers）と同一フォルダのみ（このファイルは依存なし）。

export type Rng = () => number;

/** 3問構成: 4×4(6押し) → 5×5(8押し) → 5×5(12押し) */
export const ROUNDS: { n: number; k: number }[] = [
  { n: 4, k: 6 },
  { n: 5, k: 8 },
  { n: 5, k: 12 },
];

/** i をおす（i と上下左右を反転） */
export function pressAt(bits: boolean[], n: number, i: number): void {
  const x = i % n;
  const y = (i / n) | 0;
  const flip = (j: number): void => {
    bits[j] = !bits[j];
  };
  flip(i);
  if (x > 0) flip(i - 1);
  if (x < n - 1) flip(i + 1);
  if (y > 0) flip(i - n);
  if (y < n - 1) flip(i + n);
}

export function isAllOff(bits: boolean[]): boolean {
  return bits.every((b) => !b);
}

export interface Solution {
  /** おすマスの集合（最短解のひとつ） */
  presses: number[];
  /** 最短手数（par） */
  count: number;
}

/** chase-light 法による最短解（n≤5 前提・2^n 通りの1行目を総当たり） */
export function solveMin(bits: boolean[], n: number): Solution | null {
  let best: Solution | null = null;
  for (let mask = 0; mask < 1 << n; mask++) {
    const sim = bits.slice();
    const presses: number[] = [];
    for (let x = 0; x < n; x++) {
      if (mask & (1 << x)) {
        pressAt(sim, n, x);
        presses.push(x);
      }
    }
    for (let y = 1; y < n; y++) {
      for (let x = 0; x < n; x++) {
        if (sim[(y - 1) * n + x]) {
          pressAt(sim, n, y * n + x);
          presses.push(y * n + x);
        }
      }
    }
    if (isAllOff(sim) && (best === null || presses.length < best.count)) {
      best = { presses, count: presses.length };
    }
  }
  return best;
}

export interface SwitchPuzzle {
  n: number;
  /** 初期盤面（true=点灯） */
  bits: boolean[];
  /** 最短手数（さいたん） */
  par: number;
}

/**
 * 盤面生成: 全消灯から「重複なしの K マス」をおす（部分Fisher-Yates・乱数消費 K 回固定）。
 * 万一 全消灯になったら（5×5の静穏パターンと偶然一致・天文学的低確率）マス0をおして回避。
 */
export function generatePuzzle(rng: Rng, n: number, k: number): SwitchPuzzle {
  const cells = Array.from({ length: n * n }, (_, i) => i);
  for (let i = 0; i < k; i++) {
    const j = i + Math.min(n * n - 1 - i, Math.floor(rng() * (n * n - i)));
    const t = cells[i]!;
    cells[i] = cells[j]!;
    cells[j] = t;
  }
  const bits = new Array<boolean>(n * n).fill(false);
  for (let i = 0; i < k; i++) pressAt(bits, n, cells[i]!);
  if (isAllOff(bits)) pressAt(bits, n, 0);
  const sol = solveMin(bits, n);
  return { n, bits, par: sol ? sol.count : k };
}

/** ラウンド得点: 120 + 最短ボーナス + はやさ max(0,120-秒) */
export function roundScore(moves: number, par: number, sec: number): number {
  const parBonus = moves <= par ? 100 : Math.max(0, 100 - (moves - par) * 12);
  return 120 + parBonus + Math.max(0, 120 - sec);
}
