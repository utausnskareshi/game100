// =============================================================
// PKたいけつ（No.83）: ドラッグだけで ける→まもるの5本勝負！サドンデスもあるPK戦
// =============================================================
// - キック: ボールからドラッグ→はなすとシュート（狙い点ガイドつき）。すみジャストは絶対入る。
//   まん中よりは どの方向のキーパーにも届く（＝すみを狙う勇気が要る・むずかしい）。
// - セーブ: CPUの助走中のヒント（信頼度70%）を見て、窓内にドラッグで飛ぶ。早すぎると逆を突かれる。
// - 判定・CPU抽選・採点は logic.ts（rng注入＝完全決定論）。
// - 全画面 Canvas・時間は ctx.now 期限方式・setTimeout 不使用。
// - import してよいのは game-api（types / helpers）と、このフォルダ内（logic）だけ
import type { GameContext, IGame, PointerInfo } from '../../game-api/types';
import {
  CORNER_BONUS,
  type CpuKick,
  DRAW_PTS,
  FLY_MS,
  GOAL,
  GOAL_PTS,
  MIN_DRAG,
  PAIRS,
  RUNUP_MS,
  SAVE_EARLY_MS,
  SAVE_LATE_MS,
  SAVE_PTS,
  SD_MAX,
  SD_WIN_PTS,
  WIN_PTS,
  W,
  H,
  type Zone,
  cornerJust,
  diveFromDrag,
  finalZone,
  inGoal,
  keeperDive,
  kickTarget,
  rollCpuKick,
  savedByKeeper,
  zonePoint,
} from './logic';

const HUD_H = 44;
const BALL = { x: 180, y: 468 };
const RESULT_MS = 950;
const BANNER_MS = 900;
const DECIDE_MS = 1600;
const END_DELAY = 2000;
const SCORE_HI = 500; // 実績閾値（理論最大550・完璧ボット実証・実機要調整）
const CORNER_ACH = 3;

type Phase =
  | 'kick-in'
  | 'kick-aim'
  | 'kick-fly'
  | 'kick-result'
  | 'save-in'
  | 'save-run'
  | 'save-fly'
  | 'save-result'
  | 'decide'
  | 'over';

type KickResult = 'goal' | 'saved' | 'miss';

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

  let phase: Phase = 'kick-in';
  let started = false;
  let hostPaused = false;
  let pair = 1; // 1..5(+SD)
  let myGoals = 0;
  let cpuGoals = 0;
  let score = 0;
  let corners = 0;
  let saves = 0;
  let phaseUntil = 0;
  // キック
  let dragId = -1;
  let dragStart: { x: number; y: number } | null = null;
  let dragNow: { x: number; y: number } | null = null;
  let target = { x: 180, y: 200 };
  let kDive: Zone = 'C'; // CPUキーパーの飛ぶ方向
  let kickRes: KickResult = 'miss';
  let kickCorner = false;
  let flyStart = 0;
  // セーブ
  let cpu: CpuKick = { zone: 'C', hint: 'C', truth: true, earlyPunish: 'L' };
  let runStart = 0;
  let shotAt = 0;
  let diveZone: Zone | null = null;
  let diveAt = 0;
  let saveOk = false;
  let cpuFinal: Zone = 'C';
  // 結果・記録
  const myLog: KickResult[] = [];
  const cpuLog: ('goal' | 'saved')[] = [];
  let decideText = '';
  let decidedWin = false;
  let banner = '';
  let effects: FloatFx[] = [];
  let endAt = 0;
  let ended = false;
  let lastEvent = '';

  function addScore(n: number): void {
    score += n;
    if (score >= SCORE_HI) ctx.achieve('score-hi');
  }

  function enterKick(now: number): void {
    phase = 'kick-in';
    banner = pair > PAIRS ? `サドンデス${pair - PAIRS}本め キミのばん！` : `${pair}本め キミのばん！`;
    phaseUntil = now + BANNER_MS;
    dragId = -1;
    dragStart = null;
    dragNow = null;
    ctx.sfx('tick');
  }

  function shoot(dx: number, dy: number, now: number): void {
    target = kickTarget(dx, dy);
    kDive = keeperDive(ctx.random);
    kickCorner = inGoal(target) && cornerJust(target);
    kickRes = !inGoal(target) ? 'miss' : savedByKeeper(target, kDive) ? 'saved' : 'goal';
    phase = 'kick-fly';
    flyStart = now;
    ctx.sfx('tap');
    ctx.haptic('light');
    lastEvent = `shoot:${target.x.toFixed(0)},${target.y.toFixed(0)}`;
  }

  function resolveKick(now: number): void {
    myLog.push(kickRes);
    if (kickRes === 'goal') {
      myGoals++;
      const pts = GOAL_PTS + (kickCorner ? CORNER_BONUS : 0);
      if (kickCorner) {
        corners++;
        if (corners >= CORNER_ACH) ctx.achieve('corner-3');
      }
      addScore(pts);
      ctx.achieve('first-goal');
      effects.push({ x: target.x, y: target.y, text: kickCorner ? `すみジャスト！+${pts}` : `+${pts}`, color: '#ffd54a', until: now + 1000 });
      banner = 'ゴーーール！';
      ctx.sfx('medal');
      ctx.haptic('success');
    } else if (kickRes === 'saved') {
      banner = 'とめられた…';
      ctx.sfx('fail');
    } else {
      banner = 'わくの外…！';
      ctx.sfx('fail');
    }
    phase = 'kick-result';
    phaseUntil = now + RESULT_MS;
    lastEvent = `kick:${kickRes}`;
  }

  function enterSave(now: number): void {
    phase = 'save-in';
    banner = 'まもれ！';
    phaseUntil = now + BANNER_MS;
    diveZone = null;
    saveOk = false;
    ctx.sfx('tick');
  }

  function startRun(now: number): void {
    cpu = rollCpuKick(ctx.random);
    phase = 'save-run';
    runStart = now;
    shotAt = now + RUNUP_MS;
  }

  function resolveSaveShot(now: number): void {
    const early = diveZone !== null && diveAt < shotAt - SAVE_EARLY_MS;
    cpuFinal = finalZone(cpu, diveZone ?? 'C', early);
    saveOk = diveZone !== null && diveZone === cpuFinal && diveAt >= shotAt - SAVE_EARLY_MS && diveAt <= shotAt + SAVE_LATE_MS;
    phase = 'save-fly';
    flyStart = now;
    ctx.sfx('tap');
    lastEvent = `cpushot:${cpuFinal}:early=${early ? 1 : 0}`;
  }

  function resolveSave(now: number): void {
    if (saveOk) {
      saves++;
      addScore(SAVE_PTS);
      ctx.achieve('first-save');
      if (!cpu.truth) ctx.achieve('mind-read');
      cpuLog.push('saved');
      banner = 'ナイスセーブ！';
      effects.push({ x: 180, y: 210, text: `+${SAVE_PTS}`, color: '#8affc0', until: now + 1000 });
      ctx.sfx('medal');
      ctx.haptic('success');
    } else {
      cpuGoals++;
      cpuLog.push('goal');
      banner = 'きめられた…';
      ctx.sfx('fail');
      ctx.haptic('error');
    }
    phase = 'save-result';
    phaseUntil = now + RESULT_MS;
    lastEvent = `save:${saveOk ? 'ok' : 'ng'}`;
  }

  function afterPair(now: number): void {
    const sd = pair > PAIRS;
    const finished = sd ? true : pair >= PAIRS; // SDは1ペアごとに判定
    if (finished && myGoals !== cpuGoals) {
      decidedWin = myGoals > cpuGoals;
      const pts = decidedWin ? (sd ? SD_WIN_PTS : WIN_PTS) : 0;
      if (pts > 0) addScore(pts);
      if (decidedWin && myGoals === PAIRS && cpuGoals === 0 && !sd) ctx.achieve('perfect-5');
      decideText = decidedWin ? (sd ? `サドンデスをせいした！ +${pts}` : `かち！ +${pts}`) : 'まけちゃった…';
      phase = 'decide';
      phaseUntil = now + DECIDE_MS;
      ctx.sfx(decidedWin ? 'medal' : 'fail');
      return;
    }
    if (pair >= PAIRS + SD_MAX) {
      // サドンデス3本でも決まらない＝ひきわけ
      addScore(DRAW_PTS);
      decidedWin = false;
      decideText = `ひきわけ！ +${DRAW_PTS}`;
      phase = 'decide';
      phaseUntil = now + DECIDE_MS;
      ctx.sfx('combo');
      return;
    }
    if (!sd && pair === PAIRS && myGoals === cpuGoals) {
      effects.push({ x: 180, y: 330, text: 'どうてん！サドンデスへ！', color: '#ffd54a', until: now + 1200 });
    }
    pair++;
    enterKick(now);
  }

  // ---- 入力（ドラッグ） ----
  const offDown = ctx.input.onDown((p: PointerInfo) => {
    if (hostPaused || !started) return;
    if (dragId === -1) {
      dragId = p.id;
      dragStart = cv.toLocal(p);
      dragNow = dragStart;
    }
  });
  const offMove = ctx.input.onMove((p: PointerInfo) => {
    if (p.id !== dragId) return;
    dragNow = cv.toLocal(p);
  });
  const offUp = ctx.input.onUp((p: PointerInfo) => {
    if (p.id !== dragId) return;
    const start = dragStart;
    const end = cv.toLocal(p);
    dragId = -1;
    dragStart = null;
    dragNow = null;
    if (hostPaused || !started || !start) return;
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const now = ctx.now();
    if (phase === 'kick-aim') {
      if (Math.hypot(dx, dy) >= MIN_DRAG && dy < 0) shoot(dx, dy, now);
    } else if ((phase === 'save-run' || phase === 'save-fly') && diveZone === null) {
      const z = diveFromDrag(dx, dy);
      if (z) {
        diveZone = z;
        diveAt = now;
        ctx.haptic('medium');
        lastEvent = `dive:${z}`;
      }
    }
  });

  // ---- 毎フレーム ----
  const offFrame = ctx.onFrame(() => {
    if (hostPaused) return;
    const now = ctx.now();
    if (started) {
      if (phase === 'kick-in' && now >= phaseUntil) {
        phase = 'kick-aim';
      } else if (phase === 'kick-fly' && now >= flyStart + FLY_MS) {
        resolveKick(now);
      } else if (phase === 'kick-result' && now >= phaseUntil) {
        enterSave(now);
      } else if (phase === 'save-in' && now >= phaseUntil) {
        startRun(now);
      } else if (phase === 'save-run' && now >= shotAt) {
        resolveSaveShot(now);
      } else if (phase === 'save-fly' && now >= flyStart + FLY_MS) {
        resolveSave(now);
      } else if (phase === 'save-result' && now >= phaseUntil) {
        afterPair(now);
      } else if (phase === 'decide' && now >= phaseUntil) {
        phase = 'over';
        endAt = now + END_DELAY;
      } else if (phase === 'over' && !ended && now >= endAt) {
        ended = true;
        ctx.end({ score });
        return;
      }
    }
    effects = effects.filter((e) => e.until > now);
    draw(now);
    setData(now);
  });

  function setData(now: number): void {
    if (!import.meta.env.DEV) return;
    const r = ctx.root as HTMLElement;
    r.dataset.phase = phase;
    r.dataset.pair = String(pair);
    r.dataset.mygoals = String(myGoals);
    r.dataset.cpugoals = String(cpuGoals);
    r.dataset.score = String(score);
    r.dataset.corners = String(corners);
    r.dataset.saves = String(saves);
    r.dataset.target = `${target.x.toFixed(1)},${target.y.toFixed(1)}`;
    r.dataset.kdive = kDive;
    r.dataset.cpu = phase.startsWith('save') ? `${cpu.zone}:${cpu.hint}:${cpu.truth ? 1 : 0}:${cpu.earlyPunish}` : '';
    r.dataset.shotleft = phase === 'save-run' ? Math.max(0, shotAt - now).toFixed(0) : '';
    r.dataset.final = phase === 'save-fly' || phase === 'save-result' ? cpuFinal : '';
    r.dataset.dive = diveZone ?? '';
    r.dataset.mylog = myLog.join(',');
    r.dataset.cpulog = cpuLog.join(',');
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
    // スタンド（観客）
    og.fillStyle = '#2c3550';
    og.fillRect(0, 0, W, 132);
    og.fillStyle = 'rgba(255,255,255,.16)';
    for (let i = 0; i < 110; i++) og.fillRect((i * 37 + 11) % W, 48 + ((i * 53) % 76), 3, 3);
    // ピッチ
    const grad = og.createLinearGradient(0, 132, 0, H);
    grad.addColorStop(0, '#3f8f4a');
    grad.addColorStop(1, '#2f7a3c');
    og.fillStyle = grad;
    og.fillRect(0, 132, W, H - 132);
    // 芝の縞
    og.fillStyle = 'rgba(255,255,255,.05)';
    for (let y = 150; y < H; y += 56) og.fillRect(0, y, W, 28);
    // ゴール（枠＋ネット）
    og.strokeStyle = '#f2f3fb';
    og.lineWidth = 6;
    og.beginPath();
    og.moveTo(GOAL.x0, GOAL.y1 + 4);
    og.lineTo(GOAL.x0, GOAL.y0);
    og.lineTo(GOAL.x1, GOAL.y0);
    og.lineTo(GOAL.x1, GOAL.y1 + 4);
    og.stroke();
    og.strokeStyle = 'rgba(242,243,251,.28)';
    og.lineWidth = 1;
    for (let x = GOAL.x0 + 12; x < GOAL.x1; x += 16) {
      og.beginPath();
      og.moveTo(x, GOAL.y0);
      og.lineTo(x, GOAL.y1);
      og.stroke();
    }
    for (let y = GOAL.y0 + 12; y < GOAL.y1; y += 14) {
      og.beginPath();
      og.moveTo(GOAL.x0, y);
      og.lineTo(GOAL.x1, y);
      og.stroke();
    }
    // ゴールライン・PKスポット
    og.strokeStyle = 'rgba(255,255,255,.75)';
    og.lineWidth = 3;
    og.beginPath();
    og.moveTo(10, GOAL.y1 + 6);
    og.lineTo(W - 10, GOAL.y1 + 6);
    og.stroke();
    og.fillStyle = 'rgba(255,255,255,.85)';
    og.beginPath();
    og.arc(BALL.x, BALL.y, 4, 0, Math.PI * 2);
    og.fill();
  }
  bakeStatic();

  function drawKeeper(x: number, y: number, color: string, lean: number): void {
    // かんたんな人型（胴＋頭＋うで）
    g.save();
    g.translate(x, y);
    g.rotate(lean);
    g.fillStyle = color;
    g.beginPath();
    g.ellipse(0, 0, 15, 24, 0, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.arc(0, -32, 11, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = color;
    g.lineWidth = 7;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(-12, -12);
    g.lineTo(-30, -24);
    g.moveTo(12, -12);
    g.lineTo(30, -24);
    g.stroke();
    g.restore();
  }

  function drawBall(x: number, y: number, r: number): void {
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#2a3350';
    g.lineWidth = 1.5;
    g.stroke();
    g.fillStyle = '#2a3350';
    g.beginPath();
    g.arc(x, y, r * 0.34, 0, Math.PI * 2);
    g.fill();
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2 + 0.4;
      g.beginPath();
      g.arc(x + Math.cos(a) * r * 0.78, y + Math.sin(a) * r * 0.78, r * 0.17, 0, Math.PI * 2);
      g.fill();
    }
  }

  const isKickPhase = (): boolean => phase.startsWith('kick');

  function draw(now: number): void {
    g.drawImage(off, 0, 0, W, H);

    // ---- ゴール内のキーパー ----
    if (isKickPhase()) {
      // CPUキーパー（赤）: fly中は kDive へ飛ぶ
      let kx = 180;
      let lean = Math.sin(now / 420) * 0.06;
      if (phase === 'kick-fly' || phase === 'kick-result') {
        const p = Math.min(1, (now - flyStart) / FLY_MS);
        const zp = zonePoint(kDive);
        kx = 180 + (zp.x - 180) * p;
        lean = kDive === 'L' ? -0.7 * p : kDive === 'R' ? 0.7 * p : 0;
      }
      drawKeeper(kx, 228, '#d84a5a', lean);
    } else {
      // じぶんのキーパー（青）: ダイブ指示どおりに飛ぶ
      let kx = 180;
      let lean = 0;
      if (diveZone && (phase === 'save-run' || phase === 'save-fly' || phase === 'save-result')) {
        const p = Math.min(1, (now - diveAt) / 260);
        const zp = zonePoint(diveZone);
        kx = 180 + (zp.x - 180) * p;
        lean = diveZone === 'L' ? -0.7 * p : diveZone === 'R' ? 0.7 * p : 0;
      }
      drawKeeper(kx, 228, '#3d7df0', lean);
    }

    // ---- キック側 ----
    if (phase === 'kick-in' || phase === 'kick-aim') {
      drawBall(BALL.x, BALL.y, 13);
      // ねらいガイド
      if (phase === 'kick-aim' && dragStart && dragNow) {
        const dx = dragNow.x - dragStart.x;
        const dy = dragNow.y - dragStart.y;
        if (Math.hypot(dx, dy) >= MIN_DRAG && dy < 0) {
          const t = kickTarget(dx, dy);
          g.setLineDash([6, 6]);
          g.strokeStyle = 'rgba(255,255,255,.6)';
          g.lineWidth = 2.5;
          g.beginPath();
          g.moveTo(BALL.x, BALL.y);
          g.lineTo(t.x, t.y);
          g.stroke();
          g.setLineDash([]);
          const good = inGoal(t);
          g.strokeStyle = good ? (cornerJust(t) ? '#ffd54a' : 'rgba(255,255,255,.9)') : '#ff8a8a';
          g.lineWidth = 3;
          g.beginPath();
          g.arc(t.x, t.y, 12, 0, Math.PI * 2);
          g.stroke();
          g.beginPath();
          g.moveTo(t.x - 17, t.y);
          g.lineTo(t.x + 17, t.y);
          g.moveTo(t.x, t.y - 17);
          g.lineTo(t.x, t.y + 17);
          g.stroke();
        }
      }
    } else if (phase === 'kick-fly' || phase === 'kick-result') {
      const p = Math.min(1, (now - flyStart) / FLY_MS);
      const bx = BALL.x + (target.x - BALL.x) * p;
      const by = BALL.y + (target.y - BALL.y) * p - Math.sin(p * Math.PI) * 40;
      drawBall(bx, by, 13 - 5 * p);
    }

    // ---- セーブ側 ----
    if (phase === 'save-in' || phase === 'save-run') {
      // CPUキッカー（赤・下）＋助走
      const p = phase === 'save-run' ? Math.min(1, (now - runStart) / RUNUP_MS) : 0;
      const ky = 560 - 60 * p;
      drawKeeper(300 - 120 * p, ky, '#d84a5a', -0.1);
      drawBall(BALL.x, BALL.y, 13);
      // ヒント（体の向き矢印）
      if (phase === 'save-run' && now >= runStart + 150) {
        const hp = zonePoint(cpu.hint);
        g.fillStyle = 'rgba(255,213,74,.9)';
        g.font = 'bold 22px sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(cpu.hint === 'L' ? '👀⬅' : cpu.hint === 'R' ? '➡👀' : '👀⬆', 180, 520);
        g.strokeStyle = 'rgba(255,213,74,.5)';
        g.lineWidth = 2.5;
        g.setLineDash([5, 6]);
        g.beginPath();
        g.moveTo(BALL.x, BALL.y - 20);
        g.lineTo(hp.x, hp.y + 30);
        g.stroke();
        g.setLineDash([]);
      }
    } else if (phase === 'save-fly' || phase === 'save-result') {
      const p = Math.min(1, (now - flyStart) / FLY_MS);
      const zp = zonePoint(cpuFinal);
      const bx = BALL.x + (zp.x - BALL.x) * p;
      const by = BALL.y + (zp.y - BALL.y) * p - Math.sin(p * Math.PI) * 40;
      drawBall(bx, by, 13 - 5 * p);
      drawKeeper(300 - 120, 500, '#d84a5a', 0.35);
    }

    // うかぶ文字
    for (const e of effects) {
      const a = Math.max(0, Math.min(1, (e.until - now) / 900));
      g.globalAlpha = a;
      g.fillStyle = e.color;
      g.font = 'bold 17px sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(e.text, e.x, e.y - (1 - a) * 20);
      g.globalAlpha = 1;
    }

    // HUD＋スコアボード
    if (phase !== 'over') {
      g.fillStyle = 'rgba(12,20,36,.9)';
      g.fillRect(0, 0, W, HUD_H);
      g.textBaseline = 'middle';
      g.textAlign = 'left';
      g.fillStyle = '#fff';
      g.font = 'bold 18px sans-serif';
      g.fillText(`${score}てん`, 12, HUD_H / 2);
      g.fillStyle = '#cfe0ff';
      g.font = 'bold 15px sans-serif';
      const sd = pair > PAIRS ? `SD${Math.min(SD_MAX, pair - PAIRS)}` : `${Math.min(pair, PAIRS)}/${PAIRS}`;
      g.fillText(`${sd}本め`, 118, HUD_H / 2);
      g.fillStyle = '#ffd54a';
      g.font = 'bold 17px sans-serif';
      g.fillText(`${myGoals} - ${cpuGoals}`, 210, HUD_H / 2);
      // けっか列（キミ/あいて）
      g.font = 'bold 11px sans-serif';
      g.fillStyle = '#cdd6f5';
      g.fillText('キミ', 12, 56);
      g.fillText('あいて', 12, 74);
      for (let i = 0; i < PAIRS + SD_MAX; i++) {
        const x = 58 + i * 20;
        if (i >= PAIRS && pair <= PAIRS) break;
        // キミ
        const mv = myLog[i];
        g.beginPath();
        g.arc(x, 56, 6, 0, Math.PI * 2);
        if (mv === 'goal') {
          g.fillStyle = '#8affc0';
          g.fill();
        } else if (mv) {
          g.fillStyle = '#ff8a8a';
          g.fill();
        } else {
          g.strokeStyle = 'rgba(255,255,255,.4)';
          g.lineWidth = 1.5;
          g.stroke();
        }
        // あいて
        const cvv = cpuLog[i];
        g.beginPath();
        g.arc(x, 74, 6, 0, Math.PI * 2);
        if (cvv === 'goal') {
          g.fillStyle = '#ff8a8a';
          g.fill();
        } else if (cvv) {
          g.fillStyle = '#8affc0';
          g.fill();
        } else {
          g.strokeStyle = 'rgba(255,255,255,.4)';
          g.lineWidth = 1.5;
          g.stroke();
        }
      }
      // 操作ヒント
      if (phase === 'kick-aim') {
        g.fillStyle = 'rgba(255,255,255,.85)';
        g.font = 'bold 14px sans-serif';
        g.textAlign = 'center';
        g.fillText('ボールから ゴールへ ドラッグ！（すみを ねらえ）', 180, 610);
      } else if (phase === 'save-run') {
        g.fillStyle = 'rgba(255,255,255,.85)';
        g.font = 'bold 14px sans-serif';
        g.textAlign = 'center';
        g.fillText('シュートにあわせて ドラッグで 飛べ！（はやすぎ注意）', 180, 610);
      }
    }

    // バナー
    if ((phase === 'kick-in' || phase === 'kick-result' || phase === 'save-in' || phase === 'save-result') && now < phaseUntil) {
      g.fillStyle = 'rgba(12,20,36,.72)';
      const bw = 250;
      g.fillRect(180 - bw / 2, 320, bw, 64);
      g.fillStyle = '#fff';
      g.font = 'bold 22px sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(banner, 180, 352);
    }
    if (phase === 'decide' && now < phaseUntil) {
      g.fillStyle = 'rgba(12,20,36,.78)';
      g.fillRect(20, 300, W - 40, 96);
      g.fillStyle = decidedWin ? '#ffd54a' : '#fff';
      g.font = 'bold 24px sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(decideText, 180, 336);
      g.fillStyle = '#cfe0ff';
      g.font = 'bold 16px sans-serif';
      g.fillText(`${myGoals} - ${cpuGoals}`, 180, 370);
    }

    if (phase === 'over') {
      g.fillStyle = 'rgba(12,20,36,.8)';
      g.fillRect(0, 0, W, H);
      g.textAlign = 'center';
      g.fillStyle = decidedWin ? '#ffd54a' : '#fff';
      g.font = 'bold 28px sans-serif';
      g.fillText(decideText || 'しゅうりょう', W / 2, H / 2 - 52);
      g.fillStyle = '#fff';
      g.font = 'bold 26px sans-serif';
      g.fillText(`${score}てん`, W / 2, H / 2 - 8);
      g.fillStyle = '#cfe0ff';
      g.font = 'bold 16px sans-serif';
      g.fillText(`ゴール${myGoals}本　セーブ${saves}回`, W / 2, H / 2 + 28);
    }
  }

  draw(ctx.now());
  setData(ctx.now());

  return {
    start() {
      started = true;
      enterKick(ctx.now());
    },
    pause() {
      hostPaused = true;
      dragId = -1;
      dragStart = null;
      dragNow = null;
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
