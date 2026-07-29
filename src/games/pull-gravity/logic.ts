// =============================================================
// ひっぱる じゅうりょく（No.126・かくれゲーム）: 純ロジック（引力の物理・ステージ）
// =============================================================
// - 画面を おしている あいだ、**指の場所に むかって ほし ぜんぶが 引きよせられる**。
//   はなすと 引力は 消えて、ほしは だんだん 止まる。
// - ほしを 下の あなに 入れたら 回収。とげ（きらい）に ふれると ほしを 失って やり直し。
// - とげは **動かない**＝ぜんぶ 見えていて 読める（理不尽さが ない）。
// - 物理は 固定サブステップ 1/120 秒＝フレームレートに よらず 同じ結果（決定論）。
// - DOM 非依存。
// =============================================================

export const SUB_DT = 1 / 120;
/** 引力の 強さ（px/秒^2） */
export const PULL = 900;
/** 速さの 減衰（1秒あたり） */
export const DAMP = 2.4;
/** ほしの 大きさ */
export const STAR_R = 9;
/** とげの 大きさ */
export const MINE_R = 13;
/** あなの 大きさ */
export const HOLE_R = 20;

/** うごける はんい */
export const FIELD = { x0: 12, y0: 100, x1: 348, y1: 556 };
/** あなの ばしょ */
export const HOLE = { x: 180, y: 520 };

export interface Pt {
  x: number;
  y: number;
}

export interface StageSpec {
  stars: Pt[];
  mines: Pt[];
  /** もちじかん（ミリ秒） */
  timeMs: number;
}

export const STAGES: StageSpec[] = [
  // 1: とげは まん中に 1つ だけ
  {
    stars: [
      { x: 80, y: 160 },
      { x: 280, y: 160 },
    ],
    mines: [{ x: 180, y: 330 }],
    timeMs: 26000,
  },
  // 2: 2つの とげの あいだを 通す
  {
    stars: [
      { x: 60, y: 150 },
      { x: 300, y: 150 },
      { x: 180, y: 200 },
    ],
    mines: [
      { x: 110, y: 350 },
      { x: 250, y: 350 },
    ],
    timeMs: 30000,
  },
  // 3: とげの かべに すきまが 1つ
  {
    stars: [
      { x: 70, y: 140 },
      { x: 180, y: 140 },
      { x: 290, y: 140 },
    ],
    mines: [
      { x: 60, y: 330 },
      { x: 120, y: 330 },
      { x: 240, y: 330 },
      { x: 300, y: 330 },
    ],
    timeMs: 32000,
  },
  // 4: 上下 2だんの とげ
  {
    stars: [
      { x: 60, y: 140 },
      { x: 180, y: 140 },
      { x: 300, y: 140 },
      { x: 180, y: 210 },
    ],
    mines: [
      { x: 110, y: 280 },
      { x: 250, y: 280 },
      { x: 60, y: 400 },
      { x: 180, y: 400 },
      { x: 300, y: 400 },
    ],
    timeMs: 36000,
  },
  // 5: とげ 5つ・ほし 4つ。まん中は ふさがっているので 左右に よけて 下ろす
  //    ※ あなの すぐ上には とげを 置かない（下ろす道を のこす＝理不尽に しない）
  {
    stars: [
      { x: 50, y: 140 },
      { x: 140, y: 140 },
      { x: 230, y: 140 },
      { x: 315, y: 140 },
    ],
    mines: [
      { x: 60, y: 270 },
      { x: 180, y: 290 },
      { x: 300, y: 270 },
      { x: 100, y: 420 },
      { x: 260, y: 420 },
    ],
    timeMs: 40000,
  },
];

export const STAGE_COUNT = STAGES.length;

export interface Star {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** 0=とんでいる 1=回収した 2=とげで 失った */
  state: number;
}

export function initialStars(spec: StageSpec): Star[] {
  return spec.stars.map((p) => ({ x: p.x, y: p.y, vx: 0, vy: 0, state: 0 }));
}

/**
 * 1サブステップ すすめる。finger が null なら 引力なし。
 * 返り値は「このステップで 起きたこと」: 'none' | 'got'（回収） | 'lost'（とげ）
 */
export function step(spec: StageSpec, stars: Star[], finger: Pt | null, dt: number): 'none' | 'got' | 'lost' {
  let ev: 'none' | 'got' | 'lost' = 'none';
  for (const s of stars) {
    if (s.state !== 0) continue;
    if (finger) {
      const dx = finger.x - s.x;
      const dy = finger.y - s.y;
      const d = Math.hypot(dx, dy);
      if (d > 0.001) {
        s.vx += (dx / d) * PULL * dt;
        s.vy += (dy / d) * PULL * dt;
      }
    }
    s.vx -= s.vx * DAMP * dt;
    s.vy -= s.vy * DAMP * dt;
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    // わく（はねかえる）
    if (s.x < FIELD.x0 + STAR_R) {
      s.x = FIELD.x0 + STAR_R;
      s.vx = -s.vx * 0.4;
    } else if (s.x > FIELD.x1 - STAR_R) {
      s.x = FIELD.x1 - STAR_R;
      s.vx = -s.vx * 0.4;
    }
    if (s.y < FIELD.y0 + STAR_R) {
      s.y = FIELD.y0 + STAR_R;
      s.vy = -s.vy * 0.4;
    } else if (s.y > FIELD.y1 - STAR_R) {
      s.y = FIELD.y1 - STAR_R;
      s.vy = -s.vy * 0.4;
    }
    // あな
    if (Math.hypot(s.x - HOLE.x, s.y - HOLE.y) < HOLE_R) {
      s.state = 1;
      ev = 'got';
      continue;
    }
    // とげ
    for (const m of spec.mines) {
      if (Math.hypot(s.x - m.x, s.y - m.y) < MINE_R + STAR_R) {
        s.state = 2;
        ev = 'lost';
        break;
      }
    }
  }
  return ev;
}

/** のこっている ほし */
export function alive(stars: Star[]): Star[] {
  return stars.filter((s) => s.state === 0);
}

/** ぜんぶ 回収したか */
export function allGot(stars: Star[]): boolean {
  return stars.every((s) => s.state === 1);
}

/** 1つでも 失ったか */
export function anyLost(stars: Star[]): boolean {
  return stars.some((s) => s.state === 2);
}

export function cloneStars(stars: Star[]): Star[] {
  return stars.map((s) => ({ ...s }));
}

/** ステージの点（やり直しが 少ないほど 高い） */
export function stageScore(attempts: number): number {
  return Math.max(80, 250 - (attempts - 1) * 50);
}

/** 満点 */
export function maxScore(): number {
  return STAGE_COUNT * 250;
}
