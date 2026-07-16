// =============================================================
// マグネットスイング（No.67）: 磁石にくっついてスイング→はなしてジャンプ！
// =============================================================
// - ながおし＝いちばん近い前方の磁石にビームがつながり振り子スイング
//   （ホールド中は自動でこいで振れが育つ）。はなすと慣性でジャンプ。
// - 海に落ちたら1発でおわり（きょり＋⭐がスコア）。カメラは前にだけ進む。
// - 物理・コース生成は logic.ts（純ロジック・rng注入・到達可能性はソルバで実証）。
// - 全画面 Canvas・onDown/onUp のみ（onMove 非購読）。ctx.now 期限方式・setTimeout 不使用。
// - import してよいのは game-api（types / helpers）と、このフォルダ内（logic）だけ
import type { GameContext, IGame } from '../../game-api/types';
import {
  type Anchor,
  CEIL_Y,
  FIRST_ANCHOR,
  GRAV,
  PLATFORM,
  START_POS,
  STAR_PTS,
  type Swing,
  WATER_Y,
  attach,
  metersOf,
  nextAnchor,
  pickAnchor,
  posOf,
  starFor,
  swingStep,
  velOf,
} from './logic';

const W = 360;
const H = 640;
const HUD_H = 44;
const STAR_R = 30;
// 1回のジャンプ(はなす→つかむ)の横とび距離。ボット実測max119px→110で「ねらえば取れる」に較正
const FLING_PX = 110;
const SCORE_HI = 400;
const DIST_1 = 100;
const DIST_2 = 250;

type Mode = 'pre' | 'swing' | 'free' | 'over';

export function createGame(ctx: GameContext): IGame {
  const cv = ctx.canvas2d({ design: { w: W, h: H } });
  const g = cv.ctx;

  let mode: Mode = 'pre';
  let hostPaused = false;
  let px = START_POS.x;
  let py = START_POS.y;
  let vx = 0;
  let vy = 0;
  let sw: Swing | null = null;
  let curIdx = -1;
  let anchors: Anchor[] = [FIRST_ANCHOR];
  let stars: { x: number; y: number; got: boolean }[] = [];
  let camX = 0;
  let maxX = START_POS.x;
  let starsGot = 0;
  let score = 0;
  let attaches = 0;
  let releaseX = 0;
  let releasedAt = -1;
  let maxFling = 0;
  let endAt = 0;
  let ended = false;
  let acc = 0; // 物理サブステップ用
  let holdId: number | null = null; // スイング中の指のID（2本目の指の up で誤リリースしない）

  function ensureCourse(): void {
    while (anchors[anchors.length - 1]!.x < maxX + 900) {
      const prev = anchors[anchors.length - 1]!;
      const a = nextAnchor(prev, ctx.random);
      anchors.push(a);
      stars.push({ ...starFor(prev, a, ctx.random), got: false });
    }
  }

  function updateScore(): void {
    const s = metersOf(maxX) + starsGot * STAR_PTS;
    if (s === score) return;
    score = s;
    const m = metersOf(maxX);
    if (m >= DIST_1) ctx.achieve('dist-100');
    if (m >= DIST_2) ctx.achieve('dist-250');
    if (score >= SCORE_HI) ctx.achieve('score-hi');
  }

  function die(now: number): void {
    if (mode === 'over') return;
    if (import.meta.env.DEV) {
      (ctx.root as HTMLElement).dataset.deathcause = `mode=${mode},px=${px.toFixed(1)},py=${py.toFixed(1)},camX=${camX.toFixed(1)}`;
    }
    mode = 'over';
    endAt = now + 1800;
    ctx.sfx('fail');
    ctx.haptic('error');
  }

  function tryAttach(): void {
    const ai = pickAnchor(px, py, anchors, curIdx + 1);
    if (ai < 0) return;
    sw = attach(px, py, vx, vy, anchors[ai]!);
    if (mode === 'free' && releasedAt >= 0) {
      const fling = px - releaseX;
      if (fling > maxFling) maxFling = fling;
      if (fling >= FLING_PX) ctx.achieve('big-fling');
    }
    curIdx = ai;
    attaches++;
    if (attaches >= 2) ctx.achieve('first-fly');
    mode = 'swing';
    ctx.sfx('tap');
    ctx.haptic('light');
  }

  // ---- 入力 ----
  const offDown = ctx.input.onDown((p) => {
    if (hostPaused || mode === 'over') return;
    if (mode === 'pre' || mode === 'free') {
      tryAttach();
      if ((mode as Mode) === 'swing') holdId = p.id;
    }
  });
  const offUp = ctx.input.onUp((pi) => {
    if (hostPaused || mode !== 'swing' || !sw) return;
    if (holdId !== null && pi.id !== holdId) return; // スイングしている指だけが はなせる
    holdId = null;
    const p = posOf(sw);
    const v = velOf(sw);
    px = p.x;
    py = p.y;
    vx = v.vx;
    vy = v.vy;
    sw = null;
    mode = 'free';
    releaseX = px;
    releasedAt = ctx.now();
    ctx.sfx('powerup');
  });

  // ---- 毎フレーム ----
  const offFrame = ctx.onFrame((dt) => {
    if (hostPaused) return;
    const now = ctx.now();
    if (mode === 'swing' || mode === 'free') {
      acc += Math.min(dt, 0.05);
      const STEP = 1 / 120;
      while (acc >= STEP) {
        acc -= STEP;
        if (mode === 'swing' && sw) {
          swingStep(sw, STEP, true);
          const p = posOf(sw);
          px = p.x;
          py = p.y;
        } else if (mode === 'free') {
          vy += GRAV * STEP;
          px += vx * STEP;
          py += vy * STEP;
          if (py < CEIL_Y) {
            py = CEIL_Y;
            if (vy < 0) vy = 0;
          }
        }
        if (px > maxX) maxX = px;
        // ⭐回収
        for (const st of stars) {
          if (!st.got && Math.abs(st.x - px) < STAR_R && Math.abs(st.y - py) < STAR_R) {
            st.got = true;
            starsGot++;
            if (starsGot >= 8) ctx.achieve('star-8');
            ctx.sfx('combo');
            ctx.haptic('light');
          }
        }
        // 落下・置き去り（置き去り死はフリー時のみ。スイング中はロープが
        // つないでいるので、大きなバックスイングで画面左へ振れても死なない）
        if (py > WATER_Y || (mode === 'free' && px < camX - 40)) {
          die(now);
          break;
        }
      }
      camX = Math.max(camX, px - 130);
      ensureCourse();
      updateScore();
    } else if (mode === 'over') {
      if (!ended && now >= endAt) {
        ended = true;
        ctx.end({ score });
        return;
      }
    }
    draw(now);
    setData();
  });

  function setData(): void {
    if (!import.meta.env.DEV) return;
    const r = ctx.root as HTMLElement;
    r.dataset.mode = mode;
    r.dataset.x = px.toFixed(1);
    r.dataset.y = py.toFixed(1);
    r.dataset.maxx = maxX.toFixed(1);
    r.dataset.meters = String(metersOf(maxX));
    r.dataset.stars = String(starsGot);
    r.dataset.score = String(score);
    r.dataset.aidx = String(curIdx);
    r.dataset.attaches = String(attaches);
    r.dataset.th = sw ? sw.th.toFixed(3) : '';
    r.dataset.om = sw ? sw.om.toFixed(3) : '';
    r.dataset.maxfling = maxFling.toFixed(0);
    r.dataset.anchors = anchors
      .slice(Math.max(0, curIdx), curIdx + 5)
      .map((a, i) => `${Math.max(0, curIdx) + i}:${Math.round(a.x)}:${Math.round(a.y)}`)
      .join(';');
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

  function draw(now: number): void {
    // 空
    g.fillStyle = '#8ed4f0';
    g.fillRect(0, 0, W, 240);
    g.fillStyle = '#a8def4';
    g.fillRect(0, 240, W, 180);
    g.fillStyle = '#bfe8f8';
    g.fillRect(0, 420, W, WATER_Y - 420);
    // 雲（パララックス・決定的）
    g.fillStyle = 'rgba(255,255,255,.8)';
    for (let i = 0; i < 6; i++) {
      const wx = i * 260 + 130;
      const sx = ((wx - camX * 0.4) % (W + 200) + W + 200) % (W + 200) - 100;
      const wy = 70 + ((i * 53) % 150);
      g.beginPath();
      g.ellipse(sx, wy, 34, 13, 0, 0, Math.PI * 2);
      g.ellipse(sx + 20, wy - 8, 22, 11, 0, 0, Math.PI * 2);
      g.fill();
    }
    // 海
    g.fillStyle = '#2a6fb8';
    g.fillRect(0, WATER_Y, W, H - WATER_Y);
    g.fillStyle = 'rgba(255,255,255,.5)';
    for (let i = 0; i < 10; i++) {
      const wx = i * 90;
      const sx = ((wx - camX * 0.9) % (W + 90) + W + 90) % (W + 90) - 45;
      g.beginPath();
      g.arc(sx, WATER_Y + 3 + Math.sin(now / 400 + i) * 2, 12, Math.PI, 0);
      g.stroke();
    }

    const toS = (wx: number): number => wx - camX;

    // 発射台
    if (toS(PLATFORM.x + PLATFORM.w) > -20) {
      g.fillStyle = '#8a5a3a';
      g.fillRect(toS(PLATFORM.x), PLATFORM.y, PLATFORM.w, 42);
      g.fillStyle = '#a8744c';
      g.fillRect(toS(PLATFORM.x), PLATFORM.y, PLATFORM.w, 8);
    }

    // ⭐
    g.font = '22px sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const st of stars) {
      const sx = toS(st.x);
      if (st.got || sx < -30 || sx > W + 30) continue;
      g.fillText('⭐', sx, st.y);
    }

    // 磁石アンカー
    const pickable = mode === 'free' || mode === 'pre' ? pickAnchor(px, py, anchors, curIdx + 1) : -1;
    anchors.forEach((a, i) => {
      const sx = toS(a.x);
      if (sx < -40 || sx > W + 40) return;
      // つり下げワイヤー
      g.strokeStyle = 'rgba(90,74,106,.5)';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(sx, 0);
      g.lineTo(sx, a.y - 12);
      g.stroke();
      g.fillStyle = '#d3455e';
      g.beginPath();
      g.arc(sx, a.y, 13, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#f0f0f4';
      g.beginPath();
      g.arc(sx, a.y, 6, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = 'rgba(0,0,0,.25)';
      g.lineWidth = 2;
      g.beginPath();
      g.arc(sx, a.y, 13, 0, Math.PI * 2);
      g.stroke();
      if (i === pickable) {
        g.strokeStyle = `rgba(255,220,90,${0.65 + 0.3 * Math.sin(now / 140)})`;
        g.lineWidth = 3;
        g.setLineDash([5, 5]);
        g.beginPath();
        g.arc(sx, a.y, 20, 0, Math.PI * 2);
        g.stroke();
        g.setLineDash([]);
      }
    });

    // ビーム
    if (mode === 'swing' && sw) {
      g.strokeStyle = '#ffd76a';
      g.lineWidth = 3.5;
      g.beginPath();
      g.moveTo(toS(sw.ax), sw.ay);
      g.lineTo(toS(px), py);
      g.stroke();
      g.strokeStyle = 'rgba(255,255,255,.65)';
      g.lineWidth = 1.4;
      g.beginPath();
      g.moveTo(toS(sw.ax), sw.ay);
      g.lineTo(toS(px), py);
      g.stroke();
    }

    // プレイヤー（まぐねっとモンキー）
    const sxp = toS(px);
    g.fillStyle = '#ffb03c';
    g.beginPath();
    g.arc(sxp, py, 15, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#ffd9a0';
    g.beginPath();
    g.ellipse(sxp, py + 3, 9.5, 8, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#3a2a18';
    g.beginPath();
    g.arc(sxp - 4.5, py - 2, 2, 0, Math.PI * 2);
    g.arc(sxp + 4.5, py - 2, 2, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#3a2a18';
    g.lineWidth = 1.5;
    g.beginPath();
    g.arc(sxp, py + 4.5, 3.4, 0.15 * Math.PI, 0.85 * Math.PI);
    g.stroke();
    // しっぽ
    g.strokeStyle = '#e8983c';
    g.lineWidth = 3;
    g.beginPath();
    g.arc(sxp - 14, py + 8, 7, Math.PI * 0.2, Math.PI * 1.2);
    g.stroke();

    // HUD
    g.fillStyle = '#0c1426';
    g.fillRect(0, 0, W, HUD_H);
    g.textAlign = 'left';
    g.fillStyle = '#fff';
    g.font = 'bold 19px sans-serif';
    g.fillText(`${score}てん`, 12, HUD_H / 2);
    g.fillStyle = '#9fb2e8';
    g.font = 'bold 15px sans-serif';
    g.fillText(`${metersOf(maxX)}m`, 132, HUD_H / 2);
    g.fillText(`⭐${starsGot}`, 216, HUD_H / 2);

    // メッセージ
    g.textAlign = 'center';
    g.fillStyle = 'rgba(20,40,70,.75)';
    g.font = 'bold 13px sans-serif';
    g.fillText('ながおし: 🧲にくっつく ／ はなす: ジャンプ！', W / 2, 612);

    if (mode === 'pre') {
      g.fillStyle = 'rgba(5,10,26,.55)';
      roundRect(48, 236, W - 96, 96, 16);
      g.fill();
      g.fillStyle = '#fff';
      g.font = 'bold 21px sans-serif';
      g.fillText('ながおしで 🧲に くっつこう！', W / 2, 276);
      g.fillStyle = '#cfd8ff';
      g.font = 'bold 14px sans-serif';
      g.fillText('ゆらして いきおいを つけて、はなす！', W / 2, 308);
    } else if (mode === 'over') {
      g.fillStyle = 'rgba(5,10,26,.62)';
      roundRect(48, 236, W - 96, 108, 16);
      g.fill();
      g.fillStyle = '#fff';
      g.font = 'bold 28px sans-serif';
      g.fillText('おっこちた…', W / 2, 280);
      g.fillStyle = '#cfd8ff';
      g.font = 'bold 15px sans-serif';
      g.fillText(`${metersOf(maxX)}m とんだ！`, W / 2, 318);
    }
  }

  draw(0);

  return {
    start() {
      ensureCourse();
      draw(ctx.now());
      setData();
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
