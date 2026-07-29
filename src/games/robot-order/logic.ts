// =============================================================
// ロボットめいれい（No.106・かくれゲーム）: 純ロジック（ステージと実行）
// =============================================================
// - 命令を並べてから ▶ で走らせる。走っている間は操作できない＝
//   「頭の中で最後まで動かしてから走らせる」のが遊び。
// - めいれい枠（main）とくりかえし枠（sub）の2本。main に置いた 🔁 は
//   sub の中身をまとめて実行する（＝手続き呼び出し）。sub に 🔁 は置けない（無限になるため）。
// - 枠の数は「最短手数ぴったり」に絞ってあるので、後半は 🔁 を使わないと入らない。
// - DOM 非依存。ステージの可解性と最短手数（par）はテストの全探索で検証している。
// =============================================================

/** 命令。F=すすむ / L=左まわり / R=右まわり / C=くりかえし枠を呼ぶ */
export type Cmd = 'F' | 'L' | 'R' | 'C';

/** 向き。0=うえ 1=みぎ 2=した 3=ひだり */
export const DIRS: ReadonlyArray<{ dx: number; dy: number }> = [
  { dx: 0, dy: -1 },
  { dx: 1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: -1, dy: 0 },
];

export interface Stage {
  /** 盤（'#'=かべ '.'=ゆか '*'=ほし 'S'=スタート）。すべて同じ長さの行 */
  map: string[];
  /** はじめの向き */
  dir: number;
  /** めいれい枠の数 */
  mainMax: number;
  /** くりかえし枠の数（0 のときは くりかえしを使わない面） */
  subMax: number;
  /** 最短の命令数（main+sub の合計）。テストで全探索して一致を確認している */
  par: number;
}

/**
 * 全5面。だんだん枠が足りなくなり、3面目からは くりかえしが必須になる。
 * ※ map / mainMax / subMax / par はテスト（全探索ソルバ）と一致していることを検証済み。
 */
export const STAGES: Stage[] = [
  // 1: すすむ と まがる をおぼえる（くりかえしなし）
  {
    map: ['......', '......', '..*.*.', '......', '..S...', '......'],
    dir: 0,
    mainMax: 5,
    subMax: 0,
    par: 5,
  },
  // 2: かべを よけて 2つ（くりかえしなし）
  {
    map: ['......', '*..*..', '.###..', '..#...', 'S.....', '......'],
    dir: 1,
    mainMax: 8,
    subMax: 0,
    par: 8,
  },
  // 3: はじめての くりかえし（まっすぐ2マスを 2回）
  {
    map: ['......', '......', '..*.*.', '......', '..S...', '......'],
    dir: 0,
    mainMax: 3,
    subMax: 2,
    par: 5,
  },
  // 4: 四かくを ぐるり（すすむ3＋まがる を 3回）
  {
    map: ['......', '.*..*.', '......', '......', '.S..*.', '......'],
    dir: 0,
    mainMax: 4,
    subMax: 4,
    par: 7,
  },
  // 5: かいだん（すすむ→みぎ→すすむ→ひだり を 4回）
  {
    map: ['......', '....*.', '...*..', '..*...', '.*....', 'S.....'],
    dir: 0,
    mainMax: 5,
    subMax: 4,
    par: 8,
  },
];

export interface Cell {
  x: number;
  y: number;
}

export interface StageInfo {
  w: number;
  h: number;
  walls: boolean[][];
  stars: Cell[];
  start: Cell;
}

/** 盤の文字列をほどく */
export function parseStage(st: Stage): StageInfo {
  const h = st.map.length;
  const w = st.map[0]!.length;
  const walls: boolean[][] = [];
  const stars: Cell[] = [];
  let start: Cell = { x: 0, y: 0 };
  for (let y = 0; y < h; y++) {
    const row: boolean[] = [];
    for (let x = 0; x < w; x++) {
      const c = st.map[y]![x]!;
      row.push(c === '#');
      if (c === '*') stars.push({ x, y });
      if (c === 'S') start = { x, y };
    }
    walls.push(row);
  }
  return { w, h, walls, stars, start };
}

/** 実行1ステップぶんの様子（アニメーション用） */
export interface Step {
  /** この命令を実行したあとの じょうたい */
  x: number;
  y: number;
  dir: number;
  /** この命令で とった ほしの番号（-1 は なし） */
  got: number;
  /** どの命令だったか */
  cmd: Cmd;
  /** main の何番目の命令から来たか（くりかえしの中も 呼び出し元の番号にする） */
  from: number;
  /** かべ（または そと）に ぶつかって 動けなかったか */
  bumped: boolean;
}

export interface RunResult {
  steps: Step[];
  /** ぜんぶの ほしを とれたか */
  cleared: boolean;
}

/** 展開後の命令数の上限（暴走よけ。実際の面では 40 もあれば足りる） */
export const MAX_STEPS = 120;

/**
 * プログラムを走らせる。main の 'C' は sub の中身に置きかわる。
 * ほしを ぜんぶ とった時点で 止まる（そこから先の命令は実行しない）。
 */
export function runProgram(st: Stage, main: Cmd[], sub: Cmd[]): RunResult {
  const info = parseStage(st);
  // main を展開（'C' → sub の中身。sub の中に 'C' は入れられない仕様）
  const flat: { cmd: Cmd; from: number }[] = [];
  for (let i = 0; i < main.length; i++) {
    const c = main[i]!;
    if (c === 'C') {
      for (const s of sub) {
        if (s === 'C') continue;
        flat.push({ cmd: s, from: i });
      }
    } else {
      flat.push({ cmd: c, from: i });
    }
    if (flat.length > MAX_STEPS) break;
  }

  let { x, y } = info.start;
  let dir = st.dir;
  const taken = new Set<number>();
  const steps: Step[] = [];
  const starAt = (cx: number, cy: number): number => info.stars.findIndex((s) => s.x === cx && s.y === cy);

  // スタートの上に ほしが あることもある（今の面には無いが 仕様として拾っておく）
  const s0 = starAt(x, y);
  if (s0 >= 0) taken.add(s0);

  for (const f of flat) {
    let got = -1;
    let bumped = false;
    if (f.cmd === 'L') dir = (dir + 3) % 4;
    else if (f.cmd === 'R') dir = (dir + 1) % 4;
    else if (f.cmd === 'F') {
      const d = DIRS[dir]!;
      const nx = x + d.dx;
      const ny = y + d.dy;
      if (nx < 0 || ny < 0 || nx >= info.w || ny >= info.h || info.walls[ny]![nx]!) {
        bumped = true; // かべは 通れないだけ（しっぱいにはしない）
      } else {
        x = nx;
        y = ny;
        const si = starAt(x, y);
        if (si >= 0 && !taken.has(si)) {
          taken.add(si);
          got = si;
        }
      }
    }
    steps.push({ x, y, dir, got, cmd: f.cmd, from: f.from, bumped });
    if (taken.size >= info.stars.length) break;
  }
  return { steps, cleared: taken.size >= info.stars.length };
}

/** 使った命令の数（main + sub。sub は 'C' が1つでもあるときだけ数える） */
export function usedCount(main: Cmd[], sub: Cmd[]): number {
  const useSub = main.some((c) => c === 'C');
  return main.length + (useSub ? sub.length : 0);
}

/** ステージの点（走らせた回数が少ないほど高い） */
export function stageScore(runs: number): number {
  return Math.max(80, 320 - (runs - 1) * 60);
}
