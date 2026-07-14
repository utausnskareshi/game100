// =============================================================
// ぱたぱたフライト（No.41）: タップではばたき、岩柱のすきまをくぐり続けるワンボタン飛行！
// =============================================================
// - タップ＝上向きにはばたく。なにもしないと落ちる。岩・地面・天井にふれたら即おしまい。
// - すきまは進むほど せまく、後半は上下にうごく。⭐はコースから外れた位置＝リスクと引きかえ。
// - 物理・コース生成は logic.ts（rng注入・消費回数固定＝日替わり同一コース）。
// - Canvas 360×640。タップのみ（onDown）。シェルの3-2-1のあと「タップでスタート」。
// - import してよいのは game-api（types / helpers）と、このフォルダ内（logic）だけ
import type { GameContext, IGame } from '../../game-api/types';
import {
  BIRD_R,
  BIRD_X,
  FLAP_VY,
  GATE_PTS,
  GRAVITY,
  GROUND_Y,
  PILLAR_HW,
  STAR_PTS,
  STAR_R,
  TERMINAL_VY,
  gateCy,
  hitsGate,
  rollGate,
  rollStar,
  speedAt,
  type Gate,
  type Star,
} from './logic';

const W = 360;
const H = 640;
const DEAD_MS = 800;
const END_DELAY = 1900;
const SCORE_HI = 400;

type Mode = 'wait' | 'play' | 'dead' | 'over';

export function createGame(ctx: GameContext): IGame {
  const cv = ctx.canvas2d({ design: { w: W, h: H } });
  const g = cv.ctx;

  // ---- 状態 ----
  let mode: Mode = 'wait';
  let hostPaused = false;
  const gates: Gate[] = [];
  const stars: Star[] = [];
  const starTaken: boolean[] = [];
  let worldX = 0; // とりの world x（= BIRD_X + スクロール量）
  let birdY = 300;
  let vy = 0;
  let playStart = 0;
  let passed = 0; // くぐったゲート数
  let starCount = 0;
  let score = 0;
  let flapTilt = 0; // 見た目の羽ばたき演出
  let deadAt = 0;
  let endAt = 0;
  let ended = false;

  function ensureCourse(upTo: number): void {
    while (gates.length <= upTo) {
      const i = gates.length;
      gates.push(rollGate(ctx.random, i));
      stars.push(rollStar(ctx.random, i));
      starTaken.push(false);
    }
  }
  ensureCourse(8);

  function elapsed(now: number): number {
    return mode === 'wait' ? 0 : now - playStart;
  }

  function setData(now: number): void {
    const r = ctx.root as HTMLElement;
    r.dataset.mode = mode;
    r.dataset.score = String(score);
    r.dataset.gates = String(passed);
    if (!import.meta.env.DEV) return;
    r.dataset.stars = String(starCount);
    r.dataset.birdy = birdY.toFixed(1);
    r.dataset.vy = vy.toFixed(1);
    r.dataset.worldx = worldX.toFixed(1);
    r.dataset.elapsed = String(Math.round(elapsed(now)));
  }

  // ---- 入力（タップ＝はばたき）----
  const offDown = ctx.input.onDown(() => {
    if (hostPaused) return;
    if (mode === 'wait') {
      mode = 'play';
      playStart = ctx.now();
      vy = FLAP_VY;
      flapTilt = 1;
      ctx.sfx('start');
      return;
    }
    if (mode === 'play') {
      vy = FLAP_VY;
      flapTilt = 1;
      ctx.sfx('tap');
    }
  });

  // ---- 進行 ----
  function die(now: number): void {
    mode = 'dead';
    deadAt = now;
    ctx.sfx('fail');
    ctx.haptic('error');
    endAt = now + DEAD_MS + END_DELAY;
  }

  function updatePlay(dt: number, now: number): void {
    const t = elapsed(now);
    // 前進と落下
    worldX += speedAt(t) * dt;
    vy = Math.min(TERMINAL_VY, vy + GRAVITY * dt);
    birdY += vy * dt;
    flapTilt = Math.max(0, flapTilt - dt * 4);

    const bx = BIRD_X + worldX; // world 座標のとりx
    ensureCourse(Math.floor((bx - 460) / 250) + 8);

    // 地面・天井
    if (birdY > GROUND_Y - BIRD_R || birdY < BIRD_R) {
      birdY = Math.max(BIRD_R, Math.min(GROUND_Y - BIRD_R, birdY));
      die(now);
      return;
    }

    // 岩柱との当たり＋通過判定（近くの2〜3本だけ見る）
    for (let i = Math.max(0, passed - 1); i < gates.length; i++) {
      const gt = gates[i]!;
      if (gt.x - PILLAR_HW > bx + BIRD_R + 4) break;
      if (hitsGate(gt, t, bx, birdY)) {
        die(now);
        return;
      }
      if (i === passed && gt.x + PILLAR_HW < bx - BIRD_R) {
        // くぐった！（単調マイルストーンは加算箇所で即解除）
        passed++;
        score += GATE_PTS;
        ctx.sfx('success');
        if (passed >= 5) ctx.achieve('first-5');
        if (passed >= 15) ctx.achieve('gate-15');
        if (passed >= 30) ctx.achieve('gate-30');
        if (score >= SCORE_HI) ctx.achieve('score-hi');
        const total = (ctx.load<number>('total-gates') ?? 0) + 1;
        ctx.save('total-gates', total);
        if (total >= 100) ctx.achieve('total-100');
      }
    }

    // ⭐の取得
    for (let i = Math.max(0, passed - 1); i < stars.length; i++) {
      const st = stars[i]!;
      if (!st.exists || starTaken[i]) continue;
      if (st.x > bx + 60) break;
      if (Math.hypot(st.x - bx, st.y - birdY) < STAR_R + BIRD_R) {
        starTaken[i] = true;
        starCount++;
        score += STAR_PTS;
        ctx.sfx('combo');
        ctx.haptic('light');
        if (starCount >= 8) ctx.achieve('star-8');
        if (score >= SCORE_HI) ctx.achieve('score-hi');
      }
    }
  }

  // ---- 毎フレーム ----
  const offFrame = ctx.onFrame((dt) => {
    const now = ctx.now();
    if (!hostPaused) {
      if (mode === 'play') updatePlay(dt, now);
      if (mode === 'dead') {
        // 墜落演出（下へ落ちる）
        vy = Math.min(TERMINAL_VY, vy + GRAVITY * dt);
        birdY = Math.min(GROUND_Y - BIRD_R, birdY + vy * dt);
        if (now >= deadAt + DEAD_MS + 100) mode = 'over';
      }
      if ((mode === 'over' || mode === 'dead') && !ended && endAt > 0 && now >= endAt) {
        ended = true;
        ctx.end({ score });
        return;
      }
    }
    draw(now);
    setData(now);
  });

  // ---- 描画（固定パレット＝両テーマ共通）----
  function draw(now: number): void {
    const t = elapsed(now);
    // そら
    const sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#8fd0f5');
    sky.addColorStop(1, '#d9f2fb');
    g.fillStyle = sky;
    g.fillRect(0, 0, W, H);
    // くも（パララックス）
    g.fillStyle = 'rgba(255,255,255,.8)';
    for (const c of [
      { x: 100, y: 110, r: 20 },
      { x: 380, y: 190, r: 16 },
      { x: 660, y: 70, r: 24 },
    ]) {
      const cx = ((c.x - worldX * 0.25) % 760 + 760) % 760 - 60;
      g.beginPath();
      g.arc(cx, c.y, c.r, 0, Math.PI * 2);
      g.arc(cx + c.r, c.y + 5, c.r * 0.7, 0, Math.PI * 2);
      g.arc(cx - c.r, c.y + 5, c.r * 0.65, 0, Math.PI * 2);
      g.fill();
    }

    const camL = BIRD_X + worldX - BIRD_X; // world → screen: sx = wx - camL
    // 岩柱
    for (let i = Math.max(0, passed - 2); i < gates.length; i++) {
      const gt = gates[i]!;
      const sx = gt.x - camL;
      if (sx < -40) continue;
      if (sx > W + 40) break;
      const cy = gateCy(gt, t);
      const topH = cy - gt.gap / 2;
      const botY = cy + gt.gap / 2;
      g.fillStyle = '#7a8a6a';
      g.fillRect(sx - PILLAR_HW, 0, PILLAR_HW * 2, topH);
      g.fillRect(sx - PILLAR_HW, botY, PILLAR_HW * 2, GROUND_Y - botY);
      // ふち（キャップ）
      g.fillStyle = '#5f7052';
      g.fillRect(sx - PILLAR_HW - 4, topH - 14, PILLAR_HW * 2 + 8, 14);
      g.fillRect(sx - PILLAR_HW - 4, botY, PILLAR_HW * 2 + 8, 14);
      if (gt.moving) {
        g.fillStyle = '#eef6ff';
        g.font = 'bold 13px sans-serif';
        g.textAlign = 'center';
        g.fillText('↕', sx, cy);
      }
    }
    // ⭐
    g.font = '26px sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (let i = Math.max(0, passed - 1); i < stars.length; i++) {
      const st = stars[i]!;
      if (!st.exists || starTaken[i]) continue;
      const sx = st.x - camL;
      if (sx < -30) continue;
      if (sx > W + 30) break;
      g.fillText('⭐', sx, st.y);
    }

    // じめん
    g.fillStyle = '#8bc34a';
    g.fillRect(0, GROUND_Y, W, H - GROUND_Y);
    g.fillStyle = '#79a93f';
    const gShift = worldX % 40;
    for (let x = -gShift; x < W; x += 40) g.fillRect(x, GROUND_Y, 20, 8);

    // とり（ひよこ）
    const tilt = Math.max(-0.5, Math.min(0.9, vy / 700)) - flapTilt * 0.4;
    g.save();
    g.translate(BIRD_X, birdY);
    g.rotate(tilt);
    g.fillStyle = '#ffd23e';
    g.beginPath();
    g.arc(0, 0, BIRD_R, 0, Math.PI * 2);
    g.fill();
    // はね
    g.fillStyle = '#f5b81e';
    g.beginPath();
    g.ellipse(-4, flapTilt > 0.4 ? -6 : 3, 8, 5, -0.4, 0, Math.PI * 2);
    g.fill();
    // くちばし・め
    g.fillStyle = '#ef7d1a';
    g.beginPath();
    g.moveTo(BIRD_R - 2, -2);
    g.lineTo(BIRD_R + 8, 1);
    g.lineTo(BIRD_R - 2, 4);
    g.closePath();
    g.fill();
    g.fillStyle = '#222';
    g.beginPath();
    g.arc(5, -4, 2.2, 0, Math.PI * 2);
    g.fill();
    g.restore();

    // HUD（左上）
    g.fillStyle = '#2c3d57';
    g.textAlign = 'left';
    g.font = 'bold 24px sans-serif';
    g.fillText(`${score}てん`, 14, 34);
    g.font = 'bold 13px sans-serif';
    g.fillText(`ゲート ${passed}　⭐${starCount}`, 14, 58);

    // まちうけ
    if (mode === 'wait') {
      g.fillStyle = 'rgba(20,40,60,.55)';
      g.fillRect(0, 250, W, 120);
      g.fillStyle = '#fff';
      g.textAlign = 'center';
      g.font = 'bold 26px sans-serif';
      g.fillText('タップで スタート！', W / 2, 296);
      g.font = 'bold 15px sans-serif';
      g.fillText('タップするたび はばたくよ', W / 2, 330);
    }

    // 終了
    if (mode === 'over' || (mode === 'dead' && now >= deadAt + DEAD_MS)) {
      g.fillStyle = 'rgba(20,40,60,.62)';
      g.fillRect(0, 0, W, H);
      g.fillStyle = '#fff';
      g.textAlign = 'center';
      g.font = 'bold 34px sans-serif';
      g.fillText('ドテッ…', W / 2, H / 2 - 40);
      g.font = 'bold 24px sans-serif';
      g.fillText(`ゲート ${passed}こ / ${score}てん`, W / 2, H / 2 + 8);
    }
  }

  // ---- 起動（シェルの 3-2-1 のあと start()。まずは「タップでスタート」待ち）----
  draw(0);
  setData(0);

  return {
    start() {
      mode = 'wait';
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
