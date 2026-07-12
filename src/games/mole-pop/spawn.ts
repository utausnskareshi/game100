// =============================================================
// もぐらポンポン（No.22）のロジック（DOM非依存・乱数注入）
// =============================================================
// - rollSpawn: あいている穴から1つと、出てくる種類（もぐら/金/ばくだん）を決める。
//   すべて注入 rng 由来＝「今日のゲーム」では全員同じ出現列になる。
// - import してよいのは game-api（types/helpers）と同一フォルダのみ（このファイルは依存なし）。

export type MoleKind = 'mole' | 'gold' | 'bomb';

export interface Spawn {
  hole: number;
  kind: MoleKind;
}

const GOLD_P = 0.07;

/** レベルが上がるほど ばくだん率が少し上がる（0.10→最大0.20） */
export function bombP(level: number): number {
  return Math.min(0.1 + level * 0.02, 0.2);
}

/**
 * あいている穴（freeHoles）から1つ選び、種類を抽選する。あいていなければ null。
 * rng の消費数は「穴選び1回＋種類1回」で常に一定（決定論を保ちやすくする）。
 */
export function rollSpawn(rng: () => number, level: number, freeHoles: number[]): Spawn | null {
  if (freeHoles.length === 0) return null;
  const hole = freeHoles[Math.floor(rng() * freeHoles.length)] ?? freeHoles[0]!;
  const r = rng();
  let kind: MoleKind;
  if (r < GOLD_P) kind = 'gold';
  else if (r < GOLD_P + bombP(level)) kind = 'bomb';
  else kind = 'mole';
  return { hole, kind };
}
