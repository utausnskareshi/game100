// =============================================================
// ひっぱりショット（No.61）: 引っぱって はなして、反射でモンスターを たおせ！
// =============================================================
// - 画面をドラッグで引っぱり、はなすと ボールが反対方向へ発射。壁と岩で反射し、
//   モンスターは 貫通ヒット（1ショットにつき 1体1回）。まとめて当てるとコンボ！
// - ターン制の反撃: モンスターの数字は「あと何ショットで反撃するか」。0で ひっかかれて
//   ライフ−1（1ターンに最大1）。ライフ3で おしまい。ステージが進むほど 手ごわい。
// - ステージ生成・得点は logic.ts（純ロジック・rng注入）。物理は固定サブステップ＋
//   円vs矩形は helpers の pushOutCircleFromRect（実証済み）。ctx.now・setTimeout不使用。
// - import してよいのは game-api（types / helpers）と、このフォルダ内（logic）だけ
import type { GameContext, IGame, PointerInfo } from '../../game-api/types';
import { clamp, pushOutCircleFromRect } from '../../game-api/helpers';
import {
  ARENA,
  BALL_R,
  BALL_START,
  HIT_PTS,
  MON_R,
  type Monster,
  type Stage,
  W,
  H,
  comboBonus,
  makeStage,
  stageClearBonus,
} from './logic';

const PULL_SCALE = 6.5; // 引っぱり1pxあたりの初速
const MAX_SPEED = 950;
const MIN_PULL = 22; // これ未満は発射キャンセル
const DECEL = 300; // 減速(px/s^2)
const STOP_SPEED = 30;
const WALL_LOSS = 0.98;
const MAX_FLY_MS = 6500;
const TURN_MS = 720;
const CLEAR_MS = 1150;
const END_DELAY = 1700;
const LIVES0 = 3;
const SCORE_HI = 1500;

type Phase = 'aim' | 'fly' | 'turn' | 'clear' | 'over';

const KIND_EMOJI = { imp: '👾', oni: '👹', bat: '🦇' } as const;
const KIND_COLOR = { imp: '#8a5cf0', oni: '#e0483c', bat: '#4a6de0' } as const;

export function createGame(ctx: GameContext): IGame {
  const cv = ctx.canvas2d({ design: { w: W, h: H } });
  const g = cv.ctx;

  let phase: Phase = 'aim';
  let hostPaused = false;
  let stageNo = 1;
  let stage: Stage = makeStage(1, ctx.random);
  let ball = { x: BALL_START.x, y: BALL_START.y, vx: 0, vy: 0 };
  let lives = LIVES0;
  let score = 0;
  let flyStartAt = 0;
  let hitSet = new Set<Monster>();
  let lastCombo = 0;
  let stageDamaged = false; // このステージで ひっかかれたか（ノーダメ実績用）
  let attackers: Monster[] = [];
  let phaseUntil = 0;
  let endAt = 0;
  let ended = false;
  let msg = '';
  let msgUntil = 0;

  // ドラッグ（引っぱり）
  let dragId: number | null = null;
  let dragStart: { x: number; y: number } | null = null;
  let dragNow: { x: number; y: number } | null = null;

  function setData(): void {
    if (!import.meta.env.DEV) return;
    const r = ctx.root as HTMLElement;
    r.dataset.phase = phase;
    r.dataset.score = String(score);
    r.dataset.lives = String(lives);
    r.dataset.stage = String(stageNo);
    r.dataset.combo = String(lastCombo);
    r.dataset.ball = `${ball.x.toFixed(1)},${ball.y.toFixed(1)}`;
    r.dataset.moving = phase === 'fly' ? '1' : '0';
    r.dataset.monsters = stage.monsters.map((m) => `${m.x.toFixed(0)},${m.y.toFixed(0)},${m.hp},${m.cd},${m.kind[0]}`).join(';');
    r.dataset.obstacles = stage.obstacles.map((o) => `${o.x.toFixed(0)},${o.y.toFixed(0)},${o.w},${o.h}`).join(';');
  }

  function showMsg(t: string, ms = 1100): void {
    msg = t;
    msgUntil = ctx.now() + ms;
  }

  // ---- 入力（引っぱり）----
  const offDown = ctx.input.onDown((p: PointerInfo) => {
    if (phase !== 'aim' || hostPaused) return;
    if (dragId === null) {
      dragId = p.id;
      dragStart = cv.toLocal(p);
      dragNow = dragStart;
    }
  });
  const offMove = ctx.input.onMove((p: PointerInfo) => {
    if (p.id !== dragId || phase !== 'aim' || hostPaused) return;
    dragNow = cv.toLocal(p);
  });
  const offUp = ctx.input.onUp((p: PointerInfo) => {
    if (p.id !== dragId) return;
    const start = dragStart;
    const end = cv.toLocal(p);
    dragId = null;
    dragStart = null;
    dragNow = null;
    if (phase !== 'aim' || hostPaused || !start) return;
    const dx = start.x - end.x; // 引っぱりの反対へ飛ぶ
    const dy = start.y - end.y;
    const len = Math.hypot(dx, dy);
    if (len < MIN_PULL) return;
    const sp = clamp(len * PULL_SCALE, 120, MAX_SPEED);
    ball.vx = (dx / len) * sp;
    ball.vy = (dy / len) * sp;
    hitSet = new Set();
    lastCombo = 0;
    phase = 'fly';
    flyStartAt = ctx.now();
    ctx.sfx('tap');
    ctx.haptic('light');
  });

  // ---- 物理 ----
  function physicsStep(h: number): void {
    const sp = Math.hypot(ball.vx, ball.vy);
    if (sp > 0) {
      const ns = Math.max(0, sp - DECEL * h);
      ball.vx = (ball.vx / sp) * ns;
      ball.vy = (ball.vy / sp) * ns;
    }
    ball.x += ball.vx * h;
    ball.y += ball.vy * h;
    // 壁反射
    if (ball.x < ARENA.x + BALL_R) { ball.x = ARENA.x + BALL_R; ball.vx = Math.abs(ball.vx) * WALL_LOSS; }
    if (ball.x > ARENA.x + ARENA.w - BALL_R) { ball.x = ARENA.x + ARENA.w - BALL_R; ball.vx = -Math.abs(ball.vx) * WALL_LOSS; }
    if (ball.y < ARENA.y + BALL_R) { ball.y = ARENA.y + BALL_R; ball.vy = Math.abs(ball.vy) * WALL_LOSS; }
    if (ball.y > ARENA.y + ARENA.h - BALL_R) { ball.y = ARENA.y + ARENA.h - BALL_R; ball.vy = -Math.abs(ball.vy) * WALL_LOSS; }
    // 岩で反射
    for (const o of stage.obstacles) {
      const axis = pushOutCircleFromRect(ball, BALL_R, o);
      if (axis === 'x') ball.vx = -ball.vx * WALL_LOSS;
      else if (axis === 'y') ball.vy = -ball.vy * WALL_LOSS;
    }
    // モンスター貫通ヒット（1ショット1体1回）
    for (const m of stage.monsters) {
      if (m.hp <= 0 || hitSet.has(m)) continue;
      if (Math.hypot(m.x - ball.x, m.y - ball.y) < MON_R + BALL_R) {
        hitSet.add(m);
        m.hp--;
        score += HIT_PTS;
        ctx.sfx('tick');
        if (m.hp <= 0) {
          score += m.pts;
          ctx.achieve('first-kill');
          ctx.sfx('combo');
          ctx.haptic('medium');
        }
        if (score >= SCORE_HI) ctx.achieve('score-hi');
      }
    }
  }

  function endShot(now: number): void {
    ball.vx = 0;
    ball.vy = 0;
    lastCombo = hitSet.size;
    if (lastCombo >= 2) {
      score += comboBonus(lastCombo);
      showMsg(`${lastCombo}コンボ！ +${comboBonus(lastCombo)}`);
    }
    if (lastCombo >= 3) ctx.achieve('combo-3');
    if (score >= SCORE_HI) ctx.achieve('score-hi');
    stage.monsters = stage.monsters.filter((m) => m.hp > 0);
    if (stage.monsters.length === 0) {
      // ステージクリア（ごほうびにライフ1回復＝深く潜れるが緊張感は保つ）
      score += stageClearBonus(stageNo);
      if (!stageDamaged) ctx.achieve('no-damage');
      if (score >= SCORE_HI) ctx.achieve('score-hi');
      if (lives < LIVES0) {
        lives++;
        showMsg('クリア！ ライフ+1', CLEAR_MS);
      }
      phase = 'clear';
      phaseUntil = now + CLEAR_MS;
      ctx.sfx('medal');
      ctx.haptic('success');
      return;
    }
    // 反撃ターン
    attackers = [];
    for (const m of stage.monsters) {
      m.cd--;
      if (m.cd <= 0) {
        attackers.push(m);
        m.cd = m.cdBase;
      }
    }
    if (attackers.length > 0) {
      lives--; // 1ターンに最大1ダメージ
      stageDamaged = true;
      ctx.sfx('fail');
      ctx.haptic('error');
      if (lives <= 0) {
        phase = 'over';
        endAt = now + END_DELAY;
        return;
      }
      phase = 'turn';
      phaseUntil = now + TURN_MS;
      showMsg('ひっかかれた！ ライフ−1', TURN_MS);
    } else {
      phase = 'aim';
    }
  }

  function nextStage(): void {
    stageNo++;
    if (stageNo >= 3) ctx.achieve('stage-3');
    if (stageNo >= 5) ctx.achieve('stage-5');
    stage = makeStage(stageNo, ctx.random);
    ball = { x: BALL_START.x, y: BALL_START.y, vx: 0, vy: 0 };
    stageDamaged = false;
    phase = 'aim';
    showMsg(`ステージ ${stageNo}！`);
  }

  // ---- 毎フレーム ----
  const offFrame = ctx.onFrame((dt) => {
    if (hostPaused) return;
    const now = ctx.now();
    if (phase === 'fly') {
      const N = 4;
      for (let k = 0; k < N && phase === 'fly'; k++) physicsStep(dt / N);
      const sp = Math.hypot(ball.vx, ball.vy);
      if ((sp < STOP_SPEED || now - flyStartAt > MAX_FLY_MS) && phase === 'fly') endShot(now);
    } else if (phase === 'turn') {
      if (now >= phaseUntil) phase = 'aim';
    } else if (phase === 'clear') {
      if (now >= phaseUntil) nextStage();
    } else if (phase === 'over') {
      if (!ended && now >= endAt) {
        ended = true;
        ctx.end({ score });
        return;
      }
    }
    draw(now);
    setData();
  });

  // ---- 描画 ----
  function draw(now: number): void {
    // 背景（夜のダンジョン風・固定パレット）
    const bg = g.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#1a1440');
    bg.addColorStop(1, '#0c0a24');
    g.fillStyle = bg;
    g.fillRect(0, 0, W, H);
    // アリーナ枠
    g.strokeStyle = '#5a4a90';
    g.lineWidth = 3;
    g.strokeRect(ARENA.x, ARENA.y, ARENA.w, ARENA.h);
    g.fillStyle = 'rgba(90,74,144,.08)';
    g.fillRect(ARENA.x, ARENA.y, ARENA.w, ARENA.h);

    // 岩
    for (const o of stage.obstacles) {
      g.fillStyle = '#6a6480';
      roundRect(o.x, o.y, o.w, o.h, 7);
      g.fill();
      g.fillStyle = 'rgba(255,255,255,.12)';
      roundRect(o.x + 2, o.y + 2, o.w - 4, Math.max(4, o.h * 0.3), 5);
      g.fill();
    }

    // モンスター
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const m of stage.monsters) {
      if (m.hp <= 0) continue;
      const attacking = phase === 'turn' && attackers.includes(m) && Math.floor(now / 110) % 2 === 0;
      g.fillStyle = attacking ? '#ff8a8a' : KIND_COLOR[m.kind];
      g.beginPath();
      g.arc(m.x, m.y, MON_R, 0, Math.PI * 2);
      g.fill();
      g.font = '22px sans-serif';
      g.fillText(KIND_EMOJI[m.kind], m.x, m.y - 1);
      // HPピップ
      g.fillStyle = '#fff';
      const pipW = 6;
      const total = m.maxHp * (pipW + 2) - 2;
      for (let i = 0; i < m.maxHp; i++) {
        g.fillStyle = i < m.hp ? '#8affc0' : 'rgba(255,255,255,.25)';
        g.fillRect(m.x - total / 2 + i * (pipW + 2), m.y + MON_R + 4, pipW, 4);
      }
      // 反撃カウント
      g.fillStyle = m.cd <= 1 ? '#ff5d5d' : '#ffd54a';
      g.beginPath();
      g.arc(m.x + MON_R - 4, m.y - MON_R + 4, 9, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#1a1030';
      g.font = 'bold 12px sans-serif';
      g.fillText(String(m.cd), m.x + MON_R - 4, m.y - MON_R + 5);
    }

    // 引っぱりガイド
    if (phase === 'aim' && dragStart && dragNow) {
      const dx = dragStart.x - dragNow.x;
      const dy = dragStart.y - dragNow.y;
      const len = Math.hypot(dx, dy);
      if (len >= MIN_PULL) {
        const sp = clamp(len * PULL_SCALE, 120, MAX_SPEED);
        const glen = 40 + (sp / MAX_SPEED) * 120;
        const nx = dx / len;
        const ny = dy / len;
        g.strokeStyle = sp >= MAX_SPEED ? '#ff9a4a' : '#8affc0';
        g.lineWidth = 4;
        g.setLineDash([8, 8]);
        g.beginPath();
        g.moveTo(ball.x, ball.y);
        g.lineTo(ball.x + nx * glen, ball.y + ny * glen);
        g.stroke();
        g.setLineDash([]);
        // 矢じり
        g.beginPath();
        g.moveTo(ball.x + nx * (glen + 10), ball.y + ny * (glen + 10));
        g.lineTo(ball.x + nx * glen - ny * 7, ball.y + ny * glen + nx * 7);
        g.lineTo(ball.x + nx * glen + ny * 7, ball.y + ny * glen - nx * 7);
        g.closePath();
        g.fillStyle = g.strokeStyle;
        g.fill();
      }
    }

    // ボール
    g.fillStyle = '#ffd21e';
    g.beginPath();
    g.arc(ball.x, ball.y, BALL_R, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(255,255,255,.4)';
    g.beginPath();
    g.arc(ball.x - 4, ball.y - 4, 4.5, 0, Math.PI * 2);
    g.fill();

    // HUD
    g.fillStyle = '#fff';
    g.textAlign = 'left';
    g.font = 'bold 22px sans-serif';
    g.fillText(`${score}てん`, 14, 32);
    g.textAlign = 'center';
    g.font = 'bold 16px sans-serif';
    g.fillText(`ステージ${stageNo}`, W / 2, 32);
    g.textAlign = 'left';
    g.font = '16px sans-serif';
    g.fillText('❤️'.repeat(Math.max(0, lives)) + '🤍'.repeat(Math.max(0, LIVES0 - lives)), 14, H - 26);

    // 操作ヒント
    if (phase === 'aim' && stageNo === 1 && score === 0 && !dragStart) {
      g.fillStyle = '#cfc0f0';
      g.textAlign = 'center';
      g.font = 'bold 16px sans-serif';
      g.fillText('画面を ひっぱって はなすと 発射！', W / 2, 600);
    }

    // メッセージ
    if (now < msgUntil) {
      g.fillStyle = '#ffe08a';
      g.textAlign = 'center';
      g.font = 'bold 24px sans-serif';
      g.fillText(msg, W / 2, 96);
    }
    if (phase === 'clear') {
      g.fillStyle = '#8affc0';
      g.textAlign = 'center';
      g.font = 'bold 30px sans-serif';
      g.fillText('ステージクリア！', W / 2, H / 2 - 20);
    }
    if (phase === 'over') {
      g.fillStyle = 'rgba(8,6,24,.76)';
      g.fillRect(0, 0, W, H);
      g.fillStyle = '#fff';
      g.textAlign = 'center';
      g.font = 'bold 30px sans-serif';
      g.fillText('ゲームオーバー', W / 2, H / 2 - 30);
      g.font = 'bold 24px sans-serif';
      g.fillText(`ステージ${stageNo} / ${score}てん`, W / 2, H / 2 + 12);
    }
  }

  function roundRect(x: number, y: number, w: number, h: number, rad: number): void {
    const rr = Math.min(rad, w / 2, h / 2);
    g.beginPath();
    g.moveTo(x + rr, y);
    g.arcTo(x + w, y, x + w, y + h, rr);
    g.arcTo(x + w, y + h, x, y + h, rr);
    g.arcTo(x, y + h, x, y, rr);
    g.arcTo(x, y, x + w, y, rr);
    g.closePath();
  }

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
      // 引っぱり途中でポーズしたら ドラッグ状態を捨てる（誤発射防止）
      dragId = null;
      dragStart = null;
      dragNow = null;
    },
    resize() {
      draw(ctx.now());
    },
    destroy() {
      offDown();
      offMove();
      offUp();
      offFrame();
    },
  };
}
