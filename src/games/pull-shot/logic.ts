// =============================================================
// ひっぱりショット（No.61）のステージ生成と得点（DOM非依存・純ロジック）
// =============================================================
// - 引っぱって弾く正面図バウンドアクション。モンスターと岩（反射ブロック）を
//   ステージ番号に応じて配置する。配置は rng 注入（ctx.random＝日替わり同一）。
// - モンスターは HP（当たった回数）と カウントダウン（あなたのショット数で減り、
//   0で反撃）を持つ。ステージが進むほど かたく・せっかちに＝少しむずかしい。
// - 配置の試行ループには必ず打ち切り＋段階緩和を入れる（フリーズ防止の教訓）。
// - import してよいのは game-api と同一フォルダのみ（このファイルは依存なし）。

export const W = 360;
export const H = 640;
/** 遊べる領域（壁の内側）。この矩形の縁で反射する */
export const ARENA = { x: 10, y: 58, w: 340, h: 512 };
export const BALL_R = 14;
export const MON_R = 22;
export const BALL_START = { x: 180, y: 520 };

export type MonKind = 'imp' | 'oni' | 'bat';

export interface Monster {
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  /** あと何ショットで反撃するか */
  cd: number;
  cdBase: number;
  kind: MonKind;
  /** たおしたときの得点 */
  pts: number;
}

export interface Obstacle {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Stage {
  monsters: Monster[];
  obstacles: Obstacle[];
}

export const HIT_PTS = 20;
export const comboBonus = (combo: number): number => Math.max(0, combo - 1) * 40;
export const stageClearBonus = (stage: number): number => 100 + stage * 20;

/** ステージ番号（1〜）から構成を決めて配置する（rng 注入・決定論） */
export function makeStage(stage: number, rng: () => number): Stage {
  const nMon = stage <= 1 ? 3 : stage === 2 ? 4 : stage <= 4 ? 4 : Math.min(6, 4 + Math.floor((stage - 3) / 2));
  const hpBase = Math.min(5, 1 + Math.floor(stage / 2));
  const cdBase = stage <= 4 ? 3 : 2;
  const nObs = Math.min(4, Math.floor((stage + 1) / 2));

  // 岩（反射ブロック）: 中段の帯に置く
  const obstacles: Obstacle[] = [];
  let guard = 0;
  while (obstacles.length < nObs && guard++ < 300) {
    const horizontal = rng() < 0.5;
    const w = horizontal ? 84 : 20;
    const h = horizontal ? 20 : 84;
    const x = ARENA.x + 24 + rng() * (ARENA.w - 48 - w);
    const y = 170 + rng() * (250 - h);
    const rect = { x, y, w, h };
    const overlaps = obstacles.some(
      (o) => rect.x < o.x + o.w + 24 && rect.x + rect.w + 24 > o.x && rect.y < o.y + o.h + 24 && rect.y + rect.h + 24 > o.y,
    );
    if (!overlaps) obstacles.push(rect);
  }

  // モンスター: 上〜中段に重ならないよう散布（岩とも离す）
  const monsters: Monster[] = [];
  let minDist = MON_R * 2 + 10;
  guard = 0;
  while (monsters.length < nMon && guard++ < 500) {
    if (guard % 120 === 0 && minDist > MON_R * 2) minDist *= 0.92; // 段階緩和
    const x = ARENA.x + MON_R + 6 + rng() * (ARENA.w - (MON_R + 6) * 2);
    const y = 110 + rng() * 320;
    if (monsters.some((m) => Math.hypot(m.x - x, m.y - y) < minDist)) continue;
    const nearObs = obstacles.some(
      (o) => x > o.x - MON_R - 6 && x < o.x + o.w + MON_R + 6 && y > o.y - MON_R - 6 && y < o.y + o.h + MON_R + 6,
    );
    if (nearObs) continue;
    // 種類: ステージが進むと 🦇(せっかち) と 👹(かたい) が混ざる
    let kind: MonKind = 'imp';
    const roll = rng();
    if (stage >= 4 && roll < 0.25) kind = 'bat';
    else if (stage >= 3 && roll < 0.55) kind = 'oni';
    const hp = kind === 'oni' ? hpBase + 1 : kind === 'bat' ? Math.max(1, hpBase - 1) : hpBase;
    const cd = kind === 'bat' ? Math.max(1, cdBase - 1) : kind === 'oni' ? cdBase + 1 : cdBase;
    monsters.push({ x, y, hp, maxHp: hp, cd, cdBase: cd, kind, pts: hp * 40 });
  }
  // 保険: 万一 打ち切りで1体も置けなかったら 中央に1体（空ステージの無限クリアを防ぐ）
  if (monsters.length === 0) {
    monsters.push({ x: W / 2, y: 240, hp: hpBase, maxHp: hpBase, cd: cdBase, cdBase, kind: 'imp', pts: hpBase * 40 });
  }
  return { monsters, obstacles };
}
