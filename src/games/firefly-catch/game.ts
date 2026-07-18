// =============================================================
// ホタルあつめ（No.79）: そーっと あみを近づけて、夜のホタルをつかまえよう
// =============================================================
// - 操作はドラッグだけ。ただし「動かす速さ」に意味がある: 速く動かすと逃げられる。
//   あみの中に少しとどめると つかまえ。失敗ペナルティのない まったり枠（chill）。
// - きんホタルは光っている間 超びんかん。くもがくれ（月が隠れる）はみんな ゆだんするチャンス。
// - ふるまい・種類・出現は logic.ts（乱数は ctx.random 注入＝完全決定論）。
// - 全画面 Canvas・時間は ctx.now 期限方式・setTimeout 不使用。
// - import してよいのは game-api（types / helpers）と、このフォルダ内（logic）だけ
import type { GameContext, IGame } from '../../game-api/types';
import {
  CATCH_HOLD,
  type Fly,
  GAME_SEC,
  H,
  NET_R,
  POPULATION,
  RESPAWN_SEC,
  STREAK_WINDOW_SEC,
  TYPES,
  W,
  goldGlowOn,
  inCloud,
  rollFlyType,
  shouldFlee,
  spawnPos,
  streakBonus,
  wanderStep,
} from './logic';

const HUD_H = 40;
const END_DELAY = 2200;
const SCORE_HI = 550; // 実績閾値（完全追跡ボット2045で到達実証・実機要調整）
const CATCH_ACH = 12;
const BLUE_ACH = 3;
const CLOUD_ACH = 3;
const FLEE_MS = 900;

type Phase = 'play' | 'over';

interface FloatFx {
  x: number;
  y: number;
  text: string;
  color: string;
  until: number;
}

export function createGame(ctx: GameContext): IGame {
  const cv = ctx.canvas2d({ design: { w: W, h: H } });
  const g = cv.ctx;

  let phase: Phase = 'play';
  let started = false;
  let hostPaused = false;
  let t0 = 0;
  const flies: Fly[] = [];
  const respawnAts: number[] = []; // 補充予約（ms）
  let netX = 180;
  let netY = 420;
  let netSpeed = 0; // EMA平滑した移動速度 px/s
  let touching = false;
  let holdId: number | null = null;
  let score = 0;
  let caughtG = 0;
  let caughtB = 0;
  let caughtK = 0;
  let cloudCatches = 0;
  let streak = 0;
  let lastCatchAt = -Infinity;
  let effects: FloatFx[] = [];
  let endAt = 0;
  let ended = false;
  let lastEvent = '';

  const elapsed = (): number => (started ? (ctx.now() - t0) / 1000 : 0);
  const totalCaught = (): number => caughtG + caughtB + caughtK;

  function addScore(n: number): void {
    score += n;
    if (score >= SCORE_HI) ctx.achieve('score-hi');
  }

  function spawnFly(): void {
    const p = spawnPos(ctx.random, netX, netY);
    flies.push({
      type: rollFlyType(ctx.random),
      x: p.x,
      y: p.y,
      heading: ctx.random() * Math.PI * 2,
      turnF: 0.6 + ctx.random() * 1.2,
      seed: ctx.random() * Math.PI * 2,
      glowPhase: ctx.random() * (2.4 + 1.8),
      state: 'wander',
      fleeUntil: 0,
      prog: 0,
    });
  }

  function catchFly(i: number, now: number): void {
    const f = flies[i]!;
    const ty = TYPES[f.type]!;
    if (f.type === 0) caughtG++;
    else if (f.type === 1) caughtB++;
    else caughtK++;
    const t = elapsed();
    if (now - lastCatchAt <= STREAK_WINDOW_SEC * 1000) streak++;
    else streak = 1;
    lastCatchAt = now;
    const bonus = streakBonus(streak);
    addScore(ty.pts + bonus);
    ctx.achieve('first-catch');
    if (totalCaught() >= CATCH_ACH) ctx.achieve('catch-12');
    if (caughtB >= BLUE_ACH) ctx.achieve('blue-3');
    if (f.type === 2) ctx.achieve('gold-catch');
    if (inCloud(t)) {
      cloudCatches++;
      if (cloudCatches >= CLOUD_ACH) ctx.achieve('cloud-3');
    }
    effects.push({
      x: f.x,
      y: f.y,
      text: bonus > 0 ? `+${ty.pts} れんぞく+${bonus}` : `+${ty.pts}`,
      color: ty.color,
      until: now + 1000,
    });
    ctx.sfx(f.type === 2 ? 'medal' : 'success');
    ctx.haptic('light');
    lastEvent = `catch:${f.type}:${ty.pts + bonus}`;
    flies.splice(i, 1);
    respawnAts.push(now + RESPAWN_SEC * 1000);
  }

  function update(dt: number, now: number): void {
    const t = elapsed();
    // あみの速度は指を離すと すっと落ち着く
    if (!touching) netSpeed += (0 - netSpeed) * Math.min(1, dt * 10);
    // 補充
    for (let i = respawnAts.length - 1; i >= 0; i--) {
      if (now >= respawnAts[i]!) {
        respawnAts.splice(i, 1);
        spawnFly();
      }
    }
    const cloud = inCloud(t);
    for (let i = flies.length - 1; i >= 0; i--) {
      const f = flies[i]!;
      if (f.state === 'flee' && now >= f.fleeUntil) f.state = 'wander';
      // おどろき判定
      if (f.state === 'wander' && shouldFlee(f, t, netX, netY, netSpeed, cloud)) {
        f.state = 'flee';
        f.fleeUntil = now + FLEE_MS;
        f.heading = Math.atan2(f.y - netY, f.x - netX);
        f.prog = 0;
        lastEvent = `flee:${f.type}`;
      }
      wanderStep(f, t, dt);
      // 捕獲ゲージ
      const d = Math.hypot(f.x - netX, f.y - netY);
      if (f.state === 'wander' && d < NET_R - 6) {
        f.prog += dt;
        if (f.prog >= CATCH_HOLD) {
          catchFly(i, now);
          continue;
        }
      } else {
        f.prog = Math.max(0, f.prog - dt * 1.5);
      }
    }
    if (t >= GAME_SEC) {
      phase = 'over';
      endAt = now + END_DELAY;
    }
  }

  // ---- 入力（ドラッグであみを動かす。速さはEMAで平滑）----
  function moveNet(x: number, y: number, dt: number): void {
    const inst = dt > 0 ? Math.hypot(x - netX, y - netY) / dt : 0;
    netSpeed += (inst - netSpeed) * Math.min(1, dt * 12);
    netX = x;
    netY = y;
  }
  let lastMoveAt = 0;
  const offDown = ctx.input.onDown((p) => {
    if (hostPaused || !started || phase !== 'play') return;
    if (holdId !== null) return;
    holdId = p.id;
    touching = true;
    const l = cv.toLocal(p);
    const now = ctx.now();
    // 触れた瞬間はワープ扱いにせず、そこへ「置く」（速度に含めない）
    netX = l.x;
    netY = l.y;
    lastMoveAt = now;
  });
  const offMove = ctx.input.onMove((p) => {
    if (hostPaused || !started || phase !== 'play' || p.id !== holdId) return;
    const l = cv.toLocal(p);
    const now = ctx.now();
    const dt = Math.max(0.001, (now - lastMoveAt) / 1000);
    lastMoveAt = now;
    moveNet(l.x, l.y, dt);
  });
  const offUp = ctx.input.onUp((p) => {
    if (p.id === holdId) {
      holdId = null;
      touching = false;
    }
  });

  // ---- 毎フレーム ----
  const offFrame = ctx.onFrame((dt) => {
    if (hostPaused) return;
    const now = ctx.now();
    if (started && phase === 'play') update(dt, now);
    if (phase === 'over' && !ended && now >= endAt) {
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
    r.dataset.score = String(score);
    r.dataset.caught = `${caughtG}:${caughtB}:${caughtK}`;
    r.dataset.total = String(totalCaught());
    r.dataset.netspeed = netSpeed.toFixed(1);
    r.dataset.netx = netX.toFixed(1);
    r.dataset.nety = netY.toFixed(1);
    r.dataset.cloud = inCloud(elapsed()) ? '1' : '0';
    r.dataset.cloudcatches = String(cloudCatches);
    r.dataset.streak = String(streak);
    r.dataset.timeleft = String(Math.ceil(Math.max(0, GAME_SEC - elapsed())));
    r.dataset.flies = flies
      .map((f) => `${f.type}:${f.x.toFixed(1)}:${f.y.toFixed(1)}:${f.state}:${f.prog.toFixed(2)}:${f.type === 2 ? (goldGlowOn(elapsed(), f.glowPhase) ? 1 : 0) : 1}`)
      .join(';');
    r.dataset.last = lastEvent;
    r.dataset.t = elapsed().toFixed(2);
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
    grad.addColorStop(0, '#0a1030');
    grad.addColorStop(0.65, '#101c30');
    grad.addColorStop(1, '#0e2418');
    og.fillStyle = grad;
    og.fillRect(0, 0, W, H);
    // 遠くの星
    og.fillStyle = 'rgba(255,255,255,.35)';
    for (let i = 0; i < 40; i++) {
      const x = (i * 83 + 11) % W;
      const y = (i * 131 + 23) % 260;
      og.fillRect(x, y + 46, 1.4, 1.4);
    }
    // 遠くの山なみ
    og.fillStyle = '#0c1626';
    og.beginPath();
    og.moveTo(0, 300);
    og.quadraticCurveTo(70, 250, 150, 292);
    og.quadraticCurveTo(240, 330, 360, 268);
    og.lineTo(360, 640);
    og.lineTo(0, 640);
    og.closePath();
    og.fill();
    // 草むら（シルエット）
    og.fillStyle = '#081a10';
    og.beginPath();
    og.moveTo(0, 574);
    for (let x = 0; x <= W; x += 12) {
      const h2 = 16 + ((x * 7919) % 23);
      og.lineTo(x + 6, 574 - h2);
      og.lineTo(x + 12, 574);
    }
    og.lineTo(W, 640);
    og.lineTo(0, 640);
    og.closePath();
    og.fill();
    og.fillStyle = '#06140c';
    og.fillRect(0, 574, W, H - 574);
  }
  bakeStatic();

  function draw(now: number): void {
    const t = elapsed();
    const cloud = inCloud(t);
    g.drawImage(off, 0, 0, W, H);
    // 月（くもがくれ中は雲に覆われる）
    const mx = 300;
    const my = 96;
    g.fillStyle = '#f4eecf';
    g.beginPath();
    g.arc(mx, my, 22, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(220,214,180,.5)';
    g.beginPath();
    g.arc(mx - 7, my - 4, 4, 0, Math.PI * 2);
    g.arc(mx + 6, my + 7, 3, 0, Math.PI * 2);
    g.fill();
    if (cloud) {
      g.fillStyle = 'rgba(30,38,60,.94)';
      for (const [ox, oy, r] of [
        [-16, 2, 16],
        [0, -4, 19],
        [16, 4, 15],
        [30, 0, 11],
        [-30, 4, 12],
      ] as [number, number, number][]) {
        g.beginPath();
        g.arc(mx + ox, my + oy, r, 0, Math.PI * 2);
        g.fill();
      }
      // 画面もすこし暗く
      g.fillStyle = 'rgba(4,6,14,.28)';
      g.fillRect(0, 0, W, H);
    }

    // ホタル
    for (const f of flies) {
      const ty = TYPES[f.type]!;
      let bright: number;
      if (f.type === 2) bright = !cloud && goldGlowOn(t, f.glowPhase) ? 1 : 0.16;
      else bright = 0.62 + 0.38 * Math.sin(now / 400 + f.seed * 3);
      const glow = g.createRadialGradient(f.x, f.y, 1, f.x, f.y, 16);
      glow.addColorStop(0, ty.color);
      glow.addColorStop(1, 'rgba(0,0,0,0)');
      g.globalAlpha = 0.75 * bright;
      g.fillStyle = glow;
      g.beginPath();
      g.arc(f.x, f.y, 16, 0, Math.PI * 2);
      g.fill();
      g.globalAlpha = Math.max(0.25, bright);
      g.fillStyle = ty.color;
      g.beginPath();
      g.arc(f.x, f.y, 3, 0, Math.PI * 2);
      g.fill();
      g.globalAlpha = 1;
      // 捕獲ゲージ（ホタルのまわり）
      if (f.prog > 0) {
        g.strokeStyle = '#8affc0';
        g.lineWidth = 2.5;
        g.beginPath();
        g.arc(f.x, f.y, 10, -Math.PI / 2, -Math.PI / 2 + (f.prog / CATCH_HOLD) * Math.PI * 2);
        g.stroke();
      }
      // 逃げ演出
      if (f.state === 'flee') {
        g.strokeStyle = 'rgba(255,255,255,.4)';
        g.lineWidth = 1.5;
        g.beginPath();
        g.moveTo(f.x - Math.cos(f.heading) * 10, f.y - Math.sin(f.heading) * 10);
        g.lineTo(f.x - Math.cos(f.heading) * 18, f.y - Math.sin(f.heading) * 18);
        g.stroke();
      }
    }

    // あみ
    const fast = netSpeed > 150;
    g.strokeStyle = fast ? 'rgba(255,138,138,.9)' : 'rgba(242,243,251,.9)';
    g.lineWidth = 3;
    g.beginPath();
    g.arc(netX, netY, NET_R, 0, Math.PI * 2);
    g.stroke();
    g.strokeStyle = fast ? 'rgba(255,138,138,.25)' : 'rgba(242,243,251,.22)';
    g.lineWidth = 1.5;
    for (let k = -2; k <= 2; k++) {
      g.beginPath();
      g.moveTo(netX - NET_R, netY + k * 12);
      g.quadraticCurveTo(netX, netY + k * 12 + 5, netX + NET_R, netY + k * 12);
      g.stroke();
    }
    // 柄
    g.strokeStyle = '#8a5a34';
    g.lineWidth = 5;
    g.beginPath();
    g.moveTo(netX + NET_R * 0.72, netY + NET_R * 0.72);
    g.lineTo(netX + NET_R * 0.72 + 30, netY + NET_R * 0.72 + 30);
    g.stroke();

    // うかぶ得点
    for (const e of effects) {
      const a = Math.max(0, Math.min(1, (e.until - now) / 1000));
      g.globalAlpha = a;
      g.fillStyle = e.color;
      g.font = 'bold 15px sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(e.text, e.x, e.y - (1 - a) * 24);
      g.globalAlpha = 1;
    }

    // くもがくれバナー
    if (cloud && phase === 'play') {
      g.fillStyle = 'rgba(8,10,24,.6)';
      g.fillRect(0, 48, W, 30);
      g.fillStyle = '#8fd0ff';
      g.font = 'bold 15px sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('くもで まっくら… ちかづく チャンス！', W / 2, 63);
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
    g.font = 'bold 15px sans-serif';
    g.fillText(`のこり${Math.ceil(Math.max(0, GAME_SEC - elapsed()))}びょう`, 112, HUD_H / 2);
    g.fillStyle = '#9dff6a';
    g.font = 'bold 14px sans-serif';
    g.fillText(`かご×${totalCaught()}`, 236, HUD_H / 2);

    if (phase === 'over') {
      g.fillStyle = 'rgba(8,10,24,.8)';
      g.fillRect(0, 0, W, H);
      g.textAlign = 'center';
      g.fillStyle = '#fff';
      g.font = 'bold 28px sans-serif';
      g.fillText('おつかれさま！', W / 2, H / 2 - 60);
      g.font = 'bold 26px sans-serif';
      g.fillText(`${score}てん`, W / 2, H / 2 - 18);
      g.fillStyle = '#cdd6f5';
      g.font = 'bold 15px sans-serif';
      g.fillText(`みどり×${caughtG}　あお×${caughtB}　きん×${caughtK}`, W / 2, H / 2 + 18);
    }
  }

  // 最初のホタルたち
  for (let i = 0; i < POPULATION; i++) spawnFly();

  draw(ctx.now());
  setData();

  return {
    start() {
      started = true;
      t0 = ctx.now();
    },
    pause() {
      hostPaused = true;
      holdId = null;
      touching = false;
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
      offFrame();
    },
  };
}
