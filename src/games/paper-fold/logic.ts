// =============================================================
// おりがみパズル（No.110・かくれゲーム）: 純ロジック（紙を折る・出題・ソルバ）
// =============================================================
// - 紙を 線で 半分に折ると、ほしが かさなっていく。ぜんぶの ほしを 1マスに
//   かさねられたら クリア。折れる回数は ぴったりしか ない。
// - 折る向き（左を右に／右を左に）は「小さいほうが 大きいほうに かぶさる」で決める。
//   ※ どちらに折っても「どのマスとどのマスが重なるか」は同じなので、遊びの深さは変わらない。
//     変わるのは 折ったあとの 位置だけ＝操作を「線を1回タップ」に できる。
// - 出題は「折り手じゅんを先に決めて、同じマスに落ちる場所へ ほしを置く」構成的生成。
//   ＝ 必ず解ける。そのうえで ソルバで「最短が ぴったり その回数」になるまで 作り直す。
// - DOM 非依存・rng 注入＝決定論。
// =============================================================

export type FoldAxis = 'v' | 'h';

export interface Fold {
  axis: FoldAxis;
  /** 内部の 折り線（1 〜 size-1）。この線で 二つに分かれる */
  line: number;
}

export interface Sheet {
  w: number;
  h: number;
  /** cells[y][x] = そのマスに かさなっている ほしの番号 */
  cells: number[][][];
}

export function emptySheet(w: number, h: number): Sheet {
  const cells: number[][][] = [];
  for (let y = 0; y < h; y++) {
    const row: number[][] = [];
    for (let x = 0; x < w; x++) row.push([]);
    cells.push(row);
  }
  return { w, h, cells };
}

export function cloneSheet(s: Sheet): Sheet {
  return { w: s.w, h: s.h, cells: s.cells.map((r) => r.map((c) => c.slice())) };
}

/** その紙で 折れる線を ぜんぶ */
export function foldOptions(s: Sheet): Fold[] {
  const out: Fold[] = [];
  for (let k = 1; k < s.w; k++) out.push({ axis: 'v', line: k });
  for (let k = 1; k < s.h; k++) out.push({ axis: 'h', line: k });
  return out;
}

/**
 * 折る。線 k で 二つに分け、小さいほうを 大きいほうに かぶせる（同じ大きさなら 手前を 奥へ）。
 * 折り返しは 線を 鏡にして x → 2k-1-x に うつる。
 */
export function applyFold(s: Sheet, f: Fold): Sheet {
  if (f.axis === 'v') {
    const k = f.line;
    if (k < 1 || k >= s.w) return cloneSheet(s);
    const foldLeft = k <= s.w - k; // 左が 小さいか 同じ → 左を 右へ
    const nw = foldLeft ? s.w - k : k;
    const out = emptySheet(nw, s.h);
    for (let y = 0; y < s.h; y++) {
      for (let x = 0; x < s.w; x++) {
        const src = s.cells[y]![x]!;
        if (src.length === 0) continue;
        const nx = foldLeft ? (x < k ? k - 1 - x : x - k) : x < k ? x : 2 * k - 1 - x;
        out.cells[y]![nx]!.push(...src);
      }
    }
    return out;
  }
  const k = f.line;
  if (k < 1 || k >= s.h) return cloneSheet(s);
  const foldTop = k <= s.h - k;
  const nh = foldTop ? s.h - k : k;
  const out = emptySheet(s.w, nh);
  for (let y = 0; y < s.h; y++) {
    const ny = foldTop ? (y < k ? k - 1 - y : y - k) : y < k ? y : 2 * k - 1 - y;
    for (let x = 0; x < s.w; x++) {
      const src = s.cells[y]![x]!;
      if (src.length === 0) continue;
      out.cells[ny]![x]!.push(...src);
    }
  }
  return out;
}

/** ほしが 1マスに ぜんぶ かさなったか */
export function isSolved(s: Sheet): boolean {
  let used = 0;
  for (const row of s.cells) for (const c of row) if (c.length > 0) used++;
  return used === 1;
}

/** ほしの数 */
export function starCount(s: Sheet): number {
  let n = 0;
  for (const row of s.cells) for (const c of row) n += c.length;
  return n;
}

/**
 * 最短の 折り手じゅん（max 回まで さがす）。解けなければ null。
 * 線は最大10本・深さは最大5なので、素直な 反復深化で十分に速い。
 */
export function solveFolds(s: Sheet, max: number): Fold[] | null {
  for (let depth = 0; depth <= max; depth++) {
    const p = dfsPath(s, depth);
    if (p) return p;
  }
  return null;
}

function dfsPath(s: Sheet, left: number): Fold[] | null {
  if (isSolved(s)) return [];
  if (left === 0) return null;
  for (const f of foldOptions(s)) {
    const r = dfsPath(applyFold(s, f), left - 1);
    if (r) return [f, ...r];
  }
  return null;
}

/** 最短の 折り回数（max まで さがす）。見つからなければ -1 */
export function minFolds(s: Sheet, max: number): number {
  const p = solveFolds(s, max);
  return p ? p.length : -1;
}

export interface StageSpec {
  w: number;
  h: number;
  /** ほしの数 */
  stars: number;
  /** 折れる回数（＝最短。ぴったりしか ない） */
  folds: number;
}

export const STAGES: StageSpec[] = [
  { w: 4, h: 4, stars: 2, folds: 2 },
  { w: 5, h: 5, stars: 3, folds: 3 },
  { w: 6, h: 6, stars: 3, folds: 3 },
  { w: 6, h: 6, stars: 4, folds: 4 },
  { w: 6, h: 6, stars: 5, folds: 5 },
];

function pick(rng: () => number, n: number): number {
  return Math.floor(rng() * n);
}

/**
 * 1面ぶんの紙を作る。
 * ① でたらめな 折り手じゅんを 決める
 * ② 「その手じゅんで 同じマスに 落ちる もとのマス」を あつめる
 * ③ その中から ほしの数だけ えらんで 置く（＝必ず解ける）
 * ④ ソルバで 最短が ぴったり spec.folds になるまで やり直す（＝むだな余裕が ない）
 */
export function makeStage(rng: () => number, spec: StageSpec): Sheet {
  let fallback: Sheet | null = null;
  for (let attempt = 0; attempt < 80; attempt++) {
    // ① もとのマスに 通し番号を入れて 折ってみる
    const probe = emptySheet(spec.w, spec.h);
    for (let y = 0; y < spec.h; y++) {
      for (let x = 0; x < spec.w; x++) probe.cells[y]![x]!.push(y * spec.w + x);
    }
    let cur = probe;
    let ok = true;
    for (let i = 0; i < spec.folds; i++) {
      const opts = foldOptions(cur);
      if (opts.length === 0) {
        ok = false;
        break;
      }
      cur = applyFold(cur, opts[pick(rng, opts.length)]!);
    }
    if (!ok) continue;
    // ② 同じマスに 落ちた もとのマスの あつまり
    const groups: number[][] = [];
    for (const row of cur.cells) for (const c of row) if (c.length >= spec.stars) groups.push(c);
    if (groups.length === 0) continue;
    const group = groups[pick(rng, groups.length)]!.slice();
    // ③ その中から ほしの数だけ えらぶ
    for (let i = group.length - 1; i > 0; i--) {
      const j = pick(rng, i + 1);
      const t = group[i]!;
      group[i] = group[j]!;
      group[j] = t;
    }
    const chosen = group.slice(0, spec.stars);
    const sheet = emptySheet(spec.w, spec.h);
    chosen.forEach((idx, i) => {
      const x = idx % spec.w;
      const y = Math.floor(idx / spec.w);
      sheet.cells[y]![x]!.push(i);
    });
    if (!fallback) fallback = sheet;
    // ④ 最短が ぴったりか
    if (minFolds(sheet, spec.folds) === spec.folds) return sheet;
  }
  // ここに来ることは まず無いが、来ても「必ず解ける紙」を返す（回数は少し あまるだけ）
  return fallback ?? emptySheet(spec.w, spec.h);
}

/** ステージの点（やり直しが 少ないほど 高い） */
export function stageScore(attempts: number): number {
  return Math.max(100, 300 - (attempts - 1) * 50);
}
