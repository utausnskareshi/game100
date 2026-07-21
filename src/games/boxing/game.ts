// =============================================================
// ボクシング（No.82）: 予備動作を見て スワイプでよけ、すきに タップでカウンター！
// =============================================================
// - 相手のグローブが光る＝予備動作 → 本命パンチ。正しい方向へよけていれば回避＋「すき」発生。
//   すきの間のタップだけがカウンターとして当たる（それ以外はガードされる＝連打無効）。
// - フェイント（光るだけ→逆から本命）・連打コンボはラウンドが進むほど増える（むずかしい）。
// - 攻撃抽選・設定・採点は logic.ts（rng注入＝完全決定論・理不尽なし保証つき）。
// - 全画面 Canvas・時間は ctx.now 期限方式・setTimeout 不使用。
// - import してよいのは game-api（types / helpers）と、このフォルダ内（logic）だけ
import type { GameContext, IGame } from '../../game-api/types';
import {
  type AttackEv,
  type AttackType,
  COUNTER_PTS,
  DODGE_ACTIVE_MS,
  DODGE_PTS,
  type DodgeDir,
  FEINT_CANCEL_FRAC,
  HEART_BONUS,
  JUST_BONUS,
  JUST_FRAC,
  KO_BONUS,
  LIVES,
  ROUNDS,
  STUN_MS,
  W,
  H,
  comboBonus,
  correctDodge,
  feintFollow,
  rollAttack,
} from './logic';

const HUD_H = 44;
const ROUND_BANNER_MS = 1500;
const KO_BANNER_MS = 1700;
const END_DELAY = 2000;
const SCORE_HI = 1500; // 実績閾値（完璧ボットで較正・実機要調整）
const DODGE_ACH = 15;
const OPP = { x: 180, y: 236 }; // 相手の胸の中心

type Phase = 'round-in' | 'gap' | 'tele' | 'open' | 'stun' | 'ko' | 'over';

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

  let phase: Phase = 'round-in';
  let started = false;
  let hostPaused = false;
  let roundIdx = 0;
  let hp = ROUNDS[0]!.hp;
  let hearts = LIVES;
  let score = 0;
  let dodges = 0;
  let counters = 0;
  let justs = 0;
  let combo = 0;
  let roundDamage = 0;
  // 攻撃の進行
  let pending: AttackEv | null = null; // つぎの攻撃（gap 中に保持）
  let queuedFollow: AttackEv | null = null; // フェイント直後の本命
  let phaseAt = 0; // いまの phase に入った時刻
  let gapUntil = 0;
  let teleUntil = 0; // 本命の着弾時刻
  let feintCancelAt = 0;
  let curType: AttackType = 'L';
  let curFeint = false;
  let curIsFollow = false; // フェイント後の本命か（実績用）
  // プレイヤー状態
  let dodgeDir: DodgeDir | null = null;
  let dodgeUntil = 0;
  let counterUsed = false;
  let openUntil = 0;
  let openStart = 0;
  let stunUntil = 0;
  // 演出
  let punchAnimUntil = 0; // 相手のパンチが突き出る演出
  let punchType: AttackType = 'L';
  let playerPunchUntil = 0;
  let hitFlashUntil = 0;
  let bannerUntil = 0;
  let bannerText = '';
  let effects: FloatFx[] = [];
  let endAt = 0;
  let ended = false;
  let champion = false;
  let lastEvent = '';

  const cfg = () => ROUNDS[Math.min(roundIdx, ROUNDS.length - 1)]!;

  function addScore(n: number): void {
    score += n;
    if (score >= SCORE_HI) ctx.achieve('score-hi');
  }

  function enterRound(idx: number, now: number): void {
    roundIdx = idx;
    hp = cfg().hp;
    hearts = LIVES;
    roundDamage = 0;
    combo = 0;
    queuedFollow = null;
    pending = null;
    phase = 'round-in';
    phaseAt = now;
    bannerText = `ラウンド${idx + 1}  ${cfg().name}`;
    bannerUntil = now + ROUND_BANNER_MS;
    ctx.sfx('start');
  }

  function scheduleNext(now: number): void {
    const ev = queuedFollow ?? rollAttack(ctx.random, cfg());
    curIsFollow = queuedFollow !== null;
    queuedFollow = null;
    pending = ev;
    phase = 'gap';
    gapUntil = now + ev.gapMs;
  }

  function startTelegraph(now: number): void {
    const ev = pending!;
    curType = ev.type;
    curFeint = ev.feint;
    phase = 'tele';
    phaseAt = now;
    teleUntil = now + ev.telegraphMs;
    feintCancelAt = ev.feint ? now + ev.telegraphMs * FEINT_CANCEL_FRAC : Infinity;
    ctx.sfx('tick');
  }

  function resolveImpact(now: number): void {
    punchAnimUntil = now + 180;
    punchType = curType;
    const ok = dodgeDir === correctDodge(curType) && now <= dodgeUntil;
    if (ok) {
      dodges++;
      addScore(DODGE_PTS);
      if (dodges >= DODGE_ACH) ctx.achieve('dodge-15');
      if (curIsFollow) ctx.achieve('feint-dodge');
      effects.push({ x: OPP.x, y: 330, text: 'よけた！', color: '#8affc0', until: now + 600 });
      phase = 'open';
      openStart = now;
      openUntil = now + cfg().windowMs;
      counterUsed = false;
      ctx.sfx('success');
      ctx.haptic('light');
      lastEvent = 'dodge';
    } else {
      hearts--;
      roundDamage++;
      combo = 0;
      hitFlashUntil = now + 260;
      effects.push({ x: 180, y: 400, text: 'いたい！', color: '#ff8a8a', until: now + 700 });
      ctx.sfx('fail');
      ctx.haptic('error');
      lastEvent = 'hit';
      if (hearts <= 0) {
        phase = 'over';
        champion = false;
        bannerText = 'まけちゃった…';
        endAt = now + END_DELAY;
        return;
      }
      phase = 'stun';
      stunUntil = now + STUN_MS;
    }
  }

  function counterHit(now: number): void {
    counterUsed = true;
    counters++;
    combo++;
    hp--;
    const just = now <= openStart + cfg().windowMs * JUST_FRAC;
    if (just) justs++;
    const pts = COUNTER_PTS + (just ? JUST_BONUS : 0) + comboBonus(combo);
    addScore(pts);
    ctx.achieve('first-counter');
    playerPunchUntil = now + 160;
    effects.push({ x: OPP.x, y: 210, text: just ? `ジャスト！+${pts}` : `+${pts}`, color: just ? '#ffd54a' : '#fff', until: now + 800 });
    ctx.sfx(combo >= 5 ? 'combo' : 'tap');
    ctx.haptic('medium');
    lastEvent = just ? 'just' : 'counter';
    if (hp <= 0) {
      // ラウンドKO
      const bonus = KO_BONUS + hearts * HEART_BONUS;
      addScore(bonus);
      if (roundDamage === 0) ctx.achieve('no-damage');
      effects.push({ x: OPP.x, y: 260, text: `KO！ +${bonus}`, color: '#ffd54a', until: now + 1200 });
      phase = 'ko';
      phaseAt = now;
      bannerUntil = now + KO_BANNER_MS;
      bannerText = `${cfg().name}を たおした！`;
      ctx.sfx('medal');
      ctx.haptic('success');
      lastEvent = 'ko';
      return;
    }
    scheduleNext(now);
  }

  // ---- 入力 ----
  const offSwipe = ctx.input.onSwipe((dir) => {
    if (hostPaused || !started || phase === 'over' || phase === 'stun' || phase === 'ko' || phase === 'round-in') return;
    if (dir === 'up') return;
    const now = ctx.now();
    dodgeDir = dir;
    dodgeUntil = now + DODGE_ACTIVE_MS;
    ctx.haptic('light');
  });
  const offTap = ctx.input.onTap(() => {
    if (hostPaused || !started) return;
    const now = ctx.now();
    if (phase === 'open' && !counterUsed) {
      counterHit(now);
    } else if (phase === 'gap' || phase === 'tele') {
      // ガードされる（連打では点にならない）
      effects.push({ x: OPP.x, y: 330, text: 'ガードされた', color: 'rgba(255,255,255,.55)', until: now + 420 });
      playerPunchUntil = now + 120;
      ctx.sfx('tick');
      lastEvent = 'blocked';
    }
  });

  // ---- 毎フレーム ----
  const offFrame = ctx.onFrame(() => {
    if (hostPaused) return;
    const now = ctx.now();
    if (started) {
      if (phase === 'round-in' && now >= bannerUntil) {
        scheduleNext(now);
      } else if (phase === 'gap' && now >= gapUntil) {
        startTelegraph(now);
      } else if (phase === 'tele') {
        if (curFeint && now >= feintCancelAt) {
          // フェイント: 光が消える → 逆サイドから本命を予約
          queuedFollow = feintFollow(ctx.random, cfg(), curType);
          effects.push({ x: curType === 'L' ? 96 : curType === 'R' ? 264 : 180, y: 180, text: 'フェイント！', color: '#cdd6f5', until: now + 500 });
          lastEvent = 'feint';
          scheduleNext(now);
        } else if (!curFeint && now >= teleUntil) {
          resolveImpact(now);
        }
      } else if (phase === 'open' && now >= openUntil) {
        scheduleNext(now); // すきを逃した
      } else if (phase === 'stun' && now >= stunUntil) {
        scheduleNext(now);
      } else if (phase === 'ko' && now >= bannerUntil) {
        if (roundIdx + 1 < ROUNDS.length) {
          enterRound(roundIdx + 1, now);
        } else {
          champion = true;
          ctx.achieve('champion');
          phase = 'over';
          bannerText = 'チャンピオン！';
          endAt = now + END_DELAY;
          ctx.sfx('medal');
        }
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
    r.dataset.round = String(roundIdx + 1);
    r.dataset.hp = String(hp);
    r.dataset.hearts = String(hearts);
    r.dataset.score = String(score);
    r.dataset.dodges = String(dodges);
    r.dataset.counters = String(counters);
    r.dataset.justs = String(justs);
    r.dataset.combo = String(combo);
    r.dataset.tele = phase === 'tele' ? `${curType}:${curFeint ? 1 : 0}:${Math.max(0, teleUntil - now).toFixed(0)}` : '';
    r.dataset.openleft = phase === 'open' ? Math.max(0, openUntil - now).toFixed(0) : '';
    r.dataset.follow = curIsFollow ? '1' : '0';
    r.dataset.last = lastEvent;
  }

  // ---- 描画 ----
  function roundRect(x: number, y: number, w: number, h: number, rad: number): void {
    const rr = Math.min(rad, w / 2, h / 2);
    g.beginPath();
    g.moveTo(x + rr, y);
    g.arcTo(x + w, y, x + w, y + h, rr);
    g.arcTo(x + w, y + h, x, y + h, rr);
    g.arcTo(x, y + h, x, y, rr);
    g.arcTo(x, y, x + w, y, rr);
    g.closePath();
  }

  function draw(now: number): void {
    // よけ中のカメラずれ（プレイヤー視点）
    let camX = 0;
    let camY = 0;
    if (now <= dodgeUntil && dodgeDir) {
      const k = Math.sin(Math.min(1, (now - (dodgeUntil - DODGE_ACTIVE_MS)) / 120) * Math.PI * 0.5);
      if (dodgeDir === 'left') camX = -36 * k;
      else if (dodgeDir === 'right') camX = 36 * k;
      else camY = 30 * k;
    }

    // アリーナ
    g.fillStyle = '#181228';
    g.fillRect(0, 0, W, H);
    // 観客のあかり（うっすら）
    g.fillStyle = 'rgba(255,255,255,.05)';
    for (let i = 0; i < 40; i++) g.fillRect(((i * 89 + 13) % W) + (i % 2), (i * 53) % 140, 2, 2);

    g.save();
    g.translate(camX, camY);
    // リングロープ
    for (let i = 0; i < 3; i++) {
      g.strokeStyle = i === 1 ? '#d84a6a' : '#cdd6f5';
      g.lineWidth = 4;
      g.beginPath();
      g.moveTo(-40, 160 + i * 40);
      g.lineTo(W + 40, 160 + i * 40);
      g.stroke();
    }
    // マット
    g.fillStyle = '#2a3350';
    g.fillRect(-40, 300, W + 80, H - 300 + 40);
    g.fillStyle = 'rgba(255,255,255,.06)';
    g.fillRect(-40, 300, W + 80, 8);

    // ---- 相手 ----
    const c = cfg();
    const sway = phase === 'over' && !champion ? 0 : Math.sin(now / 460) * 6;
    const ox = OPP.x + sway;
    const dizzy = phase === 'open' || phase === 'ko';
    // からだ
    g.fillStyle = c.color;
    g.beginPath();
    g.ellipse(ox, OPP.y + 40, 74, 64, 0, 0, Math.PI * 2);
    g.fill();
    // あたま
    const headY = OPP.y - 44 + (dizzy ? 8 : 0);
    g.fillStyle = c.color;
    g.beginPath();
    g.arc(ox, headY, 40, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(255,255,255,.22)';
    g.beginPath();
    g.arc(ox - 12, headY - 12, 12, 0, Math.PI * 2);
    g.fill();
    // かお
    g.fillStyle = '#1b1430';
    if (dizzy) {
      g.font = 'bold 16px sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('×  ×', ox, headY - 6);
      g.beginPath();
      g.arc(ox, headY + 14, 7, 0, Math.PI * 2);
      g.fill();
      // ほし
      g.fillStyle = '#ffd54a';
      for (let k = 0; k < 3; k++) {
        const a = now / 300 + (k * Math.PI * 2) / 3;
        g.beginPath();
        g.arc(ox + Math.cos(a) * 52, headY - 34 + Math.sin(a) * 10, 4, 0, Math.PI * 2);
        g.fill();
      }
    } else {
      g.beginPath();
      g.arc(ox - 14, headY - 4, 4.5, 0, Math.PI * 2);
      g.arc(ox + 14, headY - 4, 4.5, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = '#1b1430';
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(ox - 10, headY + 14);
      g.lineTo(ox + 10, headY + 14);
      g.stroke();
    }

    // グローブ（L=画面ひだり / R=みぎ）
    for (const side of ['L', 'R'] as AttackType[]) {
      const isL = side === 'L';
      let gx = ox + (isL ? -86 : 86);
      let gy = OPP.y + 26;
      let gr = 26;
      const isTeleSide = phase === 'tele' && curType === side;
      const isTeleStraight = phase === 'tele' && curType === 'S';
      if (isTeleSide || isTeleStraight) {
        // 予備動作: ひきしぼる＋光る
        const p = Math.min(1, (now - phaseAt) / Math.max(1, teleUntil - phaseAt));
        gx += (isL ? -14 : 14) * p;
        gy -= (isTeleStraight ? 20 : 10) * p;
        gr = 26 + 5 * p;
        const glow = curFeint && now >= feintCancelAt ? 0 : 0.35 + 0.45 * Math.sin(now / 70);
        if (glow > 0) {
          g.fillStyle = `rgba(255,213,74,${glow})`;
          g.beginPath();
          g.arc(gx, gy, gr + 12, 0, Math.PI * 2);
          g.fill();
        }
      }
      // パンチ演出（着弾直後: 手前へ突き出す）
      if (now <= punchAnimUntil && (punchType === side || punchType === 'S')) {
        const p = 1 - (punchAnimUntil - now) / 180;
        gx = gx + (180 + camX - gx) * p * 0.8;
        gy = gy + (470 - gy) * p * 0.8;
        gr = 26 + 34 * p;
      }
      g.fillStyle = '#e0483c';
      g.beginPath();
      g.arc(gx, gy, gr, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = 'rgba(255,255,255,.3)';
      g.beginPath();
      g.arc(gx - gr * 0.3, gy - gr * 0.3, gr * 0.32, 0, Math.PI * 2);
      g.fill();
    }

    // 予備動作の「！」（ストレートは頭の上）
    if (phase === 'tele' && !(curFeint && now >= feintCancelAt)) {
      const bx = curType === 'L' ? ox - 100 : curType === 'R' ? ox + 100 : ox;
      const by = curType === 'S' ? headY - 66 : OPP.y - 20;
      g.fillStyle = '#ffd54a';
      g.font = 'bold 26px sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('！', bx, by);
    }

    g.restore();

    // ---- プレイヤーのグローブ（POV・画面下） ----
    const punchUp = now <= playerPunchUntil ? (1 - (playerPunchUntil - now) / 160) * 120 : 0;
    for (const side of [-1, 1]) {
      const px = 180 + side * 92 + camX * 0.5;
      const py = 596 + camY * 0.5 - (side === 1 ? punchUp : 0);
      g.fillStyle = '#3d7df0';
      g.beginPath();
      g.arc(px, py, 44, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = 'rgba(255,255,255,.25)';
      g.beginPath();
      g.arc(px - 12, py - 14, 13, 0, Math.PI * 2);
      g.fill();
    }

    // 被弾フラッシュ
    if (now <= hitFlashUntil) {
      g.fillStyle = `rgba(216,74,74,${0.4 * ((hitFlashUntil - now) / 260)})`;
      g.fillRect(0, 0, W, H);
    }

    // うかぶ文字
    for (const e of effects) {
      const a = Math.max(0, Math.min(1, (e.until - now) / 700));
      g.globalAlpha = a;
      g.fillStyle = e.color;
      g.font = 'bold 17px sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(e.text, e.x, e.y - (1 - a) * 20);
      g.globalAlpha = 1;
    }

    // HUD
    if (phase !== 'over') {
      g.fillStyle = 'rgba(10,8,22,.9)';
      g.fillRect(0, 0, W, HUD_H);
      g.textBaseline = 'middle';
      g.textAlign = 'left';
      g.fillStyle = '#fff';
      g.font = 'bold 18px sans-serif';
      g.fillText(`${score}てん`, 12, HUD_H / 2);
      let heartsTxt = '';
      for (let i = 0; i < LIVES; i++) heartsTxt += i < hearts ? '❤️' : '🤍';
      g.font = 'bold 14px sans-serif';
      g.fillText(heartsTxt, 112, HUD_H / 2);
      g.fillStyle = '#cdd6f5';
      g.fillText(`R${roundIdx + 1}`, 196, HUD_H / 2);
      // 相手HPバー
      g.fillStyle = 'rgba(255,255,255,.18)';
      roundRect(224, HUD_H / 2 - 6, 70, 12, 6);
      g.fill();
      g.fillStyle = cfg().color;
      roundRect(224, HUD_H / 2 - 6, 70 * Math.max(0, hp / cfg().hp), 12, 6);
      g.fill();
      // 操作ガイド（ラウンド1の序盤だけ）
      if (roundIdx === 0 && counters === 0 && phase !== 'round-in') {
        g.fillStyle = 'rgba(205,214,245,.85)';
        g.font = 'bold 13px sans-serif';
        g.textAlign = 'center';
        g.fillText('スワイプでよける → すきに タップ！', 180, 476);
      }
    }

    // バナー
    if ((phase === 'round-in' || phase === 'ko') && now < bannerUntil) {
      g.fillStyle = 'rgba(10,8,22,.72)';
      roundRect(40, 250, W - 80, 78, 14);
      g.fill();
      g.fillStyle = '#fff';
      g.font = 'bold 21px sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(bannerText, W / 2, 289);
    }

    if (phase === 'over') {
      g.fillStyle = 'rgba(10,8,22,.8)';
      g.fillRect(0, 0, W, H);
      g.textAlign = 'center';
      g.fillStyle = champion ? '#ffd54a' : '#fff';
      g.font = 'bold 30px sans-serif';
      g.fillText(bannerText, W / 2, H / 2 - 52);
      g.fillStyle = '#fff';
      g.font = 'bold 26px sans-serif';
      g.fillText(`${score}てん`, W / 2, H / 2 - 8);
      g.fillStyle = '#cdd6f5';
      g.font = 'bold 15px sans-serif';
      g.fillText(`カウンター${counters}発（ジャスト${justs}）　よけ${dodges}回`, W / 2, H / 2 + 28);
    }
  }

  draw(ctx.now());
  setData(ctx.now());

  return {
    start() {
      started = true;
      enterRound(0, ctx.now());
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
      offSwipe();
      offTap();
      offFrame();
    },
  };
}
