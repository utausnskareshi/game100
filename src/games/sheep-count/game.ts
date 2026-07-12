// =============================================================
// ひつじかぞえ（No.28）: 夜の牧場で、柵を跳ぶ🐑だけを数えるまったりゲーム
// =============================================================
// - ウェーブ中は見ているだけ（操作なし）。おわったら −・＋ で数をあわせて「けってい」。
// - 🐐ヤギ・🐺オオカミは数えちゃダメ（R2以降に混ざる）。ぴったり=大得点／±1=おしい点。
// - 3ラウンド。ぜんぶ ぴったりなら パーフェクトボーナス。
// - 群れの計画は spawn.ts の純ロジック（rng注入＝日替わりは全員同じ群れ）。
// - 入力はすべて DOM ボタン（ctx.input 不使用＝ポインタ事故が構造的に起きない）。
// - 時間はすべて ctx.now の期限方式。startMode 省略＝シェルの3-2-1のあと start()。
// - import してよいのは game-api（types / helpers）と、このフォルダ内（spawn）だけ
import type { GameContext, IGame } from '../../game-api/types';
import { clamp, elem } from '../../game-api/helpers';
import { makePlan, ROUND_COUNT, ANIMAL_EMOJI, type WavePlan } from './spawn';

type Phase = 'idle' | 'wave' | 'answer' | 'feedback' | 'over';

const W = 360;
const H = 640;
const FENCE_X = W / 2;
const GROUND_Y = 512; // 動物の足もとの基準線
const EXACT_BASE = 100; // ぴったりの基本点
const ROUND_BONUS = [0, 40, 80]; // ラウンドごとの加点
const NEAR_POINTS = 30; // ±1の「おしい」点
const PERFECT_BONUS = 100; // 3ラウンド全部ぴったり
const FEEDBACK_MS = 1700;
const END_DELAY = 1700;
const GUESS_MAX = 30;
const SCORE_HI = 480; // 「かぞえチャンピオン」実績のしきい値（＝ほぼパーフェクト）

export function createGame(ctx: GameContext): IGame {
  const cv = ctx.canvas2d({ design: { w: W, h: H } });
  const g = cv.ctx;

  // ---- 状態 ----
  let phase: Phase = 'idle';
  let hostPaused = false;
  let round = 0;
  let plan: WavePlan | null = null;
  let waveStart = 0;
  let score = 0;
  let guess = 0;
  let exactRounds = 0;
  let feedbackUntil = 0;
  let feedbackText = '';
  let feedbackSub = '';
  let endAt = 0;
  let ended = false;

  // ---- 星（かざり。乱数を使わず固定＝rng列を消費しない）----
  const stars: { x: number; y: number; r: number }[] = [];
  for (let i = 0; i < 26; i++) {
    stars.push({ x: (i * 97 + 31) % W, y: ((i * 53 + 17) % 300) + 20, r: (i % 3) * 0.5 + 0.8 });
  }

  // ---- DOM（答えパネル）----
  const style = document.createElement('style');
  style.textContent = CSS;
  const panel = elem('div', 'sc-panel');
  const q = elem('div', 'sc-q', '🐑は なんびき とんだ？');
  const stepper = elem('div', 'sc-stepper');
  const minus = elem('button', 'sc-step', '−') as HTMLButtonElement;
  const numEl = elem('div', 'sc-num', '0');
  const plus = elem('button', 'sc-step', '＋') as HTMLButtonElement;
  stepper.append(minus, numEl, plus);
  const decide = elem('button', 'sc-decide', 'けってい ✔') as HTMLButtonElement;
  panel.append(q, stepper, decide);
  ctx.root.append(style, panel);

  minus.addEventListener('click', () => setGuess(guess - 1));
  plus.addEventListener('click', () => setGuess(guess + 1));
  decide.addEventListener('click', () => submit());

  function setGuess(v: number): void {
    if (phase !== 'answer' || hostPaused) return;
    guess = clamp(v, 0, GUESS_MAX);
    numEl.textContent = String(guess);
    ctx.sfx('tap');
    devState();
  }

  function devState(): void {
    if (!import.meta.env.DEV) return;
    const ds = ctx.root.dataset;
    ds.st = phase;
    ds.round = String(round + 1);
    ds.score = String(score);
    ds.guess = String(guess);
    ds.exact = String(exactRounds);
  }

  // ---- ラウンド進行 ----
  function startWave(): void {
    plan = makePlan(ctx.random, round);
    phase = 'wave';
    waveStart = ctx.now();
    guess = 0;
    numEl.textContent = '0';
    panel.classList.remove('sc-show');
    ctx.sfx('start');
    devState();
  }

  function showAnswerUi(): void {
    phase = 'answer';
    panel.classList.add('sc-show');
    ctx.sfx('tick');
    ctx.haptic('light');
    devState();
  }

  function submit(): void {
    if (phase !== 'answer' || hostPaused || !plan) return;
    const truth = plan.sheep;
    const diff = Math.abs(guess - truth);
    let gain = 0;
    if (diff === 0) {
      gain = EXACT_BASE + (ROUND_BONUS[round] ?? 0);
      exactRounds++;
      feedbackText = `ぴったり！ 🎉 ${truth}ひき`;
      feedbackSub = `+${gain}`;
      ctx.sfx('success');
      ctx.haptic('success');
      ctx.achieve('first-exact');
      if (truth >= 12) ctx.achieve('big-flock');
      if (plan.decoys >= 4) ctx.achieve('decoy-calm');
      // 通算ぴったり回数（インスタンス跨ぎ）
      const total = (ctx.load<number>('exactTotal') ?? 0) + 1;
      ctx.save('exactTotal', total);
      if (total >= 10) ctx.achieve('exact-10');
    } else if (diff === 1) {
      gain = NEAR_POINTS;
      feedbackText = `おしい！ こたえは ${truth}ひき`;
      feedbackSub = `きみ: ${guess}　+${gain}`;
      ctx.sfx('tap');
    } else {
      feedbackText = `ざんねん… こたえは ${truth}ひき`;
      feedbackSub = `きみ: ${guess}`;
      ctx.sfx('fail');
    }
    score += gain;
    if (score >= SCORE_HI) ctx.achieve('score-hi');
    panel.classList.remove('sc-show');
    phase = 'feedback';
    feedbackUntil = ctx.now() + FEEDBACK_MS;
    devState();
  }

  function nextOrFinish(): void {
    round++;
    if (round < ROUND_COUNT) {
      startWave();
      return;
    }
    // ぜんラウンドおわり
    if (exactRounds === ROUND_COUNT) {
      score += PERFECT_BONUS;
      ctx.achieve('perfect-3');
      if (score >= SCORE_HI) ctx.achieve('score-hi');
      feedbackText = `パーフェクト！ ✨ +${PERFECT_BONUS}`;
    } else {
      feedbackText = 'おつかれさま！ 🌙';
    }
    feedbackSub = `スコア ${score}`;
    phase = 'over';
    endAt = ctx.now() + END_DELAY;
    ctx.sfx('medal');
    devState();
  }

  // ---- 毎フレーム ----
  const offFrame = ctx.onFrame(() => {
    const now = ctx.now();
    if (phase === 'wave' && plan) {
      if (now - waveStart >= plan.waveMs) showAnswerUi();
    } else if (phase === 'feedback') {
      if (now >= feedbackUntil) nextOrFinish();
    } else if (phase === 'over' && !ended && now >= endAt) {
      ended = true;
      ctx.end({ score });
    }
    draw(now);
  });

  // ---- 描画（固定色の夜シーン＝テーマ非依存）----
  function draw(now: number): void {
    // 夜空
    const sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#0d1230');
    sky.addColorStop(0.6, '#1b2350');
    sky.addColorStop(1, '#233064');
    g.fillStyle = sky;
    g.fillRect(0, 0, W, H);
    // 星・月
    g.fillStyle = 'rgba(255,255,255,.8)';
    for (const s of stars) {
      g.beginPath();
      g.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      g.fill();
    }
    g.font = '44px serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('🌕', W - 58, 84);
    // 草原
    g.fillStyle = '#2f5d3a';
    g.fillRect(0, GROUND_Y - 26, W, H - (GROUND_Y - 26));
    g.fillStyle = '#3a7047';
    g.fillRect(0, GROUND_Y - 26, W, 22);
    // 柵（中央）
    g.strokeStyle = '#b98a4e';
    g.lineWidth = 7;
    g.lineCap = 'round';
    for (const px of [FENCE_X - 26, FENCE_X + 26]) {
      g.beginPath();
      g.moveTo(px, GROUND_Y - 88);
      g.lineTo(px, GROUND_Y + 6);
      g.stroke();
    }
    g.lineWidth = 5;
    for (const ry of [GROUND_Y - 72, GROUND_Y - 40]) {
      g.beginPath();
      g.moveTo(FENCE_X - 40, ry);
      g.lineTo(FENCE_X + 40, ry);
      g.stroke();
    }

    // 動物（右→左へ走り、柵の上で放物線ジャンプ）
    if ((phase === 'wave' || phase === 'answer') && plan) {
      const t = now - waveStart;
      g.font = '40px serif';
      for (const e of plan.events) {
        const p = (t - e.at) / e.dur;
        if (p <= 0 || p >= 1) continue;
        const x = (W + 30) - p * (W + 60);
        let y = GROUND_Y;
        const dxf = Math.abs(x - FENCE_X);
        if (dxf < 78) {
          const k = 1 - (dxf / 78) * (dxf / 78);
          y = GROUND_Y - 118 * k; // 柵(高さ~88px)を越える放物線
        }
        g.fillText(ANIMAL_EMOJI[e.type], x, y - 18);
      }
    }

    // HUD（上部・ポーズ予約領域60×60は右上を避けて左寄せ）
    g.textAlign = 'left';
    g.fillStyle = '#fff';
    g.font = 'bold 17px sans-serif';
    g.fillText(`ラウンド ${Math.min(round + 1, ROUND_COUNT)}/${ROUND_COUNT}`, 12, 28);
    g.fillText(`スコア ${score}`, 12, 54);
    if (phase === 'wave') {
      g.textAlign = 'center';
      g.font = 'bold 20px sans-serif';
      g.fillStyle = '#ffe27a';
      g.fillText('🐑を かぞえて！', W / 2, 118);
    }

    // フィードバック・結果
    if (phase === 'feedback' || phase === 'over') {
      g.fillStyle = 'rgba(10,14,38,.78)';
      g.fillRect(0, 0, W, H);
      g.textAlign = 'center';
      g.fillStyle = '#fff';
      g.font = 'bold 30px sans-serif';
      g.fillText(feedbackText, W / 2, H / 2 - 26);
      g.font = 'bold 22px sans-serif';
      g.fillStyle = '#ffe27a';
      g.fillText(feedbackSub, W / 2, H / 2 + 22);
    }
  }

  return {
    start() {
      startWave(); // シェルの3-2-1のあとR1のウェーブ開始
    },
    pause() {
      hostPaused = true;
    },
    resume() {
      hostPaused = false;
    },
    resize() {
      // design 指定の Canvas は自動レターボックス。DOMパネルは % 配置のみ
    },
    destroy() {
      offFrame();
      style.remove();
      panel.remove();
    },
  };
}

// =============================================================
// スタイル（.sc- プレフィックス。答えパネルは固定ダーク=夜シーンと調和・両テーマ可読）
// =============================================================
const CSS = `
.sc-panel{position:absolute;left:50%;bottom:4%;transform:translate(-50%,16px);width:min(88vw,340px);
  background:rgba(13,18,48,.94);border:1px solid rgba(255,255,255,.14);border-radius:20px;padding:14px 14px 16px;
  box-sizing:border-box;display:flex;flex-direction:column;align-items:center;gap:12px;
  opacity:0;pointer-events:none;transition:opacity .18s ease,transform .18s ease;user-select:none;-webkit-user-select:none}
.sc-panel.sc-show{opacity:1;pointer-events:auto;transform:translate(-50%,0)}
.sc-q{font-size:18px;font-weight:900;color:#fff}
.sc-stepper{display:flex;align-items:center;gap:14px}
.sc-step{appearance:none;border:none;border-radius:16px;width:64px;min-height:56px;font-size:30px;font-weight:900;
  font-family:inherit;background:rgba(255,255,255,.14);color:#fff}
.sc-step:active{transform:scale(.94)}
.sc-num{min-width:76px;text-align:center;font-size:40px;font-weight:900;color:#ffe27a;font-variant-numeric:tabular-nums}
.sc-decide{appearance:none;border:none;border-radius:14px;width:100%;min-height:52px;font-size:19px;font-weight:900;
  font-family:inherit;background:var(--accent-grad);color:#fff}
.sc-decide:active{transform:scale(.98)}
`;
