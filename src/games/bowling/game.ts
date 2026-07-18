// =============================================================
// ボウリング（No.60）: スワイプで ボールを 投げて ピンを たおそう！全10フレーム
// =============================================================
// - 下から 上へ スワイプ＝投球（横のふり幅で ねらい・上への長さで 強さ）。
//   ピンの物理・得点は logic.ts（純ロジック・乱数なし＝完全決定論）。標準ルール採点。
// - 全画面 Canvas（トップダウン）。操作は onDown/onUp（スワイプ）。onMove 非購読＝キャプチャなし。
// - 時間は ctx.now・setTimeout 不使用。import は game-api と 同一フォルダのみ。
import type { GameContext, IGame, PointerInfo } from '../../game-api/types';
import { clamp } from '../../game-api/helpers';
import { BALL_R, CASCADE_DIST, KNOCK_DIST, PIN_R, type Vec, bowlingScore, pinLayout, resolveCircles } from './logic';

const W = 360;
const H = 640;
const BALL_Y0 = 566;
const GUTTER_L = 24;
const GUTTER_R = W - 24;
const FRICTION = 0.55; // 速度の減衰（/秒の割合っぽく）
const SETTLE_SPEED = 12;
const MAX_ROLL_MS = 4000;
const END_DELAY = 2200;
const FRAMES = 10;

type Phase = 'aim' | 'rolling' | 'over';
interface Pin extends Vec { vx: number; vy: number; home: Vec; down: boolean }
interface Ball extends Vec { vx: number; vy: number; active: boolean }

export function createGame(ctx: GameContext): IGame {
  const cv = ctx.canvas2d({ design: { w: W, h: H } });
  const g = cv.ctx;

  let phase: Phase = 'aim';
  let hostPaused = false;
  let pins: Pin[] = [];
  let ball: Ball = { x: W / 2, y: BALL_Y0, vx: 0, vy: 0, active: false };
  let rolls: number[] = [];
  let frame = 0;
  let throwInFrame = 0;
  let frameFirstRollIdx = 0; // 今フレームの最初のロールの rolls index
  let standingBefore = 10;
  let rollStartAt = 0;
  let dragStart: { x: number; y: number } | null = null;
  let dragId: number | null = null;
  let strikeStreak = 0;
  let strikeCount = 0;
  let endAt = 0;
  let ended = false;
  let msg = '';
  let msgUntil = 0;

  function standing(): number {
    return pins.filter((p) => !p.down).length;
  }
  function score(): number {
    return bowlingScore(rolls);
  }

  function setData(): void {
    if (!import.meta.env.DEV) return;
    const r = ctx.root as HTMLElement;
    r.dataset.phase = phase;
    r.dataset.frame = String(frame);
    r.dataset.throw = String(throwInFrame);
    r.dataset.rolls = rolls.join(',');
    r.dataset.score = String(score());
    r.dataset.standing = String(standing());
    r.dataset.ballactive = ball.active ? '1' : '0';
  }

  function rackFull(): void {
    const layout = pinLayout();
    pins = layout.map((p) => ({ x: p.x, y: p.y, vx: 0, vy: 0, home: { x: p.x, y: p.y }, down: false }));
  }
  function keepStanding(): void {
    // たおれたピンを のぞき、立っているピンは 定位置に戻す
    pins = pins.filter((p) => !p.down).map((p) => ({ ...p, x: p.home.x, y: p.home.y, vx: 0, vy: 0 }));
  }
  function resetBall(): void {
    ball = { x: W / 2, y: BALL_Y0, vx: 0, vy: 0, active: false };
  }

  function startFrame(): void {
    rackFull();
    resetBall();
    throwInFrame = 0;
    frameFirstRollIdx = rolls.length;
    standingBefore = 10;
    phase = 'aim';
  }

  function showMsg(t: string): void {
    msg = t;
    msgUntil = ctx.now() + 1400;
  }

  // ---- 入力（スワイプ投球）----
  const setStart = (p: PointerInfo): void => {
    if (phase !== 'aim' || hostPaused) return;
    if (dragId === null) {
      dragId = p.id;
      dragStart = cv.toLocal(p);
    }
  };
  const doThrow = (p: PointerInfo): void => {
    if (phase !== 'aim' || hostPaused || p.id !== dragId || !dragStart) {
      if (p.id === dragId) {
        dragId = null;
        dragStart = null; // ポーズ中に離した等でも照準ガイドを残さない
      }
      return;
    }
    const end = cv.toLocal(p);
    const dx = end.x - dragStart.x;
    const dy = end.y - dragStart.y; // 上スワイプ＝負
    dragId = null;
    dragStart = null;
    if (dy > -24) return; // 上向きに じゅうぶん スワイプしていない
    const len = Math.hypot(dx, dy);
    ball.vx = clamp(dx * 2.6, -240, 240);
    ball.vy = -clamp(len * 1.9, 320, 860); // 弱い投げは 本当に弱い＝ピンが少ない（強さのスキル）
    ball.active = true;
    standingBefore = standing();
    phase = 'rolling';
    rollStartAt = ctx.now();
    ctx.sfx('tap');
  };
  const offDown = ctx.input.onDown(setStart);
  const offUp = ctx.input.onUp(doThrow);

  // ---- 物理 ----
  function physicsStep(h: number): void {
    // ボール
    if (ball.active) {
      ball.vx -= ball.vx * FRICTION * h;
      ball.vy -= ball.vy * FRICTION * h;
      ball.x += ball.vx * h;
      ball.y += ball.vy * h;
      // ガター（左右のはし）
      if (ball.x < GUTTER_L + BALL_R) { ball.x = GUTTER_L + BALL_R; ball.vx = Math.abs(ball.vx) * 0.2; }
      if (ball.x > GUTTER_R - BALL_R) { ball.x = GUTTER_R - BALL_R; ball.vx = -Math.abs(ball.vx) * 0.2; }
      // ボール vs ピン: ボールは重いので ほとんど減速せず つらぬく（奥のピンまで届く）。
      // 速く芯に当てるほど ピンが激しく散る＝「衝撃半径」で 近くのピンも はじき飛ばす。
      // ボールがピンを たおす強さ。芯に強く当てたときだけ大きく散るよう控えめに調整（ストライクは
      // 「よい狙い＋じゅうぶんな強さ」の両方が要る＝出やすすぎない。弱い/ズレた球は1本残りやすい）。
      const bs = Math.hypot(ball.vx, ball.vy);
      const shock = clamp((bs - 540) / 45, 0, 6); // 速いほど広く散る（芯に強く当てれば たおれやすい）
      for (const p of pins) {
        if (p.down) continue; // たおれたピンには もう当てない（減速しすぎ防止）
        const dx = p.x - ball.x;
        const dy = p.y - ball.y;
        const d = Math.hypot(dx, dy);
        const min = BALL_R + PIN_R;
        const reach = min + shock;
        if (d < reach && d > 1e-6) {
          const nx = dx / d;
          const ny = dy / d;
          if (d < min) {
            p.x = ball.x + nx * min; // 直接接触は 完全に押し出す
            p.y = ball.y + ny * min;
          }
          p.vx = ball.vx * 0.5 + nx * bs * 0.34;
          p.vy = ball.vy * 0.5 + ny * bs * 0.34;
          if (d < min) { ball.vx *= 0.85; ball.vy *= 0.85; } // 直接当たりで減速（弱い球は奥まで届かない＝強さも大事）
          ctx.sfx('tick');
        }
      }
    }
    // ピン同士＋摩擦＋壁（ピンは よく すべって 他のピンを たおす）
    for (const p of pins) {
      p.vx -= p.vx * FRICTION * 0.45 * h;
      p.vy -= p.vy * FRICTION * 0.45 * h;
      p.x += p.vx * h;
      p.y += p.vy * h;
      if (p.x < GUTTER_L) { p.x = GUTTER_L; p.vx *= -0.3; }
      if (p.x > GUTTER_R) { p.x = GUTTER_R; p.vx *= -0.3; }
    }
    for (let i = 0; i < pins.length; i++) {
      for (let j = i + 1; j < pins.length; j++) {
        resolveCircles(pins[i]!, PIN_R, pins[j]!, PIN_R, 1.9);
      }
    }
    // たおれ判定（定位置から離れたら down）
    for (const p of pins) {
      if (!p.down && Math.hypot(p.x - p.home.x, p.y - p.home.y) > KNOCK_DIST) p.down = true;
    }
    // 連鎖: たおれて動いているピンが 立っているピンの近くを通ると そのピンも たおれる
    // （ぎっしり並んだピンの なだれ。芯に当たれば 全部たおれ、離れた1本は スプリットとして残る）
    let changed = true;
    let guard = 0;
    while (changed && guard++ < 12) {
      changed = false;
      for (const p of pins) {
        if (!p.down || Math.hypot(p.vx, p.vy) < 120) continue; // 勢いよく飛んだ たおれピンだけが なぎ倒す
        for (const q of pins) {
          if (q.down) continue;
          if (Math.hypot(p.x - q.x, p.y - q.y) < CASCADE_DIST) {
            q.down = true;
            q.vx = p.vx * 0.6;
            q.vy = p.vy * 0.6;
            changed = true;
          }
        }
      }
    }
  }

  function settled(now: number): boolean {
    if (ball.y < -BALL_R) return true; // ボールが 奥へ抜けた
    if (now - rollStartAt > MAX_ROLL_MS) return true;
    const ballSlow = Math.hypot(ball.vx, ball.vy) < SETTLE_SPEED || ball.y < 60;
    const pinsSlow = pins.every((p) => Math.hypot(p.vx, p.vy) < SETTLE_SPEED);
    return ballSlow && pinsSlow && (now - rollStartAt > 500);
  }

  // ---- 投球確定後のフレーム進行 ----
  function afterThrow(): void {
    const knocked = standingBefore - standing();
    rolls.push(knocked);
    // 実績（ストライク＝満ぱいのラックを1投で全部・スペア＝残りぜんぶ。
    // throwInFrame でなく standingBefore で判定＝10フレーム目のボーナス投球も正しく数える）
    if (standingBefore === 10 && knocked === 10) {
      strikeCount++;
      strikeStreak++;
      ctx.achieve('first-strike');
      if (strikeCount >= 2) ctx.achieve('strike-2');
      if (strikeStreak >= 3) ctx.achieve('turkey');
      showMsg('ストライク！🎳');
    } else {
      if (standingBefore < 10 && knocked === standingBefore) {
        ctx.achieve('spare');
        showMsg('スペア！');
      }
      strikeStreak = 0;
    }
    if (score() >= 80) ctx.achieve('score-80');
    if (score() >= 150) ctx.achieve('score-hi');

    const isTenth = frame === FRAMES - 1;
    if (!isTenth) {
      if (throwInFrame === 0 && knocked === 10) {
        nextFrame();
      } else if (throwInFrame === 0) {
        throwInFrame = 1;
        keepStanding();
        resetBall();
        phase = 'aim';
      } else {
        nextFrame();
      }
      return;
    }
    // 10フレーム目（最大3投）
    const r1 = rolls[frameFirstRollIdx] ?? 0;
    const r2 = rolls[frameFirstRollIdx + 1] ?? 0;
    if (throwInFrame === 0) {
      throwInFrame = 1;
      if (knocked === 10) rackFull(); // ストライク→新しいピン
      else keepStanding();
      resetBall();
      phase = 'aim';
    } else if (throwInFrame === 1) {
      const strikeFirst = r1 === 10;
      const spare = r1 < 10 && r1 + r2 === 10;
      if (strikeFirst || spare) {
        throwInFrame = 2;
        if (strikeFirst) { if (knocked === 10) rackFull(); else keepStanding(); }
        else rackFull(); // スペア→新しいピン
        resetBall();
        phase = 'aim';
      } else {
        gameOver();
      }
    } else {
      gameOver();
    }
  }

  function nextFrame(): void {
    frame++;
    if (frame >= FRAMES) { gameOver(); return; }
    startFrame();
  }
  function gameOver(): void {
    phase = 'over';
    endAt = ctx.now() + END_DELAY;
  }

  // ---- 毎フレーム ----
  const offFrame = ctx.onFrame((dt) => {
    if (hostPaused) return;
    const now = ctx.now();
    if (phase === 'rolling') {
      const N = 4;
      for (let k = 0; k < N; k++) physicsStep(dt / N);
      if (settled(now)) {
        ball.active = false;
        afterThrow();
      }
    } else if (phase === 'over' && !ended && now >= endAt) {
      ended = true;
      ctx.end({ score: score() });
      return;
    }
    draw(now);
    setData();
  });

  // ---- 描画 ----
  function draw(now: number): void {
    // レーン
    g.fillStyle = '#d9a441';
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#12100c';
    g.fillRect(0, 0, GUTTER_L, H);
    g.fillRect(GUTTER_R, 0, W - GUTTER_R, H);
    g.strokeStyle = 'rgba(120,80,20,.4)';
    g.lineWidth = 1;
    for (let x = GUTTER_L + 40; x < GUTTER_R; x += 48) {
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke();
    }

    // ピン
    for (const p of pins) {
      if (p.down) {
        g.fillStyle = 'rgba(140,140,150,.5)';
        g.beginPath(); g.arc(p.x, p.y, PIN_R, 0, Math.PI * 2); g.fill();
      } else {
        g.fillStyle = '#fff';
        g.beginPath(); g.arc(p.x, p.y, PIN_R, 0, Math.PI * 2); g.fill();
        g.strokeStyle = '#e0483c'; g.lineWidth = 2;
        g.beginPath(); g.arc(p.x, p.y - 2, PIN_R - 3, Math.PI, 0); g.stroke();
      }
    }

    // ボール
    g.fillStyle = '#2a2a44';
    g.beginPath(); g.arc(ball.x, ball.y, BALL_R, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(255,255,255,.25)';
    g.beginPath(); g.arc(ball.x - 4, ball.y - 4, 4, 0, Math.PI * 2); g.fill();

    // ねらいガイド（aim中）
    if (phase === 'aim' && dragStart) {
      g.strokeStyle = 'rgba(255,255,255,.6)';
      g.setLineDash([6, 6]); g.lineWidth = 2;
      g.beginPath(); g.moveTo(ball.x, ball.y); g.lineTo(ball.x, ball.y - 120); g.stroke();
      g.setLineDash([]);
    }

    // HUD
    g.fillStyle = 'rgba(10,10,20,.6)';
    g.fillRect(0, 0, W, 40);
    g.fillStyle = '#fff';
    g.textAlign = 'left'; g.textBaseline = 'middle';
    g.font = 'bold 20px sans-serif';
    g.fillText(`${score()}てん`, GUTTER_L + 6, 20);
    g.textAlign = 'right';
    g.font = 'bold 17px sans-serif';
    g.fillText(`${Math.min(frame + 1, FRAMES)}/${FRAMES}フレーム`, GUTTER_R - 6, 20);

    // メッセージ / 指示
    g.textAlign = 'center'; g.textBaseline = 'middle';
    if (now < msgUntil) {
      g.fillStyle = '#fff8d0';
      g.font = 'bold 30px sans-serif';
      g.fillText(msg, W / 2, 320);
    } else if (phase === 'aim') {
      g.fillStyle = 'rgba(20,10,0,.75)';
      g.font = 'bold 17px sans-serif';
      g.fillText('下から上へ スワイプで 投球！', W / 2, 500);
      g.font = 'bold 13px sans-serif';
      g.fillText('（横のふり幅で ねらう）', W / 2, 522);
    }

    if (phase === 'over') {
      g.fillStyle = 'rgba(10,10,20,.76)';
      g.fillRect(0, 0, W, H);
      g.fillStyle = '#fff';
      g.font = 'bold 32px sans-serif';
      g.fillText('ゲーム しゅうりょう！', W / 2, H / 2 - 30);
      g.font = 'bold 28px sans-serif';
      g.fillText(`${score()}てん`, W / 2, H / 2 + 16);
    }
  }

  startFrame();
  draw(0);
  setData();

  return {
    start() {
      /* immediate */
    },
    pause() {
      hostPaused = true;
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
