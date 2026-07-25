// =============================================================
// くるくるキャンドル（No.92）: 純ロジック（決定論・rng注入・テスト対象）
// =============================================================
// - 回るケーキにタップでロウソクを1本さす。さした所が既存のロウソクに近すぎると失敗。
// - ケーキの回転角 θ は ctx.now から閉形式で求める（θ = ω·経過秒）＝フレーム非依存・ポーズ対応。
// - ロウソクは「ケーキ内の角度 φ」で保持（ケーキと一緒に回る）。タップ時 φ = A_INS − θ。
//   衝突判定は「新しい φ と既存 φ の角度差 < GAP」。
// - rng はステージ開始ごとに「速度ジッタ→初期ロウソク角」の固定順で2回だけ引く＝決定論。
// =============================================================

/** 設計解像度（縦） */
export const W = 360;
export const H = 640;

/** ケーキの中心と半径 */
export const CX = 180;
export const CY = 300;
export const R = 118;

/** さし込み位置（画面下＝ケーキの手前ふち）の世界角（+x基準・y下向き） */
export const A_INS = Math.PI / 2;

/** 衝突とみなすロウソク間の角度差（ラジアン）。約9.7° */
export const GAP = 0.17;

/** ステージクリアの得点係数など */
export const CANDLE_PTS = 10;
export const PERFECT_BONUS = 30;
export const SCORE_HI = 500;

/** 角度を (-π, π] に正規化（O(1)） */
export function normAngle(a: number): number {
  return a - 2 * Math.PI * Math.round(a / (2 * Math.PI));
}

/** 2つの角度の最小角度差（0〜π） */
export function angularDist(a: number, b: number): number {
  return Math.abs(normAngle(a - b));
}

export interface StageCfg {
  /** このステージで さすロウソクの本数（プレイヤーが置く数） */
  target: number;
  /** 回転の角速度（符号つき rad/s。ステージ交互で反転） */
  omega: number;
  /** 開始時に置いてある1本の角度（局所φ・障害物） */
  initPhase: number;
}

/**
 * ステージ n（1始まり）の設定。rng は「速度ジッタ→初期角」の順に2回引く（固定順＝決定論）。
 * だんだん速く・本数が増える。方向はステージごとに交互反転。
 */
export function stageConfig(n: number, rng: () => number): StageCfg {
  const speedJit = 0.9 + rng() * 0.2; // ±10%（1回目）
  const initPhase = normAngle(rng() * Math.PI * 2); // 初期ロウソク角（2回目）
  const mag = Math.min(4.6, 1.05 + (n - 1) * 0.34) * speedJit;
  const dir = n % 2 === 1 ? 1 : -1;
  const target = 3 + n; // stage1→4, stage2→5, ...
  return { target, omega: mag * dir, initPhase };
}

/** ステージクリアのボーナス点 */
export function stageBonus(n: number): number {
  return 20 + n * 10;
}

/** 現在の回転角 θ（rad）。stageStartNow からの経過に ω を掛けるだけ */
export function thetaAt(omega: number, now: number, stageStartNow: number): number {
  return (omega * (now - stageStartNow)) / 1000;
}

/** 今タップしたら置かれるロウソクの局所角 φ = A_INS − θ */
export function insertPhi(theta: number): number {
  return normAngle(A_INS - theta);
}

/** phi と既存ロウソク群の最小角度差（空きなら π を返す） */
export function marginTo(phi: number, candles: number[]): number {
  let m = Math.PI;
  for (const c of candles) {
    const d = angularDist(phi, c);
    if (d < m) m = d;
  }
  return m;
}
