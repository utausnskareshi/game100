// =============================================================
// ふんわりちゃくりく（No.77）: 押している間だけ噴射。ゆっくり降りてパッドへ！
// =============================================================
// - 1ボタン操作: 画面のどこかを押している間だけ 上向き噴射（燃料を消費）。
//   よこ位置は自動でスイングするので、「いつ降りるか」で着地点が決まる。
// - 接地速度が vOk 以下＆パッドの上なら成功。ふんわり度・まんなか精度・残り燃料が得点に。
//   とちゅうの⭐リングは取った瞬間に加点（クラッシュしても持ち帰り）。
// - ステージ定義・物理・採点は logic.ts（乱数不使用＝完全決定論）。
// - 全画面 Canvas・時間は ctx.now 期限方式・物理は固定サブステップ 1/120s。
// - import してよいのは game-api（types / helpers）と、このフォルダ内（logic）だけ
import type { GameContext, IGame } from '../../game-api/types';
import {
  type FlightState,
  H,
  PAD_TOP,
  ROCKET_HALF,
  STAGES,
  STAR_PTS,
  STAR_R,
  STEP,
  type StageDef,
  W,
  initialFlight,
  padXAt,
  stagePoints,
  stepPhysics,
  swayX,
} from './logic';

const HUD_H = 40;
const GROUND_TOP = 574;
const LANDED_MS = 2100;
const END_DELAY = 2200;
const SCORE_HI = 1000; // 実績閾値（プランナーボット1107点で到達実証済み・実機要調整）
const FEATHER_VY = 25;
const STAR_ACH = 7; // プランナーボットの最良が⭐7＝到達可能を実証した値

type Phase = 'fly' | 'landed' | 'over';

interface FloatFx {
  x: number;
  y: number;
  text: string;
  color: string;
  until: number;
}

interface LastLanding {
  ok: boolean;
  offPad: boolean;
  vy: number;
  adx: number;
  pts: number;
  fuelFrac: number;
}

export function createGame(ctx: GameContext): IGame {
  const cv = ctx.canvas2d({ design: { w: W, h: H } });
  const g = cv.ctx;

  let phase: Phase = 'fly';
  let started = false;
  let hostPaused = false;
  let stageIdx = 0;
  let fl: FlightState = initialFlight();
  let starGot: boolean[] = [false, false];
  let acc = 0;
  let holdId: number | null = null;
  let thrustHeld = false;
  let score = 0;
  let totalStars = 0;
  let successes = 0;
  let nextAt = 0;
  let endAt = 0;
  let ended = false;
  let last: LastLanding | null = null;
  let effects: FloatFx[] = [];

  const stage = (): StageDef => STAGES[stageIdx] ?? STAGES[0]!;

  function addScore(n: number): void {
    score += n;
    if (score >= SCORE_HI) ctx.achieve('score-hi');
  }

  function resetStage(): void {
    fl = initialFlight();
    starGot = [false, false];
    acc = 0;
    holdId = null;
    thrustHeld = false;
  }

  function collectStars(now: number): void {
    const st = stage();
    const x = swayX(st, fl.t);
    for (let i = 0; i < st.stars.length; i++) {
      if (starGot[i]) continue;
      const s = st.stars[i]!;
      const dx = x - s.x;
      const dy = fl.y - s.y;
      if (dx * dx + dy * dy < STAR_R * STAR_R) {
        starGot[i] = true;
        totalStars++;
        addScore(STAR_PTS);
        if (totalStars >= STAR_ACH) ctx.achieve('star-7');
        effects.push({ x: s.x, y: s.y, text: `⭐+${STAR_PTS}`, color: '#ffd54a', until: now + 900 });
        ctx.sfx('powerup');
        ctx.haptic('light');
      }
    }
  }

  function checkLanding(now: number): void {
    const st = stage();
    if (fl.vy <= 0) return;
    const x = swayX(st, fl.t);
    const px = padXAt(st, fl.t);
    const adx = Math.abs(x - px);
    const overPad = adx <= st.padW / 2 + 6;
    const surfaceY = overPad ? PAD_TOP : GROUND_TOP;
    if (fl.y + ROCKET_HALF < surfaceY) return;
    fl.y = surfaceY - ROCKET_HALF;
    const onPad = adx <= st.padW / 2;
    const soft = fl.vy <= st.vOk;
    if (onPad && soft) {
      const pts = stagePoints(fl.vy, adx, st.padW, fl.fuel, st.vOk);
      addScore(pts);
      successes++;
      ctx.achieve('first-landing');
      if (fl.vy <= FEATHER_VY) ctx.achieve('feather');
      if (fl.fuel >= 0.5) ctx.achieve('fuel-half');
      if (successes >= STAGES.length) ctx.achieve('all-stages');
      last = { ok: true, offPad: false, vy: fl.vy, adx, pts, fuelFrac: fl.fuel };
      ctx.sfx(fl.vy <= FEATHER_VY ? 'medal' : 'success');
      ctx.haptic('success');
    } else {
      last = { ok: false, offPad: !onPad, vy: fl.vy, adx, pts: 0, fuelFrac: fl.fuel };
      ctx.sfx('fail');
      ctx.haptic('error');
    }
    phase = 'landed';
    nextAt = now + LANDED_MS;
    thrustHeld = false;
    holdId = null;
  }

  // ---- 入力（ホールド＝噴射。最初の指だけを追う）----
  const offDown = ctx.input.onDown((p) => {
    if (hostPaused || !started || phase !== 'fly') return;
    if (holdId === null) {
      holdId = p.id;
      thrustHeld = true;
    }
  });
  const offUp = ctx.input.onUp((p) => {
    if (p.id === holdId) {
      holdId = null;
      thrustHeld = false;
    }
  });

  // ---- 毎フレーム ----
  const offFrame = ctx.onFrame((dt) => {
    if (hostPaused) return;
    const now = ctx.now();
    if (started && phase === 'fly') {
      acc += dt;
      while (acc >= STEP && phase === 'fly') {
        acc -= STEP;
        stepPhysics(fl, thrustHeld, stage(), STEP);
        collectStars(now);
        checkLanding(now);
      }
    } else if (phase === 'landed' && now >= nextAt) {
      if (stageIdx + 1 < STAGES.length) {
        stageIdx++;
        resetStage();
        phase = 'fly';
        ctx.sfx('start');
      } else {
        phase = 'over';
        endAt = now + END_DELAY;
      }
    } else if (phase === 'over' && !ended && now >= endAt) {
      ended = true;
      ctx.end({ score });
      return;
    }
    effects = effects.filter((e) => e.until > now);
    draw(now);
    setData();
  });

  function setData(): void {
    if (!import.meta.env.DEV) return;
    const r = ctx.root as HTMLElement;
    r.dataset.phase = phase;
    r.dataset.stage = String(stageIdx + 1);
    r.dataset.y = fl.y.toFixed(1);
    r.dataset.vy = fl.vy.toFixed(1);
    r.dataset.x = swayX(stage(), fl.t).toFixed(1);
    r.dataset.padx = padXAt(stage(), fl.t).toFixed(1);
    r.dataset.fuel = fl.fuel.toFixed(3);
    r.dataset.score = String(score);
    r.dataset.stars = String(totalStars);
    r.dataset.successes = String(successes);
    r.dataset.thrust = thrustHeld ? '1' : '0';
    r.dataset.t = fl.t.toFixed(3);
    r.dataset.lastland = last
      ? `${last.ok ? 'ok' : last.offPad ? 'off' : 'fast'}:${last.vy.toFixed(1)}:${last.adx.toFixed(1)}:${last.pts}:${last.fuelFrac.toFixed(3)}`
      : '';
  }

  // ---- 描画 ----
  const off = document.createElement('canvas');
  off.width = W * 2;
  off.height = H * 2;
  const og = off.getContext('2d');

  function bakeStatic(): void {
    if (!og) return;
    og.setTransform(2, 0, 0, 2, 0, 0);
    const grad = og.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#0b1026');
    grad.addColorStop(1, '#1a2140');
    og.fillStyle = grad;
    og.fillRect(0, 0, W, H);
    // 星空（決定論パターン）
    for (let i = 0; i < 70; i++) {
      const x = (i * 89 + 17) % W;
      const y = (i * 157 + 31) % (GROUND_TOP - 60);
      const s = i % 3 === 0 ? 1.6 : 1;
      og.fillStyle = i % 4 === 0 ? 'rgba(255,255,255,.7)' : 'rgba(205,214,245,.4)';
      og.fillRect(x, y, s, s);
    }
    // 地面（月面）
    og.fillStyle = '#6d7386';
    og.fillRect(0, GROUND_TOP, W, H - GROUND_TOP);
    og.fillStyle = '#5b6175';
    for (let i = 0; i < 8; i++) {
      const x = (i * 53 + 20) % (W - 30);
      const y = GROUND_TOP + 14 + ((i * 37) % (H - GROUND_TOP - 30));
      og.beginPath();
      og.ellipse(x + 15, y, 12, 5, 0, 0, Math.PI * 2);
      og.fill();
    }
  }
  bakeStatic();

  function drawStarShape(x: number, y: number, s: number, color: string): void {
    g.fillStyle = color;
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const rr = i % 2 === 0 ? s : s * 0.45;
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const px = x + Math.cos(a) * rr;
      const py = y + Math.sin(a) * rr;
      if (i === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    }
    g.closePath();
    g.fill();
  }

  function roundRectPath(x: number, y: number, w: number, h: number, r: number): void {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  function draw(now: number): void {
    const st = stage();
    g.drawImage(off, 0, 0, W, H);

    // パッド
    const px = padXAt(st, fl.t);
    g.fillStyle = '#2b3350';
    roundRectPath(px - st.padW / 2 - 5, PAD_TOP, st.padW + 10, GROUND_TOP - PAD_TOP + 4, 4);
    g.fill();
    g.fillStyle = '#ffd54a';
    g.fillRect(px - st.padW / 2, PAD_TOP, st.padW, 5);
    // ふち灯（点滅）
    const blink = Math.sin(now / 220) > 0;
    g.fillStyle = blink ? '#8affc0' : 'rgba(138,255,192,.3)';
    g.beginPath();
    g.arc(px - st.padW / 2 + 4, PAD_TOP + 2.5, 3, 0, Math.PI * 2);
    g.arc(px + st.padW / 2 - 4, PAD_TOP + 2.5, 3, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(16,24,46,.7)';
    g.font = 'bold 11px sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('H', px, PAD_TOP + 10);

    // ⭐リング
    for (let i = 0; i < st.stars.length; i++) {
      if (starGot[i]) continue;
      const s = st.stars[i]!;
      const pulse = 1 + 0.12 * Math.sin(now / 260 + i * 2);
      g.strokeStyle = 'rgba(255,213,74,.4)';
      g.lineWidth = 2;
      g.beginPath();
      g.arc(s.x, s.y, STAR_R * pulse, 0, Math.PI * 2);
      g.stroke();
      drawStarShape(s.x, s.y, 9, '#ffd54a');
    }

    // ロケット
    const x = swayX(st, fl.t);
    const vx = (swayX(st, fl.t) - swayX(st, fl.t - 0.05)) / 0.05;
    const lean = Math.max(-0.28, Math.min(0.28, vx / 700));
    g.save();
    g.translate(x, fl.y);
    g.rotate(lean);
    // 炎
    if (thrustHeld && fl.fuel > 0 && phase === 'fly') {
      const f = 8 + 5 * Math.sin(now / 40);
      g.fillStyle = '#ff9a4a';
      g.beginPath();
      g.moveTo(-5, ROCKET_HALF);
      g.lineTo(0, ROCKET_HALF + f + 6);
      g.lineTo(5, ROCKET_HALF);
      g.closePath();
      g.fill();
      g.fillStyle = '#ffd54a';
      g.beginPath();
      g.moveTo(-2.5, ROCKET_HALF);
      g.lineTo(0, ROCKET_HALF + f);
      g.lineTo(2.5, ROCKET_HALF);
      g.closePath();
      g.fill();
    }
    // あし
    g.strokeStyle = '#9aa4c0';
    g.lineWidth = 2.5;
    g.beginPath();
    g.moveTo(-6, 6);
    g.lineTo(-10, ROCKET_HALF + 2);
    g.moveTo(6, 6);
    g.lineTo(10, ROCKET_HALF + 2);
    g.stroke();
    // 胴体
    g.fillStyle = '#e8ecf6';
    roundRectPath(-9, -ROCKET_HALF, 18, ROCKET_HALF * 2, 8);
    g.fill();
    // ノーズ
    g.fillStyle = '#e0483c';
    g.beginPath();
    g.moveTo(-9, -8);
    g.quadraticCurveTo(0, -ROCKET_HALF - 9, 9, -8);
    g.closePath();
    g.fill();
    // まど
    g.fillStyle = '#3d7df0';
    g.beginPath();
    g.arc(0, -1, 4.5, 0, Math.PI * 2);
    g.fill();
    g.restore();

    // クラッシュ演出
    if (phase === 'landed' && last && !last.ok) {
      g.fillStyle = '#ff9a4a';
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        const rr = 16 + 9 * Math.sin(now / 90 + i);
        g.beginPath();
        g.arc(x + Math.cos(a) * rr, fl.y + Math.sin(a) * rr * 0.6, 3, 0, Math.PI * 2);
        g.fill();
      }
    }

    // うかぶ得点
    for (const e of effects) {
      const a = Math.max(0, Math.min(1, (e.until - now) / 900));
      g.globalAlpha = a;
      g.fillStyle = e.color;
      g.font = 'bold 15px sans-serif';
      g.textAlign = 'center';
      g.fillText(e.text, e.x, e.y - (1 - a) * 24);
      g.globalAlpha = 1;
    }

    // HUD
    g.fillStyle = 'rgba(8,10,24,.9)';
    g.fillRect(0, 0, W, HUD_H);
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.fillStyle = '#fff';
    g.font = 'bold 19px sans-serif';
    g.fillText(`${score}てん`, 12, HUD_H / 2);
    g.fillStyle = '#cdd6f5';
    g.font = 'bold 14px sans-serif';
    g.fillText(`ステージ${stageIdx + 1}/5 ${st.name}`, 108, HUD_H / 2);
    // ねんりょうバー
    g.fillStyle = 'rgba(8,10,24,.55)';
    roundRectPath(8, 48, 152, 22, 11);
    g.fill();
    g.fillStyle = '#9aa4c0';
    g.font = 'bold 11px sans-serif';
    g.fillText('ねんりょう', 16, 59);
    g.fillStyle = fl.fuel > 0.25 ? '#8affc0' : '#ff8a8a';
    roundRectPath(72, 53, 80 * Math.max(0.001, fl.fuel), 12, 6);
    g.fill();
    // おりるはやさ
    const vOk = st.vOk;
    const good = fl.vy <= vOk;
    g.fillStyle = 'rgba(8,10,24,.55)';
    roundRectPath(8, 74, 152, 22, 11);
    g.fill();
    g.fillStyle = good ? '#8affc0' : '#ff8a8a';
    g.font = 'bold 12px sans-serif';
    g.fillText(
      fl.vy > 0 ? `↓${Math.round(fl.vy)}  ${good ? 'ふんわりOK' : 'はやすぎ！'}` : `↑${Math.round(-fl.vy)}  じょうしょう中`,
      16,
      85,
    );

    // 着陸インターバル
    if (phase === 'landed' && last) {
      g.fillStyle = 'rgba(8,10,24,.72)';
      roundRectPath(40, 210, W - 80, last.ok ? 190 : 130, 16);
      g.fill();
      g.textAlign = 'center';
      if (last.ok) {
        g.fillStyle = '#8affc0';
        g.font = 'bold 24px sans-serif';
        g.fillText(last.vy <= FEATHER_VY ? 'ふんわり！' : 'ちゃくりく せいこう！', W / 2, 244);
        g.fillStyle = '#fff';
        g.font = 'bold 15px sans-serif';
        const softPts = Math.round(60 * Math.max(0, 1 - last.vy / vOk));
        const centerPts = Math.round(50 * Math.max(0, 1 - last.adx / (st.padW / 2)));
        const fuelPts = Math.round(50 * last.fuelFrac);
        g.fillText(`ふんわり +${softPts}　まんなか +${centerPts}`, W / 2, 284);
        g.fillText(`ねんりょう +${fuelPts}`, W / 2, 310);
        g.fillStyle = '#ffd54a';
        g.font = 'bold 20px sans-serif';
        g.fillText(`+${last.pts}`, W / 2, 350);
      } else {
        g.fillStyle = '#ff8a8a';
        g.font = 'bold 24px sans-serif';
        g.fillText('クラッシュ…', W / 2, 244);
        g.fillStyle = '#cdd6f5';
        g.font = 'bold 14px sans-serif';
        g.fillText(
          last.offPad ? 'パッドの上に おりよう' : last.fuelFrac <= 0 ? 'ねんりょうが きれちゃった…' : `はやすぎた！（↓${Math.round(last.vy)}）`,
          W / 2,
          278,
        );
        g.fillText(`↓${vOk} いかで ふんわり おりてね`, W / 2, 302);
      }
    }

    // 操作ヒント（ステージ1の最初だけ）
    if (phase === 'fly' && stageIdx === 0 && fl.t < 3.5) {
      g.fillStyle = 'rgba(205,214,245,.85)';
      g.font = 'bold 15px sans-serif';
      g.textAlign = 'center';
      g.fillText('おしてるあいだ ふんしゃ ▲', W / 2, 470);
    }

    if (phase === 'over') {
      g.fillStyle = 'rgba(8,10,24,.8)';
      g.fillRect(0, 0, W, H);
      g.textAlign = 'center';
      g.fillStyle = '#fff';
      g.font = 'bold 30px sans-serif';
      g.fillText('おわり！', W / 2, H / 2 - 56);
      g.font = 'bold 26px sans-serif';
      g.fillText(`${score}てん`, W / 2, H / 2 - 14);
      g.fillStyle = '#cdd6f5';
      g.font = 'bold 16px sans-serif';
      g.fillText(`せいこう ${successes}/5　⭐×${totalStars}`, W / 2, H / 2 + 22);
    }
  }

  draw(ctx.now());
  setData();

  return {
    start() {
      started = true;
    },
    pause() {
      hostPaused = true;
      holdId = null;
      thrustHeld = false;
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
