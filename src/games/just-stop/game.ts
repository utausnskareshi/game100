// =============================================================
// ぴったりストップ（No.16）: 動くマーカーを狙いのゾーンでタップして止める
// =============================================================
// - 全10ラウンド。ラウンドごとにターゲット位置が変わる（rng＝今日のゲームは全員同じ）
// - ズレの小ささで ぴったり/ナイス/おしい/ハズレ。連続成功でコンボボーナス
// - ミスしても即終了しない（0点で次へ）＝子ども向け・突然死なし
// - マーカー位置は ctx.now から算出（logic.markerPos）＝ポーズで自動停止・setTimeout 不使用
// - import してよいのは game-api（types/helpers）と、このフォルダ内（logic）だけ
import type { GameContext, IGame } from '../../game-api/types';
import { elem, makeSeg, createCountdown, type Countdown } from '../../game-api/helpers';
import { makeRounds, markerPos, judge, TIER_POINTS, DIFF_MULT, type PresetKey, type Round, type Tier } from './logic';

type Mode = 'setup' | 'count' | 'play' | 'over';

interface Config {
  diff: PresetKey;
}

const ROUNDS = 10; // 1プレイのラウンド数
const COMBO_STEP = 10; // コンボ1段ごとのボーナス点
const COMBO_CAP = 5; // ボーナスは +10×min(combo-1,5)＝最大+50
const FEEDBACK_MS = 950; // 判定表示→次ラウンドまでの間(ms・ctx.now基準)
const END_DELAY = 1800; // 最終ラウンド後→結果画面までの余韻(ms)
const SCORE_HI = 1200; // 「たかとくてん」実績のしきい値（仮）

const TIER_LABEL: Record<Tier, string> = { perfect: 'ぴったり！', nice: 'ナイス！', ok: 'おしい', miss: 'ハズレ…' };

export function createGame(ctx: GameContext): IGame {
  // ---- 設定（前回を復元。既定は「ふつう」）----
  const saved = ctx.load<Partial<Config>>('config');
  const config: Config = { diff: saved?.diff === 'easy' || saved?.diff === 'hard' ? saved.diff : 'normal' };

  // ---- 状態 ----
  let mode: Mode = 'setup';
  let hostPaused = false; // ポーズ中の入力ガード（シェルのオーバーレイに加える二重防御）
  let preset: PresetKey = config.diff;
  let rounds: Round[] = [];
  let roundIndex = 0;
  let roundStart = 0; // 現ラウンドでマーカーが動き始めた時刻（ctx.now 基準）
  let stopped = false; // 現ラウンドで止めたか
  let advanceAt = 0; // 判定表示→次へ進む時刻
  let score = 0;
  let combo = 0; // 連続「ナイス以上」
  let perfectCount = 0; // このプレイの「ぴったり」数
  let endAt = 0;
  let ended = false;
  let cd: Countdown | null = null;

  // ---- DOM ----
  const style = document.createElement('style');
  style.textContent = CSS;
  const wrap = elem('div', 'js-wrap');
  ctx.root.append(style, wrap);

  let playEl: HTMLElement | null = null;
  let roundEl: HTMLElement | null = null;
  let scoreEl: HTMLElement | null = null;
  let comboEl: HTMLElement | null = null;
  let feedbackEl: HTMLElement | null = null;
  let trackEl: HTMLElement | null = null;
  let markerEl: HTMLElement | null = null;
  let zoneOkEl: HTMLElement | null = null;
  let zoneNiceEl: HTMLElement | null = null;
  let zonePerfectEl: HTMLElement | null = null;
  let targetEl: HTMLElement | null = null;
  let stopBtn: HTMLButtonElement | null = null;
  let countEl: HTMLElement | null = null;

  // ---- 設定画面 ----
  function showSetup(): void {
    mode = 'setup';
    const box = elem('div', 'js-setup');
    box.append(elem('h2', 'js-h2', 'ぴったり 止められるかな？'));
    box.append(
      makeSeg(
        'js',
        'むずかしさ',
        [
          { v: 'easy', t: 'やさしい' },
          { v: 'normal', t: 'ふつう' },
          { v: 'hard', t: 'むずかしい' },
        ],
        () => config.diff,
        (v) => {
          config.diff = v as PresetKey;
        },
      ),
    );
    box.append(
      elem(
        'p',
        'js-note',
        '左右に動くライトを、みどりの「ここ！」ゾーンでタップして止めよう。まん中に近いほど高得点。ぜんぶで10回、れんぞく成功でコンボボーナス！',
      ),
    );
    const start = elem('button', 'js-btn js-btn-primary js-btn-lg', 'はじめる ▶') as HTMLButtonElement;
    start.addEventListener('click', () => startMatch());
    box.append(start);
    wrap.replaceChildren(box);
  }

  // ---- 開始（設定→自前3-2-1→プレイ）----
  function startMatch(): void {
    ctx.save('config', { ...config });
    preset = config.diff;
    rounds = makeRounds(ctx.random, preset, ROUNDS);
    score = 0;
    combo = 0;
    perfectCount = 0;
    roundIndex = 0;
    stopped = false;
    ended = false;
    endAt = 0;
    buildPlay();
    mode = 'count';
    cd = createCountdown({
      onCount: (n) => {
        if (countEl) countEl.textContent = String(n);
        ctx.sfx('tick');
      },
      onGo: () => {
        countEl?.remove();
        countEl = null;
        mode = 'play';
        ctx.sfx('start');
        startRound(0);
      },
    });
    cd.start(ctx.now());
  }

  function buildPlay(): void {
    playEl = elem('div', 'js-play');

    const hud = elem('div', 'js-hud');
    roundEl = elem('span', 'js-hud-item', 'ラウンド 1/10');
    scoreEl = elem('span', 'js-hud-item', 'スコア 0');
    comboEl = elem('span', 'js-hud-item js-combo', '');
    hud.append(roundEl, scoreEl, comboEl);

    const stage = elem('div', 'js-stage');
    feedbackEl = elem('div', 'js-feedback', '');
    trackEl = elem('div', 'js-track');
    zoneOkEl = elem('div', 'js-zone js-zone-ok');
    zoneNiceEl = elem('div', 'js-zone js-zone-nice');
    zonePerfectEl = elem('div', 'js-zone js-zone-perfect');
    targetEl = elem('div', 'js-target', '▼');
    markerEl = elem('div', 'js-marker');
    trackEl.append(zoneOkEl, zoneNiceEl, zonePerfectEl, targetEl, markerEl);
    // バーをタップしても止められる（大きなタップ領域・子ども向け）
    trackEl.addEventListener('click', () => onStop());
    countEl = elem('div', 'js-count', '');
    stage.append(feedbackEl, trackEl, countEl);

    stopBtn = elem('button', 'js-btn js-btn-primary js-stopbtn', 'ストップ！') as HTMLButtonElement;
    stopBtn.disabled = true;
    stopBtn.addEventListener('click', () => onStop());

    playEl.append(hud, stage, stopBtn);
    wrap.replaceChildren(playEl);
  }

  // ---- ラウンド開始 ----
  function startRound(i: number): void {
    const r = rounds[i];
    if (!r) return;
    roundIndex = i;
    stopped = false;
    roundStart = ctx.now();
    placeZones(r);
    if (markerEl) markerEl.style.left = '0%';
    if (feedbackEl) {
      feedbackEl.textContent = '';
      feedbackEl.className = 'js-feedback';
    }
    if (stopBtn) stopBtn.disabled = false;
    paintHud();
  }

  /** ターゲットゾーン（ok/nice/perfect）と「ここ！」マークを配置（%指定＝計測なし） */
  function placeZones(r: Round): void {
    const span = (half: number): { left: string; width: string } => ({
      left: `${Math.max(0, (r.center - half) * 100)}%`,
      width: `${Math.min(100, half * 200)}%`,
    });
    if (zoneOkEl) {
      const s = span(r.okHalf);
      zoneOkEl.style.left = s.left;
      zoneOkEl.style.width = s.width;
    }
    if (zoneNiceEl) {
      const s = span(r.niceHalf);
      zoneNiceEl.style.left = s.left;
      zoneNiceEl.style.width = s.width;
    }
    if (zonePerfectEl) {
      const s = span(r.perfectHalf);
      zonePerfectEl.style.left = s.left;
      zonePerfectEl.style.width = s.width;
    }
    if (targetEl) targetEl.style.left = `${r.center * 100}%`;
  }

  // ---- 止める ----
  function onStop(): void {
    if (mode !== 'play' || hostPaused || stopped) return;
    const r = rounds[roundIndex];
    if (!r) return;
    const now = ctx.now();
    const pos = markerPos(now - roundStart, r.freq);
    stopped = true;
    if (stopBtn) stopBtn.disabled = true;
    if (markerEl) markerEl.style.left = `${pos * 100}%`;

    const tier = judge(pos, r);
    if (tier === 'perfect' || tier === 'nice') combo++;
    else combo = 0;

    let gain = 0;
    if (tier !== 'miss') {
      const bonus = COMBO_STEP * Math.min(Math.max(combo - 1, 0), COMBO_CAP);
      gain = Math.round((TIER_POINTS[tier] + bonus) * DIFF_MULT[preset]);
    }
    score += gain;
    if (score >= SCORE_HI) ctx.achieve('score-hi'); // 到達した瞬間に解除（中断しても取りこぼさない）

    if (tier === 'perfect') {
      perfectCount++;
      ctx.achieve('first-pittari');
      if (perfectCount === 5) ctx.achieve('pittari-5');
    }
    if ((tier === 'perfect' || tier === 'nice') && combo === 5) ctx.achieve('combo-5');

    showFeedback(tier, gain);
    feedbackSfx(tier);
    advanceAt = now + FEEDBACK_MS;
    paintHud();
  }

  function showFeedback(tier: Tier, gain: number): void {
    if (!feedbackEl) return;
    feedbackEl.className = `js-feedback js-fb-${tier}`;
    feedbackEl.textContent = gain > 0 ? `${TIER_LABEL[tier]} +${gain}` : TIER_LABEL[tier];
  }

  function feedbackSfx(tier: Tier): void {
    if (tier === 'perfect') {
      ctx.sfx('combo');
      ctx.haptic('success');
    } else if (tier === 'nice') {
      ctx.sfx('success');
      ctx.haptic('medium');
    } else if (tier === 'ok') {
      ctx.sfx('tap');
      ctx.haptic('light');
    } else {
      ctx.sfx('fail');
      ctx.haptic('error');
    }
  }

  // ---- 描画（HUD）----
  function paintHud(): void {
    if (roundEl) roundEl.textContent = `ラウンド ${Math.min(roundIndex + 1, ROUNDS)}/${ROUNDS}`;
    if (scoreEl) scoreEl.textContent = `スコア ${score}`;
    if (comboEl) comboEl.textContent = combo >= 2 ? `🔥 コンボ ×${combo}` : '';
  }

  // ---- 終了 ----
  function finish(now: number): void {
    mode = 'over';
    if (stopBtn) stopBtn.disabled = true;
    if (preset === 'hard') ctx.achieve('hard-clear');
    if (perfectCount === ROUNDS) ctx.achieve('perfect');
    // score-hi は onStop の加算直後に live 判定済み（score はそこでしか増えない）
    if (feedbackEl) {
      feedbackEl.className = 'js-feedback';
      feedbackEl.textContent = '';
    }
    const over = elem('div', 'js-over');
    over.append(
      elem('div', 'js-over-t', '🎉 おしまい！'),
      elem('div', 'js-over-s', `スコア ${score}`),
      elem('div', 'js-over-b', `ぴったり ${perfectCount}/${ROUNDS}`),
    );
    (trackEl?.parentElement ?? playEl)?.append(over);
    ctx.sfx('success');
    ctx.haptic('success');
    endAt = now + END_DELAY;
  }

  // ---- 毎フレーム（マーカー移動・ラウンド進行・結果遷移。すべて ctx.now 基準＝ポーズで停止）----
  const offFrame = ctx.onFrame(() => {
    const now = ctx.now();
    if (mode === 'count') {
      cd?.tick(now);
      return;
    }
    if (mode === 'play') {
      const r = rounds[roundIndex];
      if (r && !stopped && markerEl) {
        markerEl.style.left = `${markerPos(now - roundStart, r.freq) * 100}%`;
      }
      if (stopped && now >= advanceAt) {
        if (roundIndex + 1 < ROUNDS) startRound(roundIndex + 1);
        else finish(now);
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
      // 位置はすべて % 指定＝計測なし。何もしなくてよい
    },
    destroy() {
      offFrame();
      style.remove();
      wrap.remove();
    },
  };
}

// =============================================================
// スタイル（.js- プレフィックス。テーマ変数でライト/ダーク両対応）
// =============================================================
const CSS = `
.js-wrap{position:absolute;inset:0;overflow:hidden}

/* 設定画面（低い画面でもスクロールできる safe center 方式） */
.js-setup{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:safe center;
  gap:14px;padding:20px 16px;box-sizing:border-box;overflow-y:auto;user-select:none;-webkit-user-select:none}
.js-h2{margin:4px 0;font-size:22px;text-align:center}
.js-seg-row{width:min(92vw,420px);display:flex;flex-direction:column;gap:6px}
.js-seg-label{font-size:13px;color:var(--text-dim);font-weight:800}
.js-seg{display:flex;background:var(--bg-elev2);border-radius:12px;padding:3px;gap:2px}
.js-seg-btn{flex:1;border:none;background:none;color:var(--text-dim);padding:10px 2px;border-radius:9px;
  font-size:14px;font-weight:800;min-height:44px}
.js-seg-btn.js-on{background:var(--accent);color:#fff}
.js-note{font-size:12px;color:var(--text-dim);text-align:center;max-width:min(92vw,420px);margin:0;line-height:1.7}
.js-btn{appearance:none;border:none;border-radius:12px;padding:12px 18px;font-size:15px;font-weight:800;font-family:inherit;
  background:var(--bg-elev2);color:var(--text);min-height:44px}
.js-btn-primary{background:var(--accent-grad);color:#fff}
.js-btn-lg{width:100%;max-width:300px;font-size:18px}

/* プレイ画面 */
.js-play{position:absolute;inset:0;display:flex;flex-direction:column;padding:6px 10px 14px;box-sizing:border-box;
  user-select:none;-webkit-user-select:none}
/* min-height 54px + 左右64px でポーズ予約領域（右上60×60）を構造的によける */
.js-hud{display:flex;justify-content:center;align-items:center;gap:16px;padding:2px 64px 4px;flex-wrap:wrap;min-height:54px}
.js-hud-item{font-size:15px;font-weight:800;white-space:nowrap}
.js-combo{color:var(--accent-2)}
.js-stage{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;align-items:center;justify-content:center;
  gap:20px;position:relative}
.js-feedback{font-size:clamp(26px,8vw,40px);font-weight:900;min-height:1.2em;text-align:center;letter-spacing:.02em}
.js-fb-perfect{color:#ffcf3f}
.js-fb-nice{color:var(--accent-2)}
.js-fb-ok{color:var(--text-dim)}
.js-fb-miss{color:var(--danger)}

/* バー（トラック）とゾーン・マーカー */
.js-track{position:relative;width:min(92vw,460px);height:56px;background:var(--bg-elev2);border-radius:12px;
  overflow:visible;box-shadow:inset 0 0 0 2px rgba(127,127,160,.18)}
.js-zone{position:absolute;top:0;bottom:0;border-radius:6px}
.js-zone-ok{background:rgba(124,108,240,.14)}
.js-zone-nice{background:rgba(52,199,120,.34)}
.js-zone-perfect{background:rgba(255,207,63,.85);box-shadow:0 0 10px rgba(255,207,63,.6)}
.js-target{position:absolute;top:-22px;transform:translateX(-50%);font-size:18px;color:#ffcf3f;pointer-events:none}
.js-marker{position:absolute;top:-7px;bottom:-7px;left:0;width:7px;transform:translateX(-50%);border-radius:4px;
  background:var(--text);box-shadow:0 0 8px rgba(0,0,0,.35);will-change:left}

/* ストップボタン（特大タップ領域） */
.js-stopbtn{width:100%;max-width:420px;align-self:center;min-height:92px;font-size:30px;border-radius:20px;margin-top:6px}
.js-stopbtn:disabled{opacity:.4}
.js-stopbtn:active{transform:scale(.98)}

/* カウントダウン・結果 */
.js-count{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:96px;font-weight:900;
  color:var(--text);pointer-events:none}
.js-over{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;
  background:rgba(16,19,48,.86);border-radius:16px;color:#fff;animation:js-in .2s ease-out;padding:12px}
.js-over-t{font-size:26px;font-weight:900}
.js-over-s{font-size:20px;font-weight:800}
.js-over-b{font-size:15px;font-weight:800;color:#ffd76a}
@keyframes js-in{from{opacity:0;transform:scale(.94)}to{opacity:1;transform:scale(1)}}
`;
