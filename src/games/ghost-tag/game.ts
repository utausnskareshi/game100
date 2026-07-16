// =============================================================
// かげぶんしんタッグ（No.63）: 1回目の自分が「かげ」になって再生される協力パズル
// =============================================================
// - 2幕制。さくせん（1回目）でキャラ1を動かして記録→ほんばん（2回目）は
//   かげ（記録の再生）がスイッチ床を踏んでとびらを開けてくれる間に、キャラ2でゴールへ。
// - ステージ定義・かげ再生・とびら判定は logic.ts（純ロジック・乱数不使用）。
// - 全画面 Canvas。操作は onSwipe＋onTap（十字ボタン/かんりょうボタン）。
//   onMove 非購読＝キャプチャ事故なし。時間はすべて ctx.now の期限方式・setTimeout 不使用。
// - import してよいのは game-api（types / helpers）と、このフォルダ内（logic）だけ
import type { GameContext, IGame, SwipeDir } from '../../game-api/types';
import {
  CLEAR_PTS,
  COLS,
  type Dir,
  GEM_PTS,
  MOVE_MS,
  type MoveRec,
  PLAY_MAX_MS,
  REC_MAX_MS,
  type Stage,
  TIME_PTS,
  canMove,
  colOf,
  ghostPose,
  makeStages,
  openDoorsFor,
  rowOf,
} from './logic';

const W = 360;
const H = 640;
const HUD_H = 44;
const BAR_Y = 50;
const BOARD_Y = 64;
const CELL = 45; // 8×8 → 360px
const MSG_Y = 442;
const SCORE_HI = 700;
const FAST_PLAN_MS = 12_000;

type Mode = 'A' | 'A2B' | 'B' | 'next' | 'over';

interface Ch {
  from: number;
  to: number;
  t0: number;
  pending: boolean;
}

const DOOR_COLORS = ['#ffd45e', '#6fe08a', '#c99bff'];

export function createGame(ctx: GameContext): IGame {
  const cv = ctx.canvas2d({ design: { w: W, h: H } });
  const g = cv.ctx;
  const stages = makeStages();

  let mode: Mode = 'A';
  let hostPaused = false;
  let si = 0;
  let stage: Stage = stages[0]!;
  let ch1: Ch = { from: 0, to: 0, t0: -9999, pending: false };
  let ch2: Ch = { from: 0, to: 0, t0: -9999, pending: false };
  let rec: MoveRec[] = [];
  let recDur = 0;
  let phaseAStart = 0;
  let phaseBStart = 0;
  let introUntil = 0;
  let bridgeAt = 0;
  let nextAt = 0;
  let endAt = 0;
  let ended = false;
  let gemsLeft = new Set<number>();
  let stageGemTotal = 0;
  let stageGemsGot = 0;
  let score = 0;
  let doorPasses = 0;
  let overText = '';
  let overSub = '';

  function initStage(idx: number, now: number): void {
    si = idx;
    stage = stages[idx]!;
    ch1 = { from: stage.start1, to: stage.start1, t0: now - MOVE_MS, pending: false };
    ch2 = { from: stage.start2, to: stage.start2, t0: now - MOVE_MS, pending: false };
    rec = [];
    recDur = 0;
    gemsLeft = new Set(stage.gems);
    stageGemTotal = stage.gems.length;
    stageGemsGot = 0;
    mode = 'A';
    phaseAStart = now;
    introUntil = now + 1500;
  }

  function poseCell(ch: Ch, now: number): number {
    if (!ch.pending) return ch.to;
    const p = (now - ch.t0) / MOVE_MS;
    return p < 0.54 ? ch.from : ch.to;
  }

  function chXY(ch: Ch, now: number): { x: number; y: number } {
    const p = ch.pending ? Math.min(1, (now - ch.t0) / MOVE_MS) : 1;
    const cx = colOf(ch.from) + (colOf(ch.to) - colOf(ch.from)) * p;
    const cy = rowOf(ch.from) + (rowOf(ch.to) - rowOf(ch.from)) * p;
    return { x: cx * CELL + CELL / 2, y: BOARD_Y + cy * CELL + CELL / 2 };
  }

  function currentOpenDoors(now: number): Set<number> {
    if (mode === 'B' || mode === 'next' || mode === 'over') {
      const gp = ghostPose(rec, stage.start1, now - phaseBStart);
      return openDoorsFor(stage, [gp.cell, poseCell(ch2, now)]);
    }
    return openDoorsFor(stage, [poseCell(ch1, now), stage.start2]);
  }

  function addScore(n: number): void {
    score += n;
    if (score >= SCORE_HI) ctx.achieve('score-hi');
  }

  function tryMove(dir: Dir, now: number): void {
    if (hostPaused) return;
    const ch = mode === 'A' ? ch1 : mode === 'B' ? ch2 : null;
    if (!ch || ch.pending) return;
    const to = canMove(stage, ch.to, dir, currentOpenDoors(now));
    if (to == null) return;
    ch.from = ch.to;
    ch.to = to;
    ch.t0 = now;
    ch.pending = true;
    ctx.sfx('tap');
    if (mode === 'A') rec.push({ t: now - phaseAStart, from: ch.from, to });
  }

  function endPlanA(now: number): void {
    // 移動中に「かんりょう！」を押した場合は その移動の到着を先に確定する
    // （A2B遷移後は ch1 の到着処理がスキップされ、移動先の💎が回収されないため）
    if (ch1.pending) {
      ch1.pending = false;
      onArrive(ch1, now);
    }
    const last = rec[rec.length - 1];
    recDur = Math.max(now - phaseAStart, last ? last.t + MOVE_MS : 0);
    mode = 'A2B';
    bridgeAt = now + 1400;
    ctx.sfx('start');
  }

  function onArrive(ch: Ch, now: number): void {
    const cell = ch.to;
    if (gemsLeft.has(cell)) {
      gemsLeft.delete(cell);
      stageGemsGot++;
      addScore(GEM_PTS);
      ctx.sfx('combo');
      ctx.haptic('light');
    }
    if (mode !== 'B' || ch !== ch2) return;
    if (stage.doors.some((d) => d.cell === cell)) {
      doorPasses++;
      if (doorPasses >= 3) ctx.achieve('door-3');
    }
    if (cell === stage.goal) stageClear(now);
  }

  function stageClear(now: number): void {
    const remain = Math.max(0, PLAY_MAX_MS - (now - phaseBStart));
    addScore(CLEAR_PTS + Math.floor(remain / 1000) * TIME_PTS);
    ctx.achieve('first-clear');
    if (stageGemsGot >= stageGemTotal) ctx.achieve('gems-stage');
    if (recDur <= FAST_PLAN_MS) ctx.achieve('fast-plan');
    ctx.haptic('success');
    if (si >= stages.length - 1) {
      ctx.achieve('all-clear');
      mode = 'over';
      overText = 'ぜんぶクリア！';
      overSub = 'さいこうのタッグ！';
      endAt = now + 2000;
      ctx.sfx('medal');
    } else {
      mode = 'next';
      nextAt = now + 1600;
      ctx.sfx('success');
    }
  }

  function fail(now: number): void {
    mode = 'over';
    overText = 'じかんぎれ…';
    overSub = 'ここまでの きろくで おわるよ';
    endAt = now + 1900;
    ctx.sfx('fail');
    ctx.haptic('error');
  }

  // ---- 入力 ----
  const offSwipe = ctx.input.onSwipe((dir: SwipeDir) => tryMove(dir, ctx.now()));

  const DPAD = { x: 108, y: 550, arm: 40, half: 26 };
  const DONE_BTN = { x: 208, y: 520, w: 138, h: 60 };
  function dpadDir(x: number, y: number): Dir | null {
    const { x: cx, y: cy, arm, half } = DPAD;
    if (Math.abs(x - cx) <= half && y >= cy - arm - half && y < cy - 4) return 'up';
    if (Math.abs(x - cx) <= half && y > cy + 4 && y <= cy + arm + half) return 'down';
    if (Math.abs(y - cy) <= half && x >= cx - arm - half && x < cx - 4) return 'left';
    if (Math.abs(y - cy) <= half && x > cx + 4 && x <= cx + arm + half) return 'right';
    return null;
  }
  const offTap = ctx.input.onTap((p) => {
    if (hostPaused) return;
    const l = cv.toLocal(p);
    const now = ctx.now();
    if (mode === 'A' && l.x >= DONE_BTN.x && l.x <= DONE_BTN.x + DONE_BTN.w && l.y >= DONE_BTN.y && l.y <= DONE_BTN.y + DONE_BTN.h) {
      endPlanA(now);
      return;
    }
    const d = dpadDir(l.x, l.y);
    if (d) tryMove(d, now);
  });

  // ---- 毎フレーム ----
  const offFrame = ctx.onFrame(() => {
    if (hostPaused) return;
    const now = ctx.now();

    // 移動アニメの完了処理（到着イベントは1回だけ）
    for (const ch of [ch1, ch2]) {
      if (ch.pending && now >= ch.t0 + MOVE_MS) {
        ch.pending = false;
        if ((mode === 'A' && ch === ch1) || (mode === 'B' && ch === ch2)) onArrive(ch, now);
      }
    }

    if (mode === 'A') {
      if (now - phaseAStart >= REC_MAX_MS) endPlanA(now);
    } else if (mode === 'A2B') {
      if (now >= bridgeAt) {
        mode = 'B';
        phaseBStart = now;
        introUntil = now + 1300;
      }
    } else if (mode === 'B') {
      if (now - phaseBStart >= PLAY_MAX_MS) fail(now);
    } else if (mode === 'next') {
      if (now >= nextAt) initStage(si + 1, now);
    } else if (mode === 'over') {
      if (!ended && now >= endAt) {
        ended = true;
        ctx.end({ score });
        return;
      }
    }

    draw(now);
    setData(now);
  });

  function setData(now: number): void {
    if (!import.meta.env.DEV) return;
    const r = ctx.root as HTMLElement;
    r.dataset.mode = mode;
    r.dataset.si = String(si);
    r.dataset.score = String(score);
    r.dataset.recn = String(rec.length);
    r.dataset.recdur = String(Math.round(recDur));
    r.dataset.c1 = String(poseCell(ch1, now));
    r.dataset.c2 = String(poseCell(ch2, now));
    r.dataset.ghost = mode === 'B' ? String(ghostPose(rec, stage.start1, now - phaseBStart).cell) : '';
    r.dataset.doors = [...currentOpenDoors(now)].join(',');
    r.dataset.gems = String(stageGemsGot);
    r.dataset.gemtotal = String(stageGemTotal);
    r.dataset.passes = String(doorPasses);
  }

  // ---- 描画 ----
  function roundRect(x: number, y: number, w: number, h: number, rad: number): void {
    const rr = Math.min(rad, w / 2, h / 2);
    g.beginPath();
    g.moveTo(x + rr, y);
    g.arcTo(x + w, y, x + w, y + h, rr);
    g.arcTo(x + w, y + h, x, y + h, rr);
    g.arcTo(x, y + h, x, y, rr);
    g.arcTo(x, y, x + w, y, rr);
    g.closePath();
  }

  function drawChar(x: number, y: number, color: string, alpha: number, ghost: boolean): void {
    g.save();
    g.globalAlpha = alpha;
    g.fillStyle = color;
    g.beginPath();
    g.arc(x, y, 15, 0, Math.PI * 2);
    g.fill();
    if (ghost) {
      g.strokeStyle = 'rgba(255,255,255,.8)';
      g.setLineDash([4, 4]);
      g.lineWidth = 2;
      g.beginPath();
      g.arc(x, y, 18, 0, Math.PI * 2);
      g.stroke();
      g.setLineDash([]);
    }
    g.fillStyle = '#fff';
    for (const dx of [-5.5, 5.5]) {
      g.beginPath();
      g.arc(x + dx, y - 3, 4, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = '#1a2340';
    for (const dx of [-5.5, 5.5]) {
      g.beginPath();
      g.arc(x + dx, y - 3, 2, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
  }

  function draw(now: number): void {
    g.fillStyle = '#0f1830';
    g.fillRect(0, 0, W, H);

    // 盤面
    const open = currentOpenDoors(now);
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < COLS; c++) {
        const i = r * COLS + c;
        const x = c * CELL;
        const y = BOARD_Y + r * CELL;
        if (stage.wall[i]) {
          g.fillStyle = '#141d3c';
          g.fillRect(x, y, CELL, CELL);
          g.fillStyle = 'rgba(255,255,255,.05)';
          g.fillRect(x, y, CELL, 3);
          continue;
        }
        g.fillStyle = '#233260';
        g.fillRect(x + 1, y + 1, CELL - 2, CELL - 2);
        const di = stage.doors.findIndex((d) => d.cell === i);
        if (di >= 0) {
          const col = DOOR_COLORS[di % DOOR_COLORS.length]!;
          if (open.has(di)) {
            g.strokeStyle = col;
            g.setLineDash([5, 4]);
            g.lineWidth = 2;
            g.strokeRect(x + 5, y + 5, CELL - 10, CELL - 10);
            g.setLineDash([]);
          } else {
            g.fillStyle = col;
            roundRect(x + 4, y + 4, CELL - 8, CELL - 8, 6);
            g.fill();
            g.fillStyle = 'rgba(0,0,0,.45)';
            g.fillRect(x + 10, y + CELL / 2 - 3, CELL - 20, 6);
          }
        }
        const pl = stage.plates.find((q) => q.cell === i);
        if (pl) {
          const col = DOOR_COLORS[pl.door % DOOR_COLORS.length]!;
          const pressed = open.has(pl.door);
          g.fillStyle = col;
          g.globalAlpha = pressed ? 1 : 0.5;
          g.beginPath();
          g.arc(x + CELL / 2, y + CELL / 2, pressed ? 15 : 12, 0, Math.PI * 2);
          g.fill();
          g.globalAlpha = 1;
          g.strokeStyle = col;
          g.lineWidth = 2;
          g.beginPath();
          g.arc(x + CELL / 2, y + CELL / 2, 16, 0, Math.PI * 2);
          g.stroke();
        }
        if (gemsLeft.has(i)) {
          g.font = '20px sans-serif';
          g.textAlign = 'center';
          g.textBaseline = 'middle';
          g.fillText('💎', x + CELL / 2, y + CELL / 2 + 1);
        }
        if (i === stage.goal) {
          const pulse = 1 + Math.sin(now / 260) * 0.12;
          g.font = `${Math.round(22 * pulse)}px sans-serif`;
          g.textAlign = 'center';
          g.textBaseline = 'middle';
          g.fillText('⭐', x + CELL / 2, y + CELL / 2 + 1);
        }
      }
    }

    // キャラ・かげ
    if (mode === 'A' || mode === 'A2B') {
      const p2 = chXY(ch2, now);
      drawChar(p2.x, p2.y, '#5bb8ff', 0.35, false);
      const p1 = chXY(ch1, now);
      drawChar(p1.x, p1.y, '#ff8ab0', 1, false);
    } else {
      const gp = ghostPose(rec, stage.start1, now - phaseBStart);
      drawChar(gp.cx * CELL + CELL / 2, BOARD_Y + gp.cy * CELL + CELL / 2, '#ff8ab0', 0.55, true);
      const p2 = chXY(ch2, now);
      drawChar(p2.x, p2.y, '#5bb8ff', 1, false);
    }

    // HUD
    g.fillStyle = '#0c1426';
    g.fillRect(0, 0, W, HUD_H);
    g.fillStyle = '#fff';
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.font = 'bold 19px sans-serif';
    g.fillText(`${score}てん`, 12, HUD_H / 2);
    g.fillStyle = '#9fb2e8';
    g.font = 'bold 15px sans-serif';
    g.fillText(`ステージ${si + 1}/3`, 132, HUD_H / 2);
    g.fillText(`💎${stageGemsGot}/${stageGemTotal}`, 232, HUD_H / 2);

    // タイマーバー
    let frac = 0;
    let barCol = '#ffd76a';
    if (mode === 'A') {
      frac = Math.max(0, 1 - (now - phaseAStart) / REC_MAX_MS);
    } else if (mode === 'B' || mode === 'next' || mode === 'over') {
      const remain = Math.max(0, 1 - (now - phaseBStart) / PLAY_MAX_MS);
      frac = mode === 'B' ? remain : 0;
      barCol = remain < 0.2 ? '#ff7a6a' : '#6fe08a';
    }
    g.fillStyle = 'rgba(255,255,255,.12)';
    roundRect(12, BAR_Y, W - 24, 8, 4);
    g.fill();
    if (frac > 0) {
      g.fillStyle = barCol;
      roundRect(12, BAR_Y, (W - 24) * frac, 8, 4);
      g.fill();
    }

    // メッセージ行
    g.textAlign = 'center';
    g.font = 'bold 14px sans-serif';
    if (mode === 'A') {
      g.fillStyle = '#ffd1e2';
      g.fillText('さくせんタイム！ きみのうごきが かげに なるよ', W / 2, MSG_Y);
    } else if (mode === 'B') {
      g.fillStyle = '#bfe6ff';
      g.fillText('ほんばん！ かげと きょうりょくして ⭐へ！', W / 2, MSG_Y);
    }

    // 十字ボタン
    const { x: cx, y: cy, arm, half } = DPAD;
    g.fillStyle = 'rgba(255,255,255,.08)';
    g.beginPath();
    g.arc(cx, cy, arm + half + 6, 0, Math.PI * 2);
    g.fill();
    const dirs: [number, number][] = [
      [0, -1],
      [0, 1],
      [-1, 0],
      [1, 0],
    ];
    for (const [dx, dy] of dirs) {
      g.fillStyle = 'rgba(255,255,255,.55)';
      const tipx = cx + dx * (half + arm);
      const tipy = cy + dy * (half + arm);
      const bx = cx + dx * (half + 2);
      const by = cy + dy * (half + 2);
      const px = dy * 11;
      const py = dx * 11;
      g.beginPath();
      g.moveTo(tipx, tipy);
      g.lineTo(bx + px, by + py);
      g.lineTo(bx - px, by - py);
      g.closePath();
      g.fill();
    }

    // かんりょうボタン（さくせん中のみ）
    if (mode === 'A') {
      g.fillStyle = '#ffd76a';
      roundRect(DONE_BTN.x, DONE_BTN.y, DONE_BTN.w, DONE_BTN.h, 14);
      g.fill();
      g.fillStyle = '#4a3200';
      g.font = 'bold 18px sans-serif';
      g.fillText('かんりょう！', DONE_BTN.x + DONE_BTN.w / 2, DONE_BTN.y + 24);
      g.font = '11px sans-serif';
      g.fillText('さくせんを おわる', DONE_BTN.x + DONE_BTN.w / 2, DONE_BTN.y + 44);
    } else if (mode === 'B') {
      g.fillStyle = 'rgba(255,138,176,.75)';
      g.font = 'bold 13px sans-serif';
      g.fillText('かげ: さいせいちゅう…', DONE_BTN.x + DONE_BTN.w / 2, DONE_BTN.y + 30);
    }

    // バナー
    let banner = '';
    let sub = '';
    if (mode === 'A' && now < introUntil) {
      banner = `ステージ${si + 1}`;
      sub = 'さくせんタイム！';
    } else if (mode === 'A2B') {
      banner = 'ほんばん！';
      sub = 'かげと きょうりょく！';
    } else if (mode === 'B' && now < introUntil) {
      banner = 'ほんばん！';
      sub = 'かげが うごくよ！';
    } else if (mode === 'next') {
      banner = 'クリア！';
      sub = `+${CLEAR_PTS}てん！ つぎのステージへ`;
    } else if (mode === 'over') {
      banner = overText;
      sub = overSub;
    }
    if (banner) {
      g.fillStyle = 'rgba(5,10,26,.62)';
      roundRect(40, 220, W - 80, 118, 16);
      g.fill();
      g.fillStyle = '#fff';
      g.font = 'bold 30px sans-serif';
      g.fillText(banner, W / 2, 268);
      g.fillStyle = '#cfd8ff';
      g.font = 'bold 15px sans-serif';
      g.fillText(sub, W / 2, 306);
    }
  }

  draw(0);

  return {
    start() {
      initStage(0, ctx.now());
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
      offSwipe();
      offTap();
      offFrame();
    },
  };
}
