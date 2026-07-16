// =============================================================
// ぴょんぴょんなわとび（No.49）の回転と得点（DOM非依存・純ロジック）
// =============================================================
// - なわは phase（0〜1）で回る。phase=0 が「足もとを通るしゅんかん」。
//   そのときジャンプ中でなければ つまずき。とぶたびに回転が少しずつはやくなる。
// - 乱数は使わない（純粋なリズムのランプ＝毎回同じ試技）。
// - import してよいのは game-api（types/helpers）と同一フォルダのみ（このファイルは依存なし）。

/** ジャンプの滞空時間（ms） */
export const JUMP_MS = 400;
/** つまずいたあと なわが止まる時間（ms） */
export const STUN_MS = 1000;
/** つまずける回数（3回で終了） */
export const MISSES_MAX = 3;
/** スコア: 1回とぶごとに 10 + コンボ2×min(n-1,5)（さいだい+10） */
export const JUMP_PTS = 10;

/**
 * 判定（足もと通過）の何ms前から「足もとが光る」か。
 * JUMP_MS(400) より短くしてあるので、光っている間にタップすれば必ず滞空中に判定が来る
 * （＝「ひかったら タップ」で絶対に成功する、子ども向けの保証つき合図）。
 */
export const GLOW_LEAD_MS = 380;

/** n回とんだあとの なわの周期（ms）: 1400 → 750 */
export function periodAt(jumps: number): number {
  return Math.max(750, 1400 - jumps * 9);
}

/** 1回とんだときの得点（combo=この1回を含めた連続成功数） */
export function jumpPoints(combo: number): number {
  return JUMP_PTS + 2 * Math.min(combo - 1, 5);
}

// ---- なわの見た目（描画とゲーム判定を一致させるための正規化係数） ----
// phase は 0〜1（0=足もとを通る判定の瞬間 / 0.5=てっぺん）。
// 過去に描画式の符号が判定と半回転ズレるバグがあったため、
// 「高さ」「前後」の係数をここに一元化し、符号をテストで固定できるようにする。

/** なわの高さ係数: +1=足もと（判定の瞬間・いちばん低い）/ -1=てっぺん（頭上） */
export function ropeHeightK(phase: number): number {
  return Math.cos(phase * Math.PI * 2);
}

/**
 * なわの前後係数: 負=まえ半分（てっぺんから足もとへ おりてくる側＝判定直前に見える側）/
 * 正=うしろ半分（足もとを通ったあと のぼっていく側）
 */
export function ropeDepthK(phase: number): number {
  return Math.sin(phase * Math.PI * 2);
}
