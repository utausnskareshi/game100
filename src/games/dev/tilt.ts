// 検証用②: かたむきテスト（横画面固定・センサー・タイムアタック）
// 検証対象: 横向き固定・motion(tilt/calibrate)・timeMsスコア・ドラッグ代替操作
import type { GameContext, IGame } from '../../game-api/types';
import { clamp, createDragTilt } from '../../game-api/helpers';

interface Wall {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function createGame(ctx: GameContext): IGame {
  const cv = ctx.canvas2d({ design: { w: 640, h: 360 } });
  const ball = { x: 56, y: 180, vx: 0, vy: 0, r: 14 };
  const goal = { x: 584, y: 180, r: 26 };
  const walls: Wall[] = [
    { x: 150, y: 0, w: 18, h: 250 },
    { x: 310, y: 110, w: 18, h: 250 },
    { x: 470, y: 0, w: 18, h: 250 },
  ];
  let done = false;

  const tiltIn = createDragTilt(ctx, { toLocal: (p) => cv.toLocal(p) });

  const offFrame = ctx.onFrame((dt) => {
    if (!done) step(dt);
    draw();
  });

  function step(dt: number): void {
    const t = tiltIn.value();
    const ACC = 950;
    ball.vx += t.x * ACC * dt;
    ball.vy += t.y * ACC * dt;
    const damp = Math.exp(-1.1 * dt);
    ball.vx *= damp;
    ball.vy *= damp;
    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;

    // 外周
    if (ball.x < ball.r) {
      ball.x = ball.r;
      ball.vx = Math.abs(ball.vx) * 0.4;
    }
    if (ball.x > cv.width - ball.r) {
      ball.x = cv.width - ball.r;
      ball.vx = -Math.abs(ball.vx) * 0.4;
    }
    if (ball.y < ball.r) {
      ball.y = ball.r;
      ball.vy = Math.abs(ball.vy) * 0.4;
    }
    if (ball.y > cv.height - ball.r) {
      ball.y = cv.height - ball.r;
      ball.vy = -Math.abs(ball.vy) * 0.4;
    }

    // 壁（円と矩形の押し出し）
    for (const w of walls) {
      const cx = clamp(ball.x, w.x, w.x + w.w);
      const cy = clamp(ball.y, w.y, w.y + w.h);
      const dx = ball.x - cx;
      const dy = ball.y - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 < ball.r * ball.r && d2 > 0.0001) {
        const d = Math.sqrt(d2);
        const push = ball.r - d;
        ball.x += (dx / d) * push;
        ball.y += (dy / d) * push;
        if (Math.abs(dx) > Math.abs(dy)) ball.vx = (dx > 0 ? Math.abs(ball.vx) : -Math.abs(ball.vx)) * 0.4;
        else ball.vy = (dy > 0 ? Math.abs(ball.vy) : -Math.abs(ball.vy)) * 0.4;
      }
    }

    // ゴール判定
    if (Math.hypot(ball.x - goal.x, ball.y - goal.y) < goal.r) {
      done = true;
      const ms = Math.round(ctx.now());
      ctx.achieve('goal');
      if (ms <= 6000) ctx.achieve('speed-6');
      ctx.haptic('success');
      ctx.end({ score: ms });
    }
  }

  function draw(): void {
    cv.clear('#0e2418');
    const g = cv.ctx;

    // ゴール
    g.beginPath();
    g.arc(goal.x, goal.y, goal.r, 0, Math.PI * 2);
    g.fillStyle = 'rgba(255, 201, 77, 0.25)';
    g.fill();
    g.font = '26px sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('🚩', goal.x, goal.y);
    g.textBaseline = 'alphabetic';

    // 壁
    g.fillStyle = '#3e5c46';
    for (const w of walls) g.fillRect(w.x, w.y, w.w, w.h);

    // ボール
    g.beginPath();
    g.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
    g.fillStyle = '#22d3ee';
    g.fill();
    g.beginPath();
    g.arc(ball.x - 4, ball.y - 4, 4, 0, Math.PI * 2);
    g.fillStyle = 'rgba(255,255,255,0.6)';
    g.fill();

    // HUD
    g.fillStyle = '#fff';
    g.font = 'bold 22px sans-serif';
    g.textAlign = 'center';
    g.fillText(`${(ctx.now() / 1000).toFixed(2)} 秒`, cv.width / 2, 34);
    const t = tiltIn.value();
    g.font = '12px sans-serif';
    g.textAlign = 'left';
    g.fillStyle = 'rgba(255,255,255,0.55)';
    g.fillText(`tilt x:${t.x.toFixed(2)} y:${t.y.toFixed(2)}${ctx.motion ? '' : ' (センサーなし)'}`, 12, cv.height - 12);
    g.textAlign = 'right';
    g.fillText('かたむき か ドラッグでうごかす', cv.width - 12, cv.height - 12);
  }

  return {
    start() {
      ctx.motion?.calibrate();
    },
    pause() {},
    resume() {},
    resize() {},
    destroy() {
      tiltIn.destroy();
      offFrame();
    },
  };
}
