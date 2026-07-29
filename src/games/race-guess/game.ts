// =============================================================
// どっちが 先？（No.111・かくれゲーム）: 先に着くほうを「着く前に」当てる
// =============================================================
// - ねらい: 反応の速さではなく「到達時間の予測」。近いほうが 先とはかぎらない
//   （遠くても 速ければ 先に着く）ので、きょりと速さを 見くらべる必要がある。
// - こたえる時間に かぎりがある（かんさつ時間）＝ゴール手前まで見て決める、ができない。
// - 出題は logic.makeRounds（rng 注入＝決定論）。こちらは描画・入力・採点だけ。
// - import してよいのは game-api（types / helpers）と、このフォルダ内（logic）だけ。
import type { GameContext, IGame, PointerInfo } from '../../game-api/types';
import { ALL_BONUS, CLOSE_MS, ROUNDS, type Round, makeRounds, obsMs, roundPoints } from './logic';

const W = 360;
const H = 640;
const HUD_H = 46;

/** ゴール線と レーン */
const GOAL_Y = 150;
const LX = 110;
const RX = 250;
const RUNNER_R = 15;

/** こたえたあとの 早送り倍率 */
const FAST = 3;
const RESULT_MS = 1300;
const END_DELAY = 2400;
const SCORE_HI = 900;

const C_BG = '#0f1a1e';
const C_TRACK = '#1b2b32';
const C_LEFT = '#4ad0e0';
const C_RIGHT = '#ffb04a';
const C_TEXT = '#e9f5f7';
const C_DIM = '#84a0a8';
const C_OK = '#43c98a';
const C_NG = '#e0483c';
const C_GOAL = '#f0f4f5';

type Mode = 'obs' | 'run' | 'result' | 'done';

export function createGame(ctx: GameContext): IGame {
  const cv = ctx.canvas2d({ design: { w: W, h: H } });
  const g = cv.ctx;

  const rounds: Round[] = makeRounds(ctx.random);
  let roundIdx = 0;
  let round: Round = rounds[0]!;
  let mode: Mode = 'obs';
  let started = false;
  let hostPaused = false;
  let ended = false;
  let score = 0;
  let correct = 0;
  let streak = 0;
  let bestStreak = 0;
  let missed = 0;
  /** このラウンドで こたえた側（null は まだ） */
  let picked: 'L' | 'R' | null = null;
  /** ラウンドの世界時計（秒）。こたえたあとは FAST 倍で すすむ */
  let wt = 0;
  let phaseUntil = 0;
  let lastEvent = '';

  function loadRound(i: number): void {
    roundIdx = i;
    round = rounds[i]!;
    picked = null;
    wt = 0;
    mode = 'obs';
    lastEvent = `round:${i}`;
  }

  // ---------- レイアウト ----------
  const runnerY = (dist: number, speed: number): number => GOAL_Y + Math.max(0, dist - speed * wt);
  const BTN_L = { x: 20, y: 470, w: 150, h: 96 };
  const BTN_R = { x: 190, y: 470, w: 150, h: 96 };
  const inRect = (p: { x: number; y: number }, r: { x: number; y: number; w: number; h: number }): boolean =>
    p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;

  // ---------- 入力 ----------
  function answer(side: 'L' | 'R'): void {
    if (picked) return;
    picked = side;
    const ok = side === round.winner;
    if (ok) {
      const pts = roundPoints(roundIdx);
      score += pts;
      correct++;
      streak++;
      bestStreak = Math.max(bestStreak, streak);
      ctx.sfx('success');
      ctx.haptic('success');
      if (correct === 1) ctx.achieve('first-right');
      if (correct >= 5) ctx.achieve('half');
      if (round.gapMs <= CLOSE_MS) ctx.achieve('close-call');
      if (streak >= 5) ctx.achieve('streak-5');
      lastEvent = `hit:${roundIdx}:${pts}`;
    } else {
      streak = 0;
      ctx.sfx('fail');
      ctx.haptic('error');
      lastEvent = `miss:${roundIdx}`;
    }
    mode = 'run';
  }

  const offTap = ctx.input.onTap((p: PointerInfo) => {
    if (hostPaused || !started || mode !== 'obs') return;
    const l = cv.toLocal(p);
    if (inRect(l, BTN_L)) answer('L');
    else if (inRect(l, BTN_R)) answer('R');
  });

  // ---------- 毎フレーム ----------
  const offFrame = ctx.onFrame((dt) => {
    if (hostPaused || !started) return;
    const now = ctx.now();
    if (mode === 'obs') {
      wt += Math.min(0.1, dt);
      if (wt * 1000 >= obsMs(roundIdx)) {
        // 時間切れ＝こたえなかった
        missed++;
        streak = 0;
        ctx.sfx('fail');
        mode = 'run';
        lastEvent = `timeup:${roundIdx}`;
      }
    } else if (mode === 'run') {
      wt += Math.min(0.1, dt) * FAST;
      if (wt >= Math.max(round.tL, round.tR)) {
        mode = 'result';
        phaseUntil = now + RESULT_MS;
      }
    } else if (mode === 'result' && now >= phaseUntil) {
      if (roundIdx + 1 >= ROUNDS) finish(now);
      else loadRound(roundIdx + 1);
    } else if (mode === 'done' && !ended && now >= phaseUntil) {
      ended = true;
      ctx.end({ score });
      return;
    }
    draw();
    setData();
  });

  function finish(now: number): void {
    if (correct >= ROUNDS) {
      score += ALL_BONUS;
      ctx.achieve('all-right');
    }
    if (score >= SCORE_HI) ctx.achieve('score-hi');
    mode = 'done';
    phaseUntil = now + END_DELAY;
    ctx.sfx('medal');
    lastEvent = `finish:${score}:${correct}`;
  }

  function setData(): void {
    if (!import.meta.env.DEV) return;
    const r = ctx.root as HTMLElement;
    r.dataset.mode = mode;
    r.dataset.round = String(roundIdx);
    r.dataset.winner = round.winner;
    r.dataset.gap = String(round.gapMs);
    r.dataset.far = round.farWins ? '1' : '0';
    r.dataset.picked = picked ?? '-';
    r.dataset.score = String(score);
    r.dataset.correct = String(correct);
    r.dataset.streak = String(streak);
    r.dataset.missed = String(missed);
    r.dataset.wt = wt.toFixed(3);
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

  function drawRunner(x: number, y: number, color: string, dim: boolean): void {
    g.globalAlpha = dim ? 0.35 : 1;
    g.fillStyle = color;
    g.beginPath();
    g.arc(x, y, RUNNER_R, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#0d2126';
    g.beginPath();
    g.arc(x - 5, y - 3, 2.6, 0, Math.PI * 2);
    g.arc(x + 5, y - 3, 2.6, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#0d2126';
    g.lineWidth = 2;
    g.beginPath();
    g.arc(x, y + 3, 5, 0.15 * Math.PI, 0.85 * Math.PI);
    g.stroke();
    g.globalAlpha = 1;
  }

  function drawLane(x: number, dist: number, speed: number, color: string, side: 'L' | 'R'): void {
    // レール
    g.strokeStyle = C_TRACK;
    g.lineWidth = 30;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(x, GOAL_Y);
    g.lineTo(x, GOAL_Y + 260);
    g.stroke();
    // スタート位置の しるし
    g.strokeStyle = 'rgba(255,255,255,.18)';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(x - 20, GOAL_Y + dist);
    g.lineTo(x + 20, GOAL_Y + dist);
    g.stroke();
    const y = runnerY(dist, speed);
    const arrived = y <= GOAL_Y + 0.5;
    drawRunner(x, y, color, mode === 'result' && side !== round.winner);
    if (arrived && mode !== 'obs') {
      g.fillStyle = color;
      g.font = 'bold 12px sans-serif';
      g.textAlign = 'center';
      g.fillText('ゴール！', x, GOAL_Y - 26);
    }
  }

  function draw(): void {
    cv.clear(C_BG);

    // HUD
    g.fillStyle = '#081215';
    g.fillRect(0, 0, W, HUD_H);
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.fillStyle = C_TEXT;
    g.font = 'bold 18px sans-serif';
    g.fillText(`${score}てん`, 12, HUD_H / 2);
    g.fillStyle = C_DIM;
    g.font = 'bold 13px sans-serif';
    g.fillText(`もんだい ${Math.min(roundIdx + 1, ROUNDS)}/${ROUNDS}`, 116, HUD_H / 2 - 8);
    g.fillText(`せいかい ${correct}・れんぞく ${streak}`, 116, HUD_H / 2 + 9);

    g.textAlign = 'center';

    if (mode === 'done') {
      g.fillStyle = C_TEXT;
      g.font = 'bold 26px sans-serif';
      g.fillText(`${correct} / ${ROUNDS} もん せいかい！`, W / 2, 280);
      g.font = 'bold 34px sans-serif';
      g.fillStyle = C_LEFT;
      g.fillText(`${score}てん`, W / 2, 336);
      g.fillStyle = C_DIM;
      g.font = 'bold 14px sans-serif';
      g.fillText(`さいこう れんぞく ${bestStreak}かい`, W / 2, 380);
      return;
    }

    // ゴール線（市松もよう）
    g.fillStyle = C_GOAL;
    for (let i = 0; i < 12; i++) {
      if (i % 2 === 0) g.fillRect(60 + i * 20, GOAL_Y - 12, 20, 6);
      else g.fillRect(60 + i * 20, GOAL_Y - 6, 20, 6);
    }
    g.fillStyle = C_DIM;
    g.font = 'bold 12px sans-serif';
    g.fillText('ゴール', W / 2, GOAL_Y - 26);

    drawLane(LX, round.distL, round.speedL, C_LEFT, 'L');
    drawLane(RX, round.distR, round.speedR, C_RIGHT, 'R');

    // といかけ／のこり時間
    if (mode === 'obs') {
      const t = Math.max(0, 1 - (wt * 1000) / obsMs(roundIdx));
      g.fillStyle = C_TEXT;
      g.font = 'bold 17px sans-serif';
      g.fillText('どっちが 先に つく？', W / 2, 96);
      g.fillStyle = 'rgba(132,160,168,.25)';
      roundRect(40, 434, 280, 10, 5);
      g.fill();
      g.fillStyle = t > 0.35 ? C_OK : C_NG;
      roundRect(40, 434, 280 * t, 10, 5);
      g.fill();
      g.fillStyle = C_DIM;
      g.font = 'bold 11px sans-serif';
      g.fillText('この あいだに こたえよう', W / 2, 456);
    } else if (mode === 'run') {
      g.fillStyle = C_DIM;
      g.font = 'bold 15px sans-serif';
      g.fillText('はやおくり中…', W / 2, 96);
    } else {
      const ok = picked === round.winner;
      g.fillStyle = ok ? C_OK : C_NG;
      g.font = 'bold 22px sans-serif';
      g.fillText(picked === null ? '時間ぎれ…' : ok ? 'せいかい！' : 'はずれ', W / 2, 96);
      g.fillStyle = C_DIM;
      g.font = 'bold 13px sans-serif';
      g.fillText(
        `${round.winner === 'L' ? 'ひだり' : 'みぎ'}が ${(round.gapMs / 1000).toFixed(2)}びょう 先だった`,
        W / 2,
        440,
      );
    }

    // こたえボタン
    for (const [btn, color, label, side] of [
      [BTN_L, C_LEFT, 'ひだり', 'L'],
      [BTN_R, C_RIGHT, 'みぎ', 'R'],
    ] as const) {
      const chosen = picked === side;
      g.fillStyle = chosen ? color : 'rgba(255,255,255,.06)';
      roundRect(btn.x, btn.y, btn.w, btn.h, 16);
      g.fill();
      g.strokeStyle = color;
      g.lineWidth = mode === 'obs' ? 3 : 2;
      g.globalAlpha = mode === 'obs' || chosen ? 1 : 0.4;
      roundRect(btn.x, btn.y, btn.w, btn.h, 16);
      g.stroke();
      g.fillStyle = chosen ? '#0d2126' : C_TEXT;
      g.font = 'bold 24px sans-serif';
      g.fillText(label, btn.x + btn.w / 2, btn.y + btn.h / 2);
      g.globalAlpha = 1;
    }

    g.fillStyle = C_DIM;
    g.font = 'bold 11px sans-serif';
    g.fillText('近いほうが 先とは かぎらない（遠くても 速ければ 先）', W / 2, 596);
  }

  draw();
  setData();

  return {
    start() {
      started = true;
    },
    pause() {
      hostPaused = true;
    },
    resume() {
      hostPaused = false;
    },
    resize() {
      draw();
    },
    destroy() {
      offTap();
      offFrame();
    },
  };
}
