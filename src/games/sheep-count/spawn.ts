// =============================================================
// ひつじかぞえ（No.28）のウェーブ計画（DOM非依存・乱数注入）
// =============================================================
// - ラウンドごとに「どの動物が・いつ・どれくらいの速さで」柵を跳ぶかを先に全部決める。
//   rng 注入＝「今日のゲーム」では全員同じ群れ・同じ順番（かぞえ勝負が公平）。
// - R1=ひつじだけ／R2=ヤギが混ざる／R3=オオカミも混ざり速く・重なって跳ぶ。
// - import してよいのは game-api（types/helpers）と同一フォルダのみ（このファイルは依存なし）。

export type AnimalType = 'sheep' | 'goat' | 'wolf';

export const ANIMAL_EMOJI: Record<AnimalType, string> = { sheep: '🐑', goat: '🐐', wolf: '🐺' };

export interface SpawnEvent {
  type: AnimalType;
  /** ウェーブ開始からの登場時刻(ms) */
  at: number;
  /** 画面を横切るのにかかる時間(ms) */
  dur: number;
}

export interface WavePlan {
  events: SpawnEvent[];
  /** ひつじの数（＝正解） */
  sheep: number;
  /** まぎれもの（🐐＋🐺）の数 */
  decoys: number;
  /** ウェーブ全体の長さ(ms)。最後の動物が去って一息つくまで */
  waveMs: number;
}

/** ラウンド別パラメータ（0始まり。playtest調整前提の仮値） */
const ROUNDS = [
  { sheepMin: 6, sheepVar: 4, goats: [0, 0], wolves: [0, 0], gapMin: 1400, gapVar: 500, dur: 2600, overlapP: 0 },
  { sheepMin: 8, sheepVar: 5, goats: [2, 2], wolves: [0, 0], gapMin: 1050, gapVar: 450, dur: 2200, overlapP: 0.15 },
  { sheepMin: 10, sheepVar: 6, goats: [2, 2], wolves: [1, 1], gapMin: 750, gapVar: 400, dur: 1800, overlapP: 0.35 },
] as const;

export const ROUND_COUNT = ROUNDS.length;

/** ラウンドのウェーブ計画をつくる（rng 消費はラウンドと乱数値のみに依存＝決定論） */
export function makePlan(rng: () => number, round: number): WavePlan {
  const p = ROUNDS[Math.min(round, ROUNDS.length - 1)]!;
  const sheep = p.sheepMin + Math.floor(rng() * (p.sheepVar + 1));
  const goats = p.goats[0] + Math.floor(rng() * (p.goats[1] + 1));
  const wolves = p.wolves[0] + Math.floor(rng() * (p.wolves[1] + 1));

  // 動物の順番をシャッフル（Fisher–Yates・rng注入）
  const types: AnimalType[] = [
    ...Array.from({ length: sheep }, () => 'sheep' as const),
    ...Array.from({ length: goats }, () => 'goat' as const),
    ...Array.from({ length: wolves }, () => 'wolf' as const),
  ];
  for (let i = types.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = types[i]!;
    types[i] = types[j]!;
    types[j] = tmp;
  }

  // 登場時刻: 基本は gap を積み上げ、ときどき「かさなり」（ほぼ同時に2匹目）
  const events: SpawnEvent[] = [];
  let t = 600;
  for (const type of types) {
    events.push({ type, at: t, dur: p.dur });
    const overlap = rng() < p.overlapP;
    t += overlap ? 220 : p.gapMin + rng() * p.gapVar;
  }
  const last = events[events.length - 1]!;
  return { events, sheep, decoys: goats + wolves, waveMs: last.at + last.dur + 600 };
}
