// =============================================================
// せんろつなぎ（No.30）の盤面生成・接続判定（DOM非依存・乱数注入）
// =============================================================
// - 「正解の道を先に彫ってから、全タイルをランダム回転で崩す」＝必ず解ける保証つき生成。
// - タイルは接続ビットマスク（N=1/E=2/S=4/W=8）。まっすぐ(2方向対面)とカーブ(2方向隣接)の2種。
// - 回転はビットの巡回（タップ1回=時計回りに90°）。
// - rng 注入＝「今日のゲーム」では全員同じ盤面。
// - import してよいのは game-api（types/helpers）と同一フォルダのみ（このファイルは依存なし）。

export const BIT_N = 1;
export const BIT_E = 2;
export const BIT_S = 4;
export const BIT_W = 8;

/** マスクを時計回りに90°回す（N→E→S→W→N） */
export function rotMask(m: number): number {
  return ((m << 1) & 15) | (m & 8 ? 1 : 0);
}

/** まっすぐ（N|S or E|W）か */
export const isStraight = (m: number): boolean => m === (BIT_N | BIT_S) || m === (BIT_E | BIT_W);

/** cur を何回タップ（90°CW）すれば sol と同じ通り方になるか（まっすぐは180°対称） */
export function minTaps(cur: number, sol: number): number {
  let m = cur;
  for (let k = 0; k < 4; k++) {
    if (m === sol) return k;
    m = rotMask(m);
  }
  return 0; // 到達しない（同種タイル同士なら必ず一致する）
}

export interface Puzzle {
  n: number;
  /** 左端の入口の行（🚉）。列0のこのマスへ西から入る */
  entryY: number;
  /** 右端の出口の行（🏁）。列n-1のこのマスから東へ出る */
  exitY: number;
  /** 崩したあとの盤面（プレイ開始状態） */
  masks: number[];
  /** 正解（彫った道の向き。かざりタイルは崩す前の向き） */
  solution: number[];
  /** 彫った道のマス index 列（入口→出口） */
  path: number[];
  /** 彫った道を戻すのに必要な最小タップ数（＝パー。かざりは数えない） */
  par: number;
}

const DIRS = [
  { bit: BIT_N, dx: 0, dy: -1, opp: BIT_S },
  { bit: BIT_E, dx: 1, dy: 0, opp: BIT_W },
  { bit: BIT_S, dx: 0, dy: 1, opp: BIT_N },
  { bit: BIT_W, dx: -1, dy: 0, opp: BIT_E },
];

const ALL_TILES = [BIT_N | BIT_S, BIT_E | BIT_W, BIT_N | BIT_E, BIT_E | BIT_S, BIT_S | BIT_W, BIT_W | BIT_N];

/** 入口から出口まで実際に線路がつながっていれば、そのマス列（入口→出口）を返す */
export function connectedPath(masks: number[], n: number, entryY: number, exitY: number): number[] | null {
  const startIdx = entryY * n;
  const goalIdx = exitY * n + (n - 1);
  if ((masks[startIdx]! & BIT_W) === 0) return null; // 入口は西口が必要
  const prev = new Int16Array(n * n).fill(-2);
  prev[startIdx] = -1;
  const queue = [startIdx];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (cur === goalIdx && (masks[cur]! & BIT_E) !== 0) {
      const path: number[] = [];
      let c = cur;
      while (c !== -1) {
        path.unshift(c);
        c = prev[c]!;
      }
      return path;
    }
    const cx = cur % n;
    const cy = (cur - cx) / n;
    for (const d of DIRS) {
      if ((masks[cur]! & d.bit) === 0) continue;
      const nx = cx + d.dx;
      const ny = cy + d.dy;
      if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
      const ni = ny * n + nx;
      if (prev[ni] !== -2) continue;
      if ((masks[ni]! & d.opp) === 0) continue; // 相手側も口が向いていること
      prev[ni] = cur;
      queue.push(ni);
    }
  }
  return null;
}

/** パズルを生成する（必ず解ける・開始時点では未開通を保証） */
export function generatePuzzle(rng: () => number, n: number): Puzzle {
  const entryY = Math.floor(n / 2);
  const exitY = Math.floor(n / 2);
  const startIdx = entryY * n;
  const goalIdx = exitY * n + (n - 1);

  // 1) 入口→出口のランダムな一本道を彫る（DFS・rngシャッフル・自己交差なし）
  const visited = new Uint8Array(n * n);
  const path: number[] = [];
  const dfs = (cur: number): boolean => {
    visited[cur] = 1;
    path.push(cur);
    if (cur === goalIdx) return true;
    const cx = cur % n;
    const cy = (cur - cx) / n;
    const order = [...DIRS];
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = order[i]!;
      order[i] = order[j]!;
      order[j] = t;
    }
    for (const d of order) {
      const nx = cx + d.dx;
      const ny = cy + d.dy;
      if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
      const ni = ny * n + nx;
      if (visited[ni]) continue;
      if (dfs(ni)) return true;
    }
    path.pop();
    return false;
  };
  dfs(startIdx); // グリッドは連結なので必ず見つかる

  // 2) 道のマスに「入った向き→出る向き」の口をつける
  const solution = new Array<number>(n * n).fill(0);
  for (let i = 0; i < path.length; i++) {
    const cur = path[i]!;
    let mask = 0;
    // 入る口（先頭は西の入口から）。cur から見て prev がある向きに口をあける
    if (i === 0) mask |= BIT_W;
    else {
      const prev = path[i - 1]!;
      const d = DIRS.find((v) => prev === cur + v.dy * n + v.dx)!;
      mask |= d.bit;
    }
    // 出る口（末尾は東の出口へ）
    if (i === path.length - 1) mask |= BIT_E;
    else {
      const next = path[i + 1]!;
      const d = DIRS.find((v) => next === cur + v.dy * n + v.dx)!;
      mask |= d.bit;
    }
    solution[cur] = mask;
  }
  // 3) かざり（道でないマス）はランダムなタイル
  for (let i = 0; i < n * n; i++) {
    if (solution[i] === 0) solution[i] = ALL_TILES[Math.floor(rng() * ALL_TILES.length)]!;
  }

  // 4) 全タイルをランダム回転で崩す
  const masks = solution.map((m) => {
    let v = m;
    const k = Math.floor(rng() * 4);
    for (let t = 0; t < k; t++) v = rotMask(v);
    return v;
  });

  // 5) 偶然つながっていたら、道のタイルを1つずつ回して必ず未開通にする
  let attempt = 0;
  while (connectedPath(masks, n, entryY, exitY) !== null && attempt < path.length) {
    const idx = path[attempt]!;
    masks[idx] = rotMask(masks[idx]!);
    attempt++;
  }

  // 6) パー＝彫った道を戻す最小タップ数
  let par = 0;
  for (const idx of path) par += minTaps(masks[idx]!, solution[idx]!);

  return { n, entryY, exitY, masks, solution, path, par };
}
