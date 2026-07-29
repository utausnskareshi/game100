// =============================================================
// ふたつの せかい（No.122・かくれゲーム）: タップ1回で 2人が 同時に ジャンプ
// =============================================================
// - ねらい: #31 ダブルうさぎは「2匹を べつべつに 操る」。こちらは **入力が1つ**で、
//   上でも 下でも 安全な しゅんかんを 見つける遊び。
// - コースは logic 側で「ジャンプの時こく表を先に決めて、それに合う所だけに
//   じゃまものを置く」ので **かならず 全部 かわせる**（理不尽が 出ない）。
// - import してよいのは game-api（types / helpers）と、このフォルダ内（logic）だけ。
import type { GameContext, IGame } from '../../game-api/types';
import {
  AIR_MS,
  CLEAN_BONUS,
  INVULN_MS,
  LIVES,
  type Course,
  RUN_X,
  airborneAt,
  makeCourse,
  obsOk,
  obsPoints,
  obsX,
} from './logic';

const W = 360;
const H = 640;
const HUD_H = 46;

/** せかいの わく（上・下） */
const SKY = [70, 320];
const GROUND = [262, 512];
const RUNNER_R = 15;
const JUMP_H = 92;

const HIT_MS = 700;
const END_DELAY = 2600;
const SCORE_HI = 950;

const C_BG = '#0f1626';
const C_SKY_A = '#1b2a44';
const C_SKY_B = '#2a1b3d';
const C_GROUND = '#3b4d70';
const C_TEXT = '#eaf2ff';
const C_DIM = '#8ba0c4';
const C_ME_A = '#4ad0e0';
const C_ME_B = '#ffa0d0';
const C_SPIKE = '#ff6b6b';
const C_CEIL = '#ffc14a';
const C_OK = '#43c98a';
const C_NG = '#e0483c';

type Mode = 'play' | 'done';

export function createGame(ctx: GameContext): IGame {
  const cv = ctx.canvas2d({ design: { w: W, h: H } });
  const g = cv.ctx;

  const course: Course = makeCourse(ctx.random);
  /** じっさいに 押した 時こく */
  const myTaps: number[] = [];
  /** じゃまものを もう 判定したか */
  const judged: boolean[] = course.obs.map(() => false);
  let mode: Mode = 'play';
  let started = false;
  let hostPaused = false;
  let ended = false;
  let startAt = 0;
  let score = 0;
  let passed = 0;
  let lives = LIVES;
  let crashes = 0;
  let streak = 0;
  let bestStreak = 0;
  /** ぶつかった直後の 無敵の 終わり（コース時間）。※0で 初期化しない（t=0 で 誤発火する） */
  let invulnUntil = -9999;
  let hitUntil = 0;
  let hitWorld = -1;
  let badTapUntil = 0;
  let phaseUntil = 0;
  let lastEvent = '';

  const nowT = (): number => ctx.now() - startAt;
  const airborne = (t: number): boolean => airborneAt(myTaps, t);

  // ---------- 入力 ----------
  const offTap = ctx.input.onTap(() => {
    if (hostPaused || !started || mode !== 'play') return;
    const t = nowT();
    if (airborne(t)) {
      // 空中では もう 押せない
      badTapUntil = ctx.now() + 500;
      lastEvent = 'inair';
      return;
    }
    myTaps.push(t);
    ctx.sfx('tap');
    ctx.haptic('light');
    lastEvent = `jump:${Math.round(t)}`;
  });

  // ---------- 毎フレーム ----------
  const offFrame = ctx.onFrame(() => {
    if (hostPaused || !started) return;
    const now = ctx.now();
    const t = nowT();
    if (mode === 'play') {
      for (let i = 0; i < course.obs.length; i++) {
        const o = course.obs[i]!;
        if (judged[i] || t < o.at) continue;
        judged[i] = true;
        // ★「いまの じょうたい」ではなく「その じゃまものが 来た しゅんかんの じょうたい」で 判定する。
        //   フレームが とんでも 結果が 変わらない（＝見た目と 判定が ずれない）
        if (obsOk(o.kind, airborneAt(myTaps, o.at))) {
          const pts = obsPoints(passed);
          score += pts;
          passed++;
          streak++;
          bestStreak = Math.max(bestStreak, streak);
          ctx.sfx('combo');
          if (passed === 1) ctx.achieve('first-pass');
          if (passed >= Math.ceil(course.obs.length / 2)) ctx.achieve('half');
          if (streak >= 8) ctx.achieve('streak-8');
          lastEvent = `pass:${i}:${o.kind}:${pts}`;
        } else if (t < invulnUntil) {
          // ★直前の ミスの まきこみ（上下ペアの とげは 198ms しか はなれていない）。
          //   1回の ミスで ライフを 2つ 減らさないため、ここでは 減らさない。
          streak = 0;
          lastEvent = `graze:${i}:${o.kind}`;
        } else {
          lives--;
          crashes++;
          streak = 0;
          invulnUntil = t + INVULN_MS;
          hitUntil = now + HIT_MS;
          hitWorld = o.world;
          ctx.sfx('fail');
          ctx.haptic('error');
          lastEvent = `hit:${i}:${o.kind}:${lives}`;
        }
      }
      if (lives <= 0 || t >= course.total) finish(now);
    } else if (mode === 'done' && !ended && now >= phaseUntil) {
      ended = true;
      ctx.end({ score });
      return;
    }
    draw(now, t);
    setData(t);
  });

  function finish(now: number): void {
    if (passed >= course.obs.length) ctx.achieve('all-pass');
    if (crashes === 0) {
      score += CLEAN_BONUS;
      ctx.achieve('no-crash');
    }
    if (score >= SCORE_HI) ctx.achieve('score-hi');
    mode = 'done';
    phaseUntil = now + END_DELAY;
    ctx.sfx('medal');
    lastEvent = `finish:${score}:${passed}/${course.obs.length}`;
  }

  function setData(t: number): void {
    if (!import.meta.env.DEV) return;
    const r = ctx.root as HTMLElement;
    r.dataset.mode = mode;
    r.dataset.t = String(Math.round(t));
    r.dataset.total = String(course.total);
    r.dataset.taps = course.taps.join(',');
    r.dataset.obs = course.obs.map((o) => `${o.world}${o.kind === 'spike' ? 's' : 'c'}${Math.round(o.at)}`).join(',');
    r.dataset.air = airborne(t) ? '1' : '0';
    r.dataset.passed = String(passed);
    r.dataset.obscount = String(course.obs.length);
    r.dataset.lives = String(lives);
    r.dataset.crashes = String(crashes);
    r.dataset.score = String(score);
    r.dataset.streak = String(streak);
    r.dataset.last = lastEvent;
  }

  // ---------- 描画 ----------
  /** ジャンプの 高さ（0〜1 の 山なり） */
  function jumpOffset(t: number): number {
    for (const tp of myTaps) {
      if (t >= tp && t < tp + AIR_MS) {
        const u = (t - tp) / AIR_MS;
        return Math.sin(u * Math.PI) * JUMP_H;
      }
    }
    return 0;
  }

  function drawWorld(w: number, t: number, lift: number): void {
    const skyY = SKY[w]!;
    const gy = GROUND[w]!;
    g.fillStyle = w === 0 ? C_SKY_A : C_SKY_B;
    g.fillRect(0, skyY, W, gy - skyY + 26);
    g.fillStyle = C_GROUND;
    g.fillRect(0, gy, W, 26);

    // じゃまもの
    for (let i = 0; i < course.obs.length; i++) {
      const o = course.obs[i]!;
      if (o.world !== w) continue;
      const x = obsX(o, t);
      if (x < -40 || x > W + 40) continue;
      if (o.kind === 'spike') {
        g.fillStyle = C_SPIKE;
        g.beginPath();
        g.moveTo(x, gy - 30);
        g.lineTo(x + 11, gy);
        g.lineTo(x - 11, gy);
        g.closePath();
        g.fill();
      } else {
        // 天井から 下がった かべ。地面から 46px だけ すきまが あるので、
        // 地上なら くぐれて、とぶと ぶつかる（見た目と ルールが 一致する）
        g.fillStyle = C_CEIL;
        g.fillRect(x - 9, skyY, 18, gy - 46 - skyY);
        g.fillStyle = 'rgba(0,0,0,.25)';
        g.fillRect(x - 9, gy - 52, 18, 6);
      }
    }

    // 走る人
    const cy = gy - RUNNER_R - lift;
    const hurt = ctx.now() < hitUntil && hitWorld === w;
    g.fillStyle = hurt ? C_NG : w === 0 ? C_ME_A : C_ME_B;
    g.beginPath();
    g.arc(RUN_X, cy, RUNNER_R, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#0d1a2a';
    g.beginPath();
    g.arc(RUN_X + 4, cy - 3, 2.6, 0, Math.PI * 2);
    g.fill();
    // 地面の 影
    g.fillStyle = 'rgba(0,0,0,.28)';
    g.beginPath();
    g.ellipse(RUN_X, gy + 3, RUNNER_R * 0.8, 4, 0, 0, Math.PI * 2);
    g.fill();
  }

  function draw(now: number, t: number): void {
    cv.clear(C_BG);
    const lift = jumpOffset(t);

    // HUD
    g.fillStyle = '#0a0f1c';
    g.fillRect(0, 0, W, HUD_H);
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.fillStyle = C_TEXT;
    g.font = 'bold 18px sans-serif';
    g.fillText(`${score}てん`, 12, HUD_H / 2);
    g.fillStyle = C_DIM;
    g.font = 'bold 13px sans-serif';
    g.fillText(`かわした ${passed}/${course.obs.length}`, 116, HUD_H / 2 - 8);
    g.fillText(`れんぞく ${streak}`, 116, HUD_H / 2 + 9);
    g.textAlign = 'right';
    g.fillStyle = C_NG;
    g.font = 'bold 15px sans-serif';
    g.fillText('♥'.repeat(Math.max(0, lives)), W - 12, HUD_H / 2);

    g.textAlign = 'center';

    if (mode === 'done') {
      g.fillStyle = '#0f1626';
      g.fillRect(0, HUD_H, W, H - HUD_H);
      g.fillStyle = C_TEXT;
      g.font = 'bold 26px sans-serif';
      g.fillText(`${passed} / ${course.obs.length} かわした！`, W / 2, 280);
      g.font = 'bold 34px sans-serif';
      g.fillStyle = C_ME_A;
      g.fillText(`${score}てん`, W / 2, 336);
      g.fillStyle = C_DIM;
      g.font = 'bold 14px sans-serif';
      g.fillText(`ぶつかった ${crashes}かい・さいこう れんぞく ${bestStreak}`, W / 2, 380);
      return;
    }

    drawWorld(0, t, lift);
    drawWorld(1, t, lift);

    // まん中の しきり
    g.fillStyle = 'rgba(255,255,255,.08)';
    g.fillRect(0, 300, W, 2);

    // ようす
    g.font = 'bold 13px sans-serif';
    if (now < badTapUntil) {
      g.fillStyle = C_NG;
      g.fillText('空中では ジャンプできない', W / 2, 596);
    } else if (lift > 0) {
      g.fillStyle = C_OK;
      g.fillText('ジャンプ中！ ふたり 同時に とんでいる', W / 2, 596);
    } else {
      g.fillStyle = C_DIM;
      g.fillText('タップで 2人 同時に ジャンプ', W / 2, 596);
    }
    g.fillStyle = C_DIM;
    g.font = 'bold 11px sans-serif';
    g.fillText('▲とげ＝とびこえる ／ ■ひくい かべ＝とばずに くぐる', W / 2, 620);
  }

  draw(0, 0);
  setData(0);

  return {
    start() {
      started = true;
      startAt = ctx.now();
    },
    pause() {
      hostPaused = true;
    },
    resume() {
      hostPaused = false;
    },
    resize() {
      draw(ctx.now(), nowT());
    },
    destroy() {
      offTap();
      offFrame();
    },
  };
}
