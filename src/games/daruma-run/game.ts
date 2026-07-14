// =============================================================
// だるまさんがころんだ（No.50）: おにが言っている間だけ進め！振り向いたら手を離せ！
// =============================================================
// - 画面をおしている間だけ 前へ進む。おにが「だるまさんがころんだ」を言い終わって
//   振り向いた瞬間に おしていたら つかまる（わずかな猶予あり・3回でおしまい）。
// - 読み上げの速さはランダム＋途中で止まるフェイントあり。40m先のおににタッチでゴール！
// - 読み上げ・得点は logic.ts（rng注入・1サイクル4回固定＝日替わり同一）。
// - Canvas 360×640。ホールドのみ（onDown/onUp）。シェルの3-2-1で開始。
// - import してよいのは game-api（types / helpers）と、このフォルダ内（logic）だけ
import type { GameContext, IGame } from '../../game-api/types';
import {
  BACK_MS,
  CHANT_TEXT,
  GOAL_M,
  GRACE_MS,
  LIVES,
  RUN_SPEED,
  chantChars,
  chantTotalMs,
  goalScore,
  partialScore,
  rollChant,
  type Chant,
} from './logic';

const W = 360;
const H = 640;
const ONI_Y = 130;
const KID_Y_START = 545;
const KID_Y_GOAL = 195;
const CAUGHT_MS = 1300;
const END_DELAY = 1900;
const SPEEDY_SEC = 35;
const DASH_ACH_M = 6;

type Phase = 'chant' | 'grace' | 'watch' | 'back' | 'caught' | 'goal' | 'over';

export function createGame(ctx: GameContext): IGame {
  const cv = ctx.canvas2d({ design: { w: W, h: H } });
  const g = cv.ctx;

  // ---- 状態 ----
  let phase: Phase = 'chant';
  let hostPaused = false;
  let chant: Chant = { speakMs: 2000, feint: false, feintPauseMs: 0, watchMs: 1200 };
  let phaseStart = 0;
  let dist = 0;
  let chantStartDist = 0;
  let caught = 0;
  let playStart = 0;
  let score = 0;
  let started = false;
  const holdIds = new Set<number>();
  let endAt = 0;
  let ended = false;

  function holding(): boolean {
    return holdIds.size > 0;
  }

  function setData(now: number): void {
    const r = ctx.root as HTMLElement;
    r.dataset.mode = phase;
    r.dataset.dist = dist.toFixed(2);
    r.dataset.lives = String(LIVES - caught);
    r.dataset.score = String(score);
    if (!import.meta.env.DEV) return;
    r.dataset.holding = holding() ? '1' : '0';
    r.dataset.phasestart = String(Math.round(phaseStart));
    r.dataset.chantend = String(Math.round(phaseStart + chantTotalMs(chant)));
    r.dataset.watchms = String(Math.round(chant.watchMs));
    r.dataset.elapsed = String(Math.round(now - playStart));
  }

  // ---- 入力（ホールド＝進む）----
  const offDown = ctx.input.onDown((p) => {
    if (hostPaused) return;
    holdIds.add(p.id);
  });
  const offUp = ctx.input.onUp((p) => {
    holdIds.delete(p.id);
  });

  // ---- サイクル ----
  function startChant(now: number): void {
    chant = rollChant(ctx.random);
    phase = 'chant';
    phaseStart = now;
    chantStartDist = dist;
    ctx.sfx('tick');
  }

  function turnAround(now: number): void {
    phase = 'grace';
    phaseStart = now;
    // 1回の読み上げでどれだけ進めたか（実績）
    if (dist - chantStartDist >= DASH_ACH_M) ctx.achieve('dash-6');
    ctx.sfx('tap');
    ctx.haptic('light');
  }

  function beCaught(now: number): void {
    caught++;
    phase = 'caught'; // 3回目でも「みーつけた！！」の演出を見せてから終了する
    phaseStart = now;
    ctx.sfx('fail');
    ctx.haptic('error');
    if (caught >= LIVES) {
      score = partialScore(dist);
      endAt = now + CAUGHT_MS + END_DELAY;
    }
  }

  function reachGoal(now: number): void {
    const sec = Math.floor((now - playStart) / 1000);
    score = goalScore(sec, caught);
    phase = 'goal';
    phaseStart = now;
    endAt = now + END_DELAY;
    // 実績（ゴール時に即解除）
    ctx.achieve('first-goal');
    if (caught === 0) ctx.achieve('no-caught');
    if (sec <= SPEEDY_SEC) ctx.achieve('speedy-35');
    if (caught === 0 && sec <= SPEEDY_SEC) ctx.achieve('perfect');
    const total = (ctx.load<number>('goals') ?? 0) + 1;
    ctx.save('goals', total);
    if (total >= 3) ctx.achieve('goal-3');
    ctx.sfx('medal');
    ctx.haptic('success');
  }

  // ---- 毎フレーム ----
  const offFrame = ctx.onFrame((dt) => {
    const now = ctx.now();
    if (!hostPaused && started) {
      const t = now - phaseStart;
      // 前進（読み上げ中と猶予中だけ安全に進める）
      if ((phase === 'chant' || phase === 'grace') && holding()) {
        dist += RUN_SPEED * dt;
        if (dist >= GOAL_M) {
          dist = GOAL_M;
          reachGoal(now);
        }
      }
      if (phase === 'chant' && t >= chantTotalMs(chant)) turnAround(now);
      else if (phase === 'grace' && t >= GRACE_MS) {
        phase = 'watch';
        phaseStart = now;
      } else if (phase === 'watch') {
        if (holding()) beCaught(now);
        else if (t >= chant.watchMs) {
          phase = 'back';
          phaseStart = now;
        }
      } else if (phase === 'back' && t >= BACK_MS) {
        startChant(now);
      } else if (phase === 'caught' && t >= CAUGHT_MS) {
        if (caught >= LIVES) phase = 'over';
        else startChant(now);
      }
      if ((phase === 'over' || phase === 'goal') && !ended && now >= endAt) {
        ended = true;
        ctx.end({ score });
        return;
      }
    }
    draw(now);
    setData(now);
  });

  // ---- 描画（こうていの固定パレット＝両テーマ共通）----
  function draw(now: number): void {
    const t = now - phaseStart;
    // そら・じめん
    const sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#ffe8c2');
    sky.addColorStop(1, '#fdf6e8');
    g.fillStyle = sky;
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#d9c9a3';
    g.fillRect(0, 160, W, 440);
    // みち（おにへ向かう）
    g.fillStyle = '#e8dcbd';
    g.beginPath();
    g.moveTo(120, 600);
    g.lineTo(150, 170);
    g.lineTo(210, 170);
    g.lineTo(240, 600);
    g.closePath();
    g.fill();

    const facing = phase === 'grace' || phase === 'watch' || phase === 'caught';
    // おに（だるま風・振り向きで顔）
    g.fillStyle = '#d8362a';
    g.beginPath();
    g.arc(W / 2, ONI_Y, 44, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#b8281e';
    g.beginPath();
    g.arc(W / 2, ONI_Y - 30, 20, Math.PI, 0);
    g.fill();
    if (facing) {
      g.fillStyle = '#fff2e0';
      g.beginPath();
      g.ellipse(W / 2, ONI_Y + 6, 28, 24, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#222';
      g.beginPath();
      g.arc(W / 2 - 10, ONI_Y + 2, 4, 0, Math.PI * 2);
      g.arc(W / 2 + 10, ONI_Y + 2, 4, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = '#222';
      g.lineWidth = 2.5;
      g.beginPath();
      g.arc(W / 2, ONI_Y + 12, 8, 0.15 * Math.PI, 0.85 * Math.PI);
      g.stroke();
    } else {
      // うしろすがた（もよう）
      g.strokeStyle = '#f0b23e';
      g.lineWidth = 4;
      g.beginPath();
      g.arc(W / 2, ONI_Y + 6, 22, 0.2 * Math.PI, 0.8 * Math.PI);
      g.stroke();
    }

    // ふきだし（読み上げ／みてる！）
    if (phase === 'chant') {
      const chars = chantChars(chant, t);
      const text = CHANT_TEXT.slice(0, chars);
      g.fillStyle = '#ffffff';
      g.strokeStyle = '#d8c49a';
      g.lineWidth = 2;
      const bw = 280;
      g.beginPath();
      g.roundRect ? g.roundRect(W / 2 - bw / 2, 26, bw, 44, 12) : g.rect(W / 2 - bw / 2, 26, bw, 44);
      g.fill();
      g.stroke();
      g.fillStyle = '#5a4636';
      g.font = 'bold 20px sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(text + (chars < CHANT_TEXT.length ? '…' : '！'), W / 2, 48);
    } else if (facing) {
      g.fillStyle = '#d8362a';
      g.font = 'bold 24px sans-serif';
      g.textAlign = 'center';
      g.fillText(phase === 'caught' ? 'みーつけた！！' : 'みてるよ〜！', W / 2, 48);
    }

    // 子（進みに応じて上へ）
    const frac = Math.min(1, dist / GOAL_M);
    const kidY = KID_Y_START + (KID_Y_GOAL - KID_Y_START) * frac;
    g.font = '52px sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'bottom';
    g.fillText(phase === 'caught' ? '😵' : holding() && (phase === 'chant' || phase === 'grace') ? '🏃' : '🧍', W / 2, kidY);
    g.textBaseline = 'middle';

    // HUD
    g.fillStyle = '#5a4636';
    g.textAlign = 'left';
    g.font = 'bold 22px sans-serif';
    g.fillText(`${dist.toFixed(1)}m`, 14, 34);
    g.font = 'bold 13px sans-serif';
    let hearts = '';
    for (let i = 0; i < LIVES; i++) hearts += i < LIVES - caught ? '❤️' : '🤍';
    g.fillText(hearts, 14, 58);
    if (started && phase !== 'over' && phase !== 'goal') {
      g.fillText(`⏱ ${Math.floor((now - playStart) / 1000)}`, 100, 58);
    }
    g.fillText(`のこり ${(GOAL_M - dist).toFixed(0)}m`, 160, 58);

    // あんない
    if (phase === 'chant' && dist < 2) {
      g.fillStyle = '#3a5a76';
      g.font = 'bold 15px sans-serif';
      g.textAlign = 'center';
      g.fillText('おしている間だけ すすむ。振り向いたら 手をはなせ！', W / 2, 600);
    }

    if (phase === 'goal' || phase === 'over') {
      g.fillStyle = 'rgba(70,50,30,.62)';
      g.fillRect(0, 0, W, H);
      g.fillStyle = '#fff';
      g.textAlign = 'center';
      g.font = 'bold 34px sans-serif';
      g.fillText(phase === 'goal' ? 'タッチ！ 🎉' : 'つかまった〜！', W / 2, H / 2 - 40);
      g.font = 'bold 24px sans-serif';
      g.fillText(`${score}てん`, W / 2, H / 2 + 8);
    }
  }

  // ---- 起動（シェルの 3-2-1 のあと start()）----
  draw(0);
  setData(0);

  return {
    start() {
      started = true;
      playStart = ctx.now();
      startChant(ctx.now());
      setData(ctx.now());
    },
    pause() {
      hostPaused = true;
      holdIds.clear();
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
