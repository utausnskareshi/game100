// =============================================================
// スタードロップ（No.15）: 落ちものパズルのアレンジ（⭐スター＋💣ボム）
// =============================================================
// - 4マスのブロックを落として横1列そろえて消す。積み上がって天井に着いたら終了。
// - ⭐を含む列を消すとボーナス。💣は着地でまわり3×3を消して列を詰める（救済）。
// - 操作は画面下のボタン（◀ ▶ / ⟳まわす / ⬇ / ⤓ストン）。長押しで連続移動。
// - ブロック順・⭐/💣は ctx.random（日替わりは全員同じ）。落下は ctx.now 期限方式・setTimeout不使用
// - import してよいのは game-api（types / helpers）と、このフォルダ内（engine）だけ
import type { GameContext, IGame } from '../../game-api/types';
import { elem, makeSeg } from '../../game-api/helpers';
import {
  makeBoard,
  cells as shapeCells,
  collides,
  lock,
  clearLines,
  bombExplode,
  dropY,
  COLORS,
  COLOR_OF,
  TYPES,
  type Board,
  type PieceType,
} from './engine';

const COLS = 8;
const ROWS = 16;
type SpeedKey = 'slow' | 'normal' | 'fast';
type Mode = 'setup' | 'play' | 'over';
interface Config {
  speed: SpeedKey;
}
interface Piece {
  type: PieceType;
  special: number; // 0=なし / 1=⭐ / 2=💣
  specialIdx: number;
}

const SPEED: Record<SpeedKey, { base: number; label: string }> = {
  slow: { base: 820, label: 'おそい' },
  normal: { base: 640, label: 'ふつう' },
  fast: { base: 480, label: 'はやい' },
};
const LINE_PTS = [0, 100, 300, 500, 800];
const P_STAR = 0.16;
const P_BOMB = 0.09;
const DAS = 230; // 長押し開始までの待ち(ms)
const ARR = 85; // 長押し中のくり返し間隔(ms)
const END_DELAY = 1900;
const SCORE_HI = 2000; // score-hi 実績のしきい値（仮）

export function createGame(ctx: GameContext): IGame {
  const saved = ctx.load<Partial<Config>>('config');
  const config: Config = { speed: saved?.speed === 'slow' || saved?.speed === 'fast' ? saved.speed : 'normal' };

  let mode: Mode = 'setup';
  let hostPaused = false;
  let speed: SpeedKey = config.speed;
  let board: Board = makeBoard(COLS, ROWS);
  let cur: { p: Piece; state: number; px: number; py: number } | null = null;
  let nextP: Piece = genPiece();
  let score = 0;
  let lines = 0;
  let stars = 0;
  let gravityAt = 0;
  let held: 'L' | 'R' | 'D' | null = null;
  let heldNext = 0;
  let endAt = 0;
  let ended = false;
  let bannerUntil = 0;

  const style = document.createElement('style');
  style.textContent = CSS;
  const wrap = elem('div', 'sd-wrap');
  ctx.root.append(style, wrap);

  let wellEl: HTMLElement | null = null;
  let wellCells: HTMLElement[] = [];
  let nextCells: HTMLElement[] = [];
  let hudEl: HTMLElement | null = null;
  let controlsEl: HTMLElement | null = null;
  let scoreEl: HTMLElement | null = null;
  let levelEl: HTMLElement | null = null;
  let starEl: HTMLElement | null = null;
  let bannerEl: HTMLElement | null = null;

  function genPiece(): Piece {
    const type = TYPES[Math.floor(ctx.random() * TYPES.length)] ?? 'I';
    const count = shapeCells(type, 0).length;
    const r = ctx.random();
    let special = 0;
    if (r < P_STAR) special = 1;
    else if (r < P_STAR + P_BOMB) special = 2;
    const specialIdx = special ? Math.floor(ctx.random() * count) : -1;
    return { type, special, specialIdx };
  }

  function level(): number {
    return Math.floor(lines / 8);
  }
  function gravityInterval(): number {
    return Math.max(130, Math.round(SPEED[speed].base * Math.pow(0.82, level())));
  }

  // ---- 設定画面 ----
  function showSetup(): void {
    mode = 'setup';
    const box = elem('div', 'sd-setup');
    box.append(elem('h2', 'sd-h2', 'スタードロップ'));
    box.append(
      makeSeg(
        'sd',
        'はやさ',
        [
          { v: 'slow', t: 'おそい' },
          { v: 'normal', t: 'ふつう' },
          { v: 'fast', t: 'はやい' },
        ],
        () => config.speed,
        (v) => {
          config.speed = v as SpeedKey;
        },
      ),
    );
    box.append(elem('p', 'sd-note', 'ブロックを 横1列そろえて 消そう！⭐スターを 消すとボーナス、💣ボムは 着地で まわりを ドカン。積み上がって 天井についたら おわり。'));
    const start = elem('button', 'sd-btn sd-btn-primary sd-btn-lg', 'スタート ▶') as HTMLButtonElement;
    start.addEventListener('click', () => startMatch());
    box.append(start);
    wrap.replaceChildren(box);
  }

  // ---- 開始 ----
  function startMatch(): void {
    ctx.save('config', { ...config });
    speed = config.speed;
    board = makeBoard(COLS, ROWS);
    score = 0;
    lines = 0;
    stars = 0;
    ended = false;
    endAt = 0;
    held = null;
    nextP = genPiece();
    mode = 'play';
    buildPlay();
    spawn();
    gravityAt = ctx.now() + gravityInterval();
  }

  function buildPlay(): void {
    const play = elem('div', 'sd-play');

    hudEl = elem('div', 'sd-hud');
    const stats = elem('div', 'sd-stats');
    scoreEl = elem('div', 'sd-stat', '');
    levelEl = elem('div', 'sd-stat', '');
    starEl = elem('div', 'sd-stat', '');
    stats.append(scoreEl, levelEl, starEl);
    const nextBox = elem('div', 'sd-next');
    nextBox.append(elem('div', 'sd-next-label', 'つぎ'));
    const nextGrid = elem('div', 'sd-next-grid');
    nextCells = [];
    for (let i = 0; i < 16; i++) {
      const c = elem('div', 'sd-ncell');
      nextCells.push(c);
      nextGrid.append(c);
    }
    nextBox.append(nextGrid);
    hudEl.append(stats, nextBox);

    const wellWrap = elem('div', 'sd-well-wrap');
    wellEl = elem('div', 'sd-well');
    wellCells = [];
    for (let i = 0; i < COLS * ROWS; i++) {
      const c = elem('div', 'sd-cell');
      wellCells.push(c);
      wellEl.append(c);
    }
    wellWrap.append(wellEl);

    controlsEl = elem('div', 'sd-controls');
    const bL = elem('button', 'sd-ctl', '◀') as HTMLButtonElement;
    const bRot = elem('button', 'sd-ctl', '⟳') as HTMLButtonElement;
    const bR = elem('button', 'sd-ctl', '▶') as HTMLButtonElement;
    const bDown = elem('button', 'sd-ctl', '⬇') as HTMLButtonElement;
    const bDrop = elem('button', 'sd-ctl sd-ctl-drop', '⤓') as HTMLButtonElement;
    holdBtn(bL, 'L');
    holdBtn(bR, 'R');
    holdBtn(bDown, 'D');
    tapBtn(bRot, () => rotate());
    tapBtn(bDrop, () => hardDrop());
    controlsEl.append(bL, bRot, bR, bDown, bDrop);

    play.append(hudEl, wellWrap, controlsEl);
    wrap.replaceChildren(play);
    layout();
    paint();
    paintNext();
    paintStats();
  }

  function holdBtn(el: HTMLButtonElement, dir: 'L' | 'R' | 'D'): void {
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (mode !== 'play' || hostPaused) return;
      held = dir;
      act(dir);
      heldNext = ctx.now() + DAS;
    });
    const up = (): void => {
      if (held === dir) held = null;
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointerleave', up);
    el.addEventListener('pointercancel', up);
  }
  function tapBtn(el: HTMLButtonElement, fn: () => void): void {
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (mode !== 'play' || hostPaused) return;
      fn();
    });
  }

  function act(dir: 'L' | 'R' | 'D'): void {
    if (dir === 'L') move(-1);
    else if (dir === 'R') move(1);
    else softDrop();
  }

  function layout(): void {
    if (!wellEl || !wrap || !hudEl || !controlsEl) return;
    const availW = wrap.clientWidth - 16;
    const availH = wrap.clientHeight - hudEl.offsetHeight - controlsEl.offsetHeight - 20;
    const cell = Math.max(14, Math.floor(Math.min(availW / COLS, availH / ROWS)));
    wellEl.style.gridTemplateColumns = `repeat(${COLS}, ${cell}px)`;
    wellEl.style.gridAutoRows = `${cell}px`;
    wellEl.style.fontSize = `${Math.round(cell * 0.62)}px`;
  }

  // ---- ブロック操作 ----
  function spawn(): void {
    const p = nextP;
    nextP = genPiece();
    const px = Math.floor((COLS - 4) / 2);
    cur = { p, state: 0, px, py: 0 };
    if (collides(board, p.type, 0, px, 0)) {
      gameOver();
      return;
    }
    paintNext();
    paint();
  }

  function move(d: number): void {
    if (!cur) return;
    if (!collides(board, cur.p.type, cur.state, cur.px + d, cur.py)) {
      cur.px += d;
      paint();
    }
  }
  function rotate(): void {
    if (!cur) return;
    const ns = (cur.state + 1) % 4;
    for (const kick of [0, -1, 1, -2, 2]) {
      if (!collides(board, cur.p.type, ns, cur.px + kick, cur.py)) {
        cur.px += kick;
        cur.state = ns;
        ctx.sfx('tick');
        paint();
        return;
      }
    }
  }
  function softDrop(): void {
    if (!cur) return;
    if (!collides(board, cur.p.type, cur.state, cur.px, cur.py + 1)) {
      cur.py++;
      score += 1;
      if (score >= SCORE_HI) ctx.achieve('score-hi'); // ソフトドロップ点で跨いだ場合も即解除
      gravityAt = ctx.now() + gravityInterval();
      paint();
      paintStats(); // +1 をその場でHUDに反映（従来は次のロックまで表示が遅れていた）
    } else {
      lockAndProcess();
    }
  }
  function hardDrop(): void {
    if (!cur) return;
    const gy = dropY(board, cur.p.type, cur.state, cur.px, cur.py);
    score += Math.max(0, (gy - cur.py) * 2);
    cur.py = gy;
    lockAndProcess();
  }
  function gravityStep(): void {
    if (!cur) return;
    if (!collides(board, cur.p.type, cur.state, cur.px, cur.py + 1)) {
      cur.py++;
      paint();
    } else {
      lockAndProcess();
    }
  }

  function lockAndProcess(): void {
    if (!cur) return;
    const { p, state, px, py } = cur;
    const bombs = lock(board, p.type, state, px, py, p.special, p.specialIdx);
    ctx.sfx('tap');
    let bombRemoved = 0;
    for (const [bx, by] of bombs) {
      bombRemoved += bombExplode(board, bx, by);
    }
    if (bombs.length > 0) ctx.achieve('bomb-boom');
    const { cleared, stars: gotStars } = clearLines(board);
    if (cleared > 0) {
      score += (LINE_PTS[cleared] ?? 0) * (level() + 1);
      lines += cleared;
      ctx.sfx(cleared >= 4 ? 'medal' : 'combo');
      ctx.haptic(cleared >= 3 ? 'success' : 'light');
      ctx.achieve('first-line');
      if (cleared >= 4) ctx.achieve('four-line');
    }
    if (gotStars > 0) {
      stars += gotStars;
      score += gotStars * 150;
    }
    if (bombRemoved > 0) score += bombRemoved * 8;
    if (stars >= 5) ctx.achieve('star-5');
    if (level() >= 4) ctx.achieve('level-5'); // level() は 0 起点なので 4 = 表示レベル5
    if (score >= SCORE_HI) ctx.achieve('score-hi'); // 到達した瞬間に解除（中断しても取りこぼさない）
    cur = null;
    paintStats();
    spawn();
    gravityAt = ctx.now() + gravityInterval();
  }

  function gameOver(): void {
    mode = 'over';
    cur = null;
    held = null;
    // score-hi は加算箇所（softDrop / lockAndProcess）で live 判定済み（gameOver では score は増えない）
    ctx.sfx('fail');
    ctx.haptic('error');
    showBanner('ゲームオーバー', END_DELAY - 200);
    endAt = ctx.now() + END_DELAY;
    paint();
  }

  // ---- バナー ----
  function showBanner(text: string, ms: number): void {
    hideBanner();
    bannerEl = elem('div', 'sd-banner', text);
    wrap.append(bannerEl);
    bannerUntil = ctx.now() + ms;
  }
  function hideBanner(): void {
    bannerEl?.remove();
    bannerEl = null;
    bannerUntil = 0;
  }

  // ---- 描画 ----
  function paint(): void {
    if (!wellEl) return;
    const n = COLS * ROWS;
    const rColor = new Uint8Array(n);
    const rSpec = new Uint8Array(n);
    const rGhost = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      rColor[i] = board.color[i] ?? 0;
      rSpec[i] = board.special[i] ?? 0;
    }
    if (mode === 'play' && cur) {
      const gy = dropY(board, cur.p.type, cur.state, cur.px, cur.py);
      for (const [r, c] of shapeCells(cur.p.type, cur.state)) {
        const x = cur.px + c;
        const y = gy + r;
        if (y >= 0 && (board.color[y * COLS + x] ?? 0) === 0) rGhost[y * COLS + x] = 1;
      }
      shapeCells(cur.p.type, cur.state).forEach(([r, c], i) => {
        const x = cur!.px + c;
        const y = cur!.py + r;
        if (y >= 0) {
          const idx = y * COLS + x;
          rColor[idx] = COLOR_OF[cur!.p.type];
          rSpec[idx] = i === cur!.p.specialIdx ? cur!.p.special : 0;
          rGhost[idx] = 0;
        }
      });
    }
    for (let i = 0; i < n; i++) {
      const el = wellCells[i];
      if (!el) continue;
      const color = rColor[i] ?? 0;
      if (color) {
        el.className = 'sd-cell sd-on';
        el.style.background = COLORS[color - 1] ?? '#888';
        el.textContent = rSpec[i] === 1 ? '⭐' : rSpec[i] === 2 ? '💣' : '';
      } else if (rGhost[i]) {
        el.className = 'sd-cell sd-ghost';
        el.style.background = '';
        el.textContent = '';
      } else {
        el.className = 'sd-cell';
        el.style.background = '';
        el.textContent = '';
      }
    }
  }

  function paintNext(): void {
    for (let i = 0; i < 16; i++) {
      const el = nextCells[i];
      if (el) {
        el.style.background = '';
        el.textContent = '';
      }
    }
    const color = COLOR_OF[nextP.type];
    shapeCells(nextP.type, 0).forEach(([r, c], i) => {
      const idx = r * 4 + c;
      const el = nextCells[idx];
      if (!el) return;
      el.style.background = COLORS[color - 1] ?? '#888';
      if (i === nextP.specialIdx) el.textContent = nextP.special === 1 ? '⭐' : nextP.special === 2 ? '💣' : '';
    });
  }

  function paintStats(): void {
    if (scoreEl) scoreEl.textContent = `スコア ${score}`;
    if (levelEl) levelEl.textContent = `レベル ${level() + 1}`;
    if (starEl) starEl.textContent = `⭐ ${stars}`;
  }

  // ---- 毎フレーム（落下・長押しくり返し・結果遷移。すべて ctx.now）----
  const offFrame = ctx.onFrame(() => {
    const now = ctx.now();
    if (bannerEl && now >= bannerUntil) hideBanner();
    if (mode === 'play' && !hostPaused) {
      if (held && now >= heldNext) {
        act(held);
        heldNext = now + ARR;
      }
      if (cur && now >= gravityAt) {
        gravityStep();
        gravityAt = now + gravityInterval();
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
      held = null;
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

const CSS = `
.sd-wrap{position:absolute;inset:0;overflow:hidden}
.sd-setup{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:safe center;
  gap:14px;padding:20px 16px;box-sizing:border-box;overflow-y:auto;user-select:none;-webkit-user-select:none}
.sd-h2{margin:4px 0;font-size:22px}
.sd-seg-row{width:min(92vw,420px);display:flex;flex-direction:column;gap:6px}
.sd-seg-label{font-size:13px;color:var(--text-dim);font-weight:800}
.sd-seg{display:flex;background:var(--bg-elev2);border-radius:12px;padding:3px;gap:2px}
.sd-seg-btn{flex:1;border:none;background:none;color:var(--text-dim);padding:10px 2px;border-radius:9px;
  font-size:14px;font-weight:800;min-height:44px}
.sd-seg-btn.sd-on{background:var(--accent);color:#fff}
.sd-note{font-size:12px;color:var(--text-dim);text-align:center;max-width:min(92vw,420px);margin:0;line-height:1.7}
.sd-btn{appearance:none;border:none;border-radius:12px;padding:12px 18px;font-size:15px;font-weight:800;
  background:var(--bg-elev2);color:var(--text);min-height:44px}
.sd-btn-primary{background:var(--accent-grad);color:#fff}
.sd-btn-lg{width:100%;max-width:300px;font-size:18px}

.sd-play{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;padding:4px 8px 8px;
  box-sizing:border-box;user-select:none;-webkit-user-select:none}
.sd-hud{width:100%;max-width:420px;display:flex;justify-content:space-between;align-items:center;gap:10px;
  min-height:54px;padding:2px 60px 2px 4px;box-sizing:border-box}
.sd-stats{display:flex;flex-direction:column;gap:1px}
.sd-stat{font-size:13px;font-weight:800;white-space:nowrap}
.sd-next{display:flex;flex-direction:column;align-items:center;gap:2px}
.sd-next-label{font-size:11px;color:var(--text-dim);font-weight:800}
.sd-next-grid{display:grid;grid-template-columns:repeat(4,11px);grid-auto-rows:11px;gap:1px}
.sd-ncell{width:11px;height:11px;border-radius:2px;background:transparent}
.sd-well-wrap{flex:1 1 auto;min-height:0;display:flex;align-items:center;justify-content:center;padding:4px 0}
.sd-well{display:grid;gap:1px;background:#11142c;border:2px solid #2a2f52;border-radius:6px;padding:2px}
.sd-cell{border-radius:2px;background:transparent;display:flex;align-items:center;justify-content:center;line-height:1}
.sd-cell.sd-on{box-shadow:inset 0 0 0 1px rgba(255,255,255,.18)}
.sd-cell.sd-ghost{box-shadow:inset 0 0 0 2px rgba(255,255,255,.25)}
.sd-controls{width:100%;max-width:420px;display:flex;gap:6px;justify-content:center;padding-top:4px}
.sd-ctl{flex:1;appearance:none;border:none;border-radius:12px;min-height:52px;font-size:22px;font-weight:900;
  background:var(--bg-elev2);color:var(--text)}
.sd-ctl:active{background:var(--accent);color:#fff}
.sd-ctl-drop{background:var(--accent-grad);color:#fff}
.sd-banner{position:absolute;left:50%;top:42%;transform:translate(-50%,-50%);background:rgba(16,19,48,.92);color:#fff;
  padding:12px 24px;border-radius:999px;font-weight:800;font-size:22px;pointer-events:none;white-space:nowrap;z-index:5;
  animation:sd-pop .2s ease-out}
@keyframes sd-pop{from{opacity:0;transform:translate(-50%,-42%)}to{opacity:1;transform:translate(-50%,-50%)}}
`;
