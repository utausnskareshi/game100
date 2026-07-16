// =============================================================
// ぴょんこのみちわたり（No.59・道と川をわたる横断アクション）の純ロジック（DOM非依存・乱数注入）
// =============================================================
// - グリッド。下のスタートから 上のゴールへ。道路レーン＝車に当たると ミス。
//   川レーン＝丸太に乗れば安全・水に落ちると ミス。真ん中と上下は 安全地帯。
// - レーン構成・車/丸太の配置は rng 注入（ctx.random）。判定は純粋関数。
// - import してよいのは game-api と同一フォルダのみ（このファイルは依存なし）。

export const COLS = 9;
export const ROWS = 11;
export const GOAL_ROW = 0;
export const START_ROW = 10;
export const MEDIAN_ROW = 5;

export type LaneKind = 'goal' | 'start' | 'median' | 'road' | 'river';

export function laneKind(row: number): LaneKind {
  if (row === GOAL_ROW) return 'goal';
  if (row === START_ROW) return 'start';
  if (row === MEDIAN_ROW) return 'median';
  return row < MEDIAN_ROW ? 'river' : 'road';
}

export interface Entity {
  x: number; // 左端（セル単位・連続値）
  len: number; // 長さ（セル）
}
export interface Lane {
  kind: LaneKind;
  dir: number; // -1 or 1
  speed: number; // セル/秒
  len: number; // 車/丸太の長さ
  entities: Entity[];
}

/** road/river レーンを生成（rng 注入・決定論）。lanes[row] は road/river の行のみ非null */
export function makeLanes(rng: () => number): (Lane | null)[] {
  const lanes: (Lane | null)[] = [];
  for (let row = 0; row < ROWS; row++) {
    const kind = laneKind(row);
    if (kind !== 'road' && kind !== 'river') {
      lanes.push(null);
      continue;
    }
    const dir = rng() < 0.5 ? -1 : 1;
    const speed = 1.1 + rng() * 1.5; // 1.1〜2.6 セル/秒
    const len = kind === 'river' ? 2 + Math.floor(rng() * 2) : 1 + Math.floor(rng() * 2); // 川2-3 / 道1-2
    // すきま: 川は乗れるよう やや詰め・道は当たりにくいよう すきま広め
    const gap = kind === 'river' ? 1.4 + rng() * 1.2 : 2.2 + rng() * 2.0;
    const period = len + gap;
    const entities: Entity[] = [];
    let x = rng() * period - period; // 位相ずらし
    while (x < COLS + period) {
      entities.push({ x, len });
      x += period;
    }
    lanes.push({ kind, dir, speed, len, entities });
  }
  return lanes;
}

/** レーンの車/丸太を dt ぶん動かす（画面外へ出たら反対側へ回す・破壊的） */
export function stepLane(lane: Lane, dt: number, speedMult: number): void {
  const move = lane.dir * lane.speed * speedMult * dt;
  for (const e of lane.entities) {
    e.x += move;
    if (lane.dir > 0 && e.x > COLS + 1) e.x -= (COLS + 2 + lane.len);
    else if (lane.dir < 0 && e.x < -lane.len - 1) e.x += (COLS + 2 + lane.len);
  }
}

/** 道路: キャラ[charX,charX+1] が どれかの車に重なるか */
export function carHit(charX: number, lane: Lane): boolean {
  for (const e of lane.entities) {
    if (charX < e.x + e.len && charX + 1 > e.x) return true;
  }
  return false;
}

/** 川: キャラの中心が乗っている丸太（なければ null＝水に落ちる） */
export function logUnder(charX: number, lane: Lane): Entity | null {
  const c = charX + 0.5;
  for (const e of lane.entities) {
    if (c >= e.x && c <= e.x + e.len) return e;
  }
  return null;
}
