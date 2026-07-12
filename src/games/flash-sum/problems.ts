// =============================================================
// ピカッとたしざん（No.33）の出題ロジック（DOM非依存・乱数注入）
// =============================================================
// - 数字が1つずつ光って消える → 合計を4択で答える。ラウンドが進むと
//   「個数が増える・表示が速くなる」、むずかしさで「数が大きくなる」。
// - rng 注入＝「今日のゲーム」では全員同じ数列・同じ選択肢の並び。
// - import してよいのは game-api（types/helpers）と同一フォルダのみ（このファイルは依存なし）。

export type LevelKey = 'easy' | 'normal' | 'hard';

export const ROUNDS = 10; // 1プレイのラウンド数
export const GAP_MS = 180; // 数字と数字のあいだの暗転(ms)

interface LevelDef {
  /** ラウンド0の個数〜最大個数（2ラウンドごとに+1） */
  minCount: number;
  maxCount: number;
  /** ラウンド0の表示時間〜最終ラウンドの表示時間(ms・線形) */
  flashStart: number;
  flashEnd: number;
  /** ラウンド正解の加点ボーナス */
  bonus: number;
}

export const LEVELS: Record<LevelKey, LevelDef> = {
  easy: { minCount: 3, maxCount: 5, flashStart: 900, flashEnd: 700, bonus: 0 },
  normal: { minCount: 4, maxCount: 7, flashStart: 750, flashEnd: 550, bonus: 20 },
  hard: { minCount: 5, maxCount: 8, flashStart: 620, flashEnd: 430, bonus: 40 },
};

export const POINT_PER_NUM = 10; // 1つの数字ぶんの得点（正解時 count×これ）
export const STREAK_STEP = 10; // 連続正解ボーナス 10×min(streak-1,3)
export const STREAK_CAP = 3;

/** ラウンドの個数（2ラウンドごとに1個ふえる・上限つき） */
export function countFor(level: LevelKey, round: number): number {
  const d = LEVELS[level];
  return Math.min(d.maxCount, d.minCount + Math.floor(round / 2));
}

/** ラウンドの表示時間(ms・ラウンドで線形に短く) */
export function flashMsFor(level: LevelKey, round: number): number {
  const d = LEVELS[level];
  const t = Math.min(1, round / (ROUNDS - 1));
  return Math.round(d.flashStart + (d.flashEnd - d.flashStart) * t);
}

/** 1つの数字を引く（むずかしさで範囲が変わる） */
function rollNum(rng: () => number, level: LevelKey): number {
  if (level === 'easy') return 1 + Math.floor(rng() * 9); // 1〜9
  if (level === 'normal') {
    return rng() < 0.7 ? 1 + Math.floor(rng() * 9) : 10 + Math.floor(rng() * 10); // 1〜9 / 10〜19
  }
  return rng() < 0.5 ? 1 + Math.floor(rng() * 9) : 10 + Math.floor(rng() * 20); // 1〜9 / 10〜29
}

export interface Round {
  nums: number[];
  sum: number;
  /** 4択（正解を1つ含む・重複なし） */
  choices: number[];
  answerIdx: number;
}

/** 1ラウンドぶんの出題をつくる */
export function makeRound(rng: () => number, level: LevelKey, round: number): Round {
  const count = countFor(level, round);
  const nums: number[] = [];
  for (let i = 0; i < count; i++) nums.push(rollNum(rng, level));
  const sum = nums.reduce((a, b) => a + b, 0);

  // まぎらわしいダミー（±1/±2/±10/一の位ちがい）。重複と0以下は避ける
  const cands = new Set<number>();
  const tryAdd = (v: number): void => {
    if (v > 0 && v !== sum) cands.add(v);
  };
  while (cands.size < 3) {
    const r = rng();
    if (r < 0.3) tryAdd(sum + (rng() < 0.5 ? 1 : -1));
    else if (r < 0.55) tryAdd(sum + (rng() < 0.5 ? 2 : -2));
    else if (r < 0.8) tryAdd(sum + (rng() < 0.5 ? 10 : -10));
    else tryAdd(sum - (sum % 10) + Math.floor(rng() * 10)); // 一の位ちがい
  }
  const choices = [sum, ...cands];
  // Fisher–Yates（rng注入）
  for (let i = choices.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = choices[i]!;
    choices[i] = choices[j]!;
    choices[j] = t;
  }
  return { nums, sum, choices, answerIdx: choices.indexOf(sum) };
}
