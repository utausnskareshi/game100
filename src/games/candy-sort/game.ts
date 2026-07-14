// =============================================================
// キャンディふりわけ（No.37）: 転がってくるキャンディを、ゲートを切り替えて同じ色のビンへ！
// =============================================================
// - 分岐のゲートをタップすると左右が切り替わる。60秒でなんこ ふりわけられるか。
// - 色ちがいのビンに入れるとライフ−1（3つ）。レインボー🌈はどのビンでもOK（+30）。
// - コース・出題は logic.ts（rng注入・全ルート等距離＝追い越しなし）。
// - プレイは全て Canvas 描画（design 360×640・テーマ非依存の固定色）。設定画面なし＝シェルの3-2-1。
// - 時間はすべて ctx.now 期限方式（setTimeout 不使用）。
// - import してよいのは game-api（types / helpers）と、このフォルダ内（logic）だけ
import type { GameContext, IGame } from '../../game-api/types';
import {
  COLORS,
  GATE_POS,
  GATE_TAP_R,
  NODES,
  intervalAt,
  makeBinOrder,
  pointsFor,
  rollCandy,
  speedAt,
  type GateDir,
  type Pt,
} from './logic';

const W = 360;
const H = 640;
const DURATION = 60_000;
const LIVES = 3;
const CANDY_R = 13;
const END_DELAY = 2000;
const SCORE_HI = 700;

type Mode = 'ready' | 'play' | 'over';

interface Target {
  kind: 'j' | 'bin';
  idx: number;
}

interface Candy {
  color: number;
  rainbow: boolean;
  from: Pt;
  to: Target;
  t: number; // 0..1（区間内の進み）
  segLen: number;
  x: number;
  y: number;
}

function ptOf(t: Target): Pt {
  return t.kind === 'j' ? GATE_POS[t.idx]! : NODES.bins[t.idx]!;
}

function dist(a: Pt, b: Pt): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function createGame(ctx: GameContext): IGame {
  const cv = ctx.canvas2d({ design: { w: W, h: H } });
  const g = cv.ctx;

  // ---- 状態 ----
  let mode: Mode = 'ready';
  let hostPaused = false;
  const binOrder = makeBinOrder(ctx.random); // ビン位置 → 色番号（プレイごとにシャッフル）
  const gates: GateDir[] = ['L', 'L', 'L'];
  const candies: Candy[] = [];
  let playStart = 0;
  let nextSpawnAt = 0;
  let score = 0;
  let streak = 0;
  let sorted = 0;
  let misses = 0;
  let rainbows = 0;
  let lives = LIVES;
  let flashBin = -1; // ミス演出
  let flashUntil = 0;
  let endAt = 0;
  let ended = false;
  let overReason: 'time' | 'lives' = 'time';

  function setData(): void {
    const r = ctx.root as HTMLElement;
    r.dataset.mode = mode;
    r.dataset.score = String(score);
    r.dataset.lives = String(lives);
    if (!import.meta.env.DEV) return;
    r.dataset.streak = String(streak);
    r.dataset.sorted = String(sorted);
    r.dataset.gates = gates.join('');
    r.dataset.binorder = binOrder.join('');
    r.dataset.candies = JSON.stringify(
      candies.map((c) => ({ c: c.color, rb: c.rainbow ? 1 : 0, to: `${c.to.kind}${c.to.idx}`, t: +c.t.toFixed(3) })),
    );
  }

  // ---- 入力（ゲートをタップで切替。onMove 非購読＝キャプチャなし）----
  const offDown = ctx.input.onDown((p) => {
    if (mode !== 'play' || hostPaused) return;
    const l = cv.toLocal(p);
    for (let i = 0; i < GATE_POS.length; i++) {
      const gp = GATE_POS[i]!;
      if (Math.hypot(l.x - gp.x, l.y - gp.y) <= GATE_TAP_R) {
        gates[i] = gates[i] === 'L' ? 'R' : 'L';
        ctx.sfx('tap');
        ctx.haptic('light');
        setData();
        return;
      }
    }
  });

  // ---- 進行 ----
  function spawn(now: number): void {
    const roll = rollCandy(ctx.random);
    candies.push({
      color: roll.color,
      rainbow: roll.rainbow,
      from: NODES.spawn,
      to: { kind: 'j', idx: 0 },
      t: 0,
      segLen: dist(NODES.spawn, NODES.j0),
      x: NODES.spawn.x,
      y: NODES.spawn.y,
    });
    nextSpawnAt = now + intervalAt(now - playStart);
  }

  function arrive(c: Candy): boolean {
    // true を返したら着地（配列から除去）
    if (c.to.kind === 'j') {
      const j = c.to.idx;
      const dir = gates[j]!;
      let next: Target;
      if (j === 0) next = { kind: 'j', idx: dir === 'L' ? 1 : 2 };
      else if (j === 1) next = { kind: 'bin', idx: dir === 'L' ? 0 : 1 };
      else next = { kind: 'bin', idx: dir === 'L' ? 2 : 3 };
      const from = ptOf(c.to);
      c.from = from;
      c.to = next;
      c.t = 0;
      c.segLen = dist(from, ptOf(next));
      return false;
    }
    // ビン着地
    const bin = c.to.idx;
    const ok = c.rainbow || binOrder[bin] === c.color;
    if (ok) {
      streak++;
      sorted++;
      if (c.rainbow) rainbows++;
      score += pointsFor(c.rainbow, streak);
      ctx.sfx('success');
      // 単調マイルストーンは加算箇所で即解除（中断で取りこぼさない）
      if (sorted >= 15) ctx.achieve('debut-15');
      if (sorted >= 40) ctx.achieve('sort-40');
      if (streak >= 10) ctx.achieve('combo-10');
      if (misses === 0 && sorted >= 25) ctx.achieve('no-miss-25');
      if (rainbows >= 5) ctx.achieve('rainbow-5');
      if (score >= SCORE_HI) ctx.achieve('score-hi');
    } else {
      streak = 0;
      misses++;
      lives--;
      flashBin = bin;
      flashUntil = ctx.now() + 700;
      ctx.sfx('fail');
      ctx.haptic('error');
      if (lives <= 0) finish('lives');
    }
    return true;
  }

  function finish(reason: 'time' | 'lives'): void {
    if (mode !== 'play') return;
    mode = 'over';
    overReason = reason;
    candies.length = 0;
    ctx.sfx(reason === 'time' ? 'success' : 'fail');
    endAt = ctx.now() + END_DELAY;
    setData();
  }

  function updatePlay(dt: number, now: number): void {
    const elapsed = now - playStart;
    if (elapsed >= DURATION) {
      finish('time');
      return;
    }
    if (now >= nextSpawnAt) spawn(now);
    const sp = speedAt(elapsed);
    for (let i = candies.length - 1; i >= 0; i--) {
      const c = candies[i]!;
      c.t += (sp * dt) / c.segLen;
      if (c.t >= 1) {
        if (arrive(c)) {
          candies.splice(i, 1);
          if (mode !== 'play') return; // ライフ0で終了した
          continue;
        }
      }
      const to = ptOf(c.to);
      c.x = c.from.x + (to.x - c.from.x) * Math.min(1, c.t);
      c.y = c.from.y + (to.y - c.from.y) * Math.min(1, c.t);
    }
  }

  // ---- 毎フレーム ----
  const offFrame = ctx.onFrame((dt) => {
    const now = ctx.now();
    if (mode === 'play' && !hostPaused) updatePlay(dt, now);
    if (mode === 'over' && !ended && now >= endAt) {
      ended = true;
      ctx.end({ score });
      return;
    }
    draw(now);
    setData();
  });

  // ---- 描画（固定パレット＝両テーマ共通）----
  // 角丸矩形（roundRect は古い iOS Safari に無いため自前で描く）
  function rr(x: number, y: number, w: number, h: number, r: number): void {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  function drawRail(a: Pt, b: Pt): void {
    g.beginPath();
    g.moveTo(a.x, a.y);
    g.lineTo(b.x, b.y);
    g.stroke();
  }

  function drawCandy(x: number, y: number, color: number, rainbow: boolean, r: number): void {
    // つつみ紙の両はし
    g.fillStyle = rainbow ? '#e8b3ff' : COLORS[color]!;
    g.beginPath();
    g.moveTo(x - r - 8, y);
    g.lineTo(x - r + 2, y - 6);
    g.lineTo(x - r + 2, y + 6);
    g.closePath();
    g.fill();
    g.beginPath();
    g.moveTo(x + r + 8, y);
    g.lineTo(x + r - 2, y - 6);
    g.lineTo(x + r - 2, y + 6);
    g.closePath();
    g.fill();
    // 本体
    if (rainbow) {
      const cols = ['#f0524a', '#ffc94d', '#3ed36a', '#4a90f0'];
      for (let q = 0; q < 4; q++) {
        g.fillStyle = cols[q]!;
        g.beginPath();
        g.moveTo(x, y);
        g.arc(x, y, r, (Math.PI / 2) * q, (Math.PI / 2) * (q + 1));
        g.closePath();
        g.fill();
      }
    } else {
      g.fillStyle = COLORS[color]!;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = 'rgba(255,255,255,.5)';
    g.beginPath();
    g.arc(x - r * 0.35, y - r * 0.35, r * 0.3, 0, Math.PI * 2);
    g.fill();
  }

  function draw(now: number): void {
    // 背景（お菓子やさんの板）
    g.fillStyle = '#fdf3e7';
    g.fillRect(0, 0, W, H);
    // レール
    g.strokeStyle = '#e2cdb4';
    g.lineWidth = 10;
    g.lineCap = 'round';
    drawRail(NODES.spawn, NODES.j0);
    drawRail(NODES.j0, NODES.j1);
    drawRail(NODES.j0, NODES.j2);
    drawRail(NODES.j1, NODES.bins[0]!);
    drawRail(NODES.j1, NODES.bins[1]!);
    drawRail(NODES.j2, NODES.bins[2]!);
    drawRail(NODES.j2, NODES.bins[3]!);

    // ビン（色つきジャー）
    for (let i = 0; i < 4; i++) {
      const b = NODES.bins[i]!;
      const col = COLORS[binOrder[i]!]!;
      const flash = i === flashBin && now < flashUntil;
      g.fillStyle = flash ? '#3a2b20' : col;
      g.globalAlpha = flash ? 1 : 0.88;
      rr(b.x - 34, b.y - 6, 68, 78, 12);
      g.fill();
      g.globalAlpha = 1;
      g.fillStyle = 'rgba(255,255,255,.35)';
      rr(b.x - 26, b.y + 4, 52, 14, 7);
      g.fill();
      // くちの輪
      g.strokeStyle = '#8a6a4e';
      g.lineWidth = 4;
      g.beginPath();
      g.ellipse(b.x, b.y - 6, 30, 9, 0, 0, Math.PI * 2);
      g.stroke();
    }

    // ゲート（白丸＋向き矢印）
    for (let i = 0; i < GATE_POS.length; i++) {
      const p = GATE_POS[i]!;
      g.fillStyle = '#ffffff';
      g.strokeStyle = '#c9ab8b';
      g.lineWidth = 3;
      g.beginPath();
      g.arc(p.x, p.y, 24, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      const dir = gates[i] === 'L' ? -1 : 1;
      g.fillStyle = '#7c5cff';
      g.beginPath();
      g.moveTo(p.x + dir * 16, p.y + 8);
      g.lineTo(p.x - dir * 6, p.y + 8);
      g.lineTo(p.x + dir * 5, p.y - 9);
      g.closePath();
      g.fill();
    }

    // キャンディ
    for (const c of candies) drawCandy(c.x, c.y, c.color, c.rainbow, CANDY_R);

    // HUD（左上・右上60×60のポーズ領域は避ける）
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.fillStyle = '#5a4636';
    g.font = 'bold 17px sans-serif';
    g.fillText(`${score}てん`, 14, 34);
    const remain = mode === 'play' ? Math.max(0, DURATION - (now - playStart)) : 0;
    g.font = 'bold 15px sans-serif';
    g.fillText(`⏱ ${Math.ceil(remain / 1000)}`, 14, 60);
    let hearts = '';
    for (let i = 0; i < LIVES; i++) hearts += i < lives ? '❤️' : '🤍';
    g.fillText(hearts, 84, 60);
    if (streak >= 3 && mode === 'play') {
      g.fillStyle = '#e8641e';
      g.fillText(`🔥×${streak}`, 190, 60);
    }

    // 終了
    if (mode === 'over') {
      g.fillStyle = 'rgba(43,28,16,.62)';
      g.fillRect(0, 0, W, H);
      g.fillStyle = '#fff';
      g.textAlign = 'center';
      g.font = 'bold 34px sans-serif';
      g.fillText(overReason === 'time' ? 'タイムアップ！' : 'おしまい…', W / 2, H / 2 - 40);
      g.font = 'bold 24px sans-serif';
      g.fillText(`${sorted}こ ふりわけた / ${score}てん`, W / 2, H / 2 + 8);
    }
  }

  // ---- 起動（シェルの 3-2-1 のあと start() が呼ばれる）----
  draw(0);
  setData();

  return {
    start() {
      mode = 'play';
      playStart = ctx.now();
      nextSpawnAt = playStart + 600;
      setData();
    },
    pause() {
      hostPaused = true;
    },
    resume() {
      hostPaused = false;
    },
    resize() {
      // design 指定の Canvas は自動レターボックス。次フレームで再描画される
      draw(ctx.now());
    },
    destroy() {
      offDown();
      offFrame();
    },
  };
}
