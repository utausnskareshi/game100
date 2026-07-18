// =============================================================
// くるくるおすしキャッチ（No.69）: ちゅうもんの おすしを ベルトから キャッチ！
// =============================================================
// - ベルトを右から左へ皿が流れる。注文パネル（2〜3品）にある皿だけをタップで取る。
//   注文がそろうと ボーナス＋つぎの注文。ちがう皿は コンボが切れるだけ（減点なし）。
//   たまに流れる 金の皿は いつでも大得点。75秒でおしまい。
// - 出現抽選・速度・注文は logic.ts（純ロジック・rng注入。注文の品を55%優先＝詰まらない）。
// - 全画面 Canvas・onTap のみ。時間は ctx.now 期限方式・setTimeout 不使用。
// - import してよいのは game-api（types / helpers）と、このフォルダ内（logic）だけ
import type { GameContext, IGame } from '../../game-api/types';
import {
  GOLD_PTS,
  GRAB_PTS,
  ORDER_GAP_MS,
  ORDER_PTS,
  SESSION_MS,
  SUSHI,
  beltSpeed,
  comboBonus,
  makeOrder,
  rollPlate,
  spawnInterval,
} from './logic';

const W = 360;
const H = 640;
const HUD_H = 44;
const BELT_Y = 372; // 皿の中心
const PLATE_R = 30;
const TAP_R = 36;
const END_DELAY = 1700;
const SCORE_HI = 900;

type Mode = 'play' | 'over';

interface Plate {
  x: number;
  type: number;
  gold: boolean;
  shakeUntil: number;
}

export function createGame(ctx: GameContext): IGame {
  const cv = ctx.canvas2d({ design: { w: W, h: H } });
  const g = cv.ctx;

  let mode: Mode = 'play';
  let hostPaused = false;
  let t0 = 0;
  let plates: Plate[] = [];
  let orderTypes: number[] = [];
  let orderFilled: boolean[] = [];
  let orderNo = 0;
  let ordersDone = 0;
  let nextOrderAt = 0;
  let nextSpawnAt = 0;
  let combo = 0;
  let wrongTaps = 0;
  let goldGot = 0;
  let score = 0;
  let beltShift = 0; // ベルト模様のスクロール量
  let endAt = 0;
  let ended = false;
  let popup: { text: string; x: number; y: number; until: number } | null = null;

  function addScore(n: number): void {
    score += n;
    if (score >= SCORE_HI) ctx.achieve('score-hi');
  }

  const needs = (): number[] => orderTypes.filter((_t, i) => !orderFilled[i]);

  function newOrder(now: number): void {
    orderTypes = makeOrder(orderNo, ctx.random);
    orderFilled = orderTypes.map(() => false);
    orderNo++;
    nextOrderAt = 0;
    void now;
  }

  function showPopup(text: string, x: number, y: number, now: number): void {
    popup = { text, x, y, until: now + 750 };
  }

  // ---- 入力（皿をタップ）----
  const offTap = ctx.input.onTap((p) => {
    if (hostPaused || mode !== 'play') return;
    const l = cv.toLocal(p);
    const now = ctx.now();
    // いちばん近い皿
    let best = -1;
    let bestD = TAP_R;
    for (let i = 0; i < plates.length; i++) {
      const pl = plates[i]!;
      const d = Math.max(Math.abs(pl.x - l.x), Math.abs(BELT_Y - l.y));
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best < 0) return;
    const pl = plates[best]!;
    if (pl.gold) {
      addScore(GOLD_PTS);
      goldGot++;
      ctx.achieve('first-grab'); // 「はじめて皿をキャッチした」は金の皿でも成立
      ctx.achieve('gold-plate');
      showPopup(`+${GOLD_PTS}`, pl.x, BELT_Y - 46, now);
      plates.splice(best, 1);
      ctx.sfx('powerup');
      ctx.haptic('medium');
      return;
    }
    const slot = orderTypes.findIndex((t, i) => t === pl.type && !orderFilled[i]);
    if (slot >= 0) {
      orderFilled[slot] = true;
      combo++;
      const pts = GRAB_PTS + comboBonus(combo);
      addScore(pts);
      ctx.achieve('first-grab');
      if (combo >= 8) ctx.achieve('combo-8');
      showPopup(`+${pts}`, pl.x, BELT_Y - 46, now);
      plates.splice(best, 1);
      ctx.sfx('success');
      ctx.haptic('light');
      if (orderFilled.every(Boolean)) {
        ordersDone++;
        addScore(ORDER_PTS);
        if (ordersDone >= 5) {
          ctx.achieve('order-5');
          if (wrongTaps === 0) ctx.achieve('no-wrong');
        }
        showPopup(`ちゅうもんコンプ +${ORDER_PTS}`, W / 2, 150, now);
        orderTypes = [];
        orderFilled = [];
        nextOrderAt = now + ORDER_GAP_MS;
        ctx.sfx('combo');
        ctx.haptic('success');
      }
    } else {
      // 注文にない皿: コンボが切れるだけ（減点なし・皿はのこる）
      combo = 0;
      wrongTaps++;
      pl.shakeUntil = now + 420;
      ctx.sfx('fail');
      ctx.haptic('error');
    }
  });

  // ---- 毎フレーム ----
  const offFrame = ctx.onFrame((dt) => {
    if (hostPaused) return;
    const now = ctx.now();
    const t = now - t0;
    if (mode === 'play') {
      // 注文の補充
      if (orderTypes.length === 0 && nextOrderAt > 0 && now >= nextOrderAt) newOrder(now);
      // 皿の出現
      if (now >= nextSpawnAt) {
        const roll = rollPlate(needs(), ctx.random);
        plates.push({ x: W + PLATE_R + 6, type: roll.type, gold: roll.gold, shakeUntil: 0 });
        nextSpawnAt = now + spawnInterval(t);
      }
      // ベルト移動
      const v = beltSpeed(t) * dt;
      beltShift += v;
      for (const pl of plates) pl.x -= v;
      plates = plates.filter((pl) => pl.x > -PLATE_R - 10);
      // 時間切れ
      if (t >= SESSION_MS) {
        mode = 'over';
        endAt = now + END_DELAY;
        ctx.sfx('medal');
      }
    } else if (mode === 'over') {
      if (!ended && now >= endAt) {
        ended = true;
        ctx.end({ score });
        return;
      }
    }
    draw(now);
    setData(now);
  });

  function setData(now: number): void {
    if (!import.meta.env.DEV) return;
    const r = ctx.root as HTMLElement;
    r.dataset.mode = mode;
    r.dataset.score = String(score);
    r.dataset.combo = String(combo);
    r.dataset.orders = String(ordersDone);
    r.dataset.wrong = String(wrongTaps);
    r.dataset.gold = String(goldGot);
    r.dataset.timeleft = String(Math.max(0, Math.round(SESSION_MS - (now - t0))));
    r.dataset.order = orderTypes.map((t, i) => `${t}:${orderFilled[i] ? 1 : 0}`).join(',');
    r.dataset.plates = plates.map((pl) => `${Math.round(pl.x)}:${pl.type}:${pl.gold ? 1 : 0}`).join(';');
  }

  // ---- 描画 ----
  function roundRect(x: number, y: number, w: number, h: number, rad: number): void {
    const rr = Math.min(rad, w / 2, h / 2);
    g.beginPath();
    g.moveTo(x + rr, y);
    g.arcTo(x + w, y, x + w, y + h, rr);
    g.arcTo(x + w, y + h, x, y + h, rr);
    g.arcTo(x, y + h, x, y, rr);
    g.arcTo(x, y, x + w, y, rr);
    g.closePath();
  }

  function drawSushi(x: number, y: number, type: number, scale: number): void {
    const def = SUSHI[type]!;
    g.save();
    g.translate(x, y);
    g.scale(scale, scale);
    if (def.roll) {
      // のりまき（黒い丸＋白い中身）
      g.fillStyle = def.color;
      g.beginPath();
      g.arc(0, -6, 13, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = def.hi;
      g.beginPath();
      g.arc(0, -6, 7, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#4cae52';
      g.beginPath();
      g.arc(0, -6, 3, 0, Math.PI * 2);
      g.fill();
    } else {
      // しゃり
      g.fillStyle = '#fbfbf4';
      g.beginPath();
      g.ellipse(0, -2, 15, 8, 0, 0, Math.PI * 2);
      g.fill();
      // ネタ
      g.fillStyle = def.color;
      g.beginPath();
      g.ellipse(0, -9, 16, 7, -0.08, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = def.hi;
      g.beginPath();
      g.ellipse(-4, -11, 6, 2.4, -0.2, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
  }

  function drawPlate(pl: Plate, now: number): void {
    const shake = now < pl.shakeUntil ? Math.sin(now / 22) * 3 : 0;
    const x = pl.x + shake;
    // 皿
    g.fillStyle = pl.gold ? '#f2c84b' : '#e8ecf2';
    g.beginPath();
    g.ellipse(x, BELT_Y + 8, PLATE_R, 11, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = pl.gold ? '#ffe89a' : '#f8fafc';
    g.beginPath();
    g.ellipse(x, BELT_Y + 6, PLATE_R - 5, 8, 0, 0, Math.PI * 2);
    g.fill();
    if (pl.gold) {
      g.font = '13px sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('✨', x + 18, BELT_Y - 18);
    }
    drawSushi(x, BELT_Y, pl.type, 1);
  }

  function draw(now: number): void {
    const t = now - t0;
    // おみせの背景
    g.fillStyle = '#f6ead2';
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#e8d8b8';
    g.fillRect(0, 0, W, 200);
    // のれん
    g.fillStyle = '#3a5a8c';
    g.fillRect(0, 48, W, 34);
    g.fillStyle = '#fff';
    g.font = 'bold 15px sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('〜 くるくる おすし 〜', W / 2, 65);

    // 注文パネル（お品書き札）
    g.fillStyle = '#fffdf4';
    roundRect(24, 96, W - 48, 108, 12);
    g.fill();
    g.strokeStyle = '#c8a878';
    g.lineWidth = 3;
    roundRect(24, 96, W - 48, 108, 12);
    g.stroke();
    g.fillStyle = '#8a5a2a';
    g.font = 'bold 15px sans-serif';
    g.textAlign = 'left';
    g.fillText('📋 ちゅうもん', 38, 116);
    if (orderTypes.length === 0) {
      g.fillStyle = '#b0a080';
      g.font = 'bold 14px sans-serif';
      g.textAlign = 'center';
      g.fillText('つぎの ちゅうもんを かくにん中…', W / 2, 160);
    } else {
      const n = orderTypes.length;
      const startX = W / 2 - ((n - 1) * 92) / 2;
      for (let i = 0; i < n; i++) {
        const x = startX + i * 92;
        const filled = orderFilled[i]!;
        g.fillStyle = filled ? 'rgba(102,187,106,.18)' : 'rgba(0,0,0,.045)';
        roundRect(x - 38, 126, 76, 66, 10);
        g.fill();
        drawSushi(x, 162, orderTypes[i]!, 1.15);
        g.font = 'bold 11px sans-serif';
        g.textAlign = 'center';
        g.fillStyle = '#6a5a40';
        g.fillText(SUSHI[orderTypes[i]!]!.name, x, 186);
        if (filled) {
          g.font = 'bold 30px sans-serif';
          g.fillStyle = '#43a047';
          g.fillText('✔', x + 22, 140);
        }
      }
    }

    // ベルト
    g.fillStyle = '#9aa2ae';
    g.fillRect(0, BELT_Y - 26, W, 64);
    g.fillStyle = '#7e8794';
    for (let x = -60 + (beltShift % 60); x < W + 60; x += 60) {
      g.fillRect(x, BELT_Y - 26, 30, 64);
    }
    g.fillStyle = 'rgba(255,255,255,.25)';
    g.fillRect(0, BELT_Y - 26, W, 5);

    // 皿
    for (const pl of plates) drawPlate(pl, now);

    // カウンター（下）
    g.fillStyle = '#b98a4a';
    g.fillRect(0, BELT_Y + 40, W, H - BELT_Y - 40);
    g.fillStyle = '#a8763a';
    g.fillRect(0, BELT_Y + 40, W, 8);
    g.fillStyle = 'rgba(90,50,10,.65)';
    g.font = 'bold 14px sans-serif';
    g.textAlign = 'center';
    g.fillText('ちゅうもんの おすしを タップで キャッチ！', W / 2, 520);
    g.font = 'bold 12px sans-serif';
    g.fillText('（ちがう皿は コンボが きれちゃう）', W / 2, 544);

    // ポップアップ
    if (popup && now < popup.until) {
      const p = (popup.until - now) / 750;
      g.globalAlpha = Math.min(1, p * 2);
      g.fillStyle = '#e05a2a';
      g.font = 'bold 19px sans-serif';
      g.textAlign = 'center';
      g.fillText(popup.text, popup.x, popup.y - (1 - p) * 22);
      g.globalAlpha = 1;
    }

    // HUD
    g.fillStyle = 'rgba(40,28,10,.85)';
    g.fillRect(0, 0, W, HUD_H);
    g.textBaseline = 'middle';
    g.textAlign = 'left';
    g.fillStyle = '#fff';
    g.font = 'bold 19px sans-serif';
    g.fillText(`${score}てん`, 12, HUD_H / 2);
    const remain = Math.max(0, Math.ceil((SESSION_MS - t) / 1000));
    g.fillStyle = remain <= 10 ? '#ff9a8a' : '#ffe0b0';
    g.font = 'bold 17px sans-serif';
    g.fillText(`⏱${remain}`, 122, HUD_H / 2);
    if (combo >= 2) {
      g.fillStyle = '#ffd76a';
      g.fillText(`🔥×${combo}`, 196, HUD_H / 2);
    }

    if (mode === 'over') {
      g.fillStyle = 'rgba(30,20,8,.72)';
      g.fillRect(0, 0, W, H);
      g.fillStyle = '#fff';
      g.textAlign = 'center';
      g.font = 'bold 30px sans-serif';
      g.fillText('へいてん〜！', W / 2, H / 2 - 40);
      g.font = 'bold 22px sans-serif';
      g.fillText(`ちゅうもん ${ordersDone}回 / ${score}てん`, W / 2, H / 2 + 6);
    }
  }

  draw(0);
  setData(0);

  return {
    start() {
      t0 = ctx.now();
      nextSpawnAt = t0 + 600;
      newOrder(t0);
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
      offTap();
      offFrame();
    },
  };
}
