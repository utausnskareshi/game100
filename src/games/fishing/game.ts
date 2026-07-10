// =============================================================
// のんびりさかなつり（No.17）: ウキが沈く一瞬にタップして釣り上げるチル系
// =============================================================
// - 「つる」で糸を投げ、ランダムな待ち時間のあと「！」（アタリ窓）が出る。
//   窓のあいだに「あわせる」で釣り上げ成功。早すぎ＝すっぽ抜け／窓を逃す＝バラシ。
// - 全8キャスト。失敗しても減点なし（チル）。魚は図鑑に集まる（ctx.save 跨ぎ保存）。
// - 待ち時間・アタリ窓・魚の抽選は fish.ts の純ロジック（rng 注入＝今日のゲームは全員同じ）。
// - 時間はすべて ctx.now の期限方式（setTimeout 不使用＝ポーズで自動停止）。
// - import してよいのは game-api（types/helpers）と、このフォルダ内（fish）だけ
import type { GameContext, IGame } from '../../game-api/types';
import { elem, makeSeg } from '../../game-api/helpers';
import { SPOTS, ALL_FISH_IDS, pickFish, biteDelay, biteWindow, type SpotKey, type Fish } from './fish';

type Mode = 'setup' | 'idle' | 'sink' | 'bite' | 'result' | 'over';

interface Config {
  spot: SpotKey;
}

const CASTS = 8; // 1プレイのキャスト数
const RESULT_MS = 1000; // 釣果・失敗の表示時間(ms)
const END_DELAY = 1600; // 最終キャスト後→結果画面までの余韻(ms)
const JUST_BONUS = 30; // ジャストフッキングのボーナス点
const JUST_FRAC = 0.35; // アタリ窓の最初 35% 以内なら「ジャスト」
const MANY = 6; // 「たくさんつり」実績（1プレイで釣った数）

export function createGame(ctx: GameContext): IGame {
  // ---- 設定（前回のつりばを復元。既定は「かわ」）----
  const saved = ctx.load<Partial<Config>>('config');
  const config: Config = { spot: saved?.spot === 'pond' || saved?.spot === 'sea' ? saved.spot : 'river' };

  // ---- 図鑑（インスタンス跨ぎ・全つりば横断）----
  const zukan = new Set<string>(ctx.load<string[]>('zukan') ?? []);

  // ---- 状態 ----
  let mode: Mode = 'setup';
  let hostPaused = false;
  let spot: SpotKey = config.spot;
  let castIndex = 0;
  let score = 0;
  let caught = 0;
  let biteAt = 0; // アタリが出る時刻
  let biteStart = 0; // アタリ窓が開いた時刻
  let biteWindowMs = 0; // 今回のアタリ窓の長さ
  let biteUntil = 0; // アタリ窓が閉じる時刻
  let pendingFish: Fish | null = null; // アタリ中に確定している魚
  let resultUntil = 0;
  let endAt = 0;
  let ended = false;

  // ---- DOM ----
  const style = document.createElement('style');
  style.textContent = CSS;
  const wrap = elem('div', 'fs-wrap');
  ctx.root.append(style, wrap);

  let castEl: HTMLElement | null = null;
  let scoreEl: HTMLElement | null = null;
  let caughtEl: HTMLElement | null = null;
  let sceneEl: HTMLElement | null = null;
  let msgEl: HTMLElement | null = null;
  let floatEl: HTMLElement | null = null;
  let bangEl: HTMLElement | null = null;
  let zukanEl: HTMLElement | null = null;
  let actionBtn: HTMLButtonElement | null = null;

  function setMode(m: Mode): void {
    mode = m;
    if (import.meta.env.DEV) wrap.dataset.st = m; // 検証用の状態公開（開発ビルド限定）
    if (actionBtn) {
      actionBtn.textContent =
        m === 'idle' ? 'つる 🎣' : m === 'sink' ? 'まって…' : m === 'bite' ? 'あわせる！' : '…';
      actionBtn.classList.toggle('fs-action-bite', m === 'bite');
    }
  }

  // ---- 設定画面 ----
  function showSetup(): void {
    mode = 'setup';
    if (import.meta.env.DEV) wrap.dataset.st = 'setup';
    const box = elem('div', 'fs-setup');
    box.append(elem('h2', 'fs-h2', 'どこで つる？'));
    box.append(
      makeSeg(
        'fs',
        'つりば',
        [
          { v: 'river', t: 'かわ' },
          { v: 'pond', t: 'いけ' },
          { v: 'sea', t: 'うみ' },
        ],
        () => config.spot,
        (v) => {
          config.spot = v as SpotKey;
        },
      ),
    );
    box.append(elem('p', 'fs-note', 'ウキが しずんで「！」が出た しゅんかんに「あわせる」でタップ！早すぎ・おそすぎは にがすよ。ぜんぶで8かい。'));
    box.append(elem('p', 'fs-zukan-line', `📖 ずかん ${zukan.size}/${ALL_FISH_IDS.length}`));
    const start = elem('button', 'fs-btn fs-btn-primary fs-btn-lg', 'はじめる ▶') as HTMLButtonElement;
    start.addEventListener('click', () => startMatch());
    box.append(start);
    wrap.replaceChildren(box);
  }

  // ---- 開始 ----
  function startMatch(): void {
    ctx.save('config', { ...config });
    spot = config.spot;
    castIndex = 0;
    score = 0;
    caught = 0;
    ended = false;
    pendingFish = null;
    buildPlay();
    setMode('idle');
    paintHud();
  }

  function buildPlay(): void {
    const play = elem('div', 'fs-play');

    const hud = elem('div', 'fs-hud');
    castEl = elem('span', 'fs-hud-item', 'キャスト 1/8');
    scoreEl = elem('span', 'fs-hud-item', 'スコア 0');
    caughtEl = elem('span', 'fs-hud-item', 'つれた 0');
    hud.append(castEl, scoreEl, caughtEl);

    sceneEl = elem('div', 'fs-scene');
    floatEl = elem('div', 'fs-float', '🔴');
    bangEl = elem('div', 'fs-bang', '！');
    msgEl = elem('div', 'fs-msg', `${SPOTS[spot].label}で つりを たのしもう`);
    sceneEl.append(floatEl, bangEl, msgEl);

    actionBtn = elem('button', 'fs-btn fs-btn-primary fs-action', 'つる 🎣') as HTMLButtonElement;
    actionBtn.addEventListener('click', () => onAction());

    zukanEl = elem('div', 'fs-zukan', `📖 ずかん ${zukan.size}/${ALL_FISH_IDS.length}`);

    play.append(hud, sceneEl, actionBtn, zukanEl);
    wrap.replaceChildren(play);
    updateFloat();
  }

  // ---- 操作（つる／あわせる）----
  function onAction(): void {
    if (hostPaused) return;
    const now = ctx.now();
    if (mode === 'idle') cast(now);
    else if (mode === 'sink') tooEarly(now); // アタリ前にあわせた＝すっぽ抜け
    else if (mode === 'bite') hook(now); // 成功
  }

  function cast(now: number): void {
    setMode('sink');
    biteAt = now + biteDelay(ctx.random);
    pendingFish = null;
    if (msgEl) {
      msgEl.className = 'fs-msg';
      msgEl.textContent = 'ウキを 見て…';
    }
    updateFloat();
    ctx.sfx('tap');
    ctx.haptic('light');
  }

  function toBite(now: number): void {
    setMode('bite');
    biteStart = now;
    biteWindowMs = biteWindow(ctx.random);
    biteUntil = now + biteWindowMs;
    pendingFish = pickFish(ctx.random, spot);
    if (msgEl) {
      msgEl.className = 'fs-msg fs-msg-bite';
      msgEl.textContent = 'いまだ！';
    }
    updateFloat();
    ctx.sfx('tick');
    ctx.haptic('medium');
  }

  function hook(now: number): void {
    const fish = pendingFish;
    if (!fish) return;
    const just = now - biteStart <= biteWindowMs * JUST_FRAC;
    const gain = fish.points + (just ? JUST_BONUS : 0);
    score += gain;
    caught++;
    const isNew = !zukan.has(fish.id);
    addToZukan(fish.id);

    ctx.achieve('first-catch');
    if (fish.big) ctx.achieve('big-fish');
    if (fish.rare) ctx.achieve('rare-fish');
    if (just) ctx.achieve('just-hook');
    if (caught >= MANY) ctx.achieve('many-fish');

    showCatch(fish, gain, just, isNew);
    ctx.sfx(fish.rare ? 'combo' : 'success');
    ctx.haptic('success');
    toResult(now);
  }

  function tooEarly(now: number): void {
    showMiss('はやい！ ⏱');
    ctx.sfx('fail');
    ctx.haptic('error');
    toResult(now);
  }

  function escape(now: number): void {
    showMiss('にげられた… 💨');
    ctx.sfx('fail');
    toResult(now);
  }

  function toResult(now: number): void {
    setMode('result');
    resultUntil = now + RESULT_MS;
    updateFloat();
    paintHud();
  }

  function nextCast(): void {
    castIndex++;
    if (castIndex >= CASTS) {
      finish(ctx.now());
      return;
    }
    setMode('idle');
    if (msgEl) {
      msgEl.className = 'fs-msg';
      msgEl.textContent = 'つぎ、いこう！';
    }
    updateFloat();
    paintHud();
  }

  function finish(now: number): void {
    setMode('over');
    const over = elem('div', 'fs-over');
    over.append(
      elem('div', 'fs-over-t', '🎣 おつかれさま！'),
      elem('div', 'fs-over-s', `つれた ${caught}ひき`),
      elem('div', 'fs-over-b', `スコア ${score}`),
    );
    sceneEl?.append(over);
    ctx.sfx('success');
    ctx.haptic('success');
    endAt = now + END_DELAY;
  }

  // ---- 図鑑 ----
  function addToZukan(id: string): void {
    zukan.add(id);
    ctx.save('zukan', [...zukan]);
    if (zukanEl) zukanEl.textContent = `📖 ずかん ${zukan.size}/${ALL_FISH_IDS.length}`;
    if (zukan.size >= ALL_FISH_IDS.length) ctx.achieve('zukan-complete');
  }

  // ---- 描画 ----
  function paintHud(): void {
    if (castEl) castEl.textContent = `キャスト ${Math.min(castIndex + 1, CASTS)}/${CASTS}`;
    if (scoreEl) scoreEl.textContent = `スコア ${score}`;
    if (caughtEl) caughtEl.textContent = `つれた ${caught}`;
  }

  function updateFloat(): void {
    if (!floatEl || !bangEl) return;
    floatEl.classList.toggle('fs-float-on', mode === 'sink' || mode === 'bite');
    floatEl.classList.toggle('fs-float-dip', mode === 'bite');
    bangEl.classList.toggle('fs-bang-on', mode === 'bite');
  }

  function showCatch(fish: Fish, gain: number, just: boolean, isNew: boolean): void {
    if (!msgEl) return;
    msgEl.className = 'fs-msg fs-msg-catch';
    msgEl.replaceChildren(
      elem('div', 'fs-catch-emoji', fish.emoji),
      elem('div', 'fs-catch-name', fish.name + (isNew ? ' ✨ずかん初！' : '')),
      elem('div', 'fs-catch-pt', `+${gain}` + (just ? '　ジャスト！' : '')),
    );
  }

  function showMiss(text: string): void {
    if (!msgEl) return;
    msgEl.className = 'fs-msg fs-msg-miss';
    msgEl.textContent = text;
  }

  // ---- 毎フレーム（アタリ・窓・結果表示・結果遷移。すべて ctx.now 基準＝ポーズで停止）----
  const offFrame = ctx.onFrame(() => {
    const now = ctx.now();
    if (mode === 'sink') {
      if (now >= biteAt) toBite(now);
    } else if (mode === 'bite') {
      if (now >= biteUntil) escape(now);
    } else if (mode === 'result') {
      if (now >= resultUntil) nextCast();
    } else if (mode === 'over') {
      if (!ended && now >= endAt) {
        ended = true;
        ctx.end({ score });
      }
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
      // flex + % レイアウトのみ＝計測なし。何もしなくてよい
    },
    destroy() {
      offFrame();
      style.remove();
      wrap.remove();
    },
  };
}

// =============================================================
// スタイル（.fs- プレフィックス。テーマ変数でライト/ダーク両対応）
// =============================================================
const CSS = `
.fs-wrap{position:absolute;inset:0;overflow:hidden}

/* 設定画面 */
.fs-setup{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:safe center;
  gap:14px;padding:20px 16px;box-sizing:border-box;overflow-y:auto;user-select:none;-webkit-user-select:none}
.fs-h2{margin:4px 0;font-size:22px;text-align:center}
.fs-seg-row{width:min(92vw,420px);display:flex;flex-direction:column;gap:6px}
.fs-seg-label{font-size:13px;color:var(--text-dim);font-weight:800}
.fs-seg{display:flex;background:var(--bg-elev2);border-radius:12px;padding:3px;gap:2px}
.fs-seg-btn{flex:1;border:none;background:none;color:var(--text-dim);padding:10px 2px;border-radius:9px;
  font-size:14px;font-weight:800;min-height:44px}
.fs-seg-btn.fs-on{background:var(--accent);color:#fff}
.fs-note{font-size:12px;color:var(--text-dim);text-align:center;max-width:min(92vw,420px);margin:0;line-height:1.7}
.fs-zukan-line{font-size:14px;font-weight:800;margin:0}
.fs-btn{appearance:none;border:none;border-radius:12px;padding:12px 18px;font-size:15px;font-weight:800;font-family:inherit;
  background:var(--bg-elev2);color:var(--text);min-height:44px}
.fs-btn-primary{background:var(--accent-grad);color:#fff}
.fs-btn-lg{width:100%;max-width:300px;font-size:18px}

/* プレイ画面 */
.fs-play{position:absolute;inset:0;display:flex;flex-direction:column;padding:6px 10px 14px;box-sizing:border-box;
  user-select:none;-webkit-user-select:none}
.fs-hud{display:flex;justify-content:center;align-items:center;gap:14px;padding:2px 64px 4px;flex-wrap:wrap;min-height:54px}
.fs-hud-item{font-size:14px;font-weight:800;white-space:nowrap}

/* 水のシーン */
.fs-scene{flex:1 1 auto;min-height:0;position:relative;border-radius:18px;overflow:hidden;
  background:linear-gradient(180deg,#7fc7f0 0%,#4a9fd4 45%,#2b6ea8 100%)}
.fs-scene::before{content:'';position:absolute;inset:0;
  background:repeating-linear-gradient(180deg,rgba(255,255,255,.10) 0 2px,transparent 2px 20px);
  animation:fs-wave 5s linear infinite;pointer-events:none}
@keyframes fs-wave{from{background-position-y:0}to{background-position-y:20px}}
.fs-float{position:absolute;left:50%;top:38%;transform:translate(-50%,-50%);font-size:34px;opacity:0;transition:top .18s ease,opacity .2s}
.fs-float-on{opacity:1}
.fs-float-dip{top:52%}
.fs-bang{position:absolute;left:50%;top:24%;transform:translateX(-50%);font-size:46px;font-weight:900;color:#fff;
  text-shadow:0 2px 8px rgba(0,0,0,.35);opacity:0;transition:opacity .1s}
.fs-bang-on{opacity:1;animation:fs-pop .3s ease-out}
@keyframes fs-pop{from{transform:translateX(-50%) scale(.5)}to{transform:translateX(-50%) scale(1)}}
.fs-msg{position:absolute;left:0;right:0;bottom:14px;text-align:center;color:#fff;font-size:16px;font-weight:800;
  text-shadow:0 1px 4px rgba(0,0,0,.3);padding:0 12px}
.fs-msg-bite{font-size:22px}
.fs-msg-miss{font-size:20px}
.fs-msg-catch{bottom:0;top:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;
  background:rgba(16,40,64,.30);animation:fs-in .2s ease-out}
.fs-catch-emoji{font-size:72px;line-height:1;animation:fs-jump .5s ease-out}
@keyframes fs-jump{0%{transform:translateY(30px) scale(.6)}60%{transform:translateY(-8px) scale(1.05)}100%{transform:translateY(0) scale(1)}}
.fs-catch-name{font-size:20px;font-weight:900}
.fs-catch-pt{font-size:18px;font-weight:900;color:#ffe27a}

/* アクションボタン（特大タップ領域） */
.fs-action{width:100%;max-width:420px;align-self:center;min-height:78px;font-size:26px;border-radius:18px;margin-top:8px}
.fs-action:active{transform:scale(.98)}
.fs-action-bite{background:linear-gradient(135deg,#ff9a3c,#ff5f6d);animation:fs-flash .5s ease-in-out infinite}
@keyframes fs-flash{0%,100%{filter:brightness(1)}50%{filter:brightness(1.18)}}
.fs-zukan{text-align:center;font-size:13px;font-weight:800;color:var(--text-dim);margin-top:6px}

/* 結果 */
.fs-over{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;
  background:rgba(16,19,48,.86);color:#fff;animation:fs-in .2s ease-out;padding:12px}
.fs-over-t{font-size:26px;font-weight:900}
.fs-over-s{font-size:20px;font-weight:800}
.fs-over-b{font-size:16px;font-weight:800;color:#ffd76a}
@keyframes fs-in{from{opacity:0;transform:scale(.96)}to{opacity:1;transform:scale(1)}}
`;
