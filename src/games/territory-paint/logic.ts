// =============================================================
// じんとりペイント（No.93）: 純ロジック（グリッド・囲みこみ・テスト対象）
// =============================================================
// - 陣地はグリッド（filled/empty/trail の3状態）。外わくが最初から filled。
// - 指でなぞると marker が empty を trail にしながら進み、filled にもどると「囲みこみ」成立。
//   → trail を filled にし、さらに「敵が入りこめない empty」を一気に filled にする（陣取り系の取り方）。
// - closeTrail が取り方の核。敵セルから empty を BFS した到達域だけを残し、
//   到達できない empty（＝囲まれたポケット）を filled にする。純関数なのでテストしやすい。
// =============================================================

/** グリッド寸法（プレイ領域は HUD の下） */
export const GW = 18;
export const GH = 30;
export const CELL = 20;
export const PLAY_Y0 = 40;

export const EMPTY = 0;
export const FILL = 1;
export const TRAIL = 2;

/** クリアに必要な塗り割合（全セル比） */
export const TARGET_PCT = 0.75;

/** 外わくだけ filled のグリッドを作る */
export function makeGrid(): Uint8Array {
  const g = new Uint8Array(GW * GH);
  for (let x = 0; x < GW; x++) {
    g[x] = FILL;
    g[(GH - 1) * GW + x] = FILL;
  }
  for (let y = 0; y < GH; y++) {
    g[y * GW] = FILL;
    g[y * GW + GW - 1] = FILL;
  }
  return g;
}

export const inBounds = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < GW && y < GH;

/** 盤外は「かべ（FILL）」として扱う（marker が外へ出られない／閉じ判定が素直になる） */
export function at(g: Uint8Array, x: number, y: number): number {
  if (!inBounds(x, y)) return FILL;
  return g[y * GW + x]!;
}

export function countFill(g: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < g.length; i++) if (g[i] === FILL) n++;
  return n;
}

export function percentFill(g: Uint8Array): number {
  return countFill(g) / (GW * GH);
}

/**
 * 囲みこみを確定する。
 * 1) trail を filled にする
 * 2) enemyCells（敵のいるセル）から empty を4連結 BFS＝敵の到達域
 * 3) 到達できない empty をすべて filled にする（＝囲まれたポケットを取る）
 * 返り値は新たに filled になったセル数（得点・演出用）。
 */
export function closeTrail(g: Uint8Array, enemyCells: number[]): number {
  let added = 0;
  for (let i = 0; i < g.length; i++) {
    if (g[i] === TRAIL) {
      g[i] = FILL;
      added++;
    }
  }
  const reach = new Uint8Array(g.length);
  const q: number[] = [];
  for (const c of enemyCells) {
    if (c >= 0 && c < g.length && g[c] === EMPTY && !reach[c]) {
      reach[c] = 1;
      q.push(c);
    }
  }
  // 有効な敵シードが1つも無い場合は「囲まれたポケット」の一括塗りをしない。
  // （通常は敵が必ず EMPTY セルに居るので発生しないが、万一シードが空だと全 EMPTY を
  //   非到達とみなして盤面全部を塗る＝一手で即クリアになるのを防ぐ防御）
  const seeded = q.length > 0;
  while (q.length) {
    const c = q.pop()!;
    const x = c % GW;
    const y = (c / GW) | 0;
    const nb = [
      [x + 1, y],
      [x - 1, y],
      [x, y + 1],
      [x, y - 1],
    ];
    for (const [nx, ny] of nb) {
      if (!inBounds(nx!, ny!)) continue;
      const ni = ny! * GW + nx!;
      if (g[ni] === EMPTY && !reach[ni]) {
        reach[ni] = 1;
        q.push(ni);
      }
    }
  }
  if (seeded) {
    for (let i = 0; i < g.length; i++) {
      if (g[i] === EMPTY && !reach[i]) {
        g[i] = FILL;
        added++;
      }
    }
  }
  return added;
}

/** trail をすべて empty に戻す（やられた時のキャンセル用）。戻したセル数を返す */
export function revertTrail(g: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < g.length; i++) {
    if (g[i] === TRAIL) {
      g[i] = EMPTY;
      n++;
    }
  }
  return n;
}

export const cellIndex = (x: number, y: number): number => y * GW + x;
