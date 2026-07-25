// =============================================================
// スパッとフルーツ（No.91）: スワイプで飛んでくるフルーツを切る反射ゲーム
// =============================================================
// - 下から放物線で打ち上がるフルーツを、指のスワイプ（1区間ごとの線分）で切る。
//   💣ばくだんを切ると／フルーツを切り落とすと ライフが1へる。3つで おしまい。
// - 1回のスワイプ（指を下ろして離すまで）で複数切ると コンボ加点。
// - 出題は logic.ts（rng注入・決定論）。物体位置は born からの閉形式＝フレーム非依存。
// - import してよいのは game-api（types / helpers）と、このフォルダ内（logic）だけ。
import type { GameContext, IGame, PointerInfo } from '../../game-api/types';
import { clamp } from '../../game-api/helpers';
import {
  FRUIT_PTS,
  H,
  NFRUIT,
  type ObjKind,
  W,
  comboBonus,
  fallBackMs,
  planGroup,
  posAt,
  segCircleHit,
} from './logic';

const HUD_H = 40;
const LIVES = 3;
const START_DELAY = 350; // 開始してから最初のフルーツまで
const SLICE_FADE = 650; // 切ったあとの半身が消えるまで(ms)
const TRAIL_MS = 130; // 刃のこん跡の寿命
const END_DELAY = 1700; // おしまい表示→結果画面
const SCORE_HI = 1000;

type Mode = 'play' | 'over';

interface Obj {
  id: number;
  kind: ObjKind;
  color: number;
  x0: number;
  y0: number;
  vx: number;
  vy: number;
  r: number;
  vrot: number;
  born: number;
  sliced: boolean;
  sliceAt: number;
  sliceAng: number;
  dead: boolean;
}

interface Trail {
  lastX: number;
  lastY: number;
  pts: { x: number; y: number; at: number }[];
  fruits: number;
  ended: boolean;
}

interface FloatFx {
  x: number;
  y: number;
  text: string;
  color: string;
  at: number;
  until: number;
}

interface Splash {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  at: number;
  r: number;
}

const FRUIT_COLORS: { body: string; rim: string; flesh: string }[] = [
  { body: '#e0483c', rim: '#a82a20', flesh: '#ffd9c2' },
  { body: '#ffb14a', rim: '#d67f1e', flesh: '#ffe6b0' },
  { body: '#8ae05a', rim: '#57a832', flesh: '#e9ffd2' },
  { body: '#ffd54a', rim: '#d6a91e', flesh: '#fff3c0' },
  { body: '#c56af5', rim: '#8f3fd0', flesh: '#f0dcff' },
  { body: '#ff7ab0', rim: '#d6488a', flesh: '#ffdcec' },
];

export function createGame(ctx: GameContext): IGame {
  const cv = ctx.canvas2d({ design: { w: W, h: H } });
  const g = cv.ctx;

  let mode: Mode = 'play';
  let started = false;
  let hostPaused = false;
  let ended = false;

  let score = 0;
  let lives = LIVES;
  let fruitsSliced = 0;
  let noMiss = 0; // 落とさず・ばくだんも切らずに 連続で切った数
  let bestCombo = 0;

  let playStart = 0;
  let nextSpawnAt = Infinity;
  let nextId = 1;
  const objs: Obj[] = [];
  const trails = new Map<number, Trail>();
  let effects: FloatFx[] = [];
  let splashes: Splash[] = [];
  let flashUntil = 0; // ばくだん被弾の赤フラッシュ
  let phaseUntil = 0;
  let lastEvent = '';

  function posOf(o: Obj, now: number): { x: number; y: number } {
    return posAt(o, now, o.born);
  }

  function toOver(now: number): void {
    if (mode !== 'play') return;
    mode = 'over';
    phaseUntil = now + END_DELAY;
    ctx.sfx('fail');
    ctx.haptic('error');
    lastEvent = 'over';
  }

  function loseLife(now: number, reason: string): void {
    lives--;
    noMiss = 0;
    lastEvent = reason;
    if (lives <= 0) toOver(now);
  }

  function sliceFruit(o: Obj, now: number, t: Trail): void {
    fruitsSliced++;
    noMiss++;
    if (fruitsSliced === 1) ctx.achieve('first-slice');
    if (fruitsSliced >= 40) ctx.achieve('fruits-40');
    if (noMiss >= 15) ctx.achieve('no-miss-15');
    // 基礎点＋コンボ加点（このスワイプで2こ目以降の増分）
    let gained = FRUIT_PTS;
    t.fruits++;
    if (t.fruits > bestCombo) bestCombo = t.fruits;
    const delta = comboBonus(t.fruits) - comboBonus(t.fruits - 1);
    if (delta > 0) gained += delta;
    score += gained;
    if (t.fruits === 3) ctx.achieve('combo-3');
    if (t.fruits === 5) ctx.achieve('combo-5');
    if (score >= SCORE_HI) ctx.achieve('score-hi');
    const pos = posOf(o, now);
    if (t.fruits >= 2) {
      effects.push({ x: pos.x, y: pos.y - 20, text: `コンボ ×${t.fruits}`, color: '#ffd54a', at: now, until: now + 750 });
    } else {
      effects.push({ x: pos.x, y: pos.y - 16, text: `+${gained}`, color: '#ffffff', at: now, until: now + 700 });
    }
    // ジュースしぶき（決定論: id と color から角度を決める）
    const col = FRUIT_COLORS[o.color % NFRUIT]!;
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * Math.PI * 2 + o.id * 0.9;
      const sp = 90 + ((k * 31 + o.id * 17) % 5) * 34;
      splashes.push({ x: pos.x, y: pos.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 60, color: col.body, at: now, r: 3 + (k % 3) });
    }
    ctx.sfx(t.fruits >= 2 ? 'combo' : 'success');
    ctx.haptic('light');
    lastEvent = `slice:${gained}:${t.fruits}`;
  }

  function sliceObj(o: Obj, now: number, ang: number, t: Trail): void {
    o.sliced = true;
    o.sliceAt = now;
    o.sliceAng = ang;
    if (o.kind === 'bomb') {
      flashUntil = now + 380;
      const pos = posOf(o, now);
      effects.push({ x: pos.x, y: pos.y - 18, text: 'ドカン！', color: '#ff6b6b', at: now, until: now + 900 });
      ctx.sfx('fail');
      ctx.haptic('error');
      loseLife(now, 'bomb');
    } else {
      sliceFruit(o, now, t);
    }
  }

  // ---- 入力（スワイプ＝刃） ----
  const offDown = ctx.input.onDown((p: PointerInfo) => {
    if (hostPaused || !started || mode !== 'play') return;
    const l = cv.toLocal(p);
    trails.set(p.id, { lastX: l.x, lastY: l.y, pts: [{ x: l.x, y: l.y, at: ctx.now() }], fruits: 0, ended: false });
  });
  const offMove = ctx.input.onMove((p: PointerInfo) => {
    const t = trails.get(p.id);
    if (!t || t.ended) return;
    if (hostPaused || mode !== 'play') return;
    const l = cv.toLocal(p);
    const now = ctx.now();
    for (const o of objs) {
      if (o.sliced || o.dead) continue;
      const pos = posOf(o, now);
      if (segCircleHit(t.lastX, t.lastY, l.x, l.y, pos.x, pos.y, o.r * 0.92)) {
        sliceObj(o, now, Math.atan2(l.y - t.lastY, l.x - t.lastX), t);
        if (mode !== 'play') break; // ばくだんでゲームオーバー確定なら、同じスワイプで以降を切って加点しない
      }
    }
    t.pts.push({ x: l.x, y: l.y, at: now });
    t.lastX = l.x;
    t.lastY = l.y;
  });
  const offUp = ctx.input.onUp((p: PointerInfo) => {
    const t = trails.get(p.id);
    if (t) t.ended = true;
  });

  // ---- 毎フレーム ----
  const offFrame = ctx.onFrame(() => {
    if (hostPaused || !started) return;
    const now = ctx.now();

    if (mode === 'play') {
      // 出現（時刻しめきり方式・rng は planGroup 内で固定順に消費）
      let guard = 0;
      while (now >= nextSpawnAt && guard++ < 4) {
        const plan = planGroup(ctx.random, nextSpawnAt - playStart);
        for (const s of plan.specs) {
          objs.push({
            id: nextId++,
            kind: s.kind,
            color: s.color,
            x0: s.x0,
            y0: H + s.r,
            vx: s.vx,
            vy: s.vy,
            r: s.r,
            vrot: s.vrot,
            born: nextSpawnAt,
            sliced: false,
            sliceAt: 0,
            sliceAng: 0,
            dead: false,
          });
        }
        nextSpawnAt += plan.nextMs;
      }
      // 落下しきったフルーツ＝取りこぼし（ばくだんは落としてOK）
      for (const o of objs) {
        if (o.dead || o.sliced) continue;
        if (now - o.born >= fallBackMs(o.vy)) {
          o.dead = true;
          if (o.kind === 'fruit') {
            ctx.sfx('tick');
            loseLife(now, 'miss');
            if (mode !== 'play') break; // 同フレームの複数落下で over 後まで loseLife を続けない
          }
        }
      }
    } else if (mode === 'over' && !ended && now >= phaseUntil) {
      ended = true;
      ctx.end({ score });
      return;
    }

    // 後片づけ（切って時間がたった／落ちきった）
    for (let i = objs.length - 1; i >= 0; i--) {
      const o = objs[i]!;
      if (o.dead || (o.sliced && now - o.sliceAt > SLICE_FADE)) objs.splice(i, 1);
    }
    effects = effects.filter((e) => e.until > now);
    splashes = splashes.filter((s) => now - s.at < 900);
    // こん跡の寿命切れ点を捨て、空になった終了トレイルを消す
    for (const [id, t] of trails) {
      t.pts = t.pts.filter((pt) => now - pt.at < TRAIL_MS);
      if (t.ended && t.pts.length === 0) trails.delete(id);
    }

    draw(now);
    setData(now);
  });

  function setData(now: number): void {
    if (!import.meta.env.DEV) return;
    const r = ctx.root as HTMLElement;
    r.dataset.mode = mode;
    r.dataset.score = String(score);
    r.dataset.lives = String(lives);
    r.dataset.fruits = String(fruitsSliced);
    r.dataset.nomiss = String(noMiss);
    r.dataset.combo = String(bestCombo);
    r.dataset.last = lastEvent;
    // アクティブな未切断オブジェクトの現在位置（自動プレイ用）
    const list = objs
      .filter((o) => !o.sliced && !o.dead)
      .map((o) => {
        const pos = posOf(o, now);
        return { id: o.id, k: o.kind === 'bomb' ? 'b' : 'f', x: Math.round(pos.x), y: Math.round(pos.y), r: Math.round(o.r) };
      });
    r.dataset.objs = JSON.stringify(list);
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
    bg.addColorStop(0, '#20304a');
    bg.addColorStop(0.55, '#2c4468');
    bg.addColorStop(1, '#1b2740');
    og.fillStyle = bg;
    og.fillRect(0, 0, W, H);
    // うっすらした光の帯
    og.fillStyle = 'rgba(255,255,255,.04)';
    for (let i = 0; i < 5; i++) og.fillRect(0, 90 + i * 110, W, 34);
  }
  bakeStatic();

  function drawFruit(o: Obj, now: number): void {
    const c = FRUIT_COLORS[o.color % NFRUIT]!;
    const t = (now - o.born) / 1000;
    const rot = o.vrot * t;
    if (!o.sliced) {
      const pos = posOf(o, now);
      g.save();
      g.translate(pos.x, pos.y);
      g.rotate(rot);
      g.fillStyle = c.body;
      g.beginPath();
      g.arc(0, 0, o.r, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = c.rim;
      g.lineWidth = 2.5;
      g.stroke();
      g.fillStyle = 'rgba(255,255,255,.4)';
      g.beginPath();
      g.ellipse(-o.r * 0.32, -o.r * 0.36, o.r * 0.22, o.r * 0.3, -0.5, 0, Math.PI * 2);
      g.fill();
      // 葉っぱ
      g.fillStyle = '#57a832';
      g.beginPath();
      g.ellipse(o.r * 0.1, -o.r - 1, 5, 3, -0.7, 0, Math.PI * 2);
      g.fill();
      g.restore();
    } else {
      // 半身が切り口から左右に分かれて落ちる
      const st = (now - o.sliceAt) / 1000;
      const pos = posOf(o, o.sliceAt);
      const nx = Math.cos(o.sliceAng + Math.PI / 2);
      const ny = Math.sin(o.sliceAng + Math.PI / 2);
      const gap = 12 + st * 60;
      const drop = 260 * st * st;
      const alpha = clamp(1 - st * 1.4, 0, 1);
      g.globalAlpha = alpha;
      for (const sgn of [-1, 1]) {
        const hx = pos.x + nx * gap * sgn;
        const hy = pos.y + ny * gap * sgn + drop;
        g.save();
        g.translate(hx, hy);
        g.rotate(o.sliceAng + st * 3 * sgn);
        g.fillStyle = c.body;
        g.beginPath();
        g.arc(0, 0, o.r, sgn > 0 ? 0 : Math.PI, sgn > 0 ? Math.PI : Math.PI * 2);
        g.closePath();
        g.fill();
        g.fillStyle = c.flesh;
        g.beginPath();
        g.ellipse(0, 0, o.r * 0.7, o.r * 0.32, 0, sgn > 0 ? 0 : Math.PI, sgn > 0 ? Math.PI : Math.PI * 2);
        g.fill();
        g.restore();
      }
      g.globalAlpha = 1;
    }
  }

  function drawBomb(o: Obj, now: number): void {
    if (o.sliced) return; // 切った瞬間はフラッシュで表現
    const pos = posOf(o, now);
    const t = (now - o.born) / 1000;
    g.save();
    g.translate(pos.x, pos.y);
    g.rotate(o.vrot * t);
    g.fillStyle = '#20242e';
    g.beginPath();
    g.arc(0, 0, o.r, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#45505f';
    g.lineWidth = 2;
    g.stroke();
    g.fillStyle = 'rgba(255,255,255,.28)';
    g.beginPath();
    g.arc(-o.r * 0.3, -o.r * 0.32, o.r * 0.24, 0, Math.PI * 2);
    g.fill();
    // 導火線と火花
    g.strokeStyle = '#b8862a';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(0, -o.r);
    g.quadraticCurveTo(o.r * 0.5, -o.r - 10, o.r * 0.7, -o.r - 4);
    g.stroke();
    const spark = 2 + (Math.sin(now / 60) + 1) * 1.6;
    g.fillStyle = '#ffd54a';
    g.beginPath();
    g.arc(o.r * 0.7, -o.r - 4, spark, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }

  function drawTrail(now: number): void {
    for (const t of trails.values()) {
      const pts = t.pts;
      if (pts.length < 2) continue;
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1]!;
        const b = pts[i]!;
        const life = clamp(1 - (now - b.at) / TRAIL_MS, 0, 1);
        g.strokeStyle = `rgba(255,255,255,${0.15 + life * 0.55})`;
        g.lineWidth = 2 + life * 9;
        g.lineCap = 'round';
        g.beginPath();
        g.moveTo(a.x, a.y);
        g.lineTo(b.x, b.y);
        g.stroke();
      }
    }
  }

  function drawHearts(): void {
    for (let i = 0; i < LIVES; i++) {
      const x = W - 20 - i * 24;
      const y = HUD_H / 2;
      g.fillStyle = i < lives ? '#ff5a76' : 'rgba(255,255,255,.22)';
      g.beginPath();
      g.moveTo(x, y + 5);
      g.bezierCurveTo(x - 9, y - 3, x - 5, y - 9, x, y - 4);
      g.bezierCurveTo(x + 5, y - 9, x + 9, y - 3, x, y + 5);
      g.fill();
    }
  }

  function draw(now: number): void {
    g.drawImage(off, 0, 0, W, H);

    // しぶき
    for (const s of splashes) {
      const st = (now - s.at) / 1000;
      const alpha = clamp(1 - st * 1.1, 0, 1);
      if (alpha <= 0) continue;
      g.globalAlpha = alpha;
      g.fillStyle = s.color;
      g.beginPath();
      g.arc(s.x + s.vx * st, s.y + s.vy * st + 0.5 * 700 * st * st, s.r, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;

    for (const o of objs) {
      if (o.kind === 'bomb') drawBomb(o, now);
      else drawFruit(o, now);
    }

    drawTrail(now);

    // ばくだんフラッシュ
    if (now < flashUntil) {
      const a = (flashUntil - now) / 380;
      g.fillStyle = `rgba(220,60,50,${a * 0.5})`;
      g.fillRect(0, 0, W, H);
    }

    // 浮かぶテキスト
    for (const e of effects) {
      if (now < e.at) continue;
      const a = clamp((e.until - now) / 400, 0, 1);
      g.globalAlpha = a;
      const rise = ((now - e.at) / 750) * 24;
      g.fillStyle = e.color;
      g.font = 'bold 17px sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.strokeStyle = 'rgba(20,30,45,.8)';
      g.lineWidth = 3;
      g.strokeText(e.text, e.x, e.y - rise);
      g.fillText(e.text, e.x, e.y - rise);
      g.globalAlpha = 1;
    }

    // HUD
    g.fillStyle = 'rgba(20,30,45,.86)';
    g.fillRect(0, 0, W, HUD_H);
    g.fillStyle = '#fff';
    g.font = 'bold 19px sans-serif';
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.fillText(`${score}てん`, 12, HUD_H / 2);
    drawHearts();

    // 操作ヒント（最初だけ）
    if (mode === 'play' && fruitsSliced === 0 && objs.length === 0) {
      g.fillStyle = 'rgba(255,255,255,.8)';
      g.font = 'bold 16px sans-serif';
      g.textAlign = 'center';
      g.fillText('とんでくるフルーツを スワイプで スパッと！', W / 2, H / 2);
      g.fillStyle = 'rgba(255,180,180,.85)';
      g.font = 'bold 14px sans-serif';
      g.fillText('💣ばくだんは 切らないで！', W / 2, H / 2 + 26);
    }

    // おしまい
    if (mode === 'over') {
      g.fillStyle = 'rgba(20,30,45,.82)';
      g.fillRect(0, 0, W, H);
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = '#fff';
      g.font = 'bold 30px sans-serif';
      g.fillText('おしまい！', W / 2, H / 2 - 46);
      g.font = 'bold 26px sans-serif';
      g.fillText(`${score}てん`, W / 2, H / 2);
      g.fillStyle = '#ffd54a';
      g.font = 'bold 16px sans-serif';
      g.fillText(`フルーツ ${fruitsSliced}こ / さいこうコンボ ×${bestCombo}`, W / 2, H / 2 + 36);
    }
  }

  draw(ctx.now());
  setData(ctx.now());

  return {
    start() {
      started = true;
      playStart = ctx.now();
      nextSpawnAt = playStart + START_DELAY;
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
