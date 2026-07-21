// =============================================================
// ビーだまより分け（No.90）の出題計画・盤面・判定（DOM非依存・純ロジック）
// =============================================================
// - 上から落ちてくる色ビーだまを、かたむき（またはドラッグ＝仮想かたむき）で
//   ピンだらけの盤面をころがし、下の同じ色のゲートへより分ける。
// - 【公平性の保証（プロパティテスト対象）】同時に空中にいる可能性がある
//   （出現間隔 < SAFE_GAP_MS の）連続2球は、ゲートが「となり同士か同じ」
//   になるよう色を選ぶ＝左右の端ゲートを同時に要求しない。金はどのゲートでもOK。
// - 出現計画・ゲート並びは rng 注入で一括生成（日替わりは全員同じ）＝完全決定論。
// - import してよいのは game-api と同一フォルダのみ（このファイルは依存なし）。

export const W = 360;
export const H = 640;
export const HUD_H = 40;

export const MARBLES = 30;
/** 金ビーだまの出現インデックス（固定・どのゲートに入れてもOKのごほうび） */
export const GOLD_AT = [7, 15, 23] as const;
/** 色ビーだまの数（= MARBLES - 金） */
export const COLORED = MARBLES - GOLD_AT.length;

/** この間隔未満で連続する2球は「ゲートがとなり同士か同じ」保証の対象 */
export const SAFE_GAP_MS = 1400;

export const MARBLE_R = 9;
export const PEG_R = 5;
export const GRAVITY = 360;
export const TILT_ACCEL = 440;
export const WALL_L = 8;
export const WALL_R = W - 8;
/** ゲート仕切り（ここより下は3レーン） */
export const DIVIDER_Y = 540;
export const GATE_JUDGE_Y = 592;

export const CORRECT_PTS = 10;
export const GOLD_PTS = 30;
/** 連続正解ボーナス: 2×min(n-1, 5)（n=この正解を含む連続数） */
export function streakBonus(n: number): number {
  return 2 * Math.min(Math.max(0, n - 1), 5);
}
/** 実績: ゲートマスター の閾値（PIDボット実証452・456で較正） */
export const SCORE_HI = 450;

/** 理論最大（27色ぜんぶ正解＋金3＝ストリーク途切れなし） */
export function maxScore(): number {
  let total = GOLD_AT.length * GOLD_PTS;
  for (let n = 1; n <= COLORED; n++) total += CORRECT_PTS + streakBonus(n);
  return total;
}

export interface Spawn {
  at: number;
  /** 0..2=色（ゲート番号に対応）/ 3=金 */
  kind: number;
}

export interface Plan {
  spawns: Spawn[];
  /** ゲートの色ならび（gatePerm[ゲート位置0..2] = 色0..2） */
  gatePerm: number[];
}

/** 出現間隔（だんだん短く＝後半は同時に2球が空中に） */
export function spawnGapMs(index: number): number {
  if (index < 10) return 1750;
  if (index < 20) return 1500;
  return 1250;
}

/**
 * 出現計画とゲート並びを一括生成（rng 消費順固定＝決定論）。
 * 公平性: 間隔 < SAFE_GAP_MS の連続ペアは |gate差| ≤ 1（金はワイルド扱い）。
 */
export function makePlan(rng: () => number): Plan {
  // ゲート並び（3! = 6通り）
  const perms = [
    [0, 1, 2],
    [0, 2, 1],
    [1, 0, 2],
    [1, 2, 0],
    [2, 0, 1],
    [2, 1, 0],
  ];
  const gatePerm = [...perms[Math.floor(rng() * 6)]!];
  const gateOfColor = (color: number): number => gatePerm.indexOf(color);

  const spawns: Spawn[] = [];
  let t = 1200;
  let prevGate = 1; // 仮想的な直前ゲート（初球は自由だが中央扱いから）
  let prevWasTight = false;
  for (let i = 0; i < MARBLES; i++) {
    const gap = i === 0 ? 0 : spawnGapMs(i - 1);
    t += gap;
    if ((GOLD_AT as readonly number[]).includes(i)) {
      spawns.push({ at: t, kind: 3 });
      prevWasTight = gap < SAFE_GAP_MS; // 金はワイルド: prevGate は変えない
      continue;
    }
    const tight = i > 0 && gap < SAFE_GAP_MS;
    let color: number;
    if (tight || prevWasTight) {
      // となり同士か同じゲートの色だけから選ぶ
      const allowed: number[] = [];
      for (let c = 0; c < 3; c++) if (Math.abs(gateOfColor(c) - prevGate) <= 1) allowed.push(c);
      color = allowed[Math.floor(rng() * allowed.length)]!;
    } else {
      color = Math.floor(rng() * 3);
    }
    spawns.push({ at: t, kind: color });
    prevGate = gateOfColor(color);
    prevWasTight = false;
  }
  return { spawns, gatePerm };
}

/** ピン配置（固定・千鳥格子） */
export function pegs(): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (let row = 0; row < 8; row++) {
    const y = 136 + row * 44;
    const offset = row % 2 === 0 ? 0 : 24;
    for (let col = 0; col < 8; col++) {
      const x = 36 + offset + col * 48;
      if (x > WALL_L + 14 && x < WALL_R - 14) out.push({ x, y });
    }
  }
  return out;
}

/** ゲートのレーン範囲（位置0..2） */
export const GATE_X: [number, number][] = [
  [WALL_L, 122],
  [125, 235],
  [238, WALL_R],
];

/** x 座標がどのゲート位置に落ちたか（すき間なし＝必ずどこかに入る） */
export function gateAt(x: number): number {
  if (x < 123.5) return 0;
  if (x < 236.5) return 1;
  return 2;
}
