// =============================================================
// ぴったりストップ（No.16）のロジック（DOM非依存・乱数注入）
// =============================================================
// - 動くマーカー（0〜1のバー上を往復）を、狙いのターゲットゾーンで止める。
//   ズレの小ささで perfect / nice / ok / miss を判定する。
// - マーカー位置も ctx.now から算出できる純関数（markerPos）にしてある＝
//   ゲーム側は毎フレーム markerPos を呼ぶだけ（ポーズ中は ctx.now が止まる）。
// - ラウンド構成（ターゲット位置・速度）は注入 rng 由来＝「今日のゲーム」では全員同じ。
// - import してよいのは game-api（types/helpers）と同一フォルダのみ（このファイルは依存なし）。

export type PresetKey = 'easy' | 'normal' | 'hard';
export type Tier = 'perfect' | 'nice' | 'ok' | 'miss';

export interface Round {
  /** ターゲット中心（0〜1のバー上の位置） */
  center: number;
  /** マーカーの往復周波数（Hz。1で1秒に1往復＝0→1→0） */
  freq: number;
  /** 「ぴったり」判定の半幅（0〜1・中心からの許容ズレ） */
  perfectHalf: number;
  /** 「ナイス」判定の半幅 */
  niceHalf: number;
  /** 「おしい」判定の半幅 */
  okHalf: number;
}

interface Band {
  freq: number;
  perfectHalf: number;
  niceHalf: number;
  okHalf: number;
}

// むずかしさ別のマーカー速度とゾーン幅（playtest調整前提の仮値）
const BANDS: Record<PresetKey, Band> = {
  easy: { freq: 0.42, perfectHalf: 0.032, niceHalf: 0.1, okHalf: 0.17 },
  normal: { freq: 0.58, perfectHalf: 0.024, niceHalf: 0.075, okHalf: 0.135 },
  hard: { freq: 0.8, perfectHalf: 0.016, niceHalf: 0.052, okHalf: 0.1 },
};

/** ラウンドが進むほど少しだけ速くする係数（後半ほど手ごたえUP） */
const RAMP_PER_ROUND = 0.03;

/** 1問の基本点（tier別・playtest調整前提の仮値） */
export const TIER_POINTS: Record<Tier, number> = { perfect: 100, nice: 60, ok: 30, miss: 0 };

/** むずかしさ係数（そのラウンドの得点にかける・仮値） */
export const DIFF_MULT: Record<PresetKey, number> = { easy: 1.0, normal: 1.2, hard: 1.5 };

/** min〜max の実数（rng 由来） */
function rrange(rng: () => number, min: number, max: number): number {
  return min + rng() * (max - min);
}

/**
 * count ラウンドぶんの設定を作る。
 * ターゲット中心は端に寄りすぎないよう 0.15〜0.85 に収める（どの位置も届く公平さのため）。
 */
export function makeRounds(rng: () => number, preset: PresetKey, count: number): Round[] {
  const band = BANDS[preset];
  const rounds: Round[] = [];
  for (let i = 0; i < count; i++) {
    rounds.push({
      center: rrange(rng, 0.15, 0.85),
      freq: band.freq * (1 + i * RAMP_PER_ROUND),
      perfectHalf: band.perfectHalf,
      niceHalf: band.niceHalf,
      okHalf: band.okHalf,
    });
  }
  return rounds;
}

/**
 * 経過ms・周波数から 0〜1 の三角波でマーカー位置を返す（0→1→0 をくり返す）。
 * 三角波なので速度は一定（両端で折り返す）。
 */
export function markerPos(elapsedMs: number, freq: number): number {
  const raw = (elapsedMs / 1000) * freq;
  let phase = raw % 1;
  if (phase < 0) phase += 1; // 念のため負を正規化
  return phase < 0.5 ? phase * 2 : 2 - phase * 2;
}

/** マーカー位置とラウンドから判定を返す */
export function judge(pos: number, round: Round): Tier {
  const d = Math.abs(pos - round.center);
  if (d <= round.perfectHalf) return 'perfect';
  if (d <= round.niceHalf) return 'nice';
  if (d <= round.okHalf) return 'ok';
  return 'miss';
}
