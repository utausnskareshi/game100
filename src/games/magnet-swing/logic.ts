// =============================================================
// マグネットスイング（No.67）の物理とコース生成（DOM非依存・純ロジック）
// =============================================================
// - ホールドで磁石アンカーにビームをつなぎ振り子スイング、はなすと慣性でジャンプ。
//   右へ右へと進む横スクロール（画面は縦持ち・カメラ追従）。
// - 振り子: θ'' = -(G/L)sinθ − damp·θ' ＋ ポンプ（ホールド中に振れを育てる）。
//   接線速度は VMAX でクランプ＝投げ出し速度に上限（理不尽な吹っ飛び防止）。
// - アンカー間隔は「最大ジャンプで必ず届く」範囲で生成（うえうえジャンプ方式）。
//   実際に届くことはソルバのプロパティテストで6シード×30アンカーを実証する。
// - 乱数は rng 注入（ctx.random＝日替わり同一）。
// - import してよいのは game-api と同一フォルダのみ（このファイルは依存なし）。

export const GRAV = 1500; // px/s^2
export const PUMP = 2.4; // rad/s^2（ホールド中のこぎ）
export const DAMP = 0.12;
export const VMAX = 640; // 接線速度の上限 px/s
export const ATTACH_R = 250;
export const L_MIN = 70;
export const L_MAX = 235;
/** つかまれるアンカーの相対位置（前方窓・頭上条件） */
export const FWD_MIN = -40;
export const FWD_MAX = 240;
export const UP_MIN = 30;
export const WATER_Y = 560;
export const CEIL_Y = 40;
export const STAR_PTS = 15;
/** 20px = 1m */
export const PX_PER_M = 20;

export const START_POS = { x: 80, y: 410 };
export const PLATFORM = { x: 0, w: 112, y: 430 };

export interface Anchor {
  x: number;
  y: number;
}

export const FIRST_ANCHOR: Anchor = { x: 150, y: 190 };

/** 次のアンカー（間隔130〜200px・高さ130〜300でゆるやかに変化） */
export function nextAnchor(prev: Anchor, rng: () => number): Anchor {
  const x = prev.x + 130 + rng() * 70;
  let y = prev.y + (rng() * 2 - 1) * 90;
  y = Math.min(300, Math.max(130, y));
  return { x, y };
}

/** アンカー b の下（つかんだあとのスイングが通る掃過域）に置く ⭐ の位置 */
export function starFor(_a: Anchor, b: Anchor, rng: () => number): { x: number; y: number } {
  const x = b.x + (rng() - 0.5) * 24;
  const y = b.y + 160 + rng() * 46;
  return { x, y };
}

export interface Swing {
  ax: number;
  ay: number;
  L: number;
  th: number;
  om: number;
}

/** 現在位置・速度からアンカーへ接続（θ はぶら下がり0・+x側が正） */
export function attach(px: number, py: number, vx: number, vy: number, a: Anchor): Swing {
  const dx = px - a.x;
  const dy = py - a.y;
  const L = Math.min(L_MAX, Math.max(L_MIN, Math.hypot(dx, dy)));
  const th = Math.atan2(dx, dy);
  const om = (vx * Math.cos(th) - vy * Math.sin(th)) / L;
  return { ax: a.x, ay: a.y, L, th, om };
}

/** 振り子を dt 秒進める（pumping=ホールド中のこぎ） */
export function swingStep(sw: Swing, dt: number, pumping: boolean): void {
  const pump = pumping ? PUMP * (Math.abs(sw.om) > 0.12 ? Math.sign(sw.om) : 1) : 0;
  sw.om += ((-GRAV / sw.L) * Math.sin(sw.th) - DAMP * sw.om + pump) * dt;
  const omMax = VMAX / sw.L;
  if (sw.om > omMax) sw.om = omMax;
  if (sw.om < -omMax) sw.om = -omMax;
  sw.th += sw.om * dt;
}

export function posOf(sw: Swing): { x: number; y: number } {
  return { x: sw.ax + sw.L * Math.sin(sw.th), y: sw.ay + sw.L * Math.cos(sw.th) };
}

export function velOf(sw: Swing): { vx: number; vy: number } {
  return { vx: sw.om * sw.L * Math.cos(sw.th), vy: -sw.om * sw.L * Math.sin(sw.th) };
}

/** つかめるアンカーを選ぶ（前方窓・頭上・距離。前方を優遇） */
export function pickAnchor(px: number, py: number, anchors: Anchor[], minIdx: number): number {
  let best = -1;
  let bestScore = Infinity;
  for (let i = minIdx; i < anchors.length; i++) {
    const a = anchors[i]!;
    const fx = a.x - px;
    if (fx < FWD_MIN || fx > FWD_MAX) continue;
    if (py - a.y < UP_MIN) continue;
    const d = Math.hypot(a.x - px, a.y - py);
    if (d > ATTACH_R) continue;
    const s = d - 0.5 * fx;
    if (s < bestScore) {
      bestScore = s;
      best = i;
    }
  }
  return best;
}

export const metersOf = (px: number): number => Math.floor(Math.max(0, px - START_POS.x) / PX_PER_M);
