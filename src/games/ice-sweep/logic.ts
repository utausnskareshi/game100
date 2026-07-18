// =============================================================
// こおりみがき（No.80）の盤面生成・スライド・採点（DOM非依存・純ロジック）
// =============================================================
// - ロボットはスワイプした方向へ「壁（雪）か岩まで」すべる。通ったマスがピカピカになる。
//   ぜんぶのマスを磨けたらラウンドクリア。よごれマスは2回通す（ラウンド3のみ）。
// - 【解けることの保証】盤面は「まっすぐの滑走を繰り返すランダムウォーク」で氷の通路を彫り、
//   岩を置いたあと、貪欲ソルバ（ランダムリスタート）が実際に解を1本見つけたものだけ採用する。
//   par＝見つけた解の手数（＝必ず到達可能なめやす）。見つからなければ再生成し、
//   上限を超えたら 蛇行コリドーのフォールバック盤（構造的に可解・解も自明）を使う。
// - よごれマスは「見つけた解が2回以上通るマス」から選ぶ＝同じ解がそのまま通用する。
// - 乱数は ctx.random 注入＝完全決定論（今日のゲームで全員同じ盤面）。
// - import してよいのは game-api と同一フォルダのみ（このファイルは依存なし）。

export const W = 360;
export const H = 640;

export const BANK = 0; // 雪（すべり止めの壁）
export const ICE = 1;
export const ROCK = 2;

export type Dir = 'up' | 'down' | 'left' | 'right';
export const DIRS: Record<Dir, { dx: number; dy: number }> = {
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
};
export const DIR_LIST: Dir[] = ['up', 'down', 'left', 'right'];

export interface Pos {
  x: number;
  y: number;
}

export interface RoundCfg {
  w: number;
  h: number;
  runs: number; // 彫るときの滑走回数
  maxRun: number; // 1滑走の最大マス数
  rocks: number;
  dirty: number; // よごれマス数（最大値・候補が少なければ減る）
  minIce: number; // 氷マスの最低数（少なすぎる盤は作り直し）
}

export const ROUNDS: RoundCfg[] = [
  { w: 7, h: 8, runs: 10, maxRun: 5, rocks: 0, dirty: 0, minIce: 16 },
  { w: 8, h: 9, runs: 13, maxRun: 6, rocks: 2, dirty: 0, minIce: 22 },
  { w: 8, h: 10, runs: 15, maxRun: 6, rocks: 2, dirty: 4, minIce: 26 },
];

export interface Board {
  w: number;
  h: number;
  cells: number[]; // BANK / ICE / ROCK
  start: Pos;
  dirty: boolean[]; // ICE のうち2回磨きが必要なマス
  par: number;
  solution: Dir[]; // 生成時に実在を確認した解（ゲーム中は使わない）
  fallback: boolean;
}

export function idxOf(b: { w: number }, x: number, y: number): number {
  return y * b.w + x;
}

export function walkable(b: Board, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= b.w || y >= b.h) return false;
  return b.cells[idxOf(b, x, y)] === ICE;
}

/** (x,y) から dir へ滑る。動けないなら null。path は通った（入った）マスの列 */
export function slide(b: Board, x: number, y: number, dir: Dir): { path: Pos[]; ex: number; ey: number } | null {
  const { dx, dy } = DIRS[dir];
  if (!walkable(b, x + dx, y + dy)) return null;
  const path: Pos[] = [];
  let cx = x;
  let cy = y;
  while (walkable(b, cx + dx, cy + dy)) {
    cx += dx;
    cy += dy;
    path.push({ x: cx, y: cy });
  }
  return { path, ex: cx, ey: cy };
}

/** 必要な磨き回数の初期配列（ICE=1・よごれ=2・それ以外0）。start は磨き済み扱い */
export function initialRemaining(b: Board): number[] {
  const rem = b.cells.map((c, i) => (c === ICE ? (b.dirty[i] ? 2 : 1) : 0));
  rem[idxOf(b, b.start.x, b.start.y)] = 0;
  return rem;
}

/** 解（方向列）を再生して全マス磨けるか検証する（プロパティテスト・生成の最終確認用） */
export function replaySolution(b: Board, moves: Dir[]): boolean {
  const rem = initialRemaining(b);
  let x = b.start.x;
  let y = b.start.y;
  for (const d of moves) {
    const s = slide(b, x, y, d);
    if (!s) return false;
    for (const p of s.path) {
      const i = idxOf(b, p.x, p.y);
      if ((rem[i] ?? 0) > 0) rem[i] = (rem[i] ?? 0) - 1;
    }
    x = s.ex;
    y = s.ey;
  }
  return rem.every((r) => r === 0);
}

// ---- 生成 ----

/**
 * 「実際のスライドとして成立する走行」を記録しながら氷を彫る。
 * 各走行の終点の1つ先（stopper）を永久予約（＝ずっと雪のまま）にするので、
 * 完成盤で記録どおりに滑ると 必ず同じ場所で止まる ＝ 記録した走行列がそのまま解になる。
 * （開けた空間で「止まれず磨き切れない」盤が構造的にできない）
 */
function carveWalk(
  rng: () => number,
  cfg: RoundCfg,
): { cells: number[]; start: Pos; walk: Dir[]; reserved: number[] } | null {
  const cells = new Array<number>(cfg.w * cfg.h).fill(BANK);
  const reserved = new Set<number>();
  const sx = 1 + Math.floor(rng() * (cfg.w - 2));
  const sy = 1 + Math.floor(rng() * (cfg.h - 2));
  cells[sy * cfg.w + sx] = ICE;
  let x = sx;
  let y = sy;
  let lastDir: Dir | null = null;
  const walk: Dir[] = [];
  for (let r = 0; r < cfg.runs; r++) {
    // 候補（向き×長さ）を列挙: 経路が盤内かつ予約セルを踏まず、終点の1つ先が氷でないこと
    const cands: { dir: Dir; len: number }[] = [];
    for (const dir of DIR_LIST) {
      if (lastDir && DIRS[dir].dx === -DIRS[lastDir].dx && DIRS[dir].dy === -DIRS[lastDir].dy) continue; // 逆戻りは選ばない
      const { dx, dy } = DIRS[dir];
      for (let len = 2; len <= cfg.maxRun; len++) {
        let ok = true;
        for (let k = 1; k <= len; k++) {
          const nx = x + dx * k;
          const ny = y + dy * k;
          if (nx < 0 || ny < 0 || nx >= cfg.w || ny >= cfg.h || reserved.has(ny * cfg.w + nx)) {
            ok = false;
            break;
          }
        }
        if (!ok) continue;
        const bx = x + dx * (len + 1);
        const by = y + dy * (len + 1);
        const inB = bx >= 0 && by >= 0 && bx < cfg.w && by < cfg.h;
        if (inB && cells[by * cfg.w + bx] === ICE) continue; // 1つ先が氷だと止まれない
        cands.push({ dir, len });
      }
    }
    if (cands.length === 0) break;
    const pick = cands[Math.floor(rng() * cands.length)]!;
    const { dx, dy } = DIRS[pick.dir];
    for (let k = 1; k <= pick.len; k++) cells[(y + dy * k) * cfg.w + (x + dx * k)] = ICE;
    const bx = x + dx * (pick.len + 1);
    const by = y + dy * (pick.len + 1);
    if (bx >= 0 && by >= 0 && bx < cfg.w && by < cfg.h) reserved.add(by * cfg.w + bx);
    x += dx * pick.len;
    y += dy * pick.len;
    walk.push(pick.dir);
    lastDir = pick.dir;
  }
  if (walk.length < 4) return null;
  return { cells, start: { x: sx, y: sy }, walk, reserved: [...reserved] };
}

/**
 * 貪欲ソルバ（ランダムリスタート）: 新しく磨けるマスが最大の向きへ滑る。
 * 手詰まり（どの向きも新規0）のときは数回だけランダムに動いて脱出を試みる。
 */
function greedySolve(b: Board, rng: () => number, maxMoves: number): Dir[] | null {
  const rem = initialRemaining(b);
  let left = rem.reduce((a, r) => a + r, 0);
  let x = b.start.x;
  let y = b.start.y;
  const moves: Dir[] = [];
  let escapes = 0;
  while (left > 0 && moves.length < maxMoves) {
    let bestDir: Dir | null = null;
    let bestGain = 0;
    for (const d of DIR_LIST) {
      const s = slide(b, x, y, d);
      if (!s) continue;
      let gain = 0;
      for (const p of s.path) if ((rem[idxOf(b, p.x, p.y)] ?? 0) > 0) gain++;
      if (gain > bestGain || (gain === bestGain && gain > 0 && rng() < 0.35)) {
        bestGain = gain;
        bestDir = d;
      }
    }
    if (bestGain === 0) {
      // 脱出: ランダムに1手（数回まで）
      if (++escapes > 8) return null;
      const options = DIR_LIST.filter((d) => slide(b, x, y, d));
      if (options.length === 0) return null;
      bestDir = options[Math.floor(rng() * options.length)] ?? options[0]!;
    }
    const s = slide(b, x, y, bestDir!);
    if (!s) return null;
    for (const p of s.path) {
      const i = idxOf(b, p.x, p.y);
      if ((rem[i] ?? 0) > 0) {
        rem[i] = (rem[i] ?? 0) - 1;
        left--;
      }
    }
    x = s.ex;
    y = s.ey;
    moves.push(bestDir!);
  }
  return left === 0 ? moves : null;
}

/** 蛇行コリドーのフォールバック盤（構造的に可解・解も自明に構成できる） */
export function serpentine(cfg: RoundCfg): Board {
  const cells = new Array<number>(cfg.w * cfg.h).fill(BANK);
  const rows: number[] = [];
  for (let y = 0; y < cfg.h; y += 2) rows.push(y);
  for (const y of rows) for (let x = 0; x < cfg.w; x++) cells[y * cfg.w + x] = ICE;
  // 接続マス（右はし・左はし を交互に）
  for (let k = 0; k < rows.length - 1; k++) {
    const y = rows[k]! + 1;
    const x = k % 2 === 0 ? cfg.w - 1 : 0;
    cells[y * cfg.w + x] = ICE;
  }
  const b: Board = {
    w: cfg.w,
    h: cfg.h,
    cells,
    start: { x: 0, y: 0 },
    dirty: new Array<boolean>(cfg.w * cfg.h).fill(false),
    par: 0,
    solution: [],
    fallback: true,
  };
  // 自明解: 右→下→左→下→右→…（接続マスを通って次の行へ）
  const moves: Dir[] = [];
  for (let k = 0; k < rows.length; k++) {
    moves.push(k % 2 === 0 ? 'right' : 'left');
    if (k < rows.length - 1) moves.push('down');
  }
  b.solution = moves;
  b.par = moves.length;
  return b;
}

/** ラウンド盤面を生成する（記録した走行＝構成的な解。だめならフォールバック） */
export function generate(rng: () => number, cfg: RoundCfg): Board {
  for (let attempt = 0; attempt < 25; attempt++) {
    const carved = carveWalk(rng, cfg);
    if (!carved) continue;
    const { cells, start, walk, reserved } = carved;
    const iceCount = cells.filter((c) => c === ICE).length;
    if (iceCount < cfg.minIce) continue;
    const b: Board = {
      w: cfg.w,
      h: cfg.h,
      cells: cells.slice(),
      start,
      dirty: new Array<boolean>(cfg.w * cfg.h).fill(false),
      par: 0,
      solution: [],
      fallback: false,
    };
    // stopper（走行を止めている予約セル）のいくつかを岩の見た目にする（どちらも壁＝可解性に影響なし）
    const rockCands = reserved.slice();
    let rocks = Math.min(cfg.rocks, rockCands.length);
    while (rocks > 0 && rockCands.length > 0) {
      const i = rockCands.splice(Math.floor(rng() * rockCands.length), 1)[0]!;
      b.cells[i] = ROCK;
      rocks--;
    }
    // 解: 記録した走行（構成的に有効）と、貪欲ソルバの発見のうち短いほう
    let best: Dir[] = walk;
    for (let k = 0; k < 40; k++) {
      const sol = greedySolve(b, rng, 220);
      if (sol && sol.length < best.length) best = sol;
    }
    // よごれマス: 採用する解が2回以上通るマスから選ぶ（同じ解がそのまま通用する）
    if (cfg.dirty > 0) {
      const visits = new Array<number>(cfg.w * cfg.h).fill(0);
      let x = start.x;
      let y = start.y;
      for (const d of best) {
        const s = slide(b, x, y, d);
        if (!s) break;
        for (const p of s.path) visits[idxOf(b, p.x, p.y)] = (visits[idxOf(b, p.x, p.y)] ?? 0) + 1;
        x = s.ex;
        y = s.ey;
      }
      const cand: number[] = [];
      for (let i = 0; i < visits.length; i++) {
        if ((visits[i] ?? 0) >= 2 && b.cells[i] === ICE && !(i === idxOf(b, start.x, start.y))) cand.push(i);
      }
      let need = Math.min(cfg.dirty, cand.length);
      while (need > 0 && cand.length > 0) {
        const pick = Math.floor(rng() * cand.length);
        const i = cand.splice(pick, 1)[0]!;
        b.dirty[i] = true;
        need--;
      }
    }
    b.solution = best;
    b.par = best.length;
    // 最終確認（よごれ込みで解が通ることを再生で保証）
    if (!replaySolution(b, best)) continue;
    return b;
  }
  return serpentine(cfg);
}

// ---- 採点 ----
export const CLEAR_BASE = 150;
export const PAR_BONUS = 100;
export const PAR_PENALTY = 10; // めやす超過1手ごと
export const SPEED_MAX = 90;

export function roundPoints(moves: number, par: number, sec: number): { base: number; parBonus: number; speed: number; total: number } {
  const base = CLEAR_BASE;
  const parBonus = moves <= par ? PAR_BONUS : Math.max(0, PAR_BONUS - PAR_PENALTY * (moves - par));
  const speed = Math.max(0, SPEED_MAX - Math.floor(sec));
  return { base, parBonus, speed, total: base + parBonus + speed };
}
