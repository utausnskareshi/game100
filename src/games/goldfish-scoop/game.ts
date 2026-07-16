// =============================================================
// きんぎょすくい（No.55）: ポイで きんぎょを すくって おわんへ！お祭りのチルゲーム
// =============================================================
// - 水面下の きんぎょを ポイ（網）で すくい、上の おわんへ はこんで とくてん。
//   ポイの紙は 水につけるほど・魚をのせるほど やぶれる。ポイは3まい。
// - 魚の動き・逃げ・耐久・採点は logic.ts（純ロジック・rng注入）。
// - 全画面 Canvas。操作は ドラッグ（onDown/onMove/onUp）。純Canvasなので重なるDOMは無く
//   ポインタキャプチャ問題は起きない。時間は ctx.now・setTimeout 不使用。
// - import してよいのは game-api（types / helpers）と、このフォルダ内（logic）だけ
import type { GameContext, IGame, PointerInfo } from '../../game-api/types';
import { clamp } from '../../game-api/helpers';
import {
  type Fish,
  POI_R,
  WATER_Y,
  fleeAccel,
  makeSchool,
  overlaps,
  tearStep,
  typeByWeight,
} from './logic';

const W = 360;
const H = 640;
const SCHOOL = 10;
const POI_START = 3;
const BOWL = { x: 292, y: 96, rx: 50, ry: 34 };
const NET_HOME = { x: 180, y: 560 };
const TIME_MS = 75000; // 制限時間（チルな長さ）。時間切れ か ポイ切れ で終了
const END_DELAY = 1600;
const SCORE_HI = 800;
const BIG_SCOOP = 3;
const ONE_POI_GOAL = 5;

type Mode = 'play' | 'over';

export function createGame(ctx: GameContext): IGame {
  const cv = ctx.canvas2d({ design: { w: W, h: H } });
  const g = cv.ctx;

  let mode: Mode = 'play';
  let hostPaused = false;
  let score = 0;
  let poi = POI_START;
  let dur = 1; // 今のポイの耐久 0..1
  let delivered = 0;
  let deliveredBeforeTear = 0;
  let torn = false;
  let fish: Fish[] = makeSchool(ctx.random, SCHOOL, W, H);
  let nextId = SCHOOL;
  let netX = NET_HOME.x;
  let netY = NET_HOME.y;
  let dragId: number | null = null;
  let tearFlashUntil = 0;
  let deliverFlashUntil = 0;
  let endAt = 0;
  let ended = false;

  const caughtCount = (): number => fish.filter((f) => f.caught && !f.gone).length;
  const inWater = (): boolean => netY > WATER_Y - 8;

  function setData(): void {
    if (!import.meta.env.DEV) return;
    const r = ctx.root as HTMLElement;
    r.dataset.mode = mode;
    r.dataset.score = String(score);
    r.dataset.poi = String(poi);
    r.dataset.dur = dur.toFixed(3);
    r.dataset.caught = String(caughtCount());
    r.dataset.delivered = String(delivered);
    r.dataset.net = `${netX.toFixed(0)},${netY.toFixed(0)}`;
    r.dataset.fish = fish
      .filter((f) => !f.gone)
      .map((f) => `${f.id},${f.x.toFixed(0)},${f.y.toFixed(0)},${f.caught ? 1 : 0},${f.type.value},${f.type.rare ? 1 : 0}`)
      .join(';');
  }

  // ---- 入力（ドラッグでポイを動かす）----
  const setNet = (p: PointerInfo): void => {
    const l = cv.toLocal(p);
    netX = clamp(l.x, 20, W - 20);
    netY = clamp(l.y, 40, H - 30);
  };
  const offDown = ctx.input.onDown((p) => {
    if (mode !== 'play' || hostPaused) return;
    if (dragId === null) dragId = p.id;
    if (p.id === dragId) setNet(p);
  });
  const offMove = ctx.input.onMove((p) => {
    if (mode !== 'play' || hostPaused || p.id !== dragId) return;
    setNet(p);
  });
  const offUp = ctx.input.onUp((p) => {
    if (p.id === dragId) dragId = null;
  });

  function spawnReplacement(): void {
    const t = typeByWeight(ctx.random);
    const ang = ctx.random() * Math.PI * 2;
    fish.push({
      id: nextId++,
      x: 30 + ctx.random() * (W - 60),
      y: H - 40, // 下から入ってくる
      vx: Math.cos(ang) * t.speed,
      vy: -Math.abs(Math.sin(ang) * t.speed),
      type: t,
      caught: false,
      gone: false,
    });
  }

  function deliver(now: number): void {
    const onNet = fish.filter((f) => f.caught && !f.gone);
    if (onNet.length === 0) return;
    let gained = 0;
    for (const f of onNet) {
      gained += f.type.value;
      f.gone = true;
      if (f.type.rare) ctx.achieve('rare-catch');
    }
    score += gained;
    delivered += onNet.length;
    if (!torn) deliveredBeforeTear += onNet.length;
    deliverFlashUntil = now + 700;
    ctx.sfx('success');
    ctx.haptic('success');
    ctx.achieve('first-catch');
    if (onNet.length >= BIG_SCOOP) ctx.achieve('big-scoop');
    if (delivered >= 8) ctx.achieve('many-fish');
    if (!torn && deliveredBeforeTear >= ONE_POI_GOAL) ctx.achieve('one-poi');
    if (score >= SCORE_HI) ctx.achieve('score-hi');
    // 補充（群れを保つ）
    while (fish.filter((f) => !f.gone).length < SCHOOL) spawnReplacement();
  }

  function tearPoi(now: number): void {
    torn = true;
    poi--;
    tearFlashUntil = now + 800;
    ctx.sfx('fail');
    ctx.haptic('error');
    // のせていた魚は 逃げる（水へ戻す）
    for (const f of fish) {
      if (f.caught && !f.gone) {
        f.caught = false;
        f.y = Math.max(f.y, WATER_Y + 20);
      }
    }
    if (poi <= 0) {
      mode = 'over';
      endAt = now + END_DELAY;
    } else {
      dur = 1;
      netX = NET_HOME.x;
      netY = NET_HOME.y;
      dragId = null;
    }
  }

  // ---- 毎フレーム ----
  const offFrame = ctx.onFrame((dt) => {
    if (hostPaused) return;
    const now = ctx.now();
    if (mode === 'play') {
      update(dt, now);
    } else if (mode === 'over' && !ended && now >= endAt) {
      ended = true;
      ctx.end({ score });
      return;
    }
    draw(now);
    setData();
  });

  function update(dt: number, now: number): void {
    const netWet = inWater();
    // 魚の更新
    for (const f of fish) {
      if (f.gone) continue;
      if (f.caught) {
        // ポイに のっている魚は 網に追従
        f.x += (netX - f.x) * Math.min(1, dt * 12);
        f.y += (netY - f.y) * Math.min(1, dt * 12);
        continue;
      }
      // 逃げ＋遊泳
      const fl = fleeAccel(f.x, f.y, netX, netY, POI_R);
      f.vx += fl.ax * dt;
      f.vy += fl.ay * dt;
      // ゆるい速度制限
      const sp = Math.hypot(f.vx, f.vy);
      const maxSp = f.type.speed * 2.4;
      if (sp > maxSp) {
        f.vx = (f.vx / sp) * maxSp;
        f.vy = (f.vy / sp) * maxSp;
      }
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      // 水そうの かべで はねる
      if (f.x < 20) { f.x = 20; f.vx = Math.abs(f.vx); }
      if (f.x > W - 20) { f.x = W - 20; f.vx = -Math.abs(f.vx); }
      if (f.y < WATER_Y + 16) { f.y = WATER_Y + 16; f.vy = Math.abs(f.vy); }
      if (f.y > H - 16) { f.y = H - 16; f.vy = -Math.abs(f.vy); }
      // すくう: 網が水にあり 魚に重なったら のせる
      if (netWet && overlaps(f.x, f.y, netX, netY, POI_R)) {
        f.caught = true;
        ctx.sfx('tap');
      }
    }
    // おわんに 届けたら とくてん
    const overBowl = Math.hypot(netX - BOWL.x, (netY - BOWL.y) * 1.3) < BOWL.rx;
    if (overBowl && caughtCount() > 0) deliver(now);
    // 耐久（水中でだけ減る・のせた魚が多いほど速い）
    dur = tearStep(dur, netWet, caughtCount(), dt);
    if (dur <= 0) tearPoi(now);
    // 時間切れ
    if (mode === 'play' && now >= TIME_MS) {
      mode = 'over';
      endAt = now + END_DELAY;
    }
  }

  // ---- 描画 ----
  function draw(now: number): void {
    // 空（お祭りの夜）
    const sky = g.createLinearGradient(0, 0, 0, WATER_Y);
    sky.addColorStop(0, '#20143f');
    sky.addColorStop(1, '#3a2668');
    g.fillStyle = sky;
    g.fillRect(0, 0, W, WATER_Y);
    // ちょうちん風の点
    for (let i = 0; i < 5; i++) {
      g.fillStyle = i % 2 ? '#ff6b6b' : '#ffcf5a';
      g.beginPath();
      g.arc(30 + i * 62, 26 + (i % 2) * 10, 7, 0, Math.PI * 2);
      g.fill();
    }
    // 水
    const water = g.createLinearGradient(0, WATER_Y, 0, H);
    water.addColorStop(0, '#2aa9d8');
    water.addColorStop(1, '#0f5f8a');
    g.fillStyle = water;
    g.fillRect(0, WATER_Y, W, H - WATER_Y);
    g.fillStyle = 'rgba(255,255,255,.18)';
    g.fillRect(0, WATER_Y, W, 4);

    // おわん
    g.fillStyle = deliverFlashUntil > now ? '#ffe6a0' : '#f3f0ea';
    g.beginPath();
    g.ellipse(BOWL.x, BOWL.y, BOWL.rx, BOWL.ry, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#bfe6ff';
    g.beginPath();
    g.ellipse(BOWL.x, BOWL.y - 4, BOWL.rx - 10, BOWL.ry - 10, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#2a4a66';
    g.font = 'bold 12px sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('おわん', BOWL.x, BOWL.y + BOWL.ry + 10);

    // 魚
    for (const f of fish) {
      if (f.gone) continue;
      drawFish(f);
    }

    // ポイ（網）
    drawPoi(now);

    // HUD
    g.fillStyle = '#fff';
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.font = 'bold 22px sans-serif';
    g.fillText(`${score}てん`, 14, 30);
    // のこり時間
    const remain = Math.max(0, Math.ceil((TIME_MS - now) / 1000));
    g.textAlign = 'center';
    g.font = 'bold 18px sans-serif';
    g.fillStyle = remain <= 10 ? '#ff9a9a' : '#fff';
    g.fillText(`${remain}`, W / 2, 30);
    // ポイ残り
    g.textAlign = 'right';
    g.font = '18px sans-serif';
    g.fillText(`ポイ ×${poi}`, W - 14, 30);
    // 耐久バー
    const bw = 120;
    g.fillStyle = 'rgba(255,255,255,.25)';
    g.fillRect(W - 14 - bw, 44, bw, 8);
    g.fillStyle = dur > 0.4 ? '#8affc0' : dur > 0.2 ? '#ffd54a' : '#ff7a7a';
    g.fillRect(W - 14 - bw, 44, bw * dur, 8);

    if (mode === 'over') {
      g.fillStyle = 'rgba(8,20,30,.72)';
      g.fillRect(0, 0, W, H);
      g.fillStyle = '#fff';
      g.textAlign = 'center';
      g.font = 'bold 30px sans-serif';
      g.fillText('おつかれさま！', W / 2, H / 2 - 40);
      g.font = 'bold 24px sans-serif';
      g.fillText(`${delivered}ひき / ${score}てん`, W / 2, H / 2 + 6);
    }
  }

  function drawFish(f: Fish): void {
    g.save();
    g.translate(f.x, f.y);
    const dir = f.vx >= 0 ? 1 : -1;
    g.scale(dir, 1);
    if (f.type.rare) {
      g.globalAlpha = 0.9;
      g.shadowColor = '#ffe08a';
      g.shadowBlur = 10;
    }
    g.fillStyle = f.type.color;
    // からだ
    g.beginPath();
    g.ellipse(0, 0, 11, 7, 0, 0, Math.PI * 2);
    g.fill();
    // しっぽ
    g.beginPath();
    g.moveTo(-9, 0);
    g.lineTo(-18, -7);
    g.lineTo(-18, 7);
    g.closePath();
    g.fill();
    g.restore();
    // 目
    g.fillStyle = '#fff';
    g.beginPath();
    g.arc(f.x + (f.vx >= 0 ? 6 : -6), f.y - 2, 2, 0, Math.PI * 2);
    g.fill();
  }

  function drawPoi(now: number): void {
    const torn2 = tearFlashUntil > now;
    // 持ち手
    g.strokeStyle = '#c9a06a';
    g.lineWidth = 5;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(netX, netY);
    g.lineTo(netX + 22, netY + 40);
    g.stroke();
    // 枠
    g.strokeStyle = torn2 ? '#ff7a7a' : '#e8c98a';
    g.lineWidth = 4;
    g.beginPath();
    g.arc(netX, netY, POI_R, 0, Math.PI * 2);
    g.stroke();
    // 紙（耐久で うすくなる）
    g.fillStyle = `rgba(255,255,255,${0.10 + dur * 0.22})`;
    g.beginPath();
    g.arc(netX, netY, POI_R - 2, 0, Math.PI * 2);
    g.fill();
    // やぶれヒビ（耐久が低いと）
    if (dur < 0.5) {
      g.strokeStyle = 'rgba(40,60,80,.5)';
      g.lineWidth = 1.2;
      g.beginPath();
      g.moveTo(netX - 8, netY - 6);
      g.lineTo(netX + 4, netY + 8);
      g.lineTo(netX + 12, netY - 2);
      g.stroke();
    }
  }

  // ---- 起動 ----
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
      offDown();
      offMove();
      offUp();
      offFrame();
    },
  };
}
