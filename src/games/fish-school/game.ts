// =============================================================
// おさかなリーダー（No.89）: ドラッグで先導、24ひきの群れを90秒まもりぬくアクション
// =============================================================
// - ドラッグ＝リーダーが指をおいかける。群れはボイド（リーダー吸引＋分離＋
//   速度合わせ）でついてくる＝急いで曲がると群れがのびて危ない。
// - 網（すき間をくぐらせる）・フグの突進・うずしお。すべて1秒前に予告。
//   リーダーは小さいのですりぬける＝つかまるのは群れ（仲間が財産）。
// - タイムライン・判定は logic.ts（rng注入＝完全決定論・理不尽なし保証）。
// - 全画面 Canvas・時間は ctx.now 期限方式・setTimeout 不使用。
// - import してよいのは game-api（types / helpers）と、このフォルダ内（logic）だけ
import type { GameContext, IGame, PointerInfo } from '../../game-api/types';
import {
  DURATION_MS,
  FOLLOWERS,
  H,
  HUD_H,
  NET_GAP,
  NET_TELEGRAPH_MS,
  type NetEvent,
  PLANKTON_PTS,
  SCORE_HI,
  TELEGRAPH_MS,
  W,
  WHIRL_KILL_R,
  WHIRL_PULL,
  WHIRL_R,
  finalScore,
  inNetGap,
  makeTimeline,
  netCatch,
  netY,
  pufferCatch,
  pufferX,
  whirlActive,
} from './logic';

const END_DELAY = 2400;
const EAT_R = 18;
const KEEP_TH = 20;
const EAT_TH = 30;
const NET_CLEAN_TH = 5;

type Mode = 'swim' | 'over';

interface Fish {
  x: number;
  y: number;
  vx: number;
  vy: number;
  alive: boolean;
  /** 見た目のばらつき（決定論: index 由来） */
  wob: number;
}

interface Dot {
  x: number;
  y: number;
  eaten: boolean;
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

  const timeline = makeTimeline(ctx.random);

  let mode: Mode = 'swim';
  let started = false;
  let hostPaused = false;
  let ended = false;
  let score = 0;
  let eaten = 0;
  let cleanNets = 0;
  let lost = 0;
  let phaseUntil = 0;
  let effects: FloatFx[] = [];
  let lastEvent = '';

  const leader = { x: 180, y: 340, vx: 0, vy: 0 };
  const fish: Fish[] = [];
  for (let i = 0; i < FOLLOWERS; i++) {
    const a = (i / FOLLOWERS) * Math.PI * 2;
    const r = 22 + (i % 3) * 12;
    fish.push({ x: 180 + Math.cos(a) * r, y: 360 + Math.sin(a) * r, vx: 0, vy: 0, alive: true, wob: (i * 0.77) % (Math.PI * 2) });
  }
  /** 出現済みプランクトン（クラスタ→4つぶ） */
  const dots: Dot[] = [];
  let planktonSpawned = 0;
  /** 網ごとの「この網で1ぴきでもつかまったか」 */
  const netDirty = new Map<NetEvent, boolean>();

  // ドラッグ（最初の指を追う）
  let dragId = -1;
  let dragPt: { x: number; y: number } | null = null;

  const aliveCount = (): number => fish.filter((f) => f.alive).length;

  const offDown = ctx.input.onDown((p: PointerInfo) => {
    if (dragId !== -1) return;
    dragId = p.id;
    dragPt = cv.toLocal(p);
  });
  const offMove = ctx.input.onMove((p: PointerInfo) => {
    if (p.id !== dragId) return;
    dragPt = cv.toLocal(p);
  });
  const offUp = ctx.input.onUp((p: PointerInfo) => {
    if (p.id !== dragId) return;
    dragId = -1;
    dragPt = null;
  });

  function loseFish(f: Fish, now: number, why: string): void {
    f.alive = false;
    lost++;
    effects.push({ x: f.x, y: f.y - 10, text: '💦', color: '#cfe8ff', at: now, until: now + 700 });
    ctx.sfx('fail');
    ctx.haptic('light');
    lastEvent = `lost:${why}:${aliveCount()}`;
  }

  function finish(now: number): void {
    mode = 'over';
    phaseUntil = now + END_DELAY;
    const survivors = aliveCount();
    const pts = finalScore(survivors, eaten);
    score = pts;
    if (score >= SCORE_HI) ctx.achieve('score-hi');
    if (survivors >= 1) ctx.achieve('first-swim');
    if (survivors >= KEEP_TH) ctx.achieve('keep-20');
    if (survivors === FOLLOWERS) ctx.achieve('no-loss');
    ctx.sfx('medal');
    lastEvent = `finish:${survivors}:${pts}`;
  }

  // ---- 毎フレーム ----
  const offFrame = ctx.onFrame((dt: number) => {
    if (hostPaused) return;
    const now = ctx.now();
    if (mode === 'swim' && started) {
      // リーダー: 指をおいかける
      if (dragPt) {
        const dx = dragPt.x - leader.x;
        const dy = dragPt.y - leader.y;
        leader.vx = Math.max(-260, Math.min(260, dx * 6));
        leader.vy = Math.max(-260, Math.min(260, dy * 6));
      } else {
        leader.vx *= Math.exp(-3 * dt);
        leader.vy *= Math.exp(-3 * dt);
      }
      leader.x = Math.max(10, Math.min(W - 10, leader.x + leader.vx * dt));
      leader.y = Math.max(HUD_H + 12, Math.min(H - 10, leader.y + leader.vy * dt));

      // うずしお（リーダーも6割引っぱられる）
      for (const hz of timeline.hazards) {
        if (hz.type === 'whirl' && whirlActive(hz, now)) {
          const pull = (fx: number, fy: number): { ax: number; ay: number } => {
            const dx = hz.x - fx;
            const dy = hz.y - fy;
            const d = Math.hypot(dx, dy);
            if (d > WHIRL_R || d < 1) return { ax: 0, ay: 0 };
            const s = WHIRL_PULL * (1 - d / WHIRL_R);
            return { ax: (dx / d) * s, ay: (dy / d) * s };
          };
          const lp = pull(leader.x, leader.y);
          leader.x += lp.ax * 0.6 * dt;
          leader.y += lp.ay * 0.6 * dt;
          for (const f of fish) {
            if (!f.alive) continue;
            const fp = pull(f.x, f.y);
            f.vx += fp.ax * dt * 2.2;
            f.vy += fp.ay * dt * 2.2;
            if (Math.hypot(f.x - hz.x, f.y - hz.y) < WHIRL_KILL_R) loseFish(f, now, 'whirl');
          }
        }
      }

      // 群れ（ボイド: リーダー吸引＋分離＋速度合わせ。順序固定＝決定論）
      for (let i = 0; i < fish.length; i++) {
        const f = fish[i]!;
        if (!f.alive) continue;
        let ax = (leader.x - f.x) * 2.3;
        let ay = (leader.y - f.y) * 2.3;
        ax += (leader.vx - f.vx) * 0.7;
        ay += (leader.vy - f.vy) * 0.7;
        for (let j = 0; j < fish.length; j++) {
          if (i === j) continue;
          const o = fish[j]!;
          if (!o.alive) continue;
          const dx = f.x - o.x;
          const dy = f.y - o.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < 196 && d2 > 0.01) {
            const d = Math.sqrt(d2);
            ax += (dx / d) * (14 - d) * 26;
            ay += (dy / d) * (14 - d) * 26;
          }
        }
        f.vx += ax * dt;
        f.vy += ay * dt;
        const sp = Math.hypot(f.vx, f.vy);
        if (sp > 370) {
          f.vx = (f.vx / sp) * 370;
          f.vy = (f.vy / sp) * 370;
        }
        f.x += f.vx * dt;
        f.y += f.vy * dt;
        f.x = Math.max(6, Math.min(W - 6, f.x));
        f.y = Math.max(HUD_H + 8, Math.min(H - 6, f.y));
      }

      // 網・フグの捕獲
      for (const hz of timeline.hazards) {
        if (hz.type === 'net') {
          for (const f of fish) {
            if (f.alive && netCatch(f.x, f.y, hz, now)) {
              loseFish(f, now, 'net');
              netDirty.set(hz, true);
            }
          }
          // 網が抜けきった瞬間にクリーン判定
          const y = netY(hz, now);
          if (y === null && now > hz.at + NET_TELEGRAPH_MS + 1000 && !netDirty.has(hz)) {
            netDirty.set(hz, false);
            cleanNets++;
            if (cleanNets >= NET_CLEAN_TH) ctx.achieve('net-5');
            effects.push({ x: W / 2, y: 110, text: 'あみくぐり せいこう！', color: '#9fe3ff', at: now, until: now + 900 });
            ctx.sfx('combo');
            lastEvent = `cleannet:${cleanNets}`;
          }
        } else if (hz.type === 'puffer') {
          for (const f of fish) {
            if (f.alive && pufferCatch(f.x, f.y, hz, now)) loseFish(f, now, 'puffer');
          }
        }
      }

      // プランクトン出現＆たべる
      while (planktonSpawned < timeline.plankton.length && timeline.plankton[planktonSpawned]!.at <= now) {
        const c = timeline.plankton[planktonSpawned]!;
        for (const [ox, oy] of [
          [0, 0],
          [14, 6],
          [-12, 10],
          [4, -13],
        ] as [number, number][]) {
          dots.push({ x: c.x + ox, y: c.y + oy, eaten: false });
        }
        planktonSpawned++;
      }
      for (const d of dots) {
        if (!d.eaten && Math.hypot(d.x - leader.x, d.y - leader.y) < EAT_R) {
          d.eaten = true;
          eaten++;
          if (eaten >= EAT_TH) ctx.achieve('eat-30');
          score = eaten * PLANKTON_PTS;
          ctx.sfx('tap');
          lastEvent = `eat:${eaten}`;
        }
      }

      if (aliveCount() === 0 || now >= DURATION_MS) finish(now);
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
    const r = ctx.root as HTMLElement;
    r.dataset.mode = mode;
    r.dataset.t = (now / 1000).toFixed(1);
    r.dataset.fish = String(aliveCount());
    r.dataset.eaten = String(eaten);
    r.dataset.score = String(score);
    r.dataset.lx = leader.x.toFixed(1);
    r.dataset.ly = leader.y.toFixed(1);
    // アクティブ/直近の予告ハザード
    let hzInfo = '';
    for (const hz of timeline.hazards) {
      if (now >= hz.at && now <= hz.at + NET_TELEGRAPH_MS + 6000) {
        const teleMs = hz.type === 'net' ? NET_TELEGRAPH_MS : TELEGRAPH_MS;
        const phase = now < hz.at + teleMs ? 'tele' : 'act';
        if (hz.type === 'net') {
          const y = netY(hz, now);
          if (phase === 'tele' || y !== null) hzInfo = `net:${phase}:${hz.gapX.toFixed(0)}:${y === null ? -1 : y.toFixed(0)}`;
        } else if (hz.type === 'puffer') {
          const x = pufferX(hz, now);
          if (phase === 'tele' || x !== null) hzInfo = `puffer:${phase}:${hz.y.toFixed(0)}:${x === null ? -1 : x.toFixed(0)}`;
        } else if (whirlActive(hz, now) || phase === 'tele') {
          hzInfo = `whirl:${phase}:${hz.x.toFixed(0)}:${hz.y.toFixed(0)}`;
        }
        if (hzInfo) break;
      }
    }
    r.dataset.hz = hzInfo;
    r.dataset.cleanNets = String(cleanNets);
    const np = dots.find((d) => !d.eaten);
    r.dataset.npx = np ? np.x.toFixed(0) : '-1';
    r.dataset.npy = np ? np.y.toFixed(0) : '-1';
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
    const sea = og.createLinearGradient(0, 0, 0, H);
    sea.addColorStop(0, '#1a5b8a');
    sea.addColorStop(0.6, '#12466e');
    sea.addColorStop(1, '#0c3050');
    og.fillStyle = sea;
    og.fillRect(0, 0, W, H);
    og.fillStyle = 'rgba(180,225,255,.07)';
    for (const [x0, w0] of [
      [50, 34],
      [180, 24],
      [280, 40],
    ] as [number, number][]) {
      og.beginPath();
      og.moveTo(x0, HUD_H);
      og.lineTo(x0 + w0, HUD_H);
      og.lineTo(x0 + w0 + 30, H);
      og.lineTo(x0 - 30, H);
      og.closePath();
      og.fill();
    }
    og.fillStyle = '#0e3a5e';
    og.beginPath();
    og.moveTo(0, H);
    og.lineTo(0, H - 26);
    og.quadraticCurveTo(90, H - 48, 180, H - 28);
    og.quadraticCurveTo(270, H - 12, W, H - 34);
    og.lineTo(W, H);
    og.closePath();
    og.fill();
    og.strokeStyle = '#1f6a52';
    og.lineWidth = 3;
    og.lineCap = 'round';
    for (const [bx, bh, sw] of [
      [40, 30, 7],
      [48, 22, -5],
      [300, 34, 8],
      [310, 24, -6],
    ] as [number, number, number][]) {
      og.beginPath();
      og.moveTo(bx, H - 20);
      og.quadraticCurveTo(bx + sw, H - 20 - bh * 0.6, bx + sw * 0.4, H - 20 - bh);
      og.stroke();
    }
  }
  bakeStatic();

  function drawFish(x: number, y: number, ang: number, size: number, body: string, now: number, wob: number): void {
    g.save();
    g.translate(x, y);
    g.rotate(ang);
    const tail = Math.sin(now / 90 + wob) * 0.5;
    g.fillStyle = body;
    g.beginPath();
    g.ellipse(0, 0, size, size * 0.55, 0, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.moveTo(-size * 0.8, 0);
    g.lineTo(-size * 1.5, -size * 0.5 + tail * size * 0.6);
    g.lineTo(-size * 1.5, size * 0.5 + tail * size * 0.6);
    g.closePath();
    g.fill();
    g.fillStyle = '#173048';
    g.beginPath();
    g.arc(size * 0.45, -size * 0.12, size * 0.13, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }

  function draw(now: number): void {
    g.drawImage(off, 0, 0, W, H);

    // プランクトン
    for (const d of dots) {
      if (d.eaten) continue;
      const p = 0.7 + 0.3 * Math.sin(now / 260 + d.x);
      g.fillStyle = `rgba(140,230,140,${p.toFixed(2)})`;
      g.beginPath();
      g.arc(d.x, d.y, 3.4, 0, Math.PI * 2);
      g.fill();
    }

    // ハザード
    for (const hz of timeline.hazards) {
      if (now < hz.at || now > hz.at + NET_TELEGRAPH_MS + 7000) continue;
      const tele = now < hz.at + (hz.type === 'net' ? NET_TELEGRAPH_MS : TELEGRAPH_MS);
      if (hz.type === 'net') {
        const yy = tele ? (hz.down ? -6 : H + 6) : netY(hz, now);
        if (tele) {
          const blink = Math.sin(now / 90) > 0;
          if (blink) {
            g.strokeStyle = 'rgba(255,210,120,.75)';
            g.setLineDash([8, 6]);
            g.lineWidth = 3;
            g.beginPath();
            g.moveTo(0, hz.down ? 52 : H - 12);
            g.lineTo(W, hz.down ? 52 : H - 12);
            g.stroke();
            g.setLineDash([]);
            // すき間プレビュー
            g.strokeStyle = 'rgba(140,230,140,.9)';
            g.lineWidth = 4;
            g.beginPath();
            g.moveTo(hz.gapX, hz.down ? 52 : H - 12);
            g.lineTo(hz.gapX + NET_GAP, hz.down ? 52 : H - 12);
            g.stroke();
          }
        } else if (yy !== null) {
          g.strokeStyle = '#c8b28a';
          g.lineWidth = 4;
          g.beginPath();
          g.moveTo(0, yy);
          g.lineTo(hz.gapX, yy);
          g.moveTo(hz.gapX + NET_GAP, yy);
          g.lineTo(W, yy);
          g.stroke();
          g.strokeStyle = 'rgba(200,178,138,.55)';
          g.lineWidth = 2;
          for (let x = 6; x < W; x += 14) {
            if (inNetGap(x, hz.gapX)) continue;
            g.beginPath();
            g.moveTo(x, yy - 7);
            g.lineTo(x, yy + 7);
            g.stroke();
          }
        }
      } else if (hz.type === 'puffer') {
        const px2 = pufferX(hz, now);
        if (tele) {
          if (Math.sin(now / 90) > 0) {
            g.strokeStyle = 'rgba(255,120,120,.7)';
            g.setLineDash([10, 8]);
            g.lineWidth = 3;
            g.beginPath();
            g.moveTo(0, hz.y);
            g.lineTo(W, hz.y);
            g.stroke();
            g.setLineDash([]);
          }
        } else if (px2 !== null) {
          g.save();
          g.translate(px2, hz.y);
          g.fillStyle = '#e8a03c';
          g.beginPath();
          g.arc(0, 0, 15, 0, Math.PI * 2);
          g.fill();
          g.strokeStyle = '#b8742a';
          g.lineWidth = 2;
          for (let k = 0; k < 10; k++) {
            const a = (k / 10) * Math.PI * 2;
            g.beginPath();
            g.moveTo(Math.cos(a) * 15, Math.sin(a) * 15);
            g.lineTo(Math.cos(a) * 21, Math.sin(a) * 21);
            g.stroke();
          }
          g.fillStyle = '#173048';
          g.beginPath();
          g.arc(hz.fromLeft ? 6 : -6, -3, 2.4, 0, Math.PI * 2);
          g.fill();
          g.restore();
        }
      } else {
        if (whirlActive(hz, now) || tele) {
          const a = tele ? 0.35 : 0.8;
          g.save();
          g.translate(hz.x, hz.y);
          g.rotate(now / 240);
          g.strokeStyle = `rgba(160,215,255,${a})`;
          g.lineWidth = 3;
          for (let k = 0; k < 3; k++) {
            g.beginPath();
            g.arc(0, 0, 18 + k * 24, k, k + 4.4);
            g.stroke();
          }
          g.restore();
        }
      }
    }

    // 群れ
    for (const f of fish) {
      if (!f.alive) continue;
      const ang = Math.atan2(f.vy, f.vx || 0.01);
      drawFish(f.x, f.y, ang, 7, '#9fc6e8', now, f.wob);
    }
    // リーダー
    const lang = Math.atan2(leader.vy, leader.vx || 0.01);
    drawFish(leader.x, leader.y, lang, 11, '#ffb14a', now, 0);

    // うかぶテキスト
    for (const e of effects) {
      if (now < e.at) continue;
      const a = Math.min(1, (e.until - now) / 300);
      g.globalAlpha = Math.max(0, a);
      g.fillStyle = e.color;
      g.font = 'bold 15px sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(e.text, e.x, e.y - ((now - e.at) / 900) * 14);
      g.globalAlpha = 1;
    }

    // HUD
    if (mode !== 'over') {
      g.fillStyle = 'rgba(10,34,54,.9)';
      g.fillRect(0, 0, W, HUD_H);
      g.textBaseline = 'middle';
      g.textAlign = 'left';
      g.fillStyle = '#fff';
      g.font = 'bold 17px sans-serif';
      g.fillText(`🐟×${aliveCount()}`, 12, HUD_H / 2);
      g.fillStyle = '#9fe3ff';
      g.font = 'bold 15px sans-serif';
      g.fillText(`たべた ${eaten}`, 96, HUD_H / 2);
      const remain = Math.max(0, Math.ceil((DURATION_MS - now) / 1000));
      g.fillText(`のこり ${remain}s`, 196, HUD_H / 2);
    } else {
      g.fillStyle = 'rgba(10,34,54,.85)';
      g.fillRect(0, 0, W, H);
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = '#fff';
      g.font = 'bold 28px sans-serif';
      g.fillText(aliveCount() > 0 ? 'ゴール！' : 'むれが いなくなった…', W / 2, H / 2 - 64);
      g.font = 'bold 26px sans-serif';
      g.fillText(`${score}てん`, W / 2, H / 2 - 18);
      g.fillStyle = '#9fe3ff';
      g.font = 'bold 16px sans-serif';
      g.fillText(`のこった なかま ${aliveCount()}/${FOLLOWERS}ひき`, W / 2, H / 2 + 20);
      g.fillText(`たべた プランクトン ${eaten}`, W / 2, H / 2 + 46);
      if (aliveCount() === FOLLOWERS) {
        g.fillStyle = '#ffd54a';
        g.fillText('ひとりも かけずに ゴール！', W / 2, H / 2 + 74);
      }
    }
  }

  draw(ctx.now());
  setData(ctx.now());

  return {
    start() {
      started = true;
      ctx.sfx('start');
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
