// =============================================================
// ゆきだま ころころ（No.115・かくれゲーム）: なぞって 育てて ぴったりで 止める
// =============================================================
// - ねらい: 「大きくする」ではなく「ねらった 大きさに 合わせる」。
//   雪のない ところを 転がすと 小さくなるので、行きすぎても やり直せる＝しっぱい無し。
// - 時間制限なし・ライフなし の のんびり系。うまさは「ぴったり ぐあい」で 出る。
// - import してよいのは game-api（types / helpers）と、このフォルダ内（logic）だけ。
import type { GameContext, IGame, PointerInfo } from '../../game-api/types';
import { clamp } from '../../game-api/helpers';
import {
  CELL,
  COLS,
  DONE_BONUS,
  FIELD_X,
  FIELD_Y,
  GAIN,
  MAX_SIZE,
  PARTS,
  PART_COUNT,
  ROWS,
  SHRINK_PER_PX,
  SNOW_MS,
  START_SIZE,
  cellCenter,
  cellsUnder,
  fits,
  makeField,
  partScore,
} from './logic';

const W = 360;
const H = 640;
const HUD_H = 46;

/** 見くらべの わ の 中心 */
const CMP_X = 180;
const CMP_Y = 100;

const PLACE_BTN = { x: 60, y: 556, w: 240, h: 48 };
const PLACED_MS = 1400;
const END_DELAY = 2600;
const SCORE_HI = 570;

const C_BG = '#cfe4f2';
const C_FIELD = '#eef7fd';
const C_SNOW = '#ffffff';
const C_BARE = '#b9cfdd';
const C_TEXT = '#1e3546';
const C_DIM = '#5a7488';
const C_BALL = '#fbfdff';
const C_LINE = '#7ea3bb';
const C_OK = '#2e8f4f';
const C_NG = '#d98a3c';

type Mode = 'roll' | 'placed' | 'done';

export function createGame(ctx: GameContext): IGame {
  const cv = ctx.canvas2d({ design: { w: W, h: H } });
  const g = cv.ctx;

  const field: boolean[] = makeField(ctx.random);
  let partIdx = 0;
  let part = PARTS[0]!;
  let size = START_SIZE;
  let bx = FIELD_X + (COLS * CELL) / 2;
  let by = FIELD_Y + ROWS * CELL - 60;
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let mode: Mode = 'roll';
  let started = false;
  let hostPaused = false;
  let ended = false;
  let score = 0;
  let placed = 0;
  let perfects = 0;
  /** 置いた たま の 大きさ（雪だるまの 絵に つかう） */
  const built: number[] = [];
  let nextSnowAt = 0;
  let phaseUntil = 0;
  let hintUntil = 0;
  let hintText = '';
  let lastEvent = '';

  function resetBall(): void {
    size = START_SIZE;
    bx = FIELD_X + (COLS * CELL) / 2;
    by = FIELD_Y + ROWS * CELL - 60;
    dragging = false;
  }

  // ---------- うごき ----------
  function moveBy(dx: number, dy: number): void {
    const dist = Math.hypot(dx, dy);
    if (dist <= 0) return;
    // すり抜け防止に 細かく 進める
    const steps = Math.max(1, Math.ceil(dist / 6));
    for (let s = 0; s < steps; s++) {
      bx = clamp(bx + dx / steps, FIELD_X + size, FIELD_X + COLS * CELL - size);
      by = clamp(by + dy / steps, FIELD_Y + size, FIELD_Y + ROWS * CELL - size);
      let ate = 0;
      for (const i of cellsUnder(bx, by, size)) {
        if (field[i]) {
          field[i] = false;
          ate++;
        }
      }
      if (ate > 0) {
        size = Math.min(MAX_SIZE, size + GAIN * ate);
        ctx.sfx('tick');
      } else {
        size = Math.max(START_SIZE, size - SHRINK_PER_PX * (dist / steps));
      }
    }
  }

  // ---------- 入力 ----------
  const offDown = ctx.input.onDown((p: PointerInfo) => {
    if (hostPaused || !started || mode !== 'roll') return;
    const l = cv.toLocal(p);
    dragging = true;
    lastX = l.x;
    lastY = l.y;
  });
  const offMove = ctx.input.onMove((p: PointerInfo) => {
    if (hostPaused || !started || mode !== 'roll' || !dragging) return;
    const l = cv.toLocal(p);
    moveBy(l.x - lastX, l.y - lastY);
    lastX = l.x;
    lastY = l.y;
  });
  const offUp = ctx.input.onUp(() => {
    dragging = false;
  });
  const offTap = ctx.input.onTap((p: PointerInfo) => {
    if (hostPaused || !started || mode !== 'roll') return;
    const l = cv.toLocal(p);
    if (l.x < PLACE_BTN.x || l.x > PLACE_BTN.x + PLACE_BTN.w) return;
    if (l.y < PLACE_BTN.y || l.y > PLACE_BTN.y + PLACE_BTN.h) return;
    tryPlace();
  });

  function tryPlace(): void {
    const now = ctx.now();
    if (!fits(part, size)) {
      hintText = size < part.target ? 'まだ 小さい。雪の上を 転がそう' : '大きすぎ。雪のない ところで へらそう';
      hintUntil = now + 1400;
      ctx.sfx('fail');
      lastEvent = `nofit:${partIdx}:${size.toFixed(1)}`;
      return;
    }
    const pts = partScore(part, size);
    score += pts;
    built.push(size);
    placed++;
    if (pts >= 200) {
      perfects++;
      ctx.achieve('perfect-ball');
    }
    if (placed === 1) ctx.achieve('first-ball');
    if (placed >= 2) ctx.achieve('half');
    mode = 'placed';
    phaseUntil = now + PLACED_MS;
    ctx.sfx('medal');
    ctx.haptic('success');
    lastEvent = `place:${partIdx}:${pts}:${size.toFixed(1)}`;
  }

  // ---------- 毎フレーム ----------
  const offFrame = ctx.onFrame(() => {
    if (hostPaused || !started) return;
    const now = ctx.now();
    // 雪が ふる（雪切れで つまらないように）
    if (now >= nextSnowAt) {
      nextSnowAt = now + SNOW_MS;
      const bare: number[] = [];
      for (let i = 0; i < field.length; i++) if (!field[i]) bare.push(i);
      if (bare.length > 0) {
        const pick = bare[Math.floor(ctx.random() * bare.length)]!;
        const p = cellCenter(pick);
        // いま 玉が のっている ところには ふらせない（いきなり 大きくならないように）
        if (Math.hypot(p.x - bx, p.y - by) > size + 6) field[pick] = true;
      }
    }
    if (mode === 'placed' && now >= phaseUntil) {
      if (partIdx + 1 >= PART_COUNT) finish(now);
      else {
        partIdx++;
        part = PARTS[partIdx]!;
        resetBall();
        mode = 'roll';
        lastEvent = `part:${partIdx}`;
      }
    } else if (mode === 'done' && !ended && now >= phaseUntil) {
      ended = true;
      ctx.end({ score });
      return;
    }
    draw(now);
    setData();
  });

  function finish(now: number): void {
    score += DONE_BONUS;
    ctx.achieve('snowman');
    if (perfects >= PART_COUNT) ctx.achieve('all-perfect');
    if (score >= SCORE_HI) ctx.achieve('score-hi');
    mode = 'done';
    phaseUntil = now + END_DELAY;
    ctx.sfx('medal');
    lastEvent = `finish:${score}:${perfects}`;
  }

  function setData(): void {
    if (!import.meta.env.DEV) return;
    const r = ctx.root as HTMLElement;
    r.dataset.mode = mode;
    r.dataset.part = String(partIdx);
    r.dataset.size = size.toFixed(2);
    r.dataset.target = String(part.target);
    r.dataset.tol = String(part.tol);
    r.dataset.fits = fits(part, size) ? '1' : '0';
    r.dataset.x = bx.toFixed(1);
    r.dataset.y = by.toFixed(1);
    r.dataset.snow = field.map((v) => (v ? '1' : '0')).join('');
    r.dataset.placed = String(placed);
    r.dataset.perfects = String(perfects);
    r.dataset.score = String(score);
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

  function draw(now: number): void {
    cv.clear(C_BG);

    // HUD
    g.fillStyle = '#183246';
    g.fillRect(0, 0, W, HUD_H);
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.fillStyle = '#eaf5fd';
    g.font = 'bold 18px sans-serif';
    g.fillText(`${score}てん`, 12, HUD_H / 2);
    g.fillStyle = '#9dc0d8';
    g.font = 'bold 13px sans-serif';
    g.fillText(`${Math.min(partIdx + 1, PART_COUNT)}/${PART_COUNT} こめ`, 116, HUD_H / 2 - 8);
    g.fillText(`ぴったり ${perfects}かい`, 116, HUD_H / 2 + 9);

    g.textAlign = 'center';

    if (mode === 'done') {
      g.fillStyle = C_TEXT;
      g.font = 'bold 26px sans-serif';
      g.fillText('ゆきだるま かんせい！', W / 2, 250);
      // できあがった 雪だるま（下から 順に つみ上げる）
      let cy = 500;
      for (let i = 0; i < built.length; i++) {
        const s = built[i]!;
        g.fillStyle = C_BALL;
        g.beginPath();
        g.arc(W / 2, cy, s, 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = C_LINE;
        g.lineWidth = 2;
        g.stroke();
        const next = built[i + 1];
        if (next !== undefined) cy -= s * 0.85 + next * 0.85;
      }
      g.fillStyle = C_TEXT;
      g.font = 'bold 34px sans-serif';
      g.fillText(`${score}てん`, W / 2, 300);
      g.fillStyle = C_DIM;
      g.font = 'bold 14px sans-serif';
      g.fillText(`ぴったり ${perfects} / ${PART_COUNT}`, W / 2, 336);
      return;
    }

    // 見くらべ（わく＝ねらい、なか＝いまの大きさ）
    g.fillStyle = C_DIM;
    g.font = 'bold 13px sans-serif';
    g.fillText(`${part.name}：わくに ぴったり 合わせよう`, W / 2, 60);
    g.fillStyle = fits(part, size) ? 'rgba(46,143,79,.20)' : 'rgba(255,255,255,.55)';
    g.beginPath();
    g.arc(CMP_X, CMP_Y, size, 0, Math.PI * 2);
    g.fill();
    g.setLineDash([6, 5]);
    g.strokeStyle = fits(part, size) ? C_OK : C_TEXT;
    g.lineWidth = 3;
    g.beginPath();
    g.arc(CMP_X, CMP_Y, part.target, 0, Math.PI * 2);
    g.stroke();
    g.setLineDash([]);
    g.strokeStyle = C_LINE;
    g.lineWidth = 2;
    g.beginPath();
    g.arc(CMP_X, CMP_Y, size, 0, Math.PI * 2);
    g.stroke();
    g.textAlign = 'left';
    g.fillStyle = C_DIM;
    g.font = 'bold 12px sans-serif';
    g.fillText(`ねらい ${part.target}`, 244, 92);
    g.fillStyle = fits(part, size) ? C_OK : C_TEXT;
    g.font = 'bold 16px sans-serif';
    g.fillText(`いま ${size.toFixed(1)}`, 244, 112);
    g.textAlign = 'center';

    // 雪原
    g.fillStyle = C_FIELD;
    roundRect(FIELD_X - 4, FIELD_Y - 4, COLS * CELL + 8, ROWS * CELL + 8, 10);
    g.fill();
    for (let i = 0; i < field.length; i++) {
      const c = i % COLS;
      const r = Math.floor(i / COLS);
      const x = FIELD_X + c * CELL;
      const y = FIELD_Y + r * CELL;
      if (field[i]) {
        g.fillStyle = C_SNOW;
        roundRect(x + 1.5, y + 1.5, CELL - 3, CELL - 3, 6);
        g.fill();
      } else {
        g.fillStyle = C_BARE;
        roundRect(x + 5, y + 5, CELL - 10, CELL - 10, 5);
        g.fill();
      }
    }

    // ゆきだま
    g.fillStyle = C_BALL;
    g.beginPath();
    g.arc(bx, by, size, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = C_LINE;
    g.lineWidth = 2.5;
    g.stroke();
    g.fillStyle = 'rgba(126,163,187,.35)';
    g.beginPath();
    g.arc(bx - size * 0.3, by - size * 0.3, size * 0.22, 0, Math.PI * 2);
    g.fill();

    // 置くボタン
    const ok = fits(part, size);
    g.fillStyle = ok ? C_OK : 'rgba(90,116,136,.30)';
    roundRect(PLACE_BTN.x, PLACE_BTN.y, PLACE_BTN.w, PLACE_BTN.h, 14);
    g.fill();
    g.fillStyle = ok ? '#ffffff' : C_DIM;
    g.font = 'bold 18px sans-serif';
    g.fillText('ゆきだるまに おく', PLACE_BTN.x + PLACE_BTN.w / 2, PLACE_BTN.y + PLACE_BTN.h / 2);

    // ひとこと
    g.font = 'bold 13px sans-serif';
    if (mode === 'placed') {
      g.fillStyle = C_OK;
      g.fillText('おけた！ つぎの たまへ', W / 2, 534);
    } else if (now < hintUntil) {
      g.fillStyle = C_NG;
      g.fillText(hintText, W / 2, 534);
    } else {
      g.fillStyle = C_DIM;
      g.fillText('雪の上＝大きく／雪のない ところ＝小さく', W / 2, 534);
    }
    g.fillStyle = C_DIM;
    g.font = 'bold 11px sans-serif';
    g.fillText('じかん制限も しっぱいも ないよ', W / 2, 620);
  }

  draw(0);
  setData();

  return {
    start() {
      started = true;
      nextSnowAt = ctx.now() + SNOW_MS;
    },
    pause() {
      hostPaused = true;
      dragging = false;
    },
    resume() {
      hostPaused = false;
    },
    resize() {
      draw(ctx.now());
    },
    destroy() {
      offDown();
      offMove();
      offUp();
      offTap();
      offFrame();
    },
  };
}
