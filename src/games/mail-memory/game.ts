// =============================================================
// ゆうびんやさんの おとどけ（No.68）: だれが どのおうちか おぼえて、手紙をとどけよう！
// =============================================================
// - 見るフェーズ: どうぶつが 1匹ずつ 自分のおうちへ入るのを見て覚える。
//   配達フェーズ: とどいた手紙（顔つき封筒）の あて先のおうちをタップ。
//   まちがい3回で おしまい。全5ラウンド（3→6組）。
// - ラウンド生成は logic.ts（純ロジック・rng注入＝日替わり同一）。
// - 全画面 Canvas・onTap のみ。時間は ctx.now 期限方式・setTimeout 不使用。
// - import してよいのは game-api（types / helpers）と、このフォルダ内（logic）だけ
import type { GameContext, IGame } from '../../game-api/types';
import {
  ANIMALS,
  DELIVER_PTS,
  HOUSE_SLOTS,
  LIVES,
  PERFECT_BONUS,
  ROUND_BONUS,
  ROUND_PAIRS,
  type Round,
  makeRound,
} from './logic';

const W = 360;
const H = 640;
const HUD_H = 44;
const WALK_MS = 850;
const ENTER_MS = 320;
const INTRO_MS = 1100;
const QUIZ_START_MS = 900;
const REVEAL_MS = 1300;
const CLEAR_MS = 1500;
const END_DELAY = 1800;
const SCORE_HI = 900;
const SPAWN = { x: 180, y: 448 }; // どうぶつの入場位置（村の入り口）

type Mode = 'watch' | 'quiz' | 'reveal' | 'clear' | 'over';

export function createGame(ctx: GameContext): IGame {
  const cv = ctx.canvas2d({ design: { w: W, h: H } });
  const g = cv.ctx;

  let mode: Mode = 'watch';
  let hostPaused = false;
  let roundIdx = 0;
  let round: Round = { houses: [], animals: [], letterOrder: [] };
  let watchK = 0; // いま歩いているどうぶつ（見せる順）
  let watchT0 = 0; // その歩きはじめ時刻
  let introUntil = 0;
  let quizAt = 0;
  let letterIdx = 0;
  let lives = LIVES;
  let score = 0;
  let missesTotal = 0;
  let missesRound = 0;
  let revealUntil = 0;
  let revealHouse = -1; // リビールで教えるおうち（HOUSE_SLOTS index）
  let heartAt = -1; // 直近の正解おうち（ハート演出）
  let heartUntil = 0;
  let nextAt = 0;
  let endAt = 0;
  let ended = false;
  let overText = '';

  function initRound(idx: number, now: number): void {
    roundIdx = idx;
    if (idx >= 2) ctx.achieve('round-3');
    round = makeRound(idx, ctx.random);
    watchK = -1; // イントロのあと 0 から歩く
    missesRound = 0;
    letterIdx = 0;
    mode = 'watch';
    introUntil = now + INTRO_MS;
    watchT0 = introUntil;
    revealHouse = -1;
    heartAt = -1;
  }

  function addScore(n: number): void {
    score += n;
    if (score >= SCORE_HI) ctx.achieve('score-hi');
  }

  const pairs = (): number => round.houses.length;
  /** いまの手紙のあて先（見せ順k）と正しいおうち（HOUSE_SLOTS index） */
  const currentK = (): number => round.letterOrder[letterIdx] ?? 0;
  const correctHouse = (): number => round.houses[currentK()] ?? -1;

  function deliverOk(now: number): void {
    addScore(DELIVER_PTS);
    ctx.achieve('first-deliver');
    ctx.sfx('success');
    ctx.haptic('light');
    heartAt = correctHouse();
    heartUntil = now + 700;
    nextLetter(now);
  }

  function deliverMiss(now: number): void {
    lives--;
    missesTotal++;
    missesRound++;
    ctx.sfx('fail');
    ctx.haptic('error');
    if (lives <= 0) {
      // リビールを見せてから おしまい
      revealHouse = correctHouse();
      mode = 'over';
      overText = 'おてがみが なくなっちゃった…';
      endAt = now + REVEAL_MS + END_DELAY;
      return;
    }
    revealHouse = correctHouse();
    mode = 'reveal';
    revealUntil = now + REVEAL_MS;
  }

  function nextLetter(now: number): void {
    letterIdx++;
    if (letterIdx < pairs()) return;
    // ラウンドクリア
    addScore(ROUND_BONUS);
    if (missesRound === 0) {
      addScore(PERFECT_BONUS);
      ctx.achieve('perfect-round');
    }
    ctx.haptic('success');
    if (roundIdx >= ROUND_PAIRS.length - 1) {
      if (missesTotal === 0) ctx.achieve('no-miss-all');
      ctx.achieve('all-clear');
      mode = 'over';
      overText = 'ぜんぶ おとどけできた！';
      endAt = now + 2000;
      ctx.sfx('medal');
    } else {
      mode = 'clear';
      nextAt = now + CLEAR_MS;
      ctx.sfx('combo');
    }
  }

  // ---- 入力（配達＝おうちをタップ）----
  const offTap = ctx.input.onTap((p) => {
    if (hostPaused || mode !== 'quiz') return;
    const l = cv.toLocal(p);
    const now = ctx.now();
    let hit = -1;
    for (const hi of round.houses) {
      const s = HOUSE_SLOTS[hi]!;
      if (Math.abs(l.x - s.x) <= 46 && l.y >= s.y - 78 && l.y <= s.y + 12) hit = hi;
    }
    if (hit < 0) return;
    if (hit === correctHouse()) deliverOk(now);
    else deliverMiss(now);
  });

  // ---- 毎フレーム ----
  const offFrame = ctx.onFrame(() => {
    if (hostPaused) return;
    const now = ctx.now();
    if (mode === 'watch') {
      if (watchK < 0) {
        if (now >= introUntil) {
          watchK = 0;
          watchT0 = now;
        }
      } else if (now >= watchT0 + WALK_MS + ENTER_MS) {
        watchK++;
        watchT0 = now;
        if (watchK >= pairs()) {
          mode = 'quiz';
          quizAt = now + QUIZ_START_MS;
          ctx.sfx('start');
        } else {
          ctx.sfx('tick');
        }
      }
    } else if (mode === 'reveal') {
      if (now >= revealUntil) {
        revealHouse = -1;
        mode = 'quiz';
        nextLetter(now);
      }
    } else if (mode === 'clear') {
      if (now >= nextAt) initRound(roundIdx + 1, now);
    } else if (mode === 'over') {
      if (!ended && now >= endAt) {
        ended = true;
        ctx.end({ score });
        return;
      }
    }
    draw(now);
    setData();
  });

  function setData(): void {
    if (!import.meta.env.DEV) return;
    const r = ctx.root as HTMLElement;
    r.dataset.mode = mode;
    r.dataset.round = String(roundIdx);
    r.dataset.score = String(score);
    r.dataset.lives = String(lives);
    r.dataset.li = String(letterIdx);
    r.dataset.pairs = String(pairs());
    r.dataset.houses = round.houses.join(',');
    r.dataset.animals = round.animals.join(',');
    r.dataset.order = round.letterOrder.join(',');
    r.dataset.target = mode === 'quiz' ? String(correctHouse()) : '';
    r.dataset.misses = String(missesTotal);
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

  function drawHouse(hi: number, doorOpen: boolean, peekAnimal: string | null, now: number): void {
    const s = HOUSE_SLOTS[hi]!;
    const w = 84;
    const h = 58;
    const x = s.x - w / 2;
    const y = s.y - h;
    // かべ
    g.fillStyle = s.color;
    roundRect(x, y, w, h, 6);
    g.fill();
    // やね（形がちがう＝おぼえる手がかり）
    g.fillStyle = '#7a5a3a';
    if (s.roof === 'tri') {
      g.beginPath();
      g.moveTo(x - 8, y);
      g.lineTo(s.x, y - 34);
      g.lineTo(x + w + 8, y);
      g.closePath();
      g.fill();
    } else if (s.roof === 'round') {
      g.beginPath();
      g.arc(s.x, y, w / 2 + 6, Math.PI, 0);
      g.fill();
    } else {
      g.fillRect(x - 7, y - 16, w + 14, 16);
    }
    // ドア
    const doorW = 26;
    const doorH = 34;
    const dx = s.x - doorW / 2;
    const dy = s.y - doorH;
    g.fillStyle = doorOpen ? '#fff3d8' : '#4a3524';
    roundRect(dx, dy, doorW, doorH, 5);
    g.fill();
    if (peekAnimal) {
      g.font = '22px sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(peekAnimal, s.x, dy + doorH / 2 - 2);
    }
    // ポスト
    g.fillStyle = '#e05a5a';
    roundRect(s.x + w / 2 - 8, s.y - 22, 12, 22, 3);
    g.fill();
    // リビール強調
    if (revealHouse === hi) {
      g.strokeStyle = `rgba(255,213,74,${0.6 + 0.4 * Math.sin(now / 110)})`;
      g.lineWidth = 5;
      roundRect(x - 10, y - 40, w + 20, h + 50, 12);
      g.stroke();
    }
    // 正解ハート
    if (heartAt === hi && now < heartUntil) {
      g.font = '24px sans-serif';
      g.textAlign = 'center';
      g.fillText('💖', s.x, y - 44);
    }
  }

  function draw(now: number): void {
    // そら・むら
    const sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#aee2f7');
    sky.addColorStop(0.55, '#d8f2dc');
    sky.addColorStop(1, '#bfe3b4');
    g.fillStyle = sky;
    g.fillRect(0, 0, W, H);
    // みち
    g.fillStyle = '#e8d8b0';
    g.beginPath();
    g.moveTo(150, H);
    g.quadraticCurveTo(170, 380, 60, 240);
    g.lineTo(300, 240);
    g.quadraticCurveTo(200, 380, 210, H);
    g.closePath();
    g.fill();

    // おうち
    for (const hi of round.houses) {
      let peek: string | null = null;
      let open = false;
      const k = round.houses.indexOf(hi);
      if (mode === 'watch' && watchK === k && now >= watchT0 + WALK_MS) {
        open = true;
        peek = ANIMALS[round.animals[k] ?? 0] ?? null;
      }
      if ((mode === 'reveal' || mode === 'over') && revealHouse === hi) {
        open = true;
        peek = ANIMALS[round.animals[currentK()] ?? 0] ?? null;
      }
      drawHouse(hi, open, peek, now);
    }

    // 見るフェーズ: あるくどうぶつ
    if (mode === 'watch' && watchK >= 0 && watchK < pairs()) {
      const t = Math.min(1, (now - watchT0) / WALK_MS);
      const s = HOUSE_SLOTS[round.houses[watchK] ?? 0]!;
      const x = SPAWN.x + (s.x - SPAWN.x) * t;
      const y = SPAWN.y + (s.y - 14 - SPAWN.y) * t - Math.abs(Math.sin(t * Math.PI * 5)) * 7;
      g.font = '30px sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      if (now < watchT0 + WALK_MS) g.fillText(ANIMALS[round.animals[watchK] ?? 0] ?? '', x, y);
    }

    // HUD
    g.fillStyle = 'rgba(20,40,60,.85)';
    g.fillRect(0, 0, W, HUD_H);
    g.textBaseline = 'middle';
    g.textAlign = 'left';
    g.fillStyle = '#fff';
    g.font = 'bold 19px sans-serif';
    g.fillText(`${score}てん`, 12, HUD_H / 2);
    g.font = 'bold 15px sans-serif';
    let hearts = '';
    for (let i = 0; i < LIVES; i++) hearts += i < lives ? '❤️' : '🤍';
    g.fillText(hearts, 116, HUD_H / 2);
    g.fillStyle = '#cfe8ff';
    g.fillText(`ラウンド${roundIdx + 1}/${ROUND_PAIRS.length}`, 208, HUD_H / 2);

    // 下部パネル（封筒・メッセージ）。勝利側の over は中身がないので描かない
    if (mode !== 'over' || revealHouse >= 0) {
      g.fillStyle = 'rgba(255,255,255,.88)';
      roundRect(20, 470, W - 40, 120, 16);
      g.fill();
    }
    g.textAlign = 'center';
    if (mode === 'watch') {
      g.fillStyle = '#2c3d57';
      g.font = 'bold 18px sans-serif';
      g.fillText(watchK < 0 ? 'だれが どのおうちに 入るか' : 'よく見て おぼえよう…', W / 2, 508);
      g.font = 'bold 15px sans-serif';
      g.fillText(watchK < 0 ? 'よーく 見ててね！' : `${Math.max(0, pairs() - Math.max(watchK, 0))}匹め`, W / 2, 540);
    } else if (mode === 'quiz' || mode === 'reveal' || (mode === 'over' && revealHouse >= 0)) {
      // 封筒
      const emoji = ANIMALS[round.animals[currentK()] ?? 0] ?? '';
      g.fillStyle = '#fdf3dc';
      roundRect(48, 486, 88, 62, 8);
      g.fill();
      g.strokeStyle = '#d8b878';
      g.lineWidth = 2;
      roundRect(48, 486, 88, 62, 8);
      g.stroke();
      g.beginPath();
      g.moveTo(48, 488);
      g.lineTo(92, 520);
      g.lineTo(136, 488);
      g.stroke();
      g.font = '30px sans-serif';
      g.textBaseline = 'middle';
      g.fillText(emoji, 92, 522);
      g.fillStyle = '#2c3d57';
      g.textAlign = 'left';
      g.font = 'bold 17px sans-serif';
      g.fillText(`${emoji}さんへ の おてがみ`, 150, 505);
      g.font = 'bold 15px sans-serif';
      g.fillStyle = mode === 'reveal' ? '#e05a5a' : '#4a6a8a';
      g.fillText(mode === 'reveal' ? 'ここだったよ…！' : 'おうちを タップ！', 150, 536);
      g.textAlign = 'center';
      g.fillStyle = '#8a9ab0';
      g.font = 'bold 13px sans-serif';
      g.fillText(`のこり ${pairs() - letterIdx}通`, W / 2, 572);
    }

    // バナー
    let banner = '';
    if (mode === 'watch' && now < introUntil) banner = `ラウンド${roundIdx + 1}`;
    else if (mode === 'quiz' && now < quizAt) banner = 'はいたつ かいし！';
    else if (mode === 'clear') banner = 'ラウンドクリア！';
    else if (mode === 'over') banner = overText;
    if (banner) {
      g.fillStyle = 'rgba(20,35,60,.72)';
      roundRect(46, 240, W - 92, 74, 14);
      g.fill();
      g.fillStyle = '#fff';
      g.font = 'bold 24px sans-serif';
      g.textAlign = 'center';
      g.fillText(banner, W / 2, 278);
    }
  }

  draw(0);
  setData();

  return {
    start() {
      initRound(0, ctx.now());
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
