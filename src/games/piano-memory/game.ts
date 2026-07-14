// =============================================================
// おぼえてピアノ（No.14）: お手本の光る鍵盤＋音の列を覚えて、同じ順にたたく（光と音の記憶ゲーム）
// =============================================================
// - よこ向き。白鍵は常にドレミファソラシド(8鍵)。黒鍵は「見た目だけ」（タップ不可・演出なし）
// - お手本を1音ずつ「鍵盤が光る＋その音が鳴る」で再生 → プレイヤーが同じ順にタップ
// - 正解すると列が1音のびる。1つでも間違えたら終了。むずかしさは「はやさ（テンポ）」
// - 音は ctx.tone(freq,ms)。シーケンスは ctx.random＝日替わりは全員同じメロディ。時間は ctx.now 期限方式
// - import してよいのは game-api（types / helpers）と、このフォルダ内（notes）だけ
import type { GameContext, IGame } from '../../game-api/types';
import { elem, makeSeg } from '../../game-api/helpers';
import { NOTES, randomKey } from './notes';

type TempoKey = 'slow' | 'normal' | 'fast';
type Mode = 'setup' | 'watch' | 'input' | 'over';
interface Config {
  tempo: TempoKey;
}

const KEY_COUNT = 8; // 白鍵は常にドレミファソラシド
const TEMPO: Record<TempoKey, { base: number; label: string; bonus: number }> = {
  slow: { base: 720, label: 'おそい', bonus: 0 },
  normal: { base: 560, label: 'ふつう', bonus: 40 },
  fast: { base: 440, label: 'はやい', bonus: 100 },
};
// 黒鍵の位置：白鍵インデックス i と i+1 の境目に置く（C#,D#,F#,G#,A# の5つ。E-F と B-C の間には無い）
const BLACK_AFTER = [0, 1, 3, 4, 5];
const REPLAYS = 2;
const INPUT_LIGHT = 260;
const ROUND_PAUSE = 750;
const START_PAUSE = 500;
const END_DELAY = 1900;

export function createGame(ctx: GameContext): IGame {
  const saved = ctx.load<Partial<Config>>('config');
  const config: Config = {
    tempo: saved?.tempo === 'slow' || saved?.tempo === 'fast' ? saved.tempo : 'normal',
  };

  let mode: Mode = 'setup';
  let hostPaused = false;
  let tempo: TempoKey = config.tempo;
  let seq: number[] = [];
  let cleared = 0;
  let inputPos = 0;
  let replaysLeft = REPLAYS;
  let usedReplay = false;
  let litKey = -1;
  let litUntil = 0;
  let watchStart = 0;
  let playIndex = 0;
  let curStep = 560;
  let curLight = 380;
  let score = 0;
  let endAt = 0;
  let ended = false;
  let bannerUntil = 0;

  const style = document.createElement('style');
  style.textContent = CSS;
  const wrap = elem('div', 'pn-wrap');
  ctx.root.append(style, wrap);

  let keyEls: HTMLButtonElement[] = [];
  let statusEl: HTMLElement | null = null;
  let progEl: HTMLElement | null = null;
  let roundEl: HTMLElement | null = null;
  let scoreEl: HTMLElement | null = null;
  let replayBtn: HTMLButtonElement | null = null;
  let bannerEl: HTMLElement | null = null;

  // ---- 設定画面 ----
  function showSetup(): void {
    mode = 'setup';
    const box = elem('div', 'pn-setup');
    box.append(elem('h2', 'pn-h2', 'おぼえてピアノ'));
    box.append(
      makeSeg(
        'pn',
        'はやさ',
        [
          { v: 'slow', t: 'おそい' },
          { v: 'normal', t: 'ふつう' },
          { v: 'fast', t: 'はやい' },
        ],
        () => config.tempo,
        (v) => {
          config.tempo = v as TempoKey;
        },
      ),
    );
    box.append(elem('p', 'pn-note', 'お手本で 光って鳴る けんばん（ドレミファソラシド）を よくおぼえて、同じ順に タップしよう！正解すると 1つずつ 長くなるよ。「もう1回きく」は2回まで。'));
    const start = elem('button', 'pn-btn pn-btn-primary pn-btn-lg', 'スタート ▶') as HTMLButtonElement;
    start.addEventListener('click', () => startMatch());
    box.append(start);
    wrap.replaceChildren(box);
  }

  // ---- 開始 ----
  function startMatch(): void {
    ctx.save('config', { ...config });
    tempo = config.tempo;
    seq = [];
    cleared = 0;
    replaysLeft = REPLAYS;
    usedReplay = false;
    score = 0;
    ended = false;
    endAt = 0;
    buildPlay();
    nextRound(START_PAUSE);
  }

  function buildPlay(): void {
    const play = elem('div', 'pn-play');
    const hud = elem('div', 'pn-hud');
    roundEl = elem('span', 'pn-hud-item', '');
    scoreEl = elem('span', 'pn-hud-item', '');
    hud.append(roundEl, scoreEl);

    const bar = elem('div', 'pn-bar');
    statusEl = elem('div', 'pn-status', '');
    progEl = elem('div', 'pn-prog', '');
    replayBtn = elem('button', 'pn-replay', '') as HTMLButtonElement;
    replayBtn.addEventListener('click', () => replay());
    bar.append(statusEl, progEl, replayBtn);

    const kbWrap = elem('div', 'pn-kb-wrap');
    const kb = elem('div', 'pn-keyboard');
    keyEls = [];
    for (let i = 0; i < KEY_COUNT; i++) {
      const idx = i;
      const note = NOTES[i];
      const k = elem('button', 'pn-key') as HTMLButtonElement;
      k.style.setProperty('--kc', note?.color ?? '#888');
      k.append(elem('span', 'pn-key-name', note?.name ?? ''));
      k.addEventListener('click', () => onKey(idx));
      keyEls.push(k);
      kb.append(k);
    }
    // 見た目だけの黒鍵（タップ不可・シーケンスに関与しない）
    for (const i of BLACK_AFTER) {
      const bk = elem('div', 'pn-black');
      bk.style.left = `${(i + 1) * 12.5 - 4}%`;
      kb.append(bk);
    }
    kbWrap.append(kb);

    play.append(hud, bar, kbWrap);
    wrap.replaceChildren(play);
    paintAll();
  }

  // ---- ラウンド進行 ----
  function nextRound(pause: number): void {
    seq.push(randomKey(ctx.random, KEY_COUNT));
    inputPos = 0;
    playIndex = 0;
    litKey = -1;
    curStep = Math.max(340, TEMPO[tempo].base - cleared * 16);
    curLight = Math.round(curStep * 0.68);
    watchStart = ctx.now() + pause;
    mode = 'watch';
    paintAll();
  }

  function playNote(key: number, lightMs: number): void {
    litKey = key;
    litUntil = ctx.now() + lightMs;
    ctx.tone?.(NOTES[key]?.freq ?? 440, lightMs);
    paintKeys();
  }

  function onKey(k: number): void {
    if (mode !== 'input' || hostPaused) return;
    playNote(k, INPUT_LIGHT);
    ctx.haptic('light');
    if (seq[inputPos] === k) {
      inputPos++;
      paintProgress();
      if (inputPos >= seq.length) roundClear();
    } else {
      fail();
    }
  }

  function roundClear(): void {
    cleared = seq.length;
    // マイルストーン実績は達したその場で解除（中断しても取りこぼさない。ここは cleared≥1 が保証される）
    ctx.achieve('first-clear');
    if (cleared >= 5) ctx.achieve('len-5');
    if (cleared >= 8) ctx.achieve('len-8');
    if (cleared >= 12) ctx.achieve('len-12');
    if (tempo === 'fast' && cleared >= 5) ctx.achieve('speed-clear');
    if (cleared >= 5 && !usedReplay) ctx.achieve('no-replay');
    ctx.sfx('combo');
    showBanner('せいかい！', ROUND_PAUSE - 120);
    nextRound(ROUND_PAUSE);
  }

  function fail(): void {
    mode = 'over';
    score = cleared * (10 + KEY_COUNT) + TEMPO[tempo].bonus;
    // 実績はラウンドクリア時（roundClear）に live 解除済み
    ctx.sfx('fail');
    ctx.haptic('error');
    showBanner(cleared >= 1 ? `${cleared}音まで おぼえた！` : 'ざんねん…', END_DELAY - 200);
    endAt = ctx.now() + END_DELAY;
    paintAll();
  }

  function replay(): void {
    if (mode !== 'input' || hostPaused || replaysLeft <= 0) return;
    replaysLeft--;
    usedReplay = true;
    inputPos = 0;
    playIndex = 0;
    litKey = -1;
    watchStart = ctx.now() + 250;
    mode = 'watch';
    ctx.sfx('tick');
    paintAll();
  }

  // ---- バナー ----
  function showBanner(text: string, ms: number): void {
    hideBanner();
    bannerEl = elem('div', 'pn-banner', text);
    wrap.append(bannerEl);
    bannerUntil = ctx.now() + ms;
  }
  function hideBanner(): void {
    bannerEl?.remove();
    bannerEl = null;
    bannerUntil = 0;
  }

  // ---- 描画 ----
  function paintKeys(): void {
    for (let i = 0; i < KEY_COUNT; i++) {
      const el = keyEls[i];
      if (!el) continue;
      el.classList.toggle('pn-lit', i === litKey);
      el.disabled = mode !== 'input';
    }
  }
  function paintProgress(): void {
    if (!progEl) return;
    if (mode === 'input') {
      let dots = '';
      for (let i = 0; i < seq.length; i++) dots += i < inputPos ? '●' : '○';
      progEl.textContent = dots;
    } else {
      progEl.textContent = '';
    }
  }
  function paintAll(): void {
    paintKeys();
    paintProgress();
    if (roundEl) roundEl.textContent = `ラウンド ${Math.max(1, seq.length)}`;
    if (scoreEl) scoreEl.textContent = mode === 'over' ? `スコア ${score}` : `おぼえた ${cleared}`;
    if (statusEl) {
      statusEl.textContent =
        mode === 'watch' ? '👀 よく きいて！' : mode === 'input' ? '🎹 きみの ばん！' : mode === 'over' ? 'おしまい' : '';
    }
    if (replayBtn) {
      replayBtn.textContent = `🔁 もう1回きく（×${replaysLeft}）`;
      replayBtn.disabled = mode !== 'input' || replaysLeft <= 0;
      replayBtn.style.visibility = mode === 'setup' ? 'hidden' : 'visible';
    }
  }

  // ---- 毎フレーム（お手本再生・光の消灯・結果遷移。すべて ctx.now）----
  const offFrame = ctx.onFrame(() => {
    const now = ctx.now();
    if (bannerEl && now >= bannerUntil) hideBanner();
    if (litKey >= 0 && now >= litUntil) {
      litKey = -1;
      paintKeys();
    }
    if (mode === 'watch') {
      if (now < watchStart) return;
      if (playIndex < seq.length) {
        if (now >= watchStart + playIndex * curStep) {
          playNote(seq[playIndex] ?? 0, curLight);
          playIndex++;
        }
      } else if (now >= watchStart + seq.length * curStep) {
        mode = 'input';
        inputPos = 0;
        litKey = -1;
        paintAll();
      }
    } else if (mode === 'over' && !ended && now >= endAt) {
      ended = true;
      ctx.end({ score });
    }
  });

  showSetup();

  return {
    start() {
      /* 設定画面から開始（immediate） */
    },
    pause() {
      hostPaused = true;
    },
    resume() {
      hostPaused = false;
    },
    resize() {
      /* Flex/gridレイアウトのみ（横向き） */
    },
    destroy() {
      offFrame();
      style.remove();
      wrap.remove();
    },
  };
}

const CSS = `
.pn-wrap{position:absolute;inset:0;overflow:hidden}
.pn-setup{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:safe center;
  gap:12px;padding:16px;box-sizing:border-box;overflow-y:auto;user-select:none;-webkit-user-select:none}
.pn-h2{margin:2px 0;font-size:22px}
.pn-seg-row{width:min(92vw,460px);display:flex;flex-direction:column;gap:6px}
.pn-seg-label{font-size:13px;color:var(--text-dim);font-weight:800}
.pn-seg{display:flex;background:var(--bg-elev2);border-radius:12px;padding:3px;gap:2px}
.pn-seg-btn{flex:1;border:none;background:none;color:var(--text-dim);padding:10px 2px;border-radius:9px;
  font-size:14px;font-weight:800;min-height:44px}
.pn-seg-btn.pn-on{background:var(--accent);color:#fff}
.pn-note{font-size:12px;color:var(--text-dim);text-align:center;max-width:min(92vw,460px);margin:0;line-height:1.7}
.pn-btn{appearance:none;border:none;border-radius:12px;padding:12px 18px;font-size:15px;font-weight:800;
  background:var(--bg-elev2);color:var(--text);min-height:44px}
.pn-btn-primary{background:var(--accent-grad);color:#fff}
.pn-btn-lg{width:100%;max-width:300px;font-size:18px}

/* プレイ（横向き）: 上に細い情報バー、下に幅いっぱいの鍵盤 */
.pn-play{position:absolute;inset:0;display:flex;flex-direction:column;padding:6px 10px 10px;box-sizing:border-box;
  user-select:none;-webkit-user-select:none}
.pn-hud{display:flex;justify-content:center;gap:18px;align-items:center;min-height:26px;padding:0 64px}
.pn-hud-item{font-size:14px;font-weight:800;white-space:nowrap}
.pn-bar{display:flex;align-items:center;justify-content:center;gap:14px;flex-wrap:wrap;min-height:40px;padding:2px 64px}
.pn-status{font-size:20px;font-weight:900;white-space:nowrap}
.pn-prog{font-size:15px;letter-spacing:3px;color:var(--accent-2)}
.pn-replay{appearance:none;border:none;border-radius:10px;min-height:40px;padding:6px 14px;font-size:13px;font-weight:800;
  background:var(--bg-elev2);color:var(--text)}
.pn-replay:disabled{opacity:.4}
.pn-kb-wrap{flex:1 1 auto;min-height:0;display:flex;align-items:stretch;justify-content:center;padding-top:4px}
.pn-keyboard{position:relative;width:100%;max-width:820px;display:flex;align-items:stretch;
  background:#20233c;border-radius:8px;padding:6px 6px 0;box-sizing:border-box}
.pn-key{flex:1;min-width:0;border:none;border-right:1px solid #c7ccd8;border-radius:0 0 8px 8px;background:#f6f6fb;
  position:relative;display:flex;align-items:flex-end;justify-content:center;padding-bottom:10px;
  border-bottom:8px solid var(--kc);box-shadow:inset 0 -2px 4px rgba(0,0,0,.06);transition:transform .05s}
.pn-key:last-child{border-right:none}
.pn-key-name{font-size:16px;font-weight:900;color:#3a3f55}
.pn-key.pn-lit{background:var(--kc);box-shadow:0 0 20px var(--kc);transform:translateY(2px)}
.pn-key.pn-lit .pn-key-name{color:#fff}
/* 見た目だけの黒鍵（タップを通す） */
.pn-black{position:absolute;top:6px;width:8%;height:58%;background:linear-gradient(#2a2d3f,#111325);
  border-radius:0 0 5px 5px;box-shadow:0 3px 4px rgba(0,0,0,.5);pointer-events:none;z-index:2}
.pn-banner{position:absolute;left:50%;top:38%;transform:translate(-50%,-50%);background:rgba(16,19,48,.9);color:#fff;
  padding:10px 22px;border-radius:999px;font-weight:800;font-size:20px;pointer-events:none;white-space:nowrap;z-index:5;
  animation:pn-pop .2s ease-out}
@keyframes pn-pop{from{opacity:0;transform:translate(-50%,-42%)}to{opacity:1;transform:translate(-50%,-50%)}}
`;
