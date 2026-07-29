// =============================================================
// ロボットめいれい（No.106・かくれゲーム）: 命令を並べて ▶ で走らせる
// =============================================================
// - 高難度のねらい: 走らせている間は操作できない。だから「頭の中で最後まで動かす」必要がある。
//   さらに枠の数が最短手数ぴったりなので、後半は くりかえし枠（手続き）を使わないと入らない。
// - ステージ・実行は logic.ts（決定論・DOM 非依存）。こちらは描画と入力だけ。
// - import してよいのは game-api（types / helpers）と、このフォルダ内（logic）だけ。
import type { GameContext, IGame, PointerInfo } from '../../game-api/types';
import { type Cmd, type Step, STAGES, parseStage, runProgram, stageScore } from './logic';

const W = 360;
const H = 640;
const HUD_H = 46;

// 盤
const CELL = 40;
const GRID_Y = 78;

// 命令の枠
const ROW_X = 20;
const ROW_W = 320;
const SLOT_H = 36;
const MAIN_Y = 348;
const SUB_Y = 410;

// ボタン
const BTN_Y = 460;
const BTN_H = 56;
const RUN_Y = 530;
const RUN_H = 52;

const STEP_MS = 300;
const CLEAR_MS = 1200;
const FAIL_MS = 1200;
const END_DELAY = 2200;
const SCORE_HI = 1300;

const C_BG = '#101728';
const C_PANEL = '#1b2540';
const C_LINE = '#33406b';
const C_TEXT = '#eaf0ff';
const C_DIM = '#8f9dc4';
const C_FLOOR = '#243252';
const C_WALL = '#0a0f1c';
const C_STAR = '#ffd54a';
const C_ROBO = '#4ad0b5';
const C_RUN = '#2fa36b';
const C_NG = '#e0483c';
const C_FOCUS = '#ffb44a';

type Mode = 'edit' | 'run' | 'cleared' | 'failed' | 'done';

export function createGame(ctx: GameContext): IGame {
  const cv = ctx.canvas2d({ design: { w: W, h: H } });
  const g = cv.ctx;

  let stageIdx = 0;
  let stage = STAGES[0]!;
  let info = parseStage(stage);
  let main: Cmd[] = [];
  let sub: Cmd[] = [];
  let focus: 'main' | 'sub' = 'main';
  let mode: Mode = 'edit';
  let started = false;
  let hostPaused = false;
  let ended = false;
  let score = 0;
  let cleared = 0;
  let runs = 0;
  let oneShotAll = true;
  let usedLoopEver = false;
  // 実行中の様子
  let steps: Step[] = [];
  let stepIdx = -1;
  let stepUntil = 0;
  let phaseUntil = 0;
  // 表示用の いまの すがた
  let rx = 0;
  let ry = 0;
  let rdir = 0;
  let taken: boolean[] = [];
  let lastEvent = '';

  function loadStage(i: number): void {
    stageIdx = i;
    stage = STAGES[i]!;
    info = parseStage(stage);
    main = [];
    sub = [];
    focus = 'main';
    runs = 0;
    resetRobot();
    mode = 'edit';
  }

  function resetRobot(): void {
    rx = info.start.x;
    ry = info.start.y;
    rdir = stage.dir;
    taken = info.stars.map(() => false);
    steps = [];
    stepIdx = -1;
  }
  loadStage(0);

  // ---------- レイアウト ----------
  const cellRect =(x: number, y: number): { x: number; y: number } => ({
    x: (W - info.w * CELL) / 2 + x * CELL,
    y: GRID_Y + y * CELL,
  });
  const slotW = (n: number): number => (ROW_W - (n - 1) * 4) / n;
  const slotRect = (row: 'main' | 'sub', i: number): { x: number; y: number; w: number; h: number } => {
    const n = row === 'main' ? stage.mainMax : stage.subMax;
    const w = slotW(n);
    return { x: ROW_X + i * (w + 4), y: row === 'main' ? MAIN_Y : SUB_Y, w, h: SLOT_H };
  };
  const cmdButtons = (): { cmd: Cmd; x: number; y: number; w: number; h: number }[] => {
    const list: Cmd[] = stage.subMax > 0 ? ['F', 'L', 'R', 'C'] : ['F', 'L', 'R'];
    const bw = (ROW_W - (list.length - 1) * 8) / list.length;
    return list.map((cmd, i) => ({ cmd, x: ROW_X + i * (bw + 8), y: BTN_Y, w: bw, h: BTN_H }));
  };
  const RUN_BTN = { x: ROW_X, y: RUN_Y, w: 196, h: RUN_H };
  const CLR_BTN = { x: ROW_X + 206, y: RUN_Y, w: 114, h: RUN_H };
  const inRect = (p: { x: number; y: number }, r: { x: number; y: number; w: number; h: number }): boolean =>
    p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;

  // ---------- 入力 ----------
  function addCmd(c: Cmd): void {
    const row = c === 'C' ? 'main' : focus;
    const list = row === 'main' ? main : sub;
    const max = row === 'main' ? stage.mainMax : stage.subMax;
    if (list.length >= max) {
      ctx.sfx('fail');
      lastEvent = `full:${row}`;
      return;
    }
    list.push(c);
    ctx.sfx('tap');
    lastEvent = `add:${row}:${c}`;
  }

  function startRun(): void {
    if (main.length === 0) {
      ctx.sfx('fail');
      lastEvent = 'empty';
      return;
    }
    runs++;
    const r = runProgram(stage, main, sub);
    steps = r.steps;
    stepIdx = -1;
    resetRobotOnly();
    mode = 'run';
    stepUntil = ctx.now() + STEP_MS;
    ctx.sfx('tap');
    lastEvent = `run:${stageIdx}:${main.join('')}/${sub.join('')}`;
  }

  function resetRobotOnly(): void {
    rx = info.start.x;
    ry = info.start.y;
    rdir = stage.dir;
    taken = info.stars.map(() => false);
  }

  const offTap = ctx.input.onTap((p: PointerInfo) => {
    if (hostPaused || !started || mode !== 'edit') return;
    const l = cv.toLocal(p);
    // 命令の枠（置いた命令を タップすると もどせる。空きを タップすると その枠を えらぶ）
    for (let i = 0; i < stage.mainMax; i++) {
      if (inRect(l, slotRect('main', i))) {
        focus = 'main';
        if (i < main.length) {
          main.splice(i, 1);
          ctx.sfx('tap');
          lastEvent = `del:main:${i}`;
        }
        return;
      }
    }
    for (let i = 0; i < stage.subMax; i++) {
      if (inRect(l, slotRect('sub', i))) {
        focus = 'sub';
        if (i < sub.length) {
          sub.splice(i, 1);
          ctx.sfx('tap');
          lastEvent = `del:sub:${i}`;
        }
        return;
      }
    }
    for (const b of cmdButtons()) {
      if (inRect(l, b)) {
        addCmd(b.cmd);
        return;
      }
    }
    if (inRect(l, RUN_BTN)) {
      startRun();
      return;
    }
    if (inRect(l, CLR_BTN)) {
      main = [];
      sub = [];
      resetRobot();
      ctx.sfx('tap');
      lastEvent = 'clear';
    }
  });

  // ---------- 毎フレーム ----------
  const offFrame = ctx.onFrame(() => {
    if (hostPaused || !started) return;
    const now = ctx.now();
    if (mode === 'run' && now >= stepUntil) {
      stepIdx++;
      const s = steps[stepIdx];
      if (s) {
        rx = s.x;
        ry = s.y;
        rdir = s.dir;
        if (s.got >= 0) {
          taken[s.got] = true;
          ctx.sfx('combo');
        } else if (s.bumped) {
          ctx.sfx('fail');
        }
        stepUntil = now + STEP_MS;
      } else {
        finishRun(now);
      }
    } else if (mode === 'cleared' && now >= phaseUntil) {
      if (stageIdx + 1 >= STAGES.length) finishGame(now);
      else loadStage(stageIdx + 1);
    } else if (mode === 'failed' && now >= phaseUntil) {
      resetRobot();
      mode = 'edit';
    } else if (mode === 'done' && !ended && now >= phaseUntil) {
      ended = true;
      ctx.end({ score });
      return;
    }
    draw();
    setData();
  });

  function finishRun(now: number): void {
    const ok = taken.every((t) => t);
    if (ok) {
      const pts = stageScore(runs);
      score += pts;
      cleared++;
      if (runs > 1) oneShotAll = false;
      if (main.some((c) => c === 'C')) {
        usedLoopEver = true;
        ctx.achieve('use-loop');
      }
      if (cleared === 1) ctx.achieve('first-clear');
      if (cleared >= 3) ctx.achieve('half');
      mode = 'cleared';
      phaseUntil = now + CLEAR_MS;
      ctx.sfx('medal');
      ctx.haptic('success');
      lastEvent = `clear:${stageIdx}:${pts}:${runs}`;
    } else {
      mode = 'failed';
      phaseUntil = now + FAIL_MS;
      ctx.sfx('fail');
      ctx.haptic('error');
      lastEvent = `miss:${stageIdx}:${runs}`;
    }
  }

  function finishGame(now: number): void {
    ctx.achieve('all-clear');
    if (oneShotAll) ctx.achieve('one-shot');
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
    r.dataset.main = main.join('');
    r.dataset.sub = sub.join('');
    r.dataset.focus = focus;
    r.dataset.stars = `${taken.filter(Boolean).length}/${info.stars.length}`;
    r.dataset.runs = String(runs);
    r.dataset.score = String(score);
    r.dataset.cleared = String(cleared);
    r.dataset.pos = `${rx},${ry},${rdir}`;
    r.dataset.loop = usedLoopEver ? '1' : '0';
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
      const px = cx + Math.cos(a) * rr;
      const py = cy + Math.sin(a) * rr;
      if (i === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    }
    g.closePath();
    g.fill();
  }

  /** 命令の絵（端末によって見た目が変わらないよう、絵文字ではなく自分で描く） */
  function drawGlyph(cmd: Cmd, cx: number, cy: number, s: number, color: string): void {
    g.save();
    g.strokeStyle = color;
    g.fillStyle = color;
    g.lineWidth = Math.max(2, s * 0.16);
    g.lineCap = 'round';
    g.lineJoin = 'round';
    if (cmd === 'F') {
      g.beginPath();
      g.moveTo(cx, cy - s * 0.62);
      g.lineTo(cx + s * 0.46, cy + s * 0.1);
      g.lineTo(cx - s * 0.46, cy + s * 0.1);
      g.closePath();
      g.fill();
      g.fillRect(cx - s * 0.16, cy + s * 0.1, s * 0.32, s * 0.5);
    } else if (cmd === 'L' || cmd === 'R') {
      const sgn = cmd === 'R' ? 1 : -1;
      g.beginPath();
      g.moveTo(cx - sgn * s * 0.4, cy + s * 0.55);
      g.lineTo(cx - sgn * s * 0.4, cy);
      g.quadraticCurveTo(cx - sgn * s * 0.4, cy - s * 0.5, cx + sgn * s * 0.18, cy - s * 0.5);
      g.stroke();
      g.beginPath();
      g.moveTo(cx + sgn * s * 0.55, cy - s * 0.5);
      g.lineTo(cx + sgn * s * 0.08, cy - s * 0.76);
      g.lineTo(cx + sgn * s * 0.08, cy - s * 0.24);
      g.closePath();
      g.fill();
    } else {
      // くりかえし: まるい やじるし
      g.beginPath();
      g.arc(cx, cy, s * 0.5, Math.PI * 0.6, Math.PI * 2.25);
      g.stroke();
      const a = Math.PI * 2.25;
      const ax = cx + Math.cos(a) * s * 0.5;
      const ay = cy + Math.sin(a) * s * 0.5;
      g.beginPath();
      g.moveTo(ax + s * 0.24, ay - s * 0.02);
      g.lineTo(ax - s * 0.12, ay - s * 0.26);
      g.lineTo(ax - s * 0.06, ay + s * 0.22);
      g.closePath();
      g.fill();
    }
    g.restore();
  }

  function drawRobot(): void {
    const c = cellRect(rx, ry);
    const cx = c.x + CELL / 2;
    const cy = c.y + CELL / 2;
    g.save();
    g.translate(cx, cy);
    g.rotate((rdir * Math.PI) / 2);
    g.fillStyle = C_ROBO;
    roundRect(-13, -13, 26, 26, 7);
    g.fill();
    // 前を向いている しるし
    g.fillStyle = '#0d2b26';
    g.beginPath();
    g.moveTo(0, -15);
    g.lineTo(7, -6);
    g.lineTo(-7, -6);
    g.closePath();
    g.fill();
    g.fillStyle = '#0d2b26';
    g.beginPath();
    g.arc(-5, 2, 2.6, 0, Math.PI * 2);
    g.arc(5, 2, 2.6, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }

  function drawRow(row: 'main' | 'sub'): void {
    const n = row === 'main' ? stage.mainMax : stage.subMax;
    if (n === 0) return;
    const list = row === 'main' ? main : sub;
    const y = row === 'main' ? MAIN_Y : SUB_Y;
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.font = 'bold 12px sans-serif';
    g.fillStyle = focus === row && mode === 'edit' ? C_FOCUS : C_DIM;
    g.fillText(row === 'main' ? `めいれい ${list.length}/${n}` : `くりかえし ${list.length}/${n}`, ROW_X, y - 12);
    for (let i = 0; i < n; i++) {
      const r = slotRect(row, i);
      const c = list[i];
      g.fillStyle = c ? C_PANEL : 'rgba(27,37,64,.55)';
      roundRect(r.x, r.y, r.w, r.h, 8);
      g.fill();
      const running = mode === 'run' && row === 'main' && steps[stepIdx]?.from === i;
      g.strokeStyle = running ? C_STAR : focus === row && mode === 'edit' ? C_FOCUS : C_LINE;
      g.lineWidth = running ? 2.6 : 1.6;
      roundRect(r.x, r.y, r.w, r.h, 8);
      g.stroke();
      if (c) drawGlyph(c, r.x + r.w / 2, r.y + r.h / 2, Math.min(r.w, r.h) * 0.5, C_TEXT);
    }
  }

  function draw(): void {
    cv.clear(C_BG);

    // HUD
    g.fillStyle = '#0a0f1c';
    g.fillRect(0, 0, W, HUD_H);
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.fillStyle = C_TEXT;
    g.font = 'bold 18px sans-serif';
    g.fillText(`${score}てん`, 12, HUD_H / 2);
    g.fillStyle = C_DIM;
    g.font = 'bold 13px sans-serif';
    g.fillText(`ステージ ${Math.min(stageIdx + 1, STAGES.length)}/${STAGES.length}`, 116, HUD_H / 2 - 8);
    g.fillText(`うごかした かず ${runs}`, 116, HUD_H / 2 + 9);

    if (mode === 'done') {
      g.textAlign = 'center';
      g.fillStyle = C_TEXT;
      g.font = 'bold 26px sans-serif';
      g.fillText('ぜんぶ プログラム できた！', W / 2, 280);
      g.font = 'bold 34px sans-serif';
      g.fillStyle = C_ROBO;
      g.fillText(`${score}てん`, W / 2, 336);
      g.fillStyle = C_DIM;
      g.font = 'bold 14px sans-serif';
      g.fillText(`クリアした ステージ ${cleared} / ${STAGES.length}`, W / 2, 380);
      return;
    }

    // 盤
    for (let y = 0; y < info.h; y++) {
      for (let x = 0; x < info.w; x++) {
        const c = cellRect(x, y);
        const wall = info.walls[y]![x]!;
        g.fillStyle = wall ? C_WALL : C_FLOOR;
        roundRect(c.x + 1.5, c.y + 1.5, CELL - 3, CELL - 3, wall ? 4 : 7);
        g.fill();
      }
    }
    for (let i = 0; i < info.stars.length; i++) {
      const s = info.stars[i]!;
      const c = cellRect(s.x, s.y);
      if (taken[i]) {
        g.strokeStyle = 'rgba(255,213,74,.35)';
        g.lineWidth = 1.6;
        g.beginPath();
        g.arc(c.x + CELL / 2, c.y + CELL / 2, 9, 0, Math.PI * 2);
        g.stroke();
      } else {
        drawStar(c.x + CELL / 2, c.y + CELL / 2, 12, C_STAR);
      }
    }
    drawRobot();

    // 盤の下の ひとこと
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = 'bold 13px sans-serif';
    const left = taken.filter((t) => !t).length;
    if (mode === 'cleared') {
      g.fillStyle = C_RUN;
      g.fillText(`クリア！ +${stageScore(runs)}てん`, W / 2, 330);
    } else if (mode === 'failed') {
      g.fillStyle = C_NG;
      g.fillText(`ほしが ${left}こ のこった。なおして もう一度`, W / 2, 330);
    } else if (mode === 'run') {
      g.fillStyle = C_STAR;
      g.fillText('うごいてる… とちゅうで 直せないよ', W / 2, 330);
    } else {
      g.fillStyle = C_DIM;
      g.fillText(`ほしを ${info.stars.length}こ ぜんぶ とろう`, W / 2, 330);
    }

    drawRow('main');
    drawRow('sub');

    // 命令ボタン
    for (const b of cmdButtons()) {
      g.fillStyle = mode === 'edit' ? C_PANEL : 'rgba(27,37,64,.5)';
      roundRect(b.x, b.y, b.w, b.h, 12);
      g.fill();
      g.strokeStyle = C_LINE;
      g.lineWidth = 1.6;
      roundRect(b.x, b.y, b.w, b.h, 12);
      g.stroke();
      drawGlyph(b.cmd, b.x + b.w / 2, b.y + b.h / 2 - 6, 22, mode === 'edit' ? C_TEXT : C_DIM);
      g.fillStyle = C_DIM;
      g.font = 'bold 10px sans-serif';
      g.fillText(
        b.cmd === 'F' ? 'すすむ' : b.cmd === 'L' ? 'ひだり' : b.cmd === 'R' ? 'みぎ' : 'くりかえし',
        b.x + b.w / 2,
        b.y + b.h - 9,
      );
    }

    // うごかす／ぜんぶけす
    g.fillStyle = mode === 'edit' ? C_RUN : 'rgba(47,163,107,.35)';
    roundRect(RUN_BTN.x, RUN_BTN.y, RUN_BTN.w, RUN_BTN.h, 14);
    g.fill();
    g.fillStyle = '#fff';
    g.font = 'bold 20px sans-serif';
    g.fillText('▶ うごかす', RUN_BTN.x + RUN_BTN.w / 2, RUN_BTN.y + RUN_BTN.h / 2);
    g.fillStyle = mode === 'edit' ? C_PANEL : 'rgba(27,37,64,.5)';
    roundRect(CLR_BTN.x, CLR_BTN.y, CLR_BTN.w, CLR_BTN.h, 14);
    g.fill();
    g.strokeStyle = C_LINE;
    g.lineWidth = 1.6;
    roundRect(CLR_BTN.x, CLR_BTN.y, CLR_BTN.w, CLR_BTN.h, 14);
    g.stroke();
    g.fillStyle = C_TEXT;
    g.font = 'bold 15px sans-serif';
    g.fillText('ぜんぶ けす', CLR_BTN.x + CLR_BTN.w / 2, CLR_BTN.y + CLR_BTN.h / 2);

    g.fillStyle = C_DIM;
    g.font = 'bold 11px sans-serif';
    g.fillText('おいた めいれいを タップすると もどせる', W / 2, 600);
  }

  draw();
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
      draw();
    },
    destroy() {
      offTap();
      offFrame();
    },
  };
}
