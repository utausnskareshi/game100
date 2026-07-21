// =============================================================
// こだまソナー（No.84）の配置・採点（DOM非依存・純ロジック）
// =============================================================
// - くらい海のどこかにクジラが1とう かくれている。タップ＝いしを落とす（ピン）。
//   波紋がクジラに届くと「こだま」が返り、タップ地点を中心に
//   半径＝クジラまでの距離 の光る輪がうかぶ（すぐ消える）。
//   輪を2〜3本 頭の中で交差させて、いる場所をずばりタップ（三角測量）すれば キャッチ！
// - タップ自体がキャッチ判定を兼ねる（クジラから catchR 以内のタップ＝つかまえた）。
//   ピン数制限つき＝さいごの1回で捕まえられなければ失敗（むだ撃ちでは勝てない）。
//   後半はニセこだまを返すクラゲがまぎれる（輪の色がかすかに違う）。
// - 配置は rng 注入（日替わりは全員同じ）・採点は純関数＝完全決定論。
// - import してよいのは game-api と同一フォルダのみ（このファイルは依存なし）。

export const W = 360;
export const H = 640;
export const HUD_H = 40;

/** クジラ・クラゲが配置される海エリア（デザイン座標） */
export const SEA = { x0: 0, y0: HUD_H, x1: W, y1: H } as const;
/** クジラは海のふちから最低このぶん内側（輪の交差が読みやすく、端で詰まない） */
export const WHALE_MARGIN = 56;
export const JELLY_MARGIN = 40;
/** クジラとクラゲの最小距離（輪を取り違えても即誤タップにならない間隔） */
export const JELLY_MIN_DIST = 130;

/** 波紋の速さ（px/秒）。こだまが返るまでの「間」も駆け引き */
export const RIPPLE_SPEED = 420;

export const BASE_PTS = 100;
/** ど真ん中ボーナス（キャッチタップがクジラ中心からこの距離以内） */
export const CENTER_R = 12;
export const CENTER_BONUS = 30;
/** クラゲがいるラウンドのクリアボーナス */
export const JELLY_BONUS = 50;
/** クラゲを「つついた」とみなす距離（つついてもピンは消費＝むだになる） */
export const JELLY_POKE_R = 26;
/** 実績: でんせつのソナーし の閾値（確実到達の最適値 1450 の約8割） */
export const SCORE_HI = 1200;

export interface RoundSpec {
  /** キャッチ判定半径（小さいほどむずかしい） */
  catchR: number;
  /** こだまの輪が消えるまでのms（短いほどむずかしい） */
  fadeMs: number;
  /** ピン数上限 */
  maxPings: number;
  /** ニセこだまのクラゲがいるか */
  jelly: boolean;
}

export const ROUNDS: RoundSpec[] = [
  { catchR: 34, fadeMs: 3400, maxPings: 8, jelly: false },
  { catchR: 30, fadeMs: 3000, maxPings: 7, jelly: false },
  { catchR: 26, fadeMs: 2600, maxPings: 7, jelly: false },
  { catchR: 24, fadeMs: 2300, maxPings: 6, jelly: true },
  { catchR: 22, fadeMs: 2000, maxPings: 6, jelly: true },
];

export interface Pt {
  x: number;
  y: number;
}

export const dist = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.y - b.y);

/** 少ないピンで見つけるほど高いボーナス（n = キャッチの1回を含む使用ピン数） */
export function pingBonus(n: number): number {
  return [0, 140, 110, 80, 50, 30, 15][n] ?? 0;
}

/** はやさボーナス（ラウンド開始→キャッチまでのms）。20秒を切った分×3点/秒（最大60） */
export function speedBonus(ms: number): number {
  return 3 * Math.min(20, Math.max(0, Math.ceil((20_000 - ms) / 1000)));
}

/** キャッチしたラウンドの得点（失敗ラウンドは0点） */
export function roundScore(spec: RoundSpec, pingsUsed: number, centerDist: number, ms: number): number {
  return (
    BASE_PTS +
    pingBonus(pingsUsed) +
    (centerDist <= CENTER_R ? CENTER_BONUS : 0) +
    speedBonus(ms) +
    (spec.jelly ? JELLY_BONUS : 0)
  );
}

/** 理論最大（全ラウンド1ピン目でぐうぜんキャッチ・即時）= 1750 */
export function maxScore(): number {
  return ROUNDS.reduce((s, r) => s + roundScore(r, 1, 0, 0), 0);
}

/** 運にたよらず確実に到達できる最適値（輪2本で位置を確定→3ピン目でど真ん中・即時）= 1450 */
export function bestSureScore(): number {
  return ROUNDS.reduce((s, r) => s + roundScore(r, 3, 0, 0), 0);
}

/**
 * ラウンドの配置。クジラはマージン付き一様、クラゲは「クジラから130px以上」を
 * 満たすまで再抽選（40回で必ず実用上決まる。万一の保険は fallbackJelly）。
 */
export function layoutRound(rng: () => number, spec: RoundSpec): { whale: Pt; jelly: Pt | null } {
  const whale: Pt = {
    x: SEA.x0 + WHALE_MARGIN + rng() * (SEA.x1 - SEA.x0 - WHALE_MARGIN * 2),
    y: SEA.y0 + WHALE_MARGIN + rng() * (SEA.y1 - SEA.y0 - WHALE_MARGIN * 2),
  };
  if (!spec.jelly) return { whale, jelly: null };
  for (let i = 0; i < 40; i++) {
    const jelly: Pt = {
      x: SEA.x0 + JELLY_MARGIN + rng() * (SEA.x1 - SEA.x0 - JELLY_MARGIN * 2),
      y: SEA.y0 + JELLY_MARGIN + rng() * (SEA.y1 - SEA.y0 - JELLY_MARGIN * 2),
    };
    if (dist(whale, jelly) >= JELLY_MIN_DIST) return { whale, jelly };
  }
  return { whale, jelly: fallbackJelly(whale) };
}

/**
 * 保険の配置: 対角ぎみの2候補のうちクジラから遠いほう。
 * 候補間の距離は約411pxなので、三角不等式よりどんなクジラ位置でも遠いほうは
 * 205px以上（> JELLY_MIN_DIST）離れることが保証される。
 */
export function fallbackJelly(whale: Pt): Pt {
  const a: Pt = { x: 90, y: 150 };
  const b: Pt = { x: 270, y: 520 };
  return dist(whale, a) >= dist(whale, b) ? a : b;
}
