// =============================================================
// まもれ！おしろ（No.66）の経路・ウェーブ・とりで仕様（DOM非依存・純ロジック）
// =============================================================
// - アプリ初のディフェンス系。道を歩いてくる敵を、道ぞいの台に建てた
//   「まもりずきん」（弓/氷/ばくだん）で むかえうつ。全10ウェーブで完結。
// - 敵の順番・間隔はテーブルで固定（決定論）。rng は使わない（ゆらぎ無しでも
//   タワー配置の判断ゲームとして十分に成立し、検証が厳密になる）。
// - バランスはシミュレーションで較正済み（無防備→序盤で陥落 /
//   けんじつな配置→HP残ありでクリア）。
// - import してよいのは game-api と同一フォルダのみ（このファイルは依存なし）。

export const W = 360;
export const H = 640;

/** 敵の通り道（上から入って、S字にくだって城へ） */
export const PATH: { x: number; y: number }[] = [
  { x: 50, y: -30 },
  { x: 50, y: 140 },
  { x: 310, y: 140 },
  { x: 310, y: 320 },
  { x: 60, y: 320 },
  { x: 60, y: 500 },
  { x: 180, y: 500 },
  { x: 180, y: 588 },
];

const SEG_LEN: number[] = [];
let acc = 0;
for (let i = 0; i < PATH.length - 1; i++) {
  const a = PATH[i]!;
  const b = PATH[i + 1]!;
  const l = Math.hypot(b.x - a.x, b.y - a.y);
  SEG_LEN.push(l);
  acc += l;
}
export const TOTAL_LEN = acc;

/** 道のり d（px）→ 画面座標 */
export function posAt(d: number): { x: number; y: number } {
  let rest = Math.max(0, d);
  for (let i = 0; i < SEG_LEN.length; i++) {
    const l = SEG_LEN[i]!;
    if (rest <= l) {
      const a = PATH[i]!;
      const b = PATH[i + 1]!;
      const f = l === 0 ? 0 : rest / l;
      return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
    }
    rest -= l;
  }
  const last = PATH[PATH.length - 1]!;
  return { x: last.x, y: last.y };
}

/** とりでを建てられる台の位置 */
export const PADS: { x: number; y: number }[] = [
  { x: 120, y: 92 },
  { x: 252, y: 92 },
  { x: 258, y: 232 },
  { x: 120, y: 252 },
  { x: 185, y: 382 },
  { x: 112, y: 442 },
  { x: 242, y: 468 },
];

export type TowerType = 'arrow' | 'ice' | 'bomb';

export interface TowerSpec {
  cost: number;
  /** 強化コスト（Lv1→2, Lv2→3） */
  up: [number, number];
  dmg: [number, number, number];
  cd: [number, number, number];
  range: [number, number, number];
  aoe?: [number, number, number];
  slowF?: [number, number, number];
  slowDur?: [number, number, number];
}

export const TOWERS: Record<TowerType, TowerSpec> = {
  arrow: { cost: 40, up: [40, 60], dmg: [7, 12, 18], cd: [0.5, 0.42, 0.34], range: [95, 102, 110] },
  ice: { cost: 60, up: [50, 70], dmg: [3, 4, 6], cd: [0.8, 0.75, 0.7], range: [88, 94, 100], slowF: [0.55, 0.45, 0.38], slowDur: [1.2, 1.5, 1.8] },
  bomb: { cost: 80, up: [70, 90], dmg: [10, 15, 22], cd: [1.5, 1.4, 1.3], range: [105, 112, 120], aoe: [46, 52, 58] },
};

export type EnemyKind = 'slime' | 'fast' | 'tank' | 'boss';

export interface EnemySpec {
  hp: number;
  spd: number;
  reward: number;
  score: number;
  dmg: number;
  r: number;
}

// シミュレーション較正済み: けんじつな配置(7台+強化)で残HP3クリア / 弓3本の手抜きはウェーブ9で陥落
export const ENEMIES: Record<EnemyKind, EnemySpec> = {
  slime: { hp: 38, spd: 50, reward: 6, score: 10, dmg: 1, r: 12 },
  fast: { hp: 25, spd: 89, reward: 7, score: 14, dmg: 1, r: 10 },
  tank: { hp: 145, spd: 31, reward: 14, score: 25, dmg: 1, r: 15 },
  boss: { hp: 810, spd: 27, reward: 50, score: 100, dmg: 3, r: 20 },
};

export interface SpawnDef {
  kind: EnemyKind;
  /** 直前の出現からの間隔（秒） */
  gap: number;
}

const s = (kind: EnemyKind, gap: number): SpawnDef => ({ kind, gap });

/** 全10ウェーブ（固定テーブル＝決定論） */
export const WAVES: SpawnDef[][] = [
  [s('slime', 0.5), s('slime', 0.9), s('slime', 0.9), s('slime', 0.9), s('slime', 0.9), s('slime', 0.9)],
  [s('slime', 0.5), s('slime', 0.75), s('slime', 0.75), s('slime', 0.75), s('slime', 0.75), s('slime', 0.75), s('slime', 0.75), s('slime', 0.75)],
  [s('slime', 0.5), s('slime', 0.8), s('fast', 0.8), s('slime', 0.8), s('fast', 0.8), s('slime', 0.8), s('fast', 0.8), s('slime', 0.8)],
  [s('fast', 0.5), s('fast', 0.55), s('fast', 0.55), s('fast', 0.55), s('fast', 0.55), s('fast', 0.55), s('fast', 0.55), s('fast', 0.55)],
  [s('slime', 0.5), s('slime', 0.7), s('slime', 0.7), s('slime', 0.7), s('tank', 1.2), s('slime', 0.7), s('slime', 0.7), s('slime', 0.7), s('slime', 0.7)],
  [s('tank', 0.6), s('tank', 1.6), s('tank', 1.6)],
  [s('fast', 0.5), s('slime', 0.5), s('fast', 0.5), s('slime', 0.5), s('fast', 0.5), s('slime', 0.5), s('fast', 0.5), s('slime', 0.5), s('fast', 0.5), s('slime', 0.5), s('fast', 0.5), s('slime', 0.5)],
  [s('tank', 0.6), s('fast', 0.9), s('fast', 0.9), s('tank', 1.2), s('fast', 0.9), s('fast', 0.9), s('tank', 1.2)],
  [
    s('slime', 0.45), s('slime', 0.45), s('fast', 0.45), s('slime', 0.45), s('slime', 0.45), s('fast', 0.45),
    s('tank', 1.0), s('slime', 0.45), s('fast', 0.45), s('slime', 0.45), s('slime', 0.45), s('fast', 0.45),
    s('slime', 0.45), s('fast', 0.45), s('slime', 0.45), s('slime', 0.45), s('tank', 1.0),
  ],
  [s('boss', 0.8), s('fast', 1.4), s('fast', 0.8), s('fast', 0.8), s('fast', 0.8), s('fast', 0.8), s('fast', 0.8)],
];

export const START_COINS = 90;
export const WAVE_COIN = 12;
export const WAVE_SCORE = 20;
export const CASTLE_HP = 5;
export const HP_SCORE = 40;
export const CLEAR_SCORE = 150;
export const PREP_SEC = 5;

/** いちばん城に近い（=dist最大の）射程内の敵の添字（いなければ -1） */
export function acquireTarget(enemies: { dist: number; hp: number }[], px: number, py: number, range: number): number {
  let best = -1;
  let bestDist = -1;
  for (let i = 0; i < enemies.length; i++) {
    const e = enemies[i]!;
    if (e.hp <= 0) continue;
    const pos = posAt(e.dist);
    const dx = pos.x - px;
    const dy = pos.y - py;
    if (dx * dx + dy * dy > range * range) continue;
    if (e.dist > bestDist) {
      bestDist = e.dist;
      best = i;
    }
  }
  return best;
}

/** 全ウェーブの撃破スコア合計（メダル較正用） */
export function totalKillScore(): number {
  let t = 0;
  for (const w of WAVES) for (const sp of w) t += ENEMIES[sp.kind].score;
  return t;
}
