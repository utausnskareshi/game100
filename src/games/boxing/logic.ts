// =============================================================
// ボクシング（No.82）の攻撃抽選・ラウンド設定・採点（DOM非依存・純ロジック）
// =============================================================
// - 相手の予備動作（グローブが光る）を見て よけ、直後の「すき」にカウンターを入れる。
//   予備動作の長さ・攻撃間隔・フェイント率はラウンドごとに厳しくなる（むずかしい難易度）。
// - 【理不尽なしの保証】予備動作は最短 240ms・フェイント直後の本命も「消えてから
//   200ms 以上あけて 240ms 以上の予備動作」＝反応の余地を必ず残す（プロパティテストで検証）。
// - 攻撃列は rng 注入（ctx.random＝日替わりは全員同じ）。
// - import してよいのは game-api と同一フォルダのみ（このファイルは依存なし）。

export const W = 360;
export const H = 640;

export const LIVES = 3;
/** よけ入力が有効な時間（スワイプしてからこの間だけ「よけ中」） */
export const DODGE_ACTIVE_MS = 350;
/** 被弾後に動けない時間 */
export const STUN_MS = 450;
/** すきの前半（この割合以内のカウンター＝ジャスト） */
export const JUST_FRAC = 0.45;

export const DODGE_PTS = 5;
export const COUNTER_PTS = 20;
export const JUST_BONUS = 10;
export const KO_BONUS = 50;
export const HEART_BONUS = 20;

/** れんぞくカウンターボーナス（n = この一撃を含む連続数。被弾でリセット） */
export function comboBonus(n: number): number {
  return 2 * Math.min(Math.max(n - 1, 0), 10);
}

export interface RoundCfg {
  name: string;
  color: string; // 相手のからだの色
  hp: number;
  teleMin: number; // 予備動作ms
  teleMax: number;
  gapMin: number; // 攻撃間隔ms
  gapMax: number;
  feintRate: number;
  comboRate: number; // 攻撃間隔が短くなる連打の率
  windowMs: number; // カウンター受付のすき
}

export const ROUNDS: RoundCfg[] = [
  { name: 'グリーンベア', color: '#4e9e58', hp: 8, teleMin: 500, teleMax: 560, gapMin: 700, gapMax: 1100, feintRate: 0, comboRate: 0.15, windowMs: 650 },
  { name: 'ブルーウルフ', color: '#4a7de0', hp: 10, teleMin: 380, teleMax: 440, gapMin: 550, gapMax: 900, feintRate: 0.18, comboRate: 0.25, windowMs: 560 },
  { name: 'レッドドラゴン', color: '#d84a4a', hp: 12, teleMin: 260, teleMax: 330, gapMin: 450, gapMax: 800, feintRate: 0.25, comboRate: 0.35, windowMs: 480 },
];

/** L=画面ひだりのグローブ（→右へよける）/ R=みぎ（→左へよける）/ S=ストレート（→しゃがむ） */
export type AttackType = 'L' | 'R' | 'S';
export type DodgeDir = 'left' | 'right' | 'down';

export function correctDodge(t: AttackType): DodgeDir {
  return t === 'L' ? 'right' : t === 'R' ? 'left' : 'down';
}

export interface AttackEv {
  type: AttackType;
  feint: boolean;
  telegraphMs: number;
  gapMs: number; // この攻撃の予備動作が始まるまでの間
}

/** フェイントの光が消えるタイミング（予備動作のこの割合） */
export const FEINT_CANCEL_FRAC = 0.6;
/** フェイントが消えてから本命の予備動作が始まるまで */
export const FEINT_FOLLOW_MIN = 200;
export const FEINT_FOLLOW_MAX = 280;
/** 予備動作の絶対下限（理不尽なし） */
export const TELE_FLOOR = 240;

/** つぎの攻撃を1つ引く（rng 消費: type→feint→telegraph→combo→gap の5回で固定＝決定論ミラー容易） */
export function rollAttack(rng: () => number, cfg: RoundCfg): AttackEv {
  const r = rng();
  const type: AttackType = r < 0.4 ? 'L' : r < 0.8 ? 'R' : 'S';
  const feint = rng() < cfg.feintRate;
  const telegraphMs = Math.max(TELE_FLOOR, cfg.teleMin + rng() * (cfg.teleMax - cfg.teleMin));
  const combo = rng() < cfg.comboRate;
  const gapMs = combo ? 260 + rng() * 100 : cfg.gapMin + rng() * (cfg.gapMax - cfg.gapMin);
  return { type, feint, telegraphMs, gapMs };
}

/** フェイントのあとの本命（逆サイドから・短い予備動作・フェイントなし） */
export function feintFollow(rng: () => number, cfg: RoundCfg, feintType: AttackType): AttackEv {
  const type: AttackType = feintType === 'L' ? 'R' : feintType === 'R' ? 'L' : rng() < 0.5 ? 'L' : 'R';
  return {
    type,
    feint: false,
    telegraphMs: Math.max(TELE_FLOOR, cfg.teleMin * 0.85),
    gapMs: FEINT_FOLLOW_MIN + rng() * (FEINT_FOLLOW_MAX - FEINT_FOLLOW_MIN),
  };
}
