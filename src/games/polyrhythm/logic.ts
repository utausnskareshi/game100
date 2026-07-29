// =============================================================
// りょうてポリリズム（No.109・かくれゲーム）: 純ロジック（拍・判定）
// =============================================================
// - 左右の手で「べつべつの周期」を同時にきざむ。2:3 → 3:4 → 3:5 → 4:5。
// - ガイドは最初だけ。途中から消えるので、自分のリズム感だけで続ける（#104 と同じ考え方）。
// - 乱数を使わない完全固定の譜面＝だれがやっても同じ、満点もいつも同じ。
// - DOM 非依存。
// =============================================================

/** 1拍の長さ（ミリ秒）。約133BPM */
export const BEAT_MS = 450;
/** はじまる前の カウントイン（拍） */
export const INTRO_BEATS = 4;

export interface RhythmStage {
  /** ひだりを たたく間かく（拍） */
  left: number;
  /** みぎを たたく間かく（拍） */
  right: number;
  /** このステージの ぜんぶの拍 */
  beats: number;
  /** ガイドが出ている拍（ここを過ぎると 何も出なくなる） */
  guideBeats: number;
}

export const STAGES: RhythmStage[] = [
  { left: 2, right: 3, beats: 24, guideBeats: 8 },
  { left: 3, right: 4, beats: 24, guideBeats: 8 },
  { left: 3, right: 5, beats: 25, guideBeats: 10 },
  { left: 4, right: 5, beats: 25, guideBeats: 10 },
];

/** ぴったり／セーフ の はば（ミリ秒） */
export const PERFECT_MS = 90;
export const OK_MS = 200;
/** ぴったり／セーフ の点 */
export const PERFECT_PTS = 20;
export const OK_PTS = 10;
/** よけいに たたいた ときの 減点 */
export const EXTRA_PENALTY = 10;

/** その周期で たたく拍の一覧 */
export function beatsOf(period: number, total: number): number[] {
  const out: number[] = [];
  for (let b = 0; b < total; b += period) out.push(b);
  return out;
}

/** ズレ（ミリ秒・絶対値）から 点を出す */
export function judgePoints(absMs: number): number {
  if (absMs <= PERFECT_MS) return PERFECT_PTS;
  if (absMs <= OK_MS) return OK_PTS;
  return 0;
}

/** 1プレイで たたく回数（左右あわせて） */
export function totalTaps(): number {
  return STAGES.reduce((a, s) => a + beatsOf(s.left, s.beats).length + beatsOf(s.right, s.beats).length, 0);
}

/** ぜんぶ ぴったりだったときの点 */
export function maxScore(): number {
  return totalTaps() * PERFECT_PTS;
}

/** ステージの拍を「ひだり／みぎ／両方」に分けた表（ガイド表示用） */
export function laneBeats(stage: RhythmStage): { left: number[]; right: number[] } {
  return { left: beatsOf(stage.left, stage.beats), right: beatsOf(stage.right, stage.beats) };
}
