// =============================================================
// ためてジャンプ（No.40）: 長おしでパワーをためて、はなした瞬間ジャンプ！つぎの足場へ
// =============================================================
// - おしている長さ＝とぶ距離。まん中付近に乗ると「ピタッ！」ボーナス＋連続コンボ。
// - 足場はだんだん せまく・遠く・うごく（うごく足場は着地の瞬間の位置で判定＝先読みが必要）。
// - とどかない/とびすぎたら落下で終了。同じ足場に戻るぶんにはセーフ。
// - 足場・ジャンプ計算は logic.ts（rng注入・消費回数固定＝日替わり同一コース）。
// - Canvas 360×640。ホールドは onDown/onUp のみ（onMove非購読）。シェルの3-2-1で開始。
// - import してよいのは game-api（types / helpers）と、このフォルダ内（logic）だけ
import type { GameContext, IGame } from '../../game-api/types';
import { clamp } from '../../game-api/helpers';
import {
  CHARGE_MS,
  PITA_FRAC,
  firstPlatform,
  jumpDist,
  jumpMs,
  landPoints,
  platformCx,
  rollPlatform,
  type Platform,
} from './logic';

const W = 360;
const H = 640;
const PLAT_Y = 470; // 足場の上面
const FROG_SCREEN_X = 90; // カメラが落ち着いたときのカエルの画面x
const JUMP_H = 120; // ジャンプの高さ（見た目）
const FALL_MS = 900;
const END_DELAY = 1900;
const SCORE_HI = 500;

type Mode = 'ready' | 'idle' | 'charge' | 'jump' | 'fall' | 'over';

export function createGame(ctx: GameContext): IGame {
  const cv = ctx.canvas2d({ design: { w: W, h: H } });
  const g = cv.ctx;

  // ---- 状態 ----
  let mode: Mode = 'ready';
  let hostPaused = false;
  const platforms: Platform[] = [firstPlatform()];
  let platIdx = 0; // いま乗っている足場
  let standOffset = 0; // 足場中心からのズレ（うごく足場と一緒に動くため）
  let playStart = 0;
  let chargeStart = 0;
  let chargePower = 0; // 表示用（チャージ中に毎フレーム更新）
  let jumpStart = 0;
  let jumpFrom = 0; // world x
  let jumpLen = 0;
  let jumpDur = 1;
  let camX = 0;
  let score = 0;
  let lands = 0;
  let pitaStreak = 0;
  let movingLands = 0;
  let fallAt = 0;
  let fallX = 0;
  let banner = '';
  let bannerUntil = 0;
  let endAt = 0;
  let ended = false;
  let activePid = -1;

  function ensurePlatforms(upTo: number): void {
    while (platforms.length <= upTo) {
      const i = platforms.length;
      platforms.push(rollPlatform(ctx.random, i, platforms[i - 1]!));
    }
  }
  ensurePlatforms(6);

  function elapsed(now: number): number {
    return now - playStart;
  }

  function frogWorldX(now: number): number {
    if (mode === 'jump') {
      const t = Math.min(1, (now - jumpStart) / jumpDur);
      return jumpFrom + jumpLen * t;
    }
    if (mode === 'fall') return fallX;
    return platformCx(platforms[platIdx]!, elapsed(now)) + standOffset;
  }

  function setData(now: number): void {
    const r = ctx.root as HTMLElement;
    r.dataset.mode = mode;
    r.dataset.score = String(score);
    r.dataset.lands = String(lands);
    if (!import.meta.env.DEV) return;
    r.dataset.streak = String(pitaStreak);
    r.dataset.movinglands = String(movingLands);
    r.dataset.frogx = frogWorldX(now).toFixed(1);
    r.dataset.elapsed = String(Math.round(elapsed(now)));
    r.dataset.plats = JSON.stringify(
      platforms.slice(platIdx, platIdx + 3).map((p) => ({
        cx: p.baseCx, w: p.w, mv: p.moving ? 1 : 0, amp: +p.amp.toFixed(2), sp: +p.speed.toFixed(3), ph: +p.phase.toFixed(2),
      })),
    );
  }

  // ---- 入力（ホールド＆リリース）----
  const offDown = ctx.input.onDown((p) => {
    if (mode !== 'idle' || hostPaused) return;
    activePid = p.id;
    mode = 'charge';
    chargeStart = ctx.now();
    chargePower = 0;
    ctx.sfx('tick');
  });
  const offUp = ctx.input.onUp((p) => {
    if (mode !== 'charge' || p.id !== activePid) return;
    activePid = -1;
    const now = ctx.now();
    const power = clamp((now - chargeStart) / CHARGE_MS, 0, 1);
    jumpFrom = frogWorldX(now);
    jumpLen = jumpDist(power);
    jumpDur = jumpMs(power);
    jumpStart = now;
    mode = 'jump';
    ctx.sfx('powerup');
    ctx.haptic('light');
  });

  // ---- 着地判定 ----
  function landAt(now: number): void {
    const landX = jumpFrom + jumpLen;
    const t = elapsed(now);
    // 先の足場から順に判定（大ジャンプで1まい とびこすのも あり＝不公平な落下を作らない）
    ensurePlatforms(platIdx + 4);
    for (let j = Math.min(platIdx + 3, platforms.length - 1); j > platIdx; j--) {
      const p = platforms[j]!;
      const dj = landX - platformCx(p, t);
      if (Math.abs(dj) > p.w / 2) continue;
      const skipped = j - platIdx - 1;
      platIdx = j;
      ensurePlatforms(platIdx + 6);
      standOffset = dj;
      lands += 1 + skipped;
      const pita = Math.abs(dj) <= p.w * PITA_FRAC;
      if (pita) {
        pitaStreak++;
        ctx.achieve('first-pita');
        if (pitaStreak >= 5) ctx.achieve('pita-combo-5');
      } else {
        pitaStreak = 0;
      }
      score += landPoints(pita, pitaStreak);
      if (p.moving) {
        movingLands++;
        if (movingLands >= 8) ctx.achieve('moving-8');
      }
      if (lands >= 10) ctx.achieve('land-10');
      if (lands >= 25) ctx.achieve('land-25');
      if (score >= SCORE_HI) ctx.achieve('score-hi');
      banner = skipped > 0 ? 'とびこし！' : pita ? `ピタッ！ +${landPoints(true, pitaStreak)}` : '+10';
      bannerUntil = now + 750;
      mode = 'idle';
      ctx.sfx(pita ? 'combo' : 'success');
      if (pita) ctx.haptic('success');
      return;
    }
    // いまの足場に戻った（セーフ・得点なし）
    const cur = platforms[platIdx]!;
    const dCur = landX - platformCx(cur, t);
    if (Math.abs(dCur) <= cur.w / 2) {
      standOffset = dCur;
      pitaStreak = 0;
      banner = 'あぶない！';
      bannerUntil = now + 750;
      mode = 'idle';
      ctx.sfx('tick');
      return;
    }
    // 落下
    fallX = landX;
    fallAt = now;
    mode = 'fall';
    ctx.sfx('fail');
    ctx.haptic('error');
    endAt = now + FALL_MS + END_DELAY;
  }

  // ---- 毎フレーム ----
  const offFrame = ctx.onFrame(() => {
    const now = ctx.now();
    if (!hostPaused) {
      if (mode === 'charge') chargePower = clamp((now - chargeStart) / CHARGE_MS, 0, 1);
      if (mode === 'jump' && now >= jumpStart + jumpDur) landAt(now);
      if (mode === 'fall' && now >= fallAt + FALL_MS + 100) mode = 'over';
      if ((mode === 'over' || mode === 'fall') && !ended && endAt > 0 && now >= endAt) {
        ended = true;
        ctx.end({ score });
        return;
      }
    }
    // カメラはカエルを追う
    camX += (frogWorldX(now) - FROG_SCREEN_X - camX) * 0.14;
    draw(now);
    setData(now);
  });

  // ---- 描画（固定パレット＝両テーマ共通）----
  function draw(now: number): void {
    const t = elapsed(now);
    // そら
    const sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#a8dcf5');
    sky.addColorStop(1, '#e9f7e6');
    g.fillStyle = sky;
    g.fillRect(0, 0, W, H);
    // くも（パララックス）
    g.fillStyle = 'rgba(255,255,255,.85)';
    for (const c of [
      { x: 120, y: 100, r: 18 },
      { x: 420, y: 160, r: 22 },
      { x: 720, y: 80, r: 16 },
    ]) {
      const cx = ((c.x - camX * 0.25) % 800 + 800) % 800 - 60;
      g.beginPath();
      g.arc(cx, c.y, c.r, 0, Math.PI * 2);
      g.arc(cx + c.r, c.y + 4, c.r * 0.7, 0, Math.PI * 2);
      g.arc(cx - c.r, c.y + 4, c.r * 0.65, 0, Math.PI * 2);
      g.fill();
    }
    // したの ぬま（おちるところ）
    g.fillStyle = '#7cc4e8';
    g.fillRect(0, 596, W, H - 596);

    // 足場（見えている範囲）
    for (let i = Math.max(0, platIdx - 1); i < platforms.length; i++) {
      const p = platforms[i]!;
      const cx = platformCx(p, t) - camX;
      if (cx < -80) continue;
      if (cx > W + 90) break;
      // くさの柱
      g.fillStyle = '#8a5a33';
      g.fillRect(cx - p.w / 2 + 4, PLAT_Y + 10, p.w - 8, 596 - PLAT_Y - 10);
      g.fillStyle = '#59b34d';
      g.beginPath();
      g.moveTo(cx - p.w / 2, PLAT_Y + 12);
      g.lineTo(cx - p.w / 2, PLAT_Y);
      g.lineTo(cx + p.w / 2, PLAT_Y);
      g.lineTo(cx + p.w / 2, PLAT_Y + 12);
      g.closePath();
      g.fill();
      // ピタッゾーン
      g.fillStyle = 'rgba(255,220,80,.85)';
      g.fillRect(cx - p.w * PITA_FRAC, PLAT_Y, p.w * PITA_FRAC * 2, 5);
      if (p.moving) {
        g.fillStyle = '#2c6fbb';
        g.font = 'bold 11px sans-serif';
        g.textAlign = 'center';
        g.fillText('⇄', cx, PLAT_Y + 24);
      }
    }

    // カエル
    const fx = frogWorldX(now) - camX;
    let fy = PLAT_Y;
    if (mode === 'jump') {
      const jt = Math.min(1, (now - jumpStart) / jumpDur);
      fy = PLAT_Y - Math.sin(jt * Math.PI) * JUMP_H;
    } else if (mode === 'fall') {
      const ft = Math.min(1, (now - fallAt) / FALL_MS);
      fy = PLAT_Y + ft * ft * 160;
    }
    const squash = mode === 'charge' ? chargePower * 5 : 0;
    g.font = `${30 - squash}px sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'bottom';
    g.fillText('🐸', fx, fy + 2 + squash * 0.6);
    g.textBaseline = 'middle';

    // パワーゲージ（ためている間・カエルの上）
    if (mode === 'charge') {
      const gx = fx - 30;
      const gy = fy - 58;
      g.fillStyle = 'rgba(50,60,70,.35)';
      g.fillRect(gx, gy, 60, 10);
      g.fillStyle = chargePower >= 1 ? '#f0524a' : '#ffb03a';
      g.fillRect(gx, gy, 60 * chargePower, 10);
      g.strokeStyle = '#54636f';
      g.lineWidth = 2;
      g.strokeRect(gx, gy, 60, 10);
    }

    // 着地バナー
    if (now < bannerUntil && banner) {
      g.fillStyle = banner.startsWith('ピタッ') ? '#e8641e' : '#3a5a76';
      g.font = 'bold 22px sans-serif';
      g.textAlign = 'center';
      g.fillText(banner, fx, fy - 74);
    }

    // HUD（左上）
    g.fillStyle = '#2c3d57';
    g.textAlign = 'left';
    g.font = 'bold 20px sans-serif';
    g.fillText(`${score}てん`, 14, 34);
    g.font = 'bold 13px sans-serif';
    g.fillText(`あしば ${lands}`, 14, 58);
    if (pitaStreak >= 2) {
      g.fillStyle = '#e8641e';
      g.fillText(`🔥ピタッ×${pitaStreak}`, 100, 58);
    }

    // 終了
    if (mode === 'over' || (mode === 'fall' && now >= fallAt + FALL_MS)) {
      g.fillStyle = 'rgba(20,40,55,.62)';
      g.fillRect(0, 0, W, H);
      g.fillStyle = '#fff';
      g.textAlign = 'center';
      g.font = 'bold 34px sans-serif';
      g.fillText('ぽちゃん…', W / 2, H / 2 - 40);
      g.font = 'bold 24px sans-serif';
      g.fillText(`あしば ${lands}こ / ${score}てん`, W / 2, H / 2 + 8);
    }
  }

  // ---- 起動（シェルの 3-2-1 のあと start() が呼ばれる）----
  draw(0);

  return {
    start() {
      mode = 'idle';
      playStart = ctx.now();
      setData(ctx.now());
    },
    pause() {
      hostPaused = true;
      // ためている途中なら不発に（おしっぱなしのままポーズ→とびだし事故を防ぐ）
      if (mode === 'charge') mode = 'idle';
      activePid = -1;
    },
    resume() {
      hostPaused = false;
    },
    resize() {
      draw(ctx.now());
    },
    destroy() {
      offDown();
      offUp();
      offFrame();
    },
  };
}
