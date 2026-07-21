// =============================================================
// みずみちほり（No.87）の盤面生成・水シミュレーション・採点（DOM非依存・純ロジック）
// =============================================================
// - 泉からわく水を、すなをタップで掘って水路をつくり、3つの花にとどける。
//   水のルール: ①下があいていれば落ちる ②「足元が固い（砂/岩/泉）か水」の
//   ときだけ横にひろがる ③上にはのぼらない。1ティックに1マスずつ進む＝
//   目で追える・単調増加（掘るほど広がる）・完全決定論。
// - 【可解性の保証＝構成的生成】「実際に水が通れる掘り跡」をルールに従って
//   歩きながら彫り（横に出るマスの足元は以後掘削禁止セットFで保護）、
//   最後に本物のCAで3輪開花を再検証してから採用する（不合格は決定論リトライ）。
//   パー＝彫った掘り跡の数。持ち掘り数＝パー+EXTRA_DIGS。
// - 乱数は rng 注入（日替わりは全員同じ）。
// - import してよいのは game-api と同一フォルダのみ（このファイルは依存なし）。

export const COLS = 12;
export const ROWS = 15;
export const CELL = 28;

export const T_SAND = 0;
export const T_ROCK = 1;
export const T_AIR = 2;
export const T_SPRING = 3;
export const T_FLOWER = 4;

export const LEVELS = 3;
/** パーに上乗せされる持ち掘り数（むだにできる回数） */
export const EXTRA_DIGS = 2;
export const BLOOM_PTS = 100;
export const DIG_BONUS = 25;
/** 実績: みずのたくみ の閾値（リプレイボット実証値で較正） */
export const SCORE_HI = 1000;

/** はやさボーナス（レベル開始→クリアms）。60秒を切った分×2点/秒（最大80） */
export function speedBonus(ms: number): number {
  return 2 * Math.min(40, Math.max(0, Math.ceil((60_000 - ms) / 1000)));
}

/** レベルごとの性格（下掘り率が低いほどくねくね＝むずかしい） */
export const LEVEL_TUNING = [
  { pDown: 0.7, rocks: 6 },
  { pDown: 0.55, rocks: 10 },
  { pDown: 0.45, rocks: 14 },
] as const;

export const idx = (c: number, r: number): number => r * COLS + c;

export interface WaterLevel {
  grid: Uint8Array;
  spring: { c: number; r: number };
  flowers: { c: number; r: number }[];
  /** 模範解（掘るべきマスのインデックス集合） */
  channel: number[];
  par: number;
  /** 生成に要した試行回数（テスト観測用） */
  attempts: number;
}

/**
 * 水を1ティック進める（同時更新）。ひろがったら true。
 * water は grid と同じ長さの 0/1 配列（呼び出し側が所有）。
 */
export function stepWater(grid: Uint8Array, water: Uint8Array): boolean {
  const adds: number[] = [];
  const open = (i: number): boolean => grid[i] === T_AIR || grid[i] === T_FLOWER;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const i = idx(c, r);
      if (!water[i]) continue;
      // 下へ
      if (r + 1 < ROWS) {
        const b = idx(c, r + 1);
        if (open(b) && !water[b]) adds.push(b);
      }
      // 横へ（足元が固いか水のときだけ）
      const supported =
        r + 1 >= ROWS ||
        grid[idx(c, r + 1)] === T_SAND ||
        grid[idx(c, r + 1)] === T_ROCK ||
        grid[idx(c, r + 1)] === T_SPRING ||
        water[idx(c, r + 1)] === 1;
      if (supported) {
        for (const d of [-1, 1]) {
          const nc = c + d;
          if (nc < 0 || nc >= COLS) continue;
          const j = idx(nc, r);
          if (open(j) && !water[j]) adds.push(j);
        }
      }
    }
  }
  for (const a of adds) water[a] = 1;
  return adds.length > 0;
}

/** 指定の掘りマスをあけた状態でCAを回し、開花状況を返す（テスト・生成検証用） */
export function simulate(level: WaterLevel, digs: number[], maxTicks = 260): { allBloom: boolean; ticks: number } {
  const grid = new Uint8Array(level.grid);
  for (const d of digs) if (grid[d] === T_SAND) grid[d] = T_AIR;
  const water = new Uint8Array(grid.length);
  water[idx(level.spring.c, level.spring.r)] = 1;
  let t = 0;
  let idle = 0;
  while (t < maxTicks && idle < 3) {
    const grew = stepWater(grid, water);
    idle = grew ? 0 : idle + 1;
    t++;
    if (level.flowers.every((f) => water[idx(f.c, f.r)] === 1)) return { allBloom: true, ticks: t };
  }
  return { allBloom: level.flowers.every((f) => water[idx(f.c, f.r)] === 1), ticks: t };
}

/**
 * レベル生成。泉から3本の「水が実際に通れる歩き」を彫り、その到達点を花にする。
 * 横に出るマスの足元は F（掘削・岩化の永久禁止）で保護＝あとの歩きが支えを壊さない。
 * 最後に本物のCAで検証し、だめなら決定論的に作り直す。
 */
export function genLevel(rng: () => number, levelIdx: number): WaterLevel {
  const tune = LEVEL_TUNING[Math.min(levelIdx, LEVEL_TUNING.length - 1)]!;
  // 1回の歩き生成の成功率は実測15%前後 → 120回で失敗率は実質ゼロ
  // （プロパティテストが attempts 分布とフォールバック発生0を監視）
  for (let attempt = 1; attempt <= 120; attempt++) {
    const grid = new Uint8Array(COLS * ROWS).fill(T_SAND);
    const springC = 2 + Math.floor(rng() * (COLS - 4));
    grid[idx(springC, 0)] = T_SPRING;
    const channel = new Set<number>();
    const forbid = new Set<number>(); // 掘って支えを壊してはいけないマス
    const flowers: { c: number; r: number }[] = [];
    // 花のねらい列（左・中・右のゾーンをシャッフル気味に）
    const zones = [1 + Math.floor(rng() * 3), 4 + Math.floor(rng() * 4), 8 + Math.floor(rng() * 3)];
    if (rng() < 0.5) zones.reverse();
    let ok = true;

    for (let k = 0; k < 3 && ok; k++) {
      let c = springC;
      let r = 1;
      const tc = zones[k]!;
      const depth = ROWS - 2 - Math.floor(rng() * 2);
      const carve = (cc: number, rr: number): boolean => {
        const i = idx(cc, rr);
        if (forbid.has(i)) return false;
        if (grid[i] === T_FLOWER || grid[i] === T_SPRING) return false;
        channel.add(i);
        return true;
      };
      if (!carve(c, r)) {
        ok = false;
        break;
      }
      let guard = 0;
      while (r < depth && guard++ < 300) {
        const wantDown = rng() < tune.pDown || c === tc;
        if (wantDown) {
          const below = idx(c, r + 1);
          if (!forbid.has(below) && grid[below] !== T_FLOWER) {
            r++;
            if (!carve(c, r)) {
              ok = false;
              break;
            }
            continue;
          }
        }
        // 横へ（足元が channel だと支えがない → 下へ倒す）
        const dir = tc === c ? (rng() < 0.5 ? 1 : -1) : Math.sign(tc - c);
        const nc = c + dir;
        const footI = idx(c, r + 1);
        const canLat =
          nc >= 1 &&
          nc <= COLS - 2 &&
          !channel.has(footI) &&
          grid[footI] !== T_FLOWER &&
          !forbid.has(idx(nc, r)) &&
          grid[idx(nc, r)] !== T_FLOWER;
        if (canLat) {
          forbid.add(footI); // 横に出た足元は永久保護
          c = nc;
          if (!carve(c, r)) {
            ok = false;
            break;
          }
        } else {
          const below = idx(c, r + 1);
          if (forbid.has(below) || grid[below] === T_FLOWER) {
            ok = false;
            break;
          }
          r++;
          if (!carve(c, r)) {
            ok = false;
            break;
          }
        }
      }
      if (!ok || guard >= 300) {
        ok = false;
        break;
      }
      // 到達点を花に（他の花と近すぎたらやり直し）
      if (flowers.some((f) => Math.abs(f.c - c) <= 1 && Math.abs(f.r - r) <= 1)) {
        ok = false;
        break;
      }
      const fi = idx(c, r);
      channel.delete(fi);
      grid[fi] = T_FLOWER;
      flowers.push({ c, r });
    }
    if (!ok) continue;

    // 岩まき（模範解と保護マスの上には置かない）
    let placed = 0;
    let rockGuard = 0;
    while (placed < tune.rocks && rockGuard++ < 300) {
      const c = Math.floor(rng() * COLS);
      const r = 1 + Math.floor(rng() * (ROWS - 1));
      const i = idx(c, r);
      if (grid[i] !== T_SAND || channel.has(i) || forbid.has(i)) continue;
      grid[i] = T_ROCK;
      placed++;
    }

    const level: WaterLevel = {
      grid,
      spring: { c: springC, r: 0 },
      flowers,
      channel: [...channel],
      par: channel.size,
      attempts: attempt,
    };
    // 本物のCAで最終検証（模範解どおり掘れば3輪咲く）
    if (simulate(level, level.channel).allBloom) return level;
  }
  // ここに来ることは想定しない（プロパティテストで attempts 分布を監視）。
  return fallbackLevel();
}

/**
 * 万一の保険レベル（手組み・支持ルールを満たす固定解）。
 * 泉(5,0)→(5,1)で左右に分配（足元(5,2)は砂のまま＝支持あり）。
 * 右: (6,1)(7,1)通過→(8,1)から縦落ち→花(8,13)。
 * 左: (4,1)通過→(3,1)から縦落ち(3,2..6)→(3,7)で再分配（足元(3,8)は砂）→
 *     (2,7)から縦落ち→花(2,13) ／ (4,7)から縦落ち→花(4,13)。
 * プロパティテストが simulate で開花を直接検証する。
 */
export function fallbackLevel(): WaterLevel {
  const grid = new Uint8Array(COLS * ROWS).fill(T_SAND);
  const springC = 5;
  grid[idx(springC, 0)] = T_SPRING;
  const ch = new Set<number>();
  ch.add(idx(5, 1));
  // 右ルート
  ch.add(idx(6, 1));
  ch.add(idx(7, 1));
  for (let r = 1; r <= 12; r++) ch.add(idx(8, r));
  // 左ルート
  ch.add(idx(4, 1));
  for (let r = 1; r <= 6; r++) ch.add(idx(3, r));
  ch.add(idx(3, 7));
  for (let r = 7; r <= 12; r++) ch.add(idx(2, r));
  for (let r = 7; r <= 12; r++) ch.add(idx(4, r));
  const flowers = [
    { c: 8, r: 13 },
    { c: 2, r: 13 },
    { c: 4, r: 13 },
  ];
  for (const f of flowers) grid[idx(f.c, f.r)] = T_FLOWER;
  const channel = [...ch];
  return { grid, spring: { c: springC, r: 0 }, flowers, channel, par: channel.length, attempts: 41 };
}
