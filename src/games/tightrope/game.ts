// =============================================================
// つなわたりバランス（No.38）: 高い高い綱の上、バランスをとりながらどこまで歩ける？
// =============================================================
// - キャラは自動で前へ歩く。傾いたら「ぎゃくがわ」を押す（またはスマホをぎゃくにかたむける）。
// - まっすぐは不安定＝ほうっておくと必ず倒れる（倒立振子）。ときどき風🌬が押してくる（予告つき）。
// - 物理・風は logic.ts（rng注入・サブステップ1/120）。40°倒れたら落下。200mでゴール。
// - 操作は 画面左半分/右半分ホールド（onDown/onUp のみ・onMove非購読）＋かたむき任意（optionalSensors）。
// - プレイは全て Canvas 描画（design 360×640・固定色）。設定画面なし＝シェルの3-2-1。
// - import してよいのは game-api（types / helpers）と、このフォルダ内（logic）だけ
import type { GameContext, IGame } from '../../game-api/types';
import { clamp } from '../../game-api/helpers';
import {
  FALL_RAD,
  GOAL_M,
  RECOV_IN,
  RECOV_OUT,
  SUBSTEP,
  U_HOLD,
  U_TILT,
  WIND_GUST_MS,
  WIND_TELEGRAPH_MS,
  gravAt,
  rollWind,
  scoreOf,
  stepPendulum,
  walkAt,
  windScaleAt,
  type Pendulum,
} from './logic';

const W = 360;
const H = 640;
const ROPE_Y = 430;
const CHAR_X = 150;
const PX_PER_M = 26;
const END_DELAY = 1900;
const FALL_ANIM_MS = 1100;

type Mode = 'ready' | 'play' | 'fall' | 'over';

export function createGame(ctx: GameContext): IGame {
  const cv = ctx.canvas2d({ design: { w: W, h: H } });
  const g = cv.ctx;

  // ---- 状態 ----
  let mode: Mode = 'ready';
  let hostPaused = false;
  const pend: Pendulum = { th: 0, om: 0 };
  let dist = 0;
  let recoveries = 0;
  let inDanger = false; // RECOV_IN を超えている間 true（戻すと立てなおし+1）
  let usedHold = false;
  let acc = 0;
  // 風
  let windAt = 0; // 予告開始時刻
  let gustFrom = 0;
  let gustUntil = 0;
  let windDir: -1 | 1 = 1;
  let windForce = 0;
  let windBeeped = false;
  // ホールド入力（マルチタッチ対応: 側ごとに押している指の集合）
  const leftIds = new Set<number>();
  const rightIds = new Set<number>();
  // 終了
  let fallAt = 0;
  let goaled = false;
  let endAt = 0;
  let ended = false;
  let lastMilestone = 0;

  function setData(): void {
    const r = ctx.root as HTMLElement;
    r.dataset.mode = mode;
    r.dataset.dist = dist.toFixed(2);
    if (!import.meta.env.DEV) return;
    r.dataset.theta = pend.th.toFixed(4);
    r.dataset.omega = pend.om.toFixed(4);
    r.dataset.recov = String(recoveries);
    r.dataset.score = String(scoreOf(dist, recoveries));
    r.dataset.gust = mode === 'play' && ctx.now() >= gustFrom && ctx.now() < gustUntil ? String(windDir * windForce) : '0';
    r.dataset.windinfo = `${Math.round(windAt)}|${Math.round(gustFrom)}|${Math.round(gustUntil)}|${windDir}|${windForce.toFixed(2)}`;
  }

  // ---- 入力（左右ホールド。road-race と同じ onDown/onUp 方式）----
  const offDown = ctx.input.onDown((p) => {
    if (mode !== 'play' || hostPaused) return;
    const l = cv.toLocal(p);
    if (l.x < W / 2) leftIds.add(p.id);
    else rightIds.add(p.id);
    usedHold = true;
  });
  const offUp = ctx.input.onUp((p) => {
    leftIds.delete(p.id);
    rightIds.delete(p.id);
  });

  function holdDir(): number {
    return (rightIds.size > 0 ? 1 : 0) - (leftIds.size > 0 ? 1 : 0);
  }

  // ---- 風 ----
  function scheduleWind(now: number): void {
    const roll = rollWind(ctx.random);
    windAt = now + roll.delayMs;
    windDir = roll.dir;
    windForce = roll.base * windScaleAt(dist);
    windBeeped = false;
    gustFrom = windAt + WIND_TELEGRAPH_MS;
    gustUntil = gustFrom + WIND_GUST_MS;
  }

  // ---- 進行 ----
  function updatePlay(dt: number, now: number): void {
    // 風のスケジュール送り
    if (now >= gustUntil) scheduleWind(now);
    if (!windBeeped && now >= windAt) {
      windBeeped = true;
      ctx.sfx('tick'); // 予告の合図
    }
    const gustActive = now >= gustFrom && now < gustUntil;

    // 入力の合成
    const tilt = ctx.motion ? clamp(ctx.motion.tilt.x, -1, 1) * U_TILT : 0;
    const u = tilt + holdDir() * U_HOLD + (gustActive ? windDir * windForce : 0);

    // 物理（固定サブステップ）
    const k = gravAt(dist);
    acc += dt;
    while (acc >= SUBSTEP) {
      acc -= SUBSTEP;
      stepPendulum(pend, u, k, SUBSTEP);
    }

    // 立てなおし判定
    const a = Math.abs(pend.th);
    if (!inDanger && a >= RECOV_IN) {
      inDanger = true;
      ctx.haptic('medium');
    } else if (inDanger && a <= RECOV_OUT) {
      inDanger = false;
      recoveries++;
      ctx.sfx('combo');
      if (recoveries >= 8) ctx.achieve('recover-8');
    }

    // 落下
    if (a >= FALL_RAD) {
      mode = 'fall';
      fallAt = now;
      ctx.sfx('fail');
      ctx.haptic('error');
      endAt = now + FALL_ANIM_MS + END_DELAY;
      return;
    }

    // 前進（単調マイルストーンは加算箇所で即解除）
    dist += walkAt(dist) * dt;
    if (dist >= 10) ctx.achieve('first-10');
    if (dist >= 50) {
      ctx.achieve('dist-50');
      if (!usedHold && ctx.motion) ctx.achieve('tilt-only-50');
    }
    if (dist >= 100) ctx.achieve('dist-100');
    const mile = Math.floor(dist / 25);
    if (mile > lastMilestone) {
      lastMilestone = mile;
      ctx.sfx('success');
    }

    // ゴール
    if (dist >= GOAL_M) {
      dist = GOAL_M;
      goaled = true;
      mode = 'over';
      ctx.achieve('goal-200');
      ctx.sfx('medal');
      ctx.haptic('success');
      endAt = now + END_DELAY;
    }
  }

  // ---- 毎フレーム ----
  const offFrame = ctx.onFrame((dt) => {
    const now = ctx.now();
    if (mode === 'play' && !hostPaused) updatePlay(dt, now);
    if (mode === 'fall' && now >= fallAt + FALL_ANIM_MS + 200 && !goaled) {
      // 落下アニメが終わったら結果待ち（over 扱い）
      mode = 'over';
    }
    if ((mode === 'over' || mode === 'fall') && !ended && endAt > 0 && now >= endAt) {
      ended = true;
      ctx.end({ score: scoreOf(dist, recoveries) });
      return;
    }
    draw(now);
    setData();
  });

  // ---- 描画（固定パレット＝両テーマ共通）----
  function draw(now: number): void {
    // 空
    const sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#8fc7f2');
    sky.addColorStop(1, '#e8f4fd');
    g.fillStyle = sky;
    g.fillRect(0, 0, W, H);

    // 遠くの山（パララックス小）
    g.fillStyle = '#b8d9ee';
    const hillShift = (dist * PX_PER_M * 0.12) % 260;
    for (let i = -1; i < 3; i++) {
      const bx = i * 260 - hillShift;
      g.beginPath();
      g.moveTo(bx, 560);
      g.quadraticCurveTo(bx + 130, 440, bx + 260, 560);
      g.fill();
    }
    // 地面（はるか下）
    g.fillStyle = '#9fd08a';
    g.fillRect(0, 596, W, H - 596);
    g.fillStyle = '#7db968';
    const gShift = (dist * PX_PER_M * 0.35) % 60;
    for (let i = 0; i < 8; i++) {
      const tx = i * 60 - gShift;
      g.beginPath();
      g.moveTo(tx, 596);
      g.lineTo(tx + 10, 580);
      g.lineTo(tx + 20, 596);
      g.fill();
    }

    // 雲（パララックス）
    g.fillStyle = 'rgba(255,255,255,.85)';
    const cShift = (dist * PX_PER_M * 0.18) % 500;
    for (const c of [
      { x: 90, y: 120, r: 20 },
      { x: 320, y: 200, r: 16 },
      { x: 520, y: 90, r: 24 },
    ]) {
      const cx = ((c.x - cShift) % 500 + 500) % 500 - 70;
      g.beginPath();
      g.arc(cx, c.y, c.r, 0, Math.PI * 2);
      g.arc(cx + c.r * 0.9, c.y + 4, c.r * 0.75, 0, Math.PI * 2);
      g.arc(cx - c.r * 0.9, c.y + 5, c.r * 0.7, 0, Math.PI * 2);
      g.fill();
    }

    // 綱と目印（10mごとに小旗・50mごとに大旗）
    g.strokeStyle = '#6b4d2f';
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(0, ROPE_Y);
    g.lineTo(W, ROPE_Y);
    g.stroke();
    for (let m = Math.floor(dist / 10) * 10; m <= dist + 16; m += 10) {
      const x = (m - dist) * PX_PER_M + CHAR_X;
      if (x < -20 || x > W + 20 || m <= 0) continue;
      const big = m % 50 === 0;
      g.strokeStyle = '#8a6a4e';
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(x, ROPE_Y);
      g.lineTo(x, ROPE_Y - (big ? 40 : 24));
      g.stroke();
      g.fillStyle = big ? '#f0524a' : '#ffc94d';
      g.beginPath();
      g.moveTo(x, ROPE_Y - (big ? 40 : 24));
      g.lineTo(x + (big ? 26 : 18), ROPE_Y - (big ? 33 : 19));
      g.lineTo(x, ROPE_Y - (big ? 26 : 14));
      g.closePath();
      g.fill();
      if (big) {
        g.fillStyle = '#5a4636';
        g.font = 'bold 12px sans-serif';
        g.textAlign = 'center';
        g.fillText(`${m}m`, x, ROPE_Y + 18);
      }
    }
    // ゴール
    if (GOAL_M - dist < 14) {
      const gx = (GOAL_M - dist) * PX_PER_M + CHAR_X;
      g.strokeStyle = '#444';
      g.lineWidth = 4;
      g.beginPath();
      g.moveTo(gx, ROPE_Y);
      g.lineTo(gx, ROPE_Y - 66);
      g.stroke();
      g.font = '28px sans-serif';
      g.textAlign = 'left';
      g.fillText('🏁', gx - 2, ROPE_Y - 66);
    }

    // キャラ（足元を支点に θ 回転）
    const fallT = mode === 'fall' ? Math.min(1, (now - fallAt) / FALL_ANIM_MS) : 0;
    const drawTh = mode === 'fall' ? pend.th + Math.sign(pend.th || 1) * fallT * 1.2 : pend.th;
    const dropY = mode === 'fall' ? fallT * fallT * 140 : 0;
    g.save();
    g.translate(CHAR_X, ROPE_Y + dropY);
    g.rotate(drawTh);
    // 足
    g.strokeStyle = '#3a4763';
    g.lineWidth = 5;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(-6, 0);
    g.lineTo(0, -22);
    g.lineTo(6, 0);
    g.stroke();
    // 体
    g.strokeStyle = '#f0524a';
    g.lineWidth = 9;
    g.beginPath();
    g.moveTo(0, -22);
    g.lineTo(0, -52);
    g.stroke();
    // バランス棒（しなり付き）
    g.strokeStyle = '#c8953c';
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(-52, -40);
    g.quadraticCurveTo(0, -50, 52, -40);
    g.stroke();
    // 腕
    g.strokeStyle = '#f0524a';
    g.lineWidth = 5;
    g.beginPath();
    g.moveTo(0, -48);
    g.lineTo(-24, -44);
    g.moveTo(0, -48);
    g.lineTo(24, -44);
    g.stroke();
    // 頭
    g.fillStyle = '#ffd9b3';
    g.beginPath();
    g.arc(0, -63, 11, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#5a4636';
    g.beginPath();
    g.arc(0, -70, 10, Math.PI, 0);
    g.fill();
    g.restore();

    // 風（予告と突風）
    const telegraphActive = mode === 'play' && now >= windAt && now < gustFrom;
    const gustActive = mode === 'play' && now >= gustFrom && now < gustUntil;
    if (telegraphActive || gustActive) {
      const ax = windDir > 0 ? 64 : W - 64;
      g.fillStyle = gustActive ? '#2c6fbb' : 'rgba(44,111,187,.55)';
      g.font = 'bold 30px sans-serif';
      g.textAlign = 'center';
      g.fillText(windDir > 0 ? '🌬→' : '←🌬', ax, 262);
      if (gustActive) {
        g.strokeStyle = 'rgba(90,150,210,.7)';
        g.lineWidth = 3;
        for (let i = 0; i < 3; i++) {
          const wy = 284 + i * 22;
          const phase = ((now / 4) % 60) * windDir;
          g.beginPath();
          g.moveTo(ax - 40 + phase, wy);
          g.lineTo(ax + 40 + phase, wy);
          g.stroke();
        }
      }
    }

    // かたむきメーター（上部中央）
    const mx = 180;
    const my = 84;
    g.strokeStyle = '#ffffff';
    g.lineWidth = 10;
    g.beginPath();
    g.arc(mx, my, 40, Math.PI * 1.22, Math.PI * 1.78);
    g.stroke();
    g.strokeStyle = '#3ed36a';
    g.beginPath();
    g.arc(mx, my, 40, Math.PI * 1.46, Math.PI * 1.54);
    g.stroke();
    const nd = clamp(pend.th / FALL_RAD, -1, 1) * 0.28 * Math.PI;
    g.strokeStyle = Math.abs(pend.th) > RECOV_IN ? '#f0524a' : '#3a4763';
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(mx, my);
    g.lineTo(mx + Math.sin(nd) * 42, my - Math.cos(nd) * 42);
    g.stroke();

    // あぶない演出（左右の赤み）
    if (mode === 'play' && Math.abs(pend.th) > RECOV_IN) {
      const alpha = Math.min(0.4, (Math.abs(pend.th) - RECOV_IN) / (FALL_RAD - RECOV_IN) * 0.4);
      g.fillStyle = `rgba(240,82,74,${alpha.toFixed(3)})`;
      g.fillRect(0, 0, 26, H);
      g.fillRect(W - 26, 0, 26, H);
    }

    // HUD（左上。右上60×60のポーズ領域は避ける）
    g.fillStyle = '#2c3d57';
    g.textAlign = 'left';
    g.font = 'bold 24px sans-serif';
    g.fillText(`${dist.toFixed(1)}m`, 14, 36);
    g.font = 'bold 13px sans-serif';
    g.fillText(`たてなおし ${recoveries}`, 14, 60);

    // 終了表示
    if (mode === 'over' || (mode === 'fall' && now >= fallAt + FALL_ANIM_MS)) {
      g.fillStyle = 'rgba(20,30,50,.62)';
      g.fillRect(0, 0, W, H);
      g.fillStyle = '#fff';
      g.textAlign = 'center';
      g.font = 'bold 34px sans-serif';
      g.fillText(goaled ? 'ゴール！！ 🏁' : 'おっとっと…', W / 2, H / 2 - 40);
      g.font = 'bold 24px sans-serif';
      g.fillText(`${dist.toFixed(1)}m あるいた`, W / 2, H / 2 + 8);
    }
  }

  // ---- 起動（シェルの 3-2-1 のあと start() が呼ばれる）----
  draw(0);
  setData();

  return {
    start() {
      mode = 'play';
      ctx.motion?.calibrate();
      // 最初のかたむき（±3°くらい）。まっすぐは不安定＝ここから勝負が始まる
      pend.th = (ctx.random() * 2 - 1) * 0.052;
      pend.om = 0;
      scheduleWind(ctx.now());
      setData();
    },
    pause() {
      hostPaused = true;
      leftIds.clear();
      rightIds.clear();
    },
    resume() {
      hostPaused = false;
      ctx.motion?.calibrate();
    },
    resize() {
      draw(ctx.now());
    },
    destroy() {
      offDown();
      offUp();
      offFrame();
    },
  };
}
