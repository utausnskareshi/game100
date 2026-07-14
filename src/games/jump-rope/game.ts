// =============================================================
// ぴょんぴょんなわとび（No.49）: 回ってくるなわに合わせてタップでジャンプ！
// =============================================================
// - なわが足もとを通るしゅんかんに 地面にいると つまずき（3回でおしまい）。
//   とぶたびに 回転が少しずつ はやくなる。れんぞくで コンボボーナス。
// - 回転・得点は logic.ts（乱数不使用＝毎回同じランプ）。
// - Canvas 360×640。タップのみ（onDown）。シェルの3-2-1で開始。
// - import してよいのは game-api（types / helpers）と、このフォルダ内（logic）だけ
import type { GameContext, IGame } from '../../game-api/types';
import { JUMP_MS, MISSES_MAX, STUN_MS, jumpPoints, periodAt } from './logic';

const W = 360;
const H = 640;
const GROUND_Y = 470;
const ROPE_R = 120; // なわの見た目の半径
const END_DELAY = 1900;
const SCORE_HI = 700;

type Mode = 'ready' | 'play' | 'over';

export function createGame(ctx: GameContext): IGame {
  const cv = ctx.canvas2d({ design: { w: W, h: H } });
  const g = cv.ctx;

  // ---- 状態 ----
  let mode: Mode = 'ready';
  let hostPaused = false;
  let phase = 0.5; // 0=足もと通過。0.5=てっぺんから開始
  let jumps = 0;
  let combo = 0;
  let misses = 0;
  let score = 0;
  let jumpStart = -1; // ctx.now（-1=接地）
  let stunUntil = 0;
  let tripFlashUntil = 0;
  let endAt = 0;
  let ended = false;

  function airborne(now: number): boolean {
    return jumpStart >= 0 && now < jumpStart + JUMP_MS;
  }

  function setData(now: number): void {
    const r = ctx.root as HTMLElement;
    r.dataset.mode = mode;
    r.dataset.jumps = String(jumps);
    r.dataset.score = String(score);
    if (!import.meta.env.DEV) return;
    r.dataset.combo = String(combo);
    r.dataset.misses = String(misses);
    r.dataset.phase = phase.toFixed(4);
    r.dataset.air = airborne(now) ? '1' : '0';
    r.dataset.stunned = now < stunUntil ? '1' : '0';
  }

  // ---- 入力（タップ＝ジャンプ）----
  const offDown = ctx.input.onDown(() => {
    if (mode !== 'play' || hostPaused) return;
    const now = ctx.now();
    if (airborne(now) || now < stunUntil) return;
    jumpStart = now;
    ctx.sfx('tap');
  });

  // ---- 進行 ----
  function updatePlay(dt: number, now: number): void {
    if (jumpStart >= 0 && now >= jumpStart + JUMP_MS) jumpStart = -1; // 着地
    if (now < stunUntil) return; // つまずき後は なわが止まる
    phase += (dt * 1000) / periodAt(jumps);
    if (phase >= 1) {
      phase -= 1;
      // 足もと通過のしゅんかん
      if (airborne(now)) {
        jumps++;
        combo++;
        score += jumpPoints(combo);
        ctx.sfx(combo % 10 === 0 ? 'combo' : 'success');
        ctx.haptic('light');
        // 実績（加算箇所で即解除）
        if (jumps >= 10) ctx.achieve('first-10');
        if (jumps >= 30) ctx.achieve('jump-30');
        if (jumps >= 60) ctx.achieve('jump-60');
        if (combo >= 25) ctx.achieve('combo-25');
        if (misses === 0 && jumps >= 30) ctx.achieve('no-trip-30');
        if (score >= SCORE_HI) ctx.achieve('score-hi');
      } else {
        misses++;
        combo = 0;
        tripFlashUntil = now + 800;
        ctx.sfx('fail');
        ctx.haptic('error');
        if (misses >= MISSES_MAX) {
          mode = 'over';
          endAt = now + END_DELAY;
          return;
        }
        stunUntil = now + STUN_MS;
        phase = 0.5; // てっぺんから再開
      }
    }
  }

  // ---- 毎フレーム ----
  const offFrame = ctx.onFrame((dt) => {
    const now = ctx.now();
    if (!hostPaused) {
      if (mode === 'play') updatePlay(dt, now);
      if (mode === 'over' && !ended && now >= endAt) {
        ended = true;
        ctx.end({ score });
        return;
      }
    }
    draw(now);
    setData(now);
  });

  // ---- 描画（こうえんの固定パレット＝両テーマ共通）----
  function draw(now: number): void {
    // そら・じめん
    const sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#a8dcf5');
    sky.addColorStop(1, '#e6f6e8');
    g.fillStyle = sky;
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#9fd08a';
    g.fillRect(0, GROUND_Y + 26, W, H - GROUND_Y - 26);

    const cx = W / 2;
    const theta = phase * Math.PI * 2; // 0=足もと
    const behind = Math.cos(theta) < 0; // うしろ半分
    const jt = jumpStart >= 0 ? Math.min(1, (now - jumpStart) / JUMP_MS) : 1;
    const jumpY = jumpStart >= 0 ? -Math.sin(jt * Math.PI) * 74 : 0;

    // なわ（うしろ側なら先に＝キャラの後ろに描く）
    const ropeBottomY = GROUND_Y + 8 - Math.cos(theta) * ROPE_R;
    const drawRope = (): void => {
      g.strokeStyle = behind ? 'rgba(200,120,60,.45)' : '#c8783c';
      g.lineWidth = 5;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(cx - 96, GROUND_Y - 74);
      g.quadraticCurveTo(cx, ropeBottomY, cx + 96, GROUND_Y - 74);
      g.stroke();
    };
    if (behind) drawRope();

    // かげ
    g.fillStyle = 'rgba(60,80,50,.25)';
    g.beginPath();
    g.ellipse(cx, GROUND_Y + 20, 40 + jumpY * 0.12, 10, 0, 0, Math.PI * 2);
    g.fill();

    // キャラ（絵文字）
    g.font = '64px sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'bottom';
    g.fillText(now < tripFlashUntil ? '💫' : '🧒', cx, GROUND_Y + 18 + jumpY);
    g.textBaseline = 'middle';

    // なわ（まえ側）
    if (!behind) drawRope();

    // HUD
    g.fillStyle = '#2c3d57';
    g.textAlign = 'left';
    g.font = 'bold 26px sans-serif';
    g.fillText(`${jumps}かい`, 14, 36);
    g.font = 'bold 14px sans-serif';
    let hearts = '';
    for (let i = 0; i < MISSES_MAX; i++) hearts += i < MISSES_MAX - misses ? '❤️' : '🤍';
    g.fillText(hearts, 14, 62);
    g.fillText(`${score}てん`, 110, 62);
    if (combo >= 3) {
      g.fillStyle = '#e8641e';
      g.fillText(`🔥×${combo}`, 190, 62);
    }

    // メッセージ
    g.textAlign = 'center';
    if (mode === 'play' && now < stunUntil) {
      g.fillStyle = '#e0524a';
      g.font = 'bold 20px sans-serif';
      g.fillText('おっとっと… もういちど！', cx, 560);
    } else if (mode === 'play' && jumps === 0) {
      g.fillStyle = '#3a5a76';
      g.font = 'bold 15px sans-serif';
      g.fillText('なわが 足もとに来る しゅんかんに タップ！', cx, 560);
    }

    if (mode === 'over') {
      g.fillStyle = 'rgba(20,40,60,.62)';
      g.fillRect(0, 0, W, H);
      g.fillStyle = '#fff';
      g.font = 'bold 34px sans-serif';
      g.fillText('ひっかかった〜！', cx, H / 2 - 40);
      g.font = 'bold 24px sans-serif';
      g.fillText(`${jumps}かい とんだ / ${score}てん`, cx, H / 2 + 8);
    }
  }

  // ---- 起動（シェルの 3-2-1 のあと start()）----
  draw(0);
  setData(0);

  return {
    start() {
      mode = 'play';
      phase = 0.5;
      setData(ctx.now());
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
      offFrame();
    },
  };
}
