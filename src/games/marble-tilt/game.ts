// =============================================================
// ビーだまより分け（No.90）: かたむけてビーだまを同じ色のゲートへ転がすセンサーゲーム
// =============================================================
// - かたむき（ctx.motion）またはドラッグ＝仮想かたむき（helpers の createDragTilt・
//   かたむきメイロで実証済み）で横方向の力をあやつる。ピンにはねるビーだまを
//   下の同じ色のゲートへ。後半は同時に2〜3球＝視線とかたむきの取り合いが本体。
// - 出現計画は logic.ts（同時空中ペアは「となりゲート以内」保証・rng注入＝完全決定論）。
// - 全画面 Canvas・時間は ctx.now 期限方式・setTimeout 不使用。
// - import してよいのは game-api（types / helpers）と、このフォルダ内（logic）だけ
import type { GameContext, IGame } from '../../game-api/types';
import { createDragTilt, pushOutCircleFromRect } from '../../game-api/helpers';
import {
  CORRECT_PTS,
  GATE_JUDGE_Y,
  GATE_X,
  GOLD_PTS,
  GRAVITY,
  H,
  HUD_H,
  MARBLES,
  MARBLE_R,
  PEG_R,
  type Plan,
  SCORE_HI,
  TILT_ACCEL,
  W,
  WALL_L,
  WALL_R,
  DIVIDER_Y,
  gateAt,
  makePlan,
  pegs,
  streakBonus,
} from './logic';

const INTRO_MS = 1500;
const END_DELAY = 2200;
const STREAK_ACH = 10;
// 共有かたむき×同時落下の構造上、実力上限はボット実証で23/27前後。
// 25以上・全問正解は恒偽になるため、実証値（20・23）で較正してある
const SORT_ACH = 20;
const NEAR_PERFECT_ACH = 23;

type Mode = 'intro' | 'play' | 'over';

interface Marble {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** 0..2=色 / 3=金 */
  kind: number;
  idx: number;
}

interface Splash {
  x: number;
  gatePos: number;
  ok: boolean;
  at: number;
}

interface FloatFx {
  x: number;
  y: number;
  text: string;
  color: string;
  at: number;
  until: number;
}

const COLOR_BODY = ['#e0483c', '#3d7df0', '#ffd54a'];
const COLOR_NAME = ['あか', 'あお', 'きいろ'];
const GOLD_BODY = '#f5e6a8';

export function createGame(ctx: GameContext): IGame {
  const cv = ctx.canvas2d({ design: { w: W, h: H } });
  const g = cv.ctx;

  const plan: Plan = makePlan(ctx.random);
  const PEGS = pegs();

  let mode: Mode = 'intro';
  let started = false;
  let hostPaused = false;
  let ended = false;
  let score = 0;
  let spawned = 0;
  let landed = 0;
  let correct = 0;
  let wrong = 0;
  let golds = 0;
  let streak = 0;
  let phaseUntil = 0;
  let playStartAt = 0;
  let marbles: Marble[] = [];
  let splashes: Splash[] = [];
  let effects: FloatFx[] = [];
  let lastEvent = '';

  const dragTilt = createDragTilt(ctx, {
    toLocal: (p) => cv.toLocal(p),
    div: 60,
    enabled: () => mode === 'play' && !hostPaused,
  });

  function addScore(n: number): void {
    score += n;
    if (score >= SCORE_HI) ctx.achieve('score-hi');
  }

  function land(m: Marble, now: number): void {
    landed++;
    const pos = gateAt(m.x);
    const gx = (GATE_X[pos]![0] + GATE_X[pos]![1]) / 2;
    if (m.kind === 3) {
      golds++;
      addScore(GOLD_PTS);
      if (golds >= 3) ctx.achieve('gold-3');
      splashes.push({ x: gx, gatePos: pos, ok: true, at: now });
      effects.push({ x: m.x, y: 560, text: `+${GOLD_PTS}`, color: '#ffd54a', at: now, until: now + 900 });
      ctx.sfx('powerup');
      ctx.haptic('light');
      lastEvent = `gold:${golds}`;
    } else if (plan.gatePerm[pos] === m.kind) {
      correct++;
      streak++;
      const pts = CORRECT_PTS + streakBonus(streak);
      addScore(pts);
      ctx.achieve('first-sort');
      if (streak >= STREAK_ACH) ctx.achieve('streak-10');
      if (correct >= SORT_ACH) ctx.achieve('sort-20');
      if (correct >= NEAR_PERFECT_ACH) ctx.achieve('near-perfect');
      splashes.push({ x: gx, gatePos: pos, ok: true, at: now });
      effects.push({ x: m.x, y: 560, text: `+${pts}`, color: '#ffffff', at: now, until: now + 800 });
      ctx.sfx(streak >= 5 ? 'combo' : 'success');
      ctx.haptic('light');
      lastEvent = `ok:${correct}:st${streak}`;
    } else {
      wrong++;
      streak = 0;
      splashes.push({ x: gx, gatePos: pos, ok: false, at: now });
      effects.push({ x: m.x, y: 560, text: 'ちがう…', color: '#ffb3a8', at: now, until: now + 800 });
      ctx.sfx('fail');
      lastEvent = `ng:${wrong}`;
    }
  }

  // ---- 毎フレーム ----
  const offFrame = ctx.onFrame((dt: number) => {
    if (hostPaused) return;
    const now = ctx.now();
    if (mode === 'intro' && started && now >= phaseUntil) {
      mode = 'play';
      playStartAt = now;
      ctx.sfx('start');
    } else if (mode === 'play') {
      const t = now - playStartAt;
      // 出現
      while (spawned < MARBLES && plan.spawns[spawned]!.at <= t) {
        const sp = plan.spawns[spawned]!;
        const wob = [(spawned * 29) % 29 - 14, ((spawned * 17) % 23) - 11][spawned % 2]!;
        marbles.push({ x: 180 + wob, y: HUD_H + 24, vx: ((spawned * 13) % 7) - 3, vy: 50, kind: sp.kind, idx: spawned });
        spawned++;
        ctx.sfx('tick');
        lastEvent = `spawn:${spawned}`;
      }
      // 物理
      const tilt = dragTilt.value().x;
      for (const m of marbles) {
        m.vy += GRAVITY * dt;
        m.vx += tilt * TILT_ACCEL * dt;
        m.vx *= Math.exp(-0.55 * dt);
        m.x += m.vx * dt;
        m.y += m.vy * dt;
        // かべ
        if (m.x < WALL_L + MARBLE_R) {
          m.x = WALL_L + MARBLE_R;
          m.vx = Math.abs(m.vx) * 0.45;
        } else if (m.x > WALL_R - MARBLE_R) {
          m.x = WALL_R - MARBLE_R;
          m.vx = -Math.abs(m.vx) * 0.45;
        }
        // ピン
        for (const p of PEGS) {
          const dx = m.x - p.x;
          const dy = m.y - p.y;
          const rr = MARBLE_R + PEG_R;
          const d2 = dx * dx + dy * dy;
          if (d2 < rr * rr && d2 > 1e-6) {
            const d = Math.sqrt(d2);
            let nx = dx / d;
            const ny = dy / d;
            // 真上でつり合って止まらないよう、わずかに決定論的なバイアス
            if (Math.abs(nx) < 0.06) nx = m.idx % 2 === 0 ? 0.08 : -0.08;
            m.x = p.x + nx * rr;
            m.y = p.y + ny * rr;
            const vn = m.vx * nx + m.vy * ny;
            if (vn < 0) {
              // 反発ひかえめ＝はねの暴れを抑えて「かたむきで導ける」手ごたえに
              m.vx -= (1 + 0.35) * vn * nx;
              m.vy -= (1 + 0.35) * vn * ny;
            }
          }
        }
        // 仕切り（レーンのかべ）
        for (const wx of [123.5, 236.5]) {
          const res = pushOutCircleFromRect(m, MARBLE_R, { x: wx - 2.5, y: DIVIDER_Y, w: 5, h: H - DIVIDER_Y });
          if (res === 'x') m.vx *= -0.4;
          else if (res === 'y') m.vy *= -0.3;
        }
      }
      // 着地判定
      for (const m of [...marbles]) {
        if (m.y >= GATE_JUDGE_Y) {
          land(m, now);
          marbles = marbles.filter((o) => o !== m);
        }
      }
      if (landed >= MARBLES) {
        mode = 'over';
        phaseUntil = now + END_DELAY;
        ctx.sfx('medal');
        lastEvent = `finish:${correct}`;
      }
    } else if (mode === 'over' && !ended && now >= phaseUntil) {
      ended = true;
      ctx.end({ score });
      return;
    }
    splashes = splashes.filter((s) => now - s.at < 500);
    effects = effects.filter((e) => e.until > now);
    draw(now);
    setData(now);
  });

  function setData(now: number): void {
    if (!import.meta.env.DEV) return;
    void now;
    const r = ctx.root as HTMLElement;
    r.dataset.mode = mode;
    r.dataset.tilt = dragTilt.value().x.toFixed(3);
    r.dataset.score = String(score);
    r.dataset.spawned = String(spawned);
    r.dataset.landed = String(landed);
    r.dataset.correct = String(correct);
    r.dataset.wrong = String(wrong);
    r.dataset.golds = String(golds);
    r.dataset.streak = String(streak);
    // いちばん下（ゲートに近い）ビーだま＋全アクティブ球（ボットの視線移動用）
    let low: Marble | null = null;
    for (const m of marbles) if (!low || m.y > low.y) low = m;
    r.dataset.mx = low ? low.x.toFixed(1) : '-1';
    r.dataset.my = low ? low.y.toFixed(1) : '-1';
    r.dataset.mvx = low ? low.vx.toFixed(1) : '0';
    r.dataset.mkind = low ? String(low.kind) : '-1';
    r.dataset.marbles = marbles.map((m) => `${m.x.toFixed(1)}:${m.y.toFixed(1)}:${m.vx.toFixed(1)}:${m.kind}`).join(';');
    r.dataset.gates = plan.gatePerm.join(',');
    const nexts: string[] = [];
    for (let k = spawned; k < Math.min(spawned + 2, MARBLES); k++) nexts.push(String(plan.spawns[k]!.kind));
    r.dataset.next = nexts.join(',');
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
    const bg = og.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#2a3550');
    bg.addColorStop(1, '#1c2438');
    og.fillStyle = bg;
    og.fillRect(0, 0, W, H);
    // かべ
    og.fillStyle = '#4a5878';
    og.fillRect(WALL_L - 6, HUD_H, 8, H - HUD_H);
    og.fillRect(WALL_R - 2, HUD_H, 8, H - HUD_H);
    // ピン
    for (const p of pegs()) {
      og.fillStyle = '#8a97b8';
      og.beginPath();
      og.arc(p.x, p.y, PEG_R, 0, Math.PI * 2);
      og.fill();
      og.fillStyle = 'rgba(255,255,255,.5)';
      og.beginPath();
      og.arc(p.x - 1.5, p.y - 1.5, 1.8, 0, Math.PI * 2);
      og.fill();
    }
    // 仕切りとゲート
    og.fillStyle = '#4a5878';
    og.fillRect(121, DIVIDER_Y, 5, H - DIVIDER_Y);
    og.fillRect(234, DIVIDER_Y, 5, H - DIVIDER_Y);
    for (let pos = 0; pos < 3; pos++) {
      const [x0, x1] = GATE_X[pos]!;
      const c = COLOR_BODY[plan.gatePerm[pos]!]!;
      og.fillStyle = c;
      og.globalAlpha = 0.25;
      og.fillRect(x0, 600, x1 - x0, 34);
      og.globalAlpha = 1;
      // アーチ
      og.strokeStyle = c;
      og.lineWidth = 5;
      og.beginPath();
      og.arc((x0 + x1) / 2, 604, Math.min(44, (x1 - x0) / 2 - 6), Math.PI, 0);
      og.stroke();
      og.fillStyle = c;
      og.font = 'bold 13px sans-serif';
      og.textAlign = 'center';
      og.textBaseline = 'middle';
      og.fillText(COLOR_NAME[plan.gatePerm[pos]!]!, (x0 + x1) / 2, 622);
    }
  }
  bakeStatic();

  function drawMarble(m: Marble, now: number): void {
    const body = m.kind === 3 ? GOLD_BODY : COLOR_BODY[m.kind]!;
    g.fillStyle = 'rgba(0,0,0,.25)';
    g.beginPath();
    g.ellipse(m.x, m.y + MARBLE_R * 0.7, MARBLE_R * 0.8, MARBLE_R * 0.3, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = body;
    g.beginPath();
    g.arc(m.x, m.y, MARBLE_R, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = 'rgba(0,0,0,.3)';
    g.lineWidth = 1.5;
    g.stroke();
    g.fillStyle = 'rgba(255,255,255,.65)';
    g.beginPath();
    g.arc(m.x - 3, m.y - 3, 2.8, 0, Math.PI * 2);
    g.fill();
    if (m.kind === 3) {
      const a = 0.5 + 0.5 * Math.sin(now / 130 + m.idx);
      g.strokeStyle = `rgba(255,225,120,${a.toFixed(2)})`;
      g.lineWidth = 2;
      for (let k = 0; k < 4; k++) {
        const ang = (k / 4) * Math.PI * 2 + now / 400;
        g.beginPath();
        g.moveTo(m.x + Math.cos(ang) * (MARBLE_R + 3), m.y + Math.sin(ang) * (MARBLE_R + 3));
        g.lineTo(m.x + Math.cos(ang) * (MARBLE_R + 7), m.y + Math.sin(ang) * (MARBLE_R + 7));
        g.stroke();
      }
    }
  }

  function draw(now: number): void {
    g.drawImage(off, 0, 0, W, H);

    // かたむきインジケータ
    const tilt = dragTilt.value().x;
    g.fillStyle = 'rgba(255,255,255,.12)';
    g.fillRect(120, 52, 120, 8);
    g.fillStyle = Math.abs(tilt) > 0.02 ? '#9fe3ff' : 'rgba(255,255,255,.4)';
    g.beginPath();
    g.arc(180 + tilt * 56, 56, 6, 0, Math.PI * 2);
    g.fill();

    // ゲートのスプラッシュ
    for (const s of splashes) {
      const t = (now - s.at) / 500;
      g.strokeStyle = s.ok ? `rgba(140,230,140,${1 - t})` : `rgba(255,120,110,${1 - t})`;
      g.lineWidth = 4;
      g.beginPath();
      g.arc(s.x, 600, 12 + t * 26, Math.PI, 0);
      g.stroke();
    }

    for (const m of marbles) drawMarble(m, now);

    // うかぶテキスト
    for (const e of effects) {
      if (now < e.at) continue;
      const a = Math.min(1, (e.until - now) / 350);
      g.globalAlpha = Math.max(0, a);
      g.fillStyle = e.color;
      g.font = 'bold 15px sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.strokeStyle = 'rgba(20,28,45,.8)';
      g.lineWidth = 3;
      const rise = ((now - e.at) / 900) * 16;
      g.strokeText(e.text, e.x, e.y - rise);
      g.fillText(e.text, e.x, e.y - rise);
      g.globalAlpha = 1;
    }

    // 開始バナー
    if (mode === 'intro' && started) {
      g.fillStyle = 'rgba(20,28,45,.85)';
      const bw = 300;
      g.beginPath();
      g.moveTo(W / 2 - bw / 2 + 14, 260);
      g.arcTo(W / 2 + bw / 2, 260, W / 2 + bw / 2, 344, 14);
      g.arcTo(W / 2 + bw / 2, 344, W / 2 - bw / 2, 344, 14);
      g.arcTo(W / 2 - bw / 2, 344, W / 2 - bw / 2, 260, 14);
      g.arcTo(W / 2 - bw / 2, 260, W / 2 + bw / 2, 260, 14);
      g.closePath();
      g.fill();
      g.fillStyle = '#fff';
      g.font = 'bold 22px sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('かたむけて より分けよう！', W / 2, 292);
      g.fillStyle = '#9fe3ff';
      g.font = 'bold 13px sans-serif';
      g.fillText('ドラッグでもOK。ぜんぶで30こ', W / 2, 322);
    }

    // HUD
    if (mode !== 'over') {
      g.fillStyle = 'rgba(15,22,38,.92)';
      g.fillRect(0, 0, W, HUD_H);
      g.textBaseline = 'middle';
      g.textAlign = 'left';
      g.fillStyle = '#fff';
      g.font = 'bold 19px sans-serif';
      g.fillText(`${score}てん`, 12, HUD_H / 2);
      g.fillStyle = '#9fc6e8';
      g.font = 'bold 14px sans-serif';
      g.fillText(`${landed}/${MARBLES}`, 116, HUD_H / 2);
      if (streak >= 3) {
        g.fillStyle = '#ffd54a';
        g.fillText(`×${streak}`, 168, HUD_H / 2);
      }
      // つぎのビーだま予告
      g.fillStyle = '#9fc6e8';
      g.textAlign = 'right';
      g.fillText('つぎ', 250, HUD_H / 2);
      let k = 0;
      for (let i = spawned; i < Math.min(spawned + 2, MARBLES); i++) {
        const kind = plan.spawns[i]!.kind;
        g.fillStyle = kind === 3 ? GOLD_BODY : COLOR_BODY[kind]!;
        g.beginPath();
        g.arc(264 + k * 20, HUD_H / 2, 7, 0, Math.PI * 2);
        g.fill();
        k++;
      }
    } else {
      g.fillStyle = 'rgba(15,22,38,.86)';
      g.fillRect(0, 0, W, H);
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = '#fff';
      g.font = 'bold 30px sans-serif';
      g.fillText('おしまい！', W / 2, H / 2 - 56);
      g.font = 'bold 26px sans-serif';
      g.fillText(`${score}てん`, W / 2, H / 2 - 12);
      g.fillStyle = '#9fe3ff';
      g.font = 'bold 16px sans-serif';
      g.fillText(`ただしく ${correct}/${MARBLES - 3}こ・きん ${golds}/3`, W / 2, H / 2 + 24);
      if (correct >= NEAR_PERFECT_ACH) {
        g.fillStyle = '#ffd54a';
        g.fillText('ほぼパーフェクト！', W / 2, H / 2 + 52);
      }
    }
  }

  draw(ctx.now());
  setData(ctx.now());

  return {
    start() {
      started = true;
      mode = 'intro';
      phaseUntil = ctx.now() + INTRO_MS;
      ctx.sfx('tick');
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
      dragTilt.destroy();
      offFrame();
    },
  };
}
