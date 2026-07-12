// =============================================================
// リズムでポン（No.32）の譜面生成・判定（DOM非依存・乱数注入）
// =============================================================
// - 8分音符のグリッドにノートを置いていく。同じレーンが続きすぎない・
//   ときどき両手同時（テンポが上がるほど増える）。rng 注入＝日替わりは全員同じ譜面。
// - 判定窓: |ずれ|≤60ms=ぴったり / ≤140ms=ナイス。140msより遠いタップは「空振り」
//   （ノートを消費しない）。ノートが +140ms 過ぎたら「みのがし」。
// - import してよいのは game-api（types/helpers）と同一フォルダのみ（このファイルは依存なし）。

export type TempoKey = 'slow' | 'normal' | 'fast';

export interface TempoPreset {
  bpm: number;
  /** ノートが画面上端から判定リングまで落ちる時間(ms) */
  approachMs: number;
  /** 両手同時ノートの確率 */
  doubleP: number;
  /** 各8分スロットにノートを置く確率 */
  noteP: number;
  /** 譜面のおおよその長さ(ms) */
  lengthMs: number;
}

export const TEMPOS: Record<TempoKey, TempoPreset> = {
  slow: { bpm: 88, approachMs: 1400, doubleP: 0, noteP: 0.5, lengthMs: 40_000 },
  normal: { bpm: 104, approachMs: 1200, doubleP: 0.08, noteP: 0.55, lengthMs: 40_000 },
  fast: { bpm: 122, approachMs: 1050, doubleP: 0.14, noteP: 0.6, lengthMs: 40_000 },
};

export const WINDOW_PERFECT = 60; // ms
export const WINDOW_NICE = 140;
export const POINT_PERFECT = 100;
export const POINT_NICE = 60;

export interface Note {
  /** 譜面開始からの時刻(ms) */
  t: number;
  /** 0=ひだり / 1=みぎ */
  lane: 0 | 1;
}

/**
 * 譜面をつくる。最初の2拍は休み（心の準備）。
 * ルール: 同じレーンは最大3連まで／両手同時はその両方を1個ずつ数える。
 */
export function makeChart(rng: () => number, tempo: TempoKey): Note[] {
  const p = TEMPOS[tempo];
  const half = 30_000 / p.bpm; // 8分音符(ms)
  const notes: Note[] = [];
  let sameLaneRun = 0;
  let lastLane: 0 | 1 = 0;
  const startAt = half * 4; // 2拍の休み
  for (let t = startAt; t <= p.lengthMs; t += half) {
    if (rng() >= p.noteP) continue; // 休符
    let lane: 0 | 1 = rng() < 0.5 ? 0 : 1;
    if (lane === lastLane && sameLaneRun >= 3) lane = lane === 0 ? 1 : 0; // 4連は禁止
    const isDouble = rng() < p.doubleP;
    if (isDouble) {
      notes.push({ t, lane: 0 }, { t, lane: 1 });
      sameLaneRun = 0;
    } else {
      notes.push({ t, lane });
      sameLaneRun = lane === lastLane ? sameLaneRun + 1 : 1;
      lastLane = lane;
    }
  }
  return notes;
}

export type Judge = 'perfect' | 'nice';

/** タップとノートのずれ(ms・絶対値)から判定。窓の外なら null（＝このノートは消費しない） */
export function judge(absDt: number): Judge | null {
  if (absDt <= WINDOW_PERFECT) return 'perfect';
  if (absDt <= WINDOW_NICE) return 'nice';
  return null;
}
