// =============================================================
// ダブルうさぎ（No.31）の落下物スケジュール（DOM非依存・乱数注入）
// =============================================================
// - 落下物は左右のサイドに「交互に」1個ずつ出る（＝両方の親指が常に仕事をする）。
//   サイドは交互で固定なので rng は列(2択)と種類(にんじん/いわ)にだけ使う。
// - rng は1個につき必ず2回消費（列→種類）＝日替わりの列を全端末で安定させる。
// - import してよいのは game-api（types/helpers）と同一フォルダのみ（このファイルは依存なし）。

export type ItemKind = 'carrot' | 'rock';

export interface Drop {
  /** 0=ひだり列 / 1=みぎ列（そのサイドの中で） */
  col: 0 | 1;
  kind: ItemKind;
}

/** いわ率はレベルで上がる（26%→最大40%）。のこりは にんじん */
export function rockP(level: number): number {
  return Math.min(0.26 + level * 0.02, 0.4);
}

/** 1個ぶんの落下物をつくる（rng 消費は常に2回） */
export function rollDrop(rng: () => number, level: number): Drop {
  const col = rng() < 0.5 ? 0 : 1;
  const kind: ItemKind = rng() < rockP(level) ? 'rock' : 'carrot';
  return { col, kind };
}

/** 出現間隔(ms)。だんだん短く（サイド交互なので片側あたりはこの2倍） */
export const spawnInterval = (level: number): number => Math.max(520, 900 - level * 70);

/** 落下速度(px/s)。だんだん速く */
export const fallSpeed = (level: number): number => Math.min(410, 205 + level * 32);
