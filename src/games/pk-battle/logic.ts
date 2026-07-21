// =============================================================
// PKたいけつ（No.83）のコース判定・キーパー到達・CPU抽選・採点（DOM非依存・純ロジック）
// =============================================================
// - ける→まもるを5本ずつ交互に行うPK戦。どちらもドラッグ1ジェスチャー。
// - キック: ドラッグベクトル→ゴール面の狙い点へ写像。すみジャスト（4隅の半径30px）は
//   キーパーがどちらへ飛んでも届かない＝ゴール保証。まん中は誰が飛んでも届く（むずかしい）。
//   枠の外＝ポスト/枠外でミス。
// - セーブ: CPUの助走中にヒント（体の向き）が出るが信頼度70%。飛ぶのが早すぎる
//   （シュートの150ms以上前）と読まれて逆を突かれる。窓内に正しい方向へ飛べばセーブ。
// - CPUの行動（コース・ヒント真偽・早とび懲罰側）は rng 注入＝完全決定論。
//   rollCpuKick の rng 消費は常に4回（真偽で分岐しても固定）＝ミラー検証が容易。
// - import してよいのは game-api と同一フォルダのみ（このファイルは依存なし）。

export const W = 360;
export const H = 640;

/** ゴールの枠（内側がゴール面） */
export const GOAL = { x0: 60, x1: 300, y0: 150, y1: 260 };
/** すみジャストの中心（4隅の内側） */
export const CORNERS = [
  { x: 78, y: 170 },
  { x: 282, y: 170 },
  { x: 78, y: 246 },
  { x: 282, y: 246 },
];
export const CORNER_R = 30;

export type Zone = 'L' | 'C' | 'R';
/** キーパーが各方向へ飛んだときに届く x 範囲（まん中はどの方向でも届く＝むずかしい） */
export const DIVE_RECTS: Record<Zone, [number, number]> = {
  L: [60, 196],
  C: [122, 238],
  R: [164, 300],
};

export const PAIRS = 5;
export const SD_MAX = 3;
export const GOAL_PTS = 30;
export const CORNER_BONUS = 20;
export const SAVE_PTS = 40;
export const WIN_PTS = 100;
export const SD_WIN_PTS = 130;
export const DRAW_PTS = 50;
/** 完璧プレイ = 5本ぜんぶすみジャスト＋5本ぜんぶセーブ＋勝利 = 550 */
export const MAX_SCORE = PAIRS * (GOAL_PTS + CORNER_BONUS) + PAIRS * SAVE_PTS + WIN_PTS;

export const HINT_TRUTH = 0.7;
export const RUNUP_MS = 900;
export const FLY_MS = 420;
/** シュートのこの時間より前に飛ぶと「早すぎ」＝読まれる */
export const SAVE_EARLY_MS = 150;
/** シュートのこの時間より後に飛んでも届かない */
export const SAVE_LATE_MS = 260;
export const MIN_DRAG = 24;

/** キックのドラッグベクトル → ゴール面の狙い点（純関数） */
export function kickTarget(dx: number, dy: number): { x: number; y: number } {
  return { x: 180 + dx * 1.2, y: 258 + dy * 0.55 };
}

export function inGoal(t: { x: number; y: number }): boolean {
  return t.x >= GOAL.x0 && t.x <= GOAL.x1 && t.y >= GOAL.y0 && t.y <= GOAL.y1;
}

export function cornerJust(t: { x: number; y: number }): boolean {
  return CORNERS.some((c) => Math.hypot(t.x - c.x, t.y - c.y) <= CORNER_R);
}

/** キーパー（CPU）の飛ぶ方向を引く */
export function keeperDive(rng: () => number): Zone {
  const r = rng();
  return r < 0.4 ? 'L' : r < 0.8 ? 'R' : 'C';
}

/** 枠内のシュートがセーブされるか（すみジャストは絶対に届かない） */
export function savedByKeeper(t: { x: number; y: number }, dive: Zone): boolean {
  if (!inGoal(t)) return false;
  if (cornerJust(t)) return false;
  const [a, b] = DIVE_RECTS[dive];
  return t.x >= a && t.x <= b;
}

export interface CpuKick {
  zone: Zone;
  hint: Zone;
  truth: boolean;
  /** 早とび（まん中）を懲罰するときに蹴る側 */
  earlyPunish: Zone;
}

/** CPUキッカーの1本を引く（rng 消費は常に4回で固定＝決定論ミラーが容易） */
export function rollCpuKick(rng: () => number): CpuKick {
  const r = rng();
  const zone: Zone = r < 0.4 ? 'L' : r < 0.8 ? 'R' : 'C';
  const truth = rng() < HINT_TRUTH;
  let hint = zone;
  if (!truth) {
    const others = (['L', 'C', 'R'] as Zone[]).filter((z) => z !== zone);
    hint = others[Math.min(1, Math.floor(rng() * 2))]!;
  } else {
    rng(); // 消費数を揃えるダミー
  }
  const earlyPunish: Zone = rng() < 0.5 ? 'L' : 'R';
  return { zone, hint, truth, earlyPunish };
}

/** 早とびされたときの最終コース（読まれて逆を突く。まん中早とびは earlyPunish 側へ） */
export function finalZone(cpu: CpuKick, dive: Zone, early: boolean): Zone {
  if (!early) return cpu.zone;
  return dive === 'L' ? 'R' : dive === 'R' ? 'L' : cpu.earlyPunish;
}

/** セーブのドラッグベクトル → 飛ぶ方向（左右 or 上=まん中ジャンプ。小さすぎは無効） */
export function diveFromDrag(dx: number, dy: number): Zone | null {
  if (dx < -30) return 'L';
  if (dx > 30) return 'R';
  if (dy < -30) return 'C';
  return null;
}

/** ゾーンの代表点（ボールの到達点・キーパーの飛び先の描画用） */
export function zonePoint(z: Zone): { x: number; y: number } {
  return z === 'L' ? { x: 96, y: 205 } : z === 'R' ? { x: 264, y: 205 } : { x: 180, y: 200 };
}
