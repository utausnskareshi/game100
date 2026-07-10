// =============================================================
// ほりほりたからじま（No.6）: すなをほって たからを集める推理パズル
// =============================================================
// - 数字＝まわり8マスのばくだんの数。ばくだん以外をぜんぶひらけばクリア
// - 独自ルール: ⭐スタートマス（必ず安全に大きくひらける）/ 🛡️おまもり（ばくだんを1回だけ自動防御）/
//   🔍レーダー（えらんだ3×3のばくだんに旗）/ ⛏️ビッグシャベル（えらんだ3×3の安全マスを一括ほり）/
//   💎埋蔵たから（ほると得点。まけても持ち帰れる）
// - 時間は ctx.now・乱数は ctx.random・勝敗後の遷移は onFrame＋期限方式（setTimeout 不使用）
// - import してよいのは game-api（types / helpers）と、このフォルダ内（engine）だけ
import type { GameContext, IGame } from '../../game-api/types';
import { elem, makeSeg } from '../../game-api/helpers';
import {
  BOMB,
  ITEM_RADAR,
  ITEM_SHIELD,
  ITEM_SHOVEL,
  TREASURE,
  floodReveal,
  generateBoard,
  neighborsOf,
  type Board,
} from './engine';

type SizeKey = 'small' | 'normal' | 'big';
type Mode = 'setup' | 'play' | 'win' | 'lose';
type Tool = 'dig' | 'flag' | 'radar' | 'shovel';

interface Config {
  size: SizeKey;
}

const END_DELAY_WIN = 1800; // クリア演出→結果画面までの余韻(ms・ctx.now基準)
const END_DELAY_LOSE = 2600; // ばくだんの場所を見せるぶん長め
const GEM_SCORE = 20; // 💎1つの得点（まけても持ち帰れる）
const CLEAR_BASE = 200;
const NO_SHIELD_BONUS = 50;
const SPEED_FROM = 240; // この秒数より早いほどボーナス（×1点/秒）

// 盤面プリセット（数値はすべて playtest 調整前提の仮値）
const SIZES: Record<
  SizeKey,
  {
    cols: number;
    rows: number;
    bombs: number;
    treasures: number;
    radars: number;
    shovels: number;
    shields: number;
    startShield: number;
    bonus: number;
  }
> = {
  small: { cols: 8, rows: 10, bombs: 10, treasures: 6, radars: 1, shovels: 1, shields: 0, startShield: 1, bonus: 0 },
  normal: { cols: 8, rows: 12, bombs: 15, treasures: 8, radars: 1, shovels: 1, shields: 1, startShield: 1, bonus: 80 },
  big: { cols: 9, rows: 13, bombs: 22, treasures: 10, radars: 2, shovels: 1, shields: 1, startShield: 1, bonus: 200 },
};

export function createGame(ctx: GameContext): IGame {
  // ---- 設定（前回を復元。はじめての人向けに既定は「ちいさい」）----
  const saved = ctx.load<Partial<Config>>('config');
  const config: Config = {
    size: saved?.size === 'normal' || saved?.size === 'big' ? saved.size : 'small',
  };

  // ---- 状態 ----
  let mode: Mode = 'setup';
  let hostPaused = false; // ポーズ中の入力ガード（シェルのオーバーレイに加える二重防御）
  let tool: Tool = 'dig';
  let board: Board | null = null;
  let revealed = new Uint8Array(0);
  let flags = new Uint8Array(0);
  const defused = new Set<number>(); // 🛡️で無力化したばくだん
  let safeTotal = 0;
  let revealedSafe = 0;
  let totalTreasures = 0;
  let gems = 0;
  let flagCount = 0;
  const inv = { shield: 0, radar: 0, shovel: 0 };
  let usedShield = false;
  let markerUsed = false; // 🚩かレーダーを使ったか（「はたいらず」実績用）
  let boomAt = -1;

  let t0: number | null = null; // 最初の操作の時刻（ctx.now基準）
  let finishMs = 0;
  let resultScore = 0;
  let endAt = 0;
  let ended = false;
  let bannerUntil = 0;

  // ---- DOM ----
  const style = document.createElement('style');
  style.textContent = CSS;
  const wrap = elem('div', 'td-wrap');
  ctx.root.append(style, wrap);

  let cells: HTMLButtonElement[] = [];
  let playEl: HTMLElement | null = null;
  let hudEl: HTMLElement | null = null;
  let timeEl: HTMLElement | null = null;
  let bombsEl: HTMLElement | null = null;
  let gemsEl: HTMLElement | null = null;
  let boardWrap: HTMLElement | null = null;
  let boardEl: HTMLElement | null = null;
  let toolsEl: HTMLElement | null = null;
  let digBtn: HTMLButtonElement | null = null;
  let flagBtn: HTMLButtonElement | null = null;
  let shieldEl: HTMLElement | null = null;
  let radarBtn: HTMLButtonElement | null = null;
  let shovelBtn: HTMLButtonElement | null = null;
  let bannerEl: HTMLElement | null = null;

  // ---- 設定画面 ----
  function showSetup(): void {
    mode = 'setup';
    const box = elem('div', 'td-setup');
    box.append(elem('h2', 'td-h2', 'たからの島を ほりまくろう！'));
    box.append(
      makeSeg(
        'td',
        '島のおおきさ',
        [
          { v: 'small', t: 'ちいさい' },
          { v: 'normal', t: 'ふつう' },
          { v: 'big', t: 'おおきい' },
        ],
        () => config.size,
        (v) => {
          config.size = v as SizeKey;
        },
      ),
    );
    box.append(
      elem(
        'p',
        'td-note',
        '数字は「まわり8マスにある ばくだん💣の数」。⭐のマスからほると あんぜんだよ。💎をほりあてると得点アップ！',
      ),
    );
    const start = elem('button', 'td-btn td-btn-primary td-btn-lg', 'しゅっぱつ ▶') as HTMLButtonElement;
    start.addEventListener('click', () => startMatch());
    box.append(start);
    wrap.replaceChildren(box);
  }

  // ---- 開始 ----
  function startMatch(): void {
    ctx.save('config', { ...config });
    const preset = SIZES[config.size];
    board = generateBoard({
      cols: preset.cols,
      rows: preset.rows,
      bombs: preset.bombs,
      treasures: preset.treasures,
      radars: preset.radars,
      shovels: preset.shovels,
      shields: preset.shields,
      rng: ctx.random,
    });
    const n = board.cols * board.rows;
    revealed = new Uint8Array(n);
    flags = new Uint8Array(n);
    defused.clear();
    safeTotal = n - board.bombs;
    revealedSafe = 0;
    totalTreasures = preset.treasures;
    gems = 0;
    flagCount = 0;
    inv.shield = preset.startShield;
    inv.radar = 0;
    inv.shovel = 0;
    usedShield = false;
    markerUsed = false;
    boomAt = -1;
    t0 = null;
    finishMs = 0;
    resultScore = 0;
    ended = false;
    tool = 'dig';
    // buildPlay 内の paintTools/updateHud が「プレイ中」の状態で描けるよう、mode を先に切り替える
    mode = 'play';
    buildPlay();
  }

  function buildPlay(): void {
    if (!board) return;
    playEl = elem('div', 'td-play');

    hudEl = elem('div', 'td-hud');
    timeEl = elem('span', 'td-hud-item', '⏱ 0.0');
    bombsEl = elem('span', 'td-hud-item', '');
    gemsEl = elem('span', 'td-hud-item', '');
    hudEl.append(timeEl, bombsEl, gemsEl);

    boardWrap = elem('div', 'td-board-wrap');
    boardEl = elem('div', 'td-board');
    cells = [];
    const n = board.cols * board.rows;
    for (let i = 0; i < n; i++) {
      const idx = i;
      const cell = elem('button', 'td-cell') as HTMLButtonElement;
      cell.addEventListener('click', () => onCell(idx));
      cells.push(cell);
      boardEl.append(cell);
      paintCell(idx);
    }
    boardWrap.append(boardEl);

    toolsEl = elem('div', 'td-tools');
    digBtn = elem('button', 'td-tool', '👆 ほる') as HTMLButtonElement;
    digBtn.addEventListener('click', () => {
      ctx.sfx('tick');
      if (tool === 'radar' || tool === 'shovel') hideBanner(); // 照準バナーを残さない
      setTool('dig');
    });
    flagBtn = elem('button', 'td-tool', '🚩 はた') as HTMLButtonElement;
    flagBtn.addEventListener('click', () => {
      ctx.sfx('tick');
      if (tool === 'radar' || tool === 'shovel') hideBanner(); // 照準バナーを残さない
      setTool('flag');
    });
    shieldEl = elem('span', 'td-shield', '');
    radarBtn = elem('button', 'td-item', '') as HTMLButtonElement;
    radarBtn.addEventListener('click', () => toggleTargeting('radar'));
    shovelBtn = elem('button', 'td-item', '') as HTMLButtonElement;
    shovelBtn.addEventListener('click', () => toggleTargeting('shovel'));
    toolsEl.append(digBtn, flagBtn, elem('span', 'td-tools-sep'), shieldEl, radarBtn, shovelBtn);

    playEl.append(hudEl, boardWrap, toolsEl);
    wrap.replaceChildren(playEl);
    // レイアウト計測はツールバーのボタン文言・HUDのテキストを入れてから行う
    // （空のまま測るとツールバーの折り返し前の低い高さで計算し、盤面が縦にあふれる）
    paintTools();
    updateHud();
    layout();
  }

  // セルの一辺を「幅・高さの両方に収まる」ように計算する（おおきい島は端末によって44px未満＝既知の設計トレードオフ）。
  // 盤面自身の gap(1px×マス間) と padding(3px×2) も差し引いて、縦のあふれを防ぐ（GAP/PAD 定数と CSS を一致させる）
  function layout(): void {
    if (!board || !playEl || !boardEl || !hudEl || !toolsEl) return;
    const GAP = 1; // .td-board の gap と一致させること
    const PAD = 6; // .td-board の padding 3px × 2
    const availW = playEl.clientWidth - 8 - (board.cols - 1) * GAP - PAD;
    const availH =
      playEl.clientHeight - hudEl.offsetHeight - toolsEl.offsetHeight - 26 - (board.rows - 1) * GAP - PAD;
    const cell = Math.max(22, Math.floor(Math.min(availW / board.cols, availH / board.rows)));
    boardEl.style.gridTemplateColumns = `repeat(${board.cols}, ${cell}px)`;
    boardEl.style.gridAutoRows = `${cell}px`;
    boardEl.style.fontSize = `${Math.round(cell * 0.52)}px`;
  }

  // ---- 描画 ----
  function paintCell(i: number): void {
    const el = cells[i];
    if (!el || !board) return;
    el.className = 'td-cell';
    el.textContent = '';
    if (defused.has(i)) {
      el.classList.add('td-defused');
      el.textContent = '🛡️';
      return;
    }
    if (mode === 'lose' && board.content[i] === BOMB && !flags[i]) {
      el.classList.add(i === boomAt ? 'td-boom' : 'td-bombshow');
      el.textContent = i === boomAt ? '💥' : '💣';
      return;
    }
    if (!revealed[i]) {
      el.classList.add('td-hidden');
      if (flags[i]) {
        el.classList.add('td-flag');
        el.textContent = '🚩';
      } else if (i === board.start) {
        el.classList.add('td-star');
        el.textContent = '⭐';
      }
      return;
    }
    el.classList.add('td-open');
    const c = board.content[i];
    const found = c === TREASURE || c === ITEM_RADAR || c === ITEM_SHOVEL || c === ITEM_SHIELD;
    if (found) el.classList.add('td-found');
    const n = board.counts[i] ?? 0;
    if (n > 0) {
      el.classList.add(`td-n${n}`);
      el.textContent = String(n);
    } else if (c === TREASURE) {
      el.classList.add('td-ghost');
      el.textContent = '💎';
    } else if (c === ITEM_RADAR) {
      el.classList.add('td-ghost');
      el.textContent = '🔍';
    } else if (c === ITEM_SHOVEL) {
      el.classList.add('td-ghost');
      el.textContent = '⛏️';
    } else if (c === ITEM_SHIELD) {
      el.classList.add('td-ghost');
      el.textContent = '🛡️';
    }
  }

  function updateHud(): void {
    if (!board) return;
    const left = Math.max(0, board.bombs - flagCount - defused.size);
    if (bombsEl) bombsEl.textContent = `💣 のこり ${left}`;
    if (gemsEl) gemsEl.textContent = `💎 ${gems}/${totalTreasures}`;
    if (shieldEl) shieldEl.textContent = `🛡️×${inv.shield}`;
    paintTools();
  }

  function paintTools(): void {
    const playing = mode === 'play';
    digBtn?.classList.toggle('td-on', tool === 'dig');
    flagBtn?.classList.toggle('td-on', tool === 'flag');
    if (radarBtn) {
      radarBtn.textContent = `🔍 レーダー ×${inv.radar}`;
      radarBtn.classList.toggle('td-active', tool === 'radar');
      radarBtn.disabled = !playing || inv.radar <= 0;
    }
    if (shovelBtn) {
      shovelBtn.textContent = `⛏️ シャベル ×${inv.shovel}`;
      shovelBtn.classList.toggle('td-active', tool === 'shovel');
      shovelBtn.disabled = !playing || inv.shovel <= 0;
    }
  }

  // 効果音は「ユーザーがボタンを押したとき」だけ鳴らす（アイテム使用後の自動復帰では鳴らさない）
  function setTool(t: Tool): void {
    if (mode !== 'play' || hostPaused) return;
    tool = t;
    paintTools();
  }

  function toggleTargeting(t: 'radar' | 'shovel'): void {
    if (mode !== 'play' || hostPaused) return;
    if (tool === t) {
      ctx.sfx('tick');
      setTool('dig'); // もう一度おすとキャンセル
      hideBanner();
      return;
    }
    if ((t === 'radar' && inv.radar <= 0) || (t === 'shovel' && inv.shovel <= 0)) return;
    tool = t;
    ctx.sfx('tick');
    showBanner(t === 'radar' ? '🔍 しらべる ばしょを タップ！' : '⛏️ ほる ばしょを タップ！', 60_000);
    paintTools();
  }

  // ---- バナー（onFrame の期限で自動的に消える） ----
  function showBanner(text: string, ms: number): void {
    hideBanner();
    if (!boardWrap) return;
    bannerEl = elem('div', 'td-banner', text);
    boardWrap.append(bannerEl);
    bannerUntil = ctx.now() + ms;
  }

  function hideBanner(): void {
    bannerEl?.remove();
    bannerEl = null;
    bannerUntil = 0;
  }

  // ---- 操作 ----
  function onCell(i: number): void {
    if (mode !== 'play' || hostPaused || !board) return;
    if (t0 == null) t0 = ctx.now();
    if (tool === 'radar') {
      if (inv.radar > 0) useRadarAt(i);
      return;
    }
    if (tool === 'shovel') {
      if (inv.shovel > 0) useShovelAt(i);
      return;
    }
    if (revealed[i]) {
      tryChord(i);
      return;
    }
    if (tool === 'flag') {
      flags[i] = flags[i] ? 0 : 1;
      if (flags[i]) {
        flagCount++;
        markerUsed = true;
      } else {
        flagCount--;
      }
      ctx.sfx('tick');
      paintCell(i);
      updateHud();
      return;
    }
    if (flags[i]) return; // 旗のマスはほれない（ごばく防止）
    digCell(i, false);
  }

  /** 1マスほる。quiet=true のときは効果音を呼び出し側にまかせる */
  function digCell(i: number, quiet: boolean): void {
    if (mode !== 'play' || !board || revealed[i] || flags[i] || defused.has(i)) return;
    if (board.content[i] === BOMB) {
      if (inv.shield > 0) {
        inv.shield--;
        usedShield = true;
        defused.add(i);
        paintCell(i);
        updateHud();
        ctx.sfx('combo');
        ctx.haptic('medium');
        showBanner('🛡️ おまもりが まもってくれた！', 1400);
        return;
      }
      explode(i);
      return;
    }
    const opened = floodReveal(board, revealed, flags, i);
    let pickups = 0;
    for (const idx of opened) {
      revealed[idx] = 1;
      const c = board.content[idx];
      if (c === TREASURE) {
        gems++;
        pickups++;
      } else if (c === ITEM_RADAR) {
        inv.radar++;
        pickups++;
      } else if (c === ITEM_SHOVEL) {
        inv.shovel++;
        pickups++;
      } else if (c === ITEM_SHIELD) {
        inv.shield++;
        pickups++;
      }
      paintCell(idx);
    }
    revealedSafe += opened.length;
    if (!quiet) ctx.sfx(opened.length > 6 ? 'combo' : 'tap');
    if (pickups > 0) {
      ctx.sfx('powerup');
      ctx.haptic('light');
      showBanner('✨ なにか ほりあてた！', 1000);
    }
    updateHud();
    checkWin();
  }

  /** ひらいた数字タップ: 旗＋🛡️の数がそろっていたら、まわりのかくれマスを一気にほる */
  function tryChord(i: number): void {
    if (!board) return;
    const cnt = board.counts[i] ?? 0;
    if (cnt === 0) return;
    let marked = 0;
    const targets: number[] = [];
    for (const nb of neighborsOf(i, board.cols, board.rows)) {
      if (flags[nb] || defused.has(nb)) marked++;
      else if (!revealed[nb]) targets.push(nb);
    }
    if (marked !== cnt || targets.length === 0) return;
    ctx.sfx('tap');
    for (const t of targets) {
      if (mode !== 'play') break; // とちゅうで爆発したら中断
      digCell(t, true);
    }
  }

  function useRadarAt(center: number): void {
    if (!board) return;
    inv.radar--;
    markerUsed = true;
    let found = 0;
    for (const i of [center, ...neighborsOf(center, board.cols, board.rows)]) {
      if (board.content[i] === BOMB && !flags[i] && !defused.has(i) && !revealed[i]) {
        flags[i] = 1;
        flagCount++;
        found++;
        paintCell(i);
      }
    }
    ctx.sfx('powerup');
    showBanner(found > 0 ? `🔍 ばくだん ${found}こに 旗を立てた！` : '🔍 ここに ばくだんは ない！', 1600);
    setTool('dig');
    updateHud();
  }

  function useShovelAt(center: number): void {
    if (!board) return;
    const targets: number[] = [];
    for (const i of [center, ...neighborsOf(center, board.cols, board.rows)]) {
      if (!revealed[i] && !flags[i] && !defused.has(i) && board.content[i] !== BOMB) targets.push(i);
    }
    if (targets.length === 0) {
      // なにもほれない場所ならアイテムは消費しない（子どもの誤タップ救済）
      showBanner('ここには ほれるところが ないよ', 1400);
      setTool('dig');
      return;
    }
    inv.shovel--;
    for (const t of targets) {
      if (mode !== 'play') break;
      digCell(t, true);
    }
    if (mode === 'play') ctx.sfx('combo');
    setTool('dig');
    updateHud();
  }

  // ---- 勝敗 ----
  function elapsedMs(): number {
    return t0 == null ? 0 : ctx.now() - t0;
  }

  function computeScore(): number {
    const secs = Math.floor(finishMs / 1000);
    let s = CLEAR_BASE + gems * GEM_SCORE + Math.max(0, SPEED_FROM - secs);
    s += SIZES[config.size].bonus;
    if (!usedShield) s += NO_SHIELD_BONUS;
    return s;
  }

  function checkWin(): void {
    if (mode !== 'play' || revealedSafe < safeTotal) return;
    mode = 'win';
    finishMs = elapsedMs();
    resultScore = computeScore();
    ctx.achieve('first-clear');
    if (!usedShield) ctx.achieve('no-shield');
    if (config.size === 'big') ctx.achieve('big-clear');
    if (finishMs <= 60_000) ctx.achieve('speedy');
    if (!markerUsed) ctx.achieve('no-flag');
    // 3サイズ制覇（インスタンスをまたいで ctx.save で記録。maze の all-sizes と同じパターン）
    const clearedSizes = ctx.load<Record<string, boolean>>('cleared') ?? {};
    clearedSizes[config.size] = true;
    ctx.save('cleared', clearedSizes);
    if (clearedSizes.small && clearedSizes.normal && clearedSizes.big) ctx.achieve('all-sizes');
    // のこりのばくだんに旗を立てて見た目を仕上げる（実績判定の後）
    if (board) {
      for (let i = 0; i < board.cols * board.rows; i++) {
        if (board.content[i] === BOMB && !flags[i] && !defused.has(i)) {
          flags[i] = 1;
          flagCount++;
          paintCell(i);
        }
      }
    }
    ctx.sfx('success');
    ctx.haptic('success');
    showBanner('🎉 島をぜんぶ ほった！', END_DELAY_WIN - 200);
    endAt = ctx.now() + END_DELAY_WIN;
    updateHud();
  }

  function explode(i: number): void {
    if (!board) return;
    mode = 'lose';
    boomAt = i;
    finishMs = elapsedMs();
    resultScore = gems * GEM_SCORE; // まけても💎ぶんは持ち帰れる
    for (let k = 0; k < board.cols * board.rows; k++) {
      if (board.content[k] === BOMB) paintCell(k);
    }
    ctx.sfx('fail');
    ctx.haptic('error');
    showBanner(gems > 0 ? `💥 ばくだん…！ 💎×${gems} は持ち帰った` : '💥 ばくだんだった…', END_DELAY_LOSE - 200);
    endAt = ctx.now() + END_DELAY_LOSE;
    updateHud();
  }

  // ---- 毎フレーム（タイマー表示・バナー期限・結果画面への遷移。すべて ctx.now 基準＝ポーズで停止）----
  const offFrame = ctx.onFrame(() => {
    const now = ctx.now();
    if (bannerEl && now >= bannerUntil) hideBanner();
    if (mode === 'play') {
      const t = (elapsedMs() / 1000).toFixed(1);
      const label = `⏱ ${t}`;
      if (timeEl && timeEl.textContent !== label) timeEl.textContent = label;
    } else if ((mode === 'win' || mode === 'lose') && !ended && now >= endAt) {
      ended = true;
      ctx.end({ score: resultScore });
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
      layout();
    },
    destroy() {
      offFrame();
      style.remove();
      wrap.remove();
    },
  };
}

// =============================================================
// スタイル（.td- プレフィックス。盤面は砂浜の固定パレット・UIはテーマ変数）
// =============================================================
const CSS = `
.td-wrap{position:absolute;inset:0;overflow:hidden}

/* 設定画面（テーマ追従。低い画面でもスクロールできる safe center 方式） */
.td-setup{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:safe center;
  gap:14px;padding:20px 16px;box-sizing:border-box;overflow-y:auto;user-select:none;-webkit-user-select:none}
.td-h2{margin:4px 0;font-size:22px}
.td-seg-row{width:min(92vw,420px);display:flex;flex-direction:column;gap:6px}
.td-seg-label{font-size:13px;color:var(--text-dim);font-weight:800}
.td-seg{display:flex;background:var(--bg-elev2);border-radius:12px;padding:3px;gap:2px}
.td-seg-btn{flex:1;border:none;background:none;color:var(--text-dim);padding:10px 4px;border-radius:9px;
  font-size:14px;font-weight:800;min-height:44px}
.td-seg-btn.td-on{background:var(--accent);color:#fff}
.td-note{font-size:12px;color:var(--text-dim);text-align:center;max-width:min(92vw,420px);margin:0;line-height:1.7}
.td-btn{appearance:none;border:none;border-radius:12px;padding:12px 18px;font-size:15px;font-weight:800;
  background:var(--bg-elev2);color:var(--text);min-height:44px}
.td-btn-primary{background:var(--accent-grad);color:#fff}
.td-btn-lg{width:100%;max-width:300px;font-size:18px}

/* プレイ画面 */
.td-play{position:absolute;inset:0;display:flex;flex-direction:column;padding:6px 4px 10px;box-sizing:border-box;
  user-select:none;-webkit-user-select:none}
/* min-height 54px（+上padding 6px）で盤面エリアを root の60px以深から始め、
   ポーズボタン予約領域（右上60×60）を構造的によける（レイアウト計算に依存しない保証） */
.td-hud{display:flex;justify-content:center;align-items:center;gap:14px;padding:2px 64px 6px;flex-wrap:wrap;min-height:54px}
.td-hud-item{font-size:14px;font-weight:800;white-space:nowrap}
.td-board-wrap{flex:1 1 auto;min-height:0;display:flex;align-items:center;justify-content:center;position:relative}
.td-board{display:grid;gap:1px;background:#8a6a3b;padding:3px;border-radius:10px;box-shadow:0 6px 20px rgba(0,0,0,.3)}

/* マス（砂浜の固定パレット＝ライト/ダーク共通） */
.td-cell{border:none;padding:0;margin:0;display:flex;align-items:center;justify-content:center;border-radius:5px;
  font-weight:900;line-height:1;font-family:inherit}
.td-hidden{background:linear-gradient(180deg,#f0cd8a,#dcb069);box-shadow:inset 0 -3px 0 rgba(0,0,0,.16)}
.td-hidden:active{filter:brightness(.93)}
.td-star{font-size:.72em}
.td-flag{font-size:.72em}
.td-open{background:#c19a58;box-shadow:inset 0 2px 4px rgba(0,0,0,.24)}
.td-found{background:#ddb964}
.td-ghost{opacity:.6;font-size:.7em}
.td-n1{color:#1d4ed8}.td-n2{color:#166534}.td-n3{color:#dc2626}.td-n4{color:#6d28d9}
.td-n5{color:#9a3412}.td-n6{color:#0e7490}.td-n7{color:#1f2937}.td-n8{color:#57534e}
.td-defused{background:#7dd3fc;font-size:.72em;box-shadow:inset 0 2px 4px rgba(0,0,0,.2)}
.td-bombshow{background:#fca5a5;font-size:.78em}
.td-boom{background:#ef4444;font-size:.78em}

/* バナー（盤の上・タップは吸わない） */
.td-banner{position:absolute;left:50%;top:42%;transform:translate(-50%,-50%);background:rgba(16,19,48,.9);color:#fff;
  padding:10px 18px;border-radius:999px;font-weight:800;font-size:15px;pointer-events:none;white-space:nowrap;z-index:5;
  animation:td-pop .18s ease-out;max-width:94%;overflow:hidden;text-overflow:ellipsis}
@keyframes td-pop{from{opacity:0;transform:translate(-50%,-40%)}to{opacity:1;transform:translate(-50%,-50%)}}

/* 下部ツールバー（テーマ追従・44px基準） */
.td-tools{display:flex;gap:6px;align-items:stretch;justify-content:center;padding-top:8px;flex-wrap:wrap}
.td-tool,.td-item{appearance:none;border:none;border-radius:12px;min-height:44px;padding:8px 12px;
  font-size:13px;font-weight:800;background:var(--bg-elev2);color:var(--text)}
.td-tool.td-on{background:var(--accent);color:#fff}
.td-item.td-active{outline:2px solid var(--accent-2);background:var(--accent-2);color:#04222b}
.td-item:disabled{opacity:.4}
.td-tools-sep{width:6px}
.td-shield{display:inline-flex;align-items:center;font-size:13px;font-weight:800;padding:0 4px}
`;
