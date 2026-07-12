// =============================================================
// かたむきまとあて（No.29）: かたむきでボールを転がし、光るまとの中でキープ！
// =============================================================
// - 端末をかたむける＝ボールが転がる。センサーがなくても指ドラッグで完全に遊べる
//   （optionalSensors:['motion']・createDragTilt でセンサー＋ドラッグを合成）
// - まとの円の中に KEEP_MS いつづけると1枚ゲット（+100・はやどりで+30）→ 次のまとが出る。
//   とるたびに まとが少しちぢむ。60びょうで何枚とれるか！
// - まとの位置は logic.ts（rng注入）＝日替わりは全員同じ列。物理は固定小ステップ。
// - 時間は ctx.now・startMode 省略＝シェルの3-2-1のあと start()。
// - import してよいのは game-api（types / helpers）と、このフォルダ内（logic）だけ
import type { GameContext, IGame } from '../../game-api/types';
import { createDragTilt, type DragTilt } from '../../game-api/helpers';
import {
  W,
  H,
  BALL_R,
  KEEP_MS,
  QUICK_MS,
  CAPTURE_POINTS,
  QUICK_BONUS,
  spawnTarget,
  type Target,
} from './logic';

const DURATION = 60_000;
const END_DELAY = 1500;
const ACCEL = 1700; // tilt 1.0 のときの加速度(px/s^2)
const DAMP = 1.35; // 速度の減衰(1/s)
const BOUNCE = -0.55; // 壁での反発
const SUB = 1 / 120; // 物理サブステップ(s)
const SCORE_HI = 1100; // 「まとあてチャンピオン」実績のしきい値（仮）

export function createGame(ctx: GameContext): IGame {
  const cv = ctx.canvas2d({ design: { w: W, h: H } });
  const g = cv.ctx;

  // ---- 状態 ----
  let playing = false;
  let over = false;
  let ended = false;
  let playStart = 0;
  let endAt = 0;
  let score = 0;
  let captures = 0;
  let quicks = 0;
  let ball = { x: W / 2, y: H * 0.72 };
  let vel = { x: 0, y: 0 };
  let target: Target = { x: W / 2, y: H / 2, r: 54 };
  let targetBorn = 0; // まとが出た時刻（はやどり判定）
  let keptMs = 0; // まとの中にいる連続時間
  let acc = 0; // 物理サブステップの繰り越し

  const tiltIn: DragTilt = createDragTilt(ctx, {
    toLocal: (p) => cv.toLocal(p),
    div: 60,
    enabled: () => playing && !over,
  });

  function devState(): void {
    if (!import.meta.env.DEV) return;
    const ds = ctx.root.dataset;
    ds.score = String(score);
    ds.caps = String(captures);
    ds.bx = String(Math.round(ball.x));
    ds.by = String(Math.round(ball.y));
    ds.tx = String(Math.round(target.x));
    ds.ty = String(Math.round(target.y));
    ds.tr = String(Math.round(target.r));
    ds.keep = String(Math.round(keptMs));
    ds.over = over ? '1' : '0';
  }

  function reset(): void {
    playing = true;
    over = false;
    ended = false;
    score = 0;
    captures = 0;
    quicks = 0;
    ball = { x: W / 2, y: H * 0.72 };
    vel = { x: 0, y: 0 };
    playStart = ctx.now();
    target = spawnTarget(ctx.random, ball, 0);
    targetBorn = playStart;
    keptMs = 0;
    acc = 0;
    tiltIn.reset();
    ctx.motion?.calibrate();
  }

  function capture(now: number): void {
    const quick = now - targetBorn <= QUICK_MS;
    const gain = CAPTURE_POINTS + (quick ? QUICK_BONUS : 0);
    score += gain;
    captures++;
    if (quick) {
      quicks++;
      if (quicks === 3) ctx.achieve('quick-3');
    }
    ctx.achieve('first-target');
    if (captures === 5) {
      ctx.achieve('target-5');
      if (!tiltIn.usedDrag) ctx.achieve('tilt-only'); // かたむきだけで5枚
    }
    if (captures === 10) ctx.achieve('target-10');
    if (score >= SCORE_HI) ctx.achieve('score-hi');
    ctx.sfx(quick ? 'powerup' : 'success');
    ctx.haptic('success');
    target = spawnTarget(ctx.random, ball, captures);
    targetBorn = now;
    keptMs = 0;
  }

  function gameOver(now: number): void {
    over = true;
    playing = false;
    endAt = now + END_DELAY;
    ctx.sfx('medal');
  }

  // ---- 毎フレーム ----
  const offFrame = ctx.onFrame((dt) => {
    const now = ctx.now();
    if (playing && !over) {
      if (now - playStart >= DURATION) {
        gameOver(now);
      } else {
        // 物理（固定サブステップ）
        const t = tiltIn.value();
        acc += Math.min(dt, 0.05);
        while (acc >= SUB) {
          acc -= SUB;
          vel.x += t.x * ACCEL * SUB;
          vel.y += t.y * ACCEL * SUB;
          const damp = Math.max(0, 1 - DAMP * SUB);
          vel.x *= damp;
          vel.y *= damp;
          ball.x += vel.x * SUB;
          ball.y += vel.y * SUB;
          if (ball.x < BALL_R) {
            ball.x = BALL_R;
            vel.x *= BOUNCE;
          } else if (ball.x > W - BALL_R) {
            ball.x = W - BALL_R;
            vel.x *= BOUNCE;
          }
          if (ball.y < BALL_R) {
            ball.y = BALL_R;
            vel.y *= BOUNCE;
          } else if (ball.y > H - BALL_R) {
            ball.y = H - BALL_R;
            vel.y *= BOUNCE;
          }
        }
        // まとの中キープ判定（ボール中心が円内）
        const dx = ball.x - target.x;
        const dy = ball.y - target.y;
        if (dx * dx + dy * dy <= target.r * target.r) {
          keptMs += dt * 1000;
          if (keptMs >= KEEP_MS) capture(now);
        } else if (keptMs > 0) {
          keptMs = 0; // はなれたらやり直し
        }
      }
    }
    if (over && !ended && now >= endAt) {
      ended = true;
      ctx.end({ score });
    }
    draw(now);
    devState();
  });

  // ---- 描画（固定色＝テーマ非依存の1シーン）----
  function draw(now: number): void {
    const bg = g.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#151a3a');
    bg.addColorStop(1, '#232b5e');
    g.fillStyle = bg;
    g.fillRect(0, 0, W, H);
    // うっすら格子（かたむきの手がかり）
    g.strokeStyle = 'rgba(255,255,255,.05)';
    g.lineWidth = 1;
    for (let x = 40; x < W; x += 40) {
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, H);
      g.stroke();
    }
    for (let y = 40; y < H; y += 40) {
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(W, y);
      g.stroke();
    }

    if (playing || over) {
      // まと（リング＋キープ進捗の弧）
      const pulse = 1 + 0.03 * Math.sin(now / 180);
      g.strokeStyle = 'rgba(255,210,63,.9)';
      g.lineWidth = 5;
      g.beginPath();
      g.arc(target.x, target.y, target.r * pulse, 0, Math.PI * 2);
      g.stroke();
      g.fillStyle = 'rgba(255,210,63,.12)';
      g.beginPath();
      g.arc(target.x, target.y, target.r, 0, Math.PI * 2);
      g.fill();
      if (keptMs > 0) {
        g.strokeStyle = '#7ef29a';
        g.lineWidth = 7;
        g.beginPath();
        g.arc(target.x, target.y, target.r + 9, -Math.PI / 2, -Math.PI / 2 + (keptMs / KEEP_MS) * Math.PI * 2);
        g.stroke();
      }
      // ボール
      g.fillStyle = '#ffffff';
      g.beginPath();
      g.arc(ball.x, ball.y, BALL_R, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = 'rgba(0,0,0,.18)';
      g.beginPath();
      g.arc(ball.x + 4, ball.y + 5, BALL_R * 0.55, 0, Math.PI * 2);
      g.fill();
    }

    // HUD（左上。右上60×60のポーズ領域は避ける）
    g.textAlign = 'left';
    g.textBaseline = 'alphabetic';
    g.fillStyle = '#fff';
    g.font = 'bold 18px sans-serif';
    const left = playing ? Math.max(0, Math.ceil((DURATION - (ctx.now() - playStart)) / 1000)) : 0;
    g.fillText(`⏱ ${left}`, 12, 30);
    g.fillText(`スコア ${score}`, 12, 56);
    g.fillText(`まと ${captures}まい`, 12, 82);

    if (over) {
      g.fillStyle = 'rgba(10,14,38,.75)';
      g.fillRect(0, 0, W, H);
      g.textAlign = 'center';
      g.fillStyle = '#fff';
      g.font = 'bold 36px sans-serif';
      g.fillText('おしまい！', W / 2, H / 2 - 30);
      g.font = 'bold 24px sans-serif';
      g.fillStyle = '#ffe27a';
      g.fillText(`${captures}まい・${score}点`, W / 2, H / 2 + 16);
    }
  }

  return {
    start() {
      reset();
    },
    pause() {
      // onFrame と ctx.now はシェルが止める（期限方式なので特別な処理は不要）
    },
    resume() {
      tiltIn.reset();
      ctx.motion?.calibrate(); // 再開時の持ち方を水平に取り直す
    },
    resize() {
      // design 指定の Canvas は自動レターボックス
    },
    destroy() {
      offFrame();
      tiltIn.destroy();
    },
  };
}
