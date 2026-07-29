// =============================================================
// おりがみパズル（No.110・かくれゲーム）: 紙を折って ほしを 1マスに かさねる
// =============================================================
// - 高難度のねらい: 折るたびに 位置が 裏返るので、頭の中で 空間を ひっくり返し続ける
//   必要がある。折れる回数は「最短ぴったり」しか無いので、順番を1つ まちがえると 届かない。
// - 紙の折りたたみ・出題・ソルバは logic.ts（決定論・DOM 非依存）。こちらは描画と入力だけ。
// - import してよいのは game-api（types / helpers）と、このフォルダ内（logic）だけ。
import type { GameContext, IGame, PointerInfo } from '../../game-api/types';
import { type Fold, type Sheet, STAGES, applyFold, cloneSheet, isSolved, makeStage, stageScore } from './logic';

const W = 360;
const H = 640;
const HUD_H = 46;

const CELL = 44;
/** 紙の まん中（ここを中心に 紙を 置く） */
const CX = 186;
const CY = 330;
/** 折り線タブ */
const TAB_W = 36;
const TAB_H = 30;
const TAB_GAP = 10;

const CLEAR_MS = 1400;
const FAIL_MS = 1600;
const FLASH_MS = 260;
const END_DELAY = 2400;
const SCORE_HI = 1150;

const C_BG = '#141b26';
const C_PAPER = '#f7f2e3';
const C_PAPER_LINE = '#cbbf9e';
const C_TAB = '#2a3a52';
const C_TAB_LINE = '#4b6488';
const C_TEXT = '#eaf1ff';
const C_DIM = '#8fa0bd';
const C_STAR = '#f5a623';
const C_OK = '#43c98a';
const C_NG = '#e0483c';

type Mode = 'play' | 'cleared' | 'failed' | 'done';

export function createGame(ctx: GameContext): IGame {
  const cv = ctx.canvas2d({ design: { w: W, h: H } });
  const g = cv.ctx;

  let stageIdx = 0;
  let base: Sheet = makeStage(ctx.random, STAGES[0]!);
  let sheet: Sheet = cloneSheet(base);
  let used = 0;
  let attempts = 1;
  let mode: Mode = 'play';
  let started = false;
  let hostPaused = false;
  let ended = false;
  let score = 0;
  let cleared = 0;
  let oneShotAll = true;
  let flashFold: Fold | null = null;
  let flashUntil = 0;
  let phaseUntil = 0;
  let lastEvent = '';

  function loadStage(i: number): void {
    stageIdx = i;
    base = makeStage(ctx.random, STAGES[i]!);
    sheet = cloneSheet(base);
    used = 0;
    attempts = 1;
    mode = 'play';
    flashFold = null;
    lastEvent = `stage:${i}`;
  }

  function resetSheet(countAttempt: boolean): void {
    sheet = cloneSheet(base);
    used = 0;
    if (countAttempt) attempts++;
    mode = 'play';
    flashFold = null;
  }

  // ---------- レイアウト ----------
  const paperRect = (): { x: number; y: number; w: number; h: number } => ({
    x: CX - (sheet.w * CELL) / 2,
    y: CY - (sheet.h * CELL) / 2,
    w: sheet.w * CELL,
    h: sheet.h * CELL,
  });
  /** たての折り線タブ（紙の上） */
  const vTabs = (): { line: number; x: number; y: number; w: number; h: number }[] => {
    const p = paperRect();
    const out: { line: number; x: number; y: number; w: number; h: number }[] = [];
    for (let k = 1; k < sheet.w; k++) {
      out.push({ line: k, x: p.x + k * CELL - TAB_W / 2, y: p.y - TAB_H - TAB_GAP, w: TAB_W, h: TAB_H });
    }
    return out;
  };
  /** よこの折り線タブ（紙の左） */
  const hTabs = (): { line: number; x: number; y: number; w: number; h: number }[] => {
    const p = paperRect();
    const out: { line: number; x: number; y: number; w: number; h: number }[] = [];
    for (let k = 1; k < sheet.h; k++) {
      out.push({ line: k, x: p.x - TAB_W - TAB_GAP, y: p.y + k * CELL - TAB_H / 2, w: TAB_W, h: TAB_H });
    }
    return out;
  };
  const RETRY_BTN = { x: 110, y: 528, w: 140, h: 46 };
  const inRect = (p: { x: number; y: number }, r: { x: number; y: number; w: number; h: number }): boolean =>
    p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
  /**
   * タブの **タップ判定だけ** を 広げる（見た目は 36×30 のまま）。
   * 子どもの 指には 44px いじょう ほしいが、タブは CELL(44) ごとに ならぶので
   * 「ならぶ向きは 44 まで」しか 広げられない（広げすぎると となりの 折り線と 取りちがえる）。
   *   たてタブ（横に ならぶ）: 横 36→44・たて 30→44
   *   よこタブ（たてに ならぶ）: 横 36→50・たて 30→44
   */
  const hit = (r: { x: number; y: number; w: number; h: number }, px: number, py: number): { x: number; y: number; w: number; h: number } =>
    ({ x: r.x - px, y: r.y - py, w: r.w + px * 2, h: r.h + py * 2 });

  // ---------- 入力 ----------
  function doFold(f: Fold): void {
    const spec = STAGES[stageIdx]!;
    sheet = applyFold(sheet, f);
    used++;
    flashFold = f;
    flashUntil = ctx.now() + FLASH_MS;
    ctx.sfx('tap');
    lastEvent = `fold:${f.axis}${f.line}:${used}`;
    if (isSolved(sheet)) {
      const pts = stageScore(attempts);
      score += pts;
      cleared++;
      if (attempts === 1) ctx.achieve('one-shot');
      else oneShotAll = false;
      if (cleared === 1) ctx.achieve('first-fold');
      if (cleared >= 3) ctx.achieve('half');
      mode = 'cleared';
      phaseUntil = ctx.now() + CLEAR_MS;
      ctx.sfx('medal');
      ctx.haptic('success');
      lastEvent = `clear:${stageIdx}:${pts}:${attempts}`;
    } else if (used >= spec.folds) {
      mode = 'failed';
      phaseUntil = ctx.now() + FAIL_MS;
      ctx.sfx('fail');
      ctx.haptic('error');
      lastEvent = `fail:${stageIdx}:${attempts}`;
    }
  }

  const offTap = ctx.input.onTap((p: PointerInfo) => {
    if (hostPaused || !started || mode !== 'play') return;
    const l = cv.toLocal(p);
    for (const t of vTabs()) {
      if (inRect(l, hit(t, 4, 7))) {
        doFold({ axis: 'v', line: t.line });
        return;
      }
    }
    for (const t of hTabs()) {
      if (inRect(l, hit(t, 7, 7))) {
        doFold({ axis: 'h', line: t.line });
        return;
      }
    }
    if (inRect(l, RETRY_BTN)) {
      resetSheet(true);
      ctx.sfx('tap');
      lastEvent = `retry:${stageIdx}:${attempts}`;
    }
  });

  // ---------- 毎フレーム ----------
  const offFrame = ctx.onFrame(() => {
    if (hostPaused || !started) return;
    const now = ctx.now();
    if (mode === 'cleared' && now >= phaseUntil) {
      if (stageIdx + 1 >= STAGES.length) finish(now);
      else loadStage(stageIdx + 1);
    } else if (mode === 'failed' && now >= phaseUntil) {
      resetSheet(true);
    } else if (mode === 'done' && !ended && now >= phaseUntil) {
      ended = true;
      ctx.end({ score });
      return;
    }
    draw(now);
    setData();
  });

  function finish(now: number): void {
    ctx.achieve('all-clear');
    if (oneShotAll) ctx.achieve('perfect-all');
    if (score >= SCORE_HI) ctx.achieve('score-hi');
    mode = 'done';
    phaseUntil = now + END_DELAY;
    ctx.sfx('medal');
    lastEvent = `finish:${score}:${cleared}`;
  }

  function setData(): void {
    if (!import.meta.env.DEV) return;
    const r = ctx.root as HTMLElement;
    r.dataset.mode = mode;
    r.dataset.stage = String(stageIdx);
    r.dataset.size = `${sheet.w}x${sheet.h}`;
    r.dataset.used = String(used);
    r.dataset.max = String(STAGES[stageIdx]?.folds ?? 0);
    r.dataset.attempts = String(attempts);
    r.dataset.score = String(score);
    r.dataset.cleared = String(cleared);
    r.dataset.sheet = sheet.cells.map((row) => row.map((c) => c.length).join('')).join('/');
    r.dataset.basesheet = base.cells.map((row) => row.map((c) => c.length).join('')).join('/');
    r.dataset.last = lastEvent;
  }

  // ---------- 描画 ----------
  function roundRect(x: number, y: number, w: number, h: number, r: number): void {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  function drawStar(cx: number, cy: number, r: number, color: string): void {
    g.fillStyle = color;
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const rr = i % 2 === 0 ? r : r * 0.45;
      const x = cx + Math.cos(a) * rr;
      const y = cy + Math.sin(a) * rr;
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.closePath();
    g.fill();
  }

  /** 折る向きの やじるし（小さいほうが 大きいほうに かぶさる） */
  function drawTabArrow(t: { line: number; x: number; y: number; w: number; h: number }, axis: 'v' | 'h'): void {
    const cx = t.x + t.w / 2;
    const cy = t.y + t.h / 2;
    const toPlus = axis === 'v' ? t.line <= sheet.w - t.line : t.line <= sheet.h - t.line;
    g.fillStyle = C_TEXT;
    g.beginPath();
    if (axis === 'v') {
      const s = toPlus ? 1 : -1;
      g.moveTo(cx + s * 9, cy);
      g.lineTo(cx - s * 5, cy - 7);
      g.lineTo(cx - s * 5, cy + 7);
    } else {
      const s = toPlus ? 1 : -1;
      g.moveTo(cx, cy + s * 9);
      g.lineTo(cx - 7, cy - s * 5);
      g.lineTo(cx + 7, cy - s * 5);
    }
    g.closePath();
    g.fill();
  }

  function draw(now: number): void {
    cv.clear(C_BG);
    const spec = STAGES[stageIdx]!;

    // HUD
    g.fillStyle = '#0c121c';
    g.fillRect(0, 0, W, HUD_H);
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.fillStyle = C_TEXT;
    g.font = 'bold 18px sans-serif';
    g.fillText(`${score}てん`, 12, HUD_H / 2);
    g.fillStyle = C_DIM;
    g.font = 'bold 13px sans-serif';
    g.fillText(`ステージ ${Math.min(stageIdx + 1, STAGES.length)}/${STAGES.length}`, 116, HUD_H / 2 - 8);
    g.fillText(`ちょうせん ${attempts}かいめ`, 116, HUD_H / 2 + 9);

    g.textAlign = 'center';

    if (mode === 'done') {
      g.fillStyle = C_TEXT;
      g.font = 'bold 26px sans-serif';
      g.fillText('ぜんぶ かさなった！', W / 2, 280);
      g.font = 'bold 34px sans-serif';
      g.fillStyle = C_STAR;
      g.fillText(`${score}てん`, W / 2, 336);
      g.fillStyle = C_DIM;
      g.font = 'bold 14px sans-serif';
      g.fillText(`クリア ${cleared} / ${STAGES.length}`, W / 2, 380);
      return;
    }

    // といかけ
    g.fillStyle = C_DIM;
    g.font = 'bold 13px sans-serif';
    g.fillText('ほしを ぜんぶ 1つの マスに かさねよう', W / 2, 70);
    g.fillStyle = used >= spec.folds ? C_NG : C_TEXT;
    g.font = 'bold 17px sans-serif';
    g.fillText(`おれる かいすう  ${spec.folds - used} / ${spec.folds}`, W / 2, 96);

    // 折り線タブ
    for (const t of vTabs()) {
      g.fillStyle = C_TAB;
      roundRect(t.x, t.y, t.w, t.h, 8);
      g.fill();
      g.strokeStyle = C_TAB_LINE;
      g.lineWidth = 1.6;
      roundRect(t.x, t.y, t.w, t.h, 8);
      g.stroke();
      drawTabArrow(t, 'v');
    }
    for (const t of hTabs()) {
      g.fillStyle = C_TAB;
      roundRect(t.x, t.y, t.w, t.h, 8);
      g.fill();
      g.strokeStyle = C_TAB_LINE;
      g.lineWidth = 1.6;
      roundRect(t.x, t.y, t.w, t.h, 8);
      g.stroke();
      drawTabArrow(t, 'h');
    }

    // 紙
    const p = paperRect();
    g.fillStyle = C_PAPER;
    roundRect(p.x, p.y, p.w, p.h, 6);
    g.fill();
    g.strokeStyle = C_PAPER_LINE;
    g.lineWidth = 1.2;
    for (let k = 1; k < sheet.w; k++) {
      g.beginPath();
      g.moveTo(p.x + k * CELL, p.y);
      g.lineTo(p.x + k * CELL, p.y + p.h);
      g.stroke();
    }
    for (let k = 1; k < sheet.h; k++) {
      g.beginPath();
      g.moveTo(p.x, p.y + k * CELL);
      g.lineTo(p.x + p.w, p.y + k * CELL);
      g.stroke();
    }
    g.strokeStyle = mode === 'cleared' ? C_OK : mode === 'failed' ? C_NG : '#9c8f6e';
    g.lineWidth = 3;
    roundRect(p.x, p.y, p.w, p.h, 6);
    g.stroke();

    // ほし（かさなりは 数で 出す）
    for (let y = 0; y < sheet.h; y++) {
      for (let x = 0; x < sheet.w; x++) {
        const n = sheet.cells[y]![x]!.length;
        if (n === 0) continue;
        const cx = p.x + x * CELL + CELL / 2;
        const cy = p.y + y * CELL + CELL / 2;
        drawStar(cx, cy, n > 1 ? 16 : 13, C_STAR);
        if (n > 1) {
          g.fillStyle = '#3a2a06';
          g.font = 'bold 14px sans-serif';
          g.fillText(String(n), cx, cy + 1);
        }
      }
    }

    // 折った線の 合図
    if (flashFold && now < flashUntil) {
      g.strokeStyle = '#ffd54a';
      g.lineWidth = 4;
      g.setLineDash([7, 5]);
      g.beginPath();
      if (flashFold.axis === 'v') {
        const lx = p.x + Math.min(flashFold.line, sheet.w) * CELL;
        g.moveTo(lx, p.y - 6);
        g.lineTo(lx, p.y + p.h + 6);
      } else {
        const ly = p.y + Math.min(flashFold.line, sheet.h) * CELL;
        g.moveTo(p.x - 6, ly);
        g.lineTo(p.x + p.w + 6, ly);
      }
      g.stroke();
      g.setLineDash([]);
    }

    // ようす
    g.font = 'bold 16px sans-serif';
    if (mode === 'cleared') {
      g.fillStyle = C_OK;
      g.fillText(`かさなった！ +${stageScore(attempts)}てん`, W / 2, 496);
    } else if (mode === 'failed') {
      g.fillStyle = C_NG;
      g.fillText('かさならなかった…もう一度', W / 2, 496);
    } else {
      g.fillStyle = C_DIM;
      g.font = 'bold 13px sans-serif';
      g.fillText('うえ／ひだりの タブを タップすると その線で 折れる', W / 2, 496);
    }

    // やりなおす
    g.fillStyle = mode === 'play' ? C_TAB : 'rgba(42,58,82,.5)';
    roundRect(RETRY_BTN.x, RETRY_BTN.y, RETRY_BTN.w, RETRY_BTN.h, 12);
    g.fill();
    g.strokeStyle = C_TAB_LINE;
    g.lineWidth = 1.6;
    roundRect(RETRY_BTN.x, RETRY_BTN.y, RETRY_BTN.w, RETRY_BTN.h, 12);
    g.stroke();
    g.fillStyle = C_TEXT;
    g.font = 'bold 16px sans-serif';
    g.fillText('⟲ ひらきなおす', RETRY_BTN.x + RETRY_BTN.w / 2, RETRY_BTN.y + RETRY_BTN.h / 2);

    g.fillStyle = C_DIM;
    g.font = 'bold 11px sans-serif';
    g.fillText('小さいほうが 大きいほうに かぶさる（やじるしの 向き）', W / 2, 596);
  }

  draw(0);
  setData();

  return {
    start() {
      started = true;
    },
    pause() {
      hostPaused = true;
    },
    resume() {
      hostPaused = false;
    },
    resize() {
      draw(ctx.now());
    },
    destroy() {
      offTap();
      offFrame();
    },
  };
}
