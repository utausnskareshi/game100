// =============================================================
// おさかなリーダー（No.89）のタイムライン・ハザード判定・採点（DOM非依存・純ロジック）
// =============================================================
// - あなたは先頭の魚。ドラッグで泳ぐと24ひきの群れがついてくる（群れの
//   ふるまいは game.ts 側のボイド）。90秒間、網のスイープ・フグの突進・
//   うずしおをくぐり抜け、生きのこった仲間の数がスコアの柱。
// - 【理不尽なし保証（プロパティテスト対象）】すべての危険は TELEGRAPH_MS 以上
//   前に予告される・網のすき間は圧縮した群れの幅より広い・イベント間隔は
//   EVENT_GAP_MIN 以上・終了間際には出現しない。
// - タイムラインは rng 注入で一括生成（日替わりは全員同じ）＝完全決定論。
// - import してよいのは game-api と同一フォルダのみ（このファイルは依存なし）。

export const W = 360;
export const H = 640;
export const HUD_H = 40;

export const DURATION_MS = 90_000;
export const FOLLOWERS = 24;

/** 網のすき間（圧縮した群れ径 ≈70px より十分広い） */
export const NET_GAP = 112;
export const NET_SPEED = 200;
export const NET_CATCH_D = 7;
/** 予告時間（この間に点線プレビューが出る） */
export const TELEGRAPH_MS = 1000;
/**
 * 網だけ長め: すき間の位置を読んで群れ全体を横に最大300px動かす時間が必要
 * （1.6s＋横断3.36s＝占有4.96s < EVENT_GAP_MIN＝重複なしは維持）
 */
export const NET_TELEGRAPH_MS = 1600;
/**
 * イベント開始時刻どうしの最小間隔。
 * 網の占有時間（予告1s＋横断3.4s）より長い＝危険は重複しない（プロパティテスト対象）
 */
export const EVENT_GAP_MIN = 6000;
/** これ以降はイベントを開始しない（終了間際の理不尽回避） */
export const LAST_EVENT_AT = DURATION_MS - 8000;

export const PUFFER_SPEED = 560;
export const PUFFER_CATCH_D = 14;

export const WHIRL_R = 90;
export const WHIRL_KILL_R = 12;
export const WHIRL_MS = 3200;
export const WHIRL_PULL = 300;

export const SURVIVOR_PTS = 30;
export const PLANKTON_PTS = 5;
export const NO_LOSS_BONUS = 150;
/** 実績: むれのカリスマ の閾値（先導ボット実証値で較正） */
export const SCORE_HI = 900;

export interface NetEvent {
  type: 'net';
  at: number;
  gapX: number;
  /** true=上から下へ */
  down: boolean;
}
export interface PufferEvent {
  type: 'puffer';
  at: number;
  y: number;
  fromLeft: boolean;
}
export interface WhirlEvent {
  type: 'whirl';
  at: number;
  x: number;
  y: number;
}
export type Hazard = NetEvent | PufferEvent | WhirlEvent;

export interface PlanktonCluster {
  at: number;
  x: number;
  y: number;
}

/** タイムライン一括生成（rng 消費順固定＝決定論） */
export function makeTimeline(rng: () => number): { hazards: Hazard[]; plankton: PlanktonCluster[] } {
  const hazards: Hazard[] = [];
  let t = 6000;
  while (t <= LAST_EVENT_AT) {
    const roll = rng();
    if (roll < 0.45) {
      hazards.push({ type: 'net', at: t, gapX: 30 + rng() * (W - 60 - NET_GAP), down: rng() < 0.5 });
    } else if (roll < 0.8) {
      hazards.push({ type: 'puffer', at: t, y: 110 + rng() * 440, fromLeft: rng() < 0.5 });
    } else {
      hazards.push({ type: 'whirl', at: t, x: 80 + rng() * (W - 160), y: 150 + rng() * 340 });
    }
    t += EVENT_GAP_MIN + rng() * 2200;
  }
  const plankton: PlanktonCluster[] = [];
  let pt = 3000;
  while (pt <= DURATION_MS - 6000) {
    plankton.push({ at: pt, x: 45 + rng() * (W - 90), y: 110 + rng() * 440 });
    pt += 5200 + rng() * 1800;
  }
  return { hazards, plankton };
}

/** 網の現在y（予告終了後に動きだす）。まだ/もう画面外なら null */
export function netY(e: NetEvent, t: number): number | null {
  const dt = t - e.at - NET_TELEGRAPH_MS;
  if (dt < 0) return null;
  const y = e.down ? -16 + (dt / 1000) * NET_SPEED : H + 16 - (dt / 1000) * NET_SPEED;
  if (y < -16 || y > H + 16) return null;
  return y;
}

export const inNetGap = (x: number, gapX: number): boolean => x >= gapX && x <= gapX + NET_GAP;

/** 魚(fx,fy)が網につかまるか（線の近く・すき間の外） */
export function netCatch(fx: number, fy: number, e: NetEvent, t: number): boolean {
  const y = netY(e, t);
  if (y === null) return false;
  return Math.abs(fy - y) < NET_CATCH_D && !inNetGap(fx, e.gapX);
}

/** フグの現在x。突進前/後なら null */
export function pufferX(e: PufferEvent, t: number): number | null {
  const dt = t - e.at - TELEGRAPH_MS;
  if (dt < 0) return null;
  const x = e.fromLeft ? -24 + (dt / 1000) * PUFFER_SPEED : W + 24 - (dt / 1000) * PUFFER_SPEED;
  if (x < -24 || x > W + 24) return null;
  return x;
}

/** 魚がフグに食べられるか（突進ラインの近く・フグ本体の近く） */
export function pufferCatch(fx: number, fy: number, e: PufferEvent, t: number): boolean {
  const x = pufferX(e, t);
  if (x === null) return false;
  return Math.abs(fy - e.y) < PUFFER_CATCH_D && Math.abs(fx - x) < PUFFER_CATCH_D;
}

/** うずしおが有効か */
export function whirlActive(e: WhirlEvent, t: number): boolean {
  const dt = t - e.at - TELEGRAPH_MS;
  return dt >= 0 && dt <= WHIRL_MS;
}

/** 最終スコア */
export function finalScore(survivors: number, eaten: number): number {
  return survivors * SURVIVOR_PTS + eaten * PLANKTON_PTS + (survivors === FOLLOWERS ? NO_LOSS_BONUS : 0);
}
