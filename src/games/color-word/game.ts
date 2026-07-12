// =============================================================
// いろよみチャレンジ（No.26）: もじの「いろ」と「ことば」の混乱に勝つ60秒タイムアタック
// =============================================================
// - ストループ効果: 「あお」という字が赤インクで出る。指示（いろ／ことば）に合うほうをタップ。
// - むずかしさ3段: いろだけ（指示固定）／はんてん（指示が時々切り替わる）／
//   タイマー（切り替え多め＋1問3秒の制限時間つき・時間切れはミス）。
// - れんぞく正解でコンボボーナス（+2×min(コンボ-1,5)＝最大+10）。まちがいは減点なし・コンボ0。
// - 問題の文字は固定ダーク地のカードに表示（きいろ等をライトテーマでも読めるようにするため）。
// - 日替わりは同じシード＝全員同じ問題列（乱数は ctx.random のみ・1問4消費で列が安定）。
// - 時間はすべて ctx.now の期限方式（setTimeout 不使用＝ポーズで自動停止）。
// - import してよいのは game-api（types / helpers）と、このフォルダ内（problems）だけ
import type { GameContext, IGame } from '../../game-api/types';
import { elem, makeSeg, createCountdown, type Countdown } from '../../game-api/helpers';
import {
  COLORS,
  BASE_POINTS,
  HARD_Q_TIME,
  initialAskState,
  nextQuestion,
  answerOf,
  type AskState,
  type ModeKey,
  type Question,
} from './problems';

type Mode = 'setup' | 'count' | 'play' | 'over';

interface Config {
  mode: ModeKey;
}

const DURATION = 60_000; // 1プレイの長さ(ms)
const END_DELAY = 1800; // タイムアップ演出→結果画面までの余韻(ms)
const INPUT_LOCK = 120; // 正解直後の誤タップ（二度おし）防止(ms)
const COMBO_STEP = 2;
const COMBO_CAP = 5; // ボーナスは 2×min(combo-1,5)＝最大+10
const FEVER_FROM = 5;
const BONUS_NO_MISS = 50; // まちがい0ボーナス（1問以上正解したときだけ）
const SCORE_HI = 800; // 「いろよみチャンピオン」実績のしきい値（仮）

export function createGame(ctx: GameContext): IGame {
  // ---- 設定（前回を復元。既定は「いろだけ」）----
  const savedCfg = ctx.load<Partial<Config>>('config');
  const config: Config = {
    mode: savedCfg?.mode === 'normal' || savedCfg?.mode === 'hard' ? savedCfg.mode : 'easy',
  };

  // ---- 状態 ----
  let mode: Mode = 'setup';
  let hostPaused = false;
  let modeKey: ModeKey = config.mode;
  let ask: AskState = initialAskState();
  let q: Question | null = null;
  let qDeadline = 0; // むずかしいモードの1問期限（ctx.now 基準）
  let score = 0;
  let combo = 0;
  let answered = 0;
  let misses = 0;
  let switchHits = 0; // 指示切り替え直後の問題に正解した数（きりかえめいじん）
  let playStart = 0;
  let inputLockUntil = 0;
  let endAt = 0;
  let ended = false;
  let lastSec = -1;
  let cd: Countdown | null = null;

  // ---- DOM ----
  const style = document.createElement('style');
  style.textContent = CSS;
  const wrap = elem('div', 'cw-wrap');
  ctx.root.append(style, wrap);

  let playEl: HTMLElement | null = null;
  let timeEl: HTMLElement | null = null;
  let scoreEl: HTMLElement | null = null;
  let askEl: HTMLElement | null = null;
  let stageEl: HTMLElement | null = null;
  let cardEl: HTMLElement | null = null;
  let wordEl: HTMLElement | null = null;
  let qBarEl: HTMLElement | null = null;
  let qBarFill: HTMLElement | null = null;
  let comboEl: HTMLElement | null = null;
  let countEl: HTMLElement | null = null;
  let choiceBtns: HTMLButtonElement[] = [];

  function devState(): void {
    if (!import.meta.env.DEV) return;
    wrap.dataset.st = mode;
    wrap.dataset.score = String(score);
    wrap.dataset.combo = String(combo);
    wrap.dataset.ans = String(answered);
    wrap.dataset.miss = String(misses);
    wrap.dataset.ask = ask.ask;
  }

  // ---- 設定画面 ----
  function showSetup(): void {
    mode = 'setup';
    devState();
    const box = elem('div', 'cw-setup');
    box.append(elem('h2', 'cw-h2', 'もじに だまされるな！'));
    box.append(
      makeSeg(
        'cw',
        'むずかしさ',
        [
          { v: 'easy', t: 'いろだけ' },
          { v: 'normal', t: 'はんてん' },
          { v: 'hard', t: 'タイマー' },
        ],
        () => config.mode,
        (v) => {
          config.mode = v as ModeKey;
        },
      ),
    );
    box.append(
      elem(
        'p',
        'cw-note',
        '「あお」と書いてあるのに いろは あか!? 指示どおり【いろ】か【ことば】をタップしよう。「はんてん」は とちゅうで指示が切りかわる。「タイマー」は さらに1問3びょうまで！',
      ),
    );
    const start = elem('button', 'cw-btn cw-btn-primary cw-btn-lg', 'はじめる ▶') as HTMLButtonElement;
    start.addEventListener('click', () => startMatch());
    box.append(start);
    wrap.replaceChildren(box);
  }

  // ---- 開始（設定→自前3-2-1→プレイ）----
  function startMatch(): void {
    ctx.save('config', { ...config });
    modeKey = config.mode;
    ask = initialAskState();
    q = null;
    score = 0;
    combo = 0;
    answered = 0;
    misses = 0;
    switchHits = 0;
    ended = false;
    endAt = 0;
    lastSec = -1;
    inputLockUntil = 0;
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
        mode = 'play';
        playStart = now;
        ctx.sfx('start');
        nextProblem(now);
        paintHud();
      },
    });
    cd.start(ctx.now());
  }

  function buildPlay(): void {
    playEl = elem('div', 'cw-play');

    const hud = elem('div', 'cw-hud');
    timeEl = elem('span', 'cw-hud-item cw-time', '⏱ のこり 60');
    scoreEl = elem('span', 'cw-hud-item', 'スコア 0');
    hud.append(timeEl, scoreEl);

    askEl = elem('div', 'cw-ask', '');

    stageEl = elem('div', 'cw-stage');
    cardEl = elem('div', 'cw-card');
    wordEl = elem('div', 'cw-word', 'よーい…');
    qBarEl = elem('div', 'cw-qbar');
    qBarFill = elem('div', 'cw-qbar-fill');
    qBarEl.append(qBarFill);
    cardEl.append(wordEl, qBarEl);
    comboEl = elem('div', 'cw-combo', '');
    countEl = elem('div', 'cw-count', '');
    stageEl.append(cardEl, comboEl, countEl);

    const grid = elem('div', 'cw-choices');
    choiceBtns = [];
    for (let i = 0; i < 4; i++) {
      const idx = i;
      const c = COLORS[i]!;
      const b = elem('button', 'cw-choice') as HTMLButtonElement;
      b.append(elem('span', 'cw-dot'), elem('span', 'cw-choice-label', c.label));
      (b.firstElementChild as HTMLElement).style.background = c.css;
      b.disabled = true;
      b.addEventListener('click', () => onChoice(idx));
      choiceBtns.push(b);
      grid.append(b);
    }

    playEl.append(hud, askEl, stageEl, grid);
    wrap.replaceChildren(playEl);
    paintAsk(false);
  }

  // ---- 出題 ----
  function nextProblem(now: number): void {
    q = nextQuestion(ctx.random, modeKey, ask);
    qDeadline = modeKey === 'hard' ? now + HARD_Q_TIME : Infinity;
    if (wordEl && cardEl) {
      const c = COLORS[q.ink]!;
      wordEl.textContent = COLORS[q.word]!.label;
      wordEl.style.color = c.css;
      cardEl.classList.remove('cw-pulse');
      void cardEl.offsetWidth; // アニメ再トリガ
      cardEl.classList.add('cw-pulse');
    }
    if (qBarEl) qBarEl.style.display = modeKey === 'hard' ? '' : 'none';
    for (const b of choiceBtns) {
      b.disabled = false;
      b.classList.remove('cw-x');
    }
    if (q.switched) {
      paintAsk(true);
      ctx.sfx('powerup');
      ctx.haptic('medium');
    }
    devState();
  }

  function paintAsk(flash: boolean): void {
    if (!askEl) return;
    const color = ask.ask === 'color';
    askEl.textContent = color ? '👆 もじの【いろ】をタップ！' : '👆 かいてある【ことば】をタップ！';
    askEl.classList.toggle('cw-ask-word', !color);
    if (flash) {
      askEl.classList.remove('cw-ask-flash');
      void askEl.offsetWidth;
      askEl.classList.add('cw-ask-flash');
    }
  }

  // ---- 回答 ----
  function onChoice(i: number): void {
    if (mode !== 'play' || hostPaused || !q) return;
    const now = ctx.now();
    if (now < inputLockUntil) return;
    const btn = choiceBtns[i];
    if (!btn || btn.disabled) return;
    if (i === answerOf(q)) onCorrect(now);
    else onWrong(btn);
  }

  function onCorrect(now: number): void {
    answered++;
    combo++;
    const gain = BASE_POINTS[modeKey] + COMBO_STEP * Math.min(combo - 1, COMBO_CAP);
    score += gain;
    inputLockUntil = now + INPUT_LOCK;
    ctx.sfx('tap');
    ctx.haptic('light');
    if (combo === FEVER_FROM) ctx.sfx('powerup');
    popup(`+${gain}`);
    if (q?.switched) {
      switchHits++;
      if (switchHits === 10) ctx.achieve('flip-master');
    }
    if (answered === 10) ctx.achieve('debut-10');
    if (combo === 10) ctx.achieve('combo-10');
    if (modeKey === 'hard' && answered === 15) ctx.achieve('hard-15');
    if (score >= SCORE_HI) ctx.achieve('score-hi');
    paintHud();
    nextProblem(now);
  }

  function onWrong(btn: HTMLButtonElement): void {
    misses++;
    combo = 0;
    btn.disabled = true; // 同じ誤答の二度おしをミスに数えない（問題は残る）
    btn.classList.add('cw-x');
    ctx.sfx('fail');
    ctx.haptic('error');
    shakeCard();
    paintHud();
    devState();
  }

  /** むずかしいモードの時間切れ＝ミス扱いで次の問題へ（残ると詰むため進める） */
  function onTimeout(now: number): void {
    misses++;
    combo = 0;
    ctx.sfx('fail');
    ctx.haptic('error');
    shakeCard();
    popup('じかんぎれ…');
    paintHud();
    nextProblem(now);
  }

  function shakeCard(): void {
    if (!cardEl) return;
    cardEl.classList.remove('cw-shake');
    void cardEl.offsetWidth;
    cardEl.classList.add('cw-shake');
  }

  // ---- 描画 ----
  function paintHud(): void {
    if (scoreEl) scoreEl.textContent = `スコア ${score}`;
    if (comboEl) {
      comboEl.textContent = combo >= 2 ? (combo >= FEVER_FROM ? `🔥 コンボ ×${combo} 🔥` : `コンボ ×${combo}`) : '';
    }
    playEl?.classList.toggle('cw-fever', combo >= FEVER_FROM && mode === 'play');
    devState();
  }

  function popup(text: string): void {
    if (!stageEl) return;
    const p = elem('span', 'cw-pop', text);
    p.addEventListener('animationend', () => p.remove());
    stageEl.append(p);
  }

  // ---- タイムアップ ----
  function timeUp(now: number): void {
    mode = 'over';
    const noMiss = misses === 0 && answered > 0;
    if (noMiss) score += BONUS_NO_MISS;
    if (score >= SCORE_HI) ctx.achieve('score-hi');
    if (misses === 0 && answered >= 15) ctx.achieve('no-miss');
    for (const b of choiceBtns) b.disabled = true;
    paintHud();
    if (timeEl) timeEl.textContent = '⏱ のこり 0';
    const over = elem('div', 'cw-over');
    const lines = [elem('div', 'cw-over-t', '⏰ タイムアップ！'), elem('div', 'cw-over-s', `${answered}問 せいかい`)];
    if (noMiss) lines.push(elem('div', 'cw-over-b', `ノーミス +${BONUS_NO_MISS}`));
    over.append(...lines);
    stageEl?.append(over);
    ctx.sfx('success');
    ctx.haptic('success');
    endAt = now + END_DELAY;
    devState();
  }

  // ---- 毎フレーム（カウントダウン・残り時間・1問タイマー・結果遷移）----
  const offFrame = ctx.onFrame(() => {
    const now = ctx.now();
    if (mode === 'count') {
      cd?.tick(now);
      return;
    }
    if (mode === 'play') {
      const left = DURATION - (now - playStart);
      if (left <= 0) {
        timeUp(now);
        return;
      }
      const sec = Math.ceil(left / 1000);
      if (sec !== lastSec) {
        lastSec = sec;
        if (timeEl) {
          timeEl.textContent = `⏱ のこり ${sec}`;
          timeEl.classList.toggle('cw-low', sec <= 10);
        }
        if (sec <= 5) ctx.sfx('tick');
      }
      if (modeKey === 'hard' && q) {
        const qLeft = qDeadline - now;
        if (qLeft <= 0) {
          onTimeout(now);
        } else if (qBarFill) {
          qBarFill.style.width = `${Math.max(0, Math.min(100, (qLeft / HARD_Q_TIME) * 100))}%`;
          qBarFill.classList.toggle('cw-qbar-low', qLeft <= 1000);
        }
      }
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
      // flexレイアウトのみで計測なし＝何もしなくてよい
    },
    destroy() {
      offFrame();
      style.remove();
      wrap.remove();
    },
  };
}

// =============================================================
// スタイル（.cw- プレフィックス。問題カードは固定ダーク地＝きいろ文字も両テーマで読める）
// =============================================================
const CSS = `
.cw-wrap{position:absolute;inset:0;overflow:hidden}

/* 設定画面 */
.cw-setup{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:safe center;
  gap:14px;padding:20px 16px;box-sizing:border-box;overflow-y:auto;user-select:none;-webkit-user-select:none}
.cw-h2{margin:4px 0;font-size:22px}
.cw-seg-row{width:min(92vw,420px);display:flex;flex-direction:column;gap:6px}
.cw-seg-label{font-size:13px;color:var(--text-dim);font-weight:800}
.cw-seg{display:flex;background:var(--bg-elev2);border-radius:12px;padding:3px;gap:2px}
.cw-seg-btn{flex:1;border:none;background:none;color:var(--text-dim);padding:10px 2px;border-radius:9px;
  font-size:13px;font-weight:800;min-height:44px}
.cw-seg-btn.cw-on{background:var(--accent);color:#fff}
.cw-note{font-size:12px;color:var(--text-dim);text-align:center;max-width:min(92vw,420px);margin:0;line-height:1.7}
.cw-btn{appearance:none;border:none;border-radius:12px;padding:12px 18px;font-size:15px;font-weight:800;font-family:inherit;
  background:var(--bg-elev2);color:var(--text);min-height:44px}
.cw-btn-primary{background:var(--accent-grad);color:#fff}
.cw-btn-lg{width:100%;max-width:300px;font-size:18px}

/* プレイ画面 */
.cw-play{position:absolute;inset:0;display:flex;flex-direction:column;padding:6px 10px 12px;box-sizing:border-box;
  user-select:none;-webkit-user-select:none}
.cw-hud{display:flex;justify-content:center;align-items:center;gap:16px;padding:2px 64px 4px;flex-wrap:wrap;min-height:54px}
.cw-hud-item{font-size:15px;font-weight:800;white-space:nowrap}
.cw-time.cw-low{color:var(--danger)}

/* 指示バナー（いろ=紫系 / ことば=だいだい系。切り替え時はフラッシュ） */
.cw-ask{margin:0 2px;padding:10px 8px;border-radius:14px;text-align:center;font-size:17px;font-weight:900;
  background:var(--accent);color:#fff}
.cw-ask-word{background:#e8811c}
@keyframes cw-ask-flash{0%,100%{transform:scale(1)}25%{transform:scale(1.06)}50%{transform:scale(1)}75%{transform:scale(1.05)}}
.cw-ask-flash{animation:cw-ask-flash .5s ease-in-out}

.cw-stage{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;align-items:center;justify-content:center;position:relative;gap:10px}
/* 問題カード＝固定ダーク（きいろ/みどりの文字色をライトテーマでも読めるように） */
.cw-card{width:min(88vw,360px);border-radius:20px;background:#171a2e;box-shadow:0 4px 18px rgba(0,0,0,.25);
  display:flex;flex-direction:column;align-items:center;justify-content:center;padding:26px 12px 18px;gap:14px;position:relative}
.cw-word{font-size:clamp(44px,15vw,64px);font-weight:900;letter-spacing:.06em;line-height:1}
@keyframes cw-pulse{from{transform:scale(.92)}to{transform:scale(1)}}
.cw-card.cw-pulse .cw-word{animation:cw-pulse .14s ease-out}
@keyframes cw-shake{0%,100%{transform:translateX(0)}25%{transform:translateX(-9px)}75%{transform:translateX(9px)}}
.cw-card.cw-shake{animation:cw-shake .25s ease-in-out}
.cw-qbar{width:82%;height:8px;border-radius:4px;background:rgba(255,255,255,.16);overflow:hidden}
.cw-qbar-fill{height:100%;width:100%;border-radius:4px;background:#7ec6ff;transition:width .1s linear}
.cw-qbar-fill.cw-qbar-low{background:#ff7a7a}
.cw-combo{font-size:16px;font-weight:800;color:var(--accent-2);min-height:22px}
.cw-play.cw-fever .cw-stage{animation:cw-fever 1s ease-in-out infinite;border-radius:16px}
@keyframes cw-fever{0%,100%{background:transparent}50%{background:rgba(124,108,240,.12)}}

/* カウントダウン・ポップ・タイムアップ */
.cw-count{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:96px;font-weight:900;
  color:var(--text);pointer-events:none}
.cw-pop{position:absolute;top:12%;left:50%;transform:translateX(-50%);font-size:22px;font-weight:900;color:var(--accent-2);
  pointer-events:none;animation:cw-pop .7s ease-out forwards;white-space:nowrap}
@keyframes cw-pop{from{opacity:1;top:12%}to{opacity:0;top:3%}}
.cw-over{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;
  background:rgba(16,19,48,.86);border-radius:16px;color:#fff;animation:cw-in .2s ease-out;padding:12px}
.cw-over-t{font-size:26px;font-weight:900}
.cw-over-s{font-size:18px;font-weight:800}
.cw-over-b{font-size:15px;font-weight:800;color:#ffd76a}
@keyframes cw-in{from{opacity:0;transform:scale(.94)}to{opacity:1;transform:scale(1)}}

/* 4択（色まる＋ことば。文字はテーマ色＝ニュートラル） */
.cw-choices{display:grid;grid-template-columns:1fr 1fr;gap:10px;padding:8px 2px 0}
.cw-choice{appearance:none;border:none;border-radius:16px;min-height:64px;font-size:20px;font-weight:900;font-family:inherit;
  background:var(--bg-elev2);color:var(--text);display:flex;align-items:center;justify-content:center;gap:10px}
.cw-choice:active{transform:scale(.97)}
.cw-choice.cw-x{opacity:.35}
.cw-dot{width:22px;height:22px;border-radius:50%;flex-shrink:0;box-shadow:inset 0 0 0 2px rgba(0,0,0,.18)}
`;
