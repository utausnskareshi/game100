// =============================================================
// どっちが 先？（No.111・かくれゲーム）: 純ロジック（出題・判定）
// =============================================================
// - 2つの点が べつべつの「きょり」と「速さ」で ゴール線へ向かう。
//   どちらが 先に着くかを「着く前に」当てる＝反応ではなく **到達時間の予測**。
// - 見ているだけで分かってしまわないよう、こたえる時間（かんさつ時間）に制限がある。
// - 出題は rng 注入＝決定論。到達時間の差は ラウンドごとに 小さくなる。
// - DOM 非依存。
// =============================================================

/** ゴール線までの みちのり（px）の はんい */
export const DIST_MIN = 110;
export const DIST_MAX = 250;
/** 速さ（px/秒）の はんい */
export const SPEED_MIN = 45;
export const SPEED_MAX = 135;
/** 先に着くほうの 到達時間（秒）の はんい */
export const TWIN_MIN = 1.6;
export const TWIN_MAX = 2.8;
/** みちのりの差は これ以上つける（＝見た目で ちゃんと ちがう） */
export const DIST_GAP = 40;

/** ラウンドごとの「到達時間の差」（ミリ秒）。だんだん きわどくなる */
export const GAPS_MS = [900, 700, 550, 430, 340, 270, 220, 180, 150, 120];
export const ROUNDS = GAPS_MS.length;

/** こたえられる時間（ミリ秒）。後半は みじかくなる */
export function obsMs(round: number): number {
  return round < 4 ? 1100 : round < 7 ? 950 : 800;
}

/** きわどい しょうぶと よぶ差（ミリ秒） */
export const CLOSE_MS = 200;

export interface Round {
  /** 左の みちのり・速さ */
  distL: number;
  speedL: number;
  distR: number;
  speedR: number;
  /** 到達時間（秒） */
  tL: number;
  tR: number;
  /** 先に着くのは 'L' か 'R' */
  winner: 'L' | 'R';
  /** 到達時間の差（ミリ秒） */
  gapMs: number;
  /** 先に着くほうが「遠い」ほうか（＝見た目にだまされる問題か） */
  farWins: boolean;
}

function rand(rng: () => number, lo: number, hi: number): number {
  return lo + rng() * (hi - lo);
}

/**
 * 1ラウンドぶんの出題。
 * ① 先に着くほうの時間 tWin と、差 gap から tLose を決める
 * ② 「先に着くのは 遠いほう／近いほう」を えらび、みちのりを DIST_GAP 以上 はなす
 * ③ 速さは みちのり ÷ 時間 で決まる。はんいに入らなければ 作り直す
 */
export function makeRound(rng: () => number, round: number): Round {
  const gapMs = GAPS_MS[Math.min(round, GAPS_MS.length - 1)]!;
  for (let attempt = 0; attempt < 200; attempt++) {
    const tWin = rand(rng, TWIN_MIN, TWIN_MAX);
    const tLose = tWin + gapMs / 1000;
    const farWins = rng() < 0.5;
    // みちのりを 2つ えらぶ（差は DIST_GAP 以上）
    const dA = rand(rng, DIST_MIN, DIST_MAX - DIST_GAP);
    const dB = rand(rng, dA + DIST_GAP, DIST_MAX);
    const distWin = farWins ? dB : dA;
    const distLose = farWins ? dA : dB;
    const speedWin = distWin / tWin;
    const speedLose = distLose / tLose;
    if (speedWin < SPEED_MIN || speedWin > SPEED_MAX) continue;
    if (speedLose < SPEED_MIN || speedLose > SPEED_MAX) continue;
    const winner: 'L' | 'R' = rng() < 0.5 ? 'L' : 'R';
    const r: Round =
      winner === 'L'
        ? {
            distL: distWin,
            speedL: speedWin,
            distR: distLose,
            speedR: speedLose,
            tL: tWin,
            tR: tLose,
            winner,
            gapMs,
            farWins,
          }
        : {
            distL: distLose,
            speedL: speedLose,
            distR: distWin,
            speedR: speedWin,
            tL: tLose,
            tR: tWin,
            winner,
            gapMs,
            farWins,
          };
    return r;
  }
  // ここに来ることは まず無い（3000シード×10ラウンド＝3万問で 0回）。
  // ※ 来ても「gapMs が 実際の差と 一致する」ようにしておく。数値を 直書きすると
  //   gapMs が うそになり、「きわどい しょうぶ」の 判定（close-call 実績）が 狂う。
  const tWin = TWIN_MIN;
  const tLose = tWin + gapMs / 1000;
  return {
    distL: 120,
    speedL: 120 / tWin,
    distR: 200,
    speedR: 200 / tLose,
    tL: tWin,
    tR: tLose,
    winner: 'L',
    gapMs,
    farWins: false,
  };
}

/** 1プレイぶん */
export function makeRounds(rng: () => number): Round[] {
  const out: Round[] = [];
  for (let i = 0; i < ROUNDS; i++) out.push(makeRound(rng, i));
  return out;
}

/** せいかいの点（後のラウンドほど 高い） */
export function roundPoints(round: number): number {
  return 50 + round * 10;
}

/** ぜんもん せいかいの ボーナス */
export const ALL_BONUS = 150;

/** 満点 */
export function maxScore(): number {
  let s = ALL_BONUS;
  for (let i = 0; i < ROUNDS; i++) s += roundPoints(i);
  return s;
}
