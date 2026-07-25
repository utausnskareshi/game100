// =============================================================
// トントンきこり（No.94）: 純ロジック（決定論・rng注入・テスト対象）
// =============================================================
// - 丸太のスタックを下から切る。切るたびスタックが1つ落ちてくる。
//   落ちてきた丸太の枝が「自分のいる側」だと ぶつかる＝おしまい。
// - 枝は1本の丸太に最大1つ（左 or 右 or なし）＝必ず安全な側があるので理不尽死はない。
// - 丸太の枝は rng を「枝あり?→左右」の固定順で毎回2回引く＝完全決定論（日替わり共通）。
// - エネルギーゲージは ctx.now ベースで減り、切ると回復。切りつづけないと じかんぎれ。
// =============================================================

export const W = 360;
export const H = 640;

export const BR_NONE = 0;
export const BR_LEFT = 1;
export const BR_RIGHT = 2;

/** 画面に見える丸太の数 */
export const VISIBLE = 7;
/** 最初の SAFE_START 本は枝なし（開幕即死を防ぐ） */
export const SAFE_START = 2;

export const START_ENERGY = 0.62;
export const CHOP_GAIN = 0.135;

/**
 * 枝が出る確率（切った本数が増えるほど上がる＝だんだん難しく）。
 * 〜53本は従来どおり 0.34→0.66（不変）。それ以降も増えて左右の切り替えが増える。
 */
export function branchProb(index: number): number {
  const base = Math.min(0.66, 0.34 + index * 0.006);
  return Math.min(0.88, base + Math.max(0, index - 53) * 0.0016);
}

/**
 * エネルギーの減る速さ（毎秒。本数が増えるほど速い）。
 * 〜75本は従来どおり 0.16→0.50（不変）。それ以降は上限なしで速くなるので、
 * 1本あたりの回復 CHOP_GAIN=0.135 では、いずれ必要な連打速度が人間の限界を超えて終わる
 * （例: 200本で0.775/s＝約5.7回/秒、300本で約7.4回/秒が必要）。
 */
export function depRate(chops: number): number {
  return 0.16 + Math.min(0.34, chops * 0.0045) + Math.max(0, chops - 75) * 0.0022;
}

/**
 * index 本目の丸太の枝を決める。rng は必ず2回（枝あり?→左右）引く（固定順＝決定論）。
 * index < SAFE_START は必ず枝なし。
 */
export function nextBranch(rng: () => number, index: number): number {
  const r1 = rng();
  const r2 = rng();
  if (index < SAFE_START) return BR_NONE;
  if (r1 < branchProb(index)) return r2 < 0.5 ? BR_LEFT : BR_RIGHT;
  return BR_NONE;
}

/** 切った本数 → 点数 */
export const scoreOf = (chops: number): number => chops * 10;

/** その丸太の枝が side（1=左/2=右）にぶつかるか */
export function branchHits(branch: number, side: number): boolean {
  return branch === side;
}
