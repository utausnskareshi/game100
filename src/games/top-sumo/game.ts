// =============================================================
// コマずもう（No.85）: まわるコマの土俵ずもう3番勝負（スワイプ＝体当たり）
// =============================================================
// - ドラッグ→はなす＝その方向へ体当たり（長く引くほど強い）。1回ごとに
//   回転力を消費＝連打すると自分が先に止まる（アンチ連打の資源管理）。
// - 回転力は重さ: 多いほど衝突で押し勝つ（logic.ts の有効質量つき弾性衝突）。
//   おしだし or 相手の回転切れで勝ち。CPU 3段階の3番勝負・負けたら興行終了。
// - 物理・CPU・採点は logic.ts（純ロジック・rng は cpuDecide のみ消費＝決定論）。
// - 全画面 Canvas・時間は ctx.now 期限方式・setTimeout 不使用。
// - import してよいのは game-api（types / helpers）と、このフォルダ内（logic）だけ
import type { GameContext, IGame, PointerInfo } from '../../game-api/types';
import {
  CHAMPION_BONUS,
  CPU_LEVELS,
  H,
  OUT_R,
  RING,
  SCORE_HI,
  SPIN_MAX,
  TOP_R,
  type Top,
  W,
  applySwipe,
  boutScore,
  canSwipe,
  collide,
  cpuDecide,
  outVerdict,
  spinVerdict,
  stepTop,
} from './logic';

const HUD_H = 40;
const INTRO_MS = 1600;
const NOKOTTA_MS = 650;
const SETTLE_MS = 950;
const RESULT_MS = 1700;
const END_DELAY = 2000;
const SUB = 1 / 120;

type Mode = 'intro' | 'fight' | 'settle' | 'result' | 'over';

interface Spark {
  x: number;
  y: number;
  at: number;
  power: number;
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

  let mode: Mode = 'intro';
  let started = false;
  let hostPaused = false;
  let ended = false;
  let bout = 0; // 0..2
  let wins = 0;
  let score = 0;
  let phaseUntil = 0;
  let nokottaUntil = 0;
  let fightStartAt = 0;
  let nextDecideAt = 0;
  let acc = 0;
  let swipes = 0; // この取組の体当たり回数
  let rotP = 0;
  let rotC = 0;
  let cause: 'push' | 'spin' = 'push';
  let boutWinner: 'player' | 'cpu' = 'player';
  let boutPts = 0;
  let settleAt = 0;
  let sparks: Spark[] = [];
  let effects: FloatFx[] = [];
  let dust: { x: number; y: number; at: number } | null = null;
  let lastEvent = '';
  // ドラッグ（最初の指だけ追う）
  let dragId = -1;
  let dragFrom: { x: number; y: number } | null = null;
  let dragCur: { x: number; y: number } | null = null;

  let player: Top = { x: RING.x, y: RING.y + 72, vx: 0, vy: 0, spin: SPIN_MAX };
  let cpu: Top = { x: RING.x, y: RING.y - 72, vx: 0, vy: 0, spin: SPIN_MAX };

  function addScore(n: number): void {
    score += n;
    if (score >= SCORE_HI) ctx.achieve('score-hi');
  }

  function resetBout(idx: number, now: number): void {
    bout = idx;
    swipes = 0;
    player = { x: RING.x, y: RING.y + 72, vx: 0, vy: 0, spin: SPIN_MAX };
    cpu = { x: RING.x, y: RING.y - 72, vx: 0, vy: 0, spin: SPIN_MAX };
    sparks = [];
    dust = null;
    dragId = -1;
    dragFrom = null;
    dragCur = null;
    mode = 'intro';
    phaseUntil = now + INTRO_MS;
    ctx.sfx('tick');
  }

  function decideBout(winner: 'player' | 'cpu', cz: 'push' | 'spin', now: number): void {
    mode = 'settle';
    phaseUntil = now + SETTLE_MS;
    settleAt = now;
    boutWinner = winner;
    cause = cz;
    boutPts = 0;
    if (winner === 'player') {
      const ms = now - fightStartAt;
      boutPts = boutScore(bout, cz, player.spin, ms);
      addScore(boutPts);
      wins++;
      ctx.achieve('first-win');
      if (cz === 'push') ctx.achieve('push-out');
      if (swipes <= 3) ctx.achieve('few-swipe');
      // 自然減衰3/s＋体当たりコストがあるため 50 残しで十分「圧勝」（70はボット実証で不到達＝恒偽）
      if (player.spin >= 50) ctx.achieve('spin-rich');
      if (wins === 3) {
        ctx.achieve('champion');
        addScore(CHAMPION_BONUS);
        effects.push({ x: W / 2, y: 330, text: `ゆうしょう +${CHAMPION_BONUS}`, color: '#ffd54a', at: now + 400, until: now + 1900 });
      }
      ctx.sfx('success');
      ctx.haptic('success');
      lastEvent = `win:${cz}:${boutPts}:spin${player.spin.toFixed(1)}:swipes${swipes}`;
    } else {
      ctx.sfx('fail');
      ctx.haptic('error');
      lastEvent = `lose:${cz}`;
    }
    if (cz === 'push') {
      const loser = winner === 'player' ? cpu : player;
      dust = { x: loser.x, y: loser.y, at: now };
    }
  }

  // ---- 入力（ドラッグ→はなす＝体当たり） ----
  const offDown = ctx.input.onDown((p: PointerInfo) => {
    if (hostPaused || !started || mode !== 'fight' || dragId !== -1) return;
    dragId = p.id;
    dragFrom = cv.toLocal(p);
    dragCur = dragFrom;
  });
  const offMove = ctx.input.onMove((p: PointerInfo) => {
    if (p.id !== dragId) return;
    dragCur = cv.toLocal(p);
  });
  const offUp = ctx.input.onUp((p: PointerInfo) => {
    if (p.id !== dragId) return;
    const from = dragFrom;
    const cur = cv.toLocal(p);
    dragId = -1;
    dragFrom = null;
    dragCur = null;
    if (hostPaused || !started || mode !== 'fight' || !from) return;
    const dx = cur.x - from.x;
    const dy = cur.y - from.y;
    const len = Math.hypot(dx, dy);
    if (len < 16) return; // ただのタップはなにもしない
    const power = Math.min(1, Math.max(0.12, (len - 16) / 130));
    const now = ctx.now();
    if (!canSwipe(player, power)) {
      effects.push({ x: player.x, y: player.y - 34, text: '回転力がたりない！', color: '#ff8a8a', at: now, until: now + 900 });
      ctx.sfx('tick');
      lastEvent = 'fizzle';
      return;
    }
    applySwipe(player, dx, dy, power);
    swipes++;
    ctx.sfx('tap');
    ctx.haptic('light');
    lastEvent = `swipe:${power.toFixed(2)}`;
  });

  // ---- 毎フレーム ----
  const offFrame = ctx.onFrame((dt: number) => {
    if (hostPaused) return;
    const now = ctx.now();
    if (mode === 'intro' && started && now >= phaseUntil) {
      mode = 'fight';
      fightStartAt = now;
      nextDecideAt = now + 420; // 立ち合いの間
      nokottaUntil = now + NOKOTTA_MS;
      acc = 0;
      ctx.sfx('start');
    } else if (mode === 'fight') {
      // CPU の意思決定（rng 消費はここだけ）
      if (now >= nextDecideAt) {
        const lv = CPU_LEVELS[bout]!;
        const act = cpuDecide(cpu, player, lv, ctx.random);
        nextDecideAt = now + lv.cadenceMs;
        if (act && canSwipe(cpu, act.power01)) {
          applySwipe(cpu, act.dx, act.dy, act.power01);
        }
      }
      // 物理（固定サブステップ）
      acc += dt;
      while (acc >= SUB && mode === 'fight') {
        acc -= SUB;
        stepTop(player, SUB);
        stepTop(cpu, SUB);
        const c = collide(player, cpu);
        if (c !== null && c > 50) {
          sparks.push({ x: (player.x + cpu.x) / 2, y: (player.y + cpu.y) / 2, at: now, power: c });
          ctx.sfx(c > 280 ? 'combo' : 'tap');
          if (c > 280) ctx.haptic('medium');
        }
        const ov = outVerdict(player, cpu);
        if (ov !== 'none') {
          decideBout(ov === 'cpu' ? 'player' : 'cpu', 'push', now);
          break;
        }
        const sv = spinVerdict(player, cpu);
        if (sv !== 'none') {
          decideBout(sv === 'cpu' ? 'player' : 'cpu', 'spin', now);
          break;
        }
      }
    } else if (mode === 'settle') {
      // 敗者だけ滑走・回転して倒れる（勝者はその場で回りつづける）
      const loser = boutWinner === 'player' ? cpu : player;
      if (cause === 'push') {
        loser.x += loser.vx * dt;
        loser.y += loser.vy * dt;
        loser.vx *= Math.exp(-0.6 * dt);
        loser.vy *= Math.exp(-0.6 * dt);
      }
      if (now >= phaseUntil) {
        mode = 'result';
        phaseUntil = now + RESULT_MS;
      }
    } else if (mode === 'result' && now >= phaseUntil) {
      if (boutWinner === 'player' && bout + 1 < CPU_LEVELS.length) {
        resetBout(bout + 1, now);
      } else {
        mode = 'over';
        phaseUntil = now + END_DELAY;
        ctx.sfx(wins === 3 ? 'medal' : 'fail');
      }
    } else if (mode === 'over' && !ended && now >= phaseUntil) {
      ended = true;
      ctx.end({ score });
      return;
    }
    rotP += player.spin * 0.24 * dt;
    rotC += cpu.spin * 0.24 * dt;
    sparks = sparks.filter((s) => now - s.at < 300);
    effects = effects.filter((e) => e.until > now);
    draw(now);
    setData(now);
  });

  function setData(now: number): void {
    if (!import.meta.env.DEV) return;
    void now;
    const r = ctx.root as HTMLElement;
    r.dataset.mode = mode;
    r.dataset.bout = String(bout + 1);
    r.dataset.wins = String(wins);
    r.dataset.swipes = String(swipes);
    r.dataset.score = String(score);
    r.dataset.px = player.x.toFixed(1);
    r.dataset.py = player.y.toFixed(1);
    r.dataset.pspin = player.spin.toFixed(2);
    r.dataset.cx = cpu.x.toFixed(1);
    r.dataset.cy = cpu.y.toFixed(1);
    r.dataset.cspin = cpu.spin.toFixed(2);
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
    // 会場（暗めの館内）
    const bg = og.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#2b2145');
    bg.addColorStop(0.6, '#211a35');
    bg.addColorStop(1, '#191428');
    og.fillStyle = bg;
    og.fillRect(0, 0, W, H);
    // 観客のあかり（ぼんやり）
    og.fillStyle = 'rgba(255,214,120,.06)';
    for (let i = 0; i < 26; i++) {
      const x = (i * 53 + 17) % W;
      const y = 60 + ((i * 97) % 90);
      og.beginPath();
      og.arc(x, y, 8 + (i % 3) * 3, 0, Math.PI * 2);
      og.fill();
    }
    // 土俵のかげ
    og.fillStyle = 'rgba(0,0,0,.4)';
    og.beginPath();
    og.ellipse(RING.x, RING.y + 10, RING.r + 20, RING.r * 0.98 + 14, 0, 0, Math.PI * 2);
    og.fill();
    // 俵（外周ロープ）
    og.strokeStyle = '#7c5a2c';
    og.lineWidth = 11;
    og.beginPath();
    og.arc(RING.x, RING.y, RING.r + 5, 0, Math.PI * 2);
    og.stroke();
    // 砂の面
    og.fillStyle = '#d8b56a';
    og.beginPath();
    og.arc(RING.x, RING.y, RING.r, 0, Math.PI * 2);
    og.fill();
    // 砂の質感
    og.fillStyle = 'rgba(122,90,40,.18)';
    for (let i = 0; i < 46; i++) {
      const a = (i * 2.399) % (Math.PI * 2);
      const rr = ((i * 61) % 100) / 100;
      og.beginPath();
      og.arc(RING.x + Math.cos(a) * RING.r * rr * 0.92, RING.y + Math.sin(a) * RING.r * rr * 0.92, 1.6, 0, Math.PI * 2);
      og.fill();
    }
    // 勝負俵の内円（アウトライン目安）
    og.strokeStyle = 'rgba(122,90,40,.5)';
    og.lineWidth = 2;
    og.beginPath();
    og.arc(RING.x, RING.y, OUT_R, 0, Math.PI * 2);
    og.stroke();
    // 仕切り線
    og.strokeStyle = 'rgba(245,240,225,.85)';
    og.lineWidth = 4;
    og.lineCap = 'round';
    og.beginPath();
    og.moveTo(RING.x - 16, RING.y - 20);
    og.lineTo(RING.x - 16, RING.y + 20);
    og.moveTo(RING.x + 16, RING.y - 20);
    og.lineTo(RING.x + 16, RING.y + 20);
    og.stroke();
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

  function drawTop(t: Top, rot: number, body: string, rim: string, blade: string, now: number, fall01: number): void {
    // 影
    g.fillStyle = 'rgba(0,0,0,.3)';
    g.beginPath();
    g.ellipse(t.x, t.y + TOP_R * 0.6, TOP_R * 0.95, TOP_R * 0.38, 0, 0, Math.PI * 2);
    g.fill();
    const wob = Math.max(0, (26 - t.spin) / 26);
    const ox = Math.sin(now / 85) * wob * 3;
    g.save();
    g.translate(t.x + ox, t.y);
    g.rotate(Math.sin(now / 95) * wob * 0.18 + fall01 * 1.15);
    g.scale(1, 1 - wob * 0.12 - fall01 * 0.45);
    g.fillStyle = body;
    g.beginPath();
    g.arc(0, 0, TOP_R, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = rim;
    g.lineWidth = 2.5;
    g.stroke();
    // 回転ブレード（3点＋うすい軌跡リング）
    g.strokeStyle = 'rgba(255,255,255,.22)';
    g.lineWidth = 3;
    g.beginPath();
    g.arc(0, 0, 11, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = blade;
    for (let i = 0; i < 3; i++) {
      const a = rot + (i * Math.PI * 2) / 3;
      g.beginPath();
      g.arc(Math.cos(a) * 11, Math.sin(a) * 11, 4, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = '#f5f2e8';
    g.beginPath();
    g.arc(0, 0, 4.5, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }

  function spinBar(x: number, y: number, w: number, label: string, spin: number, color: string): void {
    g.fillStyle = 'rgba(10,8,20,.65)';
    rrect(x - 4, y - 12, w + 64, 24, 10);
    g.fill();
    g.fillStyle = '#e8e4f5';
    g.font = 'bold 12px sans-serif';
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.fillText(label, x, y);
    const bx = x + 44;
    g.fillStyle = 'rgba(255,255,255,.14)';
    rrect(bx, y - 6, w, 12, 6);
    g.fill();
    const ratio = Math.max(0, Math.min(1, spin / SPIN_MAX));
    if (ratio > 0) {
      g.fillStyle = ratio < 0.25 ? '#ff7a7a' : color;
      rrect(bx, y - 6, Math.max(6, w * ratio), 12, 6);
      g.fill();
    }
  }

  function banner(title: string, sub: string | null, y: number): void {
    const bw = 300;
    const bh = sub ? 88 : 58;
    g.fillStyle = 'rgba(14,10,26,.86)';
    rrect(W / 2 - bw / 2, y, bw, bh, 16);
    g.fill();
    g.strokeStyle = 'rgba(255,214,120,.55)';
    g.lineWidth = 1.5;
    rrect(W / 2 - bw / 2, y, bw, bh, 16);
    g.stroke();
    g.fillStyle = '#ffffff';
    g.font = 'bold 24px sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(title, W / 2, y + (sub ? 32 : bh / 2));
    if (sub) {
      g.fillStyle = '#ffd57a';
      g.font = 'bold 14px sans-serif';
      g.fillText(sub, W / 2, y + 62);
    }
  }

  function draw(now: number): void {
    g.drawImage(off, 0, 0, W, H);

    // おしだしの土けむり
    if (dust) {
      const t = (now - dust.at) / 600;
      if (t < 1) {
        g.strokeStyle = `rgba(216,181,106,${(1 - t) * 0.9})`;
        g.lineWidth = 5;
        g.beginPath();
        g.arc(dust.x, dust.y, 14 + t * 46, 0, Math.PI * 2);
        g.stroke();
      }
    }

    // コマ（相手→自分の順で描く）
    const fallC = mode !== 'fight' && boutWinner === 'player' && cause === 'spin' ? Math.min(1, (now - settleAt) / 700) : 0;
    const fallP = mode !== 'fight' && boutWinner === 'cpu' && cause === 'spin' ? Math.min(1, (now - settleAt) / 700) : 0;
    if (mode !== 'intro') {
      drawTop(cpu, rotC, '#e0483c', '#8a2018', '#ffd0c2', now, fallC);
      drawTop(player, rotP, '#3d7df0', '#1e3f85', '#cfe2ff', now, fallP);
    } else {
      drawTop(cpu, rotC, '#e0483c', '#8a2018', '#ffd0c2', now, 0);
      drawTop(player, rotP, '#3d7df0', '#1e3f85', '#cfe2ff', now, 0);
    }

    // 衝突スパーク
    for (const s of sparks) {
      const t = (now - s.at) / 300;
      const rr = 6 + t * 16;
      g.strokeStyle = `rgba(255,230,150,${(1 - t) * 0.95})`;
      g.lineWidth = 2.5;
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 + 0.4;
        g.beginPath();
        g.moveTo(s.x + Math.cos(a) * rr * 0.5, s.y + Math.sin(a) * rr * 0.5);
        g.lineTo(s.x + Math.cos(a) * (rr + Math.min(10, s.power / 30)), s.y + Math.sin(a) * (rr + Math.min(10, s.power / 30)));
        g.stroke();
      }
    }

    // ドラッグの照準（体当たりの方向と強さ）
    if (dragFrom && dragCur && mode === 'fight') {
      const dx = dragCur.x - dragFrom.x;
      const dy = dragCur.y - dragFrom.y;
      const len = Math.hypot(dx, dy);
      if (len >= 16) {
        const power = Math.min(1, Math.max(0.12, (len - 16) / 130));
        const ok = canSwipe(player, power);
        const al = 26 + power * 62;
        const nx = dx / len;
        const ny = dy / len;
        g.strokeStyle = ok ? 'rgba(126,230,255,.95)' : 'rgba(255,122,122,.95)';
        g.lineWidth = 4;
        g.lineCap = 'round';
        g.beginPath();
        g.moveTo(player.x, player.y);
        g.lineTo(player.x + nx * al, player.y + ny * al);
        g.stroke();
        // やじり
        const ax = player.x + nx * al;
        const ay = player.y + ny * al;
        g.beginPath();
        g.moveTo(ax + nx * 10, ay + ny * 10);
        g.lineTo(ax - ny * 6 , ay + nx * 6);
        g.lineTo(ax + ny * 6, ay - nx * 6);
        g.closePath();
        g.fillStyle = ok ? 'rgba(126,230,255,.95)' : 'rgba(255,122,122,.95)';
        g.fill();
      }
    }

    // うかぶテキスト
    for (const e of effects) {
      if (now < e.at) continue;
      const a = Math.min(1, (e.until - now) / 400);
      const rise = ((now - e.at) / 900) * 18;
      g.globalAlpha = Math.max(0, a);
      g.fillStyle = e.color;
      g.font = 'bold 15px sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.strokeStyle = 'rgba(14,10,26,.8)';
      g.lineWidth = 3;
      g.strokeText(e.text, e.x, e.y - rise);
      g.fillText(e.text, e.x, e.y - rise);
      g.globalAlpha = 1;
    }

    // バナー類
    if (mode === 'intro' && started) {
      banner(`だい${bout + 1}ばん`, `${CPU_LEVELS[bout]!.name}　はっけよい…`, 220);
    } else if (mode === 'fight' && now < nokottaUntil) {
      g.fillStyle = 'rgba(255,255,255,.96)';
      g.font = 'bold 34px sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.strokeStyle = 'rgba(14,10,26,.8)';
      g.lineWidth = 6;
      g.strokeText('のこった！', W / 2, 200);
      g.fillText('のこった！', W / 2, 200);
    } else if (mode === 'result') {
      if (boutWinner === 'player') {
        banner('しろぼし！', `${cause === 'push' ? 'おしだし' : 'あいての回転切れ'}　+${boutPts}てん`, 220);
      } else {
        banner('まけ…', cause === 'push' ? 'おしだされた…' : '回転力が切れた…', 220);
      }
    }

    // HUD
    if (mode !== 'over') {
      g.fillStyle = 'rgba(12,9,24,.9)';
      g.fillRect(0, 0, W, HUD_H);
      g.textBaseline = 'middle';
      g.textAlign = 'left';
      g.fillStyle = '#ffffff';
      g.font = 'bold 19px sans-serif';
      g.fillText(`${score}てん`, 12, HUD_H / 2);
      g.fillStyle = '#d9d2ee';
      g.font = 'bold 14px sans-serif';
      g.fillText(`だい${bout + 1}ばん ${CPU_LEVELS[bout]!.name}`, 108, HUD_H / 2);
      // 星取り（3取組）
      for (let i = 0; i < 3; i++) {
        g.beginPath();
        g.arc(258 + i * 15, HUD_H / 2, 5, 0, Math.PI * 2);
        if (i < wins) {
          g.fillStyle = '#ffd54a';
          g.fill();
        } else {
          g.strokeStyle = 'rgba(255,255,255,.4)';
          g.lineWidth = 1.5;
          g.stroke();
        }
      }
      // 回転力ゲージ（上=あいて / 下=あなた）
      spinBar(16, 58, 220, 'あいて', cpu.spin, '#e0483c');
      spinBar(16, H - 24, 220, 'あなた', player.spin, '#4a9df0');
    }

    // 結果オーバーレイ
    if (mode === 'over') {
      g.fillStyle = 'rgba(12,9,24,.82)';
      g.fillRect(0, 0, W, H);
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = '#ffffff';
      g.font = 'bold 30px sans-serif';
      g.fillText(wins === 3 ? 'ゆうしょう！' : 'しょうぶあり', W / 2, H / 2 - 56);
      g.font = 'bold 26px sans-serif';
      g.fillText(`${score}てん`, W / 2, H / 2 - 12);
      g.fillStyle = '#ffd57a';
      g.font = 'bold 16px sans-serif';
      g.fillText(`せいせき ${wins}しょう`, W / 2, H / 2 + 24);
      if (wins === 3) {
        g.fillStyle = '#ffd54a';
        g.fillText('3にんぬき たっせい！', W / 2, H / 2 + 52);
      }
    }
  }

  draw(ctx.now());
  setData(ctx.now());

  return {
    start() {
      started = true;
      resetBout(0, ctx.now());
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
