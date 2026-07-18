// =============================================================
// でんしゃポイントさばき（No.76）の線路グラフ・スポーナー・採点（DOM非依存・純ロジック）
// =============================================================
// - 線路は 2段のY字分岐（J0→J1/J2）で 1本の入口から 4色のホームへ分かれる木構造。
//   電車は折れ線（ポリライン）上の距離で進み、分岐を「通過した瞬間」のポイント向きで進路が決まる。
// - 公平性の作り込み: 入口区間は全員同速（スポーン間隔＝そのまま車間）＋
//   「急行が おそい各停と同じ側へ 2.2秒未満の車間で続けて出ない」ようスポーナーが色を直す
//   → 正しく さばけば追突しない（追突＝プレイヤーの進路ミスのときだけ起こる）。
// - 乱数は注入（ctx.random）。時間・入力は game.ts が ctx から渡す＝完全決定論。
// - import してよいのは game-api と同一フォルダのみ（このファイルは依存なし）。

export const W = 360;
export const H = 640;

export type SegId = 'E' | 'A' | 'B' | 'C' | 'D' | 'F' | 'G';

export interface Pt {
  x: number;
  y: number;
}

export interface SegDef {
  pts: Pt[];
  len: number;
}

function seg(...pts: Pt[]): SegDef {
  let len = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    len += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return { pts, len };
}

/** 線路区間。E=入口→J0 / A,B=J0→J1,J2 / C,D,F,G=ホーム0〜3 へ */
export const SEGS: Record<SegId, SegDef> = {
  E: seg({ x: 180, y: 46 }, { x: 180, y: 170 }),
  A: seg({ x: 180, y: 170 }, { x: 96, y: 250 }, { x: 96, y: 320 }),
  B: seg({ x: 180, y: 170 }, { x: 264, y: 250 }, { x: 264, y: 320 }),
  C: seg({ x: 96, y: 320 }, { x: 52, y: 400 }, { x: 52, y: 548 }),
  D: seg({ x: 96, y: 320 }, { x: 140, y: 400 }, { x: 140, y: 548 }),
  F: seg({ x: 264, y: 320 }, { x: 220, y: 400 }, { x: 220, y: 548 }),
  G: seg({ x: 264, y: 320 }, { x: 308, y: 400 }, { x: 308, y: 548 }),
};

export type NextDef = { j: 0 | 1 | 2; left: SegId; right: SegId } | { platform: number };

/** 区間の終わりでどこへ行くか（分岐 or ホーム到着） */
export const NEXT: Record<SegId, NextDef> = {
  E: { j: 0, left: 'A', right: 'B' },
  A: { j: 1, left: 'C', right: 'D' },
  B: { j: 2, left: 'F', right: 'G' },
  C: { platform: 0 },
  D: { platform: 1 },
  F: { platform: 2 },
  G: { platform: 3 },
};

/** 分岐（ポイント）のタップ位置 */
export const JUNCTIONS: Pt[] = [
  { x: 180, y: 170 },
  { x: 96, y: 320 },
  { x: 264, y: 320 },
];

export const PLATFORM_X = [52, 140, 220, 308];
export const PLATFORM_Y = 556;

/** 区間上の距離 → 座標と進行方向（描画用） */
export function pointAt(s: SegDef, dist: number): { x: number; y: number; ang: number } {
  let d = Math.max(0, Math.min(dist, s.len));
  for (let i = 0; i < s.pts.length - 1; i++) {
    const a = s.pts[i]!;
    const b = s.pts[i + 1]!;
    const l = Math.hypot(b.x - a.x, b.y - a.y);
    if (d <= l || i === s.pts.length - 2) {
      const t = l > 0 ? Math.min(1, d / l) : 0;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, ang: Math.atan2(b.y - a.y, b.x - a.x) };
    }
    d -= l;
  }
  const last = s.pts[s.pts.length - 1]!;
  return { x: last.x, y: last.y, ang: Math.PI / 2 };
}

// ---- 速度・ルール定数 ----
/** 入口区間は全員この速さ（スポーン間隔がそのまま車間になる＝公平性の土台） */
export const ENTRY_SPEED = 100;
export const LOCAL_SPEED = 95;
export const EXPRESS_SPEED = 165;
/** 同一区間でこの距離より近づくと追突 */
export const CRASH_GAP = 24;
export const GAME_SEC = 90;
/** これ以降はスポーンしない（最終の電車も 90 秒までに必ず着く余白） */
export const SPAWN_UNTIL = 82;
export const LIVES = 3;

// ---- スコア ----
export const BASE_LOCAL = 20;
export const BASE_EXPRESS = 30;
export const GOLD_BONUS = 50;
export const NO_MISS_BONUS = 100;

/** れんぞく配達ボーナス（n = この配達を含む連続成功数） */
export function comboBonus(n: number): number {
  return 2 * Math.min(Math.max(0, n - 1), 10);
}

/** 1本とどけたときの得点 */
export function deliveryPoints(kind: 'local' | 'express', gold: boolean, comboN: number): number {
  return (kind === 'express' ? BASE_EXPRESS : BASE_LOCAL) + (gold ? GOLD_BONUS : 0) + comboBonus(comboN);
}

// ---- スポーナー ----
export interface SpawnSpec {
  color: number; // 0..3 = 行き先ホーム
  kind: 'local' | 'express';
  gold: boolean;
}

/** 色がどちらの側（J0 で 左=0 / 右=1）へ行くべきか */
export function sideOf(color: number): 0 | 1 {
  return color < 2 ? 0 : 1;
}

/** 次のスポーンまでの秒数。だんだん短くなる（じわじわ忙しく） */
export function spawnInterval(rng: () => number, tSec: number): number {
  const base = 4.2 + (2.3 - 4.2) * Math.min(1, tSec / 80);
  return Math.max(1.6, base + (rng() - 0.5) * 0.8);
}

/**
 * 電車を1本生成する。公平性ルール:
 * 直前の電車が「各停・同じ側・車間2.2秒未満」のとき急行を出すなら、行き先を反対側の色へ直す
 * （＝正しくさばいても追いついて追突する詰み配置を作らない。2本前とは車間が必ず 3.2 秒以上 空くので安全）。
 */
export function rollSpawn(
  rng: () => number,
  tSec: number,
  prev: { color: number; kind: 'local' | 'express'; at: number } | null,
  at: number,
): SpawnSpec {
  const expressP = 0.15 + 0.25 * Math.min(1, tSec / 70);
  const kind: 'local' | 'express' = rng() < expressP ? 'express' : 'local';
  const gold = rng() < 0.08;
  let color = Math.min(3, Math.floor(rng() * 4));
  if (
    kind === 'express' &&
    prev !== null &&
    prev.kind === 'local' &&
    at - prev.at < 2.2 &&
    sideOf(prev.color) === sideOf(color)
  ) {
    const base = sideOf(color) === 0 ? 2 : 0;
    color = base + (rng() < 0.5 ? 0 : 1);
  }
  return { color, kind, gold };
}
