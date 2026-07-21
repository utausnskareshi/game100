// =============================================================
// ドミノたおし（No.88）: コースにドミノを置いて、スタートで一気にたおすチルパズル
// =============================================================
// - タップ＝置く／置いたドミノをタップ＝はずす。リンクの届き/不足は
//   つねに緑/赤の線で見える（公平）。スタートで先頭からたおれ、ベルまで
//   つながればクリア。のこり枚数ボーナスが「攻めた間隔」を誘う。
// - 判定・シミュレーションは logic.ts（純関数・乱数不使用＝完全決定論）。
// - 全画面 Canvas・時間は ctx.now 期限方式・setTimeout 不使用。
// - import してよいのは game-api（types / helpers）と、このフォルダ内（logic）だけ
import type { GameContext, IGame, PointerInfo } from '../../game-api/types';
import {
  BELL_REACH,
  type Course,
  FALL_MS,
  FIRST_REACH,
  MIN_GAP,
  type PathInfo,
  SCORE_HI,
  type SimResult,
  buildPath,
  courses,
  levelScore,
  reachBetween,
  simulate,
} from './logic';

const W = 360;
const H = 640;
const HUD_H = 40;
const INTRO_MS = 1500;
const CLEAR_MS = 2200;
const STOP_MS = 1600;
const END_DELAY = 2000;
/** せつやくめいじん のこり枚数（ソルバボット実証値=14で較正） */
const ECONOMY_TH = 12;
const BTN = { x: 92, y: 548, w: 176, h: 52 };

type Mode = 'intro' | 'build' | 'topple' | 'clear' | 'stopped' | 'over';

interface FloatFx {
  x: number;
  y: number;
  text: string;
  color: string;
  at: number;
  until: number;
}

const DOMINO_COLORS = ['#ff6b8a', '#ffb14a', '#ffd54a', '#8ae08a', '#7ec8f0', '#c99af5', '#ff9ad5'];

export function createGame(ctx: GameContext): IGame {
  const cv = ctx.canvas2d({ design: { w: W, h: H } });
  const g = cv.ctx;

  const allCourses = courses();
  let courseIdx = 0;
  let course: Course = allCourses[0]!;
  let path: PathInfo = buildPath(course.pts);

  let mode: Mode = 'intro';
  let started = false;
  let hostPaused = false;
  let ended = false;
  let placed: number[] = []; // 弧長
  let restarts = 0;
  let anyRestart = false;
  let cleared = 0;
  let score = 0;
  let phaseUntil = 0;
  let toppleStartAt = 0;
  let sim: SimResult | null = null;
  let simDoneAt = 0;
  let bellSwungAt = 0;
  let starPopAt: number[] = [];
  let effects: FloatFx[] = [];
  let lastEvent = '';

  function addScore(n: number): void {
    score += n;
    if (score >= SCORE_HI) ctx.achieve('score-hi');
  }

  function beginCourse(i: number, now: number): void {
    courseIdx = i;
    course = allCourses[i]!;
    path = buildPath(course.pts);
    placed = [];
    restarts = 0;
    sim = null;
    starPopAt = course.stars.map(() => 0);
    bellSwungAt = 0;
    bakeStatic(); // コースが変わるので背景を焼き直す
    mode = 'intro';
    phaseUntil = now + INTRO_MS;
    ctx.sfx('tick');
  }

  function advance(now: number): void {
    if (courseIdx + 1 < allCourses.length) {
      beginCourse(courseIdx + 1, now);
    } else {
      if (cleared === allCourses.length) {
        ctx.achieve('all-bells');
        if (!anyRestart) ctx.achieve('one-shot');
      }
      mode = 'over';
      phaseUntil = now + END_DELAY;
      ctx.sfx('medal');
    }
  }

  function startTopple(now: number): void {
    sim = simulate(path, course, placed);
    toppleStartAt = now;
    mode = 'topple';
    const falls = sim.fallAt.filter((t) => t >= 0);
    const lastFall = falls.length > 0 ? Math.max(...falls) : 0;
    simDoneAt = now + Math.max(lastFall + FALL_MS + 600, sim.bellAt >= 0 ? sim.bellAt + 900 : 0);
    ctx.sfx('start');
    lastEvent = 'topple';
  }

  function settle(now: number): void {
    const s = sim!;
    if (s.bellRung) {
      cleared++;
      const stars = s.starsHit.filter(Boolean).length;
      const leftover = course.stock - placed.length;
      const pts = levelScore(s.fallen, stars, leftover, restarts);
      addScore(pts);
      ctx.achieve('first-bell');
      if (stars === course.stars.length) ctx.achieve('stars-course');
      if (leftover >= ECONOMY_TH) ctx.achieve('economy');
      mode = 'clear';
      phaseUntil = now + CLEAR_MS;
      effects.push({ x: W / 2, y: 300, text: `+${pts}`, color: '#ffd54a', at: now + 150, until: now + 1700 });
      if (restarts > 0) effects.push({ x: W / 2, y: 328, text: `やりなおし −${restarts * 30}`, color: '#ffb3a8', at: now + 350, until: now + 1700 });
      ctx.sfx('success');
      ctx.haptic('success');
      lastEvent = `clear:${pts}`;
    } else {
      restarts++;
      anyRestart = true;
      mode = 'stopped';
      phaseUntil = now + STOP_MS;
      ctx.sfx('fail');
      lastEvent = 'stopped:' + s.stopAfter;
    }
  }

  // ---- 入力 ----
  const offDown = ctx.input.onDown((p: PointerInfo) => {
    if (hostPaused || !started || mode !== 'build') return;
    const l = cv.toLocal(p);
    const now = ctx.now();
    // スタートボタン
    if (l.x >= BTN.x && l.x <= BTN.x + BTN.w && l.y >= BTN.y && l.y <= BTN.y + BTN.h) {
      if (placed.length > 0) startTopple(now);
      else ctx.sfx('tick');
      return;
    }
    // 既存ドミノをはずす（半径は小さめ＝角をまたいだ隣どうしの誤削除を防ぐ。
    // 90°角では弧長9px間隔がXYで約6.4pxまで近づくため、12pxだと隣が消えてしまう）
    for (let i = 0; i < placed.length; i++) {
      const pos = path.posAt(placed[i]!);
      if (Math.hypot(pos.x - l.x, pos.y - l.y) <= 7) {
        placed.splice(i, 1);
        ctx.sfx('tick');
        lastEvent = 'remove';
        return;
      }
    }
    // 置く
    const pr = path.project(l.x, l.y);
    if (pr.dist > 26) return;
    const s = Math.max(2, Math.min(path.len - 3, pr.s));
    for (const e of placed) {
      if (Math.abs(e - s) < MIN_GAP) {
        ctx.sfx('tick');
        lastEvent = 'too-close';
        return;
      }
    }
    if (placed.length >= course.stock) {
      ctx.sfx('tick');
      lastEvent = 'no-stock';
      return;
    }
    placed.push(s);
    ctx.sfx('tap');
    ctx.haptic('light');
    lastEvent = `place:${placed.length}`;
  });

  // ---- 毎フレーム ----
  const offFrame = ctx.onFrame(() => {
    if (hostPaused) return;
    const now = ctx.now();
    if (mode === 'intro' && started && now >= phaseUntil) {
      mode = 'build';
      ctx.sfx('start');
    } else if (mode === 'topple') {
      const s = sim!;
      // 星の獲得ポップ＆ベル
      const t = now - toppleStartAt;
      course.stars.forEach((st, k) => {
        if (s.starsHit[k] && starPopAt[k] === 0) {
          // 星を踏むドミノの倒れ時刻+150ms
          const sorted = [...placed].sort((a, b) => a - b);
          const order = [...placed.keys()].sort((a, b) => placed[a]! - placed[b]!);
          for (let i = 0; i < sorted.length; i++) {
            const fa = s.fallAt[order[i]!] ?? -1;
            if (Math.abs(sorted[i]! - st) <= 7 && fa >= 0 && t >= fa + 150) {
              starPopAt[k] = now;
              ctx.sfx('combo');
              const pos = path.posAt(st);
              effects.push({ x: pos.x, y: pos.y - 18, text: '⭐', color: '#ffd54a', at: now, until: now + 900 });
              break;
            }
          }
        }
      });
      if (s.bellRung && bellSwungAt === 0 && t >= s.bellAt) {
        bellSwungAt = now;
        ctx.sfx('success');
        ctx.haptic('success');
      }
      if (now >= simDoneAt) settle(now);
    } else if (mode === 'stopped' && now >= phaseUntil) {
      mode = 'build';
      sim = null;
      // やり直しに備えて演出状態も戻す（同じコース再挑戦で星⭐/ベルの演出が再生されるように）
      starPopAt = course.stars.map(() => 0);
      bellSwungAt = 0;
    } else if (mode === 'clear' && now >= phaseUntil) {
      advance(now);
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
    void now;
    const r = ctx.root as HTMLElement;
    r.dataset.mode = mode;
    r.dataset.course = String(courseIdx + 1);
    r.dataset.placed = String(placed.length);
    r.dataset.left = String(course.stock - placed.length);
    r.dataset.restarts = String(restarts);
    r.dataset.cleared = String(cleared);
    r.dataset.fallen = sim ? String(sim.fallen) : '0';
    r.dataset.bell = sim && sim.bellRung ? '1' : '0';
    r.dataset.stars = sim ? String(sim.starsHit.filter(Boolean).length) : '0';
    r.dataset.score = String(score);
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
    og.fillStyle = '#2e5f8a';
    og.fillRect(0, 0, W, H);
    og.fillStyle = '#e8f0f8';
    og.fillRect(8, 52, W - 16, 470);
    og.strokeStyle = '#b8825a';
    og.lineWidth = 6;
    og.strokeRect(8, 52, W - 16, 470);
    // コースの道
    og.strokeStyle = '#d5c8a8';
    og.lineWidth = 30;
    og.lineJoin = 'round';
    og.lineCap = 'round';
    og.beginPath();
    course.pts.forEach(([x, y], i) => (i === 0 ? og.moveTo(x, y) : og.lineTo(x, y)));
    og.stroke();
    og.strokeStyle = '#b8a880';
    og.lineWidth = 2;
    // かいだんゾーン
    for (const [a, b] of course.stairs) {
      for (let s = a; s <= b; s += 12) {
        const pos = path.posAt(s);
        const h2 = path.headingAt(s);
        const nx = Math.cos(h2 + Math.PI / 2);
        const ny = Math.sin(h2 + Math.PI / 2);
        og.beginPath();
        og.moveTo(pos.x - nx * 13, pos.y - ny * 13);
        og.lineTo(pos.x + nx * 13, pos.y + ny * 13);
        og.stroke();
      }
    }
    // スタート台
    const sp = path.posAt(0);
    og.fillStyle = '#7ec87a';
    og.beginPath();
    og.arc(sp.x, sp.y, 13, 0, Math.PI * 2);
    og.fill();
    og.fillStyle = '#2a5a30';
    og.font = 'bold 13px sans-serif';
    og.textAlign = 'center';
    og.textBaseline = 'middle';
    og.fillText('▶', sp.x + 1, sp.y + 1);
    // ベル台
    const bp = path.posAt(path.len);
    og.fillStyle = '#e8d5a0';
    og.beginPath();
    og.arc(bp.x, bp.y, 14, 0, Math.PI * 2);
    og.fill();
    og.strokeStyle = '#b8945a';
    og.lineWidth = 2;
    og.stroke();
    // 星スポット
    og.setLineDash([4, 4]);
    og.strokeStyle = '#e0a83c';
    og.lineWidth = 2;
    for (const st of course.stars) {
      const pos = path.posAt(st);
      og.beginPath();
      og.arc(pos.x, pos.y, 10, 0, Math.PI * 2);
      og.stroke();
    }
    og.setLineDash([]);
  }
  bakeStatic();

  function drawDomino(s: number, i: number, now: number): void {
    const pos = path.posAt(s);
    const h2 = path.headingAt(s);
    const fallT = sim && sim.fallAt[i] !== undefined && sim.fallAt[i]! >= 0 ? now - toppleStartAt - sim.fallAt[i]! : -1;
    const p = mode === 'topple' || mode === 'clear' || mode === 'stopped' ? Math.max(0, Math.min(1, fallT / FALL_MS)) : 0;
    g.save();
    g.translate(pos.x, pos.y);
    g.rotate(h2);
    const col = DOMINO_COLORS[i % DOMINO_COLORS.length]!;
    // 影
    g.fillStyle = 'rgba(0,0,0,.18)';
    g.fillRect(-2, 3, 7 + p * 15, 18);
    // 本体（倒れると進行方向にのびる）
    g.fillStyle = col;
    const along = 7 + p * 15;
    g.fillRect(-3, -11, along, 22);
    g.strokeStyle = 'rgba(0,0,0,.35)';
    g.lineWidth = 1.5;
    g.strokeRect(-3, -11, along, 22);
    if (p > 0.5) {
      g.fillStyle = 'rgba(255,255,255,.35)';
      g.fillRect(-3, -11, along, 5);
    }
    g.restore();
  }

  function draw(now: number): void {
    g.drawImage(off, 0, 0, W, H);
    const sorted = [...placed].map((s, i) => ({ s, i })).sort((a, b) => a.s - b.s);

    // リンクの届き表示（build 中のみ）
    if (mode === 'build') {
      const links: { a: number; b: number; ok: boolean }[] = [];
      if (sorted.length > 0) {
        links.push({ a: 0, b: sorted[0]!.s, ok: sorted[0]!.s <= FIRST_REACH });
        for (let k = 0; k + 1 < sorted.length; k++) {
          const g1 = sorted[k]!.s;
          const g2 = sorted[k + 1]!.s;
          links.push({ a: g1, b: g2, ok: g2 - g1 <= reachBetween(path, course, g1, g2) });
        }
        links.push({ a: sorted[sorted.length - 1]!.s, b: path.len, ok: path.len - sorted[sorted.length - 1]!.s <= BELL_REACH });
      }
      for (const lk of links) {
        const pa = path.posAt(lk.a);
        const pb = path.posAt(lk.b);
        g.strokeStyle = lk.ok ? 'rgba(80,170,90,.85)' : 'rgba(220,70,60,.9)';
        g.lineWidth = 3;
        g.setLineDash(lk.ok ? [] : [5, 4]);
        g.beginPath();
        g.moveTo(pa.x, pa.y);
        g.lineTo(pb.x, pb.y);
        g.stroke();
      }
      g.setLineDash([]);
    }

    // ドミノ
    for (const { s, i } of sorted) drawDomino(s, i, now);

    // ベル
    const bp = path.posAt(path.len);
    g.save();
    g.translate(bp.x, bp.y - 4);
    if (bellSwungAt > 0) g.rotate(Math.sin((now - bellSwungAt) / 90) * 0.4 * Math.max(0, 1 - (now - bellSwungAt) / 1200));
    g.fillStyle = '#ffd54a';
    g.beginPath();
    g.arc(0, -2, 8, Math.PI, 0);
    g.lineTo(9, 6);
    g.lineTo(-9, 6);
    g.closePath();
    g.fill();
    g.strokeStyle = '#b8862a';
    g.lineWidth = 1.5;
    g.stroke();
    g.fillStyle = '#b8862a';
    g.beginPath();
    g.arc(0, 8, 2.5, 0, Math.PI * 2);
    g.fill();
    g.restore();

    // うかぶテキスト
    for (const e of effects) {
      if (now < e.at) continue;
      const a = Math.min(1, (e.until - now) / 400);
      g.globalAlpha = Math.max(0, a);
      g.fillStyle = e.color;
      g.font = 'bold 17px sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.strokeStyle = 'rgba(20,40,60,.8)';
      g.lineWidth = 3;
      const rise = ((now - e.at) / 1400) * 22;
      g.strokeText(e.text, e.x, e.y - rise);
      g.fillText(e.text, e.x, e.y - rise);
      g.globalAlpha = 1;
    }

    // ボタンと在庫（build のみ操作可・見た目は topple 中も）
    if (mode === 'build' || mode === 'topple' || mode === 'stopped') {
      const enabled = mode === 'build' && placed.length > 0;
      g.fillStyle = enabled ? '#e0483c' : 'rgba(120,130,145,.7)';
      g.beginPath();
      g.moveTo(BTN.x + 16, BTN.y);
      g.arcTo(BTN.x + BTN.w, BTN.y, BTN.x + BTN.w, BTN.y + BTN.h, 16);
      g.arcTo(BTN.x + BTN.w, BTN.y + BTN.h, BTN.x, BTN.y + BTN.h, 16);
      g.arcTo(BTN.x, BTN.y + BTN.h, BTN.x, BTN.y, 16);
      g.arcTo(BTN.x, BTN.y, BTN.x + BTN.w, BTN.y, 16);
      g.closePath();
      g.fill();
      g.fillStyle = '#fff';
      g.font = 'bold 21px sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(mode === 'topple' ? 'たおれ中…' : 'スタート！', BTN.x + BTN.w / 2, BTN.y + BTN.h / 2);
      g.fillStyle = '#173048';
      g.font = 'bold 14px sans-serif';
      g.textAlign = 'left';
      g.fillText(`のこり 🁢×${course.stock - placed.length}`, 16, BTN.y + 16);
      g.fillText(`はずす＝ドミノをタップ`, 16, BTN.y + 38);
    }

    // バナー
    if (mode === 'intro' && started) {
      banner(`コース ${courseIdx + 1}`, courseIdx === 0 ? 'カーブは つめて置くのがコツ！' : courseIdx === 1 ? 'かいだんは もっと つめて！' : 'ながい道。のこり枚数も かせごう');
    } else if (mode === 'stopped') {
      banner('とまっちゃった…', `赤いリンクを直そう（やりなおし −30）`);
    } else if (mode === 'clear') {
      banner('ベルが なった！', null);
    }

    // HUD
    if (mode !== 'over') {
      g.fillStyle = 'rgba(23,48,72,.92)';
      g.fillRect(0, 0, W, HUD_H);
      g.textBaseline = 'middle';
      g.textAlign = 'left';
      g.fillStyle = '#fff';
      g.font = 'bold 19px sans-serif';
      g.fillText(`${score}てん`, 12, HUD_H / 2);
      g.fillStyle = '#cfe8ff';
      g.font = 'bold 15px sans-serif';
      g.fillText(`コース ${courseIdx + 1}/3`, 118, HUD_H / 2);
      if (restarts > 0) g.fillText(`やりなおし×${restarts}`, 216, HUD_H / 2);
    } else {
      g.fillStyle = 'rgba(23,48,72,.88)';
      g.fillRect(0, 0, W, H);
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = '#fff';
      g.font = 'bold 30px sans-serif';
      g.fillText('おしまい！', W / 2, H / 2 - 56);
      g.font = 'bold 26px sans-serif';
      g.fillText(`${score}てん`, W / 2, H / 2 - 12);
      g.fillStyle = '#ffd54a';
      g.font = 'bold 16px sans-serif';
      g.fillText(`ベル ${cleared}/3`, W / 2, H / 2 + 24);
      if (cleared === 3) g.fillText('ぜんコースクリア！', W / 2, H / 2 + 52);
    }
  }

  function banner(title: string, sub: string | null): void {
    const bw = 312;
    const bh = sub ? 84 : 58;
    const y = 246;
    g.fillStyle = 'rgba(23,48,72,.88)';
    g.beginPath();
    g.moveTo(W / 2 - bw / 2 + 14, y);
    g.arcTo(W / 2 + bw / 2, y, W / 2 + bw / 2, y + bh, 14);
    g.arcTo(W / 2 + bw / 2, y + bh, W / 2 - bw / 2, y + bh, 14);
    g.arcTo(W / 2 - bw / 2, y + bh, W / 2 - bw / 2, y, 14);
    g.arcTo(W / 2 - bw / 2, y, W / 2 + bw / 2, y, 14);
    g.closePath();
    g.fill();
    g.fillStyle = '#fff';
    g.font = 'bold 23px sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(title, W / 2, y + (sub ? 30 : bh / 2));
    if (sub) {
      g.fillStyle = '#ffd57a';
      g.font = 'bold 13px sans-serif';
      g.fillText(sub, W / 2, y + 60);
    }
  }

  draw(ctx.now());
  setData(ctx.now());

  return {
    start() {
      started = true;
      beginCourse(0, ctx.now());
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
