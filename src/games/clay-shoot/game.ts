// =============================================================
// クレーしゃげき（No.81）: 「プル！」で飛び出すクレーを タップで撃ち落とせ！全20枚
// =============================================================
// - 操作はタップだけ＝その場所へ発射（即時判定・命中はタップ点の近くにクレーがあるか）。
//   弾数制（単発2発・ダブル3発）で連打では勝てない。弾切れはカチッと空撃ち。
// - 銃は描かない: 照準リング＋閃光＋クレーの破砕だけのスポーツ表現（子ども向け）。
// - 弾道・ボレー計画・採点は logic.ts（純ロジック・rng注入＝完全決定論）。
// - 全画面 Canvas・時間は ctx.now 期限方式・setTimeout 不使用。
// - import してよいのは game-api（types / helpers）と、このフォルダ内（logic）だけ
import type { GameContext, IGame } from '../../game-api/types';
import {
  CLAY_R,
  type ClayDef,
  HIT_DIST,
  HIT_PTS,
  CLEAN_BONUS,
  PAIR_BONUS,
  SHELLS_DOUBLE,
  SHELLS_SINGLE,
  TOTAL_CLAYS,
  TRAPS,
  type Volley,
  W,
  H,
  clayPos,
  isEscaped,
  makePlan,
  streakBonus,
} from './logic';

const HUD_H = 40;
const CALL_MS = 620;
const BETWEEN_MS = 700;
const END_DELAY = 2000;
const SCORE_HI = 880; // 実績閾値（理論最大1010・完璧ボットで到達実証・実機要調整）
const STREAK_ACH = 8;
const CLEAN_ACH = 10;

type Mode = 'call' | 'fly' | 'between' | 'over';

interface ActiveClay {
  def: ClayDef;
  hit: boolean;
  escaped: boolean;
  hitAt: number;
  hitX: number;
  hitY: number;
}

interface ShotFx {
  x: number;
  y: number;
  at: number;
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

  // ボレー計画は最初に一括生成（rng 消費順固定＝決定論）
  const volleys: Volley[] = makePlan(ctx.random);

  let mode: Mode = 'call';
  let started = false;
  let hostPaused = false;
  let volleyIdx = 0;
  let active: ActiveClay[] = [];
  let launchAt = 0;
  let callUntil = 0;
  let betweenUntil = 0;
  let shells = 0;
  let shots = 0;
  let cleanVolley = true;
  let score = 0;
  let hits = 0;
  let misses = 0;
  let streak = 0;
  let cleanHits = 0;
  let pairsBoth = 0;
  let shotFx: ShotFx[] = [];
  let fragFx: ShotFx[] = [];
  let effects: FloatFx[] = [];
  let endAt = 0;
  let ended = false;
  let lastEvent = '';

  function addScore(n: number): void {
    score += n;
    if (score >= SCORE_HI) ctx.achieve('score-hi');
  }

  function startVolley(idx: number, now: number): void {
    volleyIdx = idx;
    mode = 'call';
    callUntil = now + CALL_MS;
    active = [];
    cleanVolley = true;
    ctx.sfx('tick');
  }

  function launchVolley(now: number): void {
    const v = volleys[volleyIdx]!;
    active = v.clays.map((def) => ({ def, hit: false, escaped: false, hitAt: 0, hitX: 0, hitY: 0 }));
    shells = v.clays.length === 1 ? SHELLS_SINGLE : SHELLS_DOUBLE;
    launchAt = now;
    mode = 'fly';
    ctx.sfx('start');
    lastEvent = `launch:${volleyIdx + 1}:${v.clays.length}`;
  }

  function hitClay(c: ActiveClay, now: number): void {
    const t = (now - launchAt) / 1000;
    const p = clayPos(c.def, t);
    c.hit = true;
    c.hitAt = now;
    c.hitX = p.x;
    c.hitY = p.y;
    hits++;
    streak++;
    let pts = HIT_PTS + streakBonus(streak);
    if (cleanVolley) {
      pts += CLEAN_BONUS;
      cleanHits++;
      if (cleanHits >= CLEAN_ACH) ctx.achieve('clean-10');
    }
    addScore(pts);
    ctx.achieve('first-hit');
    if (streak >= STREAK_ACH) ctx.achieve('streak-8');
    fragFx.push({ x: p.x, y: p.y, at: now });
    effects.push({ x: p.x, y: p.y - 26, text: `+${pts}`, color: '#fff', until: now + 800 });
    // ダブル両取り
    if (active.length === 2 && active.every((a) => a.hit)) {
      pairsBoth++;
      addScore(PAIR_BONUS);
      ctx.achieve('double-both');
      effects.push({ x: W / 2, y: 210, text: `ダブルりょうどり +${PAIR_BONUS}`, color: '#ffd54a', until: now + 1000 });
    }
    ctx.sfx(streak >= 5 ? 'combo' : 'success');
    ctx.haptic('light');
    lastEvent = `hit:${pts}`;
  }

  // ---- 入力（タップ＝発射） ----
  const offDown = ctx.input.onDown((p) => {
    if (hostPaused || !started) return;
    const now = ctx.now();
    if (mode !== 'fly') {
      if (mode === 'call' || mode === 'between') ctx.sfx('tick'); // はやる指に カチッ
      return;
    }
    if (shells <= 0) {
      ctx.sfx('tick'); // 空撃ち
      lastEvent = 'empty';
      return;
    }
    const l = cv.toLocal(p);
    shells--;
    shots++;
    shotFx.push({ x: l.x, y: l.y, at: now });
    // いちばん近い未命中クレー1枚に判定
    const t = (now - launchAt) / 1000;
    let best: ActiveClay | null = null;
    let bestD = Infinity;
    for (const c of active) {
      if (c.hit || c.escaped) continue;
      const pos = clayPos(c.def, t);
      const d = Math.hypot(pos.x - l.x, pos.y - l.y);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    if (best && bestD <= HIT_DIST) {
      hitClay(best, now);
    } else {
      cleanVolley = false;
      ctx.sfx('tap');
      ctx.haptic('light');
      lastEvent = 'miss-shot';
    }
  });

  // ---- 毎フレーム ----
  const offFrame = ctx.onFrame(() => {
    if (hostPaused) return;
    const now = ctx.now();
    if (started && mode === 'call' && now >= callUntil) {
      launchVolley(now);
    } else if (mode === 'fly') {
      const t = (now - launchAt) / 1000;
      for (const c of active) {
        if (c.hit || c.escaped) continue;
        if (isEscaped(c.def, t)) {
          c.escaped = true;
          misses++;
          streak = 0;
          ctx.sfx('fail');
          lastEvent = 'escape';
        }
      }
      if (active.every((c) => c.hit || c.escaped)) {
        mode = 'between';
        betweenUntil = now + BETWEEN_MS;
      }
    } else if (mode === 'between' && now >= betweenUntil) {
      if (volleyIdx + 1 < volleys.length) {
        startVolley(volleyIdx + 1, now);
      } else {
        if (hits === TOTAL_CLAYS) ctx.achieve('all-20');
        mode = 'over';
        endAt = now + END_DELAY;
        ctx.sfx('medal');
      }
    } else if (mode === 'over' && !ended && now >= endAt) {
      ended = true;
      ctx.end({ score });
      return;
    }
    shotFx = shotFx.filter((s) => now - s.at < 260);
    fragFx = fragFx.filter((s) => now - s.at < 650);
    effects = effects.filter((e) => e.until > now);
    draw(now);
    setData(now);
  });

  function setData(now: number): void {
    if (!import.meta.env.DEV) return;
    const r = ctx.root as HTMLElement;
    const t = (now - launchAt) / 1000;
    r.dataset.mode = mode;
    r.dataset.score = String(score);
    r.dataset.volley = String(volleyIdx + 1);
    r.dataset.volleys = String(volleys.length);
    r.dataset.shells = String(shells);
    r.dataset.shots = String(shots);
    r.dataset.hits = String(hits);
    r.dataset.misses = String(misses);
    r.dataset.streak = String(streak);
    r.dataset.clean = String(cleanHits);
    r.dataset.pairs = String(pairsBoth);
    r.dataset.clays =
      mode === 'fly'
        ? active
            .map((c) => {
              const p = clayPos(c.def, t);
              return `${p.x.toFixed(1)}:${p.y.toFixed(1)}:${c.hit ? 1 : 0}:${c.escaped ? 1 : 0}`;
            })
            .join(';')
        : '';
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
    // 空
    const sky = og.createLinearGradient(0, 0, 0, 570);
    sky.addColorStop(0, '#7ec8f0');
    sky.addColorStop(1, '#cfeaf8');
    og.fillStyle = sky;
    og.fillRect(0, 0, W, 570);
    // 雲
    og.fillStyle = 'rgba(255,255,255,.85)';
    for (const [cx2, cy2, s] of [
      [84, 120, 1],
      [268, 88, 0.8],
      [190, 170, 0.6],
    ] as [number, number, number][]) {
      for (const [ox, oy, r] of [
        [-22, 4, 14],
        [0, -4, 18],
        [20, 4, 13],
      ] as [number, number, number][]) {
        og.beginPath();
        og.arc(cx2 + ox * s, cy2 + oy * s, r * s, 0, Math.PI * 2);
        og.fill();
      }
    }
    // 遠くの林
    og.fillStyle = '#8fbf6a';
    og.beginPath();
    og.moveTo(0, 570);
    for (let x = 0; x <= W; x += 24) {
      og.quadraticCurveTo(x + 6, 544 + ((x * 31) % 14), x + 24, 570);
    }
    og.closePath();
    og.fill();
    // 草地
    og.fillStyle = '#5da24a';
    og.fillRect(0, 570, W, H - 570);
    og.fillStyle = 'rgba(255,255,255,.08)';
    for (let i = 0; i < 24; i++) og.fillRect((i * 53) % W, 580 + ((i * 37) % 50), 3, 3);
    // 放出台（左右）
    for (const trap of TRAPS) {
      const dir = trap.x < W / 2 ? 1 : -1;
      og.fillStyle = '#33424e';
      og.beginPath();
      og.moveTo(trap.x - 20, 574);
      og.lineTo(trap.x + 20, 574);
      og.lineTo(trap.x + 13, 552);
      og.lineTo(trap.x - 13, 552);
      og.closePath();
      og.fill();
      // 発射レール（内向き上方）
      og.strokeStyle = '#22303a';
      og.lineWidth = 7;
      og.lineCap = 'round';
      og.beginPath();
      og.moveTo(trap.x, 560);
      og.lineTo(trap.x + dir * 16, 542);
      og.stroke();
      og.fillStyle = '#e8b23c';
      og.beginPath();
      og.arc(trap.x, 560, 3.5, 0, Math.PI * 2);
      og.fill();
    }
  }
  bakeStatic();

  function drawClay(x: number, y: number, t: number): void {
    g.save();
    g.translate(x, y);
    // 円盤（回転感は上面の楕円ハイライトのずれで表現）
    g.fillStyle = '#e8762a';
    g.beginPath();
    g.ellipse(0, 0, CLAY_R, CLAY_R * 0.62, 0, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#a94e16';
    g.lineWidth = 2.5;
    g.stroke();
    g.fillStyle = '#ffb26e';
    g.beginPath();
    g.ellipse(Math.cos(t * 9) * 3, -2.5, CLAY_R * 0.5, CLAY_R * 0.24, 0, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }

  function draw(now: number): void {
    g.drawImage(off, 0, 0, W, H);

    // クレー
    if (mode === 'fly') {
      const t = (now - launchAt) / 1000;
      for (const c of active) {
        if (c.hit || c.escaped) continue;
        const p = clayPos(c.def, t);
        drawClay(p.x, p.y, t);
      }
    }

    // 破砕（6方向のかけら・重力つき）
    for (const f of fragFx) {
      const ft = (now - f.at) / 1000;
      g.fillStyle = '#e8762a';
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2 + 0.5;
        const fx = f.x + Math.cos(a) * 120 * ft;
        const fy = f.y + Math.sin(a) * 90 * ft + 260 * ft * ft;
        g.save();
        g.translate(fx, fy);
        g.rotate(a + ft * 8);
        g.fillRect(-4, -2, 8, 4);
        g.restore();
      }
    }

    // 発射の照準リング＋閃光
    for (const s of shotFx) {
      const st = (now - s.at) / 260;
      g.strokeStyle = `rgba(24,48,72,${1 - st})`;
      g.lineWidth = 2.5;
      g.beginPath();
      g.arc(s.x, s.y, 14 + st * 10, 0, Math.PI * 2);
      g.stroke();
      g.beginPath();
      g.moveTo(s.x - 22, s.y);
      g.lineTo(s.x - 10, s.y);
      g.moveTo(s.x + 10, s.y);
      g.lineTo(s.x + 22, s.y);
      g.moveTo(s.x, s.y - 22);
      g.lineTo(s.x, s.y - 10);
      g.moveTo(s.x, s.y + 10);
      g.lineTo(s.x, s.y + 22);
      g.stroke();
      if (st < 0.45) {
        g.fillStyle = `rgba(255,240,180,${0.75 * (1 - st / 0.45)})`;
        g.beginPath();
        g.arc(s.x, s.y, 7, 0, Math.PI * 2);
        g.fill();
      }
    }

    // うかぶ得点
    for (const e of effects) {
      const a = Math.max(0, Math.min(1, (e.until - now) / 800));
      g.globalAlpha = a;
      g.fillStyle = e.color;
      g.font = 'bold 16px sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.strokeStyle = 'rgba(24,48,72,.7)';
      g.lineWidth = 3;
      g.strokeText(e.text, e.x, e.y - (1 - a) * 22);
      g.fillText(e.text, e.x, e.y - (1 - a) * 22);
      g.globalAlpha = 1;
    }

    // プル！バナー
    if (mode === 'call' && started) {
      g.fillStyle = 'rgba(24,48,72,.72)';
      const bw = 150;
      g.beginPath();
      g.moveTo(W / 2 - bw / 2 + 14, 250);
      g.arcTo(W / 2 + bw / 2, 250, W / 2 + bw / 2, 316, 14);
      g.arcTo(W / 2 + bw / 2, 316, W / 2 - bw / 2, 316, 14);
      g.arcTo(W / 2 - bw / 2, 316, W / 2 - bw / 2, 250, 14);
      g.arcTo(W / 2 - bw / 2, 250, W / 2 + bw / 2, 250, 14);
      g.closePath();
      g.fill();
      g.fillStyle = '#fff';
      g.font = 'bold 30px sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('プル！', W / 2, 283);
    }

    // HUD
    if (mode !== 'over') {
      g.fillStyle = 'rgba(16,34,52,.88)';
      g.fillRect(0, 0, W, HUD_H);
      g.textBaseline = 'middle';
      g.textAlign = 'left';
      g.fillStyle = '#fff';
      g.font = 'bold 19px sans-serif';
      g.fillText(`${score}てん`, 12, HUD_H / 2);
      g.fillStyle = '#cfe8ff';
      g.font = 'bold 15px sans-serif';
      g.fillText(`クレー ${hits + misses}/${TOTAL_CLAYS}`, 118, HUD_H / 2);
      // のこり弾（●）
      for (let i = 0; i < SHELLS_DOUBLE; i++) {
        g.fillStyle = i < shells ? '#ffd54a' : 'rgba(255,255,255,.2)';
        g.beginPath();
        g.arc(242 + i * 17, HUD_H / 2, 5.5, 0, Math.PI * 2);
        g.fill();
      }
      // れんぞく表示
      if (streak >= 2) {
        g.fillStyle = 'rgba(16,34,52,.6)';
        g.beginPath();
        g.moveTo(16, 48);
        g.arcTo(118, 48, 118, 72, 12);
        g.arcTo(118, 72, 16, 72, 12);
        g.arcTo(16, 72, 16, 48, 12);
        g.arcTo(16, 48, 118, 48, 12);
        g.closePath();
        g.fill();
        g.fillStyle = '#ffd54a';
        g.font = 'bold 13px sans-serif';
        g.textAlign = 'center';
        g.fillText(`れんぞく ×${streak}`, 67, 60);
      }
    }

    if (mode === 'over') {
      g.fillStyle = 'rgba(16,34,52,.78)';
      g.fillRect(0, 0, W, H);
      g.textAlign = 'center';
      g.fillStyle = '#fff';
      g.font = 'bold 30px sans-serif';
      g.fillText('しゅうりょう！', W / 2, H / 2 - 52);
      g.font = 'bold 26px sans-serif';
      g.fillText(`${score}てん`, W / 2, H / 2 - 10);
      g.fillStyle = '#cfe8ff';
      g.font = 'bold 16px sans-serif';
      g.fillText(`めいちゅう ${hits}/${TOTAL_CLAYS}まい`, W / 2, H / 2 + 26);
      if (hits === TOTAL_CLAYS) {
        g.fillStyle = '#ffd54a';
        g.fillText('パーフェクト！', W / 2, H / 2 + 54);
      }
    }
  }

  draw(ctx.now());
  setData(ctx.now());

  return {
    start() {
      started = true;
      startVolley(0, ctx.now());
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
