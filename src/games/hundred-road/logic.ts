// =============================================================
// ひゃくマスの旅（No.100）: 純ロジック（盤・移動解決・ソルバ・盤面生成）
// =============================================================
// - 100マスのすごろく盤（へび状）を、手札の「歩数カード」で進む。ぴったり100でクリア。
//   サイコロを振らない＝運の要素ゼロの完全情報パズル（カードは使うと減る有限リソース）。
// - 100を超えたぶんは跳ね返って戻る＝「大きい数を先に使うか後に使うか」で結果が変わる。
// - 仕掛け: 🌀ワープ（止まると飛ぶ・1手でワープは1回だけ＝無限ループを構造的に排除）/
//   ⛔とげ（止まると「いちばん大きいカード」を失う＝決定論。ランダムにしないので読みが成立する）/
//   ⭐（止まるとカードをもらう・取ると消える）/ 🔒ゲート（⭐が足りないと通過も着地もできない）。
// - 生成は「解の道すじを先に敷く（構成的）」→ BFS ソルバで可解性・par・難易度条件を検証してから採用。
//   ＝必ず解ける／par は厳密な最少手数／⭐のある面は「⭐を取らないと解けない」ことまで保証する。
// - 乱数は注入（ctx.random）＝決定論。DOM にも型にも依存しない（テスト対象）。
// =============================================================

/** ゴールのマス番号（＝盤のマス数）。100本目の記念なので 100 固定 */
export const GOAL = 100;
/** 盤の列数（10×10） */
export const COLS = 10;
/** カードの値の範囲 */
export const MIN_V = 6;
export const MAX_V = 44;

export type CellKind = 'warp' | 'spike' | 'star' | 'gate';

export interface Cell {
  kind: CellKind;
  /** warp: 飛び先のマス番号 */
  to?: number;
  /** gate: 通るのに必要な⭐の数 */
  need?: number;
  /** star: もらえるカード（cards の index） */
  card?: number;
  /** star: ⭐の通し番号（St.stars のビット位置） */
  si?: number;
}

export interface Level {
  /** 歩数カードの値。index が不変ID（重複値があるので値では識別しない） */
  cards: number[];
  /** 最初から手札にあるカード（ビットマスク）。ここに無いカードは⭐でもらう */
  initMask: number;
  /** マス番号 1..100 → 仕掛け（undefined = なにもない）。index 0 は未使用 */
  cells: (Cell | undefined)[];
  /** ⭐マスの番号（si の順） */
  starSquares: number[];
  /**
   * 🔒ゲートのマス番号（無ければ 0）。**1面につき最大1つ**（ここが正の情報源）。
   * 増やすなら applyCard のゲート判定（ワープ後の位置チェック）も複数対応にすること。
   */
  gateSquare: number;
  /** 最少手数（BFS ソルバによる厳密値） */
  par: number;
  /** 最短手順（cards の index 列） */
  solution: number[];
  /** 初手のうち「選んでも解が残る」手の数（生成時の難易度指標。記録用） */
  goodFirst: number;
  /** 初手のうち「選ぶと詰む」手の数（大きいほど手強い。記録用） */
  deadEnds: number;
}

/** ゲームの状態。pos=0 はふりだし */
export interface St {
  pos: number;
  /** 手札（cards の index のビットマスク） */
  hand: number;
  /** 取り終えた⭐（si のビットマスク） */
  stars: number;
}

export const initialState = (lv: Level): St => ({ pos: 0, hand: lv.initMask, stars: 0 });

export function popcount(v: number): number {
  let n = 0;
  let x = v;
  while (x !== 0) {
    x &= x - 1;
    n++;
  }
  return n;
}

/**
 * マス番号(1..100) → 盤の格子座標（へび状に折り返す。1が左下・100が左上＝登っていく旅）。
 * 描画専用だが純関数なのでここに置く（テストで通し確認する）。
 */
export function cellXY(no: number): { x: number; y: number } {
  const r = Math.floor((no - 1) / COLS); // 下から数えた行
  const k = (no - 1) % COLS;
  return { x: r % 2 === 0 ? k : COLS - 1 - k, y: COLS - 1 - r };
}

/**
 * pos から n マス進む道すじ。GOAL を超えたぶんは跳ね返って戻る。
 * 返り値は通ったマスの列（順）で、最後の要素が着地マス。
 */
export function walk(pos: number, n: number): number[] {
  const path: number[] = [];
  let p = pos;
  let dir = 1;
  for (let i = 0; i < n; i++) {
    if (p >= GOAL) dir = -1;
    else if (p <= 0) dir = 1;
    p += dir;
    path.push(p);
  }
  return path;
}

/** 手札のうち「いちばん大きいカード」の index（同値なら小さい index）。無ければ -1 */
export function largestCard(lv: Level, hand: number): number {
  let best = -1;
  let bestV = -1;
  for (let i = 0; i < lv.cards.length; i++) {
    if ((hand & (1 << i)) === 0) continue;
    const v = lv.cards[i] ?? 0;
    if (v > bestV) {
      bestV = v;
      best = i;
    }
  }
  return best;
}

export interface MoveOutcome {
  next: St;
  /** 通ったマスの列（最後が着地マス。ワープ前の着地まで） */
  path: number[];
  /** ワープした先（発動したときだけ） */
  warpTo?: number;
  /** 取った⭐の si */
  star?: number;
  /** ⭐でもらったカードの index */
  gainedCard?: number;
  /** ⛔で失ったカードの index */
  lostCard?: number;
  win: boolean;
}

/**
 * カード ci を使う。使えないときは null
 * （手札にない／閉じた🔒ゲートを通る・踏む／**閉じたゲートより先へ出てしまう**）。
 * 効果の順序: 移動 → 着地マスのワープ（1回だけ）→ ゲート越えの再判定 → 着地マスの⭐/⛔。
 * ゲートは「歩いてもワープでも、⭐がそろうまで その先へは行けない」＝ヘルプの文面どおりの壁。
 * （ワープの行き先だけをチェックしないと 🌀 でゲートを飛び越えられてしまう）
 */
export function applyCard(lv: Level, st: St, ci: number): MoveOutcome | null {
  const bit = 1 << ci;
  if ((st.hand & bit) === 0) return null;
  const v = lv.cards[ci] ?? 0;
  const path = walk(st.pos, v);
  if (path.length === 0) return null;

  // 閉じたゲートは「通過も着地も」できない＝この手そのものが使えない
  const owned = popcount(st.stars);
  for (const sq of path) {
    const c = lv.cells[sq];
    if (c && c.kind === 'gate' && owned < (c.need ?? 0)) return null;
  }

  let pos = path[path.length - 1] ?? st.pos;
  let hand = st.hand & ~bit;
  let stars = st.stars;
  const out: MoveOutcome = { next: st, path, win: false };

  // ワープ（1手で1回だけ＝飛んだ先のワープは発動しない）
  const landed = lv.cells[pos];
  if (landed && landed.kind === 'warp') {
    pos = landed.to ?? pos;
    out.warpTo = pos;
    // ワープでも閉じたゲートの先へは出られない（歩きの判定は path を見るだけなので飛び越えを防ぐ）
    if (lv.gateSquare > 0 && pos > lv.gateSquare) {
      const gc = lv.cells[lv.gateSquare];
      if (gc && gc.kind === 'gate' && owned < (gc.need ?? 0)) return null;
    }
  }

  // 着地マスの⭐/⛔
  const cell = lv.cells[pos];
  if (cell && cell.kind === 'star' && cell.si !== undefined && (stars & (1 << cell.si)) === 0) {
    stars |= 1 << cell.si;
    out.star = cell.si;
    if (cell.card !== undefined) {
      hand |= 1 << cell.card;
      out.gainedCard = cell.card;
    }
  } else if (cell && cell.kind === 'spike') {
    const li = largestCard(lv, hand);
    if (li >= 0) {
      hand &= ~(1 << li);
      out.lostCard = li;
    }
  }

  out.next = { pos, hand, stars };
  out.win = pos === GOAL;
  return out;
}

/** いま使えるカードの index 一覧（閉じたゲートで通れない手は除く） */
export function legalCards(lv: Level, st: St): number[] {
  const out: number[] = [];
  for (let i = 0; i < lv.cards.length; i++) {
    if (applyCard(lv, st, i)) out.push(i);
  }
  return out;
}

/**
 * 状態を1つの整数に詰める（BFS の訪問済み判定用）。
 * ビット割り: pos=0..6（0〜100）/ hand=7..20（カード14枚まで）/ stars=21..24（⭐4個まで）。
 * カードを15枚以上・⭐を5個以上にするならここを広げること（詰め方が衝突すると par を誤る）。
 */
const keyOf = (st: St): number => st.pos + (st.hand << 7) + (st.stars << 21);

/**
 * 最少手数の探索（幅優先＝厳密解）。1手ごとにカードが1枚減るので
 * 手数は cards.length を超えない＝深さは有限。
 */
export function solve(lv: Level, from: St): { par: number; path: number[] } | null {
  if (from.pos === GOAL) return { par: 0, path: [] };
  const maxDepth = lv.cards.length + 1;
  const seen = new Set<number>([keyOf(from)]);
  let frontier: { st: St; path: number[] }[] = [{ st: from, path: [] }];
  for (let depth = 0; depth < maxDepth && frontier.length > 0; depth++) {
    const next: { st: St; path: number[] }[] = [];
    for (const cur of frontier) {
      for (let ci = 0; ci < lv.cards.length; ci++) {
        const mv = applyCard(lv, cur.st, ci);
        if (!mv) continue;
        const path = [...cur.path, ci];
        if (mv.win) return { par: path.length, path };
        const k = keyOf(mv.next);
        if (seen.has(k)) continue;
        seen.add(k);
        next.push({ st: mv.next, path });
      }
    }
    frontier = next;
  }
  return null;
}

/** この状態からまだ 100 にたどり着けるか（つみ検出用） */
export const solvable = (lv: Level, st: St): boolean => solve(lv, st) !== null;

/** 「選んでも解が残る」初手の一覧（少ないほど難しい＝生成時の難易度条件） */
export function goodFirstMoves(lv: Level, st: St): number[] {
  const out: number[] = [];
  for (let ci = 0; ci < lv.cards.length; ci++) {
    const mv = applyCard(lv, st, ci);
    if (!mv) continue;
    if (mv.win || solvable(lv, mv.next)) out.push(ci);
  }
  return out;
}

/** ⭐マスを取り除いた盤（＝⭐のカードが永久に手に入らない盤）。「⭐が必須か」の判定に使う */
export function withoutStars(lv: Level): Level {
  const cells = lv.cells.slice();
  for (const sq of lv.starSquares) cells[sq] = undefined;
  return { ...lv, cells };
}

// ---------------- 生成 ----------------

export interface Stage {
  /** 最初の手札の枚数（⭐でもらうカードは含まない） */
  handSize: number;
  warps: number;
  spikes: number;
  stars: number;
  gates: number;
  /** 意図した解の手数（この数のカードで 100 に着く道すじを敷く） */
  segs: [number, number];
  /** 採用する par の範囲（短すぎ＝簡単すぎ、長すぎ＝間延びを弾く） */
  par: [number, number];
  /**
   * 初手で「解へつながる手」の数がこれ以下なら十分に手強いので即採用（小さいほど難しい）。
   * 仕掛けの無い面は順番が効かない＝解の手札はどれを先に出しても正解なので、
   * 構造的な下限は par になる（そこを下回る目標を置いても意味がない）。
   * 到達できなかった場合は「候補のうち最も good が小さいもの」を採用する。
   */
  goodTarget: number;
}

// par の上限は「敷いた解より短い抜け道が無い」ことの確認も兼ねる（par は敷いた手数を超えない）。
export const STAGES: Stage[] = [
  { handSize: 5, warps: 0, spikes: 0, stars: 0, gates: 0, segs: [3, 3], par: [3, 3], goodTarget: 3 },
  { handSize: 5, warps: 2, spikes: 0, stars: 0, gates: 0, segs: [4, 4], par: [4, 4], goodTarget: 2 },
  { handSize: 6, warps: 3, spikes: 2, stars: 0, gates: 0, segs: [4, 5], par: [4, 5], goodTarget: 2 },
  { handSize: 6, warps: 2, spikes: 2, stars: 2, gates: 0, segs: [4, 5], par: [4, 5], goodTarget: 2 },
  { handSize: 6, warps: 3, spikes: 2, stars: 2, gates: 1, segs: [5, 5], par: [5, 5], goodTarget: 2 },
];

const randInt = (rng: () => number, n: number): number => Math.floor(rng() * n);
const pick = <T>(rng: () => number, a: T[]): T => a[randInt(rng, a.length)]!;

function shuffle<T>(a: T[], rng: () => number): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(rng, i + 1);
    const t = a[i]!;
    a[i] = a[j]!;
    a[j] = t;
  }
  return a;
}

/** 合計 T を k 個に分ける（各要素は [MIN_V, MAX_V]）。無理なら null */
function composition(rng: () => number, k: number, T: number): number[] | null {
  if (k <= 0 || T < k * MIN_V || T > k * MAX_V) return null;
  const a = new Array<number>(k).fill(MIN_V);
  let rest = T - k * MIN_V;
  for (let guard = 0; guard < 400 && rest > 0; guard++) {
    const i = randInt(rng, k);
    const room = MAX_V - (a[i] ?? MIN_V);
    if (room <= 0) continue;
    const add = 1 + randInt(rng, Math.min(room, rest));
    a[i] = (a[i] ?? MIN_V) + add;
    rest -= add;
  }
  return rest === 0 ? a : null;
}

interface Plan {
  /** 意図した解のカードの値（順） */
  gaps: number[];
  /** 意図した解で着地するマス（順・最後は GOAL） */
  stops: number[];
  starSquares: number[];
  gateSquare: number;
  /**
   * 解が必ず踏む「経路ワープ」（無ければ null）。
   * これを入れないと、仕掛けを解の着地点の外に置く方針の結果として
   * 意図した解が「順番を入れかえても成立する」＝初手がどれでも正解になり手ごたえが出ない。
   */
  pathWarp: { at: number; to: number } | null;
}

/** 解の道すじを敷く（⭐は着地点にする＝取らないと進めない設計の土台） */
function plan(rng: () => number, st: Stage): Plan | null {
  const segs = st.segs[0] + randInt(rng, st.segs[1] - st.segs[0] + 1);
  if (st.stars === 0) {
    if (st.warps === 0) {
      // 入門面: 仕掛けなし＝「合計ぴったり100」の部分和パズル
      const gaps = composition(rng, segs, GOAL);
      if (!gaps) return null;
      const stops: number[] = [];
      let p = 0;
      for (const g of gaps) {
        p += g;
        stops.push(p);
      }
      return { gaps, stops, starSquares: [], gateSquare: 0, pathWarp: null };
    }
    // ワープ面: 0 →(k1枚)→ W（ワープ）→ T →(k2枚)→ 100
    // k1 を小さくすると「最初に出すべきカードが限られる」＝手ごたえが出る
    const k1 = 1 + randInt(rng, 2);
    const k2 = segs - k1;
    if (k2 < 1) return null;
    const wLo = Math.max(k1 * MIN_V, 2);
    const wHi = Math.min(k1 * MAX_V, GOAL - 4);
    if (wHi < wLo) return null;
    const at = wLo + randInt(rng, wHi - wLo + 1);
    const tLo = Math.max(GOAL - k2 * MAX_V, 2);
    const tHi = Math.min(GOAL - k2 * MIN_V, GOAL - 1);
    if (tHi < tLo) return null;
    const to = tLo + randInt(rng, tHi - tLo + 1);
    if (to === at) return null;
    const g1 = composition(rng, k1, at);
    const g2 = composition(rng, k2, GOAL - to);
    if (!g1 || !g2) return null;
    const stops: number[] = [];
    let p = 0;
    for (const g of g1) {
      p += g;
      stops.push(p);
    }
    p = to;
    for (const g of g2) {
      p += g;
      stops.push(p);
    }
    // ワープ後の着地点に同じワープマスが再び現れると、意図した解が壊れる
    if (stops.slice(k1).includes(at)) return null;
    return { gaps: [...g1, ...g2], stops, starSquares: [], gateSquare: 0, pathWarp: { at, to } };
  }
  // ⭐がある面: 最初の star 個の着地点を⭐マスにする
  const rest = segs - st.stars;
  if (rest < st.stars) return null; // ⭐でもらうカードを使う手数が足りない
  const g1 = MIN_V + randInt(rng, MAX_V - MIN_V + 1);
  const g2 = MIN_V + randInt(rng, MAX_V - MIN_V + 1);
  const s1 = g1;
  const s2 = g1 + g2;
  const remain = GOAL - s2;
  if (remain < rest * MIN_V || remain > rest * MAX_V) return null;
  const tail = composition(rng, rest, remain);
  if (!tail) return null;
  const gaps = [g1, g2, ...tail];
  const stops: number[] = [];
  let p = 0;
  for (const g of gaps) {
    p += g;
    stops.push(p);
  }
  // 🔒ゲートは「最後の⭐より先」に置く（＝⭐を取る前の道すじでは絶対に踏まない）
  let gateSquare = 0;
  if (st.gates > 0) {
    const cand: number[] = [];
    for (let sq = s2 + 1; sq < GOAL; sq++) if (!stops.includes(sq)) cand.push(sq);
    if (cand.length === 0) return null;
    gateSquare = pick(rng, cand);
  }
  return { gaps, stops, starSquares: [s1, s2], gateSquare, pathWarp: null };
}

/**
 * ステージ index の盤面を生成。
 * 「解の道すじを構成的に敷く」→「BFS ソルバで par・⭐必須・難易度を測る」を繰り返し、
 * 目標の手強さに届いたら即採用／届かなければ候補のうち最も手強いものを採用する
 * （＝生成は必ず成功し、かつ簡単な盤に落ちにくい）。
 */
export function makeLevel(rng: () => number, stageIndex: number): Level {
  const st = STAGES[Math.min(Math.max(stageIndex, 0), STAGES.length - 1)]!;
  const ATTEMPTS = 80;
  let best: Level | null = null;

  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const pl = plan(rng, st);
    if (!pl) continue;

    // カード: ⭐でもらう分は「解の後ろのほう」に割り当てる＝⭐が必須になる
    const starValues = st.stars > 0 ? pl.gaps.slice(pl.gaps.length - st.stars) : [];
    const planned = pl.gaps.slice(0, pl.gaps.length - starValues.length);
    if (planned.length > st.handSize) continue;
    const initValues = planned.slice();
    while (initValues.length < st.handSize) initValues.push(MIN_V + randInt(rng, MAX_V - MIN_V + 1));
    shuffle(initValues, rng);
    const cards = [...initValues, ...starValues];
    const initMask = (1 << initValues.length) - 1;

    // 仕掛けの配置。⭐と経路ワープは解の道すじ上・ほかのワープ/とげは着地点以外
    // （＝敷いた解が壊れない。とげは踏むと損なので絶対に解の上に置かない）
    const cells: (Cell | undefined)[] = new Array<Cell | undefined>(GOAL + 1).fill(undefined);
    const used = new Set<number>([0, GOAL]);
    for (const s of pl.stops) used.add(s);
    if (pl.gateSquare > 0) {
      cells[pl.gateSquare] = { kind: 'gate', need: st.stars };
      used.add(pl.gateSquare);
    }
    for (let i = 0; i < pl.starSquares.length; i++) {
      const sq = pl.starSquares[i]!;
      cells[sq] = { kind: 'star', si: i, card: initValues.length + i };
      used.add(sq);
    }
    const warpSquares: number[] = [];
    if (pl.pathWarp) {
      cells[pl.pathWarp.at] = { kind: 'warp', to: pl.pathWarp.to };
      warpSquares.push(pl.pathWarp.at);
      used.add(pl.pathWarp.at);
      used.add(pl.pathWarp.to); // ワープの着地点に別の仕掛けを置かない
    }
    const free: number[] = [];
    for (let sq = 2; sq < GOAL; sq++) if (!used.has(sq)) free.push(sq);
    shuffle(free, rng);
    const extraWarps = st.warps - warpSquares.length;
    if (free.length < extraWarps + st.spikes) continue;
    const decoyWarps = free.splice(0, extraWarps);
    const spikeSquares = free.splice(0, st.spikes);
    warpSquares.push(...decoyWarps);
    for (const sq of spikeSquares) cells[sq] = { kind: 'spike' };
    // ワープの行き先は「なにも無いマス or 解の着地点」＝ゲート・⭐・とげ・ワープには飛ばさない
    const blocked = new Set<number>([...warpSquares, ...spikeSquares, ...pl.starSquares, pl.gateSquare, GOAL, 0]);
    const targets: number[] = [];
    for (let sq = 2; sq < GOAL; sq++) if (!blocked.has(sq)) targets.push(sq);
    if (targets.length === 0) continue;
    if (pl.pathWarp && blocked.has(pl.pathWarp.to)) continue; // 経路ワープの行き先に仕掛けが乗った
    let placedWarps = true;
    for (const sq of decoyWarps) {
      const cand = targets.filter((t) => t !== sq);
      if (cand.length === 0) {
        placedWarps = false;
        break;
      }
      cells[sq] = { kind: 'warp', to: pick(rng, cand) };
    }
    if (!placedWarps) continue;

    const lv: Level = {
      cards,
      initMask,
      cells,
      starSquares: pl.starSquares,
      gateSquare: pl.gateSquare,
      par: 0,
      solution: [],
      goodFirst: 0,
      deadEnds: 0,
    };

    // ---- 検証（ここを通ったものだけ候補にする）----
    const s0 = initialState(lv);
    const sol = solve(lv, s0);
    if (!sol) continue; // 敷いた解があるので起きないはずだが念のため
    if (sol.par < st.par[0] || sol.par > st.par[1]) continue;
    // ⭐のある面は「⭐を取らないと解けない」ことを保証する
    if (st.stars > 0) {
      const probe = withoutStars(lv);
      if (solve(probe, initialState(probe))) continue;
    }
    const legal = legalCards(lv, s0).length;
    const good = goodFirstMoves(lv, s0).length;
    lv.par = sol.par;
    lv.solution = sol.path;
    lv.goodFirst = good;
    lv.deadEnds = legal - good;

    if (!best || good < best.goodFirst) best = lv;
    // 十分に手強く（初手の選択肢が少なく）、かつ「選ぶと詰む手」が1つ以上あるなら即採用
    if (good <= st.goodTarget && lv.deadEnds >= 1) return lv;
  }
  if (best) return best;

  // フォールバック（まず来ない）: 仕掛けなし・4枚でぴったり100
  const cards = [22, 26, 24, 28];
  const lv: Level = {
    cards,
    initMask: (1 << cards.length) - 1,
    cells: new Array<Cell | undefined>(GOAL + 1).fill(undefined),
    starSquares: [],
    gateSquare: 0,
    par: 0,
    solution: [],
    goodFirst: 0,
    deadEnds: 0,
  };
  const s0 = initialState(lv);
  const sol = solve(lv, s0);
  lv.par = sol?.par ?? cards.length;
  lv.solution = sol?.path ?? [0, 1, 2, 3];
  lv.goodFirst = goodFirstMoves(lv, s0).length;
  lv.deadEnds = legalCards(lv, s0).length - lv.goodFirst;
  return lv;
}
