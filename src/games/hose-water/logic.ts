// =============================================================
// みずまき ホース（No.114・かくれゲーム）: 純ロジック（放物線・ステージ）
// =============================================================
// - かたむき＝水の「打ち出す角度」。とどく きょりは sin(2θ) なので まっすぐ比例しない
//   （45度で いちばん遠くまで とどき、上げすぎても 下げすぎても 手前に落ちる）。
// - 水の量には かぎりがある。だから「出しっぱなしで さがす」ことが できない。
// - DOM 非依存・決定論（乱数を使わない固定ステージ）。
// =============================================================

/** 打ち出す速さ（px/秒）と 重力（px/秒^2） */
export const V0 = 500;
export const G = 900;
/** ホースの 口 */
export const HOSE_X = 36;
export const HOSE_Y = 470;
/** じめんの 高さ */
export const GROUND_Y = 520;
/** 角度の はんい（度） */
export const ANG_MIN = 10;
export const ANG_MAX = 80;

/** 水を出している あいだ へる 量（1秒あたり） */
export const TANK_COST = 8;
/** 花に 水が たまる 速さ（%/秒） */
export const FILL_RATE = 45;
/** 水が 当たったと みなす はば（px） */
export const HIT_W = 20;
/** ぬらしては いけない ものに 当たったときの 減点 */
export const WET_PENALTY = 20;
/** 同じ ものに 続けて 当たっても、この あいだは 1回と 数える（ミリ秒） */
export const WET_COOL = 700;

export interface Flower {
  x: number;
}

export interface NoWet {
  x: number;
  /** 見た目（'cat' か 'wash'） */
  kind: 'cat' | 'wash';
}

export interface Wall {
  x: number;
  /** かべの 上のはし（この上を こえないと 向こうへ 行けない） */
  topY: number;
}

export interface Stage {
  flowers: Flower[];
  noWet: NoWet[];
  wall: Wall | null;
  /** 水の量 */
  tank: number;
}

export const STAGES: Stage[] = [
  // 1: まずは ねらいかたに なれる
  { flowers: [{ x: 150 }, { x: 230 }, { x: 300 }], noWet: [], wall: null, tank: 100 },
  // 2: ぬらしては いけない ものが 間に ある
  {
    flowers: [{ x: 140 }, { x: 200 }, { x: 262 }, { x: 320 }],
    noWet: [{ x: 170, kind: 'cat' }, { x: 291, kind: 'wash' }],
    wall: null,
    tank: 118,
  },
  // 3: かべを こえないと 向こうの花に とどかない
  {
    flowers: [{ x: 148 }, { x: 250 }, { x: 300 }, { x: 330 }],
    noWet: [],
    wall: { x: 200, topY: 430 },
    tank: 118,
  },
  // 4: かべ＋ぬらしては いけない もの
  {
    flowers: [{ x: 140 }, { x: 176 }, { x: 258 }, { x: 300 }, { x: 336 }],
    noWet: [{ x: 218, kind: 'cat' }, { x: 320, kind: 'wash' }],
    wall: { x: 196, topY: 442 },
    tank: 150,
  },
];

export const STAGE_COUNT = STAGES.length;

/** かたむき（-1〜1）→ 打ち出す角度（度）。-1 が いちばん ねかせた角度 */
export function angleOf(tiltX: number): number {
  const t = Math.max(-1, Math.min(1, tiltX));
  return ANG_MIN + ((t + 1) / 2) * (ANG_MAX - ANG_MIN);
}

/** その角度で 水が じめんに 着くまでの 時間（秒） */
export function flightTime(deg: number): number {
  const r = (deg * Math.PI) / 180;
  const vy = V0 * Math.sin(r);
  const dy = GROUND_Y - HOSE_Y;
  return (vy + Math.sqrt(vy * vy + 2 * G * dy)) / G;
}

/** 打ち出してから t 秒後の 水の位置 */
export function pointAt(deg: number, t: number): { x: number; y: number } {
  const r = (deg * Math.PI) / 180;
  return {
    x: HOSE_X + V0 * Math.cos(r) * t,
    y: HOSE_Y - V0 * Math.sin(r) * t + 0.5 * G * t * t,
  };
}

export interface Shot {
  /** 水が とどいた 場所 */
  x: number;
  y: number;
  /** かべに ぶつかって 止まったか */
  blocked: boolean;
  /** 飛んでいる 時間（描画用） */
  t: number;
}

/** その角度で 水が どこへ 行くか（かべを 考えに入れる） */
export function shotOf(stage: Stage, deg: number): Shot {
  const tLand = flightTime(deg);
  if (stage.wall) {
    const r = (deg * Math.PI) / 180;
    const vx = V0 * Math.cos(r);
    const tw = (stage.wall.x - HOSE_X) / vx;
    if (tw > 0 && tw < tLand) {
      const p = pointAt(deg, tw);
      if (p.y > stage.wall.topY) {
        return { x: p.x, y: p.y, blocked: true, t: tw };
      }
    }
  }
  const p = pointAt(deg, tLand);
  return { x: p.x, y: p.y, blocked: false, t: tLand };
}

/** そのステージの 花に とどく角度が ちゃんと あるか（検証用） */
export function reachable(stage: Stage, x: number): boolean {
  for (let d = ANG_MIN; d <= ANG_MAX; d += 0.05) {
    const s = shotOf(stage, d);
    if (!s.blocked && Math.abs(s.x - x) <= HIT_W / 2) return true;
  }
  return false;
}

/** ステージの点（水を のこすほど 高い・ぬらすと へる） */
export function stageScore(tankLeft: number, wets: number): number {
  return Math.max(60, 150 + Math.floor(tankLeft * 1.5) - wets * WET_PENALTY);
}
