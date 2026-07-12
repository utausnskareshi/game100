// =============================================================
// ピカッとたしざん（No.33）: 光って消える数字を たしつづける暗算メモリー
// =============================================================
// - 数字が1つずつ「ピカッ」と出て消える。ぜんぶ消えたら 合計を4択で答える。
// - 全10ラウンド。ラウンドが進むと 個数が増え・表示が速くなる。ミス3回で おしまい。
// - スコア＝正解ラウンドの 個数×10＋むずかしさボーナス＋連続正解ボーナス(10×min(streak-1,3))。
// - 出題・4択は problems.ts（rng注入＝日替わり全員同じ）。表示は ctx.now の期限方式。
// - startMode:'immediate'＝設定（むずかしさ3段）→自前3-2-1（createCountdown）。
// - import してよいのは game-api（types / helpers）と、このフォルダ内（problems）だけ
import type { GameContext, IGame } from '../../game-api/types';
import { elem, makeSeg, createCountdown, type Countdown } from '../../game-api/helpers';
import {
  ROUNDS,
  GAP_MS,
  LEVELS,
  POINT_PER_NUM,
  STREAK_STEP,
  STREAK_CAP,
  flashMsFor,
  makeRound,
  type LevelKey,
  type Round,
} from './problems';

type Mode = 'setup' | 'count' | 'show' | 'answer' | 'feedback' | 'over';

interface Config {
  level: LevelKey;
}

const MAX_MISS = 3;
const FEEDBACK_MS = 1400;
const END_DELAY = 1800;
const SCORE_HI = 1200; // 「たしざんチャンピオン」実績のしきい値（仮）

export function createGame(ctx: GameContext): IGame {
  // ---- 設定（前回を復元。既定やさしい）----
  const savedCfg = ctx.load<Partial<Config>>('config');
  const config: Config = {
    level: savedCfg?.level === 'normal' || savedCfg?.level === 'hard' ? savedCfg.level : 'easy',
  };

  // ---- 状態 ----
  let mode: Mode = 'setup';
  let hostPaused = false;
  let level: LevelKey = config.level;
  let round = 0;
  let cur: Round | null = null;
  let showIdx = -1; // いま光っている数字の index（-1=暗転中）
  let nextAt = 0; // 次の表示切替時刻
  let score = 0;
  let streak = 0;
  let correct = 0;
  let misses = 0;
  let feedbackUntil = 0;
  let endAt = 0;
  let ended = false;
  let cd: Countdown | null = null;

  // ---- DOM ----
  const style = document.createElement('style');
  style.textContent = CSS;
  const wrap = elem('div', 'ps-wrap');
  ctx.root.append(style, wrap);

  let hudRound: HTMLElement | null = null;
  let hudMiss: HTMLElement | null = null;
  let hudScore: HTMLElement | null = null;
  let stageEl: HTMLElement | null = null;
  let cardEl: HTMLElement | null = null;
  let numEl: HTMLElement | null = null;
  let msgEl: HTMLElement | null = null;
  let countEl: HTMLElement | null = null;
  let choicesEl: HTMLElement | null = null;
  let choiceBtns: HTMLButtonElement[] = [];

  function devState(): void {
    if (!import.meta.env.DEV) return;
    const ds = wrap.dataset;
    ds.st = mode;
    ds.round = String(round + 1);
    ds.score = String(score);
    ds.streak = String(streak);
    ds.miss = String(misses);
    ds.correct = String(correct);
  }

  // ---- 設定画面 ----
  function showSetup(): void {
    mode = 'setup';
    devState();
    const box = elem('div', 'ps-setup');
    box.append(elem('h2', 'ps-h2', 'ひかる数字を たしていこう'));
    box.append(
      makeSeg(
        'ps',
        'むずかしさ',
        [
          { v: 'easy', t: 'やさしい' },
          { v: 'normal', t: 'ふつう' },
          { v: 'hard', t: 'むずかしい' },
        ],
        () => config.level,
        (v) => {
          config.level = v as LevelKey;
        },
      ),
    );
    box.append(
      elem(
        'p',
        'ps-note',
        '数字が 1つずつ ピカッと光って 消えていくよ。ぜんぶ消えたら「たした答え」を 4つから えらぼう！ラウンドが すすむと 数が ふえて はやくなる。まちがい3回で おしまい。',
      ),
    );
    const start = elem('button', 'ps-btn ps-btn-primary ps-btn-lg', 'はじめる ▶') as HTMLButtonElement;
    start.addEventListener('click', () => startMatch());
    box.append(start);
    wrap.replaceChildren(box);
  }

  // ---- 開始 ----
  function startMatch(): void {
    ctx.save('config', { ...config });
    level = config.level;
    round = 0;
    score = 0;
    streak = 0;
    correct = 0;
    misses = 0;
    ended = false;
    buildPlay();
    mode = 'count';
    devState();
    cd = createCountdown({
      onCount: (n) => {
        if (countEl) countEl.textContent = String(n);
        ctx.sfx('tick');
      },
      onGo: (now) => {
        countEl?.remove();
        countEl = null;
        ctx.sfx('start');
        startRound(now);
      },
    });
    cd.start(ctx.now());
  }

  function buildPlay(): void {
    const play = elem('div', 'ps-play');

    const hud = elem('div', 'ps-hud');
    hudRound = elem('span', 'ps-hud-item', `ラウンド 1/${ROUNDS}`);
    hudMiss = elem('span', 'ps-hud-item', '❤️❤️❤️');
    hudScore = elem('span', 'ps-hud-item', 'スコア 0');
    hud.append(hudRound, hudMiss, hudScore);

    stageEl = elem('div', 'ps-stage');
    cardEl = elem('div', 'ps-card');
    numEl = elem('div', 'ps-num', '');
    cardEl.append(numEl);
    msgEl = elem('div', 'ps-msg', '');
    countEl = elem('div', 'ps-count', '');
    stageEl.append(cardEl, msgEl, countEl);

    choicesEl = elem('div', 'ps-choices');
    choiceBtns = [];
    for (let i = 0; i < 4; i++) {
      const idx = i;
      const b = elem('button', 'ps-choice') as HTMLButtonElement;
      b.disabled = true;
      b.addEventListener('click', () => onChoice(idx));
      choiceBtns.push(b);
      choicesEl.append(b);
    }

    play.append(hud, stageEl, choicesEl);
    wrap.replaceChildren(play);
  }

  // ---- ラウンド進行 ----
  function startRound(now: number): void {
    cur = makeRound(ctx.random, level, round);
    mode = 'show';
    showIdx = -1;
    nextAt = now + 500; // 最初の数字までひと呼吸
    if (msgEl) {
      msgEl.className = 'ps-msg';
      msgEl.textContent = 'よーく見て… 👀';
    }
    if (numEl) numEl.textContent = '';
    for (const b of choiceBtns) {
      b.disabled = true;
      b.textContent = '';
      b.classList.remove('ps-x', 'ps-o');
    }
    paintHud();
    devState();
  }

  /** show フェーズの表示切替（数字→暗転→数字…→回答へ） */
  function tickShow(now: number): void {
    if (!cur || now < nextAt) return;
    const flash = flashMsFor(level, round);
    if (showIdx >= 0 && numEl && numEl.textContent !== '') {
      // いま数字が出ている → 暗転へ
      numEl.textContent = '';
      nextAt = now + GAP_MS;
      if (showIdx >= cur.nums.length - 1) toAnswer(now);
      return;
    }
    // 暗転中 → 次の数字を出す
    showIdx++;
    if (showIdx >= cur.nums.length) {
      toAnswer(now);
      return;
    }
    if (numEl && cardEl) {
      numEl.textContent = String(cur.nums[showIdx]);
      cardEl.classList.remove('ps-pulse');
      void cardEl.offsetWidth;
      cardEl.classList.add('ps-pulse');
    }
    ctx.sfx('tick');
    nextAt = now + flash;
  }

  function toAnswer(_now: number): void {
    if (!cur) return;
    mode = 'answer';
    if (numEl) numEl.textContent = '？';
    if (msgEl) {
      msgEl.className = 'ps-msg ps-msg-q';
      msgEl.textContent = `ぜんぶ たすと いくつ？（${cur.nums.length}この数字）`;
    }
    for (let i = 0; i < 4; i++) {
      const b = choiceBtns[i]!;
      b.textContent = String(cur.choices[i]);
      b.disabled = false;
    }
    ctx.sfx('powerup');
    devState();
  }

  function onChoice(i: number): void {
    if (mode !== 'answer' || hostPaused || !cur) return;
    const now = ctx.now();
    for (const b of choiceBtns) b.disabled = true;
    if (i === cur.answerIdx) {
      correct++;
      streak++;
      const gain = cur.nums.length * POINT_PER_NUM + LEVELS[level].bonus + STREAK_STEP * Math.min(streak - 1, STREAK_CAP);
      score += gain;
      choiceBtns[i]!.classList.add('ps-o');
      if (msgEl) {
        msgEl.className = 'ps-msg ps-msg-good';
        msgEl.textContent = `せいかい！ ✨ +${gain}`;
      }
      ctx.sfx('success');
      ctx.haptic('success');
      ctx.achieve('first-sum');
      if (streak === 5) ctx.achieve('streak-5');
      if (cur.nums.length >= 8) ctx.achieve('count-8');
      if (level === 'hard' && correct === 5) ctx.achieve('hard-5');
      if (score >= SCORE_HI) ctx.achieve('score-hi');
    } else {
      misses++;
      streak = 0;
      choiceBtns[i]!.classList.add('ps-x');
      choiceBtns[cur.answerIdx]!.classList.add('ps-o');
      if (msgEl) {
        msgEl.className = 'ps-msg ps-msg-bad';
        msgEl.textContent = `ざんねん… こたえは ${cur.sum}`;
      }
      ctx.sfx('fail');
      ctx.haptic('error');
    }
    paintHud();
    mode = 'feedback';
    feedbackUntil = now + FEEDBACK_MS;
    devState();
  }

  function nextOrFinish(now: number): void {
    round++;
    if (misses >= MAX_MISS || round >= ROUNDS) {
      finish(now);
      return;
    }
    startRound(now);
  }

  function finish(now: number): void {
    mode = 'over';
    if (misses === 0 && correct === ROUNDS) ctx.achieve('perfect-10');
    if (msgEl) {
      msgEl.className = 'ps-msg ps-msg-over';
      msgEl.textContent = misses >= MAX_MISS ? `ミスが3回… スコア ${score}` : `おつかれさま！ 🎉 スコア ${score}`;
    }
    if (numEl) numEl.textContent = '🧠';
    for (const b of choiceBtns) b.disabled = true;
    endAt = now + END_DELAY;
    ctx.sfx('medal');
    ctx.haptic('success');
    devState();
  }

  // ---- 描画 ----
  function paintHud(): void {
    if (hudRound) hudRound.textContent = `ラウンド ${Math.min(round + 1, ROUNDS)}/${ROUNDS}`;
    if (hudMiss) hudMiss.textContent = '❤️'.repeat(MAX_MISS - misses) + '🖤'.repeat(misses);
    if (hudScore) hudScore.textContent = `スコア ${score}`;
  }

  // ---- 毎フレーム ----
  const offFrame = ctx.onFrame(() => {
    const now = ctx.now();
    if (mode === 'count') {
      cd?.tick(now);
      return;
    }
    if (mode === 'show') {
      tickShow(now);
      return;
    }
    if (mode === 'feedback') {
      if (now >= feedbackUntil) nextOrFinish(now);
      return;
    }
    if (mode === 'over' && !ended && now >= endAt) {
      ended = true;
      ctx.end({ score });
    }
  });

  // ---- 起動（startMode:'immediate'。設定画面から始まる）----
  showSetup();

  return {
    start() {
      // シェルのカウントダウンは省略。設定画面（showSetup）から開始する
    },
    pause() {
      hostPaused = true;
    },
    resume() {
      hostPaused = false;
    },
    resize() {
      // flexレイアウトのみ＝何もしなくてよい
    },
    destroy() {
      offFrame();
      style.remove();
      wrap.remove();
    },
  };
}

// =============================================================
// スタイル（.ps- プレフィックス。数字カードは固定ダーク地＝集中しやすく両テーマ可読）
// =============================================================
const CSS = `
.ps-wrap{position:absolute;inset:0;overflow:hidden}

/* 設定画面 */
.ps-setup{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:safe center;
  gap:14px;padding:20px 16px;box-sizing:border-box;overflow-y:auto;user-select:none;-webkit-user-select:none}
.ps-h2{margin:4px 0;font-size:22px;text-align:center}
.ps-seg-row{width:min(92vw,420px);display:flex;flex-direction:column;gap:6px}
.ps-seg-label{font-size:13px;color:var(--text-dim);font-weight:800}
.ps-seg{display:flex;background:var(--bg-elev2);border-radius:12px;padding:3px;gap:2px}
.ps-seg-btn{flex:1;border:none;background:none;color:var(--text-dim);padding:10px 2px;border-radius:9px;
  font-size:13px;font-weight:800;min-height:44px}
.ps-seg-btn.ps-on{background:var(--accent);color:#fff}
.ps-note{font-size:12px;color:var(--text-dim);text-align:center;max-width:min(92vw,420px);margin:0;line-height:1.7}
.ps-btn{appearance:none;border:none;border-radius:12px;padding:12px 18px;font-size:15px;font-weight:800;font-family:inherit;
  background:var(--bg-elev2);color:var(--text);min-height:44px}
.ps-btn-primary{background:var(--accent-grad);color:#fff}
.ps-btn-lg{width:100%;max-width:300px;font-size:18px}

/* プレイ画面 */
.ps-play{position:absolute;inset:0;display:flex;flex-direction:column;padding:6px 10px 12px;box-sizing:border-box;
  user-select:none;-webkit-user-select:none}
.ps-hud{display:flex;justify-content:center;align-items:center;gap:14px;padding:2px 64px 4px;flex-wrap:wrap;min-height:54px}
.ps-hud-item{font-size:14px;font-weight:800;white-space:nowrap}
.ps-stage{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;align-items:center;justify-content:center;position:relative;gap:12px}
.ps-card{width:min(72vw,250px);aspect-ratio:1;border-radius:24px;background:#171a2e;box-shadow:0 4px 18px rgba(0,0,0,.25);
  display:flex;align-items:center;justify-content:center}
.ps-num{font-size:clamp(72px,26vw,110px);font-weight:900;color:#ffe27a;font-variant-numeric:tabular-nums;line-height:1}
@keyframes ps-pulse{from{transform:scale(.8);opacity:.4}to{transform:scale(1);opacity:1}}
.ps-card.ps-pulse .ps-num{animation:ps-pulse .16s ease-out}
.ps-msg{min-height:26px;font-size:16px;font-weight:900;text-align:center;padding:0 8px}
.ps-msg-q{color:var(--accent-2)}
.ps-msg-good{color:#2fae5e}
.ps-msg-bad{color:#e2607a}
.ps-msg-over{color:var(--text)}
.ps-count{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:96px;font-weight:900;
  color:var(--text);pointer-events:none}

/* 4択 */
.ps-choices{display:grid;grid-template-columns:1fr 1fr;gap:10px;padding:8px 2px 0}
.ps-choice{appearance:none;border:none;border-radius:16px;min-height:66px;font-size:26px;font-weight:900;font-family:inherit;
  background:var(--bg-elev2);color:var(--text);font-variant-numeric:tabular-nums}
.ps-choice:active:not(:disabled){transform:scale(.97)}
.ps-choice.ps-x{opacity:.35;text-decoration:line-through}
.ps-choice.ps-o{background:#2fae5e;color:#fff}
`;
