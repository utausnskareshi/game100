// =============================================================
// わくわくクレーン（No.54）: クレーンを 景品の上で ピタッと止めてキャッチ！
// =============================================================
// - タップで 左右に動くクレーンを止める → 下りて つかむ → 運ぶ。中心で つかむほど
//   運搬中に すべりにくい（ドキドキ）。ぜんぶで8回・合計スコア。レア景品は 細くて高得点。
// - 景品配置・グリップ・すべり判定・採点は logic.ts（純ロジック・rng注入＝テストと一致）。
// - 全画面 Canvas。操作は タップ（onTap）だけ。時間は ctx.now・setTimeout 不使用。
// - import してよいのは game-api（types / helpers）と、このフォルダ内（logic）だけ
import type { GameContext, IGame } from '../../game-api/types';
import { clamp } from '../../game-api/helpers';
import { BIN_LEFT, BIN_RIGHT, type Prize, gripOf, isHeld, makePrizes, prizeUnder, scoreFor, triWave } from './logic';

const W = 360;
const H = 640;
const TOP_Y = 120; // クレーン待機の高さ
const PRIZE_Y = 500; // 景品の高さ
const CHUTE_X = 334; // シュート（右）の x
const ROUNDS = 8;
const DROP_MS = 620;
const GRAB_MS = 420;
const LIFT_MS = 620;
const CARRY_MS = 900;
const RESULT_MS = 1300;
const END_DELAY = 1500;
const SCORE_HI = 700;
const PERFECT_GRIP = 0.95;

type Phase = 'aim' | 'drop' | 'grab' | 'lift' | 'carry' | 'result' | 'over';

export function createGame(ctx: GameContext): IGame {
  const cv = ctx.canvas2d({ design: { w: W, h: H } });
  const g = cv.ctx;

  let phase: Phase = 'aim';
  let hostPaused = false;
  let round = 1;
  let score = 0;
  let got = 0; // つかんだ数
  let prizes: Prize[] = makePrizes(ctx.random);
  let aimPhase = 0; // 三角波の位相
  let clawX = BIN_LEFT;
  let clawY = TOP_Y;
  let target: Prize | null = null;
  let grip = 0;
  let held = false;
  let slipFrac = 1; // すべる位置（0..1・held なら 1で落ちない）
  let carried: Prize | null = null; // 運んでいる景品
  let phaseStart = 0;
  let lastMsg = '';
  let lastGain = 0; // 直近ラウンドの獲得点（検証用）
  let lastEmoji = '';
  let endAt = 0;
  let ended = false;

  function aimPeriodMs(): number {
    return Math.max(900, 1600 - (round - 1) * 90);
  }

  function setData(): void {
    if (!import.meta.env.DEV) return;
    const r = ctx.root as HTMLElement;
    r.dataset.mode = phase;
    r.dataset.round = String(round);
    r.dataset.score = String(score);
    r.dataset.got = String(got);
    r.dataset.clawx = clawX.toFixed(1);
    r.dataset.lastgain = String(lastGain);
    r.dataset.lastgrip = grip.toFixed(6);
    r.dataset.lastheld = held ? '1' : '0';
    r.dataset.lastemoji = lastEmoji;
    r.dataset.prizes = prizes.map((p) => `${p.cx.toFixed(0)},${p.half},${p.taken ? 1 : 0},${p.rare ? 1 : 0},${p.value}`).join(';');
  }

  // ---- 入力（タップで止める）----
  const offTap = ctx.input.onTap(() => {
    if (hostPaused) return;
    if (phase === 'aim') {
      // クレーンを止めて つかみ判定を確定
      target = prizeUnder(prizes, clawX);
      grip = target ? gripOf(target, clawX) : 0;
      phase = 'drop';
      phaseStart = ctx.now();
      ctx.sfx('tap');
    }
  });

  // ---- フェーズ遷移 ----
  function toPhase(p: Phase, now: number): void {
    phase = p;
    phaseStart = now;
  }

  function resolveGrab(now: number): void {
    // つかみ確定: グリップから すべり判定（rng）
    if (target) {
      const slipRoll = ctx.random();
      held = isHeld(grip, slipRoll);
      slipFrac = held ? 1 : 0.25 + ctx.random() * 0.55;
      carried = target;
    } else {
      held = false;
      slipFrac = 0;
      carried = null;
    }
    toPhase('lift', now);
  }

  function finishRound(now: number): void {
    if (held && carried) {
      const pts = scoreFor(carried, grip);
      score += pts;
      got++;
      lastGain = pts;
      lastEmoji = carried.emoji;
      carried.taken = true;
      lastMsg = `GET！ +${pts}`;
      ctx.sfx('medal');
      ctx.haptic('success');
      // 実績（つかんだ瞬間に解除）
      ctx.achieve('first-get');
      if (got >= 5) ctx.achieve('get-5');
      if (carried.rare) ctx.achieve('rare-get');
      if (carried.emoji === '💎') ctx.achieve('gem-get');
      if (grip >= PERFECT_GRIP) ctx.achieve('perfect');
      if (score >= SCORE_HI) ctx.achieve('score-hi');
      // ぜんぶ取ったら 補充
      if (prizes.every((p) => p.taken)) prizes = makePrizes(ctx.random);
    } else {
      lastGain = 0;
      lastEmoji = '';
      lastMsg = target ? 'つるっ…！' : 'なにも つかめなかった…';
      ctx.sfx('fail');
      ctx.haptic('error');
    }
    carried = null;
    toPhase('result', now);
  }

  // ---- 毎フレーム ----
  const offFrame = ctx.onFrame((dt) => {
    if (hostPaused) return;
    const now = ctx.now();
    const t = (now - phaseStart) / 1000;

    if (phase === 'aim') {
      aimPhase += (dt * 1000) / aimPeriodMs();
      clawX = BIN_LEFT + triWave(aimPhase) * (BIN_RIGHT - BIN_LEFT);
      clawY = TOP_Y;
    } else if (phase === 'drop') {
      const k = clamp((t * 1000) / DROP_MS, 0, 1);
      clawY = TOP_Y + (PRIZE_Y - TOP_Y) * k;
      if (k >= 1) toPhase('grab', now);
    } else if (phase === 'grab') {
      if ((t * 1000) >= GRAB_MS) resolveGrab(now);
    } else if (phase === 'lift') {
      const k = clamp((t * 1000) / LIFT_MS, 0, 1);
      clawY = PRIZE_Y + (TOP_Y - PRIZE_Y) * k;
      if (k >= 1) toPhase('carry', now);
    } else if (phase === 'carry') {
      const k = clamp((t * 1000) / CARRY_MS, 0, 1);
      const startX = target ? target.cx : clawX;
      clawX = startX + (CHUTE_X - startX) * k;
      clawY = TOP_Y;
      if (!held && k >= slipFrac) {
        // ここで すべって落下 → ラウンド終了（落下演出は result で）
        finishRound(now);
      } else if (k >= 1) {
        finishRound(now);
      }
    } else if (phase === 'result') {
      if ((t * 1000) >= RESULT_MS) {
        if (round >= ROUNDS) {
          toPhase('over', now);
          endAt = now + END_DELAY;
        } else {
          round++;
          target = null;
          carried = null;
          clawX = BIN_LEFT;
          aimPhase = 0;
          toPhase('aim', now);
        }
      }
    } else if (phase === 'over') {
      if (!ended && now >= endAt) {
        ended = true;
        ctx.end({ score });
        return;
      }
    }
    draw(now);
    setData();
  });

  // ---- 描画 ----
  function draw(now: number): void {
    // 背景（ゲーセン風・固定色）
    const bg = g.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#3a1c5e');
    bg.addColorStop(1, '#1a1030');
    g.fillStyle = bg;
    g.fillRect(0, 0, W, H);

    // レール（上部）
    g.fillStyle = '#5a4a80';
    g.fillRect(0, TOP_Y - 42, W, 10);

    // HUD
    g.fillStyle = '#fff';
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.font = 'bold 22px sans-serif';
    g.fillText(`${score}てん`, 14, 30);
    g.textAlign = 'right';
    g.font = 'bold 18px sans-serif';
    g.fillText(`${round}/${ROUNDS}回`, W - 14, 30);

    // ビン（下の景品置き場）
    g.fillStyle = 'rgba(255,255,255,.07)';
    g.fillRect(BIN_LEFT - 22, PRIZE_Y - 34, BIN_RIGHT - BIN_LEFT + 44, 80);
    // シュート（右の穴）
    g.fillStyle = '#12081f';
    g.beginPath();
    g.ellipse(CHUTE_X, PRIZE_Y + 30, 24, 12, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#8affd0';
    g.font = 'bold 12px sans-serif';
    g.textAlign = 'center';
    g.fillText('シュート', CHUTE_X, PRIZE_Y + 54);

    // 景品
    g.textBaseline = 'middle';
    g.font = '30px sans-serif';
    for (const p of prizes) {
      if (p.taken) continue;
      if (carried === p) continue; // 運搬中は クレーン側で描く
      if (p.rare) {
        g.save();
        g.globalAlpha = 0.5 + Math.sin(now / 250) * 0.3;
        g.fillStyle = p.emoji === '💎' ? '#7ce0ff' : '#ffd54a';
        g.beginPath();
        g.arc(p.cx, PRIZE_Y, p.half + 8, 0, Math.PI * 2);
        g.fill();
        g.restore();
      }
      g.fillText(p.emoji, p.cx, PRIZE_Y);
    }

    // クレーン（ケーブル＋本体＋つめ）
    const closed = phase === 'grab' || phase === 'lift' || phase === 'carry';
    g.strokeStyle = '#cfc0e8';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(clawX, TOP_Y - 42);
    g.lineTo(clawX, clawY - 16);
    g.stroke();
    // 本体
    g.fillStyle = '#d9d0f0';
    g.beginPath();
    g.moveTo(clawX - 14, clawY - 16);
    g.lineTo(clawX + 14, clawY - 16);
    g.lineTo(clawX + 8, clawY - 4);
    g.lineTo(clawX - 8, clawY - 4);
    g.closePath();
    g.fill();
    // つめ（開閉）
    const spread = closed ? 6 : 16;
    g.strokeStyle = '#b9a9e0';
    g.lineWidth = 4;
    g.lineCap = 'round';
    for (const s of [-1, 1]) {
      g.beginPath();
      g.moveTo(clawX + s * 6, clawY - 4);
      g.lineTo(clawX + s * spread, clawY + 14);
      g.lineTo(clawX + s * (spread - 4), clawY + 24);
      g.stroke();
    }
    // 運搬中の景品
    if (carried && (phase === 'lift' || phase === 'carry')) {
      g.font = '30px sans-serif';
      g.textAlign = 'center';
      g.fillText(carried.emoji, clawX, clawY + 26);
    }

    // メッセージ
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    if (phase === 'aim') {
      g.fillStyle = '#ffe08a';
      g.font = 'bold 20px sans-serif';
      g.fillText('タップで とめる！', W / 2, 200);
    } else if (phase === 'result') {
      g.fillStyle = held ? '#8affc0' : '#ff9a9a';
      g.font = 'bold 26px sans-serif';
      g.fillText(lastMsg, W / 2, 220);
    }

    if (phase === 'over') {
      g.fillStyle = 'rgba(10,6,24,.72)';
      g.fillRect(0, 0, W, H);
      g.fillStyle = '#fff';
      g.font = 'bold 30px sans-serif';
      g.fillText('おしまい！', W / 2, H / 2 - 40);
      g.font = 'bold 26px sans-serif';
      g.fillText(`${got}こ ゲット / ${score}てん`, W / 2, H / 2 + 6);
    }
  }

  // ---- 起動 ----
  draw(0);
  setData();

  return {
    start() {
      /* immediate: 設定なし・すぐ aim */
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
