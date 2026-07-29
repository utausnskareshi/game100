// =============================================================
// ひっぱる じゅうりょく（No.126・かくれゲーム）: 指の場所へ ほしを 引きよせる
// =============================================================
// - おしている あいだだけ 引力が 生まれ、ほし ぜんぶが 指へ 向かう。
//   だから「1つを ねらって 引く」と ほかも 動く＝どこから 引くかが 勝負。
// - とげは 動かない＝ぜんぶ 見えている（理不尽さゼロ）。ふれたら やり直し。
// - 物理は 1/120秒の 固定サブステップ＝決定論。
// - import してよいのは game-api（types / helpers）と、このフォルダ内（logic）だけ。
import type { GameContext, IGame, PointerInfo } from '../../game-api/types';
import {
  FIELD,
  HOLE,
  HOLE_R,
  MINE_R,
  STAGES,
  STAGE_COUNT,
  STAR_R,
  SUB_DT,
  type Pt,
  type Star,
  type StageSpec,
  allGot,
  anyLost,
  initialStars,
  stageScore,
  step,
} from './logic';

const W = 360;
const H = 640;
const HUD_H = 46;

const CLEAR_MS = 1500;
const FAIL_MS = 1400;
const END_DELAY = 2600;
const SCORE_HI = 1000;

const C_BG = '#0d1424';
const C_FIELD = '#141d33';
const C_TEXT = '#eaf0ff';
const C_DIM = '#8b9ac4';
const C_STAR = '#ffd54a';
const C_MINE = '#e0483c';
const C_HOLE = '#4ad0e0';
const C_OK = '#43c98a';
const C_NG = '#e0483c';

type Mode = 'play' | 'cleared' | 'failed' | 'done';

export function createGame(ctx: GameContext): IGame {
  const cv = ctx.canvas2d({ design: { w: W, h: H } });
  const g = cv.ctx;

  let stageIdx = 0;
  let spec: StageSpec = STAGES[0]!;
  let stars: Star[] = initialStars(spec);
  let elapsed = 0;
  let attempts = 1;
  let mode: Mode = 'play';
  let started = false;
  let hostPaused = false;
  let ended = false;
  let score = 0;
  let cleared = 0;
  let oneShots = 0;
  /** クリアした ステージぶんの 回収数（いまの ステージは 状態から 数える） */
  let gotBase = 0;
  let seenGot = 0;
  let acc = 0;
  let finger: Pt | null = null;
  let phaseUntil = 0;
  let lastEvent = '';

  function loadStage(i: number): void {
    stageIdx = i;
    spec = STAGES[i]!;
    stars = initialStars(spec);
    elapsed = 0;
    attempts = 1;
    acc = 0;
    seenGot = 0;
    finger = null;
    mode = 'play';
    lastEvent = `stage:${i}`;
  }

  function resetStage(): void {
    stars = initialStars(spec);
    elapsed = 0;
    acc = 0;
    seenGot = 0;
    finger = null;
    attempts++;
    mode = 'play';
  }

  /** これまでに 回収した ほしの 数（クリアぶん＋いまの ステージ） */
  const totalGot = (): number =>
    gotBase + (mode === 'play' ? stars.filter((s) => s.state === 1).length : 0);

  // ---------- 入力 ----------
  const toField = (p: PointerInfo): Pt => {
    const l = cv.toLocal(p);
    return {
      x: Math.max(FIELD.x0, Math.min(FIELD.x1, l.x)),
      y: Math.max(FIELD.y0, Math.min(FIELD.y1, l.y)),
    };
  };
  const offDown = ctx.input.onDown((p) => {
    if (hostPaused || !started || mode !== 'play') return;
    finger = toField(p);
    lastEvent = `pull:${Math.round(finger.x)},${Math.round(finger.y)}`;
  });
  const offMove = ctx.input.onMove((p) => {
    if (hostPaused || !started || mode !== 'play' || !finger) return;
    finger = toField(p);
  });
  const offUp = ctx.input.onUp(() => {
    finger = null;
  });

  // ---------- 毎フレーム ----------
  const offFrame = ctx.onFrame((dt) => {
    if (hostPaused || !started) return;
    const now = ctx.now();
    if (mode === 'play') {
      acc += Math.min(0.1, dt);
      elapsed += Math.min(0.1, dt) * 1000;
      while (acc >= SUB_DT) {
        acc -= SUB_DT;
        if (step(spec, stars, finger, SUB_DT) === 'lost') ctx.sfx('fail');
      }
      // ★回収数は「いまの じょうたい」から 数える。1サブステップで 2つ 同時に 入ることが
      //   あり、step の 返り値（1つだけ）で 数えると 数え落とす。
      const nowGot = stars.filter((s) => s.state === 1).length;
      if (nowGot > seenGot) {
        seenGot = nowGot;
        ctx.sfx('combo');
      }
      if (allGot(stars)) {
        const pts = stageScore(attempts);
        score += pts;
        cleared++;
        gotBase += stars.length;
        if (attempts === 1) {
          oneShots++;
          ctx.achieve('one-shot');
        }
        if (cleared === 1) ctx.achieve('first-clear');
        if (cleared >= 3) ctx.achieve('half');
        mode = 'cleared';
        phaseUntil = now + CLEAR_MS;
        ctx.sfx('medal');
        ctx.haptic('success');
        lastEvent = `clear:${stageIdx}:${pts}:${attempts}`;
      } else if (anyLost(stars)) {
        mode = 'failed';
        phaseUntil = now + FAIL_MS;
        finger = null;
        ctx.haptic('error');
        lastEvent = `lost:${stageIdx}`;
      } else if (elapsed >= spec.timeMs) {
        mode = 'failed';
        phaseUntil = now + FAIL_MS;
        finger = null;
        ctx.sfx('fail');
        lastEvent = `timeup:${stageIdx}`;
      }
    } else if (mode === 'cleared' && now >= phaseUntil) {
      if (stageIdx + 1 >= STAGE_COUNT) finish(now);
      else loadStage(stageIdx + 1);
    } else if (mode === 'failed' && now >= phaseUntil) {
      resetStage();
    } else if (mode === 'done' && !ended && now >= phaseUntil) {
      ended = true;
      ctx.end({ score });
      return;
    }
    draw();
    setData();
  });

  function finish(now: number): void {
    if (oneShots >= STAGE_COUNT) ctx.achieve('all-one-shot');
    if (totalGot() >= 12) ctx.achieve('collector');
    if (score >= SCORE_HI) ctx.achieve('score-hi');
    mode = 'done';
    phaseUntil = now + END_DELAY;
    ctx.sfx('medal');
    lastEvent = `finish:${score}:${cleared}`;
  }

  function setData(): void {
    if (!import.meta.env.DEV) return;
    const r = ctx.root as HTMLElement;
    r.dataset.mode = mode;
    r.dataset.stage = String(stageIdx);
    r.dataset.stars = stars.map((s) => `${s.state}:${s.x.toFixed(1)},${s.y.toFixed(1)}`).join(';');
    r.dataset.left = String(stars.filter((s) => s.state === 0).length);
    r.dataset.elapsed = String(Math.round(elapsed));
    r.dataset.limit = String(spec.timeMs);
    r.dataset.attempts = String(attempts);
    r.dataset.pull = finger ? `${Math.round(finger.x)},${Math.round(finger.y)}` : '-';
    r.dataset.score = String(score);
    r.dataset.cleared = String(cleared);
    r.dataset.got = String(totalGot());
    r.dataset.oneshots = String(oneShots);
    r.dataset.last = lastEvent;
  }

  // ---------- 描画 ----------
  function roundRect(x: number, y: number, w: number, h: number, r: number): void {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  function drawStar(cx: number, cy: number, r: number, color: string): void {
    g.fillStyle = color;
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const rr = i % 2 === 0 ? r : r * 0.45;
      const x = cx + Math.cos(a) * rr;
      const y = cy + Math.sin(a) * rr;
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.closePath();
    g.fill();
  }

  function draw(): void {
    cv.clear(C_BG);

    // HUD
    g.fillStyle = '#080d18';
    g.fillRect(0, 0, W, HUD_H);
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.fillStyle = C_TEXT;
    g.font = 'bold 18px sans-serif';
    g.fillText(`${score}てん`, 12, HUD_H / 2);
    g.fillStyle = C_DIM;
    g.font = 'bold 13px sans-serif';
    g.fillText(`ステージ ${Math.min(stageIdx + 1, STAGE_COUNT)}/${STAGE_COUNT}`, 116, HUD_H / 2 - 8);
    g.fillText(`ちょうせん ${attempts}かいめ`, 116, HUD_H / 2 + 9);

    g.textAlign = 'center';

    if (mode === 'done') {
      g.fillStyle = C_TEXT;
      g.font = 'bold 26px sans-serif';
      g.fillText('ぜんぶ あつめた！', W / 2, 280);
      g.font = 'bold 34px sans-serif';
      g.fillStyle = C_STAR;
      g.fillText(`${score}てん`, W / 2, 336);
      g.fillStyle = C_DIM;
      g.font = 'bold 14px sans-serif';
      g.fillText(`1回で クリア ${oneShots} / ${STAGE_COUNT}・あつめた ほし ${gotBase}こ`, W / 2, 380);
      return;
    }

    // といかけ・のこり時間
    g.fillStyle = C_DIM;
    g.font = 'bold 13px sans-serif';
    g.fillText('おしている あいだ、ほしが 指に 引きよせられる', W / 2, 68);
    const left = Math.max(0, 1 - elapsed / spec.timeMs);
    g.fillStyle = 'rgba(139,154,196,.22)';
    roundRect(50, 82, 260, 8, 4);
    g.fill();
    g.fillStyle = left > 0.3 ? C_OK : C_NG;
    roundRect(50, 82, 260 * left, 8, 4);
    g.fill();

    // ばん
    g.fillStyle = C_FIELD;
    roundRect(FIELD.x0, FIELD.y0, FIELD.x1 - FIELD.x0, FIELD.y1 - FIELD.y0, 12);
    g.fill();

    // あな
    g.fillStyle = '#05121a';
    g.beginPath();
    g.arc(HOLE.x, HOLE.y, HOLE_R, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = C_HOLE;
    g.lineWidth = 3;
    g.beginPath();
    g.arc(HOLE.x, HOLE.y, HOLE_R, 0, Math.PI * 2);
    g.stroke();

    // とげ
    for (const m of spec.mines) {
      g.fillStyle = C_MINE;
      g.beginPath();
      for (let i = 0; i < 16; i++) {
        const a = (i * Math.PI) / 8;
        const rr = i % 2 === 0 ? MINE_R : MINE_R * 0.62;
        const x = m.x + Math.cos(a) * rr;
        const y = m.y + Math.sin(a) * rr;
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.closePath();
      g.fill();
      g.fillStyle = '#3a0c08';
      g.beginPath();
      g.arc(m.x, m.y, MINE_R * 0.35, 0, Math.PI * 2);
      g.fill();
    }

    // ほし
    for (const s of stars) {
      if (s.state === 1) continue;
      drawStar(s.x, s.y, STAR_R + 3, s.state === 2 ? 'rgba(224,72,60,.5)' : C_STAR);
    }

    // 引力の しるし
    if (finger) {
      g.strokeStyle = 'rgba(74,208,224,.7)';
      g.lineWidth = 2;
      for (const r of [14, 24, 34]) {
        g.beginPath();
        g.arc(finger.x, finger.y, r, 0, Math.PI * 2);
        g.stroke();
      }
      g.fillStyle = C_HOLE;
      g.beginPath();
      g.arc(finger.x, finger.y, 5, 0, Math.PI * 2);
      g.fill();
      // 引かれている 方向
      g.strokeStyle = 'rgba(255,213,74,.35)';
      g.lineWidth = 1.5;
      for (const s of stars) {
        if (s.state !== 0) continue;
        g.beginPath();
        g.moveTo(s.x, s.y);
        g.lineTo(finger.x, finger.y);
        g.stroke();
      }
    }

    // ようす
    g.font = 'bold 15px sans-serif';
    if (mode === 'cleared') {
      g.fillStyle = C_OK;
      g.fillText(`クリア！ +${stageScore(attempts)}てん`, W / 2, 580);
    } else if (mode === 'failed') {
      g.fillStyle = C_NG;
      g.fillText(anyLost(stars) ? 'とげに ふれた… もう一度' : '時間ぎれ… もう一度', W / 2, 580);
    } else {
      g.fillStyle = C_DIM;
      g.font = 'bold 13px sans-serif';
      g.fillText(`のこり ${stars.filter((s) => s.state === 0).length}こ を あなへ`, W / 2, 580);
    }
    g.fillStyle = C_DIM;
    g.font = 'bold 11px sans-serif';
    g.fillText('とげは 動かない。引く 場所を えらんで まわり道させよう', W / 2, 606);
  }

  draw();
  setData();

  return {
    start() {
      started = true;
    },
    pause() {
      hostPaused = true;
      finger = null;
    },
    resume() {
      hostPaused = false;
    },
    resize() {
      draw();
    },
    destroy() {
      offDown();
      offMove();
      offUp();
      offFrame();
    },
  };
}
