// =============================================================
// かげぶんしんタッグ（No.63）のステージとかげ再生（DOM非依存・純ロジック）
// =============================================================
// - 2幕制: 1回目（さくせん）の自分の動きを「かげ」として記録し、
//   2回目（ほんばん）はかげの再生と協力してとびらを開けゴールへ。
// - スイッチ床（p/q/r）は「だれかが乗っている間だけ」対応するとびら（P/Q/R）を開く。
//   1回目はとびらが全部閉じているため、キャラ1はとびらを通れない
//   （＝かげの再生経路がほんばんで矛盾しないことが構造的に保証される）。
// - ステージは手作り3面。解けることはE2Eテストのスクリプト解で実証する。
// - 乱数不使用（日替わりでも同一）。時間は呼び出し側が ctx.now で与える。
// - import してよいのは game-api と同一フォルダのみ（このファイルは依存なし）。

export const COLS = 8;
export const ROWS = 8;
/** 1マス移動にかかるミリ秒 */
export const MOVE_MS = 170;
/** さくせん（1回目）の記録上限 */
export const REC_MAX_MS = 30_000;
/** ほんばん（2回目）の制限時間 */
export const PLAY_MAX_MS = 40_000;
/** 移動アニメ中、進み54%までは出発マスに「乗っている」扱い */
export const OCCUPY_SWITCH = 0.54;

export const GEM_PTS = 30;
export const CLEAR_PTS = 100;
/** ほんばんの残り1秒ごとのボーナス */
export const TIME_PTS = 3;

export type Dir = 'up' | 'down' | 'left' | 'right';

export interface Stage {
  wall: boolean[];
  start1: number;
  start2: number;
  /** スイッチ床。door は doors のインデックス */
  plates: { cell: number; door: number }[];
  doors: { cell: number; ch: string }[];
  gems: number[];
  goal: number;
}

// 記号: #=かべ .=ゆか A=キャラ1 B=キャラ2 p/q/r=スイッチ床 P/Q/R=とびら *=ほうせき G=ゴール
const STAGE_ROWS: string[][] = [
  // ステージ1: スイッチ1つ。かげに乗ってもらい、とびらPを通ってゴールへ
  [
    '########',
    '#A..*.p#',
    '########',
    '#B...*.#',
    '######P#',
    '#G..*..#',
    '#......#',
    '########',
  ],
  // ステージ2: スイッチ2つ。pを踏む「時間」→qへ移動、の予定を立てる
  [
    '########',
    '#A*p..q#',
    '########',
    '#B..P.*#',
    '#####.##',
    '#..Q...#',
    '#G*..###',
    '########',
  ],
  // ステージ3: スイッチ3つのリレー。P→Q→Rの順に通る長い協力
  [
    '########',
    '#A*p.qr#',
    '########',
    '#B..P..#',
    '#####.##',
    '#.Q..*##',
    '#.*R..G#',
    '########',
  ],
];

const PLATE_CH = ['p', 'q', 'r'];
const DOOR_CH = ['P', 'Q', 'R'];

export function parseStage(rows: string[]): Stage {
  const wall: boolean[] = new Array(COLS * ROWS).fill(false);
  const plates: { cell: number; door: number }[] = [];
  const doors: { cell: number; ch: string }[] = [];
  const gems: number[] = [];
  let start1 = -1;
  let start2 = -1;
  let goal = -1;
  const plateAt: (number | undefined)[] = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const ch = rows[r]?.[c] ?? '#';
      const i = r * COLS + c;
      if (ch === '#') wall[i] = true;
      else if (ch === 'A') start1 = i;
      else if (ch === 'B') start2 = i;
      else if (ch === 'G') goal = i;
      else if (ch === '*') gems.push(i);
      else {
        const pi = PLATE_CH.indexOf(ch);
        if (pi >= 0) plateAt[pi] = i;
        const di = DOOR_CH.indexOf(ch);
        if (di >= 0) doors.push({ cell: i, ch });
      }
    }
  }
  // plate文字とdoor文字を対応づける（p→P, q→Q, r→R）
  for (let k = 0; k < PLATE_CH.length; k++) {
    const cell = plateAt[k];
    if (cell == null) continue;
    const di = doors.findIndex((d) => d.ch === DOOR_CH[k]);
    if (di >= 0) plates.push({ cell, door: di });
  }
  return { wall, start1, start2, plates, doors, gems, goal };
}

export function makeStages(): Stage[] {
  return STAGE_ROWS.map(parseStage);
}

export const colOf = (i: number): number => i % COLS;
export const rowOf = (i: number): number => Math.floor(i / COLS);

const DELTA: Record<Dir, number> = { up: -COLS, down: COLS, left: -1, right: 1 };

/**
 * from から dir へ1マス移動できるなら移動先セル、できないなら null。
 * かべと「閉じているとびら」は通れない（openDoors は doors のインデックス集合）。
 */
export function canMove(stage: Stage, from: number, dir: Dir, openDoors: Set<number>): number | null {
  const c = colOf(from);
  if (dir === 'left' && c === 0) return null;
  if (dir === 'right' && c === COLS - 1) return null;
  const to = from + DELTA[dir];
  if (to < 0 || to >= COLS * ROWS) return null;
  if (stage.wall[to]) return null;
  const di = stage.doors.findIndex((d) => d.cell === to);
  if (di >= 0 && !openDoors.has(di)) return null;
  return to;
}

/** 乗っている人たち（セル番号 or null）から、開いているとびらの集合を返す */
export function openDoorsFor(stage: Stage, occupants: (number | null)[]): Set<number> {
  const open = new Set<number>();
  for (const pl of stage.plates) {
    if (occupants.some((c) => c === pl.cell)) open.add(pl.door);
  }
  return open;
}

/** さくせんで記録した1手（t はフェーズ開始からのミリ秒） */
export interface MoveRec {
  t: number;
  from: number;
  to: number;
}

export interface Pose {
  /** 描画用のセル座標（小数） */
  cx: number;
  cy: number;
  /** スイッチ判定用の「乗っている」セル */
  cell: number;
}

/** 記録の再生: フェーズ開始から tau ミリ秒時点のかげの位置（記録が尽きたら最終セルに留まる） */
export function ghostPose(rec: MoveRec[], startCell: number, tau: number): Pose {
  let cur = startCell;
  for (const m of rec) {
    if (tau < m.t) break;
    if (tau < m.t + MOVE_MS) {
      const p = (tau - m.t) / MOVE_MS;
      const fx = colOf(m.from);
      const fy = rowOf(m.from);
      const tx = colOf(m.to);
      const ty = rowOf(m.to);
      return { cx: fx + (tx - fx) * p, cy: fy + (ty - fy) * p, cell: p < OCCUPY_SWITCH ? m.from : m.to };
    }
    cur = m.to;
  }
  return { cx: colOf(cur), cy: rowOf(cur), cell: cur };
}
