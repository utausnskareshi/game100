// =============================================================
// ふたつの せかい（No.122・かくれゲーム）: 純ロジック（コース生成）
// =============================================================
// - 上と下の せかいに 1人ずつ。**タップ1回で 2人が 同時に ジャンプ**する。
//   ＝入力は1つ。だから「上でも 下でも 安全な しゅんかん」しか 押せない。
// - コースは「先に ジャンプの 時こく表（taps）を 決めて、それに 合う所だけに
//   じゃまものを 置く」構成的生成＝**かならず 全部 かわせる**。
// - 上と下で 流れる はやさが ちがうので、同じ時こくでも 見える 位置が ちがう
//   ＝両方を 見て 読む必要がある（＝むずかしさの 出どころ）。
// - DOM 非依存・rng 注入＝決定論。
// =============================================================

/** 空中に いる 時間（ミリ秒） */
export const AIR_MS = 620;
/** 走る人の 画面上の 位置 */
export const RUN_X = 70;
/** 上・下の せかいの 流れる はやさ（px/秒） */
export const SPEED = [150, 205];

/** じゃまもの。spike=とげ（空中で かわす） / ceil=ひくい かべ（地上で くぐる） */
export interface Obstacle {
  /** 0=上の せかい 1=下の せかい */
  world: number;
  kind: 'spike' | 'ceil';
  /** 走る人と 交差する 時こく（ミリ秒） */
  at: number;
}

export interface Course {
  /** ジャンプする 時こく（この表どおりに 押せば 全部 かわせる） */
  taps: number[];
  obs: Obstacle[];
  /** コースの 長さ（ミリ秒） */
  total: number;
}

/** ジャンプの 数 */
export const JUMPS = 14;
/** ライフ */
export const LIVES = 5;
/**
 * ぶつかった直後の 無敵時間。
 * 「上下 両方に とげ」の ジャンプでは とげが 2つ（0.34と0.66の 位置＝**198ms しか はなれていない**）
 * ならぶので、これが 無いと **1回の ミスで ライフが 2つ へる**。
 * 空中の 時間(AIR_MS=620) より 短くしてあるので、つぎの ジャンプの 判定は ふつうに 行われる。
 */
export const INVULN_MS = 420;
/** 上下 両方に とげが 出る ジャンプの 回数（のこりは かた方だけ） */
export const BOTH_JUMPS = 5;
/** じゃまものの 数（とげ JUMPS+BOTH_JUMPS ＋ かべ JUMPS）。いつも 同じ */
export const OBS_COUNT = JUMPS + BOTH_JUMPS + JUMPS;
/** 生成の よゆう（この ぶんだけ 中央から ずらさない） */
export const MARGIN_MS = 150;

/** その時こくに 空中に いるか */
export function airborneAt(taps: number[], t: number): boolean {
  for (const tp of taps) if (t >= tp && t < tp + AIR_MS) return true;
  return false;
}

/** その じゃまものを かわせているか */
export function obsOk(kind: 'spike' | 'ceil', airborne: boolean): boolean {
  return kind === 'spike' ? airborne : !airborne;
}

function pick(rng: () => number, n: number): number {
  return Math.floor(rng() * n);
}

/**
 * コースを作る。
 * ① ジャンプの 時こく表を 決める（間かくは 1.0〜1.7秒）
 * ② 空中の あいだ＝とげ、地上の あいだ＝ひくい かべ を 置く
 *    （どちらも 中央から MARGIN_MS 以上 はなさない＝ぴったり押せば かならず 安全）
 */
export function makeCourse(rng: () => number): Course {
  // ジャンプの 間かくは 1.15秒いじょう。こうすると「空中」と「地上」の どちらにも
  // かならず よゆうが できて、じゃまものの 数が いつも 同じになる（＝メダルが 公平）
  const taps: number[] = [];
  let t = 1800;
  for (let i = 0; i < JUMPS; i++) {
    taps.push(t);
    t += 1150 + pick(rng, 8) * 80; // 1.15〜1.71秒
  }
  const total = t + 1400;

  // 上下 両方に とげを 出す ジャンプを ちょうど BOTH_JUMPS 回 えらぶ
  const order: number[] = [];
  for (let i = 0; i < JUMPS; i++) order.push(i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = pick(rng, i + 1);
    const tmp = order[i]!;
    order[i] = order[j]!;
    order[j] = tmp;
  }
  const both = new Set(order.slice(0, BOTH_JUMPS));

  const obs: Obstacle[] = [];
  for (let i = 0; i < taps.length; i++) {
    const tp = taps[i]!;
    // 空中に とげ（1つ、または 上下 両方に 少しずらして 2つ）
    if (both.has(i)) {
      obs.push({ world: 0, kind: 'spike', at: tp + AIR_MS * 0.34 });
      obs.push({ world: 1, kind: 'spike', at: tp + AIR_MS * 0.66 });
    } else {
      obs.push({ world: pick(rng, 2), kind: 'spike', at: tp + AIR_MS * 0.5 });
    }
    // つぎの ジャンプまでの 地上の あいだに ひくい かべ（間かくの 決め方から かならず 入る）
    const groundFrom = tp + AIR_MS;
    const groundTo = i + 1 < taps.length ? taps[i + 1]! : total - 600;
    if (groundTo - groundFrom >= MARGIN_MS * 2 + 120) {
      const mid = (groundFrom + groundTo) / 2;
      obs.push({ world: pick(rng, 2), kind: 'ceil', at: mid });
    }
  }
  obs.sort((a, b) => a.at - b.at);
  return { taps, obs, total };
}

/** じゃまものの 画面上の x（走る人は RUN_X に いる） */
export function obsX(o: Obstacle, t: number): number {
  return RUN_X + (SPEED[o.world]! * (o.at - t)) / 1000;
}

/** 1つ かわしたときの 点（一律。じゃまものの 数が いつも 同じなので 満点も 一定） */
export function obsPoints(_i: number): number {
  return 30;
}

/** 一度も ぶつからなかった ときの ボーナス */
export const CLEAN_BONUS = 150;

/** 満点 */
export function maxScore(): number {
  let s = CLEAN_BONUS;
  for (let i = 0; i < OBS_COUNT; i++) s += obsPoints(i);
  return s;
}
