// =============================================================
// えもじヒットアンドブロー（No.5）の純ロジック（DOM非依存・テスト容易）
// =============================================================
// - あんごう(secret)＝パレット絵文字のインデックス配列。
//   テーマ（くだもの/どうぶつ…＝見た目の皮）は game.ts 側でインデックスに対応付ける。
//   → テーマを変えても「同じインデックス列」なら論理パズルは同一（今日のゲーム＝全員同じ）。
// - 乱数は呼び出し側から rng を注入する（ctx.random）。Math.random は使わない。
// - import してよいのは game-api の型のみ（このファイルは型にも依存しない純関数）。
// =============================================================

export interface Feedback {
  /** 絵も場所も合っている数（Hit＝ズバリ） */
  hits: number;
  /** 絵はあるが場所がちがう数（Blow＝おしい） */
  blows: number;
}

/**
 * あんごう(secret)に対する推理(guess)を採点する。
 * かぶり（同じ記号が複数）があっても正しく数える標準アルゴリズム：
 *   1) まず同じ位置＝ヒットを数え、非ヒット位置の記号だけを残す
 *   2) 残った secret 記号の在庫に対して、残った guess 記号を1つずつ消し込む＝ブロー
 */
export function evaluate(secret: readonly number[], guess: readonly number[]): Feedback {
  const n = secret.length;
  let hits = 0;
  const restCount = new Map<number, number>(); // 非ヒット位置の secret 記号の残数
  const leftover: number[] = []; // 非ヒット位置の guess 記号
  for (let i = 0; i < n; i++) {
    const s = secret[i] ?? -1;
    const gv = guess[i] ?? -2; // 欠損時に誤って一致しない番兵
    if (s === gv) {
      hits++;
    } else {
      restCount.set(s, (restCount.get(s) ?? 0) + 1);
      leftover.push(gv);
    }
  }
  let blows = 0;
  for (const gv of leftover) {
    const c = restCount.get(gv) ?? 0;
    if (c > 0) {
      blows++;
      restCount.set(gv, c - 1);
    }
  }
  return { hits, blows };
}

/**
 * あんごうを作る。
 * @param len         あんごうの長さ（わく数）
 * @param paletteSize 記号の種類数（絵文字の数）
 * @param allowDup    同じ記号の重複を許すか
 * @param rng         0〜1 の乱数（ctx.random）
 */
export function generateSecret(
  len: number,
  paletteSize: number,
  allowDup: boolean,
  rng: () => number,
): number[] {
  if (allowDup) {
    const out: number[] = [];
    for (let i = 0; i < len; i++) out.push(Math.floor(rng() * paletteSize));
    return out;
  }
  // 重複なし：0..paletteSize-1 を部分 Fisher–Yates シャッフルして先頭 len 個
  const pool: number[] = [];
  for (let i = 0; i < paletteSize; i++) pool.push(i);
  const k = Math.min(len, paletteSize);
  for (let i = 0; i < k; i++) {
    const j = i + Math.floor(rng() * (paletteSize - i));
    const a = pool[i] ?? 0;
    const b = pool[j] ?? 0;
    pool[i] = b;
    pool[j] = a;
  }
  return pool.slice(0, len);
}
