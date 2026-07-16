// =============================================================
// こっそりにんじゃ（No.64）: 見張りの光をよけて しげみからしげみへ 忍びこむステルス
// =============================================================
// - しげみ（ノード）をタップして となりへダッシュ。しげみの上は安全、
//   ダッシュ中に光の扇へ入ると「みつかった！」（ライフ3・もどされる）。
// - ステージ・扇の角度・安全窓の保証は logic.ts（純ロジック・位相のみ rng）。
// - 全画面 Canvas・onTap のみ（onMove 非購読）。時間は ctx.now 期限方式・setTimeout 不使用。
// - import してよいのは game-api（types / helpers）と、このフォルダ内（logic）だけ
import type { GameContext, IGame } from '../../game-api/types';
import {
  CLEAR_PTS,
  DANGO_PTS,
  DASH_SPEED,
  NO_FOUND_PTS,
  type StageDef,
  TIME_BASE,
  TIME_PTS,
  guardDir,
  makeStages,
  pickPhases,
  pointInCone,
} from './logic';

const W = 360;
const H = 640;
const HUD_H = 44;
const NODE_R = 21;
const TAP_R = 36;
const GRACE_MS = 1200;
const SCORE_HI = 700;

type Mode = 'play' | 'clear' | 'over';

interface Dash {
  from: number;
  to: number;
  t0: number;
  durMs: number;
}

export function createGame(ctx: GameContext): IGame {
  const cv = ctx.canvas2d({ design: { w: W, h: H } });
  const g = cv.ctx;
  const stages = makeStages();

  let mode: Mode = 'play';
  let hostPaused = false;
  let si = 0;
  let stage: StageDef = stages[0]!;
  let phases: number[] = [0];
  let node = stage.start;
  let dash: Dash | null = null;
  let lives = 3;
  let score = 0;
  let dangoLeft = new Set<number>();
  let dangoGot = 0;
  let caughtInStage = false;
  let caughtTotal = 0;
  let stageStart = 0;
  let introUntil = 0;
  let graceUntil = 0;
  let flashUntil = 0;
  let foundGi = -1;
  let nextAt = 0;
  let endAt = 0;
  let ended = false;
  let overText = '';
  let overSub = '';

  function initStage(idx: number, now: number): void {
    si = idx;
    stage = stages[idx]!;
    phases = pickPhases(stage, ctx.random);
    node = stage.start;
    dash = null;
    dangoLeft = new Set(stage.dango);
    dangoGot = 0;
    caughtInStage = false;
    stageStart = now;
    introUntil = now + 1400;
    graceUntil = 0;
    mode = 'play';
  }

  function addScore(n: number): void {
    score += n;
    if (score >= SCORE_HI) ctx.achieve('score-hi');
  }

  const adjacent = (a: number, b: number): boolean => stage.edges.some(([x, y]) => (x === a && y === b) || (x === b && y === a));

  function ninjaPos(now: number): { x: number; y: number } {
    if (!dash) {
      const n = stage.nodes[node]!;
      return { x: n.x, y: n.y };
    }
    const p = Math.min(1, (now - dash.t0) / dash.durMs);
    const a = stage.nodes[dash.from]!;
    const b = stage.nodes[dash.to]!;
    return { x: a.x + (b.x - a.x) * p, y: a.y + (b.y - a.y) * p };
  }

  function arrive(now: number): void {
    if (dangoLeft.has(node)) {
      dangoLeft.delete(node);
      dangoGot++;
      addScore(DANGO_PTS);
      ctx.sfx('combo');
      ctx.haptic('light');
      if (dangoGot >= stage.dango.length) ctx.achieve('dango-stage');
    }
    if (node === stage.goal) stageClear(now);
  }

  function stageClear(now: number): void {
    const sec = (now - stageStart) / 1000;
    addScore(CLEAR_PTS + (caughtInStage ? 0 : NO_FOUND_PTS) + Math.max(0, TIME_BASE - Math.floor(sec)) * TIME_PTS);
    ctx.achieve('first-clear');
    if (!caughtInStage) ctx.achieve('no-found');
    ctx.haptic('success');
    if (si >= stages.length - 1) {
      ctx.achieve('all-clear');
      if (caughtTotal === 0) ctx.achieve('ghost-run');
      mode = 'over';
      overText = 'くらに とうちゃく！';
      overSub = 'おみごと！';
      endAt = now + 2000;
      ctx.sfx('medal');
    } else {
      mode = 'clear';
      nextAt = now + 1500;
      ctx.sfx('success');
    }
  }

  function caught(gi: number, now: number): void {
    lives--;
    caughtTotal++;
    caughtInStage = true;
    foundGi = gi;
    flashUntil = now + 700;
    node = dash ? dash.from : node;
    dash = null;
    graceUntil = now + GRACE_MS;
    ctx.sfx('fail');
    ctx.haptic('error');
    if (lives <= 0) {
      mode = 'over';
      overText = 'つかまった…';
      overSub = 'ここまでの きろくで おわるよ';
      endAt = now + 1900;
    }
  }

  // ---- 入力 ----
  const offTap = ctx.input.onTap((p) => {
    if (hostPaused || mode !== 'play' || dash) return;
    const l = cv.toLocal(p);
    let best = -1;
    let bestD = TAP_R;
    stage.nodes.forEach((n, i) => {
      const d = Math.hypot(n.x - l.x, n.y - l.y);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    if (best < 0 || best === node || !adjacent(node, best)) return;
    const now = ctx.now();
    const a = stage.nodes[node]!;
    const b = stage.nodes[best]!;
    dash = { from: node, to: best, t0: now, durMs: (Math.hypot(b.x - a.x, b.y - a.y) / DASH_SPEED) * 1000 };
    ctx.sfx('tap');
  });

  // ---- 毎フレーム ----
  const offFrame = ctx.onFrame(() => {
    if (hostPaused) return;
    const now = ctx.now();
    if (mode === 'play') {
      const tSec = (now - stageStart) / 1000;
      if (dash) {
        if (now >= dash.t0 + dash.durMs) {
          node = dash.to;
          dash = null;
          arrive(now);
        } else if (now >= graceUntil) {
          const pos = ninjaPos(now);
          for (let gi = 0; gi < stage.guards.length; gi++) {
            const gd = stage.guards[gi]!;
            if (pointInCone(gd, guardDir(gd, tSec, phases[gi] ?? 0), pos.x, pos.y)) {
              caught(gi, now);
              break;
            }
          }
        }
      }
    } else if (mode === 'clear') {
      if (now >= nextAt) initStage(si + 1, now);
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
    r.dataset.si = String(si);
    r.dataset.score = String(score);
    r.dataset.lives = String(lives);
    r.dataset.node = String(node);
    r.dataset.dashing = dash ? '1' : '0';
    r.dataset.dango = String(dangoGot);
    r.dataset.dangototal = String(stage.dango.length);
    r.dataset.caught = String(caughtTotal);
    r.dataset.phases = phases.map((p) => p.toFixed(4)).join(',');
    r.dataset.tstage = String(Math.round(now - stageStart));
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
    const tSec = (now - stageStart) / 1000;
    // 夜空と庭
    g.fillStyle = '#0a1024';
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#0e1a30';
    g.fillRect(0, 260, W, H - 260);
    g.fillStyle = '#0d2018';
    g.fillRect(0, 470, W, H - 470);
    // 星（決定的な固定配置）
    g.fillStyle = 'rgba(240,240,255,.5)';
    for (let i = 0; i < 24; i++) {
      const sx = (i * 97 + 31) % W;
      const sy = 50 + ((i * 61) % 190);
      g.fillRect(sx, sy, 2, 2);
    }
    // 月（左上・ポーズ予約領域は右上なので触らない）
    g.fillStyle = '#f2ecca';
    g.beginPath();
    g.arc(42, 88, 17, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#0a1024';
    g.beginPath();
    g.arc(49, 83, 14, 0, Math.PI * 2);
    g.fill();

    // エッジ（道すじ）
    for (const [a, b] of stage.edges) {
      const na = stage.nodes[a]!;
      const nb = stage.nodes[b]!;
      const active = mode === 'play' && !dash && (a === node || b === node);
      g.strokeStyle = active ? `rgba(130,230,170,${0.45 + 0.2 * Math.sin(now / 200)})` : 'rgba(255,255,255,.13)';
      g.lineWidth = active ? 3 : 2;
      g.setLineDash([6, 7]);
      g.beginPath();
      g.moveTo(na.x, na.y);
      g.lineTo(nb.x, nb.y);
      g.stroke();
    }
    g.setLineDash([]);

    // 見張りの光の扇
    for (let gi = 0; gi < stage.guards.length; gi++) {
      const gd = stage.guards[gi]!;
      const dir = guardDir(gd, tSec, phases[gi] ?? 0);
      const grad = g.createRadialGradient(gd.x, gd.y, 8, gd.x, gd.y, gd.r);
      grad.addColorStop(0, 'rgba(255,208,90,.36)');
      grad.addColorStop(1, 'rgba(255,208,90,.03)');
      g.fillStyle = grad;
      g.beginPath();
      g.moveTo(gd.x, gd.y);
      g.arc(gd.x, gd.y, gd.r, dir - gd.half, dir + gd.half);
      g.closePath();
      g.fill();
      g.strokeStyle = 'rgba(255,208,90,.25)';
      g.lineWidth = 1.5;
      g.stroke();
      // 見張り本体（ちょうちん持ちのおに）
      g.fillStyle = '#b6483a';
      g.beginPath();
      g.arc(gd.x, gd.y, 13, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#fff';
      g.beginPath();
      g.arc(gd.x - 4, gd.y - 2, 3, 0, Math.PI * 2);
      g.arc(gd.x + 4, gd.y - 2, 3, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#301010';
      g.beginPath();
      g.arc(gd.x - 4 + Math.cos(dir) * 1.4, gd.y - 2 + Math.sin(dir) * 1.4, 1.5, 0, Math.PI * 2);
      g.arc(gd.x + 4 + Math.cos(dir) * 1.4, gd.y - 2 + Math.sin(dir) * 1.4, 1.5, 0, Math.PI * 2);
      g.fill();
      if (foundGi === gi && now < flashUntil) {
        g.fillStyle = '#ffd76a';
        g.font = 'bold 26px sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText('！', gd.x, gd.y - 26);
      }
    }

    // ノード（しげみ・スタート・くら）
    stage.nodes.forEach((n, i) => {
      if (i === stage.goal) {
        // くら（白かべの倉）
        g.fillStyle = '#6b4a2f';
        g.beginPath();
        g.moveTo(n.x - 34, n.y - 8);
        g.lineTo(n.x, n.y - 30);
        g.lineTo(n.x + 34, n.y - 8);
        g.closePath();
        g.fill();
        g.fillStyle = '#ece6d4';
        g.fillRect(n.x - 27, n.y - 8, 54, 32);
        g.fillStyle = '#4a3a28';
        g.fillRect(n.x - 8, n.y + 6, 16, 18);
        g.fillStyle = '#8a6a45';
        g.font = 'bold 11px sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText('くら', n.x, n.y - 0);
        return;
      }
      const isStart = i === stage.start;
      g.fillStyle = isStart ? '#3a3550' : '#173d24';
      g.beginPath();
      g.arc(n.x, n.y, NODE_R, 0, Math.PI * 2);
      g.fill();
      if (!isStart) {
        g.fillStyle = '#1e5230';
        g.beginPath();
        g.arc(n.x - 6, n.y - 5, 9, 0, Math.PI * 2);
        g.arc(n.x + 7, n.y - 3, 8, 0, Math.PI * 2);
        g.arc(n.x, n.y + 5, 10, 0, Math.PI * 2);
        g.fill();
      }
      // となり候補のハイライト
      if (mode === 'play' && !dash && adjacent(node, i)) {
        g.strokeStyle = 'rgba(130,230,170,.9)';
        g.lineWidth = 2.5;
        g.beginPath();
        g.arc(n.x, n.y, NODE_R + 5 + Math.sin(now / 180) * 2, 0, Math.PI * 2);
        g.stroke();
      }
      if (dangoLeft.has(i)) {
        g.font = '17px sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText('🍡', n.x, n.y - NODE_R - 11);
      }
    });

    // にんじゃ
    const pos = ninjaPos(now);
    const blink = now < graceUntil && Math.floor(now / 120) % 2 === 1;
    if (!blink) {
      if (dash) {
        // ざんぞう
        const a = stage.nodes[dash.from]!;
        g.strokeStyle = 'rgba(120,140,220,.35)';
        g.lineWidth = 6;
        g.beginPath();
        g.moveTo(a.x, a.y);
        g.lineTo(pos.x, pos.y);
        g.stroke();
      }
      g.fillStyle = '#232840';
      g.beginPath();
      g.arc(pos.x, pos.y, 14, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#3d4568';
      g.fillRect(pos.x - 12, pos.y - 7, 24, 9);
      g.fillStyle = '#fff';
      g.beginPath();
      g.arc(pos.x - 5, pos.y - 2.5, 3.2, 0, Math.PI * 2);
      g.arc(pos.x + 5, pos.y - 2.5, 3.2, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#151a2e';
      g.beginPath();
      g.arc(pos.x - 5, pos.y - 2.5, 1.6, 0, Math.PI * 2);
      g.arc(pos.x + 5, pos.y - 2.5, 1.6, 0, Math.PI * 2);
      g.fill();
      // 赤いマフラー
      g.fillStyle = '#d3455e';
      g.fillRect(pos.x - 8, pos.y + 6, 16, 4);
    }

    // 見つかったフラッシュ
    if (now < flashUntil) {
      g.fillStyle = 'rgba(255,70,70,.14)';
      g.fillRect(0, 0, W, H);
    }

    // HUD
    g.fillStyle = '#0c1426';
    g.fillRect(0, 0, W, HUD_H);
    g.textBaseline = 'middle';
    g.textAlign = 'left';
    g.fillStyle = '#fff';
    g.font = 'bold 19px sans-serif';
    g.fillText(`${score}てん`, 12, HUD_H / 2);
    g.font = 'bold 15px sans-serif';
    g.fillText('🍙'.repeat(Math.max(0, lives)), 108, HUD_H / 2);
    g.fillStyle = '#9fb2e8';
    g.fillText(`ステージ${si + 1}/3`, 176, HUD_H / 2);
    g.fillText(`🍡${dangoGot}/${stage.dango.length}`, 276, HUD_H / 2);

    // 下のヒント
    g.textAlign = 'center';
    g.fillStyle = 'rgba(200,214,255,.75)';
    g.font = 'bold 13px sans-serif';
    g.fillText('ひかりを よけて、しげみを タップで ダッシュ！', W / 2, 614);

    // バナー
    let banner = '';
    let sub = '';
    if (mode === 'play' && now < introUntil) {
      banner = `ステージ${si + 1}`;
      sub = 'ひかりを よけて くらへ！';
    } else if (mode === 'clear') {
      banner = 'クリア！';
      sub = 'つぎの にわへ…';
    } else if (mode === 'over') {
      banner = overText;
      sub = overSub;
    }
    if (banner) {
      g.fillStyle = 'rgba(5,10,26,.62)';
      roundRect(40, 250, W - 80, 112, 16);
      g.fill();
      g.fillStyle = '#fff';
      g.font = 'bold 29px sans-serif';
      g.fillText(banner, W / 2, 296);
      g.fillStyle = '#cfd8ff';
      g.font = 'bold 15px sans-serif';
      g.fillText(sub, W / 2, 332);
    }
  }

  draw(0);

  return {
    start() {
      initStage(0, ctx.now());
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
