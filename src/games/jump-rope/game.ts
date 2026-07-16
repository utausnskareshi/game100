// =============================================================
// ぴょんぴょんなわとび（No.49）: 回ってくるなわに合わせてタップでジャンプ！
// =============================================================
// - なわが足もとを通るしゅんかんに 地面にいると つまずき（3回でおしまい）。
//   とぶたびに 回転が少しずつ はやくなる。れんぞくで コンボボーナス。
// - 回転・得点は logic.ts（乱数不使用＝毎回同じランプ）。
// - 見た目の約束（2026-07-14 わかりやすさ改善）:
//   * なわの高さ/前後は logic.ts の ropeHeightK / ropeDepthK に従う
//     （+1=足もと＝判定の瞬間。以前は描画の符号が判定と半回転ズレていた）。
//   * 判定の GLOW_LEAD_MS 前から「足もとが金色に光る」＝光っている間にタップすれば
//     必ず滞空中に判定が来る（GLOW_LEAD_MS < JUMP_MS で保証）。光り始めに tick 音。
//   * 残像となわの太さ/濃さ（まえ=濃い・うしろ=うすい）で回転の向きを見せる。
//   * つまずき後は「足もとにからまる→てっぺんで待つ→再開」を見せる（テレポートしない）。
// - Canvas 360×640。タップのみ（onDown）。シェルの3-2-1で開始。
// - import してよいのは game-api（types / helpers）と、このフォルダ内（logic）だけ
import type { GameContext, IGame } from '../../game-api/types';
import { GLOW_LEAD_MS, JUMP_MS, MISSES_MAX, STUN_MS, jumpPoints, periodAt, ropeDepthK, ropeHeightK } from './logic';

const W = 360;
const H = 640;
const GROUND_Y = 470;
const HANDS_Y = GROUND_Y - 74; // なわの持ち手（両はし）の高さ
const ROPE_R = 94; // なわの縦ふり幅: 足もと=HANDS_Y+R（くるぶし）〜てっぺん=HANDS_Y-R（頭上）
const JUMP_H = 74; // ジャンプの高さ（px）
const TANGLE_MS = 450; // つまずき直後、なわが足もとにからまって見える時間（演出のみ）
const TRAIL_MS = 40; // 残像1コマぶんの時間差
const END_DELAY = 1900;
const SCORE_HI = 700;

const wrap01 = (v: number): number => ((v % 1) + 1) % 1;

type Mode = 'ready' | 'play' | 'over';

export function createGame(ctx: GameContext): IGame {
  const cv = ctx.canvas2d({ design: { w: W, h: H } });
  const g = cv.ctx;

  // ---- 状態 ----
  let mode: Mode = 'ready';
  let hostPaused = false;
  let phase = 0.5; // 0=足もと通過。0.5=てっぺんから開始
  let jumps = 0;
  let combo = 0;
  let misses = 0;
  let score = 0;
  let jumpStart = -1; // ctx.now（-1=接地）
  let stunUntil = 0;
  let tripFlashUntil = 0;
  let endAt = 0;
  let ended = false;
  let glowOn = false; // 「あと GLOW_LEAD_MS 以内に判定が来る」合図の点灯中か

  function airborne(now: number): boolean {
    return jumpStart >= 0 && now < jumpStart + JUMP_MS;
  }

  function setData(now: number): void {
    if (!import.meta.env.DEV) return;
    const r = ctx.root as HTMLElement;
    r.dataset.mode = mode;
    r.dataset.jumps = String(jumps);
    r.dataset.score = String(score);
    r.dataset.combo = String(combo);
    r.dataset.misses = String(misses);
    r.dataset.phase = phase.toFixed(4);
    r.dataset.air = airborne(now) ? '1' : '0';
    r.dataset.stunned = now < stunUntil ? '1' : '0';
    r.dataset.glow = glowOn ? '1' : '0';
  }

  // ---- 入力（タップ＝ジャンプ）----
  const offDown = ctx.input.onDown(() => {
    if (mode !== 'play' || hostPaused) return;
    const now = ctx.now();
    if (airborne(now) || now < stunUntil) return;
    jumpStart = now;
    ctx.sfx('tap');
  });

  // ---- 進行 ----
  function updatePlay(dt: number, now: number): void {
    if (now < stunUntil) {
      // つまずき後は なわが止まる（着地だけは進める）
      if (jumpStart >= 0 && now >= jumpStart + JUMP_MS) jumpStart = -1;
      return;
    }
    const period = periodAt(jumps);
    phase += (dt * 1000) / period;
    if (phase >= 1) {
      phase -= 1;
      // このフレーム内で実際に足もとを通過した時刻で滞空を判定する
      // （フレームが遅れても「光っている間にとべば成功」の約束が崩れないように）
      const passAt = now - phase * period;
      if (jumpStart >= 0 && jumpStart <= passAt && passAt < jumpStart + JUMP_MS) {
        jumps++;
        combo++;
        score += jumpPoints(combo);
        ctx.sfx(combo % 10 === 0 ? 'combo' : 'success');
        ctx.haptic('light');
        // 実績（加算箇所で即解除）
        if (jumps >= 10) ctx.achieve('first-10');
        if (jumps >= 30) ctx.achieve('jump-30');
        if (jumps >= 60) ctx.achieve('jump-60');
        if (combo >= 25) ctx.achieve('combo-25');
        if (misses === 0 && jumps >= 30) ctx.achieve('no-trip-30');
        if (score >= SCORE_HI) ctx.achieve('score-hi');
      } else {
        misses++;
        combo = 0;
        tripFlashUntil = now + 800;
        ctx.sfx('fail');
        ctx.haptic('error');
        if (misses >= MISSES_MAX) {
          mode = 'over';
          endAt = now + END_DELAY;
          return;
        }
        stunUntil = now + STUN_MS;
        phase = 0.5; // てっぺんから再開
      }
    }
    if (jumpStart >= 0 && now >= jumpStart + JUMP_MS) jumpStart = -1; // 着地（判定のあと）
  }

  // ---- 毎フレーム ----
  const offFrame = ctx.onFrame((dt) => {
    const now = ctx.now();
    if (!hostPaused) {
      if (mode === 'play') updatePlay(dt, now);
      if (mode === 'over' && !ended && now >= endAt) {
        ended = true;
        ctx.end({ score });
        return;
      }
      // 「足もとが光る」＝あと GLOW_LEAD_MS 以内に判定が来る合図（点灯の瞬間に tick 音）
      const on = mode === 'play' && now >= stunUntil && (1 - phase) * periodAt(jumps) <= GLOW_LEAD_MS;
      if (on && !glowOn) ctx.sfx('tick');
      glowOn = on;
    }
    draw(now);
    setData(now);
  });

  // ---- 描画（こうえんの固定パレット＝両テーマ共通）----
  function draw(now: number): void {
    // そら・じめん
    const sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#a8dcf5');
    sky.addColorStop(1, '#e6f6e8');
    g.fillStyle = sky;
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#9fd08a';
    g.fillRect(0, GROUND_Y + 26, W, H - GROUND_Y - 26);

    const cx = W / 2;
    const stunned = mode === 'play' && now < stunUntil;
    // つまずき直後は「足もとにからまる」→ そのあと「てっぺんで待つ」を見せる
    // （判定用の phase は 0.5 のまま。見た目だけの差し替え）
    const tangled = stunned && now < stunUntil - STUN_MS + TANGLE_MS;
    const vPhase = tangled ? 0 : phase;
    const jt = jumpStart >= 0 ? Math.min(1, (now - jumpStart) / JUMP_MS) : 1;
    const jumpY = jumpStart >= 0 ? -Math.sin(jt * Math.PI) * JUMP_H : 0;
    const grounded = jumpStart < 0;
    const crouch = glowOn && grounded ? 3 : 0; // 「とぶよ！」のかがみこみ

    // なわ＝本体＋残像（回転の向き・はやさが見えるように）
    const period = periodAt(jumps);
    const ropes: { ph: number; alpha: number; main: boolean }[] = [];
    if (mode === 'play' && !stunned) {
      ropes.push({ ph: wrap01(vPhase - (TRAIL_MS * 2) / period), alpha: 0.13, main: false });
      ropes.push({ ph: wrap01(vPhase - TRAIL_MS / period), alpha: 0.3, main: false });
    }
    ropes.push({ ph: vPhase, alpha: tangled ? 0.6 : 1, main: true });

    const ropePath = (ctrlY: number): void => {
      g.beginPath();
      g.moveTo(cx - 96, HANDS_Y);
      g.quadraticCurveTo(cx, ctrlY, cx + 96, HANDS_Y);
    };
    const drawRope = (r: { ph: number; alpha: number; main: boolean }): void => {
      const behind = ropeDepthK(r.ph) > 0;
      const apexY = HANDS_Y + ropeHeightK(r.ph) * ROPE_R; // +1=足もと / -1=てっぺん
      const ctrlY = 2 * apexY - HANDS_Y; // 曲線の頂点がちょうど apexY に来る制御点
      g.save();
      g.globalAlpha = r.alpha * (behind ? 0.42 : 1);
      g.lineCap = 'round';
      if (r.main && glowOn && !behind && !stunned) {
        // 光っている間＝タップすれば まにあう時間帯。なわ自体も光らせる
        g.strokeStyle = 'rgba(255,176,64,.45)';
        g.lineWidth = 13;
        ropePath(ctrlY);
        g.stroke();
        g.strokeStyle = '#f08616';
      } else {
        g.strokeStyle = '#c8783c';
      }
      g.lineWidth = behind ? 3.5 : 6;
      ropePath(ctrlY);
      g.stroke();
      g.restore();
    };

    // うしろ半分のなわ → 足もとの合図 → かげ → キャラ → まえ半分のなわ の順に描く
    for (const r of ropes) if (ropeDepthK(r.ph) > 0) drawRope(r);

    if (glowOn && grounded && mode === 'play') {
      // 足もとの「いまタップ！」リング（判定前 GLOW_LEAD_MS の間だけ光る）
      const pulse = 0.55 + 0.3 * Math.sin(now / 70);
      g.save();
      g.globalAlpha = pulse * 0.35;
      g.fillStyle = '#ffd76a';
      g.beginPath();
      g.ellipse(cx, GROUND_Y + 20, 52, 14, 0, 0, Math.PI * 2);
      g.fill();
      g.globalAlpha = pulse;
      g.strokeStyle = '#f5a623';
      g.lineWidth = 5;
      g.beginPath();
      g.ellipse(cx, GROUND_Y + 20, 52, 14, 0, 0, Math.PI * 2);
      g.stroke();
      g.restore();
    }

    // かげ
    g.fillStyle = 'rgba(60,80,50,.25)';
    g.beginPath();
    g.ellipse(cx, GROUND_Y + 20, 40 + jumpY * 0.12, 10, 0, 0, Math.PI * 2);
    g.fill();

    // キャラ（絵文字）
    g.font = '64px sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'bottom';
    g.fillText(now < tripFlashUntil ? '💫' : '🧒', cx, GROUND_Y + 18 + jumpY + crouch);
    g.textBaseline = 'middle';

    // まえ半分のなわ（キャラの前を横切る＝おりてくる側）
    for (const r of ropes) if (ropeDepthK(r.ph) <= 0) drawRope(r);

    // HUD
    g.fillStyle = '#2c3d57';
    g.textAlign = 'left';
    g.font = 'bold 26px sans-serif';
    g.fillText(`${jumps}かい`, 14, 36);
    g.font = 'bold 14px sans-serif';
    let hearts = '';
    for (let i = 0; i < MISSES_MAX; i++) hearts += i < MISSES_MAX - misses ? '❤️' : '🤍';
    g.fillText(hearts, 14, 62);
    g.fillText(`${score}てん`, 110, 62);
    if (combo >= 3) {
      g.fillStyle = '#e8641e';
      g.fillText(`🔥×${combo}`, 190, 62);
    }

    // メッセージ
    g.textAlign = 'center';
    if (mode === 'play' && stunned) {
      g.fillStyle = '#e0524a';
      g.font = 'bold 20px sans-serif';
      g.fillText('おっとっと… もういちど！', cx, 560);
    } else if (mode === 'play' && jumps === 0) {
      if (glowOn && grounded) {
        g.fillStyle = '#e8641e';
        g.font = 'bold 26px sans-serif';
        g.fillText('いま！タップ！！', cx, 560);
      } else {
        g.fillStyle = '#3a5a76';
        g.font = 'bold 15px sans-serif';
        g.fillText('足もとが 金色に ひかったら タップ！', cx, 560);
      }
    }

    if (mode === 'over') {
      g.fillStyle = 'rgba(20,40,60,.62)';
      g.fillRect(0, 0, W, H);
      g.fillStyle = '#fff';
      g.font = 'bold 34px sans-serif';
      g.fillText('ひっかかった〜！', cx, H / 2 - 40);
      g.font = 'bold 24px sans-serif';
      g.fillText(`${jumps}かい とんだ / ${score}てん`, cx, H / 2 + 8);
    }
  }

  // ---- 起動（シェルの 3-2-1 のあと start()）----
  draw(0);
  setData(0);

  return {
    start() {
      mode = 'play';
      phase = 0.5;
      setData(ctx.now());
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
