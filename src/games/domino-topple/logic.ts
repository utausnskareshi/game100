// =============================================================
// ドミノたおし（No.88）のコース・届き判定・倒れシミュレーション（DOM非依存・純ロジック）
// =============================================================
// - コース（折れ線パス）の上にドミノを置き、スタートで先頭から倒す。
//   となりへ届く条件: 間隔 ≤ 届きリーチ。リーチは「曲がり」と「かいだん」で縮む:
//     reach = BASE_REACH × max(0.45, 1 − CURVE_K × 曲がり角合計[rad]) × (かいだん重なりなら×0.7)
//   ＝カーブは詰めて置かないと止まる。ゴールのベルまでつながればクリア。
// - 置く前から全リンクの届き/不足が緑/赤で見える（公平）。むずかしさは
//   「のこり枚数ボーナス」が攻めた間隔を誘うこと（経済とリスクのトレードオフ）。
// - コースは固定3面（乱数不使用＝完全決定論）。シミュレーションは純関数。
// - import してよいのは game-api と同一フォルダのみ（このファイルは依存なし）。

export const W = 360;
export const H = 640;

export const BASE_REACH = 30;
export const CURVE_K = 0.55;
export const CURVE_FLOOR = 0.45;
export const STAIR_FACTOR = 0.7;
/** ドミノ同士の最小間隔（重なり防止） */
export const MIN_GAP = 9;
/** スタート台から1枚目への届き */
export const FIRST_REACH = 26;
/** ベル台への届き（さいごの1枚から） */
export const BELL_REACH = 26;
/** 倒れの伝わるはやさ（px/秒）と1枚の倒れ時間 */
export const TOPPLE_SPEED = 220;
export const FALL_MS = 240;
/** 星スポットの判定（この距離以内に置いたドミノが倒れたら獲得） */
export const STAR_R = 7;

export const BELL_PTS = 150;
export const FALLEN_PTS = 4;
export const STAR_PTS = 25;
export const LEFTOVER_PTS = 12;
export const RESTART_PENALTY = 30;
/** 実績: ドミノめいじん の閾値（ソルバボット1604実証・その約87%） */
export const SCORE_HI = 1400;

export interface Course {
  pts: [number, number][];
  /** かいだんゾーン（弧長 [s0,s1]） */
  stairs: [number, number][];
  /** 星スポットの弧長位置 */
  stars: number[];
  stock: number;
}

export interface PathInfo {
  len: number;
  /** 弧長 s → 座標 */
  posAt(s: number): { x: number; y: number };
  /** 弧長 s → 進行方向（rad） */
  headingAt(s: number): number;
  /** s1..s2 の曲がり角の合計（rad・絶対値和） */
  turnBetween(s1: number, s2: number): number;
  /** 点からパスへの最近傍（弧長と距離） */
  project(x: number, y: number): { s: number; dist: number };
}

export function buildPath(pts: [number, number][]): PathInfo {
  const segs: { x0: number; y0: number; dx: number; dy: number; len: number; ang: number; s0: number }[] = [];
  let acc = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const [x0, y0] = pts[i]!;
    const [x1, y1] = pts[i + 1]!;
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    segs.push({ x0, y0, dx: dx / len, dy: dy / len, len, ang: Math.atan2(dy, dx), s0: acc });
    acc += len;
  }
  // 頂点ごとの曲がり角（絶対値）と、その累積和（turnBetween 用）
  const vertexS: number[] = [];
  const vertexTurn: number[] = [];
  let turnAcc = 0;
  const turnPrefix: number[] = [0];
  for (let i = 1; i < segs.length; i++) {
    let d = segs[i]!.ang - segs[i - 1]!.ang;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    vertexS.push(segs[i]!.s0);
    vertexTurn.push(Math.abs(d));
    turnAcc += Math.abs(d);
    turnPrefix.push(turnAcc);
  }
  const len = acc;
  const clampS = (s: number): number => Math.max(0, Math.min(len, s));
  const segAt = (s: number) => {
    let lo = 0;
    let hi = segs.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (segs[mid]!.s0 <= s) lo = mid;
      else hi = mid - 1;
    }
    return segs[lo]!;
  };
  const turnUpTo = (s: number): number => {
    // s より手前（s0 ≤ s）にある頂点の曲がりの合計
    let lo = 0;
    let hi = vertexS.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (vertexS[mid]! <= s) lo = mid + 1;
      else hi = mid;
    }
    return turnPrefix[lo]!;
  };
  return {
    len,
    posAt(s: number) {
      const cs = clampS(s);
      const sg = segAt(cs);
      const d = cs - sg.s0;
      return { x: sg.x0 + sg.dx * d, y: sg.y0 + sg.dy * d };
    },
    headingAt(s: number) {
      return segAt(clampS(s)).ang;
    },
    turnBetween(s1: number, s2: number) {
      const a = clampS(Math.min(s1, s2));
      const b = clampS(Math.max(s1, s2));
      return turnUpTo(b) - turnUpTo(a);
    },
    project(x: number, y: number) {
      let best = { s: 0, dist: Infinity };
      for (const sg of segs) {
        const px = x - sg.x0;
        const py = y - sg.y0;
        const t = Math.max(0, Math.min(sg.len, px * sg.dx + py * sg.dy));
        const qx = sg.x0 + sg.dx * t;
        const qy = sg.y0 + sg.dy * t;
        const d = Math.hypot(x - qx, y - qy);
        if (d < best.dist) best = { s: sg.s0 + t, dist: d };
      }
      return best;
    },
  };
}

/** [a0,a1] と [b0,b1] が重なるか */
const overlaps = (a0: number, a1: number, b0: number, b1: number): boolean => a0 <= b1 && b0 <= a1;

/** s1 のドミノから s2 のドミノへ届く最大間隔（リーチ） */
export function reachBetween(path: PathInfo, course: Course, s1: number, s2: number): number {
  const turn = path.turnBetween(s1, s2);
  let r = BASE_REACH * Math.max(CURVE_FLOOR, 1 - CURVE_K * turn);
  for (const [a, b] of course.stairs) {
    if (overlaps(Math.min(s1, s2), Math.max(s1, s2), a, b)) {
      r *= STAIR_FACTOR;
      break;
    }
  }
  return r;
}

export interface SimResult {
  /** 倒れた枚数（先頭から連鎖が届いた枚数） */
  fallen: number;
  /** 各ドミノの倒れはじめ時刻（ms・スタート押下=0。倒れないものは -1） */
  fallAt: number[];
  bellRung: boolean;
  /** ベルが鳴る時刻（ms・鳴らないなら -1） */
  bellAt: number;
  starsHit: boolean[];
  /** 連鎖が止まったリンクの手前側 index（-1=止まらず/そもそも1枚目に届かず=-2） */
  stopAfter: number;
}

/** 配置（弧長の配列・未ソートでよい）を倒したときの結果（純関数） */
export function simulate(path: PathInfo, course: Course, placed: number[]): SimResult {
  const s = [...placed].sort((a, b) => a - b);
  const fallAt = new Array(placed.length).fill(-1);
  const order = [...placed.keys()].sort((a, b) => placed[a]! - placed[b]!);
  const res: SimResult = { fallen: 0, fallAt, bellRung: false, bellAt: -1, starsHit: course.stars.map(() => false), stopAfter: -2 };
  if (s.length === 0) return res;
  // スタート台 → 1枚目
  if (s[0]! > FIRST_REACH) return res;
  let t = 320; // ゆびで押すまでの間
  fallAt[order[0]!] = t;
  res.fallen = 1;
  let stopped = false;
  for (let i = 1; i < s.length; i++) {
    const gap = s[i]! - s[i - 1]!;
    if (gap > reachBetween(path, course, s[i - 1]!, s[i]!)) {
      res.stopAfter = i - 1;
      stopped = true;
      break;
    }
    t += (gap / TOPPLE_SPEED) * 1000 + 26;
    fallAt[order[i]!] = t;
    res.fallen++;
  }
  if (!stopped) {
    res.stopAfter = -1;
    const last = s[s.length - 1]!;
    if (path.len - last <= BELL_REACH) {
      res.bellRung = true;
      res.bellAt = t + ((path.len - last) / TOPPLE_SPEED) * 1000 + 120;
    }
  }
  // 星: 倒れたドミノが星スポットの近くにあるか
  course.stars.forEach((st, k) => {
    for (let i = 0; i < s.length; i++) {
      if (fallAt[order[i]!] >= 0 && Math.abs(s[i]! - st) <= STAR_R) {
        res.starsHit[k] = true;
        break;
      }
    }
  });
  return res;
}

/** レベル得点（ベルが鳴ったときだけ呼ぶ） */
export function levelScore(fallen: number, stars: number, leftover: number, restarts: number): number {
  return Math.max(0, BELL_PTS + fallen * FALLEN_PTS + stars * STAR_PTS + leftover * LEFTOVER_PTS - restarts * RESTART_PENALTY);
}

/**
 * ソルバ: リーチ×frac の間隔で先頭から詰めつつ、星（±6px）とベル圏
 * （[len−BELL_REACH+1, len−4]）を「範囲ターゲット」として必ず1本入れる配置を返す
 * （実在解の証明・ボット用）。点ターゲットだと角付近で「1本では届かず
 * 2本では MIN_GAP を割る」置けないポケットが生じるため、範囲で吸収する。
 * すべてのリンクが MIN_GAP ≤ gap ≤ reach×frac を満たすことを構成的に保証。
 */
export function solverPlan(path: PathInfo, course: Course, frac: number): number[] {
  const plan: number[] = [2];
  const maxStepAt = (cur: number): number => {
    let lo = MIN_GAP;
    let hi = BASE_REACH;
    for (let k = 0; k < 26; k++) {
      const mid = (lo + hi) / 2;
      if (mid <= reachBetween(path, course, cur, cur + mid) * frac) lo = mid;
      else hi = mid;
    }
    return lo;
  };
  // 範囲 [lo, hi]（幅 ≥ 12 が前提）に1本置くまで greedy に進める
  const stepToRange = (lo: number, hi: number): void => {
    let guard = 0;
    while (guard++ < 300) {
      const cur = plan[plan.length - 1]!;
      if (cur >= lo - 0.01) return; // すでに範囲内（or 通過済み）
      const g = maxStepAt(cur);
      if (cur + g >= lo) {
        plan.push(Math.min(cur + g, hi));
        return;
      }
      plan.push(cur + g);
    }
  };
  for (const st of [...course.stars].sort((a, b) => a - b)) {
    stepToRange(st - STAR_R + 1, st + STAR_R - 1);
  }
  stepToRange(path.len - BELL_REACH + 1, path.len - 4);
  return plan;
}

/** 固定3コース */
export function courses(): Course[] {
  return [
    {
      // コース1: 大きなS字（曲がりのきほん）
      pts: [
        [60, 140],
        [300, 140],
        [300, 300],
        [60, 300],
      ],
      stairs: [],
      stars: [330],
      stock: 36,
    },
    {
      // コース2: くの字＋かいだん
      pts: [
        [50, 120],
        [310, 120],
        [310, 230],
        [120, 230],
        [120, 380],
        [300, 380],
      ],
      stairs: [[430, 540]],
      stars: [200, 640],
      stock: 53,
    },
    {
      // コース3: 長いつづら折り＋かいだん2つ
      pts: [
        [40, 110],
        [320, 110],
        [320, 210],
        [70, 210],
        [70, 330],
        [320, 330],
        [320, 440],
        [140, 440],
      ],
      // かいだんは角（頂点）と重ねない: 角×かいだんの複合でリーチが最小間隔9pxを
      // 下回る「置けない区間」ができるのを防ぐ（頂点 s=380,1000 を避けて配置）
      stairs: [
        [420, 560],
        [800, 930],
      ],
      stars: [160, 620, 1080],
      stock: 76,
    },
  ];
}
