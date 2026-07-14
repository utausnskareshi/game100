// =============================================================
// エアホッケー（No.25）: 指ドラッグのマレットでCPUと対戦（action）
// =============================================================
// - 下半分＝あなた（指ドラッグ追従）、上半分＝CPU。先取5点 or 90秒で終了。
// - パック物理は physics.ts（円円衝突・壁反射・ゴール開口）。固定サブステップ 1/120（block-break 流儀）。
// - CPU の狙いブレは ctx.random。時間はすべて ctx.now 期限方式（setTimeout 不使用）。
// - import してよいのは game-api（types / helpers）と、このフォルダ内（physics）だけ
import type { GameContext, IGame } from '../../game-api/types';
import { clamp, elem, makeSeg, createCountdown, type Countdown } from '../../game-api/helpers';
import { reflectWalls, collideMallet, clampSpeed, applyFriction, type Puck, type Mallet } from './physics';

const W = 360;
const H = 640;
const FIELD = { l: 20, r: 340, t: 20, b: 620 };
const GOAL_L = 120;
const GOAL_R = 240;
const MID = (FIELD.t + FIELD.b) / 2; // 320
const PUCK_R = 14;
const MALLET_R = 26;
const SUBSTEP = 1 / 120;
const FRICTION = 0.25; // 毎秒の減速割合
const PUCK_MAX = 950;
const HIT_BOOST = 260;
const WIN_GOALS = 5;
const DURATION = 90_000;
const SERVE_MS = 800;
const END_DELAY = 2000;
const GOAL_PTS = 30;
const WIN_BONUS = 50;

type Diff = 'easy' | 'normal' | 'hard';
type Mode = 'setup' | 'count' | 'play' | 'over';
interface Config {
  diff: Diff;
}

// CPU の強さ（速度・反応のブレ。playtest調整前提の仮値）
const CPU: Record<Diff, { speed: number; jitter: number; bonus: number }> = {
  easy: { speed: 165, jitter: 46, bonus: 0 },
  normal: { speed: 240, jitter: 30, bonus: 40 },
  hard: { speed: 330, jitter: 16, bonus: 100 },
};

export function createGame(ctx: GameContext): IGame {
  const cv = ctx.canvas2d({ design: { w: W, h: H } });
  const g = cv.ctx;

  const saved = ctx.load<Partial<Config>>('config');
  const config: Config = { diff: saved?.diff === 'easy' || saved?.diff === 'hard' ? saved.diff : 'normal' };

  // ---- 状態 ----
  let mode: Mode = 'setup';
  let hostPaused = false;
  let diff: Diff = config.diff;
  const puck: Puck = { x: W / 2, y: MID + 120, vx: 0, vy: 0, r: PUCK_R };
  const my: Mallet = { x: W / 2, y: FIELD.b - 70, vx: 0, vy: 0, r: MALLET_R };
  const cpu: Mallet = { x: W / 2, y: FIELD.t + 60, vx: 0, vy: 0, r: MALLET_R };
  let myTarget = { x: my.x, y: my.y };
  let dragging = false;
  let dragId = -1;
  let myGoals = 0;
  let cpuGoals = 0;
  let playStart = 0;
  let serveUntil = 0;
  let cpuAimAt = 0;
  let cpuJitter = { x: 0, y: 0 };
  let acc = 0; // 物理サブステップ用
  let goalFlash = ''; // 「ゴール！」演出テキスト
  let goalFlashUntil = 0;
  let endAt = 0;
  let ended = false;
  let finalWin = false;
  let finalDraw = false;
  let cd: Countdown | null = null;
  let lastSec = -1;

  const style = document.createElement('style');
  style.textContent = CSS;
  ctx.root.append(style);
  let setupEl: HTMLElement | null = null;

  function setData(): void {
    if (!import.meta.env.DEV) return;
    const r = ctx.root as HTMLElement;
    r.dataset.mode = mode;
    r.dataset.my = String(myGoals);
    r.dataset.cpu = String(cpuGoals);
    r.dataset.puckx = String(Math.round(puck.x));
    r.dataset.pucky = String(Math.round(puck.y));
    r.dataset.serving = ctx.now() < serveUntil ? '1' : '0';
  }

  // ---- 設定画面 ----
  function showSetup(): void {
    mode = 'setup';
    setupEl = elem('div', 'ah-setup');
    setupEl.append(elem('h2', 'ah-h2', 'エアホッケー 🏒'));
    setupEl.append(
      makeSeg(
        'ah',
        'CPUのつよさ',
        [
          // CPU対戦系（リバーシ/スピード/五目）と同じ「よわい/ふつう/つよい」表記に統一
          { v: 'easy', t: 'よわい' },
          { v: 'normal', t: 'ふつう' },
          { v: 'hard', t: 'つよい' },
        ],
        () => config.diff,
        (v) => {
          config.diff = v as Diff;
        },
      ),
    );
    setupEl.append(elem('p', 'ah-note', '下のマレットを ゆびで動かして、パックを あいてのゴールへ うちこもう！先に5点とるか、90びょうで 多いほうの かち。'));
    const start = elem('button', 'ah-btn ah-btn-primary ah-btn-lg', 'たいせん開始 ▶') as HTMLButtonElement;
    start.addEventListener('click', () => startMatch());
    setupEl.append(start);
    ctx.root.append(setupEl);
    setData();
  }

  function startMatch(): void {
    ctx.save('config', { ...config });
    diff = config.diff;
    setupEl?.remove();
    setupEl = null;
    myGoals = 0;
    cpuGoals = 0;
    ended = false;
    endAt = 0;
    finalWin = false;
    finalDraw = false;
    lastSec = -1;
    my.x = W / 2;
    my.y = FIELD.b - 70;
    myTarget = { x: my.x, y: my.y };
    cpu.x = W / 2;
    cpu.y = FIELD.t + 60;
    serve('you');
    mode = 'count';
    cd = createCountdown({
      onCount: () => ctx.sfx('tick'),
      onGo: (now) => {
        mode = 'play';
        playStart = now;
        serveUntil = now + 300;
        ctx.sfx('start');
      },
    });
    cd.start(ctx.now());
    setData();
  }

  /** サーブ配置（scoredOn = 直前に決められた側へパックを置く） */
  function serve(scoredOn: 'you' | 'cpu'): void {
    puck.x = W / 2;
    puck.y = scoredOn === 'you' ? MID + 110 : MID - 110;
    puck.vx = 0;
    puck.vy = 0;
  }

  // ---- 得点 ----
  function onGoal(which: 'top' | 'bottom', now: number): void {
    if (which === 'top') {
      myGoals++;
      ctx.achieve('first-goal');
      // 通算ゴール（インスタンス跨ぎ・加算箇所で即解除）
      const total = (ctx.load<number>('goals') ?? 0) + 1;
      ctx.save('goals', total);
      if (total >= 10) ctx.achieve('goal-10');
      goalFlash = '🎉 ゴール！';
      ctx.sfx('combo');
      ctx.haptic('success');
    } else {
      cpuGoals++;
      goalFlash = '…とられた！';
      ctx.sfx('fail');
      ctx.haptic('error');
    }
    goalFlashUntil = now + 900;
    if (myGoals >= WIN_GOALS || cpuGoals >= WIN_GOALS) {
      finish(now);
      return;
    }
    serve(which === 'top' ? 'cpu' : 'you');
    serveUntil = now + SERVE_MS;
  }

  function finish(now: number): void {
    mode = 'over';
    finalWin = myGoals > cpuGoals;
    finalDraw = myGoals === cpuGoals;
    if (finalWin) {
      ctx.achieve('first-win');
      if (diff === 'hard') ctx.achieve('beat-strong');
      if (cpuGoals === 0) ctx.achieve('shutout');
      if (myGoals >= WIN_GOALS && now - playStart <= 60_000) ctx.achieve('speed-win');
      ctx.sfx('medal');
      ctx.haptic('success');
    } else {
      ctx.sfx(finalDraw ? 'success' : 'fail');
    }
    endAt = now + END_DELAY;
  }

  function computeScore(): number {
    let s = myGoals * GOAL_PTS;
    if (finalWin) s += WIN_BONUS + CPU[diff].bonus;
    return s;
  }

  // ---- 入力（ドラッグ追従。onMove 購読＝ドラッグ系のキャプチャ経路）----
  const offDown = ctx.input.onDown((p) => {
    if (mode !== 'play' || hostPaused) return;
    dragging = true;
    dragId = p.id;
    const l = cv.toLocal(p);
    myTarget = clampMy(l.x, l.y);
  });
  const offMove = ctx.input.onMove((p) => {
    if (!dragging || p.id !== dragId || mode !== 'play' || hostPaused) return;
    const l = cv.toLocal(p);
    myTarget = clampMy(l.x, l.y);
  });
  const offUp = ctx.input.onUp((p) => {
    if (p.id === dragId) {
      dragging = false;
      dragId = -1;
    }
  });

  function clampMy(x: number, y: number): { x: number; y: number } {
    return {
      x: clamp(x, FIELD.l + MALLET_R, FIELD.r - MALLET_R),
      y: clamp(y, MID + MALLET_R + 4, FIELD.b - MALLET_R),
    };
  }

  // ---- 毎フレーム ----
  const offFrame = ctx.onFrame((dt) => {
    const now = ctx.now();
    if (mode === 'count') {
      cd?.tick(now);
      draw(now);
      setData();
      return;
    }
    if (mode === 'play' && !hostPaused) {
      updatePlay(dt, now);
      setData();
    }
    if (mode === 'over' && !ended && now >= endAt) {
      ended = true;
      ctx.end({ score: computeScore() });
    }
    draw(now);
  });

  function updatePlay(dt: number, now: number): void {
    // 残り時間
    const left = DURATION - (now - playStart);
    if (left <= 0) {
      finish(now);
      return;
    }
    const sec = Math.ceil(left / 1000);
    if (sec !== lastSec) {
      lastSec = sec;
      if (sec <= 5) ctx.sfx('tick');
    }

    // あなたのマレット（ターゲットへ追従・速度を記録）
    const ox = my.x;
    const oy = my.y;
    const k = Math.min(1, dt * 22);
    my.x += (myTarget.x - my.x) * k;
    my.y += (myTarget.y - my.y) * k;
    my.vx = dt > 0 ? (my.x - ox) / dt : 0;
    my.vy = dt > 0 ? (my.y - oy) / dt : 0;

    // CPU（自陣にいるパックを追う・それ以外はホームへ。狙いブレは ctx.random）
    if (now >= cpuAimAt) {
      cpuAimAt = now + 280;
      const j = CPU[diff].jitter;
      cpuJitter = { x: (ctx.random() * 2 - 1) * j, y: (ctx.random() * 2 - 1) * j * 0.5 };
    }
    const chase = puck.y < MID + 40;
    const tx = clamp((chase ? puck.x : W / 2) + cpuJitter.x, FIELD.l + MALLET_R, FIELD.r - MALLET_R);
    const ty = clamp(
      (chase ? puck.y - 6 : FIELD.t + 60) + cpuJitter.y,
      FIELD.t + MALLET_R,
      MID - MALLET_R - 4,
    );
    const cs = CPU[diff].speed * dt;
    const cdx = tx - cpu.x;
    const cdy = ty - cpu.y;
    const cdist = Math.hypot(cdx, cdy);
    const cox = cpu.x;
    const coy = cpu.y;
    if (cdist > 1) {
      const step = Math.min(cs, cdist);
      cpu.x += (cdx / cdist) * step;
      cpu.y += (cdy / cdist) * step;
    }
    cpu.vx = dt > 0 ? (cpu.x - cox) / dt : 0;
    cpu.vy = dt > 0 ? (cpu.y - coy) / dt : 0;

    // パック物理（サーブの静止中は動かさない）
    if (now >= serveUntil) {
      acc += dt;
      while (acc >= SUBSTEP) {
        acc -= SUBSTEP;
        puck.x += puck.vx * SUBSTEP;
        puck.y += puck.vy * SUBSTEP;
        applyFriction(puck, FRICTION, SUBSTEP);
        const goal = reflectWalls(puck, FIELD.l, FIELD.r, FIELD.t, FIELD.b, GOAL_L, GOAL_R);
        if (goal) {
          onGoal(goal, now);
          return;
        }
        if (collideMallet(puck, my, HIT_BOOST, PUCK_MAX, FIELD)) ctx.sfx('tap');
        if (collideMallet(puck, cpu, HIT_BOOST, PUCK_MAX, FIELD)) ctx.sfx('tick');
        clampSpeed(puck, PUCK_MAX);
      }
    }
  }

  // ---- 描画 ----
  function draw(now: number): void {
    // 台（固定パレット＝両テーマ共通）
    g.fillStyle = '#eef4fb';
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#dbe7f5';
    g.fillRect(0, 0, W, FIELD.t);
    g.fillRect(0, FIELD.b, W, H - FIELD.b);
    g.fillRect(0, 0, FIELD.l, H);
    g.fillRect(FIELD.r, 0, W - FIELD.r, H);
    // 枠・センターライン・サークル
    g.strokeStyle = '#9db8d8';
    g.lineWidth = 3;
    g.strokeRect(FIELD.l, FIELD.t, FIELD.r - FIELD.l, FIELD.b - FIELD.t);
    g.strokeStyle = '#c3d5ec';
    g.beginPath();
    g.moveTo(FIELD.l, MID);
    g.lineTo(FIELD.r, MID);
    g.stroke();
    g.beginPath();
    g.arc(W / 2, MID, 46, 0, Math.PI * 2);
    g.stroke();
    // ゴール開口
    g.strokeStyle = '#5a7bf0';
    g.lineWidth = 6;
    g.beginPath();
    g.moveTo(GOAL_L, FIELD.t);
    g.lineTo(GOAL_R, FIELD.t);
    g.stroke();
    g.strokeStyle = '#f0524a';
    g.beginPath();
    g.moveTo(GOAL_L, FIELD.b);
    g.lineTo(GOAL_R, FIELD.b);
    g.stroke();

    // パック
    g.fillStyle = '#23252e';
    g.beginPath();
    g.arc(puck.x, puck.y, puck.r, 0, Math.PI * 2);
    g.fill();
    // マレット（CPU=青 / あなた=赤）
    drawMallet(cpu, '#4a74f0');
    drawMallet(my, '#f0524a');

    // スコア（左側・上下）
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.font = 'bold 26px sans-serif';
    g.fillStyle = '#4a74f0';
    g.fillText(String(cpuGoals), 32, MID - 40);
    g.fillStyle = '#f0524a';
    g.fillText(String(myGoals), 32, MID + 40);
    // 残り時間（左上・ポーズ領域=右上60×60は避ける）
    if (mode === 'play' || mode === 'over') {
      const left = Math.max(0, DURATION - ((mode === 'over' ? endAt - END_DELAY : ctx.now()) - playStart));
      g.fillStyle = '#3a4763';
      g.font = 'bold 15px sans-serif';
      g.fillText(`⏱ ${Math.ceil(left / 1000)}`, 28, 40);
    }

    // カウントダウン
    if (mode === 'count') {
      const n = cd?.count ?? 0;
      if (n > 0) {
        g.fillStyle = 'rgba(16,19,48,.55)';
        g.fillRect(0, 0, W, H);
        g.fillStyle = '#fff';
        g.textAlign = 'center';
        g.font = 'bold 96px sans-serif';
        g.fillText(String(n), W / 2, MID);
      }
    }

    // ゴール演出
    if (now < goalFlashUntil) {
      g.fillStyle = 'rgba(16,19,48,.55)';
      g.fillRect(0, MID - 44, W, 88);
      g.fillStyle = '#fff';
      g.textAlign = 'center';
      g.font = 'bold 34px sans-serif';
      g.fillText(goalFlash, W / 2, MID);
    }

    if (mode === 'over') {
      g.fillStyle = 'rgba(16,19,48,.72)';
      g.fillRect(0, 0, W, H);
      g.fillStyle = '#fff';
      g.textAlign = 'center';
      g.font = 'bold 38px sans-serif';
      g.fillText(finalWin ? 'かち！' : finalDraw ? 'ひきわけ' : 'まけ…', W / 2, MID - 30);
      g.font = 'bold 26px sans-serif';
      g.fillText(`あなた ${myGoals} - ${cpuGoals} CPU`, W / 2, MID + 22);
    }
  }

  function drawMallet(m: Mallet, color: string): void {
    g.fillStyle = color;
    g.beginPath();
    g.arc(m.x, m.y, m.r, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(255,255,255,.35)';
    g.beginPath();
    g.arc(m.x, m.y, m.r * 0.55, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = color;
    g.beginPath();
    g.arc(m.x, m.y, m.r * 0.3, 0, Math.PI * 2);
    g.fill();
  }

  // ---- 起動（startMode:'immediate'。設定画面から始まる）----
  showSetup();

  return {
    start() {
      // シェルのカウントダウンは省略。設定画面（showSetup）から開始する
    },
    pause() {
      hostPaused = true;
      dragging = false;
      dragId = -1;
    },
    resume() {
      hostPaused = false;
    },
    resize() {
      // design 指定の Canvas は自動レターボックス
    },
    destroy() {
      offDown();
      offMove();
      offUp();
      offFrame();
      style.remove();
      setupEl?.remove();
    },
  };
}

// =============================================================
// スタイル（.ah- プレフィックス。設定画面のみDOM・プレイはCanvas）
// =============================================================
const CSS = `
.ah-setup{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:safe center;
  gap:14px;padding:20px 16px;box-sizing:border-box;overflow-y:auto;user-select:none;-webkit-user-select:none;
  background:var(--bg)}
.ah-h2{margin:4px 0;font-size:22px;text-align:center}
.ah-seg-row{width:min(92vw,420px);display:flex;flex-direction:column;gap:6px}
.ah-seg-label{font-size:13px;color:var(--text-dim);font-weight:800}
.ah-seg{display:flex;background:var(--bg-elev2);border-radius:12px;padding:3px;gap:2px}
.ah-seg-btn{flex:1;border:none;background:none;color:var(--text-dim);padding:10px 2px;border-radius:9px;
  font-size:14px;font-weight:800;min-height:44px}
.ah-seg-btn.ah-on{background:var(--accent);color:#fff}
.ah-note{font-size:12px;color:var(--text-dim);text-align:center;max-width:min(92vw,420px);margin:0;line-height:1.7}
.ah-btn{appearance:none;border:none;border-radius:12px;padding:12px 18px;font-size:15px;font-weight:800;font-family:inherit;
  background:var(--bg-elev2);color:var(--text);min-height:44px}
.ah-btn-primary{background:var(--accent-grad);color:#fff}
.ah-btn-lg{width:100%;max-width:300px;font-size:18px}
`;
