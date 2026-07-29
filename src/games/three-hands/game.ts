// =============================================================
// みっつの はり（No.118・かくれゲーム）: 3本が そろう しゅんかんに タップ
// =============================================================
// - ねらい: #16 ぴったりストップは「1本の光を 止める」。こちらは
//   **3本が 同時に 12時に そろう しゅんかんを 待ちうけて 当てる**＝予測して 構える遊び。
// - 針の 速さは 整数比なので、そろう チャンスは かならず 定期的に 来る。
// - 「あと何秒で そろうか」は 出さない（出したら 待つだけの ゲームになる）。
// - import してよいのは game-api（types / helpers）と、このフォルダ内（logic）だけ。
import type { GameContext, IGame, PointerInfo } from '../../game-api/types';
import {
  ROUNDS,
  ROUND_SPECS,
  type RoundSpec,
  canAnswer,
  handAngle,
  isTimeUp,
  judge,
  offsetMs,
  roundPoints,
} from './logic';

const W = 360;
const H = 640;
const HUD_H = 46;

const CX = 180;
const CY = 300;
const R_FACE = 122;
/** 針の 長さ（速い針ほど 短く＝見分けやすく） */
const HAND_LEN = [104, 84, 64];
const HAND_COLORS = ['#4ad0e0', '#ffb04a', '#ff7ab0'];

const RESULT_MS = 1500;
const END_DELAY = 2400;
const SCORE_HI = 1100;
/** ここから 下を タップすると こたえになる */
const TAP_Y = 150;

const C_BG = '#141b2e';
const C_FACE = '#1e2740';
const C_TEXT = '#eaf0ff';
const C_DIM = '#8b97bd';
const C_OK = '#43c98a';
const C_NG = '#e0483c';
const C_ACC = '#ffd54a';

type Mode = 'play' | 'result' | 'done';

export function createGame(ctx: GameContext): IGame {
  const cv = ctx.canvas2d({ design: { w: W, h: H } });
  const g = cv.ctx;

  let roundIdx = 0;
  let spec: RoundSpec = ROUND_SPECS[0]!;
  let mode: Mode = 'play';
  let started = false;
  let hostPaused = false;
  let ended = false;
  let score = 0;
  let correct = 0;
  let streak = 0;
  let bestStreak = 0;
  let perfects = 0;
  let roundStart = 0;
  let phaseUntil = 0;
  /** 直前の 判定 */
  let tier = 0;
  let lastOffset = 0;
  let earlyUntil = 0;
  let lastEvent = '';

  function loadRound(i: number, now: number): void {
    roundIdx = i;
    spec = ROUND_SPECS[i]!;
    roundStart = now;
    tier = 0;
    lastOffset = 0;
    mode = 'play';
    lastEvent = `round:${i}`;
  }

  // ---------- 入力 ----------
  const offTap = ctx.input.onTap((p: PointerInfo) => {
    if (hostPaused || !started || mode !== 'play') return;
    const l = cv.toLocal(p);
    if (l.y < TAP_Y) return;
    const now = ctx.now();
    const t = now - roundStart;
    if (!canAnswer(spec, t)) {
      earlyUntil = now + 900;
      ctx.sfx('fail');
      lastEvent = `early:${roundIdx}`;
      return;
    }
    lastOffset = offsetMs(spec, t);
    tier = judge(spec, lastOffset);
    const pts = roundPoints(roundIdx, tier);
    score += pts;
    if (tier > 0) {
      correct++;
      streak++;
      bestStreak = Math.max(bestStreak, streak);
      ctx.sfx('success');
      ctx.haptic('success');
      if (correct === 1) ctx.achieve('first-align');
      if (correct >= 4) ctx.achieve('half');
      if (streak >= 4) ctx.achieve('streak-4');
      if (tier === 3) {
        perfects++;
        ctx.achieve('perfect-align');
      }
    } else {
      streak = 0;
      ctx.sfx('fail');
      ctx.haptic('error');
    }
    mode = 'result';
    phaseUntil = now + RESULT_MS;
    lastEvent = `${tier > 0 ? 'hit' : 'miss'}:${roundIdx}:${Math.round(lastOffset)}:${pts}`;
  });

  // ---------- 毎フレーム ----------
  const offFrame = ctx.onFrame(() => {
    if (hostPaused || !started) return;
    const now = ctx.now();
    if (mode === 'play' && isTimeUp(spec, now - roundStart)) {
      tier = 0;
      lastOffset = -1;
      streak = 0;
      mode = 'result';
      phaseUntil = now + RESULT_MS;
      ctx.sfx('fail');
      lastEvent = `timeup:${roundIdx}`;
    } else if (mode === 'result' && now >= phaseUntil) {
      if (roundIdx + 1 >= ROUNDS) finish(now);
      else loadRound(roundIdx + 1, now);
    } else if (mode === 'done' && !ended && now >= phaseUntil) {
      ended = true;
      ctx.end({ score });
      return;
    }
    draw(now);
    setData();
  });

  function finish(now: number): void {
    if (correct >= ROUNDS) ctx.achieve('all-align');
    if (score >= SCORE_HI) ctx.achieve('score-hi');
    mode = 'done';
    phaseUntil = now + END_DELAY;
    ctx.sfx('medal');
    lastEvent = `finish:${score}:${correct}`;
  }

  function setData(): void {
    if (!import.meta.env.DEV) return;
    const r = ctx.root as HTMLElement;
    const t = ctx.now() - roundStart;
    r.dataset.mode = mode;
    r.dataset.round = String(roundIdx);
    r.dataset.period = String(spec.periodMs);
    r.dataset.tol = String(spec.tolMs);
    r.dataset.k = spec.k.join(',');
    r.dataset.start = String(Math.round(roundStart));
    r.dataset.t = String(Math.round(t));
    r.dataset.off = String(Math.round(offsetMs(spec, Math.max(0, t))));
    r.dataset.tier = String(tier);
    r.dataset.score = String(score);
    r.dataset.correct = String(correct);
    r.dataset.streak = String(streak);
    r.dataset.perfects = String(perfects);
    r.dataset.last = lastEvent;
  }

  // ---------- 描画 ----------
  function draw(now: number): void {
    cv.clear(C_BG);
    const t = now - roundStart;

    // HUD
    g.fillStyle = '#0c1120';
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
      g.fillStyle = C_ACC;
      g.fillText(`${score}てん`, W / 2, 336);
      g.fillStyle = C_DIM;
      g.font = 'bold 14px sans-serif';
      g.fillText(`どんぴしゃ ${perfects}かい・さいこう れんぞく ${bestStreak}`, W / 2, 380);
      return;
    }

    // といかけ
    g.fillStyle = C_TEXT;
    g.font = 'bold 16px sans-serif';
    g.fillText('3本が うえで そろう しゅんかんに タップ！', W / 2, 76);
    g.fillStyle = C_DIM;
    g.font = 'bold 12px sans-serif';
    g.fillText(`はやさ ×${spec.k[0]} ／ ×${spec.k[1]} ／ ×${spec.k[2]}`, W / 2, 102);

    // 文字ばん
    g.fillStyle = C_FACE;
    g.beginPath();
    g.arc(CX, CY, R_FACE, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = 'rgba(139,151,189,.35)';
    g.lineWidth = 2;
    g.beginPath();
    g.arc(CX, CY, R_FACE, 0, Math.PI * 2);
    g.stroke();
    // 目もり
    for (let i = 0; i < 12; i++) {
      const a = ((i * 30 - 90) * Math.PI) / 180;
      g.strokeStyle = 'rgba(139,151,189,.35)';
      g.lineWidth = i === 0 ? 0 : 2;
      if (i !== 0) {
        g.beginPath();
        g.moveTo(CX + Math.cos(a) * (R_FACE - 12), CY + Math.sin(a) * (R_FACE - 12));
        g.lineTo(CX + Math.cos(a) * (R_FACE - 4), CY + Math.sin(a) * (R_FACE - 4));
        g.stroke();
      }
    }
    // うえの めじるし
    g.fillStyle = C_ACC;
    g.beginPath();
    g.moveTo(CX, CY - R_FACE + 4);
    g.lineTo(CX - 11, CY - R_FACE - 14);
    g.lineTo(CX + 11, CY - R_FACE - 14);
    g.closePath();
    g.fill();

    // 針
    for (let i = 0; i < 3; i++) {
      const deg = handAngle(spec, spec.k[i]!, Math.max(0, t));
      const a = ((deg - 90) * Math.PI) / 180;
      g.strokeStyle = HAND_COLORS[i]!;
      g.lineWidth = 6 - i;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(CX, CY);
      g.lineTo(CX + Math.cos(a) * HAND_LEN[i]!, CY + Math.sin(a) * HAND_LEN[i]!);
      g.stroke();
    }
    g.fillStyle = C_TEXT;
    g.beginPath();
    g.arc(CX, CY, 8, 0, Math.PI * 2);
    g.fill();

    // 判定
    g.font = 'bold 22px sans-serif';
    if (mode === 'result') {
      if (tier === 3) {
        g.fillStyle = C_OK;
        g.fillText('どんぴしゃ！', W / 2, 470);
      } else if (tier === 2) {
        g.fillStyle = C_OK;
        g.fillText('ナイス！', W / 2, 470);
      } else if (tier === 1) {
        g.fillStyle = C_ACC;
        g.fillText('セーフ', W / 2, 470);
      } else {
        g.fillStyle = C_NG;
        g.fillText(lastOffset < 0 ? '時間ぎれ…' : 'そろって いなかった', W / 2, 470);
      }
      if (lastOffset >= 0) {
        g.fillStyle = C_DIM;
        g.font = 'bold 14px sans-serif';
        g.fillText(`ズレ ${Math.round(lastOffset)}ミリびょう（せいかい ±${spec.tolMs}）`, W / 2, 500);
      }
    } else if (now < earlyUntil) {
      g.fillStyle = C_NG;
      g.fillText('まだ 1しゅう目！', W / 2, 470);
    } else {
      g.fillStyle = C_DIM;
      g.font = 'bold 14px sans-serif';
      g.fillText(`せいかいの はば ±${spec.tolMs}ミリびょう`, W / 2, 470);
    }

    g.fillStyle = C_DIM;
    g.font = 'bold 12px sans-serif';
    g.fillText('画面の どこを タップしても OK（1もんに 1回）', W / 2, 560);
    g.font = 'bold 11px sans-serif';
    g.fillText('3本は かならず 同じ 間かくで そろう。リズムを つかもう', W / 2, 588);
  }

  draw(0);
  setData();

  return {
    start() {
      started = true;
      roundStart = ctx.now();
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
