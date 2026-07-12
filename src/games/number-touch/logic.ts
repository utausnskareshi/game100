// =============================================================
// すうじタッチ（No.35）の配置ロジック（DOM非依存・乱数注入）
// =============================================================
// - 数字の円を「重ならない・盤からはみ出さない」ように置き、漂う初速を与える。
//   rng 注入＝「今日のゲーム」では全員同じ配置・同じ動き（タイム勝負が公平）。
// - import してよいのは game-api（types/helpers）と同一フォルダのみ（このファイルは依存なし）。

export type LevelKey = 'easy' | 'normal' | 'hard';

export const CIRCLE_R = 24; // 円の半径(px)＝直径48でタップ領域44px超
export const PENALTY_MS = 2000; // おてつき1回のペナルティ

interface LevelDef {
  count: number;
  /** 漂う速さ(px/s) */
  speed: number;
}

export const LEVELS: Record<LevelKey, LevelDef> = {
  easy: { count: 12, speed: 18 },
  normal: { count: 18, speed: 26 },
  hard: { count: 25, speed: 34 },
};

export interface Circle {
  num: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

/**
 * 盤（w×h）に count 個の円を重ならないように置く。
 * 混みあって置けないときは最小間隔を少しずつゆるめる（それでも半径ぶんは必ず確保）。
 */
export function makeLayout(rng: () => number, level: LevelKey, w: number, h: number): Circle[] {
  const def = LEVELS[level];
  const out: Circle[] = [];
  let minDist = CIRCLE_R * 2 + 8;
  for (let num = 1; num <= def.count; num++) {
    let x = CIRCLE_R;
    let y = CIRCLE_R;
    let placed = false;
    let tries = 0;
    // 通常は重なりゼロで置ける。混みあうと最小間隔をゆるめ、
    // 極端に狭い盤（異常ビューポート等）でも 1000 回で必ず打ち切る＝フリーズしない
    while (!placed && tries < 1000) {
      tries++;
      x = CIRCLE_R + rng() * Math.max(1, w - CIRCLE_R * 2);
      y = CIRCLE_R + rng() * Math.max(1, h - CIRCLE_R * 2);
      let ok = true;
      for (const c of out) {
        const dx = c.x - x;
        const dy = c.y - y;
        if (dx * dx + dy * dy < minDist * minDist) {
          ok = false;
          break;
        }
      }
      if (ok) placed = true;
      else if (tries % 200 === 0) minDist = Math.max(CIRCLE_R * 2, minDist - 4); // ゆるめる（重なりゼロは維持）
    }
    // 打ち切り時は最後の候補位置に置く（縮退した盤での生存優先）
    const ang = rng() * Math.PI * 2;
    out.push({ num, x, y, vx: Math.cos(ang) * def.speed, vy: Math.sin(ang) * def.speed });
  }
  return out;
}

/** 円を dt 秒すすめて盤の中で反射させる（破壊的更新） */
export function stepCircles(circles: Circle[], dt: number, w: number, h: number): void {
  for (const c of circles) {
    c.x += c.vx * dt;
    c.y += c.vy * dt;
    if (c.x < CIRCLE_R) {
      c.x = CIRCLE_R;
      c.vx = Math.abs(c.vx);
    } else if (c.x > w - CIRCLE_R) {
      c.x = w - CIRCLE_R;
      c.vx = -Math.abs(c.vx);
    }
    if (c.y < CIRCLE_R) {
      c.y = CIRCLE_R;
      c.vy = Math.abs(c.vy);
    } else if (c.y > h - CIRCLE_R) {
      c.y = h - CIRCLE_R;
      c.vy = -Math.abs(c.vy);
    }
  }
}
