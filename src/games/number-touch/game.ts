// =============================================================
// すうじタッチ（No.35）: うごきまわる数字を 1→2→3… の順に さがしてタップ！
// =============================================================
// - 数字の円が ふわふわ漂う。1から順にタップして 全部消したタイムを競う（timeMs）。
// - おてつき（順番ちがい）は +2びょうペナルティ。むずかしさで 個数と速さが上がる。
// - 配置・初速は logic.ts（rng注入＝日替わりは全員同じ盤）。円はDOMボタン（直径48px）。
// - 時間は ctx.now の期限方式。startMode:'immediate'＝設定→自前3-2-1（円は Go で登場）。
// - import してよいのは game-api（types / helpers）と、このフォルダ内（logic）だけ
import type { GameContext, IGame } from '../../game-api/types';
import { elem, makeSeg, createCountdown, type Countdown } from '../../game-api/helpers';
import { makeLayout, stepCircles, LEVELS, CIRCLE_R, PENALTY_MS, type Circle, type LevelKey } from './logic';

type Mode = 'setup' | 'count' | 'play' | 'over';

interface Config {
  level: LevelKey;
}

const END_DELAY = 1700;
const SPEEDY_MS = 15_000; // 「そくたつタッチ」実績
const QUICK5_MS = 5_000; // 「そくどうスタート」実績（最初の5個）

export function createGame(ctx: GameContext): IGame {
  // ---- 設定（前回を復元。既定れんしゅう）----
  const saved = ctx.load<Partial<Config>>('config');
  const config: Config = {
    level: saved?.level === 'normal' || saved?.level === 'hard' ? saved.level : 'easy',
  };

  // ---- 状態 ----
  let mode: Mode = 'setup';
  let hostPaused = false;
  let level: LevelKey = config.level;
  let circles: Circle[] = [];
  let next = 1;
  let goTime = 0;
  let penalties = 0;
  let finalMs = 0;
  let endAt = 0;
  let ended = false;
  let cd: Countdown | null = null;
  let boardW = 320;
  let boardH = 360;

  // ---- DOM ----
  const style = document.createElement('style');
  style.textContent = CSS;
  const wrap = elem('div', 'nt-wrap');
  ctx.root.append(style, wrap);

  let nextEl: HTMLElement | null = null;
  let timeEl: HTMLElement | null = null;
  let missEl: HTMLElement | null = null;
  let boardEl: HTMLElement | null = null;
  let msgEl: HTMLElement | null = null;
  let countEl: HTMLElement | null = null;
  const btnByNum = new Map<number, HTMLButtonElement>();
  let lastTimeText = '';

  function devState(): void {
    if (!import.meta.env.DEV) return;
    const ds = wrap.dataset;
    ds.st = mode;
    ds.next = String(next);
    ds.pen = String(penalties);
    ds.final = String(finalMs);
  }

  // ---- 設定画面 ----
  function showSetup(): void {
    mode = 'setup';
    devState();
    const box = elem('div', 'nt-setup');
    box.append(elem('h2', 'nt-h2', '1から じゅんばんに タッチ！'));
    box.append(
      makeSeg(
        'nt',
        'むずかしさ',
        [
          { v: 'easy', t: 'れんしゅう（12）' },
          { v: 'normal', t: 'ふつう（18）' },
          { v: 'hard', t: 'むずかしい（25）' },
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
        'nt-note',
        'ばらばらに うかんだ数字を 1→2→3… の順に タッチしてタイムをきそうよ。数字は ゆっくり うごきまわる！順番をまちがえると +2びょうの ペナルティ。',
      ),
    );
    const start = elem('button', 'nt-btn nt-btn-primary nt-btn-lg', 'はじめる ▶') as HTMLButtonElement;
    start.addEventListener('click', () => startMatch());
    box.append(start);
    wrap.replaceChildren(box);
  }

  // ---- 開始 ----
  function startMatch(): void {
    ctx.save('config', { ...config });
    level = config.level;
    next = 1;
    penalties = 0;
    finalMs = 0;
    ended = false;
    btnByNum.clear();
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
        goTime = now;
        spawnCircles();
        mode = 'play';
        ctx.sfx('start');
        devState();
      },
    });
    cd.start(ctx.now());
  }

  function buildPlay(): void {
    const play = elem('div', 'nt-play');

    const hud = elem('div', 'nt-hud');
    nextEl = elem('span', 'nt-hud-item nt-next', 'つぎ 1');
    timeEl = elem('span', 'nt-hud-item', '⏱ 0.0');
    missEl = elem('span', 'nt-hud-item', 'おてつき 0');
    hud.append(nextEl, timeEl, missEl);

    boardEl = elem('div', 'nt-board');
    countEl = elem('div', 'nt-count', '');
    boardEl.append(countEl);
    msgEl = elem('div', 'nt-msg', '');

    play.append(hud, boardEl, msgEl);
    wrap.replaceChildren(play);
    // 盤サイズを実測（文言・盤を全部入れてから測る）
    const r = boardEl.getBoundingClientRect();
    boardW = Math.max(120, r.width);
    boardH = Math.max(120, r.height);
  }

  function spawnCircles(): void {
    if (!boardEl) return;
    circles = makeLayout(ctx.random, level, boardW, boardH);
    for (const c of circles) {
      const b = elem('button', 'nt-circle', String(c.num)) as HTMLButtonElement;
      b.dataset.num = String(c.num);
      b.addEventListener('click', () => onTouch(c.num));
      btnByNum.set(c.num, b);
      boardEl.append(b);
    }
    paintCircles();
  }

  function paintCircles(): void {
    for (const c of circles) {
      const b = btnByNum.get(c.num);
      if (b) b.style.transform = `translate(${Math.round(c.x - CIRCLE_R)}px, ${Math.round(c.y - CIRCLE_R)}px)`;
    }
  }

  // ---- タッチ ----
  function onTouch(num: number): void {
    if (mode !== 'play' || hostPaused) return;
    const now = ctx.now();
    if (num !== next) {
      // おてつき: +2びょう
      penalties++;
      if (missEl) missEl.textContent = `おてつき ${penalties}`;
      if (msgEl) {
        // クラスを外してリフローしてから付け直す（同じ文字列の再代入ではアニメが再発火しない）
        msgEl.className = 'nt-msg nt-msg-bad';
        msgEl.textContent = `おてつき！ +2びょう（つぎは ${next}）`;
        void msgEl.offsetWidth;
        msgEl.classList.add('nt-msg-in');
      }
      boardEl?.classList.remove('nt-shake');
      if (boardEl) void boardEl.offsetWidth;
      boardEl?.classList.add('nt-shake');
      ctx.sfx('fail');
      ctx.haptic('error');
      devState();
      return;
    }
    // せいかい
    const idx = circles.findIndex((c) => c.num === num);
    if (idx >= 0) circles.splice(idx, 1);
    const b = btnByNum.get(num);
    if (b) {
      b.disabled = true;
      b.classList.add('nt-pop');
      const cb = b;
      // アニメ後に消す（期限は onFrame 側でなく transitionend より確実な remove 予約）
      cb.addEventListener('animationend', () => cb.remove());
    }
    btnByNum.delete(num);
    ctx.sfx('tap');
    ctx.haptic('light');
    const total = LEVELS[level].count;
    if (num === 5 && now - goTime <= QUICK5_MS) ctx.achieve('quick-5');
    next++;
    if (nextEl) nextEl.textContent = next <= total ? `つぎ ${next}` : 'ゴール！';
    if (next > total) {
      finish(now);
      return;
    }
    devState();
  }

  function finish(now: number): void {
    mode = 'over';
    finalMs = Math.round(now - goTime + penalties * PENALTY_MS);
    ctx.achieve('first-finish');
    if (penalties === 0) ctx.achieve('no-miss');
    if (level === 'normal') ctx.achieve('clear-normal');
    if (level === 'hard') ctx.achieve('clear-hard');
    if (finalMs <= SPEEDY_MS) ctx.achieve('speedy');
    if (msgEl) {
      msgEl.className = 'nt-msg nt-msg-win nt-msg-in';
      msgEl.textContent = `ゴール！ 🎉 ${(finalMs / 1000).toFixed(2)}びょう${penalties > 0 ? `（おてつき+${penalties * 2}びょう込み）` : ''}`;
    }
    ctx.sfx('medal');
    ctx.haptic('success');
    endAt = now + END_DELAY;
    devState();
  }

  // ---- 毎フレーム（カウントダウン・漂い・タイマー表示・結果遷移）----
  const offFrame = ctx.onFrame((dt) => {
    const now = ctx.now();
    if (mode === 'count') {
      cd?.tick(now);
      return;
    }
    if (mode === 'play') {
      stepCircles(circles, Math.min(dt, 0.05), boardW, boardH);
      paintCircles();
      const ms = now - goTime + penalties * PENALTY_MS;
      const text = `⏱ ${(ms / 1000).toFixed(1)}`;
      if (text !== lastTimeText && timeEl) {
        lastTimeText = text;
        timeEl.textContent = text;
      }
      return;
    }
    if (mode === 'over' && !ended && now >= endAt) {
      ended = true;
      ctx.end({ score: finalMs });
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
      if (!boardEl) return;
      const r = boardEl.getBoundingClientRect();
      boardW = Math.max(120, r.width);
      boardH = Math.max(120, r.height);
      // 円を新しい盤内に収める
      for (const c of circles) {
        c.x = Math.min(Math.max(c.x, CIRCLE_R), boardW - CIRCLE_R);
        c.y = Math.min(Math.max(c.y, CIRCLE_R), boardH - CIRCLE_R);
      }
      paintCircles();
    },
    destroy() {
      offFrame();
      style.remove();
      wrap.remove();
    },
  };
}

// =============================================================
// スタイル（.nt- プレフィックス。テーマ変数でライト/ダーク両対応）
// =============================================================
const CSS = `
.nt-wrap{position:absolute;inset:0;overflow:hidden}

/* 設定画面 */
.nt-setup{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:safe center;
  gap:14px;padding:20px 16px;box-sizing:border-box;overflow-y:auto;user-select:none;-webkit-user-select:none}
.nt-h2{margin:4px 0;font-size:22px;text-align:center}
.nt-seg-row{width:min(92vw,420px);display:flex;flex-direction:column;gap:6px}
.nt-seg-label{font-size:13px;color:var(--text-dim);font-weight:800}
.nt-seg{display:flex;background:var(--bg-elev2);border-radius:12px;padding:3px;gap:2px}
.nt-seg-btn{flex:1;border:none;background:none;color:var(--text-dim);padding:10px 2px;border-radius:9px;
  font-size:12px;font-weight:800;min-height:44px}
.nt-seg-btn.nt-on{background:var(--accent);color:#fff}
.nt-note{font-size:12px;color:var(--text-dim);text-align:center;max-width:min(92vw,420px);margin:0;line-height:1.7}
.nt-btn{appearance:none;border:none;border-radius:12px;padding:12px 18px;font-size:15px;font-weight:800;font-family:inherit;
  background:var(--bg-elev2);color:var(--text);min-height:44px}
.nt-btn-primary{background:var(--accent-grad);color:#fff}
.nt-btn-lg{width:100%;max-width:300px;font-size:18px}

/* プレイ画面 */
.nt-play{position:absolute;inset:0;display:flex;flex-direction:column;padding:6px 10px 12px;box-sizing:border-box;
  user-select:none;-webkit-user-select:none}
.nt-hud{display:flex;justify-content:center;align-items:center;gap:14px;padding:2px 64px 4px;flex-wrap:wrap;min-height:54px}
.nt-hud-item{font-size:14px;font-weight:800;white-space:nowrap;font-variant-numeric:tabular-nums}
.nt-next{font-size:17px;color:var(--accent-2)}
.nt-board{position:relative;flex:1 1 auto;min-height:0;background:var(--bg-elev2);border-radius:16px;overflow:hidden}
@keyframes nt-shake{0%,100%{transform:translateX(0)}25%{transform:translateX(-7px)}75%{transform:translateX(7px)}}
.nt-board.nt-shake{animation:nt-shake .22s ease-in-out}
.nt-circle{position:absolute;left:0;top:0;width:48px;height:48px;border-radius:50%;border:none;appearance:none;
  background:var(--accent);color:#fff;font-size:20px;font-weight:900;font-family:inherit;font-variant-numeric:tabular-nums;
  box-shadow:0 3px 8px rgba(0,0,0,.25);will-change:transform}
.nt-circle:nth-child(3n){background:#e8811c}
.nt-circle:nth-child(3n+1){background:#2fae5e}
@keyframes nt-pop{from{opacity:1;scale:1}to{opacity:0;scale:1.6}}
.nt-circle.nt-pop{animation:nt-pop .22s ease-out forwards;pointer-events:none}
.nt-count{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:96px;font-weight:900;
  color:var(--text);pointer-events:none;z-index:1}
.nt-msg{min-height:24px;font-size:14px;font-weight:900;text-align:center;margin-top:8px;color:var(--text-dim)}
.nt-msg-bad{color:#e2607a}
.nt-msg-win{color:#2fae5e}
@keyframes nt-msg-in{from{opacity:0;transform:scale(.94)}to{opacity:1;transform:scale(1)}}
.nt-msg-in{animation:nt-msg-in .18s ease-out}
`;
