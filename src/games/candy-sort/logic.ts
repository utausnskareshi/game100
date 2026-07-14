// =============================================================
// キャンディふりわけ（No.37）のコース定義と出題（DOM非依存・純ロジック）
// =============================================================
// - コースは二分木: 入口 → 分岐0 →（分岐1 | 分岐2）→ ビン4つ。
//   全ルートの道のりは左右対称で等しい＝あとから出たキャンディが追い越さない（FIFO）。
// - 乱数は注入（ctx.random）。1回の抽選で消費する乱数の回数は固定
//   （ビン並び=3回・キャンディ1個=2回）＝日替わりで全員同じ出題。
// - import してよいのは game-api（types/helpers）と同一フォルダのみ（このファイルは依存なし）。

export type Rng = () => number;

export interface Pt {
  x: number;
  y: number;
}

/** コース座標（design 360×640） */
export const NODES = {
  spawn: { x: 180, y: 14 } as Pt,
  j0: { x: 180, y: 150 } as Pt,
  j1: { x: 90, y: 308 } as Pt,
  j2: { x: 270, y: 308 } as Pt,
  bins: [
    { x: 45, y: 522 },
    { x: 135, y: 522 },
    { x: 225, y: 522 },
    { x: 315, y: 522 },
  ] as Pt[],
};

/** 分岐（ゲート）の位置。タップ判定・矢印描画に使う */
export const GATE_POS: Pt[] = [NODES.j0, NODES.j1, NODES.j2];

/** ゲートのタップ半径（design px。44px 以上のタップ領域を確保） */
export const GATE_TAP_R = 40;

export type GateDir = 'L' | 'R';

/** キャンディの色（ビンの並びは makeBinOrder でシャッフル） */
export const COLORS = ['#f0524a', '#ffc94d', '#3ed36a', '#4a90f0'] as const;
export const COLOR_NAMES = ['あか', 'きいろ', 'みどり', 'あお'] as const;

/** ビンの並び（index=ビン位置 → 値=色番号）。Fisher-Yates・乱数消費は常に3回 */
export function makeBinOrder(rng: Rng): number[] {
  const a = [0, 1, 2, 3];
  for (let i = 3; i >= 1; i--) {
    const j = Math.min(i, Math.floor(rng() * (i + 1)));
    const t = a[i]!;
    a[i] = a[j]!;
    a[j] = t;
  }
  return a;
}

export interface CandyRoll {
  color: number;
  rainbow: boolean;
}

/** キャンディ1個の抽選。乱数消費は常に2回 */
export function rollCandy(rng: Rng): CandyRoll {
  const color = Math.min(3, Math.floor(rng() * 4));
  const rainbow = rng() < 0.08;
  return { color, rainbow };
}

/** 出現間隔（ms）。60秒かけて 1500 → 550 に縮む */
export function intervalAt(tMs: number): number {
  return Math.max(550, 1500 - 950 * Math.min(1, tMs / 60_000));
}

/** 転がる速さ（px/s）。55秒かけて 130 → 260 に上がる */
export function speedAt(tMs: number): number {
  return 130 + 130 * Math.min(1, tMs / 55_000);
}

/**
 * 目標ビンへ行くために、各ゲートが向くべき方向。
 * gate0: ビン0/1=左・ビン2/3=右 ／ gate1: ビン0=左・ビン1=右 ／ gate2: ビン2=左・ビン3=右
 */
export function decideGate(gateIdx: number, targetBin: number): GateDir {
  if (gateIdx === 0) return targetBin < 2 ? 'L' : 'R';
  if (gateIdx === 1) return targetBin === 0 ? 'L' : 'R';
  return targetBin === 2 ? 'L' : 'R';
}

/** 1個ふりわけ成功の得点（streak=この1個を含めた連続成功数） */
export function pointsFor(rainbow: boolean, streak: number): number {
  return (rainbow ? 30 : 10) + 2 * Math.min(streak - 1, 5);
}
