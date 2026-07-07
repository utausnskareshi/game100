// 検証用①: タップテスト（縦画面・Canvas・ポイント制）
// 検証対象: canvas2d(design)・onTap/toLocal・sfx/haptic・実績・メダル・タイムバー
import type { GameContext, IGame } from '../../game-api/types';

const DURATION = 30_000;
const MAX_MISS = 3;

interface Bubble {
  x: number;
  y: number;
  r: number;
  born: number;
  life: number;
  hue: number;
}

export function createGame(ctx: GameContext): IGame {
  const cv = ctx.canvas2d({ design: { w: 360, h: 640 } });
  const bubbles: Bubble[] = [];
  let score = 0;
  let miss = 0;
  let nextSpawn = 400;
  let over = false;

  const offTap = ctx.input.onTap((p) => {
    if (over) return;
    const l = cv.toLocal(p);
    for (let i = bubbles.length - 1; i >= 0; i--) {
      const b = bubbles[i];
      if (!b) continue;
      const age = (ctx.now() - b.born) / b.life;
      const r = b.r * (1 - age * 0.7);
      if (Math.hypot(l.x - b.x, l.y - b.y) <= r + 12) {
        bubbles.splice(i, 1);
        score++;
        ctx.haptic('light');
        ctx.sfx(score % 10 === 0 ? 'combo' : 'tap');
        if (score === 1) ctx.achieve('first-pop');
        if (score >= 25) ctx.achieve('pop-25');
        return;
      }
    }
  });

  const offFrame = ctx.onFrame(() => {
    if (over) return;
    const t = ctx.now();

    if (t >= nextSpawn) {
      nextSpawn = t + Math.max(340, 820 - t * 0.015);
      const r = 26 + ctx.random() * 18;
      bubbles.push({
        x: r + 8 + ctx.random() * (cv.width - (r + 8) * 2),
        y: 100 + r + ctx.random() * (cv.height - 140 - (r + 8) * 2),
        r,
        born: t,
        life: Math.max(1000, 1800 - t * 0.02),
        hue: Math.floor(ctx.random() * 360),
      });
    }

    for (let i = bubbles.length - 1; i >= 0; i--) {
      const b = bubbles[i];
      if (b && t - b.born > b.life) {
        bubbles.splice(i, 1);
        miss++;
        ctx.sfx('fail');
        ctx.haptic('error');
      }
    }

    if (t >= DURATION || miss >= MAX_MISS) {
      over = true;
      ctx.end({ score });
      return;
    }
    draw(t);
  });

  function draw(t: number): void {
    cv.clear('#101330');
    const g = cv.ctx;

    // 残り時間バー
    g.fillStyle = '#262a52';
    g.fillRect(0, 0, cv.width, 6);
    g.fillStyle = '#22d3ee';
    g.fillRect(0, 0, cv.width * Math.max(0, 1 - t / DURATION), 6);

    for (const b of bubbles) {
      const age = (t - b.born) / b.life;
      const r = b.r * (1 - age * 0.7);
      g.beginPath();
      g.arc(b.x, b.y, r, 0, Math.PI * 2);
      g.fillStyle = `hsla(${b.hue}, 75%, 62%, ${1 - age * 0.35})`;
      g.fill();
      g.beginPath();
      g.arc(b.x - r * 0.3, b.y - r * 0.3, r * 0.22, 0, Math.PI * 2);
      g.fillStyle = 'rgba(255,255,255,0.55)';
      g.fill();
    }

    g.fillStyle = '#fff';
    g.font = 'bold 34px sans-serif';
    g.textAlign = 'center';
    g.fillText(String(score), cv.width / 2, 60);
    g.font = '18px sans-serif';
    g.textAlign = 'left';
    g.fillText('♥'.repeat(MAX_MISS - miss) + '・'.repeat(miss), 14, 34);
  }

  return {
    start() {},
    pause() {},
    resume() {},
    resize() {},
    destroy() {
      offTap();
      offFrame();
    },
  };
}
