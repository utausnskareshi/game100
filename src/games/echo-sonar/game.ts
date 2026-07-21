// =============================================================
// こだまソナー（No.84）: 波紋のこだまで くらい海のクジラをさがす 三角測量パズル
// =============================================================
// - タップ＝いしを落とす（ピン）。波紋がクジラに届くと、タップ地点を中心に
//   半径＝クジラまでの距離 の光る輪が返ってくる（fadeMs ですぐ消える）。
//   輪を頭の中で交差させ、クジラの真上をずばりタップできれば キャッチ！
// - ピン数制限（さいごの1回で捕まえられなければ失敗）＝むだ撃ちでは勝てない。
//   後半はニセこだまを返すクラゲ（輪の色がかすかに違う・つつくとピンがむだに）。
// - 配置・採点は logic.ts（純ロジック・rng注入＝完全決定論）。
// - 全画面 Canvas・時間は ctx.now 期限方式・setTimeout 不使用。
// - import してよいのは game-api（types / helpers）と、このフォルダ内（logic）だけ
import type { GameContext, IGame } from '../../game-api/types';
import {
  BASE_PTS,
  CENTER_BONUS,
  CENTER_R,
  H,
  HUD_H,
  JELLY_BONUS,
  JELLY_POKE_R,
  type Pt,
  RIPPLE_SPEED,
  ROUNDS,
  type RoundSpec,
  SCORE_HI,
  W,
  dist,
  layoutRound,
  pingBonus,
  roundScore,
  speedBonus,
} from './logic';

const INTRO_MS = 1500;
const CAUGHT_MS = 2000;
const FAIL_MS = 1700;
const END_DELAY = 2000;
/** 手ぶれ・マルチタッチでピンを二重消費しないための最小間隔 */
const PING_GAP_MS = 130;

type Mode = 'intro' | 'play' | 'caught' | 'fail' | 'over';

interface Ripple {
  x: number;
  y: number;
  at: number;
  maxR: number;
}

interface Echo {
  x: number;
  y: number;
  r: number;
  /** 波紋が届いて輪が現れる時刻（at + r/RIPPLE_SPEED） */
  showAt: number;
  fadeMs: number;
  jelly: boolean;
  heard: boolean;
}

interface FloatFx {
  x: number;
  y: number;
  text: string;
  color: string;
  at: number;
  until: number;
}

export function createGame(ctx: GameContext): IGame {
  const cv = ctx.canvas2d({ design: { w: W, h: H } });
  const g = cv.ctx;

  // 全ラウンドの配置を最初に一括生成（rng 消費順固定＝決定論）
  const layouts = ROUNDS.map((spec) => layoutRound(ctx.random, spec));

  let mode: Mode = 'intro';
  let started = false;
  let hostPaused = false;
  let ended = false;
  let roundIdx = 0;
  let pings = 0;
  let pokes = 0;
  let caught = 0;
  let score = 0;
  let ripples: Ripple[] = [];
  let echoes: Echo[] = [];
  let effects: FloatFx[] = [];
  let phaseUntil = 0; // intro / caught / fail / over の期限
  let roundStartAt = 0;
  let lastPingAt = -Infinity;
  let jellyShowUntil = 0;
  let catchAt = 0;
  let failAt = 0;
  let lastEvent = '';
  let lastPing = '';

  const spec = (): RoundSpec => ROUNDS[roundIdx]!;
  const whale = (): Pt => layouts[roundIdx]!.whale;
  const jelly = (): Pt | null => layouts[roundIdx]!.jelly;

  function addScore(n: number): void {
    score += n;
    if (score >= SCORE_HI) ctx.achieve('score-hi');
  }

  function beginRound(idx: number, now: number): void {
    roundIdx = idx;
    pings = 0;
    pokes = 0;
    ripples = [];
    echoes = [];
    jellyShowUntil = 0;
    mode = 'intro';
    phaseUntil = now + INTRO_MS;
    ctx.sfx('tick');
  }

  function advance(now: number): void {
    if (roundIdx + 1 < ROUNDS.length) {
      beginRound(roundIdx + 1, now);
    } else {
      if (caught === ROUNDS.length) ctx.achieve('all-whales');
      mode = 'over';
      phaseUntil = now + END_DELAY;
      ctx.sfx('medal');
    }
  }

  function doCatch(tap: Pt, dW: number, now: number): void {
    const sp = spec();
    caught++;
    const ms = now - roundStartAt;
    const pts = roundScore(sp, pings, dW, ms);
    addScore(pts);
    ctx.achieve('first-catch');
    if (pings <= 3) ctx.achieve('three-ping');
    if (dW <= CENTER_R) ctx.achieve('center-hit');
    if (sp.jelly && pokes === 0) ctx.achieve('jelly-dodge');
    mode = 'caught';
    catchAt = now;
    phaseUntil = now + CAUGHT_MS;
    ripples.push({ x: tap.x, y: tap.y, at: now, maxR: 90 });
    // 得点の内訳をじゅんばんに浮かせる
    const parts: [string, string][] = [[`+${BASE_PTS} つかまえた！`, '#ffffff']];
    parts.push([`ピン${pings}回 +${pingBonus(pings)}`, '#9fe3ff']);
    if (dW <= CENTER_R) parts.push([`どまんなか +${CENTER_BONUS}`, '#ffd54a']);
    const spd = speedBonus(ms);
    if (spd > 0) parts.push([`はやさ +${spd}`, '#9fe3ff']);
    if (sp.jelly) parts.push([`クラゲの海 +${JELLY_BONUS}`, '#ff9ad5']);
    const w = whale();
    const fy = Math.max(120, w.y - 64);
    parts.forEach(([text, color], i) => {
      const at = now + 260 + i * 240;
      effects.push({ x: w.x, y: fy - i * 22, text, color, at, until: at + 1500 });
    });
    ctx.sfx('success');
    ctx.haptic('success');
    lastEvent = `catch:${pts}`;
  }

  // ---- 入力（タップ＝ピン） ----
  const offDown = ctx.input.onDown((p) => {
    if (hostPaused || !started || mode !== 'play') return;
    const l = cv.toLocal(p);
    const now = ctx.now();
    if (l.y <= HUD_H + 2 || l.x < 0 || l.x > W || l.y > H) return; // HUD・海の外は無効
    if (now - lastPingAt < PING_GAP_MS) return; // 手ぶれの二重タップは1回ぶん
    lastPingAt = now;
    const sp = spec();
    pings++;
    const dW = dist(l, whale());
    const j = jelly();
    const dJ = j ? dist(l, j) : -1;
    lastPing = `${pings}:${dW.toFixed(2)}:${dJ < 0 ? '-1' : dJ.toFixed(2)}`;
    if (dW <= sp.catchR) {
      doCatch(l, dW, now);
      return;
    }
    // クラゲをつついた（ピンはむだ・すがたがちょっと見える）
    if (j && dJ >= 0 && dJ <= JELLY_POKE_R) {
      pokes++;
      jellyShowUntil = now + 1200;
      ctx.haptic('light');
      lastEvent = 'poke';
    } else {
      lastEvent = `ping:${pings}`;
    }
    // 波紋と、こだまの輪（クジラ＋クラゲ）を予約
    const maxD = Math.max(dW, dJ);
    ripples.push({ x: l.x, y: l.y, at: now, maxR: maxD + 60 });
    echoes.push({
      x: l.x,
      y: l.y,
      r: dW,
      showAt: now + (dW / RIPPLE_SPEED) * 1000,
      fadeMs: sp.fadeMs,
      jelly: false,
      heard: false,
    });
    if (j && dJ >= 0) {
      echoes.push({
        x: l.x,
        y: l.y,
        r: dJ,
        showAt: now + (dJ / RIPPLE_SPEED) * 1000,
        fadeMs: sp.fadeMs,
        jelly: true,
        heard: false,
      });
    }
    ctx.sfx('tap');
    if (pings >= sp.maxPings) {
      // さいごのピンでも捕まえられなかった → にげられた
      mode = 'fail';
      failAt = now;
      phaseUntil = now + FAIL_MS;
      ctx.sfx('fail');
      lastEvent = 'escape';
    }
  });

  // ---- 毎フレーム ----
  const offFrame = ctx.onFrame(() => {
    if (hostPaused) return;
    const now = ctx.now();
    if (mode === 'intro' && started && now >= phaseUntil) {
      mode = 'play';
      roundStartAt = now;
      ctx.sfx('start');
    } else if ((mode === 'caught' || mode === 'fail') && now >= phaseUntil) {
      advance(now);
    } else if (mode === 'over' && !ended && now >= phaseUntil) {
      ended = true;
      ctx.end({ score });
      return;
    }
    // こだまが届いた瞬間の音（近いほど高い音＝耳でも距離の見当がつく）
    for (const e of echoes) {
      if (!e.heard && now >= e.showAt) {
        e.heard = true;
        if (e.jelly) {
          ctx.tone?.(230, 160);
        } else {
          ctx.tone?.(760 - (Math.min(e.r, 560) / 560) * 420, 170);
          ctx.sfx('tick');
        }
      }
    }
    ripples = ripples.filter((r) => ((now - r.at) / 1000) * RIPPLE_SPEED < r.maxR + 30);
    echoes = echoes.filter((e) => now < e.showAt + e.fadeMs);
    effects = effects.filter((e) => e.until > now);
    draw(now);
    setData(now);
  });

  function setData(now: number): void {
    if (!import.meta.env.DEV) return;
    const r = ctx.root as HTMLElement;
    r.dataset.mode = mode;
    r.dataset.round = String(roundIdx + 1);
    r.dataset.pings = String(pings);
    r.dataset.maxPings = String(spec().maxPings);
    r.dataset.pokes = String(pokes);
    r.dataset.caught = String(caught);
    r.dataset.score = String(score);
    r.dataset.echoes = String(echoes.filter((e) => now >= e.showAt).length);
    r.dataset.lastPing = lastPing;
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
    // 深い海のグラデーション
    const sea = og.createLinearGradient(0, 0, 0, H);
    sea.addColorStop(0, '#0d3055');
    sea.addColorStop(0.5, '#0a2545');
    sea.addColorStop(1, '#061a33');
    og.fillStyle = sea;
    og.fillRect(0, 0, W, H);
    // 上からさしこむ光
    og.fillStyle = 'rgba(126,200,255,.055)';
    for (const [x0, w0] of [
      [58, 40],
      [168, 26],
      [268, 46],
    ] as [number, number][]) {
      og.beginPath();
      og.moveTo(x0, HUD_H);
      og.lineTo(x0 + w0, HUD_H);
      og.lineTo(x0 + w0 + 36, H - 60);
      og.lineTo(x0 - 36, H - 60);
      og.closePath();
      og.fill();
    }
    // 水面のきらめき（HUDのすぐ下）
    og.strokeStyle = 'rgba(180,225,255,.35)';
    og.lineWidth = 2;
    og.beginPath();
    for (let x = 0; x <= W; x += 8) {
      const y = HUD_H + 6 + Math.sin(x * 0.22) * 2;
      if (x === 0) og.moveTo(x, y);
      else og.lineTo(x, y);
    }
    og.stroke();
    // 海底（すな山・岩・海そう）
    og.fillStyle = '#0e2c50';
    og.beginPath();
    og.moveTo(0, H);
    og.lineTo(0, H - 34);
    og.quadraticCurveTo(60, H - 58, 120, H - 36);
    og.quadraticCurveTo(180, H - 20, 236, H - 42);
    og.quadraticCurveTo(300, H - 62, W, H - 30);
    og.lineTo(W, H);
    og.closePath();
    og.fill();
    og.fillStyle = '#123a63';
    for (const [rx, ry, rr] of [
      [52, H - 34, 14],
      [212, H - 30, 10],
      [316, H - 38, 16],
    ] as [number, number, number][]) {
      og.beginPath();
      og.ellipse(rx, ry, rr, rr * 0.62, 0, Math.PI, 0);
      og.fill();
    }
    og.strokeStyle = '#155a49';
    og.lineWidth = 3.5;
    og.lineCap = 'round';
    for (const [bx, bh, sway] of [
      [96, 34, 8],
      [104, 26, -6],
      [262, 40, 9],
      [270, 30, -7],
    ] as [number, number, number][]) {
      og.beginPath();
      og.moveTo(bx, H - 26);
      og.quadraticCurveTo(bx + sway, H - 26 - bh * 0.6, bx + sway * 0.4, H - 26 - bh);
      og.stroke();
    }
  }
  bakeStatic();

  function rrect(x: number, y: number, w: number, h: number, r: number): void {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  function banner(title: string, sub: string | null, y: number): void {
    const bw = 312;
    const bh = sub ? 84 : 58;
    g.fillStyle = 'rgba(7,22,40,.82)';
    rrect(W / 2 - bw / 2, y, bw, bh, 16);
    g.fill();
    g.strokeStyle = 'rgba(126,230,255,.5)';
    g.lineWidth = 1.5;
    rrect(W / 2 - bw / 2, y, bw, bh, 16);
    g.stroke();
    g.fillStyle = '#ffffff';
    g.font = 'bold 24px sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(title, W / 2, y + (sub ? 30 : bh / 2));
    if (sub) {
      g.fillStyle = '#bfe6ff';
      g.font = 'bold 13px sans-serif';
      g.fillText(sub, W / 2, y + 60);
    }
  }

  function drawJelly(x: number, y: number, now: number, alpha: number): void {
    g.save();
    g.globalAlpha = alpha;
    const bob = Math.sin(now / 260) * 2;
    g.translate(x, y + bob);
    // かさ
    g.fillStyle = '#ff9ad5';
    g.beginPath();
    g.arc(0, 0, 15, Math.PI, 0);
    g.quadraticCurveTo(15, 7, 10, 7);
    g.quadraticCurveTo(6, 3, 2, 7);
    g.quadraticCurveTo(-2, 3, -6, 7);
    g.quadraticCurveTo(-10, 3, -15, 7);
    g.closePath();
    g.fill();
    g.fillStyle = 'rgba(255,255,255,.55)';
    g.beginPath();
    g.ellipse(-4, -6, 6, 3.2, -0.5, 0, Math.PI * 2);
    g.fill();
    // あし
    g.strokeStyle = '#ff9ad5';
    g.lineWidth = 2;
    g.lineCap = 'round';
    for (let i = 0; i < 4; i++) {
      const bx = -9 + i * 6;
      const sw = Math.sin(now / 200 + i * 1.7) * 4;
      g.beginPath();
      g.moveTo(bx, 8);
      g.quadraticCurveTo(bx + sw, 16, bx + sw * 0.5, 23);
      g.stroke();
    }
    // 目
    g.fillStyle = '#5a2143';
    g.beginPath();
    g.arc(-4, -1, 1.7, 0, Math.PI * 2);
    g.arc(4, -1, 1.7, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }

  function drawWhale(x: number, y: number, alpha: number): void {
    g.save();
    g.globalAlpha = alpha;
    g.font = '46px sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('🐳', x, y);
    g.restore();
  }

  function draw(now: number): void {
    g.drawImage(off, 0, 0, W, H);

    // ただよう泡（決定論のアンビエント）
    g.fillStyle = 'rgba(160,215,255,.14)';
    for (let i = 0; i < 6; i++) {
      const speed = 13 + i * 3.4;
      const by = H - 20 - (((now / 1000) * speed + i * 97) % (H - HUD_H - 40));
      const bx = ((i * 61 + 30) % (W - 40)) + 20 + Math.sin(now / 700 + i * 2.1) * 8;
      g.beginPath();
      g.arc(bx, by, 2.2 + (i % 3), 0, Math.PI * 2);
      g.fill();
    }

    // 波紋（広がる輪）
    for (const r of ripples) {
      const rr2 = ((now - r.at) / 1000) * RIPPLE_SPEED;
      if (rr2 <= 0) continue;
      const a = Math.max(0, 0.5 - (rr2 / (r.maxR + 30)) * 0.5);
      g.strokeStyle = `rgba(150,205,255,${a.toFixed(3)})`;
      g.lineWidth = 2;
      g.beginPath();
      g.arc(r.x, r.y, rr2, 0, Math.PI * 2);
      g.stroke();
    }

    // こだまの輪（クジラ＝水色 / クラゲ＝ピンク）＋ピンの位置マーカー
    for (const e of echoes) {
      if (now < e.showAt) continue;
      const t = (now - e.showAt) / e.fadeMs;
      const a = Math.max(0, 1 - t);
      const flash = Math.max(0, 1 - (now - e.showAt) / 260);
      const col = e.jelly ? '255,154,213' : '126,230,255';
      g.strokeStyle = `rgba(${col},${(a * 0.9).toFixed(3)})`;
      g.lineWidth = 2.5 + flash * 2.5;
      g.beginPath();
      g.arc(e.x, e.y, e.r, 0, Math.PI * 2);
      g.stroke();
      g.strokeStyle = `rgba(${col},${(a * 0.28).toFixed(3)})`;
      g.lineWidth = 7;
      g.beginPath();
      g.arc(e.x, e.y, e.r, 0, Math.PI * 2);
      g.stroke();
      if (!e.jelly) {
        // ピンの中心マーカー（輪の中心を思い出せるように・輪と同じはやさで消える）
        g.fillStyle = `rgba(220,240,255,${(a * 0.9).toFixed(3)})`;
        g.beginPath();
        g.arc(e.x, e.y, 3, 0, Math.PI * 2);
        g.fill();
      }
    }

    // つつかれたクラゲ
    const j = jelly();
    if (j && now < jellyShowUntil) {
      const a = 0.5 + 0.4 * Math.sin(now / 130);
      drawJelly(j.x, j.y, now, Math.max(0.25, a));
    }

    // キャッチ演出
    if (mode === 'caught') {
      const w = whale();
      const p = Math.min(1, (now - catchAt) / 700);
      const bob = Math.sin((now - catchAt) / 280) * 3;
      drawWhale(w.x, w.y - 10 * p + bob, 1);
      // しぶき
      const sp2 = Math.min(1, (now - catchAt) / 500);
      g.strokeStyle = `rgba(190,235,255,${(1 - sp2) * 0.8})`;
      g.lineWidth = 3;
      g.beginPath();
      g.arc(w.x, w.y, 30 + sp2 * 34, 0, Math.PI * 2);
      g.stroke();
      banner('つかまえた！', null, 150);
    } else if (mode === 'fail') {
      const w = whale();
      const t = (now - failAt) / 1000;
      const dir = w.x < W / 2 ? -1 : 1;
      drawWhale(w.x + dir * t * 70, w.y + t * 12, Math.max(0.15, 0.6 - t * 0.25));
      banner('にげられた…', 'ここに いたよ', 150);
    }

    // 浮かぶ得点
    for (const e of effects) {
      if (now < e.at) continue;
      const a = Math.min(1, (e.until - now) / 500);
      const rise = ((now - e.at) / 1500) * 20;
      g.globalAlpha = Math.max(0, a);
      g.fillStyle = e.color;
      g.font = 'bold 15px sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.strokeStyle = 'rgba(7,22,40,.75)';
      g.lineWidth = 3;
      g.strokeText(e.text, e.x, e.y - rise);
      g.fillText(e.text, e.x, e.y - rise);
      g.globalAlpha = 1;
    }

    // ラウンド開始バナー
    if (mode === 'intro' && started) {
      const sp3 = spec();
      const sub = sp3.jelly
        ? 'ピンクのニセこだま＝クラゲに ちゅうい！'
        : roundIdx === 0
          ? 'タップ＝いし。輪のかさなりが クジラのいばしょ！'
          : 'こだまの輪で クジラをさがせ！';
      banner(`ラウンド ${roundIdx + 1}`, sub, 230);
    }

    // HUD
    if (mode !== 'over') {
      g.fillStyle = 'rgba(6,18,34,.9)';
      g.fillRect(0, 0, W, HUD_H);
      g.textBaseline = 'middle';
      g.textAlign = 'left';
      g.fillStyle = '#ffffff';
      g.font = 'bold 19px sans-serif';
      g.fillText(`${score}てん`, 12, HUD_H / 2);
      g.fillStyle = '#9fc6e8';
      g.font = 'bold 15px sans-serif';
      g.fillText(`R${roundIdx + 1}/${ROUNDS.length}`, 124, HUD_H / 2);
      // のこりピン（●）
      const sp4 = spec();
      const remain = Math.max(0, sp4.maxPings - pings);
      for (let i = 0; i < sp4.maxPings; i++) {
        const warn = remain === 1 && mode === 'play' && i < remain;
        g.fillStyle = i < remain ? (warn ? '#ff7a7a' : '#7ee6ff') : 'rgba(255,255,255,.16)';
        g.beginPath();
        g.arc(196 + i * 13, HUD_H / 2, 4.6, 0, Math.PI * 2);
        g.fill();
      }
      if (remain === 1 && mode === 'play') {
        g.fillStyle = 'rgba(255,122,122,.95)';
        g.font = 'bold 12px sans-serif';
        g.textAlign = 'right';
        g.fillText('のこり1回！しんちょうに', 292, HUD_H + 14);
      }
    }

    // 結果オーバーレイ
    if (mode === 'over') {
      g.fillStyle = 'rgba(6,18,34,.8)';
      g.fillRect(0, 0, W, H);
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = '#ffffff';
      g.font = 'bold 30px sans-serif';
      g.fillText('ソナーしゅうりょう！', W / 2, H / 2 - 56);
      g.font = 'bold 26px sans-serif';
      g.fillText(`${score}てん`, W / 2, H / 2 - 12);
      g.fillStyle = '#9fe3ff';
      g.font = 'bold 16px sans-serif';
      g.fillText(`みつけた ${caught}/${ROUNDS.length}とう`, W / 2, H / 2 + 24);
      if (caught === ROUNDS.length) {
        g.fillStyle = '#ffd54a';
        g.fillText('パーフェクト！', W / 2, H / 2 + 52);
      }
    }
  }

  draw(ctx.now());
  setData(ctx.now());

  return {
    start() {
      started = true;
      beginRound(0, ctx.now());
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
