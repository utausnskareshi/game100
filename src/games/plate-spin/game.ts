// =============================================================
// おさらまわし（No.78）: ぐらぐらする前に タップで回し直して 全部キープ！
// =============================================================
// - 操作はタップだけ。皿は回転が弱まると ぐらぐら→落ちて割れる（3枚で おしまい）。
//   「まだ元気」な皿は回し直せない＝窓を見て回す。ぐらぐらからの救出は高得点。
// - 皿の性格（大=のんびり〜金=超せっかち・高得点）は logic.ts。乱数は ctx.random 注入。
// - 全画面 Canvas・時間は ctx.now 期限方式・setTimeout 不使用。
// - import してよいのは game-api（types / helpers）と、このフォルダ内（logic）だけ
import type { GameContext, IGame } from '../../game-api/types';
import {
  BROKEN_LIMIT,
  CLEAR_PTS,
  FALL_MS,
  FRESH,
  GAME_SEC,
  H,
  POLES,
  RESPAWN_MS,
  SAFE,
  SPAWN_INTERVAL,
  SPAWN_ORDER,
  STAB_PTS,
  TAP_R,
  TYPES,
  W,
  WOBBLE,
  decayStep,
  rollType,
  tapPoints,
} from './logic';

const HUD_H = 40;
const END_DELAY = 2200;
const SCORE_HI = 850; // 実績閾値（ボット較正済み・実機要調整）
const RESCUE_ACH = 12;
const GOLD_ACH = 5;

type Phase = 'play' | 'over';
type PlateState = 'spin' | 'fall' | 'none';

interface Plate {
  state: PlateState;
  type: number;
  spin: number;
  marker: number; // 回転マーカーの角度（見た目）
  wobblePhase: number;
  fallAt: number;
  respawnAt: number;
}

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
  const plates: Plate[] = POLES.map(() => ({
    state: 'none',
    type: 0,
    spin: 0,
    marker: 0,
    wobblePhase: 0,
    fallAt: 0,
    respawnAt: Infinity,
  }));
  let spawned = 0;
  let nextSpawnAt = 0; // 秒（ゲーム内経過）
  let score = 0;
  let broken = 0;
  let rescues = 0;
  let goldTaps = 0;
  let stabSecs = 0;
  let nextStabAt = 0; // ms
  // 得点の内訳（検証とデバッグ用に分けて持つ）
  let rescuePts = 0;
  let respinPts = 0;
  let stabPts = 0;
  let clearPts = 0;
  let cleared = false;
  let effects: FloatFx[] = [];
  let endAt = 0;
  let ended = false;
  let lastEvent = '';

  const elapsed = (): number => (started ? (ctx.now() - t0) / 1000 : 0);

  function addScore(n: number): void {
    score += n;
    if (score >= SCORE_HI) ctx.achieve('score-hi');
  }

  function spawnPlate(pole: number, type: number, now: number): void {
    const p = plates[pole];
    if (!p) return;
    p.state = 'spin';
    p.type = type;
    p.spin = 1;
    p.marker = 0;
    p.wobblePhase = ctx.random() * Math.PI * 2;
    p.respawnAt = Infinity;
    effects.push({ x: POLES[pole]!.x, y: POLES[pole]!.y - 30, text: 'あたらしいおさら！', color: '#cdd6f5', until: now + 900 });
  }

  function gameOver(now: number, didClear: boolean): void {
    cleared = didClear;
    phase = 'over';
    endAt = now + END_DELAY;
  }

  function update(dt: number, now: number): void {
    const t = elapsed();
    // 皿の追加（最初の2枚は 大・中 固定でやさしく、以降は乱数）
    while (spawned < SPAWN_ORDER.length && t >= nextSpawnAt) {
      const pole = SPAWN_ORDER[spawned]!;
      const type = spawned === 0 ? 0 : spawned === 1 ? 1 : rollType(ctx.random);
      spawnPlate(pole, type, now);
      spawned++;
      // 2枚目までは t=0、3枚目以降は 11・22・33・44 秒に1枚ずつ
      nextSpawnAt = spawned < 2 ? 0 : (spawned - 1) * SPAWN_INTERVAL;
    }
    // 回転の減衰と落下
    for (let i = 0; i < plates.length; i++) {
      const p = plates[i]!;
      if (p.state === 'spin') {
        const ty = TYPES[p.type]!;
        p.spin = decayStep(p.spin, ty.decay, dt);
        p.marker += (2 + p.spin * 10) * dt;
        if (p.spin <= 0) {
          p.state = 'fall';
          p.fallAt = now;
          ctx.sfx('fail');
          ctx.haptic('error');
          lastEvent = `fall:${i}`;
        }
      } else if (p.state === 'fall' && now >= p.fallAt + FALL_MS) {
        p.state = 'none';
        broken++;
        p.respawnAt = now + RESPAWN_MS;
        effects.push({ x: POLES[i]!.x, y: POLES[i]!.y + 60, text: 'ガシャン…', color: '#ff8a8a', until: now + 1000 });
        lastEvent = `break:${i}`;
        if (broken >= BROKEN_LIMIT) {
          gameOver(now, false);
          return;
        }
      } else if (p.state === 'none' && now >= p.respawnAt) {
        spawnPlate(i, rollType(ctx.random), now);
      }
    }
    // 6枚同時に ぜんぶ元気（spin>=0.5）。成立瞬間がタップ間でも拾う（achieve は冪等）
    const spinningAll = plates.filter((p) => p.state === 'spin');
    if (spinningAll.length === POLES.length && spinningAll.every((p) => p.spin >= 0.5)) ctx.achieve('all-six');
    // 安定ボーナス（1秒ごと・回っている皿すべてが SAFE 以上）
    if (now >= nextStabAt) {
      nextStabAt += 1000;
      const spinning = plates.filter((p) => p.state === 'spin');
      if (spinning.length > 0 && spinning.every((p) => p.spin >= SAFE)) {
        stabSecs++;
        stabPts += STAB_PTS;
        addScore(STAB_PTS);
      }
    }
    if (t >= GAME_SEC) {
      clearPts = CLEAR_PTS;
      addScore(CLEAR_PTS);
      if (broken === 0) ctx.achieve('no-break');
      ctx.sfx('medal');
      gameOver(now, true);
    }
  }

  // ---- 入力（皿タップで回し直し）----
  const offDown = ctx.input.onDown((pt) => {
    if (hostPaused || !started || phase !== 'play') return;
    const l = cv.toLocal(pt);
    let hit = -1;
    let bestD = TAP_R;
    for (let i = 0; i < POLES.length; i++) {
      const d = Math.hypot(l.x - POLES[i]!.x, l.y - POLES[i]!.y);
      if (d <= bestD) {
        bestD = d;
        hit = i;
      }
    }
    if (hit < 0) return;
    const p = plates[hit]!;
    if (p.state !== 'spin') return;
    const now = ctx.now();
    const ty = TYPES[p.type]!;
    const pts = tapPoints(p.spin, !!ty.gold);
    if (p.spin >= FRESH) {
      // まだ元気＝回し直せない（連打では守れない）
      effects.push({ x: POLES[hit]!.x, y: POLES[hit]!.y - 34, text: 'まだげんき！', color: '#9aa4c0', until: now + 600 });
      ctx.sfx('tick');
      lastEvent = `fresh:${hit}`;
      return;
    }
    const wasWobble = p.spin < WOBBLE;
    p.spin = 1;
    if (wasWobble) {
      rescues++;
      rescuePts += pts;
      ctx.achieve('first-rescue');
      if (rescues >= RESCUE_ACH) ctx.achieve('rescue-12');
    } else {
      respinPts += pts;
    }
    if (ty.gold) {
      goldTaps++;
      if (goldTaps >= GOLD_ACH) ctx.achieve('gold-keep');
    }
    addScore(pts);
    effects.push({
      x: POLES[hit]!.x,
      y: POLES[hit]!.y - 34,
      text: wasWobble ? `セーフ！+${pts}` : `+${pts}`,
      color: wasWobble ? '#8affc0' : ty.gold ? '#ffd54a' : '#fff',
      until: now + 800,
    });
    ctx.sfx(wasWobble ? 'combo' : 'tap');
    ctx.haptic('light');
    lastEvent = `${wasWobble ? 'rescue' : 'respin'}:${hit}:${pts}`;
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
    r.dataset.comp = `${rescuePts}:${respinPts}:${stabPts}:${clearPts}`;
    r.dataset.broken = String(broken);
    r.dataset.rescues = String(rescues);
    r.dataset.goldtaps = String(goldTaps);
    r.dataset.stabsecs = String(stabSecs);
    r.dataset.timeleft = String(Math.ceil(Math.max(0, GAME_SEC - elapsed())));
    r.dataset.cleared = cleared ? '1' : '0';
    r.dataset.plates = plates
      .map((p, i) => `${i}:${p.state}:${p.type}:${p.spin.toFixed(3)}`)
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
    // サーカスの幕
    const grad = og.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#571e2e');
    grad.addColorStop(0.5, '#3a1622');
    grad.addColorStop(1, '#241019');
    og.fillStyle = grad;
    og.fillRect(0, 0, W, H);
    // 幕のひだ
    og.fillStyle = 'rgba(255,255,255,.045)';
    for (let x = 0; x < W; x += 36) og.fillRect(x, 0, 14, H);
    // スポットライト
    for (const p of POLES) {
      const sp = og.createRadialGradient(p.x, p.y + 10, 8, p.x, p.y + 10, 84);
      sp.addColorStop(0, 'rgba(255,236,170,.13)');
      sp.addColorStop(1, 'rgba(255,236,170,0)');
      og.fillStyle = sp;
      og.beginPath();
      og.arc(p.x, p.y + 10, 84, 0, Math.PI * 2);
      og.fill();
    }
    // 棒と台
    for (const p of POLES) {
      og.strokeStyle = '#8a5a34';
      og.lineWidth = 6;
      og.lineCap = 'round';
      og.beginPath();
      og.moveTo(p.x, p.y + 4);
      og.lineTo(p.x, p.y + 78);
      og.stroke();
      og.fillStyle = '#5f3d23';
      og.beginPath();
      og.ellipse(p.x, p.y + 80, 22, 7, 0, 0, Math.PI * 2);
      og.fill();
    }
  }
  bakeStatic();

  function drawPlate(i: number, p: Plate, now: number): void {
    const pole = POLES[i]!;
    const ty = TYPES[p.type]!;
    let y = pole.y;
    let tilt = 0;
    let alpha = 1;
    if (p.state === 'fall') {
      const k = Math.min(1, (now - p.fallAt) / FALL_MS);
      y = pole.y + k * k * 120;
      tilt = k * 1.6;
      alpha = 1 - k * 0.4;
    } else if (p.state === 'spin' && p.spin < WOBBLE) {
      tilt = (WOBBLE - p.spin) * 2.2 * Math.sin(now / 70 + p.wobblePhase);
    }
    g.save();
    g.globalAlpha = alpha;
    g.translate(pole.x, y);
    g.rotate(tilt);
    // 皿本体（横長のだ円）
    g.fillStyle = ty.gold ? '#ffedb0' : '#f2f3fb';
    g.beginPath();
    g.ellipse(0, 0, ty.size, ty.size * 0.32, 0, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = ty.rim;
    g.lineWidth = 3.5;
    g.beginPath();
    g.ellipse(0, 0, ty.size, ty.size * 0.32, 0, 0, Math.PI * 2);
    g.stroke();
    // 回転マーカー（回転がわかる点）
    const mx = Math.cos(p.marker * 6) * ty.size * 0.72;
    g.fillStyle = ty.rim;
    g.beginPath();
    g.arc(mx, -2, 3, 0, Math.PI * 2);
    g.fill();
    // かお（元気→あせり）
    const face = p.state !== 'spin' ? 'x' : p.spin >= FRESH ? 'happy' : p.spin >= WOBBLE ? 'ok' : 'panic';
    g.fillStyle = '#2a2340';
    g.beginPath();
    g.arc(-7, -3, 2, 0, Math.PI * 2);
    g.arc(7, -3, 2, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#2a2340';
    g.lineWidth = 2;
    g.beginPath();
    if (face === 'happy') g.arc(0, 1, 4.5, 0.15 * Math.PI, 0.85 * Math.PI);
    else if (face === 'ok') {
      g.moveTo(-4, 4);
      g.lineTo(4, 4);
    } else if (face === 'panic') g.arc(0, 6, 3.5, 1.15 * Math.PI, 1.85 * Math.PI);
    else {
      g.moveTo(-4, 2);
      g.lineTo(4, 6);
      g.moveTo(4, 2);
      g.lineTo(-4, 6);
    }
    g.stroke();
    // 金のきらめき
    if (ty.gold && p.state === 'spin') {
      g.fillStyle = `rgba(255,213,74,${0.5 + 0.5 * Math.sin(now / 180)})`;
      g.beginPath();
      g.arc(ty.size * 0.55, -8, 2.5, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
    // ぐらぐら警告と汗
    if (p.state === 'spin' && p.spin < WOBBLE) {
      g.fillStyle = '#ff8a8a';
      g.font = 'bold 12px sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('ぐらぐら！', pole.x, pole.y - 30);
      g.fillStyle = '#8fd0ff';
      g.beginPath();
      g.arc(pole.x + TYPES[p.type]!.size + 5, pole.y - 12 + 3 * Math.sin(now / 120), 2.5, 0, Math.PI * 2);
      g.fill();
    }
    // 元気ゲージ
    if (p.state === 'spin') {
      const w = 40;
      const frac = p.spin;
      g.fillStyle = 'rgba(8,10,24,.5)';
      g.fillRect(pole.x - w / 2, pole.y + 16, w, 5);
      g.fillStyle = frac >= FRESH ? '#8affc0' : frac >= WOBBLE ? '#ffd54a' : '#ff8a8a';
      g.fillRect(pole.x - w / 2, pole.y + 16, w * frac, 5);
    }
  }

  function draw(now: number): void {
    g.drawImage(off, 0, 0, W, H);
    for (let i = 0; i < plates.length; i++) {
      const p = plates[i]!;
      if (p.state !== 'none') drawPlate(i, p, now);
    }
    // うかぶ文字
    for (const e of effects) {
      const a = Math.max(0, Math.min(1, (e.until - now) / 800));
      g.globalAlpha = a;
      g.fillStyle = e.color;
      g.font = 'bold 14px sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(e.text, e.x, e.y - (1 - a) * 20);
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
    g.font = 'bold 15px sans-serif';
    g.fillText(`のこり${Math.ceil(Math.max(0, GAME_SEC - elapsed()))}びょう`, 118, HUD_H / 2);
    for (let i = 0; i < BROKEN_LIMIT; i++) {
      g.fillStyle = i < broken ? '#ff8a8a' : 'rgba(255,255,255,.22)';
      g.font = 'bold 16px sans-serif';
      g.fillText('✕', 244 + i * 18, HUD_H / 2);
    }

    if (phase === 'over') {
      g.fillStyle = 'rgba(8,10,24,.8)';
      g.fillRect(0, 0, W, H);
      g.textAlign = 'center';
      g.fillStyle = '#fff';
      g.font = 'bold 28px sans-serif';
      g.fillText(cleared ? 'やりきった！' : 'おさらが われちゃった…', W / 2, H / 2 - 56);
      g.font = 'bold 26px sans-serif';
      g.fillText(`${score}てん`, W / 2, H / 2 - 14);
      g.fillStyle = '#cdd6f5';
      g.font = 'bold 15px sans-serif';
      g.fillText(`セーフ${rescues}回　あんてい${stabSecs}びょう`, W / 2, H / 2 + 22);
      if (cleared && broken === 0) {
        g.fillStyle = '#8affc0';
        g.fillText('ノーブレイク！', W / 2, H / 2 + 50);
      }
    }
  }

  draw(ctx.now());
  setData();

  return {
    start() {
      started = true;
      t0 = ctx.now();
      nextStabAt = t0 + 1000;
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
      offFrame();
    },
  };
}
