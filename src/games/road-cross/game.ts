// =============================================================
// ぴょんこのみちわたり（No.59・道と川をわたる横断アクション）: 車をよけ 丸太に乗って 上の ゴールへ！
// =============================================================
// - スワイプ/十字ボタンで 1マスずつ ジャンプ。道路の車に当たる・川で水に落ちると ミス（ライフ3）。
//   ゴールに つくと とくてん＆スピードUP。丸太には 乗って いっしょに ながれる。
// - レーン・配置・判定は logic.ts（純ロジック・rng注入）。全画面 Canvas・純描画。
// - 操作は onSwipe＋onTap（十字ボタン）。onMove 非購読＝キャプチャ事故なし。ctx.now・setTimeout不使用。
// - import してよいのは game-api（types / helpers）と、このフォルダ内（logic）だけ
import type { GameContext, IGame, SwipeDir } from '../../game-api/types';
import { clamp } from '../../game-api/helpers';
import {
  COLS,
  GOAL_ROW,
  type Lane,
  ROWS,
  START_ROW,
  carHit,
  laneKind,
  logUnder,
  makeLanes,
  stepLane,
} from './logic';

const W = 360;
const H = 640;
const HUD_H = 44;
const CW = W / COLS; // 40
const CH = (H - HUD_H) / ROWS; // ≈54
const RESPAWN_MS = 700;
const END_DELAY = 1700;
const SCORE_HI = 800;

type Mode = 'play' | 'dead' | 'over';

export function createGame(ctx: GameContext): IGame {
  const cv = ctx.canvas2d({ design: { w: W, h: H } });
  const g = cv.ctx;

  let mode: Mode = 'play';
  let hostPaused = false;
  let lanes: (Lane | null)[] = makeLanes(ctx.random);
  let charRow = START_ROW;
  let charX = 4; // 左端セル座標（連続値）
  let lives = 3;
  let score = 0;
  let crossings = 0;
  let deaths = 0;
  let minRow = START_ROW; // この生涯で いちばん上に行った行（前進得点用）
  let rodeLog = false;
  let deadUntil = 0;
  let endAt = 0;
  let ended = false;
  let msg = '';

  const speedMult = (): number => 1 + crossings * 0.14;

  function setData(): void {
    if (!import.meta.env.DEV) return;
    const r = ctx.root as HTMLElement;
    r.dataset.mode = mode;
    r.dataset.score = String(score);
    r.dataset.lives = String(lives);
    r.dataset.cross = String(crossings);
    r.dataset.row = String(charRow);
    r.dataset.cx = charX.toFixed(2);
    r.dataset.deaths = String(deaths);
    r.dataset.lanedata = lanes
      .map((lane, row) => (lane ? `${row}:${lane.kind[0]}:${lane.len}:${lane.entities.map((e) => e.x.toFixed(2)).join(',')}` : ''))
      .filter(Boolean)
      .join(';');
  }

  function respawn(): void {
    charRow = START_ROW;
    charX = 4;
    minRow = START_ROW;
    mode = 'play';
  }

  function die(reason: string): void {
    lives--;
    deaths++;
    msg = reason;
    ctx.sfx('fail');
    ctx.haptic('error');
    if (lives <= 0) {
      mode = 'over';
      endAt = ctx.now() + END_DELAY;
    } else {
      mode = 'dead';
      deadUntil = ctx.now() + RESPAWN_MS;
    }
  }

  function reachGoal(): void {
    crossings++;
    score += 100;
    ctx.sfx('medal');
    ctx.haptic('success');
    ctx.achieve('first-cross');
    if (crossings >= 3) ctx.achieve('cross-3');
    if (crossings >= 5) ctx.achieve('cross-5');
    if (deaths === 0) ctx.achieve('no-death-cross');
    if (score >= SCORE_HI) ctx.achieve('score-hi');
    respawn();
  }

  // ---- 入力（1マスジャンプ）----
  function hop(dir: SwipeDir): void {
    if (mode !== 'play' || hostPaused) return;
    if (dir === 'up' && charRow > GOAL_ROW) charRow--;
    else if (dir === 'down' && charRow < START_ROW) charRow++;
    else if (dir === 'left') charX = clamp(charX - 1, 0, COLS - 1);
    else if (dir === 'right') charX = clamp(charX + 1, 0, COLS - 1);
    ctx.sfx('tap');
    // 前進得点（新しく上の行に到達）。score-hi はここでも即判定
    // （ゴール時のみ判定だと、前進+5で800を超えた直後に3ミス終了すると取りこぼす）
    if (charRow < minRow) {
      score += 5;
      minRow = charRow;
      if (score >= SCORE_HI) ctx.achieve('score-hi');
    }
    if (charRow === GOAL_ROW) {
      reachGoal();
      return;
    }
    checkCell();
  }

  const DIR_OF: Record<SwipeDir, SwipeDir> = { up: 'up', down: 'down', left: 'left', right: 'right' };
  const offSwipe = ctx.input.onSwipe((dir) => hop(DIR_OF[dir]));

  const DPAD = { x: W - 62, y: H - 66, arm: 26, half: 15 };
  function dpadDir(x: number, y: number): SwipeDir | null {
    const { x: cx, y: cy, arm, half } = DPAD;
    if (Math.abs(x - cx) <= half && y >= cy - arm - half && y < cy) return 'up';
    if (Math.abs(x - cx) <= half && y > cy && y <= cy + arm + half) return 'down';
    if (Math.abs(y - cy) <= half && x < cx) return 'left';
    if (Math.abs(y - cy) <= half && x > cx) return 'right';
    return null;
  }
  const offTap = ctx.input.onTap((p) => {
    const l = cv.toLocal(p);
    const d = dpadDir(l.x, l.y);
    if (d) hop(d);
  });

  // ---- 現在マスの判定（着地時＆毎フレーム）----
  function checkCell(): void {
    if (mode !== 'play') return;
    const kind = laneKind(charRow);
    const lane = lanes[charRow];
    if (kind === 'road' && lane) {
      if (carHit(charX, lane)) die('車に ぶつかった！');
    } else if (kind === 'river' && lane) {
      if (!logUnder(charX, lane)) die('水に おちた！');
      else rodeLog = true;
      if (rodeLog) ctx.achieve('river-ride');
    }
  }

  // ---- 毎フレーム ----
  const offFrame = ctx.onFrame((dt) => {
    if (hostPaused) return;
    const now = ctx.now();
    if (mode === 'play') {
      // レーンを動かす
      for (const lane of lanes) if (lane) stepLane(lane, dt, speedMult());
      // 川に乗っているなら 丸太と一緒に流れる
      const kind = laneKind(charRow);
      const lane = lanes[charRow];
      if (kind === 'river' && lane) {
        const log = logUnder(charX, lane);
        if (log) {
          charX += lane.dir * lane.speed * speedMult() * dt;
          rodeLog = true;
          if (charX < -0.4 || charX > COLS - 0.6) die('ながされた！');
        } else {
          die('水に おちた！');
        }
      } else if (kind === 'road' && lane) {
        if (carHit(charX, lane)) die('車に ぶつかった！');
      }
    } else if (mode === 'dead') {
      if (now >= deadUntil) respawn();
    } else if (mode === 'over') {
      if (!ended && now >= endAt) {
        ended = true;
        ctx.end({ score });
        return;
      }
    }
    draw(now);
    setData();
  });

  // ---- 描画 ----
  function cellY(row: number): number {
    return HUD_H + row * CH;
  }
  function draw(now: number): void {
    // レーン背景
    for (let row = 0; row < ROWS; row++) {
      const k = laneKind(row);
      g.fillStyle = k === 'goal' ? '#ffd76a' : k === 'river' ? '#2a8fd0' : k === 'road' ? '#3a3f4a' : '#5fae4e';
      g.fillRect(0, cellY(row), W, CH);
      if (k === 'road') {
        g.strokeStyle = 'rgba(255,255,255,.35)';
        g.setLineDash([10, 10]);
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(0, cellY(row) + CH / 2);
        g.lineTo(W, cellY(row) + CH / 2);
        g.stroke();
        g.setLineDash([]);
      }
    }
    // ゴール文字
    g.fillStyle = '#8a5a00';
    g.font = 'bold 20px sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('🏁 ゴール 🏁', W / 2, cellY(GOAL_ROW) + CH / 2);

    // 車・丸太
    for (let row = 0; row < ROWS; row++) {
      const lane = lanes[row];
      if (!lane) continue;
      const y = cellY(row);
      for (const e of lane.entities) {
        const x = e.x * CW;
        const w = e.len * CW;
        if (lane.kind === 'river') {
          g.fillStyle = '#8a5a2b';
          roundRect(x + 2, y + 8, w - 4, CH - 16, 8);
          g.fill();
        } else {
          g.fillStyle = ['#e0483c', '#e8a020', '#4a8de0', '#9b6cf0'][(Math.abs(Math.round(e.x)) + row) % 4] ?? '#e0483c';
          roundRect(x + 3, y + 7, w - 6, CH - 14, 7);
          g.fill();
          // 窓
          g.fillStyle = 'rgba(255,255,255,.5)';
          g.fillRect(x + w - 14, y + 12, 6, CH - 24);
        }
      }
    }

    // キャラ（かえる）
    if (mode !== 'dead' || Math.floor(now / 120) % 2 === 0) {
      const px = charX * CW + CW / 2;
      const py = cellY(charRow) + CH / 2;
      g.fillStyle = '#4cd07a';
      g.beginPath();
      g.ellipse(px, py, CW * 0.34, CH * 0.3, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#eafff0';
      for (const dx of [-7, 7]) { g.beginPath(); g.arc(px + dx, py - 8, 5, 0, Math.PI*2); g.fill(); }
      g.fillStyle = '#123';
      for (const dx of [-7, 7]) { g.beginPath(); g.arc(px + dx, py - 8, 2.4, 0, Math.PI*2); g.fill(); }
    }

    // 十字ボタン
    drawDpad();

    // HUD
    g.fillStyle = '#12202e';
    g.fillRect(0, 0, W, HUD_H);
    g.fillStyle = '#fff';
    g.textAlign = 'left';
    g.font = 'bold 20px sans-serif';
    g.fillText(`${score}てん`, 12, HUD_H / 2);
    g.textAlign = 'right';
    g.fillText('🐸'.repeat(Math.max(0, lives)) + `  ${crossings}かい`, W - 12, HUD_H / 2);

    if (mode === 'dead') {
      g.fillStyle = '#ffd76a';
      g.textAlign = 'center';
      g.font = 'bold 22px sans-serif';
      g.fillText(msg, W / 2, H / 2);
    }
    if (mode === 'over') {
      g.fillStyle = 'rgba(8,20,30,.74)';
      g.fillRect(0, 0, W, H);
      g.fillStyle = '#fff';
      g.textAlign = 'center';
      g.font = 'bold 30px sans-serif';
      g.fillText('ゲームオーバー', W / 2, H / 2 - 30);
      g.font = 'bold 24px sans-serif';
      g.fillText(`${crossings}かい わたった / ${score}てん`, W / 2, H / 2 + 12);
    }
  }

  function drawDpad(): void {
    const { x: cx, y: cy, arm, half } = DPAD;
    const dirs: [SwipeDir, number, number][] = [['up',0,-1],['down',0,1],['left',-1,0],['right',1,0]];
    for (const [, dx, dy] of dirs) {
      g.fillStyle = 'rgba(255,255,255,.5)';
      const tipx = cx + dx * (half + arm), tipy = cy + dy * (half + arm);
      const bx = cx + dx * half, by = cy + dy * half;
      const px = dy * 9, py = dx * 9;
      g.beginPath();
      g.moveTo(tipx, tipy);
      g.lineTo(bx + px, by + py);
      g.lineTo(bx - px, by - py);
      g.closePath();
      g.fill();
    }
  }

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

  draw(0);
  setData();

  return {
    start() {
      /* immediate */
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
