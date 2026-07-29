// =============================================================
// はしから とる（No.124・かくれゲーム）: 完全に読みきる CPU との 対戦
// =============================================================
// - かくれゲーム 唯一の 対戦もの。CPU は ミニマックスで 完全に 読みきる（手加減なし）。
//   そのかわり 出題は「先手＝プレイヤーが 最善なら かならず 勝てる」盤だけ。
//   ＝理不尽さは ゼロ。ただし 1手 まちがえると ひっくり返る。
// - 独自ルール: 相手が 直前に とった数字と 同じ数字は とれない。
// - import してよいのは game-api（types / helpers）と、このフォルダ内（logic）だけ。
import type { GameContext, IGame, PointerInfo } from '../../game-api/types';
import {
  ALL_WIN_BONUS,
  MATCHES,
  type Match,
  type Move,
  type State,
  bestMove,
  canTake,
  makeMatches,
  matchPoints,
} from './logic';

const W = 360;
const H = 640;
const HUD_H = 46;

const ROW_Y = 158;
const ROW_X = 20;
const ROW_W = 320;
const CARD_H = 116;
const CARD_Y = 262;
const CARD_W = 148;
const L_CARD = { x: 22, y: CARD_Y, w: CARD_W, h: CARD_H };
const R_CARD = { x: 190, y: CARD_Y, w: CARD_W, h: CARD_H };

const CPU_MS = 800;
const RESULT_MS = 2200;
const END_DELAY = 2600;
const SCORE_HI = 800;

const C_BG = '#1d1a14';
const C_PANEL = '#2c281e';
const C_TEXT = '#f6f0e2';
const C_DIM = '#b4a98c';
const C_ME = '#4ac9a0';
const C_CPU = '#e08a5a';
const C_OK = '#5ad08a';
const C_NG = '#e0483c';
const C_ACC = '#ffd54a';

type Mode = 'me' | 'cpu' | 'result' | 'done';

export function createGame(ctx: GameContext): IGame {
  const cv = ctx.canvas2d({ design: { w: W, h: H } });
  const g = cv.ctx;

  const matches: Match[] = makeMatches(ctx.random);
  let matchIdx = 0;
  let match: Match = matches[0]!;
  let st: State = { i: 0, j: match.nums.length - 1, banned: 0 };
  let myTotal = 0;
  let cpuTotal = 0;
  let mode: Mode = 'me';
  let started = false;
  let hostPaused = false;
  let ended = false;
  let score = 0;
  let wins = 0;
  let loses = 0;
  let bigWins = 0;
  let cpuUntil = 0;
  let phaseUntil = 0;
  let noteUntil = 0;
  let note = '';
  let lastEvent = '';

  function loadMatch(i: number): void {
    matchIdx = i;
    match = matches[i]!;
    st = { i: 0, j: match.nums.length - 1, banned: 0 };
    myTotal = 0;
    cpuTotal = 0;
    mode = 'me';
    lastEvent = `match:${i}:value${match.value}`;
  }

  const inRect = (p: { x: number; y: number }, r: { x: number; y: number; w: number; h: number }): boolean =>
    p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;

  function finishMatch(now: number): void {
    const pts = matchPoints(myTotal, cpuTotal);
    score += pts;
    if (myTotal > cpuTotal) {
      wins++;
      if (wins === 1) ctx.achieve('first-win');
      if (wins >= 2) ctx.achieve('half');
      if (myTotal - cpuTotal >= 4) {
        bigWins++;
        ctx.achieve('big-margin');
      }
    } else if (myTotal < cpuTotal) {
      loses++;
    }
    mode = 'result';
    phaseUntil = now + RESULT_MS;
    ctx.sfx(myTotal > cpuTotal ? 'medal' : 'fail');
    ctx.haptic(myTotal > cpuTotal ? 'success' : 'error');
    lastEvent = `end:${matchIdx}:${myTotal}-${cpuTotal}:${pts}`;
  }

  /** 手番の 人が 1手 とる */
  function take(side: 'L' | 'R', mine: boolean, now: number): void {
    const v = side === 'L' ? match.nums[st.i]! : match.nums[st.j]!;
    if (side === 'L') st.i++;
    else st.j--;
    st.banned = v;
    if (mine) myTotal += v;
    else cpuTotal += v;
    ctx.sfx('tap');
    lastEvent = `${mine ? 'me' : 'cpu'}:${side}:${v}`;
    if (st.i > st.j) {
      finishMatch(now);
      return;
    }
    mode = mine ? 'cpu' : 'me';
    if (mode === 'cpu') cpuUntil = now + CPU_MS;
  }

  /** とれないときの パス */
  function pass(mine: boolean, now: number): void {
    st.banned = 0;
    note = mine ? 'とれる はしが ない…パス！' : 'あいては パスした！';
    noteUntil = now + 1200;
    ctx.sfx('fail');
    lastEvent = `${mine ? 'me' : 'cpu'}:pass`;
    mode = mine ? 'cpu' : 'me';
    if (mode === 'cpu') cpuUntil = now + CPU_MS;
  }

  // ---------- 入力 ----------
  const offTap = ctx.input.onTap((p: PointerInfo) => {
    if (hostPaused || !started || mode !== 'me') return;
    const l = cv.toLocal(p);
    const now = ctx.now();
    const leftV = match.nums[st.i]!;
    const rightV = match.nums[st.j]!;
    if (inRect(l, L_CARD)) {
      if (leftV === st.banned) {
        note = `${leftV} は とれない（あいてが とった数）`;
        noteUntil = now + 1200;
        ctx.sfx('fail');
        return;
      }
      take('L', true, now);
    } else if (inRect(l, R_CARD)) {
      if (st.i === st.j) {
        // のこり1つは 左の カードだけ
        note = 'のこりは ひとつだけ。ひだりを えらんで';
        noteUntil = now + 1200;
        ctx.sfx('fail');
        return;
      }
      if (rightV === st.banned) {
        note = `${rightV} は とれない（あいてが とった数）`;
        noteUntil = now + 1200;
        ctx.sfx('fail');
        return;
      }
      take('R', true, now);
    }
  });

  // ---------- 毎フレーム ----------
  const offFrame = ctx.onFrame(() => {
    if (hostPaused || !started) return;
    const now = ctx.now();
    if (mode === 'me' && !canTake(match.nums, st)) {
      pass(true, now);
    } else if (mode === 'cpu' && now >= cpuUntil) {
      if (!canTake(match.nums, st)) {
        pass(false, now);
      } else {
        const mv: Move = bestMove(match.nums, st);
        take(mv === 'R' ? 'R' : 'L', false, now);
      }
    } else if (mode === 'result' && now >= phaseUntil) {
      if (matchIdx + 1 >= MATCHES) finish(now);
      else loadMatch(matchIdx + 1);
    } else if (mode === 'done' && !ended && now >= phaseUntil) {
      ended = true;
      ctx.end({ score });
      return;
    }
    draw(now);
    setData();
  });

  function finish(now: number): void {
    if (wins >= MATCHES) {
      score += ALL_WIN_BONUS;
      ctx.achieve('all-win');
    }
    if (loses === 0) ctx.achieve('no-lose');
    if (score >= SCORE_HI) ctx.achieve('score-hi');
    mode = 'done';
    phaseUntil = now + END_DELAY;
    ctx.sfx('medal');
    lastEvent = `finish:${score}:${wins}`;
  }

  function setData(): void {
    if (!import.meta.env.DEV) return;
    const r = ctx.root as HTMLElement;
    r.dataset.mode = mode;
    r.dataset.match = String(matchIdx);
    r.dataset.nums = match.nums.join(',');
    r.dataset.value = String(match.value);
    r.dataset.i = String(st.i);
    r.dataset.j = String(st.j);
    r.dataset.banned = String(st.banned);
    r.dataset.mine = String(myTotal);
    r.dataset.cpu = String(cpuTotal);
    r.dataset.score = String(score);
    r.dataset.wins = String(wins);
    r.dataset.loses = String(loses);
    r.dataset.big = String(bigWins);
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

  function drawCard(r: { x: number; y: number; w: number; h: number }, label: string, v: number, ok: boolean): void {
    g.fillStyle = ok ? C_PANEL : 'rgba(44,40,30,.45)';
    roundRect(r.x, r.y, r.w, r.h, 16);
    g.fill();
    g.strokeStyle = ok ? C_ACC : 'rgba(180,169,140,.3)';
    g.lineWidth = ok ? 3 : 1.6;
    roundRect(r.x, r.y, r.w, r.h, 16);
    g.stroke();
    g.textAlign = 'center';
    g.fillStyle = C_DIM;
    g.font = 'bold 13px sans-serif';
    g.fillText(label, r.x + r.w / 2, r.y + 24);
    g.fillStyle = ok ? C_TEXT : 'rgba(246,240,226,.35)';
    g.font = 'bold 52px sans-serif';
    g.fillText(String(v), r.x + r.w / 2, r.y + r.h / 2 + 14);
    if (!ok) {
      g.fillStyle = C_NG;
      g.font = 'bold 12px sans-serif';
      g.fillText('とれない', r.x + r.w / 2, r.y + r.h - 14);
    }
  }

  function draw(now: number): void {
    cv.clear(C_BG);

    // HUD
    g.fillStyle = '#141209';
    g.fillRect(0, 0, W, HUD_H);
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.fillStyle = C_TEXT;
    g.font = 'bold 18px sans-serif';
    g.fillText(`${score}てん`, 12, HUD_H / 2);
    g.fillStyle = C_DIM;
    g.font = 'bold 13px sans-serif';
    g.fillText(`しあい ${Math.min(matchIdx + 1, MATCHES)}/${MATCHES}`, 116, HUD_H / 2 - 8);
    g.fillText(`かち ${wins}・まけ ${loses}`, 116, HUD_H / 2 + 9);

    g.textAlign = 'center';

    if (mode === 'done') {
      g.fillStyle = C_TEXT;
      g.font = 'bold 26px sans-serif';
      g.fillText(`${wins} / ${MATCHES} しょう！`, W / 2, 280);
      g.font = 'bold 34px sans-serif';
      g.fillStyle = C_ME;
      g.fillText(`${score}てん`, W / 2, 336);
      g.fillStyle = C_DIM;
      g.font = 'bold 14px sans-serif';
      g.fillText(`大差の かち ${bigWins}かい・まけ ${loses}かい`, W / 2, 380);
      return;
    }

    // といかけ
    g.fillStyle = C_DIM;
    g.font = 'bold 13px sans-serif';
    g.fillText('両はしの どちらかを とる。合計が 多いほうが かち', W / 2, 70);
    g.fillStyle = st.banned > 0 ? C_NG : C_DIM;
    g.font = 'bold 14px sans-serif';
    g.fillText(st.banned > 0 ? `いまは 「${st.banned}」 が とれない` : 'いまは どちらでも とれる', W / 2, 96);

    // のこりの ならび
    const n = match.nums.length;
    const cw = ROW_W / n;
    for (let k = 0; k < n; k++) {
      const x = ROW_X + k * cw;
      const gone = k < st.i || k > st.j;
      g.fillStyle = gone ? 'rgba(255,255,255,.04)' : C_PANEL;
      roundRect(x + 1.5, ROW_Y, cw - 3, 40, 6);
      g.fill();
      if (!gone && (k === st.i || k === st.j)) {
        g.strokeStyle = C_ACC;
        g.lineWidth = 2;
        roundRect(x + 1.5, ROW_Y, cw - 3, 40, 6);
        g.stroke();
      }
      g.fillStyle = gone ? 'rgba(246,240,226,.22)' : C_TEXT;
      g.font = 'bold 17px sans-serif';
      g.fillText(String(match.nums[k]), x + cw / 2, ROW_Y + 21);
    }
    g.fillStyle = C_DIM;
    g.font = 'bold 11px sans-serif';
    g.fillText(`のこり ${st.j - st.i + 1}まい`, W / 2, ROW_Y + 56);

    // 両はしの カード
    const leftV = match.nums[st.i] ?? 0;
    const rightV = match.nums[st.j] ?? 0;
    const single = st.i === st.j;
    drawCard(L_CARD, 'ひだり', leftV, mode === 'me' && leftV !== st.banned);
    drawCard(R_CARD, single ? '（のこり1まい）' : 'みぎ', rightV, mode === 'me' && !single && rightV !== st.banned);

    // 合計
    g.textAlign = 'left';
    g.fillStyle = C_ME;
    g.font = 'bold 20px sans-serif';
    g.fillText(`きみ ${myTotal}`, 34, 424);
    g.textAlign = 'right';
    g.fillStyle = C_CPU;
    g.fillText(`あいて ${cpuTotal}`, W - 34, 424);
    g.textAlign = 'center';

    // ようす
    g.font = 'bold 16px sans-serif';
    if (mode === 'result') {
      g.fillStyle = myTotal > cpuTotal ? C_OK : myTotal === cpuTotal ? C_ACC : C_NG;
      g.fillText(
        myTotal > cpuTotal ? `${myTotal} - ${cpuTotal} で かち！` : myTotal === cpuTotal ? 'ひきわけ' : `${myTotal} - ${cpuTotal} で まけ…`,
        W / 2,
        470,
      );
    } else if (now < noteUntil) {
      g.fillStyle = C_NG;
      g.font = 'bold 14px sans-serif';
      g.fillText(note, W / 2, 470);
    } else if (mode === 'cpu') {
      g.fillStyle = C_CPU;
      g.fillText('あいての ばん…', W / 2, 470);
    } else {
      g.fillStyle = C_ME;
      g.fillText('きみの ばん！ どちらを とる？', W / 2, 470);
    }

    g.fillStyle = C_DIM;
    g.font = 'bold 12px sans-serif';
    g.fillText('あいては 手を すべて 読みきってくる（手加減なし）', W / 2, 540);
    g.font = 'bold 11px sans-serif';
    g.fillText('でも 最善を つくせば かならず 勝てる ならびに なっている', W / 2, 566);
    g.fillText('相手が とった数字と 同じ数字は とれない', W / 2, 590);
  }

  draw(0);
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
      draw(ctx.now());
    },
    destroy() {
      offTap();
      offFrame();
    },
  };
}
