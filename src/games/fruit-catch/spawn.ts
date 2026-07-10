// =============================================================
// フルーツキャッチ（No.9）の落下スケジュール（DOM非依存・乱数注入）
// =============================================================
// - rollSpawn: 1個ぶんの落下物（種類・横位置・果物の絵）を作る。すべて注入 rng 由来なので、
//   「今日のゲーム」では全員まったく同じ配置・同じ順番で落ちてくる（＝スコア競争が公平）。
// - むずかしさ（落下間隔・速度）はゲーム側が経過時間から決める＝これも全員共通の決定論。
// - import してよいのは game-api（types/helpers）と同一フォルダのみ（このファイルは依存なし）。

export type ItemKind = 'fruit' | 'bomb' | 'golden';

/** 果物の絵（種類は見た目だけ。得点はどれも同じ） */
export const FRUITS = ['🍎', '🍊', '🍇', '🍓', '🍌', '🍉', '🍑', '🥝'];

export interface Spawn {
  kind: ItemKind;
  /** 横位置 0〜1（0=左端 / 1=右端） */
  xFrac: number;
  /** kind==='fruit' のときの FRUITS インデックス */
  fruit: number;
}

/**
 * レベルに応じて 1個ぶんの落下物をつくる。
 * ばくだん率はレベルで上がる（12%→最大32%）。ゴールデンは一定5%。
 * rng は「xFrac → fruit → 種類判定」の順で必ず3回消費する（種類が何でも消費数を一定に保ち、
 * どの端末でも rng 列がずれない＝日替わりの完全一致を守るため）。
 */
export function rollSpawn(rng: () => number, level: number): Spawn {
  const xFrac = rng();
  const fruit = Math.floor(rng() * FRUITS.length);
  const r = rng();
  const goldenP = 0.05;
  const bombP = Math.min(0.12 + level * 0.02, 0.32);
  let kind: ItemKind = 'fruit';
  if (r < goldenP) kind = 'golden';
  else if (r < goldenP + bombP) kind = 'bomb';
  return { kind, xFrac, fruit };
}
