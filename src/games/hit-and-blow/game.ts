// =============================================================
// えもじヒットアンドブロー（No.5）: かくれた絵文字の並びを推理して当てる
// =============================================================
// - あんごう＝パレット絵文字の並び。こたえあわせすると「ズバリ(Hit)」「おしい(Blow)」の数が返る
// - むずかしさ2軸: わく数(3/4/5) × かぶり(なし/あり)。テーマ(見た目)とヒント(任意)もえらべる
// - 推理パズル＝反射でないので startMode:'immediate'（設定画面→即プレイ・カウントダウンなし）
// - 乱数は ctx.random、時間は ctx.now（Math.random/Date.now/setTimeout 不使用）
// - import してよいのは game-api（types / helpers）と、このフォルダ内（engine）だけ
// =============================================================
import type { GameContext, IGame } from '../../game-api/types';
import { elem, makeSeg } from '../../game-api/helpers';
import { evaluate, generateSecret, type Feedback } from './engine';

type SizeKey = 'small' | 'normal' | 'big';
type ThemeKey = 'fruit' | 'animal' | 'vehicle';
type Mode = 'setup' | 'play' | 'win' | 'lose';

interface Config {
  size: SizeKey;
  dup: boolean;
  theme: ThemeKey;
  hint: boolean;
}

const PALETTE_SIZE = 6;
const MAX_GUESSES = 10;
const END_DELAY_WIN = 1800; // 正解演出→結果画面までの余韻(ms・ctx.now基準)
const END_DELAY_LOSE = 2600; // ハズレはこたえを見せるぶん長め

const SLOTS: Record<SizeKey, number> = { small: 3, normal: 4, big: 5 };

// テーマは「見た目の皮」。あんごうは絵文字インデックスで決まるので、テーマを変えても
// 論理パズルは同一（今日のゲーム＝全員同じ）。形がはっきり違う6種で構成する。
const THEMES: Record<ThemeKey, { name: string; emojis: string[] }> = {
  fruit: { name: 'くだもの', emojis: ['🍎', '🍌', '🍇', '🍊', '🍓', '🍑'] },
  animal: { name: 'どうぶつ', emojis: ['🐶', '🐱', '🐰', '🐻', '🐼', '🦊'] },
  vehicle: { name: 'のりもの', emojis: ['🚗', '🚌', '🚀', '✈️', '🚲', '🚂'] },
};

export function createGame(ctx: GameContext): IGame {
  // ---- 設定（前回を復元）----
  const saved = ctx.load<Partial<Config>>('config');
  const config: Config = {
    size: saved?.size === 'small' || saved?.size === 'big' ? saved.size : 'normal',
    dup: saved?.dup === true,
    theme: saved?.theme === 'animal' || saved?.theme === 'vehicle' ? saved.theme : 'fruit',
    hint: saved?.hint === true,
  };

  // ---- 状態 ----
  let mode: Mode = 'setup';
  let paused = false; // ポーズ中の入力ガード（シェルのオーバーレイに加える二重防御）
  let secret: number[] = [];
  let emojis: string[] = THEMES[config.theme].emojis;
  let slots = SLOTS[config.size];
  let current: (number | null)[] = []; // 組み立て中の行
  const rows: { guess: number[]; fb: Feedback }[] = [];
  const memoOff = new Set<number>(); // 「ちがう」印を付けたパレット記号（メモ用・見た目だけ）
  let memoMode = false;
  let hintSlot = -1; // ヒントONのとき、公開する1マス
  let usedHint = false;

  let startMs = 0; // プレイ開始時刻（ctx.now基準）
  let finishMs = 0; // クリアタイム
  let resultScore = 0;
  let endAt = 0; // 結果画面へ遷移する時刻（ctx.now基準）
  let ended = false;

  // ---- DOM ----
  const style = document.createElement('style');
  style.textContent = CSS;
  const wrap = document.createElement('div');
  wrap.className = 'hb-wrap';
  ctx.root.append(style, wrap);

  // プレイ画面の要素参照
  let rowsWrap: HTMLElement | null = null;
  let inputRowEl: HTMLElement | null = null;
  let paletteEl: HTMLElement | null = null;
  let submitBtn: HTMLButtonElement | null = null;
  let remainEl: HTMLElement | null = null;
  let clockEl: HTMLElement | null = null;
  let memoBtn: HTMLButtonElement | null = null;

  // 空の入力行（現在のわく数ぶんの null 配列）を作る
  function freshRow(): (number | null)[] {
    return new Array<number | null>(slots).fill(null);
  }

  // ---- 設定画面 ----
  function showSetup(): void {
    mode = 'setup';
    const onoff = (v: boolean): string => (v ? 'on' : 'off');
    const box = elem('div', 'hb-setup');
    box.append(elem('h2', 'hb-h2', 'あんごうを あてよう'));
    box.append(
      makeSeg(
        'hb',
        'もじすう',
        [
          { v: 'small', t: '3もじ' },
          { v: 'normal', t: '4もじ' },
          { v: 'big', t: '5もじ' },
        ],
        () => config.size,
        (v) => {
          config.size = v as SizeKey;
        },
      ),
      makeSeg(
        'hb',
        'かぶり',
        [
          { v: 'off', t: 'なし' },
          { v: 'on', t: 'あり（むずかしい）' },
        ],
        () => onoff(config.dup),
        (v) => {
          config.dup = v === 'on';
        },
      ),
      makeSeg(
        'hb',
        'えもじ',
        [
          { v: 'fruit', t: 'くだもの' },
          { v: 'animal', t: 'どうぶつ' },
          { v: 'vehicle', t: 'のりもの' },
        ],
        () => config.theme,
        (v) => {
          config.theme = v as ThemeKey;
        },
      ),
      makeSeg(
        'hb',
        'ヒント',
        [
          { v: 'off', t: 'なし' },
          { v: 'on', t: 'あり（1マスおしえる）' },
        ],
        () => onoff(config.hint),
        (v) => {
          config.hint = v === 'on';
        },
      ),
    );
    box.append(
      elem('p', 'hb-note', 'かくれた絵文字の ならびを あてよう！「こたえあわせ」で ⭕ズバリ と 🔶おしい の数が わかるよ。'),
    );
    const start = elem('button', 'hb-btn hb-btn-primary hb-btn-lg', 'スタート ▶') as HTMLButtonElement;
    start.addEventListener('click', () => startMatch());
    box.append(start);
    wrap.replaceChildren(box);
  }

  // ---- 対局開始 ----
  function startMatch(): void {
    ctx.save('config', { ...config });
    emojis = THEMES[config.theme].emojis;
    slots = SLOTS[config.size];
    secret = generateSecret(slots, PALETTE_SIZE, config.dup, ctx.random);
    rows.length = 0;
    current = freshRow();
    memoOff.clear();
    memoMode = false;
    usedHint = config.hint;
    hintSlot = config.hint ? Math.floor(ctx.random() * slots) : -1;
    finishMs = 0;
    resultScore = 0;
    ended = false;
    buildPlay();
    mode = 'play';
    startMs = ctx.now();
  }

  function buildPlay(): void {
    const play = elem('div', 'hb-play');

    const top = elem('div', 'hb-top');
    remainEl = elem('div', 'hb-remain');
    clockEl = elem('div', 'hb-clock', '⏱ 0.0秒');
    top.append(remainEl, clockEl);

    const legend = elem('div', 'hb-legend');
    legend.append(
      elem('span', 'hb-legend-item', '⭕ ズバリ＝絵も ばしょも ◎'),
      elem('span', 'hb-legend-item', '🔶 おしい＝絵は あるけど ばしょ ちがい'),
    );

    play.append(top, legend);

    if (config.hint && hintSlot >= 0) {
      const idx = secret[hintSlot] ?? 0;
      play.append(
        elem('div', 'hb-hint', `💡 ヒント：${hintSlot + 1}ばんめは ${emojis[idx] ?? '?'}`),
      );
    }

    rowsWrap = elem('div', 'hb-rows');
    inputRowEl = elem('div', 'hb-input');
    paletteEl = elem('div', 'hb-palette');
    const actions = elem('div', 'hb-actions');
    memoBtn = elem('button', 'hb-btn hb-btn-sub', '📝 メモ') as HTMLButtonElement;
    memoBtn.addEventListener('click', () => toggleMemoMode());
    const clearBtn = elem('button', 'hb-btn hb-btn-sub', '↩ やりなおし') as HTMLButtonElement;
    clearBtn.addEventListener('click', () => clearAll());
    submitBtn = elem('button', 'hb-btn hb-btn-primary', 'こたえあわせ') as HTMLButtonElement;
    submitBtn.addEventListener('click', () => submit());
    actions.append(memoBtn, clearBtn, submitBtn);

    play.append(rowsWrap, inputRowEl, paletteEl, actions);
    wrap.replaceChildren(play);

    rebuildPalette();
    rebuildInputRow();
    updateRemain();
  }

  // ---- 入力（メモOFF＝配置 / メモON＝「ちがう」印の切替）----
  function toggleMemoMode(): void {
    if (mode !== 'play' || paused) return;
    memoMode = !memoMode;
    memoBtn?.classList.toggle('hb-active', memoMode);
    ctx.sfx('tap');
  }

  function rebuildPalette(): void {
    if (!paletteEl) return;
    const children: HTMLElement[] = [];
    for (let p = 0; p < PALETTE_SIZE; p++) {
      const b = elem('button', 'hb-pal', emojis[p] ?? '?') as HTMLButtonElement;
      if (memoOff.has(p)) b.classList.add('hb-ruled');
      b.addEventListener('click', () => onPalette(p));
      children.push(b);
    }
    paletteEl.replaceChildren(...children);
  }

  function onPalette(p: number): void {
    if (mode !== 'play' || paused) return;
    if (memoMode) {
      if (memoOff.has(p)) memoOff.delete(p);
      else memoOff.add(p);
      rebuildPalette();
      ctx.sfx('tick');
      return;
    }
    // いちばん左の空きマスに置く
    const i = current.indexOf(null);
    if (i < 0) return; // 満杯
    current[i] = p;
    ctx.sfx('tap');
    rebuildInputRow();
  }

  function clearSlot(i: number): void {
    if (mode !== 'play' || paused) return;
    if (current[i] == null) return;
    current[i] = null;
    ctx.sfx('tick');
    rebuildInputRow();
  }

  function clearAll(): void {
    if (mode !== 'play' || paused) return;
    if (current.every((v) => v == null)) return;
    current = freshRow();
    ctx.sfx('tick');
    rebuildInputRow();
  }

  function rebuildInputRow(): void {
    if (!inputRowEl) return;
    const children: HTMLElement[] = [];
    for (let i = 0; i < slots; i++) {
      const v = current[i];
      const slot = elem('button', 'hb-slot', v == null ? '' : emojis[v] ?? '?') as HTMLButtonElement;
      if (v == null) slot.classList.add('hb-empty');
      slot.addEventListener('click', () => clearSlot(i));
      children.push(slot);
    }
    inputRowEl.replaceChildren(...children);
    const full = current.every((v) => v != null);
    if (submitBtn) submitBtn.disabled = !full || mode !== 'play';
  }

  function updateRemain(): void {
    if (remainEl) remainEl.textContent = `のこり ${MAX_GUESSES - rows.length} かい`;
  }

  // ---- こたえあわせ ----
  function submit(): void {
    if (mode !== 'play' || paused) return;
    if (current.some((v) => v == null)) return;
    const guess = current.map((v) => v ?? 0);
    const fb = evaluate(secret, guess);
    rows.push({ guess, fb });
    addHistoryRow(rows.length, guess, fb);
    updateRemain();

    if (fb.hits === slots) {
      ctx.sfx('success');
      win();
      return;
    }
    ctx.sfx('tap');
    ctx.haptic('light');
    if (rows.length >= MAX_GUESSES) {
      lose();
      return;
    }
    current = freshRow();
    rebuildInputRow();
  }

  function addHistoryRow(no: number, guess: number[], fb: Feedback): void {
    if (!rowsWrap) return;
    const row = elem('div', 'hb-row');
    row.append(elem('div', 'hb-row-no', String(no)));
    const gEl = elem('div', 'hb-row-slots');
    for (const v of guess) gEl.append(elem('span', 'hb-chip', emojis[v] ?? '?'));
    row.append(gEl);
    const fbEl = elem('div', 'hb-fb');
    if (fb.hits === 0 && fb.blows === 0) {
      fbEl.append(elem('span', 'hb-fb-none', 'ぜんぶ ちがう'));
    } else {
      for (let i = 0; i < fb.hits; i++) fbEl.append(elem('span', 'hb-peg', '⭕'));
      for (let i = 0; i < fb.blows; i++) fbEl.append(elem('span', 'hb-peg', '🔶'));
    }
    row.append(fbEl);
    rowsWrap.append(row);
    rowsWrap.scrollTop = rowsWrap.scrollHeight;
  }

  // ---- 勝敗 ----
  function computeScore(): number {
    const secs = finishMs / 1000;
    const remaining = MAX_GUESSES - rows.length; // rows は正解の行を含む
    let s = remaining * 30 + Math.max(0, 90 - Math.floor(secs));
    if (config.size === 'normal') s += 40;
    else if (config.size === 'big') s += 80;
    if (config.dup) s += 50;
    if (usedHint) s = Math.floor(s * 0.5);
    return Math.max(10, s);
  }

  function win(): void {
    mode = 'win';
    finishMs = ctx.now() - startMs;
    resultScore = computeScore();
    ctx.haptic('success');
    ctx.achieve('first-solve');
    if (rows.length <= 4) ctx.achieve('sharp');
    if (config.size === 'big') ctx.achieve('big-clear');
    if (config.dup) ctx.achieve('dup-clear');
    if (!usedHint) ctx.achieve('no-hint');
    if (finishMs <= 60_000) ctx.achieve('speedy');
    showResult(true);
    endAt = ctx.now() + END_DELAY_WIN;
    if (submitBtn) submitBtn.disabled = true;
  }

  function lose(): void {
    mode = 'lose';
    resultScore = 0;
    ctx.sfx('fail');
    ctx.haptic('error');
    showResult(false);
    endAt = ctx.now() + END_DELAY_LOSE;
    if (submitBtn) submitBtn.disabled = true;
  }

  function showResult(won: boolean): void {
    const card = elem('div', 'hb-over');
    card.append(
      elem('div', 'hb-over-title ' + (won ? 'hb-win' : 'hb-lose'), won ? 'せいかい！ 🎉' : 'ざんねん…'),
    );
    if (!won) card.append(elem('div', 'hb-over-sub', 'こたえは これ！'));
    const ans = elem('div', 'hb-over-answer');
    for (const v of secret) ans.append(elem('span', 'hb-chip hb-chip-lg', emojis[v] ?? '?'));
    card.append(ans);
    if (won) {
      const t = (finishMs / 1000).toFixed(1);
      card.append(elem('div', 'hb-over-sub', `${rows.length}かいで せいかい！ ⏱ ${t}秒`));
    }
    wrap.append(card);
  }

  // ---- 毎フレーム（ライブ時計＋結果画面への遷移。すべて ctx.now 基準＝ポーズで停止）----
  const offFrame = ctx.onFrame(() => {
    const now = ctx.now();
    if (mode === 'play') {
      const t = ((now - startMs) / 1000).toFixed(1);
      const label = `⏱ ${t}秒`;
      if (clockEl && clockEl.textContent !== label) clockEl.textContent = label;
    } else if ((mode === 'win' || mode === 'lose') && !ended && now >= endAt) {
      ended = true;
      ctx.end({ score: resultScore });
    }
  });

  // ---- 起動 ----
  // startMode:'immediate' なので start() 直後にこの画面が出る
  showSetup();

  return {
    start() {
      // シェルのカウントダウンは省略。設定画面（showSetup）から開始する
    },
    pause() {
      paused = true;
    },
    resume() {
      paused = false;
    },
    resize() {
      // レイアウトは CSS 依存のため処理不要
    },
    destroy() {
      offFrame();
      style.remove();
      wrap.remove();
    },
  };
}

// =============================================================
// スタイル（.hb- プレフィックス。テーマ変数でライト/ダーク両対応）
// =============================================================
const CSS = `
.hb-wrap{position:absolute;inset:0;overflow:hidden}
.hb-btn{appearance:none;border:none;border-radius:12px;padding:12px 18px;font-size:15px;font-weight:800;
  background:var(--bg-elev2);color:var(--text);min-height:44px}
.hb-btn:disabled{opacity:.4}
.hb-btn-primary{background:var(--accent-grad);color:#fff}
.hb-btn-lg{width:100%;max-width:300px;font-size:18px}
.hb-btn-sub{flex:0 0 auto;padding:10px 14px;font-size:14px}
.hb-btn-sub.hb-active{outline:2px solid var(--accent);background:var(--accent);color:#fff}

/* 設定画面 */
.hb-setup{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:flex-start;
  gap:14px;padding:20px 16px;box-sizing:border-box;overflow:auto;user-select:none;-webkit-user-select:none}
.hb-h2{margin:4px 0;font-size:22px}
.hb-seg-row{width:min(92vw,420px);display:flex;flex-direction:column;gap:6px}
.hb-seg-label{font-size:13px;color:var(--text-dim);font-weight:800}
.hb-seg{display:flex;background:var(--bg-elev2);border-radius:12px;padding:3px;gap:2px}
.hb-seg-btn{flex:1;border:none;background:none;color:var(--text-dim);padding:10px 4px;border-radius:9px;
  font-size:13px;font-weight:800;min-height:44px}
.hb-seg-btn.hb-on{background:var(--accent);color:#fff}
.hb-note{font-size:12px;color:var(--text-dim);text-align:center;max-width:min(92vw,420px);margin:0}

/* プレイ画面 */
.hb-play{position:absolute;inset:0;display:flex;flex-direction:column;gap:8px;padding:8px 10px 10px;
  box-sizing:border-box;user-select:none;-webkit-user-select:none}
.hb-top{display:flex;align-items:center;justify-content:center;gap:16px;padding:2px 64px 0;min-height:24px}
.hb-remain{font-size:15px;font-weight:800}
.hb-clock{font-size:14px;color:var(--text-dim);font-weight:700}
.hb-legend{display:flex;flex-wrap:wrap;justify-content:center;gap:4px 12px;font-size:11px;color:var(--text-dim);line-height:1.3}
.hb-hint{align-self:center;background:var(--bg-elev);border-radius:999px;padding:5px 14px;font-size:13px;font-weight:800;
  box-shadow:var(--shadow)}

.hb-rows{flex:1 1 auto;min-height:0;overflow-y:auto;display:flex;flex-direction:column;gap:5px;padding:2px}
.hb-row{display:flex;align-items:center;gap:8px;background:var(--bg-elev);border-radius:12px;padding:5px 8px}
.hb-row-no{flex:0 0 auto;width:20px;text-align:center;font-size:12px;font-weight:800;color:var(--text-dim)}
.hb-row-slots{display:flex;gap:4px;flex:1 1 auto}
.hb-chip{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;font-size:21px;line-height:1}
.hb-chip-lg{width:40px;height:40px;font-size:30px}
.hb-fb{display:flex;flex-wrap:wrap;gap:1px;align-items:center;justify-content:flex-end;flex:0 0 auto;max-width:40%}
.hb-peg{font-size:14px;line-height:1}
.hb-fb-none{font-size:11px;color:var(--text-dim);font-weight:700}

/* 入力行・パレット */
.hb-input{display:flex;gap:6px;justify-content:center;padding:2px 0}
.hb-slot{width:min(15vw,54px);height:min(15vw,54px);border-radius:12px;border:none;background:var(--bg-elev2);
  font-size:29px;line-height:1;display:flex;align-items:center;justify-content:center}
.hb-slot.hb-empty{background:transparent;border:2px dashed var(--cell-empty)}
.hb-palette{display:flex;gap:6px;justify-content:center;flex-wrap:wrap}
.hb-pal{width:min(14vw,50px);height:min(14vw,50px);border-radius:12px;border:none;background:var(--bg-elev2);
  font-size:27px;line-height:1;display:flex;align-items:center;justify-content:center;position:relative}
.hb-pal.hb-ruled{opacity:.38}
.hb-pal.hb-ruled::after{content:'✕';position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
  font-size:30px;color:var(--danger);font-weight:900}
.hb-actions{display:flex;gap:8px;align-items:stretch}
.hb-actions .hb-btn-primary{flex:1 1 auto}

/* 結果カード（盤の上にかぶせる・操作は吸わない） */
.hb-over{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);display:flex;flex-direction:column;
  align-items:center;gap:10px;padding:22px 34px;text-align:center;background:var(--bg-elev);border-radius:20px;
  box-shadow:var(--shadow);pointer-events:none;animation:hb-appear .25s ease-out;max-width:90vw}
@keyframes hb-appear{from{opacity:0;transform:translate(-50%,-46%)}to{opacity:1;transform:translate(-50%,-50%)}}
.hb-over-title{font-size:27px;font-weight:900}
.hb-win{color:var(--gold)}
.hb-lose{color:var(--text-dim)}
.hb-over-sub{font-size:15px;font-weight:700;color:var(--text-dim)}
.hb-over-answer{display:flex;gap:6px}
`;
