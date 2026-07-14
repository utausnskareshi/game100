// =============================================================
// まねっこおえかき（No.39）: うすく見えるお手本の形を、ゆびで一筆なぞって採点！
// =============================================================
// - まる→しかく→さんかく→ほし→うずまきの5ラウンド。各200点満点・合計1000点。
// - ゆびを離したところで採点（みじかすぎるなぞりは無視＝誤タッチにやさしく）。
// - 採点は shapes.ts（せいかくさ×なぞれた率・純ロジック）。乱数不使用＝毎回同じお題。
// - Canvas 360×640・startMode:'immediate'（説明→すぐ1問目）。時間は ctx.now 期限方式。
// - import してよいのは game-api（types / helpers）と、このフォルダ内（shapes）だけ
import type { GameContext, IGame } from '../../game-api/types';
import {
  MIN_STROKE,
  RANK_HANAMARU,
  SHAPES,
  rankOf,
  scoreTrace,
  type Pt,
} from './shapes';

const W = 360;
const H = 640;
// お手本の描画領域（design 座標）
const AREA = { x: 30, y: 155, size: 300 };
const RESULT_MS = 1700;
const END_DELAY = 1900;

type Mode = 'trace' | 'result' | 'over';

export function createGame(ctx: GameContext): IGame {
  const cv = ctx.canvas2d({ design: { w: W, h: H } });
  const g = cv.ctx;

  // ---- 状態 ----
  let mode: Mode = 'trace';
  let hostPaused = false;
  let round = 0; // 0..4
  let total = 0;
  let lastScore = 0;
  let lastRank = rankOf(0);
  let hanamaruCount = 0;
  let drawn: Pt[] = [];
  let drawing = false;
  let activePid = -1;
  let strokeLen = 0;
  let nextAt = 0;
  let endAt = 0;
  let ended = false;

  // お手本（design 座標へ変換済み）
  const targets: Pt[][] = SHAPES.map((s) =>
    s.pts.map((p) => ({ x: AREA.x + p.x * AREA.size, y: AREA.y + p.y * AREA.size })),
  );

  function setData(): void {
    const r = ctx.root as HTMLElement;
    r.dataset.mode = mode;
    r.dataset.round = String(round);
    r.dataset.total = String(total);
    if (!import.meta.env.DEV) return;
    r.dataset.last = String(lastScore);
    r.dataset.len = String(drawn.length);
  }

  // ---- 入力（一筆なぞり）----
  const offDown = ctx.input.onDown((p) => {
    if (mode !== 'trace' || hostPaused || drawing) return;
    drawing = true;
    activePid = p.id;
    const l = cv.toLocal(p);
    drawn = [{ x: l.x, y: l.y }];
    strokeLen = 0;
  });
  const offMove = ctx.input.onMove((p) => {
    if (!drawing || p.id !== activePid || hostPaused) return;
    const l = cv.toLocal(p);
    const lastP = drawn[drawn.length - 1]!;
    const d = Math.hypot(l.x - lastP.x, l.y - lastP.y);
    if (d >= 2) {
      drawn.push({ x: l.x, y: l.y });
      strokeLen += d;
    }
  });
  const offUp = ctx.input.onUp((p) => {
    if (!drawing || p.id !== activePid) return;
    drawing = false;
    activePid = -1;
    if (mode !== 'trace' || hostPaused) return;
    if (strokeLen < MIN_STROKE) {
      // 誤タッチは無視（このラウンドを消費しない）
      drawn = [];
      return;
    }
    judge();
  });

  // ---- 採点 ----
  function judge(): void {
    const shape = SHAPES[round]!;
    const res = scoreTrace(targets[round]!, shape.closed, drawn);
    lastScore = res.score;
    lastRank = rankOf(res.score);
    total += res.score;
    mode = 'result';
    // 実績（加算箇所で即解除）
    if (res.score >= RANK_HANAMARU) {
      hanamaruCount++;
      ctx.achieve('first-hanamaru');
      if (hanamaruCount >= 3) ctx.achieve('hanamaru-3');
      if (shape.key === 'star') ctx.achieve('star-master');
      if (shape.key === 'spiral') ctx.achieve('spiral-master');
    }
    if (total >= 700) ctx.achieve('total-700');
    if (total >= 900) ctx.achieve('total-900');
    if (res.score >= RANK_HANAMARU) {
      ctx.sfx('combo');
      ctx.haptic('success');
    } else if (res.score > 0) {
      ctx.sfx('success');
      ctx.haptic('light');
    } else {
      ctx.sfx('fail');
    }
    nextAt = ctx.now() + RESULT_MS;
    setData();
  }

  function nextRound(): void {
    if (round >= SHAPES.length - 1) {
      mode = 'over';
      ctx.sfx('medal');
      endAt = ctx.now() + END_DELAY;
    } else {
      round++;
      drawn = [];
      mode = 'trace';
    }
    setData();
  }

  // ---- 毎フレーム ----
  const offFrame = ctx.onFrame(() => {
    const now = ctx.now();
    if (mode === 'result' && now >= nextAt) nextRound();
    if (mode === 'over' && !ended && now >= endAt) {
      ended = true;
      ctx.end({ score: total });
      return;
    }
    draw();
  });

  // ---- 描画（かみの色の固定パレット＝両テーマ共通）----
  function drawPoly(pts: Pt[], closed: boolean): void {
    g.beginPath();
    g.moveTo(pts[0]!.x, pts[0]!.y);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i]!.x, pts[i]!.y);
    if (closed) g.closePath();
    g.stroke();
  }

  function draw(): void {
    // がようし
    g.fillStyle = '#fbf6ec';
    g.fillRect(0, 0, W, H);
    // うすい ドット（かみの目）
    g.fillStyle = 'rgba(160,140,110,.12)';
    for (let y = 30; y < H; y += 44) {
      for (let x = 20; x < W; x += 44) {
        g.beginPath();
        g.arc(x, y, 1.6, 0, Math.PI * 2);
        g.fill();
      }
    }

    const shape = SHAPES[round]!;
    // HUD
    g.fillStyle = '#5a4636';
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.font = 'bold 16px sans-serif';
    g.fillText(`ごうけい ${total}てん`, 14, 34);
    g.font = 'bold 13px sans-serif';
    g.fillText(`おだい ${round + 1}/${SHAPES.length}`, 14, 58);
    // おだい名
    g.textAlign = 'center';
    g.font = 'bold 26px sans-serif';
    g.fillText(`「${shape.name}」`, W / 2, 116);
    if (mode === 'trace' && drawn.length === 0) {
      g.font = 'bold 14px sans-serif';
      g.fillStyle = '#8a7860';
      g.fillText('うすい線を 一筆で なぞってね', W / 2, 496);
    }

    // お手本（点線）
    g.strokeStyle = '#b9b0a0';
    g.lineWidth = 5;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.setLineDash([9, 9]);
    drawPoly(targets[round]!, shape.closed);
    g.setLineDash([]);

    // なぞった線（クレヨン）
    if (drawn.length >= 2) {
      g.strokeStyle = mode === 'result' && lastScore >= RANK_HANAMARU ? '#2fae5e' : '#f0524a';
      g.lineWidth = 7;
      drawPoly(drawn, false);
    }

    // 採点表示
    if (mode === 'result') {
      g.fillStyle = 'rgba(90,70,54,.88)';
      g.fillRect(0, 508, W, 74);
      g.fillStyle = '#fff';
      g.textAlign = 'center';
      g.font = 'bold 28px sans-serif';
      g.fillText(`${lastRank.emoji} ${lastRank.label}`, W / 2, 536);
      g.font = 'bold 20px sans-serif';
      g.fillText(`+${lastScore}てん`, W / 2, 564);
    }

    if (mode === 'over') {
      g.fillStyle = 'rgba(60,45,30,.62)';
      g.fillRect(0, 0, W, H);
      g.fillStyle = '#fff';
      g.textAlign = 'center';
      g.font = 'bold 34px sans-serif';
      g.fillText('かんせい！ 🎨', W / 2, H / 2 - 40);
      g.font = 'bold 24px sans-serif';
      g.fillText(`ごうけい ${total}てん`, W / 2, H / 2 + 8);
    }
  }

  // ---- 起動（startMode:'immediate'＝すぐ1問目）----
  draw();
  setData();

  return {
    start() {
      // カウントダウンなし。最初のお題（まる）から始まる
    },
    pause() {
      hostPaused = true;
      // なぞり中のストロークは破棄（ラウンドは消費しない）
      drawing = false;
      activePid = -1;
      if (mode === 'trace') drawn = [];
    },
    resume() {
      hostPaused = false;
    },
    resize() {
      draw();
    },
    destroy() {
      offDown();
      offMove();
      offUp();
      offFrame();
    },
  };
}
