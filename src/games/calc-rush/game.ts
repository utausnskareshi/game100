// =============================================================
// けいさんラッシュ（No.8）: 60びょうで 4択けいさんを どんどん解くタイムアタック
// =============================================================
// - むずかしさ4段（たしざん/たしひき/九九/ミックス）。1問の基本点は難しいほど高い
// - れんぞく正解でコンボボーナス（+2×min(コンボ-1,5)＝最大+10）。コンボ5以上はフィーバー演出
// - まちがえるとコンボ0・その問題は残る（あてずっぽうの4連打は時間で損する設計。減点はしない）
// - 日替わりでは同じシード＝全員同じ問題列・同じ選択肢配置（乱数は ctx.random のみ）
// - 時間はすべて ctx.now の期限方式（setTimeout 不使用＝ポーズで自動停止）
// - import してよいのは game-api（types / helpers）と、このフォルダ内（problems）だけ
import type { GameContext, IGame } from '../../game-api/types';
import { elem, makeSeg, createCountdown, type Countdown } from '../../game-api/helpers';
import { makeProblem, type PresetKey, type Problem } from './problems';

type Mode = 'setup' | 'count' | 'play' | 'over';

interface Config {
  preset: PresetKey;
}

const DURATION = 60_000; // 1プレイの長さ(ms)
const END_DELAY = 1800; // タイムアップ演出→結果画面までの余韻(ms・ctx.now基準)
const INPUT_LOCK = 120; // 正解直後の誤タップ（二度おし）防止(ms)
const COMBO_STEP = 2; // コンボ1段ごとのボーナス点
const COMBO_CAP = 5; // ボーナスは 2×min(combo-1,5)＝最大+10
const FEVER_FROM = 5; // フィーバー演出が始まるコンボ数
const BONUS_NO_MISS = 50; // まちがい0ボーナス（1問以上正解したときだけ）

// 1問の基本点（同じ60秒でも難しいほど解ける数が少ないぶんの補正・playtest調整前提の仮値）
const BASE_POINTS: Record<PresetKey, number> = { add1: 10, addsub: 12, mult: 15, mix: 20 };

export function createGame(ctx: GameContext): IGame {
  // ---- 設定（前回を復元。はじめての人向けに既定は「たしざん」）----
  const savedCfg = ctx.load<Partial<Config>>('config');
  const config: Config = {
    preset:
      savedCfg?.preset === 'addsub' || savedCfg?.preset === 'mult' || savedCfg?.preset === 'mix'
        ? savedCfg.preset
        : 'add1',
  };

  // ---- 状態 ----
  let mode: Mode = 'setup';
  let hostPaused = false; // ポーズ中の入力ガード（シェルのオーバーレイに加える二重防御）
  let presetKey: PresetKey = config.preset;
  let problem: Problem | null = null;
  let score = 0;
  let combo = 0;
  let answered = 0; // 正解した数
  let misses = 0; // まちがえた数
  let playStart = 0; // プレイ開始時刻（ctx.now 基準）
  let inputLockUntil = 0;
  let endAt = 0;
  let ended = false;
  let lastSec = -1;
  let cd: Countdown | null = null;

  // ---- DOM ----
  const style = document.createElement('style');
  style.textContent = CSS;
  const wrap = elem('div', 'cr-wrap');
  ctx.root.append(style, wrap);

  let playEl: HTMLElement | null = null;
  let timeEl: HTMLElement | null = null;
  let scoreEl: HTMLElement | null = null;
  let stageEl: HTMLElement | null = null;
  let probEl: HTMLElement | null = null;
  let comboEl: HTMLElement | null = null;
  let countEl: HTMLElement | null = null;
  let choiceBtns: HTMLButtonElement[] = [];

  // ---- 設定画面 ----
  function showSetup(): void {
    mode = 'setup';
    const box = elem('div', 'cr-setup');
    box.append(elem('h2', 'cr-h2', 'どのけいさんに ちょうせん？'));
    box.append(
      makeSeg(
        'cr',
        'もんだい',
        [
          { v: 'add1', t: 'たしざん' },
          { v: 'addsub', t: 'たしひき' },
          { v: 'mult', t: '九九' },
          { v: 'mix', t: 'ミックス' },
        ],
        () => config.preset,
        (v) => {
          config.preset = v as PresetKey;
        },
      ),
    );
    box.append(
      elem(
        'p',
        'cr-note',
        '60びょうで なんもん とけるかな？れんぞく正解の コンボで 点数アップ！むずかしい もんだいほど 1問の点数が 高いよ（たしざん→たしひき→九九→ミックス）。',
      ),
    );
    const start = elem('button', 'cr-btn cr-btn-primary cr-btn-lg', 'はじめる ▶') as HTMLButtonElement;
    start.addEventListener('click', () => startMatch());
    box.append(start);
    wrap.replaceChildren(box);
  }

  // ---- 開始（設定→自前3-2-1→プレイ）----
  function startMatch(): void {
    ctx.save('config', { ...config });
    presetKey = config.preset;
    score = 0;
    combo = 0;
    answered = 0;
    misses = 0;
    ended = false;
    endAt = 0;
    problem = null;
    lastSec = -1;
    inputLockUntil = 0;
    buildPlay();
    mode = 'count';
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
        nextProblem();
        paintHud();
      },
    });
    cd.start(ctx.now());
  }

  function buildPlay(): void {
    playEl = elem('div', 'cr-play');

    const hud = elem('div', 'cr-hud');
    timeEl = elem('span', 'cr-hud-item cr-time', '⏱ のこり 60');
    scoreEl = elem('span', 'cr-hud-item', 'スコア 0');
    hud.append(timeEl, scoreEl);

    stageEl = elem('div', 'cr-stage');
    probEl = elem('div', 'cr-prob', 'よーい…');
    comboEl = elem('div', 'cr-combo', '');
    countEl = elem('div', 'cr-count', '');
    stageEl.append(probEl, comboEl, countEl);

    const grid = elem('div', 'cr-choices');
    choiceBtns = [];
    for (let i = 0; i < 4; i++) {
      const idx = i;
      const b = elem('button', 'cr-choice') as HTMLButtonElement;
      b.disabled = true;
      b.addEventListener('click', () => onChoice(idx));
      choiceBtns.push(b);
      grid.append(b);
    }

    playEl.append(hud, stageEl, grid);
    wrap.replaceChildren(playEl);
  }

  // ---- 出題 ----
  function nextProblem(): void {
    problem = makeProblem(presetKey, ctx.random);
    if (probEl) probEl.textContent = `${problem.text} = ?`;
    for (let i = 0; i < 4; i++) {
      const b = choiceBtns[i];
      const v = problem.choices[i];
      if (!b || v === undefined) continue;
      b.textContent = String(v);
      b.disabled = false;
      b.classList.remove('cr-x');
    }
  }

  // ---- 回答 ----
  function onChoice(i: number): void {
    if (mode !== 'play' || hostPaused || !problem) return;
    const now = ctx.now();
    if (now < inputLockUntil) return; // 正解直後の二度おしを無視
    const v = problem.choices[i];
    const btn = choiceBtns[i];
    if (v === undefined || !btn || btn.disabled) return;
    if (v === problem.answer) onCorrect(now);
    else onWrong(btn);
  }

  function onCorrect(now: number): void {
    answered++;
    combo++;
    const gain = BASE_POINTS[presetKey] + COMBO_STEP * Math.min(combo - 1, COMBO_CAP);
    score += gain;
    inputLockUntil = now + INPUT_LOCK;
    ctx.sfx('tap');
    ctx.haptic('light');
    if (combo === FEVER_FROM) ctx.sfx('powerup'); // フィーバー入り
    popup(`+${gain}`);
    if (answered === 10) {
      ctx.achieve('debut-10');
      markModeCleared(); // ぜんモードせいは（10問で「このモードはクリア」扱い）
    }
    if (answered === 30) ctx.achieve('count-30');
    if (combo === 10) ctx.achieve('combo-10');
    if (combo === 20) ctx.achieve('combo-20');
    paintHud();
    nextProblem();
  }

  function onWrong(btn: HTMLButtonElement): void {
    misses++;
    combo = 0;
    btn.disabled = true; // 同じ誤答の二度おしをミスに数えない（問題はそのまま残る）
    btn.classList.add('cr-x');
    ctx.sfx('fail');
    ctx.haptic('error');
    if (probEl) {
      probEl.classList.remove('cr-shake');
      void probEl.offsetWidth; // アニメ再トリガ
      probEl.classList.add('cr-shake');
    }
    paintHud();
  }

  /** ぜんモードせいは（インスタンス跨ぎ。maze / treasure-dig / number-place と同じ ctx.save パターン） */
  function markModeCleared(): void {
    const cleared = ctx.load<Record<string, boolean>>('cleared') ?? {};
    cleared[presetKey] = true;
    ctx.save('cleared', cleared);
    if (cleared.add1 && cleared.addsub && cleared.mult && cleared.mix) ctx.achieve('all-modes');
  }

  // ---- 描画 ----
  function paintHud(): void {
    if (scoreEl) scoreEl.textContent = `スコア ${score}`;
    if (comboEl) {
      comboEl.textContent =
        combo >= 2 ? (combo >= FEVER_FROM ? `🔥 コンボ ×${combo} 🔥` : `コンボ ×${combo}`) : '';
    }
    playEl?.classList.toggle('cr-fever', combo >= FEVER_FROM && mode === 'play');
  }

  function popup(text: string): void {
    if (!stageEl) return;
    const p = elem('span', 'cr-pop', text);
    p.addEventListener('animationend', () => p.remove());
    stageEl.append(p);
  }

  // ---- タイムアップ ----
  function timeUp(now: number): void {
    mode = 'over';
    const noMiss = misses === 0 && answered > 0;
    if (noMiss) score += BONUS_NO_MISS;
    if (misses === 0 && answered >= 15) ctx.achieve('no-miss');
    for (const b of choiceBtns) b.disabled = true;
    paintHud(); // 最終スコア反映・フィーバー解除
    if (timeEl) timeEl.textContent = '⏱ のこり 0';
    const over = elem('div', 'cr-over');
    const lines = [elem('div', 'cr-over-t', '⏰ タイムアップ！'), elem('div', 'cr-over-s', `${answered}問 せいかい`)];
    if (noMiss) lines.push(elem('div', 'cr-over-b', `ノーミス +${BONUS_NO_MISS}`));
    over.append(...lines);
    stageEl?.append(over);
    ctx.sfx('success');
    ctx.haptic('success');
    endAt = now + END_DELAY;
  }

  // ---- 毎フレーム（カウントダウン・残り時間・結果遷移。すべて ctx.now 基準＝ポーズで停止）----
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
          timeEl.classList.toggle('cr-low', sec <= 10);
        }
        if (sec <= 5) ctx.sfx('tick'); // ラストスパートの秒針
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
// スタイル（.cr- プレフィックス。テーマ変数でライト/ダーク両対応）
// =============================================================
const CSS = `
.cr-wrap{position:absolute;inset:0;overflow:hidden}

/* 設定画面（低い画面でもスクロールできる safe center 方式） */
.cr-setup{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:safe center;
  gap:14px;padding:20px 16px;box-sizing:border-box;overflow-y:auto;user-select:none;-webkit-user-select:none}
.cr-h2{margin:4px 0;font-size:22px}
.cr-seg-row{width:min(92vw,420px);display:flex;flex-direction:column;gap:6px}
.cr-seg-label{font-size:13px;color:var(--text-dim);font-weight:800}
.cr-seg{display:flex;background:var(--bg-elev2);border-radius:12px;padding:3px;gap:2px}
.cr-seg-btn{flex:1;border:none;background:none;color:var(--text-dim);padding:10px 2px;border-radius:9px;
  font-size:13px;font-weight:800;min-height:44px}
.cr-seg-btn.cr-on{background:var(--accent);color:#fff}
.cr-note{font-size:12px;color:var(--text-dim);text-align:center;max-width:min(92vw,420px);margin:0;line-height:1.7}
.cr-btn{appearance:none;border:none;border-radius:12px;padding:12px 18px;font-size:15px;font-weight:800;
  background:var(--bg-elev2);color:var(--text);min-height:44px}
.cr-btn-primary{background:var(--accent-grad);color:#fff}
.cr-btn-lg{width:100%;max-width:300px;font-size:18px}

/* プレイ画面 */
.cr-play{position:absolute;inset:0;display:flex;flex-direction:column;padding:6px 10px 12px;box-sizing:border-box;
  user-select:none;-webkit-user-select:none}
/* min-height 54px + 左右64px でポーズ予約領域（右上60×60）を構造的によける */
.cr-hud{display:flex;justify-content:center;align-items:center;gap:16px;padding:2px 64px 4px;flex-wrap:wrap;min-height:54px}
.cr-hud-item{font-size:15px;font-weight:800;white-space:nowrap}
.cr-time.cr-low{color:var(--danger)}
.cr-stage{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;align-items:center;justify-content:center;position:relative}
.cr-prob{font-size:clamp(34px,11vw,52px);font-weight:900;text-align:center;font-variant-numeric:tabular-nums;letter-spacing:.02em}
.cr-combo{margin-top:12px;font-size:16px;font-weight:800;color:var(--accent-2);min-height:22px}
@keyframes cr-shake{0%,100%{transform:translateX(0)}25%{transform:translateX(-8px)}75%{transform:translateX(8px)}}
.cr-prob.cr-shake{animation:cr-shake .25s ease-in-out}
.cr-play.cr-fever .cr-stage{animation:cr-fever 1s ease-in-out infinite;border-radius:16px}
@keyframes cr-fever{0%,100%{background:transparent}50%{background:rgba(124,108,240,.12)}}

/* カウントダウン・得点ポップ・タイムアップ */
.cr-count{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:96px;font-weight:900;
  color:var(--text);pointer-events:none}
.cr-pop{position:absolute;top:18%;left:50%;transform:translateX(-50%);font-size:22px;font-weight:900;color:var(--accent-2);
  pointer-events:none;animation:cr-pop .7s ease-out forwards}
@keyframes cr-pop{from{opacity:1;top:18%}to{opacity:0;top:8%}}
.cr-over{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;
  background:rgba(16,19,48,.86);border-radius:16px;color:#fff;animation:cr-in .2s ease-out;padding:12px}
.cr-over-t{font-size:26px;font-weight:900}
.cr-over-s{font-size:18px;font-weight:800}
.cr-over-b{font-size:15px;font-weight:800;color:#ffd76a}
@keyframes cr-in{from{opacity:0;transform:scale(.94)}to{opacity:1;transform:scale(1)}}

/* 4択（大きなタップ領域・44px基準を大きく超える） */
.cr-choices{display:grid;grid-template-columns:1fr 1fr;gap:10px;padding:8px 2px 0}
.cr-choice{appearance:none;border:none;border-radius:16px;min-height:70px;font-size:28px;font-weight:900;font-family:inherit;
  background:var(--bg-elev2);color:var(--text);font-variant-numeric:tabular-nums}
.cr-choice:active{transform:scale(.97)}
.cr-choice.cr-x{opacity:.35;text-decoration:line-through}
`;
