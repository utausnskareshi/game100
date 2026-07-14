// =============================================================
// ものまねドラム（No.44）: お手本のリズムを聞いて、同じ「間」でたたき返せ！
// =============================================================
// - お手本（音＋光）のあと、画面のどこでもタップ＝ドラム。1打目が基準になり、
//   2打目からの「間」のズレをミリ秒判定（ぴったり≤55ms／おしい≤115ms／それ以上はミス）。
// - ミスした瞬間そのラウンドは終了（つぎのお手本へ）。ミス3回でおしまい。全10ラウンド。
// - パターン生成・判定は logic.ts（rng注入・日替わり同一）。お手本の音は ctx.tone。
// - DOMゲーム（タップは ctx.input.onDown＝押した瞬間で計測）。startMode:'immediate'。
// - import してよいのは game-api（types / helpers）と、このフォルダ内（logic）だけ
import type { GameContext, IGame } from '../../game-api/types';
import { elem } from '../../game-api/helpers';
import {
  ALL_PERFECT_BONUS,
  COMPLETE_BONUS,
  MISSES_MAX,
  ROUNDS,
  judgeOf,
  patternAt,
  pointsOf,
  type Judge,
} from './logic';

type Phase = 'ready' | 'listen' | 'echo' | 'result' | 'over';

const LEAD_MS = 700; // 「きいてね」→ 1音目まで
const ECHO_GAP_MS = 550; // お手本のおわり → 「きみのばん」まで
const RESULT_MS = 1350;
const END_DELAY = 1900;
const TONE_HZ = 220;
const TONE_ACCENT_HZ = 330;

export function createGame(ctx: GameContext): IGame {
  // ---- 状態 ----
  let phase: Phase = 'ready';
  let hostPaused = false;
  let round = 0;
  let pattern: number[] = [];
  let listenStart = 0;
  let beatIdx = 0; // お手本再生の進み
  let echoT0 = 0; // 1打目の時刻
  let tapIdx = 0; // つぎに判定する打（1打目=0は基準）
  let misses = 0;
  let score = 0;
  let perfectCount = 0; // 通しの「ぴったり」数（実績用）
  let roundPts = 0;
  let allPerfect = true;
  let roundFailed = false;
  let resultAt = 0;
  let endAt = 0;
  let ended = false;

  // ---- DOM ----
  const style = document.createElement('style');
  style.textContent = CSS;
  const wrap = elem('div', 'ed-wrap');
  ctx.root.append(style, wrap);

  let hudRoundEl: HTMLElement | null = null;
  let hudMissEl: HTMLElement | null = null;
  let hudScoreEl: HTMLElement | null = null;
  let lampsEl: HTMLElement | null = null;
  let judgeEl: HTMLElement | null = null;
  let msgEl: HTMLElement | null = null;
  let drumEl: HTMLElement | null = null;
  let lamps: HTMLElement[] = [];

  function devState(): void {
    if (!import.meta.env.DEV) return;
    const ds = wrap.dataset;
    ds.st = phase;
    ds.round = String(round);
    ds.misses = String(misses);
    ds.score = String(score);
    ds.tap = String(tapIdx);
    ds.pattern = JSON.stringify(pattern.map((t) => Math.round(t)));
  }

  function buildUi(): void {
    const hud = elem('div', 'ed-hud');
    hudRoundEl = elem('span', 'ed-hud-item', '');
    hudMissEl = elem('span', 'ed-hud-item', '');
    hudScoreEl = elem('span', 'ed-hud-item', '');
    hud.append(hudRoundEl, hudMissEl, hudScoreEl);
    lampsEl = elem('div', 'ed-lamps');
    judgeEl = elem('div', 'ed-judge', '');
    drumEl = elem('div', 'ed-drum', '🥁');
    msgEl = elem('div', 'ed-msg', '');
    wrap.append(hud, lampsEl, judgeEl, drumEl, msgEl);
    paintHud();
  }

  function paintHud(): void {
    if (hudRoundEl) hudRoundEl.textContent = `おだい ${Math.min(round + 1, ROUNDS)}/${ROUNDS}`;
    if (hudMissEl) {
      let h = '';
      for (let i = 0; i < MISSES_MAX; i++) h += i < MISSES_MAX - misses ? '❤️' : '🤍';
      hudMissEl.textContent = h;
    }
    if (hudScoreEl) hudScoreEl.textContent = `スコア ${score}`;
  }

  // ---- ラウンド ----
  function startRound(): void {
    pattern = patternAt(ctx.random, round);
    // 「おだい5まで すすんだ」＝到達した時点で解除（クリアできなくても進めばOK）
    if (round >= 4) ctx.achieve('reach-5');
    beatIdx = 0;
    tapIdx = 0;
    roundPts = 0;
    allPerfect = true;
    roundFailed = false;
    phase = 'listen';
    listenStart = ctx.now() + LEAD_MS;
    if (lampsEl) {
      lampsEl.replaceChildren();
      lamps = [];
      for (let i = 0; i < pattern.length; i++) {
        const d = elem('span', 'ed-lamp');
        lamps.push(d);
        lampsEl.append(d);
      }
    }
    if (msgEl) msgEl.textContent = '👂 よくきいて…';
    if (judgeEl) judgeEl.textContent = '';
    drumEl?.classList.remove('ed-drum-on');
    paintHud();
    devState();
  }

  function startEcho(now: number): void {
    phase = 'echo';
    tapIdx = 0;
    echoT0 = 0;
    for (const l of lamps) l.className = 'ed-lamp';
    if (msgEl) msgEl.textContent = '🥁 きみのばん！同じリズムで たたこう';
    drumEl?.classList.add('ed-drum-on');
    ctx.sfx('tick');
    devState();
    void now;
  }

  // ---- 入力（画面のどこでもドラム。押した瞬間で計測）----
  const offDown = ctx.input.onDown(() => {
    if (hostPaused || phase !== 'echo' || roundFailed) return;
    const now = ctx.now();
    drumEl?.classList.remove('ed-hit');
    // リフローで再アニメ
    void drumEl?.offsetWidth;
    drumEl?.classList.add('ed-hit');
    ctx.tone?.(TONE_HZ, 80);
    if (tapIdx === 0) {
      // 1打目＝基準
      echoT0 = now;
      markLamp(0, 'perfect');
      tapIdx = 1;
      ctx.haptic('light');
      if (pattern.length === 1) finishRound();
      devState();
      return;
    }
    if (tapIdx >= pattern.length) return; // 打ちすぎは無視
    const expected = echoT0 + (pattern[tapIdx]! - pattern[0]!);
    const dev = Math.abs(now - expected);
    const j = judgeOf(dev);
    showJudge(j, Math.round(dev));
    if (j === 'miss') {
      failRound();
      return;
    }
    roundPts += pointsOf(j);
    if (j !== 'perfect') allPerfect = false;
    markLamp(tapIdx, j);
    tapIdx++;
    ctx.haptic('light');
    if (tapIdx >= pattern.length) finishRound();
    devState();
  });

  function markLamp(i: number, j: Judge): void {
    const l = lamps[i];
    if (l) l.className = `ed-lamp ed-${j}`;
  }

  function showJudge(j: Judge, dev: number): void {
    if (!judgeEl) return;
    judgeEl.className = `ed-judge ed-j-${j}`;
    judgeEl.textContent = j === 'perfect' ? `ぴったり！ (${dev}ms)` : j === 'good' ? `おしい (${dev}ms)` : 'ミス…';
  }

  function finishRound(): void {
    const now = ctx.now();
    let s = roundPts + COMPLETE_BONUS;
    if (allPerfect) s += ALL_PERFECT_BONUS;
    score += s;
    phase = 'result';
    resultAt = now + RESULT_MS;
    // 実績（加算箇所で即解除）
    if (allPerfect) ctx.achieve('first-perfect');
    perfectCount += countPerfects();
    if (perfectCount >= 20) ctx.achieve('perfect-20');
    if (score >= 1000) ctx.achieve('score-hi');
    if (msgEl) msgEl.textContent = `${allPerfect ? '🌟 ぜんぶぴったり！' : 'できた！'} +${s}てん`;
    ctx.sfx(allPerfect ? 'combo' : 'success');
    ctx.haptic('success');
    if (round >= ROUNDS - 1) {
      ctx.achieve('clear-all');
      if (misses === 0) ctx.achieve('no-miss');
      phase = 'over';
      endAt = now + END_DELAY;
      ctx.sfx('medal');
      if (msgEl) msgEl.textContent = `🏆 10もん完走！ ごうけい ${score}てん`;
    }
    paintHud();
    devState();
  }

  function countPerfects(): number {
    // このラウンドの「ぴったり」数（1打目は基準なので数えない）
    let c = 0;
    for (let i = 1; i < lamps.length; i++) if (lamps[i]!.classList.contains('ed-perfect')) c++;
    return c;
  }

  function failRound(): void {
    const now = ctx.now();
    misses++;
    roundFailed = true;
    phase = 'result';
    resultAt = now + RESULT_MS;
    ctx.sfx('fail');
    ctx.haptic('error');
    if (msgEl) msgEl.textContent = 'リズムが くずれた…！';
    if (misses >= MISSES_MAX) {
      phase = 'over';
      endAt = now + END_DELAY;
      if (msgEl) msgEl.textContent = `おしまい… ごうけい ${score}てん`;
    } else if (round >= ROUNDS - 1) {
      // 最終おだいをミスで終えた（ミス残あり）→ ここで10もん終了（11問目以降は作らない）
      phase = 'over';
      endAt = now + END_DELAY;
      if (msgEl) msgEl.textContent = `さいごまで たたいた！ ごうけい ${score}てん`;
    }
    paintHud();
    devState();
  }

  // ---- 毎フレーム（お手本再生・遷移。すべて ctx.now 期限方式）----
  const offFrame = ctx.onFrame(() => {
    const now = ctx.now();
    if (phase === 'listen') {
      while (beatIdx < pattern.length && now >= listenStart + pattern[beatIdx]!) {
        const i = beatIdx;
        lamps[i]?.classList.add('ed-on');
        ctx.tone?.(i === 0 ? TONE_ACCENT_HZ : TONE_HZ, 90);
        ctx.sfx('tap');
        beatIdx++;
      }
      if (beatIdx >= pattern.length && now >= listenStart + pattern[pattern.length - 1]! + ECHO_GAP_MS) {
        startEcho(now);
      }
      return;
    }
    if (phase === 'result' && now >= resultAt) {
      round++;
      startRound();
      return;
    }
    if (phase === 'over' && !ended && now >= endAt) {
      ended = true;
      ctx.end({ score });
    }
  });

  // ---- 起動（startMode:'immediate'＝すぐお手本1）----
  buildUi();
  startRound();

  return {
    start() {
      // カウントダウンなし。おだい1の「よくきいて…」から始まる
    },
    pause() {
      hostPaused = true;
    },
    resume() {
      hostPaused = false;
    },
    resize() {
      // DOMフレックス配置のため何もしない
    },
    destroy() {
      offDown();
      offFrame();
      style.remove();
      wrap.remove();
    },
  };
}

// =============================================================
// スタイル（.ed- プレフィックス。テーマ変数でライト/ダーク両対応）
// =============================================================
const CSS = `
.ed-wrap{position:absolute;inset:0;overflow:hidden;display:flex;flex-direction:column;align-items:center;
  user-select:none;-webkit-user-select:none}
.ed-hud{display:flex;justify-content:center;align-items:center;gap:14px;padding:8px 64px 4px;flex-wrap:wrap;min-height:54px}
.ed-hud-item{font-size:14px;font-weight:800;white-space:nowrap;font-variant-numeric:tabular-nums}
.ed-lamps{display:flex;gap:12px;margin-top:26px;min-height:26px}
.ed-lamp{width:24px;height:24px;border-radius:50%;background:var(--bg-elev2);box-shadow:inset 0 0 0 2px var(--text-dim)}
.ed-lamp.ed-on{background:#ffc94d;box-shadow:0 0 14px rgba(255,201,77,.8)}
.ed-lamp.ed-perfect{background:#2fae5e;box-shadow:none}
.ed-lamp.ed-good{background:#ffc94d;box-shadow:none}
.ed-judge{min-height:30px;margin-top:20px;font-size:20px;font-weight:900}
.ed-j-perfect{color:#2fae5e}
.ed-j-good{color:#e8a11e}
.ed-j-miss{color:#e0524a}
.ed-drum{width:190px;height:190px;border-radius:50%;margin-top:26px;display:flex;align-items:center;justify-content:center;
  font-size:84px;background:var(--bg-elev);box-shadow:inset 0 0 0 6px var(--bg-elev2),0 6px 16px rgba(0,0,0,.25);
  opacity:.55;transition:opacity .2s}
.ed-drum.ed-drum-on{opacity:1;box-shadow:inset 0 0 0 6px var(--accent),0 6px 18px rgba(0,0,0,.3)}
@keyframes ed-pop{0%{transform:scale(1)}35%{transform:scale(.92)}100%{transform:scale(1)}}
.ed-drum.ed-hit{animation:ed-pop .18s ease-out}
.ed-msg{margin-top:22px;font-size:15px;font-weight:900;color:var(--text-dim);text-align:center;min-height:24px;padding:0 12px}
`;
