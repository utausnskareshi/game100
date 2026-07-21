// =============================================================
// ドキドキふうせん（No.86）: 押しっぱなしでふくらませ、はなして確定する度胸くらべ
// =============================================================
// - 押している間だけふくらむ。かくれた限界をこえるとパン＝0点。
//   限界の72%でかならず震えはじめる（正直な予告）。震えの強さは限界に
//   近づくほど増える＝アナログな手がかり。ゴールデン(90%以上)の視覚合図は
//   出さない（震え開始からの「感覚の時間勘定」がゲームの本体）。
// - 出題・採点は logic.ts（純ロジック・rng注入＝完全決定論・猶予350ms保証）。
// - 全画面 Canvas・時間は ctx.now 期限方式・setTimeout 不使用。
// - import してよいのは game-api（types / helpers）と、このフォルダ内（logic）だけ
import type { GameContext, IGame, PointerInfo } from '../../game-api/types';
import {
  BALLOONS,
  type BalloonSpec,
  EDGE_FRAC,
  GOLDEN_FRAC,
  H,
  SCORE_HI,
  TREMBLE_FRAC,
  W,
  fracOf,
  makePlan,
  releaseScore,
} from './logic';

const HUD_H = 40;
const READY_MS = 950;
const SCORED_MS = 1150;
const POPPED_MS = 1250;
const END_DELAY = 2000;

type Mode = 'ready' | 'play' | 'scored' | 'popped' | 'over';

interface FloatFx {
  x: number;
  y: number;
  text: string;
  color: string;
  at: number;
  until: number;
}

interface Shred {
  ang: number;
  spd: number;
  size: number;
}

const COLORS: [string, string][] = [
  ['#ff6b8a', '#d84868'], // 体色 / 濃い縁
  ['#ffb14a', '#e08a2a'],
  ['#7ec8f0', '#4a9dd0'],
  ['#8ae08a', '#55b055'],
  ['#c99af5', '#9a6ad0'],
  ['#ffd54a', '#e0b02a'],
  ['#ff9ad5', '#d668a8'],
  ['#9ae0d5', '#5ab0a5'],
];

export function createGame(ctx: GameContext): IGame {
  const cv = ctx.canvas2d({ design: { w: W, h: H } });
  const g = cv.ctx;

  // 出題は最初に一括生成（rng 消費順固定＝決定論）
  const specs: BalloonSpec[] = makePlan(ctx.random);

  let mode: Mode = 'ready';
  let started = false;
  let hostPaused = false;
  let ended = false;
  let idx = 0;
  let size = 0;
  let holding = false;
  let holdId = -1;
  let score = 0;
  let goldenStreak = 0;
  let goldenCount = 0;
  let pops = 0;
  let lastWasPop = false;
  let phaseUntil = 0;
  let nextTickAt = Infinity; // 震えのカチカチ音
  let effects: FloatFx[] = [];
  let shreds: Shred[] = [];
  let popAt = 0;
  let scoredAt = 0;
  let lastEvent = '';

  const spec = (): BalloonSpec => specs[idx]!;

  function addScore(n: number): void {
    score += n;
    if (score >= SCORE_HI) ctx.achieve('score-hi');
  }

  function beginBalloon(i: number, now: number): void {
    idx = i;
    size = 0;
    holding = false;
    holdId = -1;
    shreds = [];
    mode = 'ready';
    phaseUntil = now + READY_MS;
    nextTickAt = Infinity;
    ctx.sfx('tick');
  }

  function advance(now: number): void {
    if (idx + 1 < BALLOONS) {
      beginBalloon(idx + 1, now);
    } else {
      if (pops === 0) ctx.achieve('no-pop');
      mode = 'over';
      phaseUntil = now + END_DELAY;
      ctx.sfx('medal');
    }
  }

  function doPop(now: number): void {
    mode = 'popped';
    popAt = now;
    phaseUntil = now + POPPED_MS;
    pops++;
    goldenStreak = 0;
    lastWasPop = true;
    holding = false;
    holdId = -1;
    // 破片（決定論: idx から角度を決める）
    shreds = [];
    for (let k = 0; k < 10; k++) {
      shreds.push({ ang: (k / 10) * Math.PI * 2 + idx * 0.7, spd: 160 + ((k * 37 + idx * 13) % 5) * 30, size: 6 + ((k + idx) % 3) * 3 });
    }
    ctx.sfx('fail');
    ctx.haptic('error');
    lastEvent = 'pop';
  }

  function doRelease(now: number): void {
    const frac = fracOf(size, spec());
    if (frac >= 1) {
      doPop(now);
      return;
    }
    holding = false;
    holdId = -1;
    const golden = frac >= GOLDEN_FRAC;
    if (golden) {
      goldenStreak++;
      goldenCount++;
    } else {
      goldenStreak = 0;
    }
    const pts = releaseScore(frac, goldenStreak);
    addScore(pts);
    if (golden) {
      ctx.achieve('first-golden');
      if (goldenStreak >= 3) ctx.achieve('streak-3');
      if (lastWasPop) ctx.achieve('comeback');
    }
    if (frac >= EDGE_FRAC) ctx.achieve('edge-97');
    lastWasPop = false;
    mode = 'scored';
    scoredAt = now;
    phaseUntil = now + SCORED_MS;
    const bx = W / 2;
    const by = 330 - balloonRadius();
    effects.push({ x: bx, y: by - 24, text: `+${pts}`, color: golden ? '#ffd54a' : '#ffffff', at: now, until: now + 1100 });
    if (golden) effects.push({ x: bx, y: by - 48, text: 'ゴールデン！', color: '#ffd54a', at: now + 120, until: now + 1200 });
    ctx.sfx(golden ? 'combo' : 'success');
    ctx.haptic(golden ? 'success' : 'light');
    lastEvent = `release:${pts}:${frac.toFixed(4)}`;
  }

  // ---- 入力（押しっぱなし＝ふくらませる） ----
  const offDown = ctx.input.onDown((p: PointerInfo) => {
    if (hostPaused || !started || mode !== 'play' || holding) return;
    holding = true;
    holdId = p.id;
    ctx.sfx('tap');
    lastEvent = 'hold';
  });
  const offUp = ctx.input.onUp((p: PointerInfo) => {
    if (p.id !== holdId || !holding) return;
    if (hostPaused || mode !== 'play') {
      holding = false;
      holdId = -1;
      return;
    }
    doRelease(ctx.now());
  });

  // ---- 毎フレーム ----
  const offFrame = ctx.onFrame((dt: number) => {
    if (hostPaused) return;
    const now = ctx.now();
    if (mode === 'ready' && started && now >= phaseUntil) {
      mode = 'play';
      ctx.sfx('start');
    } else if (mode === 'play' && holding) {
      size += spec().rate * dt;
      const frac = fracOf(size, spec());
      if (frac >= 1) {
        doPop(now);
      } else if (frac >= TREMBLE_FRAC) {
        // 震えのカチカチ（限界に近いほど速く）
        if (nextTickAt === Infinity) nextTickAt = now;
        if (now >= nextTickAt) {
          ctx.sfx('tick');
          if (frac > 0.88) ctx.haptic('light');
          const iv = Math.max(70, 230 - (frac - TREMBLE_FRAC) * 550);
          nextTickAt = now + iv;
        }
      } else {
        nextTickAt = Infinity;
      }
    } else if ((mode === 'scored' || mode === 'popped') && now >= phaseUntil) {
      advance(now);
    } else if (mode === 'over' && !ended && now >= phaseUntil) {
      ended = true;
      ctx.end({ score });
      return;
    }
    effects = effects.filter((e) => e.until > now);
    draw(now);
    setData(now);
  });

  function setData(now: number): void {
    if (!import.meta.env.DEV) return;
    void now;
    const r = ctx.root as HTMLElement;
    const frac = mode === 'play' || mode === 'scored' ? fracOf(size, spec()) : 0;
    r.dataset.mode = mode;
    r.dataset.idx = String(idx + 1);
    r.dataset.holding = holding ? '1' : '0';
    r.dataset.tremble = mode === 'play' && holding && fracOf(size, spec()) >= TREMBLE_FRAC ? '1' : '0';
    r.dataset.frac = frac.toFixed(4);
    r.dataset.score = String(score);
    r.dataset.pops = String(pops);
    r.dataset.golden = String(goldenCount);
    r.dataset.streak = String(goldenStreak);
    r.dataset.last = lastEvent;
  }

  // ---- 描画 ----
  const off = document.createElement('canvas');
  off.width = W * 2;
  off.height = H * 2;
  const og = off.getContext('2d');

  function bakeStatic(): void {
    if (!og) return;
    og.setTransform(2, 0, 0, 2, 0, 0);
    const sky = og.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#8fd0f0');
    sky.addColorStop(0.7, '#c8e8f8');
    sky.addColorStop(1, '#e8f5fc');
    og.fillStyle = sky;
    og.fillRect(0, 0, W, H);
    // 雲
    og.fillStyle = 'rgba(255,255,255,.9)';
    for (const [cx2, cy2, s] of [
      [70, 120, 1],
      [280, 90, 0.75],
      [200, 180, 0.55],
      [90, 460, 0.6],
      [300, 420, 0.7],
    ] as [number, number, number][]) {
      for (const [ox, oy, r] of [
        [-24, 4, 15],
        [0, -5, 19],
        [22, 4, 14],
      ] as [number, number, number][]) {
        og.beginPath();
        og.arc(cx2 + ox * s, cy2 + oy * s, r * s, 0, Math.PI * 2);
        og.fill();
      }
    }
    // 地面と空気入れ台
    og.fillStyle = '#7db860';
    og.fillRect(0, H - 70, W, 70);
    og.fillStyle = '#5f9a48';
    for (let i = 0; i < 18; i++) og.fillRect((i * 41 + 8) % W, H - 66 + ((i * 29) % 52), 3, 3);
    og.fillStyle = '#b06a3a';
    og.fillRect(W / 2 - 34, H - 96, 68, 30);
    og.fillStyle = '#8a4e28';
    og.fillRect(W / 2 - 34, H - 96, 68, 8);
  }
  bakeStatic();

  function balloonRadius(): number {
    return 24 + size * 26;
  }

  function drawBalloon(now: number): void {
    const [body, rim] = COLORS[idx % COLORS.length]!;
    const frac = fracOf(size, spec());
    const r = balloonRadius();
    let bx = W / 2;
    let by = 330;
    // 震え（限界に近いほど激しく）
    if (mode === 'play' && holding && frac >= TREMBLE_FRAC) {
      const inten = ((frac - TREMBLE_FRAC) / (1 - TREMBLE_FRAC)) * 5 + 1.5;
      bx += Math.sin(now / 23) * inten;
      by += Math.cos(now / 19) * inten * 0.7;
    }
    if (mode === 'scored') {
      const t = (now - scoredAt) / SCORED_MS;
      by -= t * 130; // ふわっと上がる
      bx += Math.sin(t * 6) * 8;
    }
    // ひも
    g.strokeStyle = '#8a6a4a';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(bx, by + r + 8);
    g.quadraticCurveTo(bx + 6, by + r + 34, W / 2, H - 96);
    g.stroke();
    // 本体
    g.fillStyle = body;
    g.beginPath();
    g.ellipse(bx, by, r * 0.92, r, 0, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = rim;
    g.lineWidth = 2.5;
    g.stroke();
    // 結び目
    g.fillStyle = rim;
    g.beginPath();
    g.moveTo(bx - 6, by + r + 1);
    g.lineTo(bx + 6, by + r + 1);
    g.lineTo(bx, by + r + 9);
    g.closePath();
    g.fill();
    // ハイライト
    g.fillStyle = 'rgba(255,255,255,.5)';
    g.beginPath();
    g.ellipse(bx - r * 0.34, by - r * 0.4, r * 0.22, r * 0.3, -0.5, 0, Math.PI * 2);
    g.fill();
    // 顔（ふくらむほどドキドキ）
    const eyeY = by - r * 0.08;
    g.fillStyle = '#3a2a2a';
    if (frac < TREMBLE_FRAC) {
      g.beginPath();
      g.arc(bx - r * 0.26, eyeY, 3.2, 0, Math.PI * 2);
      g.arc(bx + r * 0.26, eyeY, 3.2, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = '#3a2a2a';
      g.lineWidth = 2;
      g.beginPath();
      g.arc(bx, by + r * 0.18, r * 0.16, 0.25, Math.PI - 0.25);
      g.stroke();
    } else {
      // ぎゅっと目を閉じてがまん
      g.strokeStyle = '#3a2a2a';
      g.lineWidth = 2.4;
      g.beginPath();
      g.moveTo(bx - r * 0.34, eyeY - 3);
      g.lineTo(bx - r * 0.18, eyeY + 2);
      g.moveTo(bx - r * 0.34, eyeY + 5);
      g.lineTo(bx - r * 0.18, eyeY + 2);
      g.moveTo(bx + r * 0.34, eyeY - 3);
      g.lineTo(bx + r * 0.18, eyeY + 2);
      g.moveTo(bx + r * 0.34, eyeY + 5);
      g.lineTo(bx + r * 0.18, eyeY + 2);
      g.stroke();
      g.beginPath();
      g.arc(bx, by + r * 0.2, r * 0.1, 0, Math.PI * 2);
      g.stroke();
    }
  }

  function draw(now: number): void {
    g.drawImage(off, 0, 0, W, H);

    if (mode !== 'over') {
      if (mode === 'popped') {
        // 破片
        const t = (now - popAt) / 1000;
        const [body] = COLORS[idx % COLORS.length]!;
        g.fillStyle = body;
        for (const s of shreds) {
          const fx = W / 2 + Math.cos(s.ang) * s.spd * t;
          const fy = 330 + Math.sin(s.ang) * s.spd * t + 300 * t * t;
          g.save();
          g.translate(fx, fy);
          g.rotate(s.ang + t * 7);
          g.beginPath();
          g.ellipse(0, 0, s.size, s.size * 0.5, 0, 0, Math.PI * 2);
          g.fill();
          g.restore();
        }
        g.fillStyle = '#d84a3c';
        g.font = 'bold 34px sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText('パンッ！', W / 2, 260);
        g.font = 'bold 16px sans-serif';
        g.fillText('0てん…', W / 2, 300);
      } else if (mode !== 'ready' || !started) {
        drawBalloon(now);
      }

      // 操作ヒント
      if (mode === 'play' && !holding && size === 0) {
        g.fillStyle = 'rgba(30,50,70,.75)';
        g.font = 'bold 16px sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText('おしてふくらませる → はなして きめる', W / 2, 500);
      }

      // 開始カード
      if (mode === 'ready' && started) {
        g.fillStyle = 'rgba(30,50,70,.82)';
        const bw = 250;
        g.beginPath();
        g.moveTo(W / 2 - bw / 2 + 14, 280);
        g.arcTo(W / 2 + bw / 2, 280, W / 2 + bw / 2, 344, 14);
        g.arcTo(W / 2 + bw / 2, 344, W / 2 - bw / 2, 344, 14);
        g.arcTo(W / 2 - bw / 2, 344, W / 2 - bw / 2, 280, 14);
        g.arcTo(W / 2 - bw / 2, 280, W / 2 + bw / 2, 280, 14);
        g.closePath();
        g.fill();
        g.fillStyle = '#fff';
        g.font = 'bold 22px sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(`ふうせん ${idx + 1}こめ`, W / 2, 312);
      }
    }

    // うかぶ得点
    for (const e of effects) {
      if (now < e.at) continue;
      const a = Math.min(1, (e.until - now) / 400);
      g.globalAlpha = Math.max(0, a);
      g.fillStyle = e.color;
      g.font = 'bold 18px sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.strokeStyle = 'rgba(30,50,70,.8)';
      g.lineWidth = 3;
      const rise = ((now - e.at) / 1100) * 26;
      g.strokeText(e.text, e.x, e.y - rise);
      g.fillText(e.text, e.x, e.y - rise);
      g.globalAlpha = 1;
    }

    // HUD
    if (mode !== 'over') {
      g.fillStyle = 'rgba(30,50,70,.88)';
      g.fillRect(0, 0, W, HUD_H);
      g.textBaseline = 'middle';
      g.textAlign = 'left';
      g.fillStyle = '#fff';
      g.font = 'bold 19px sans-serif';
      g.fillText(`${score}てん`, 12, HUD_H / 2);
      g.fillStyle = '#cfe8ff';
      g.font = 'bold 15px sans-serif';
      g.fillText(`ふうせん ${Math.min(idx + 1, BALLOONS)}/${BALLOONS}`, 118, HUD_H / 2);
      if (goldenStreak >= 2) {
        g.fillStyle = '#ffd54a';
        g.font = 'bold 13px sans-serif';
        g.fillText(`✨×${goldenStreak}`, 252, HUD_H / 2);
      }
    } else {
      g.fillStyle = 'rgba(30,50,70,.82)';
      g.fillRect(0, 0, W, H);
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = '#fff';
      g.font = 'bold 30px sans-serif';
      g.fillText('おしまい！', W / 2, H / 2 - 56);
      g.font = 'bold 26px sans-serif';
      g.fillText(`${score}てん`, W / 2, H / 2 - 12);
      g.fillStyle = '#ffd54a';
      g.font = 'bold 16px sans-serif';
      g.fillText(`ゴールデン ${goldenCount}回`, W / 2, H / 2 + 24);
      if (pops === 0) {
        g.fillStyle = '#9fe3ff';
        g.fillText('パンさせなかった！', W / 2, H / 2 + 52);
      }
    }
  }

  draw(ctx.now());
  setData(ctx.now());

  return {
    start() {
      started = true;
      beginBalloon(0, ctx.now());
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
      offDown();
      offUp();
      offFrame();
    },
  };
}
