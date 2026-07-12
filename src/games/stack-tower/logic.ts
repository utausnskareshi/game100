// =============================================================
// つみあげタワー（No.23）のロジック（DOM非依存・純関数）
// =============================================================
// - landBlock: 直下の段との重なりを計算し、残る部分（はみ出しカット後）を返す。
//   誤差 eps 以内は「ぴったり」＝カットなし。重なりゼロは miss（ゲームオーバー）。
// - slideX: 左右往復するブロックの位置（三角波・速度一定）。時間は ctx.now を渡す。
// - import してよいのは game-api（types/helpers）と同一フォルダのみ（このファイルは依存なし）。

export interface Land {
  /** 残ったブロックの左端 x */
  x: number;
  /** 残った幅（miss のとき 0） */
  w: number;
  /** 切り落とされた幅 */
  cut: number;
  /** ぴったり（eps 以内）だったか */
  perfect: boolean;
  /** まったく重ならなかった（＝ゲームオーバー） */
  miss: boolean;
}

/** 直下の段 (prevX, prevW) の上に (curX, curW) を落としたときの結果 */
export function landBlock(prevX: number, prevW: number, curX: number, curW: number, eps: number): Land {
  if (Math.abs(curX - prevX) <= eps) {
    return { x: prevX, w: curW, cut: 0, perfect: true, miss: false };
  }
  const start = Math.max(prevX, curX);
  const end = Math.min(prevX + prevW, curX + curW);
  const w = end - start;
  if (w <= 0) return { x: curX, w: 0, cut: curW, perfect: false, miss: true };
  return { x: start, w, cut: curW - w, perfect: false, miss: false };
}

/** 段数→スライド速度(px/s)。高くなるほど速い（上限あり・playtest調整前提の仮値） */
export function speedOf(floor: number): number {
  return Math.min(400, 150 + floor * 8);
}

/** ぴったり成功時の幅回復（初期幅を超えない） */
export function recoverWidth(w: number, initialW: number): number {
  return Math.min(initialW, w + 6);
}

/**
 * 経過ms・速度・可動域(range=レーン幅-ブロック幅)から、0..range を往復する位置を返す。
 * 三角波なので速度は一定（両端で折り返す）。
 */
export function slideX(elapsedMs: number, speedPxS: number, range: number): number {
  if (range <= 0) return 0;
  const d = (elapsedMs / 1000) * speedPxS;
  const period = range * 2;
  let p = d % period;
  if (p < 0) p += period;
  return p < range ? p : period - p;
}
