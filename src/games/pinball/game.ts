// =============================================================
// ピンボール（No.73）: 左右のフリッパーで ボールをはじき、バンパーやターゲットで得点！
// =============================================================
// - 画面の左半分/右半分をホールドで フリッパーを跳ね上げる（onDown/onUp のみ・onMove非購読）。
//   ボール3個。フリッパーの間（ドレイン）に落とすと1個消費、0でゲームオーバー。
// - 物理・台レイアウトは logic.ts（純ロジック・乱数不使用＝完全決定論）。
//   固定サブステップ（1/240s）で安定。時間は ctx.now・setTimeout 不使用。
// - import してよいのは game-api（types / helpers）と、このフォルダ内（logic）だけ
import type { GameContext, IGame, PointerInfo } from '../../game-api/types';
import {
  BALL_R,
  BALL_START,
  BUMPERS,
  BUMPER_KICK,
  BUMPER_PTS,
  type Ball,
  FLIP_SPEED,
  GRAVITY,
  H,
  JACKPOT_PTS,
  LAUNCH_V,
  LANE_GUIDE_VX,
  LANE_GUIDE_Y,
  LANE_X,
  LEFT_PIVOT,
  LEFT_REST,
  LEFT_UP,
  MAX_MULT,
  RIGHT_PIVOT,
  RIGHT_REST,
  RIGHT_UP,
  SLINGS,
  SLING_KICK,
  SLING_PTS,
  TARGETS,
  TARGET_PTS,
  TARGET_RESET_MS,
  TOP_LANE_PTS,
  TOP_LANE_Y,
  W,
  WALLS,
  WALL_E,
  clampSpeed,
  collideBumper,
  collideFlipper,
  collideSeg,
  flipperTip,
} from './logic';

const HUD_H = 40;
const LIVES0 = 3;
const END_DELAY = 2000;
const SCORE_HI = 5000;
const SINGLE_BALL_GOAL = 2000;

type Mode = 'ready' | 'play' | 'drain' | 'over';

export function createGame(ctx: GameContext): IGame {
  const cv = ctx.canvas2d({ design: { w: W, h: H } });
  const g = cv.ctx;

  let mode: Mode = 'ready';
  let hostPaused = false;
  const ball: Ball = { x: BALL_START.x, y: BALL_START.y, vx: 0, vy: 0 };
  let lives = LIVES0;
  let score = 0;
  let ballScore = 0; // このボールで稼いだ点（no-drain 実績用）
  let mult = 1;
  let bumperHits = 0;
  let targetsDown: boolean[] = TARGETS.map(() => false);
  let bankResetAt = 0;
  let toppedThisFlight = false; // このフライトで 上部レーン加点済みか
  let flashUntil = 0;
  let jackpotFlashUntil = 0;
  let acc = 0;
  let drainAt = 0;
  let endAt = 0;
  let ended = false;
  let msg = '';
  let msgUntil = 0;

  // フリッパー角度と 前サブステップの角度（角速度算出用）
  let leftAng = LEFT_REST;
  let rightAng = RIGHT_REST;
  let leftHeld = false;
  let rightHeld = false;
  let leftPid = -1;
  let rightPid = -1;

  function addScore(n: number): void {
    score += n;
    ballScore += n;
    if (n > 0) ctx.achieve('first-hit'); // 「はじめて得点した」＝加点の種類を問わない（冪等）
    if (score >= SCORE_HI) ctx.achieve('score-hi');
    if (ballScore >= SINGLE_BALL_GOAL) ctx.achieve('no-drain-2000');
  }

  function showMsg(t: string, now: number): void {
    msg = t;
    msgUntil = now + 1300;
  }

  function launch(): void {
    if (mode !== 'ready') return;
    ball.vy = -LAUNCH_V;
    ball.vx = 0;
    mode = 'play';
    toppedThisFlight = false;
    ctx.sfx('start');
    ctx.haptic('medium');
  }

  function resetBall(now: number): void {
    ball.x = BALL_START.x;
    ball.y = BALL_START.y;
    ball.vx = 0;
    ball.vy = 0;
    ballScore = 0;
    toppedThisFlight = false;
    mode = 'ready';
    void now;
  }

  // ---- 入力 ----
  const offDown = ctx.input.onDown((p: PointerInfo) => {
    if (hostPaused) return;
    if (mode === 'ready') {
      launch();
      return;
    }
    if (mode !== 'play') return;
    const l = cv.toLocal(p);
    if (l.x < W / 2) {
      leftHeld = true;
      leftPid = p.id;
    } else {
      rightHeld = true;
      rightPid = p.id;
    }
  });
  const offUp = ctx.input.onUp((p: PointerInfo) => {
    if (p.id === leftPid) {
      leftHeld = false;
      leftPid = -1;
    }
    if (p.id === rightPid) {
      rightHeld = false;
      rightPid = -1;
    }
  });

  // ---- 物理サブステップ ----
  function substep(dt: number, now: number): void {
    // フリッパーを目標角へ回す（角速度を記録）
    const prevL = leftAng;
    const prevR = rightAng;
    const lTarget = leftHeld ? LEFT_UP : LEFT_REST;
    const rTarget = rightHeld ? RIGHT_UP : RIGHT_REST;
    const step = FLIP_SPEED * dt;
    leftAng += Math.max(-step, Math.min(step, lTarget - leftAng));
    rightAng += Math.max(-step, Math.min(step, rTarget - rightAng));
    const lOmega = (leftAng - prevL) / dt;
    const rOmega = (rightAng - prevR) / dt;

    if (mode === 'ready') return;

    // 重力
    ball.vy += GRAVITY * dt;
    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;
    clampSpeed(ball);

    // 発射レーンの上部ガイド: 上りきったボールを 左（プレイフィールド）へ送り出す
    if (ball.x > LANE_X && ball.y < LANE_GUIDE_Y && ball.vy < 0 && ball.vx > LANE_GUIDE_VX + 30) {
      ball.vx = LANE_GUIDE_VX;
    }

    // かべ
    for (const s of WALLS) collideSeg(ball, BALL_R, s, WALL_E);
    // スリング（反射＋キック＋加点）
    for (const s of SLINGS) {
      if (collideSeg(ball, BALL_R, s, WALL_E, SLING_KICK)) {
        addScore(SLING_PTS);
        ctx.sfx('tick');
      }
    }
    // バンパー
    for (const c of BUMPERS) {
      if (collideBumper(ball, BALL_R, c, BUMPER_KICK)) {
        bumperHits++;
        addScore(BUMPER_PTS * mult);
        flashUntil = now + 90;
        if (bumperHits >= 10) ctx.achieve('bumper-10');
        ctx.sfx('combo');
        ctx.haptic('light');
      }
    }
    // ドロップターゲット（矩形・上面/前面で判定）
    for (let i = 0; i < TARGETS.length; i++) {
      if (targetsDown[i]) continue;
      const t = TARGETS[i]!;
      if (ball.x > t.x - BALL_R && ball.x < t.x + t.w + BALL_R && ball.y > t.y - BALL_R && ball.y < t.y + t.h + BALL_R) {
        targetsDown[i] = true;
        addScore(TARGET_PTS * mult);
        ball.vy = Math.abs(ball.vy) * 0.6 + 60; // 下へ弾く
        ctx.sfx('tick');
        ctx.haptic('light');
        if (targetsDown.every(Boolean)) {
          const jackpotGain = JACKPOT_PTS * mult; // 表示も同じ値を使う（倍率上限時の表示ズレ防止）
          addScore(jackpotGain);
          ctx.achieve('bank-clear');
          mult = Math.min(MAX_MULT, mult + 1);
          if (mult >= MAX_MULT) ctx.achieve('multiplier-3');
          jackpotFlashUntil = now + 1100;
          showMsg(`ジャックポット！ +${jackpotGain}`, now);
          bankResetAt = now + TARGET_RESET_MS;
          ctx.sfx('medal');
          ctx.haptic('success');
        }
      }
    }
    // 上部レーン（上向きに横切ったら加点）
    if (!toppedThisFlight && ball.y < TOP_LANE_Y && ball.vy < 0) {
      toppedThisFlight = true;
      addScore(TOP_LANE_PTS);
      ctx.sfx('tick');
    }
    if (ball.y > TOP_LANE_Y + 30) toppedThisFlight = false;
    // フリッパー
    collideFlipper(ball, BALL_R, LEFT_PIVOT, flipperTip(LEFT_PIVOT, leftAng), lOmega, 0.4);
    collideFlipper(ball, BALL_R, RIGHT_PIVOT, flipperTip(RIGHT_PIVOT, rightAng), rOmega, 0.4);

    // ドレイン（フリッパーの間から下へ）
    if (ball.y > H - 8) {
      lives--;
      ballScore = 0;
      mode = 'drain';
      drainAt = now + 900;
      ctx.sfx('fail');
      ctx.haptic('error');
    }
  }

  // ---- 毎フレーム ----
  const offFrame = ctx.onFrame((dt) => {
    if (hostPaused) return;
    const now = ctx.now();
    // バンク復活
    if (bankResetAt > 0 && now >= bankResetAt) {
      targetsDown = TARGETS.map(() => false);
      bankResetAt = 0;
    }
    if (mode === 'play' || mode === 'ready') {
      acc += Math.min(dt, 0.05);
      const STEP = 1 / 240;
      let guard = 0;
      while (acc >= STEP && guard++ < 40) {
        acc -= STEP;
        substep(STEP, now);
        if ((mode as Mode) === 'drain') break;
      }
    } else if (mode === 'drain') {
      if (now >= drainAt) {
        if (lives <= 0) {
          mode = 'over';
          endAt = now + END_DELAY;
        } else {
          resetBall(now);
        }
      }
    } else if (mode === 'over') {
      if (!ended && now >= endAt) {
        ended = true;
        ctx.end({ score });
        return;
      }
    }
    draw(now);
    setData();
  });

  function setData(): void {
    if (!import.meta.env.DEV) return;
    const r = ctx.root as HTMLElement;
    r.dataset.mode = mode;
    r.dataset.score = String(score);
    r.dataset.ballscore = String(ballScore);
    r.dataset.lives = String(lives);
    r.dataset.mult = String(mult);
    r.dataset.bumpers = String(bumperHits);
    r.dataset.targets = targetsDown.map((d) => (d ? 1 : 0)).join('');
    r.dataset.ball = `${ball.x.toFixed(1)},${ball.y.toFixed(1)}`;
    r.dataset.vel = `${ball.vx.toFixed(0)},${ball.vy.toFixed(0)}`;
    r.dataset.lang = leftAng.toFixed(3);
    r.dataset.rang = rightAng.toFixed(3);
    r.dataset.held = `${leftHeld ? 1 : 0}${rightHeld ? 1 : 0}`;
  }

  // ---- 描画 ----
  function line(s: { x1: number; y1: number; x2: number; y2: number }): void {
    g.beginPath();
    g.moveTo(s.x1, s.y1);
    g.lineTo(s.x2, s.y2);
    g.stroke();
  }

  function draw(now: number): void {
    // 台
    g.fillStyle = '#12183a';
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#1b2350';
    g.fillRect(10, 48, LANE_X - 10, H - 48);
    // 発射レーン
    g.fillStyle = '#0e1330';
    g.fillRect(LANE_X, 96, W - LANE_X - 4, H - 96 - 24);

    // かべ
    g.strokeStyle = '#5566b0';
    g.lineWidth = 4;
    g.lineCap = 'round';
    for (const s of WALLS) line(s);

    // 上部レーンの目印
    g.strokeStyle = 'rgba(120,200,255,.35)';
    g.lineWidth = 2;
    g.setLineDash([6, 6]);
    g.beginPath();
    g.moveTo(20, TOP_LANE_Y);
    g.lineTo(LANE_X - 4, TOP_LANE_Y);
    g.stroke();
    g.setLineDash([]);

    // スリング
    g.strokeStyle = '#e8a54a';
    g.lineWidth = 6;
    for (const s of SLINGS) line(s);

    // ドロップターゲット
    for (let i = 0; i < TARGETS.length; i++) {
      const t = TARGETS[i]!;
      if (targetsDown[i]) {
        g.fillStyle = 'rgba(255,255,255,.12)';
        g.fillRect(t.x, t.y + t.h - 3, t.w, 3);
      } else {
        g.fillStyle = '#ffd54a';
        g.fillRect(t.x, t.y, t.w, t.h);
        g.fillStyle = 'rgba(0,0,0,.25)';
        g.fillRect(t.x, t.y + t.h - 3, t.w, 3);
      }
    }

    // バンパー
    for (const c of BUMPERS) {
      const hot = now < flashUntil;
      g.fillStyle = hot ? '#fff' : '#4aa3ff';
      g.beginPath();
      g.arc(c.x, c.y, c.r, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = hot ? '#4aa3ff' : '#1b2350';
      g.beginPath();
      g.arc(c.x, c.y, c.r * 0.5, 0, Math.PI * 2);
      g.fill();
    }

    // フリッパー
    g.strokeStyle = '#ff6b8a';
    g.lineWidth = 13;
    line({ x1: LEFT_PIVOT.x, y1: LEFT_PIVOT.y, x2: flipperTip(LEFT_PIVOT, leftAng).x, y2: flipperTip(LEFT_PIVOT, leftAng).y });
    line({ x1: RIGHT_PIVOT.x, y1: RIGHT_PIVOT.y, x2: flipperTip(RIGHT_PIVOT, rightAng).x, y2: flipperTip(RIGHT_PIVOT, rightAng).y });
    g.fillStyle = '#c04060';
    for (const p of [LEFT_PIVOT, RIGHT_PIVOT]) {
      g.beginPath();
      g.arc(p.x, p.y, 7, 0, Math.PI * 2);
      g.fill();
    }

    // ボール
    if (mode !== 'over') {
      g.fillStyle = '#e8ecf6';
      g.beginPath();
      g.arc(ball.x, ball.y, BALL_R, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = 'rgba(255,255,255,.6)';
      g.beginPath();
      g.arc(ball.x - 2.5, ball.y - 2.5, 2.6, 0, Math.PI * 2);
      g.fill();
    }

    // ジャックポット閃光
    if (now < jackpotFlashUntil) {
      g.fillStyle = `rgba(255,213,74,${0.25 * ((jackpotFlashUntil - now) / 1100)})`;
      g.fillRect(0, 0, W, H);
    }

    // HUD
    g.fillStyle = 'rgba(6,10,26,.9)';
    g.fillRect(0, 0, W, HUD_H);
    g.fillStyle = '#fff';
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.font = 'bold 18px sans-serif';
    g.fillText(`${score}`, 12, HUD_H / 2);
    if (mult > 1) {
      g.fillStyle = '#ffd54a';
      g.font = 'bold 15px sans-serif';
      g.fillText(`×${mult}`, 96, HUD_H / 2);
    }
    g.fillStyle = '#ff9ab0';
    g.textAlign = 'right';
    g.font = 'bold 16px sans-serif';
    g.fillText('●'.repeat(Math.max(0, lives)), W - 12, HUD_H / 2);

    // メッセージ
    if (now < msgUntil) {
      g.fillStyle = '#ffd54a';
      g.textAlign = 'center';
      g.font = 'bold 20px sans-serif';
      g.fillText(msg, (LANE_X + 10) / 2, 250);
    }

    // 状態オーバーレイ
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    if (mode === 'ready') {
      g.fillStyle = '#cfe0ff';
      g.font = 'bold 15px sans-serif';
      g.save();
      g.translate(LANE_X + (W - LANE_X) / 2 - 2, 360);
      g.rotate(-Math.PI / 2);
      g.fillText('タップで はっしゃ！', 0, 0);
      g.restore();
      g.fillStyle = 'rgba(207,224,255,.9)';
      g.font = 'bold 13px sans-serif';
      g.fillText('左半分/右半分を おして フリッパー', (LANE_X + 10) / 2, H - 20);
    } else if (mode === 'drain') {
      g.fillStyle = '#ff8a8a';
      g.font = 'bold 22px sans-serif';
      g.fillText('ミス！', (LANE_X + 10) / 2, 300);
    } else if (mode === 'over') {
      g.fillStyle = 'rgba(6,10,26,.8)';
      g.fillRect(0, 0, W, H);
      g.fillStyle = '#fff';
      g.font = 'bold 30px sans-serif';
      g.fillText('ゲームオーバー', W / 2, H / 2 - 30);
      g.font = 'bold 24px sans-serif';
      g.fillText(`${score}てん`, W / 2, H / 2 + 14);
    }
  }

  draw(0);
  setData();

  return {
    start() {
      /* immediate: ready 状態でタップ発射 */
    },
    pause() {
      hostPaused = true;
      leftHeld = false;
      rightHeld = false;
      leftPid = -1;
      rightPid = -1;
    },
    resume() {
      hostPaused = false;
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
