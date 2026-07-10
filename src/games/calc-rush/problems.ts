// =============================================================
// けいさんラッシュ（No.8）の問題生成（DOM非依存・乱数注入）
// =============================================================
// - makeProblem: むずかしさに応じた計算問題を1問つくる。
//   choices は正解1つ＋まぎらわしい誤答3つ（重複なし・0以上）をシャッフル済み。
//   すべて注入 rng 由来＝「今日のゲーム」では全員同じ問題列・同じ選択肢配置になる。
// - import してよいのは game-api（types/helpers）と同一フォルダのみ（このファイルは依存なし）。

export type PresetKey = 'add1' | 'addsub' | 'mult' | 'mix';

export interface Problem {
  /** 表示用の式（例: '7 + 5'。'= ?' はゲーム側で付ける） */
  text: string;
  answer: number;
  /** 4択（answer を必ず1つ含む・重複なし・0以上・シャッフル済み） */
  choices: number[];
}

/** min〜max の整数（両端を含む） */
function rint(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

function shuffle(arr: number[], rng: () => number): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const a = arr[i];
    const b = arr[j];
    if (a !== undefined && b !== undefined) {
      arr[i] = b;
      arr[j] = a;
    }
  }
}

/**
 * 式と正解と、演算固有の「まぎらわしい誤答」候補を作る。
 * - add1: 1桁のたしざん
 * - addsub: 1桁のたしざん・ひきざん（答えは0以上）
 * - mult: 九九（1×1〜9×9）
 * - mix: 2桁のたしざん・ひきざん / 九九 / わりざん（九九の逆＝必ず割り切れる）
 */
function rawProblem(preset: PresetKey, rng: () => number): { text: string; answer: number; near: number[] } {
  if (preset === 'add1') {
    const a = rint(rng, 1, 9);
    const b = rint(rng, 1, 9);
    return { text: `${a} + ${b}`, answer: a + b, near: [] };
  }
  if (preset === 'addsub') {
    const a = rint(rng, 1, 9);
    const b = rint(rng, 1, 9);
    if (rng() < 0.5) return { text: `${a} + ${b}`, answer: a + b, near: [] };
    const hi = Math.max(a, b);
    const lo = Math.min(a, b);
    return { text: `${hi} − ${lo}`, answer: hi - lo, near: [] };
  }
  if (preset === 'mult') {
    const a = rint(rng, 1, 9);
    const b = rint(rng, 1, 9);
    // 誤答は「隣の段・隣の数」の積＝九九の定番のまちがい
    return { text: `${a} × ${b}`, answer: a * b, near: [a * (b + 1), a * (b - 1), (a + 1) * b, (a - 1) * b] };
  }
  // mix（むずかしい）
  const r = rng();
  if (r < 0.3) {
    const a = rint(rng, 10, 59);
    const b = rint(rng, 10, 39);
    return { text: `${a} + ${b}`, answer: a + b, near: [] };
  }
  if (r < 0.6) {
    const a = rint(rng, 20, 99);
    const b = rint(rng, 10, a - 1);
    return { text: `${a} − ${b}`, answer: a - b, near: [] };
  }
  if (r < 0.8) {
    const a = rint(rng, 2, 9);
    const b = rint(rng, 2, 9);
    return { text: `${a} × ${b}`, answer: a * b, near: [a * (b + 1), a * (b - 1), (a + 1) * b, (a - 1) * b] };
  }
  const b = rint(rng, 2, 9);
  const q = rint(rng, 2, 9);
  return { text: `${b * q} ÷ ${b}`, answer: q, near: [] };
}

/** 計算問題を1問つくる（正解＋まぎらわしい誤答3つの4択つき） */
export function makeProblem(preset: PresetKey, rng: () => number): Problem {
  const { text, answer, near } = rawProblem(preset, rng);
  // 誤答候補: 演算固有の近い値 ＋ 定番のまちがい（±1/±2/±10/十の位と一の位の入れ替え）
  const pool: number[] = [...near, answer + 1, answer - 1, answer + 2, answer - 2, answer + 10, answer - 10];
  if (answer >= 10) pool.push((answer % 10) * 10 + Math.floor(answer / 10));
  const uniq: number[] = [];
  for (const v of pool) {
    if (!Number.isInteger(v) || v < 0 || v === answer) continue;
    if (!uniq.includes(v)) uniq.push(v);
  }
  shuffle(uniq, rng);
  const wrongs = uniq.slice(0, 3);
  // 保険（answer=0 付近などで候補が3つに満たないとき）
  let fill = answer + 3;
  while (wrongs.length < 3) {
    if (fill !== answer && !wrongs.includes(fill)) wrongs.push(fill);
    fill++;
  }
  const choices = [answer, ...wrongs];
  shuffle(choices, rng);
  return { text, answer, choices };
}
