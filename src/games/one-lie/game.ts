// =============================================================
// ひとつだけ うそ（No.128・かくれゲーム）: 4つの ヒントの 1つだけが うそ
// =============================================================
// - ねらい: #72 てんびん推理は「はかって くらべる」。こちらは「言っている ことの
//   矛盾」を つく 論理パズル。
// - 出題は logic 側で「うそ1つで こたえが 1つに 決まる」ことを 確かめてある
//   ＝答えは かならず 1つ（理不尽さゼロ）。
// - import してよいのは game-api（types / helpers）と、このフォルダ内（logic）だけ。
import type { GameContext, IGame, PointerInfo } from '../../game-api/types';
import {
  ALL_BONUS,
  QUICK_BONUS,
  QUICK_MS,
  ROUNDS,
  ROUND_MS,
  type Round,
  makeRounds,
  roundPoints,
  stmtText,
} from './logic';

const W = 360;
const H = 640;
const HUD_H = 46;

const HINT_Y = 118;
const HINT_H = 30;
const BOX_Y = 300;
const BOX_H = 84;

const RESULT_MS = 2400;
const END_DELAY = 2600;
const SCORE_HI = 800;

const C_BG = '#1c1a16';
const C_PANEL = '#2b2721';
const C_TEXT = '#f5f0e6';
const C_DIM = '#b3a893';
const C_OK = '#5ad08a';
const C_NG = '#e0483c';
const C_ACC = '#ffd54a';

type Mode = 'play' | 'result' | 'done';

export function createGame(ctx: GameContext): IGame {
  const cv = ctx.canvas2d({ design: { w: W, h: H } });
  const g = cv.ctx;

  const rounds: Round[] = makeRounds(ctx.random);
  let roundIdx = 0;
  let round: Round = rounds[0]!;
  let picked = -1;
  let mode: Mode = 'play';
  let started = false;
  let hostPaused = false;
  let ended = false;
  let score = 0;
  let correct = 0;
  let streak = 0;
  let bestStreak = 0;
  let roundStart = 0;
  let phaseUntil = 0;
  let lastEvent = '';

  function loadRound(i: number, now: number): void {
    roundIdx = i;
    round = rounds[i]!;
    picked = -1;
    roundStart = now;
    mode = 'play';
    lastEvent = `round:${i}:ans${round.answer}`;
  }

  // ---------- レイアウト ----------
  const boxRect = (i: number): { x: number; y: number; w: number } => {
    const gap = 8;
    const total = 340;
    const w = (total - gap * (round.n - 1)) / round.n;
    return { x: 10 + i * (w + gap), y: BOX_Y, w };
  };

  // ---------- 入力 ----------
  const offTap = ctx.input.onTap((p: PointerInfo) => {
    if (hostPaused || !started || mode !== 'play') return;
    const l = cv.toLocal(p);
    if (l.y < BOX_Y || l.y > BOX_Y + BOX_H) return;
    for (let i = 0; i < round.n; i++) {
      const r = boxRect(i);
      if (l.x < r.x || l.x > r.x + r.w) continue;
      const now = ctx.now();
      picked = i;
      if (i === round.answer) {
        let pts = roundPoints(roundIdx);
        if (now - roundStart <= QUICK_MS) {
          pts += QUICK_BONUS;
          ctx.achieve('quick');
        }
        score += pts;
        correct++;
        streak++;
        bestStreak = Math.max(bestStreak, streak);
        ctx.sfx('medal');
        ctx.haptic('success');
        if (correct === 1) ctx.achieve('first-right');
        if (correct >= 3) ctx.achieve('half');
        if (streak >= 4) ctx.achieve('streak-4');
        lastEvent = `hit:${roundIdx}:${pts}`;
      } else {
        streak = 0;
        ctx.sfx('fail');
        ctx.haptic('error');
        lastEvent = `miss:${roundIdx}:${i}`;
      }
      mode = 'result';
      phaseUntil = now + RESULT_MS;
      return;
    }
  });

  // ---------- 毎フレーム ----------
  const offFrame = ctx.onFrame(() => {
    if (hostPaused || !started) return;
    const now = ctx.now();
    if (mode === 'play' && now - roundStart >= ROUND_MS) {
      streak = 0;
      picked = -1;
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
    r.dataset.n = String(round.n);
    r.dataset.answer = String(round.answer);
    r.dataset.liar = String(round.liar);
    r.dataset.hints = round.stmts.map((s) => ('k' in s ? `${s.kind}${s.k}` : s.kind)).join(',');
    r.dataset.picked = String(picked);
    r.dataset.score = String(score);
    r.dataset.correct = String(correct);
    r.dataset.streak = String(streak);
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

  function draw(now: number): void {
    cv.clear(C_BG);

    // HUD
    g.fillStyle = '#141210';
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
      g.fillText(`さいこう れんぞく ${bestStreak}かい`, W / 2, 380);
      return;
    }

    // といかけ
    g.fillStyle = C_TEXT;
    g.font = 'bold 15px sans-serif';
    g.fillText('4つの ヒントの うち 1つだけが うそ', W / 2, 72);
    g.fillStyle = C_DIM;
    g.font = 'bold 12px sans-serif';
    g.fillText('たからが 入っている はこを えらぼう', W / 2, 94);

    // ヒント
    g.textAlign = 'left';
    for (let i = 0; i < round.stmts.length; i++) {
      const y = HINT_Y + i * HINT_H;
      const lie = mode === 'result' && i === round.liar;
      g.fillStyle = lie ? 'rgba(224,72,60,.18)' : C_PANEL;
      roundRect(14, y - 12, 332, 26, 7);
      g.fill();
      g.fillStyle = lie ? C_NG : C_TEXT;
      g.font = 'bold 13px sans-serif';
      g.fillText(`${i + 1}. ${stmtText(round.stmts[i]!)}`, 22, y + 1);
      if (lie) {
        g.textAlign = 'right';
        g.fillStyle = C_NG;
        g.font = 'bold 12px sans-serif';
        g.fillText('← これが うそ', 340, y + 1);
        g.textAlign = 'left';
      }
    }
    g.textAlign = 'center';

    // のこり時間
    if (mode === 'play') {
      const left = Math.max(0, 1 - (now - roundStart) / ROUND_MS);
      g.fillStyle = 'rgba(179,168,147,.22)';
      roundRect(50, 254, 260, 8, 4);
      g.fill();
      g.fillStyle = left > 0.3 ? C_OK : C_NG;
      roundRect(50, 254, 260 * left, 8, 4);
      g.fill();
    }

    // はこ
    for (let i = 0; i < round.n; i++) {
      const r = boxRect(i);
      const isAns = mode === 'result' && i === round.answer;
      const isPick = mode === 'result' && i === picked;
      g.fillStyle = isAns ? 'rgba(90,208,138,.2)' : C_PANEL;
      roundRect(r.x, r.y, r.w, BOX_H, 12);
      g.fill();
      g.strokeStyle = isAns ? C_OK : isPick ? C_NG : 'rgba(179,168,147,.4)';
      g.lineWidth = isAns || isPick ? 4 : 2;
      roundRect(r.x, r.y, r.w, BOX_H, 12);
      g.stroke();
      g.fillStyle = C_DIM;
      g.font = 'bold 13px sans-serif';
      g.fillText(`${i + 1}`, r.x + r.w / 2, r.y + 18);
      // ふた（あけると たから）
      if (isAns) {
        g.font = '30px sans-serif';
        g.fillText('💎', r.x + r.w / 2, r.y + 52);
      } else {
        g.fillStyle = 'rgba(179,168,147,.3)';
        roundRect(r.x + r.w / 2 - 12, r.y + 40, 24, 20, 4);
        g.fill();
      }
    }

    // ようす
    g.font = 'bold 16px sans-serif';
    if (mode === 'result') {
      if (picked < 0) {
        g.fillStyle = C_NG;
        g.fillText('時間ぎれ… こたえは みどりの はこ', W / 2, 430);
      } else if (picked === round.answer) {
        g.fillStyle = C_OK;
        g.fillText('せいかい！', W / 2, 430);
      } else {
        g.fillStyle = C_NG;
        g.fillText('ざんねん… こたえは みどりの はこ', W / 2, 430);
      }
      g.fillStyle = C_DIM;
      g.font = 'bold 12px sans-serif';
      g.fillText('うその ヒントを のぞくと ぜんぶ 合う', W / 2, 456);
    } else {
      g.fillStyle = C_DIM;
      g.font = 'bold 13px sans-serif';
      g.fillText('「うそが 1つだけ」に なる はこは 1つしか ない', W / 2, 430);
    }

    g.fillStyle = C_DIM;
    g.font = 'bold 12px sans-serif';
    g.fillText('ためし方: この はこだと したら うそは いくつ？', W / 2, 500);
    g.font = 'bold 11px sans-serif';
    g.fillText('うそが ちょうど 1つに なる はこが こたえ', W / 2, 524);
    g.fillText('10びょう いないに こたえると ボーナス', W / 2, 548);
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
