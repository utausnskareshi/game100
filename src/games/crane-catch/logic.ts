// =============================================================
// わくわくクレーン（No.54）の景品・つかみ・落下判定（DOM非依存・純ロジック）
// =============================================================
// - 景品はビンの中に横一列。クレーンを止めた x が どの景品の上か・どれだけ中心かで
//   「グリップ（つかむ強さ 0〜1）」が決まる。中心ほど強い。
// - 運搬中に すべるかは グリップと 乱数（rng 注入）で決まる＝中心で取るほど 落ちにくい。
// - すべて純粋関数。ゲーム(game.ts)とテストが同じ関数を使う＝スコア/挙動が厳密一致。
// - import してよいのは game-api と同一フォルダのみ（このファイルは依存なし）。

export interface Prize {
  /** 中心x（design px） */
  cx: number;
  /** 半幅（px）。中心からこの距離までが「その景品の上」 */
  half: number;
  emoji: string;
  value: number;
  rare: boolean;
  /** つかまれて撤去されたか */
  taken: boolean;
}

export const BIN_LEFT = 40;
export const BIN_RIGHT = 320;
export const SLOTS = 6;
/** グリップ→ホールド判定の甘さ（大きいほど落ちにくい）。grip*FACTOR >= slipRoll で保持 */
export const GRIP_FACTOR = 1.15;
/** 中心ボーナスの最大点（grip=1 のとき） */
export const CENTER_BONUS = 25;

interface PrizeType {
  emoji: string;
  value: number;
  rare: boolean;
  half: number;
  weight: number;
}
// 半幅が小さい＝中心に止めにくい＝むずかしい。レアほど 高得点で 細い
const TYPES: PrizeType[] = [
  { emoji: '🍬', value: 30, rare: false, half: 22, weight: 5 },
  { emoji: '🎁', value: 45, rare: false, half: 20, weight: 4 },
  { emoji: '🧸', value: 60, rare: false, half: 21, weight: 4 },
  { emoji: '⭐', value: 120, rare: true, half: 15, weight: 2 },
  { emoji: '💎', value: 200, rare: true, half: 12, weight: 1 },
];

/** ビンの景品を作る（rng 注入・決定論）。SLOTS 個をスロット中心に配置 */
export function makePrizes(rng: () => number): Prize[] {
  const totalW = TYPES.reduce((s, t) => s + t.weight, 0);
  const pick = (): PrizeType => {
    let r = rng() * totalW;
    for (const t of TYPES) {
      r -= t.weight;
      if (r < 0) return t;
    }
    return TYPES[0]!;
  };
  const span = (BIN_RIGHT - BIN_LEFT) / SLOTS;
  const prizes: Prize[] = [];
  for (let i = 0; i < SLOTS; i++) {
    const t = pick();
    prizes.push({ cx: BIN_LEFT + span * (i + 0.5), half: t.half, emoji: t.emoji, value: t.value, rare: t.rare, taken: false });
  }
  return prizes;
}

/** clawX の真下にある（撤去されていない）景品。なければ null */
export function prizeUnder(prizes: Prize[], clawX: number): Prize | null {
  let best: Prize | null = null;
  let bestD = Infinity;
  for (const p of prizes) {
    if (p.taken) continue;
    const d = Math.abs(clawX - p.cx);
    if (d <= p.half && d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

/** つかむ強さ 0〜1（中心=1 / ふち=0） */
export function gripOf(prize: Prize, clawX: number): number {
  const d = Math.abs(clawX - prize.cx);
  return Math.max(0, 1 - d / prize.half);
}

/** グリップと slipRoll（=rng()）から 保持できるか。中心ほど落ちにくい */
export function isHeld(grip: number, slipRoll: number): boolean {
  return grip * GRIP_FACTOR >= slipRoll;
}

/** 保持できたときの得点（景品の値＋中心ボーナス） */
export function scoreFor(prize: Prize, grip: number): number {
  return prize.value + Math.round(grip * CENTER_BONUS);
}

/** 三角波 0..1（往復）。t=位相（0..1 で1往復） */
export function triWave(phase: number): number {
  const p = ((phase % 1) + 1) % 1;
  return p < 0.5 ? p * 2 : 2 - p * 2;
}
