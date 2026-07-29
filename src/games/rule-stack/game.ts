// =============================================================
// ルールが ふえる（No.125・かくれゲーム）: ルールが 積み重なっていく
// =============================================================
// - ねらい: #26 いろよみチャレンジは ルールが 1つ。こちらは ラウンドごとに
//   ルールが 1つ ふえ、さいごは 5つ 同時に さばく。
// - ルールは いつも 画面に 出している＝覚えゲーではなく「処理の速さ」の遊び。
// - 何回 タップすべきかは logic.needTaps（純関数）で 決まる＝判定が ぶれない。
// - import してよいのは game-api（types / helpers）と、このフォルダ内（logic）だけ。
import type { GameContext, IGame } from '../../game-api/types';
import {
  COLOR_NAMES,
  HIT_PTS,
  ITEM_MS,
  type Item,
  PER_ROUND,
  ROUNDS,
  ROUND_BONUS,
  RULES,
  makeRounds,
  needTaps,
  ruleCount,
} from './logic';

const W = 360;
const H = 640;
const HUD_H = 46;

const RULE_Y = 62;
const RULE_H = 19;
const CARD_CX = 180;
const CARD_CY = 300;
const CARD_R = 86;
/** ここより 下を タップすると「品への タップ」 */
const TAP_Y = 176;

const INTRO_MS = 2600;
const END_DELAY = 2600;
const SCORE_HI = 950;

const C_BG = '#1a1526';
const C_TEXT = '#f0ecff';
const C_DIM = '#9d92bd';
const C_OK = '#5ad08a';
const C_NG = '#e0483c';
const C_ACC = '#ffd54a';
const ITEM_COLORS = ['#ff6b6b', '#4aa3ff', '#ffd54a', '#5ad08a'];

type Mode = 'intro' | 'stream' | 'result' | 'done';

export function createGame(ctx: GameContext): IGame {
  const cv = ctx.canvas2d({ design: { w: W, h: H } });
  const g = cv.ctx;

  const rounds: Item[][] = makeRounds(ctx.random);
  let roundIdx = 0;
  let items: Item[] = rounds[0]!;
  let idx = 0;
  let taps = 0;
  let mode: Mode = 'intro';
  let started = false;
  let hostPaused = false;
  let ended = false;
  let score = 0;
  let hits = 0;
  let misses = 0;
  let roundMiss = 0;
  let cleanRounds = 0;
  let itemUntil = 0;
  let phaseUntil = 0;
  /** 直前の 判定: 0=なし 1=あたり 2=はずれ */
  let mark = 0;
  let markUntil = 0;
  let lastEvent = '';

  const rules = (): number => ruleCount(roundIdx);
  const itemMs = (): number => ITEM_MS[Math.min(roundIdx, ITEM_MS.length - 1)]!;

  function loadRound(i: number, now: number): void {
    roundIdx = i;
    items = rounds[i]!;
    idx = 0;
    taps = 0;
    roundMiss = 0;
    mode = 'intro';
    phaseUntil = now + INTRO_MS;
    lastEvent = `round:${i}:rules${ruleCount(i)}`;
  }

  function judgeItem(now: number): void {
    const it = items[idx];
    if (!it) return;
    const need = needTaps(it, rules());
    if (taps === need) {
      score += HIT_PTS;
      hits++;
      mark = 1;
      ctx.sfx('success');
      if (hits === 1) ctx.achieve('first-right');
      lastEvent = `hit:${roundIdx}:${idx}:${need}`;
    } else {
      misses++;
      roundMiss++;
      mark = 2;
      ctx.sfx('fail');
      lastEvent = `miss:${roundIdx}:${idx}:${taps}/${need}`;
    }
    markUntil = now + 500;
  }

  // ---------- 入力 ----------
  const offTap = ctx.input.onTap((p) => {
    if (hostPaused || !started || mode !== 'stream') return;
    if (cv.toLocal(p).y < TAP_Y) return;
    taps++;
    ctx.sfx('tap');
    ctx.haptic('light');
    lastEvent = `tap:${idx}:${taps}`;
  });

  // ---------- 毎フレーム ----------
  const offFrame = ctx.onFrame(() => {
    if (hostPaused || !started) return;
    const now = ctx.now();
    if (mode === 'intro' && now >= phaseUntil) {
      mode = 'stream';
      idx = 0;
      taps = 0;
      itemUntil = now + itemMs();
      lastEvent = `start:${roundIdx}`;
    } else if (mode === 'stream' && now >= itemUntil) {
      judgeItem(now);
      idx++;
      taps = 0;
      if (idx >= items.length) {
        if (roundMiss === 0) {
          score += ROUND_BONUS;
          cleanRounds++;
          ctx.achieve('perfect-round');
          if (rules() >= RULES.length) ctx.achieve('all-rules');
        }
        if (roundIdx + 1 >= ROUNDS) finish(now);
        else {
          if (roundIdx + 1 >= 3) ctx.achieve('half');
          loadRound(roundIdx + 1, now);
        }
      } else {
        itemUntil = now + itemMs();
      }
    } else if (mode === 'done' && !ended && now >= phaseUntil) {
      ended = true;
      ctx.end({ score });
      return;
    }
    draw(now);
    setData();
  });

  function finish(now: number): void {
    if (cleanRounds >= ROUNDS) ctx.achieve('all-perfect');
    if (score >= SCORE_HI) ctx.achieve('score-hi');
    mode = 'done';
    phaseUntil = now + END_DELAY;
    ctx.sfx('medal');
    lastEvent = `finish:${score}:${hits}`;
  }

  function setData(): void {
    if (!import.meta.env.DEV) return;
    const r = ctx.root as HTMLElement;
    const it = items[idx];
    r.dataset.mode = mode;
    r.dataset.round = String(roundIdx);
    r.dataset.rules = String(rules());
    r.dataset.idx = String(idx);
    r.dataset.item = it ? `${it.shape}${it.color}${it.size}${it.frame}` : '-';
    r.dataset.need = it ? String(needTaps(it, rules())) : '-';
    r.dataset.taps = String(taps);
    r.dataset.score = String(score);
    r.dataset.hits = String(hits);
    r.dataset.misses = String(misses);
    r.dataset.clean = String(cleanRounds);
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

  function drawItem(it: Item): void {
    const r = it.size === 1 ? CARD_R * 0.56 : CARD_R;
    g.fillStyle = ITEM_COLORS[it.color]!;
    if (it.shape === 0) {
      g.beginPath();
      g.arc(CARD_CX, CARD_CY, r, 0, Math.PI * 2);
      g.fill();
    } else {
      roundRect(CARD_CX - r * 0.9, CARD_CY - r * 0.9, r * 1.8, r * 1.8, 12);
      g.fill();
    }
    // わく（点線かどうか）
    g.strokeStyle = '#ffffff';
    g.lineWidth = 4;
    if (it.frame === 1) g.setLineDash([9, 7]);
    if (it.shape === 0) {
      g.beginPath();
      g.arc(CARD_CX, CARD_CY, r + 10, 0, Math.PI * 2);
      g.stroke();
    } else {
      roundRect(CARD_CX - r * 0.9 - 10, CARD_CY - r * 0.9 - 10, r * 1.8 + 20, r * 1.8 + 20, 16);
      g.stroke();
    }
    g.setLineDash([]);
  }

  function draw(now: number): void {
    cv.clear(C_BG);

    // HUD
    g.fillStyle = '#120e1c';
    g.fillRect(0, 0, W, HUD_H);
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.fillStyle = C_TEXT;
    g.font = 'bold 18px sans-serif';
    g.fillText(`${score}てん`, 12, HUD_H / 2);
    g.fillStyle = C_DIM;
    g.font = 'bold 13px sans-serif';
    g.fillText(`ラウンド ${Math.min(roundIdx + 1, ROUNDS)}/${ROUNDS}`, 116, HUD_H / 2 - 8);
    g.fillText(`せいかい ${hits}・ミス ${misses}`, 116, HUD_H / 2 + 9);

    if (mode === 'done') {
      g.textAlign = 'center';
      g.fillStyle = C_TEXT;
      g.font = 'bold 26px sans-serif';
      g.fillText(`${hits} / ${ROUNDS * PER_ROUND} せいかい！`, W / 2, 280);
      g.font = 'bold 34px sans-serif';
      g.fillStyle = C_ACC;
      g.fillText(`${score}てん`, W / 2, 336);
      g.fillStyle = C_DIM;
      g.font = 'bold 14px sans-serif';
      g.fillText(`ノーミスの ラウンド ${cleanRounds} / ${ROUNDS}`, W / 2, 380);
      return;
    }

    // ルール一覧（つねに 出す）
    g.textAlign = 'left';
    const n = rules();
    for (let i = 0; i < n; i++) {
      const y = RULE_Y + i * RULE_H;
      const isNew = mode === 'intro' && i === n - 1;
      g.fillStyle = isNew ? C_ACC : C_DIM;
      g.font = isNew ? 'bold 13px sans-serif' : 'bold 12px sans-serif';
      g.fillText(`${i + 1}. ${RULES[i]}`, 16, y);
    }

    g.textAlign = 'center';

    if (mode === 'intro') {
      g.fillStyle = C_ACC;
      g.font = 'bold 22px sans-serif';
      g.fillText(roundIdx === 0 ? 'ルール 1つ から！' : `ルールが ${n}つに ふえた！`, W / 2, 250);
      g.fillStyle = C_TEXT;
      g.font = 'bold 15px sans-serif';
      g.fillText(`「${RULES[n - 1]}」`, W / 2, 292);
      g.fillStyle = C_DIM;
      g.font = 'bold 13px sans-serif';
      g.fillText(`${PER_ROUND}こ ながれてくるよ`, W / 2, 330);
      return;
    }

    // のこり時間
    const left = Math.max(0, (itemUntil - now) / itemMs());
    g.fillStyle = 'rgba(157,146,189,.22)';
    roundRect(60, 186, 240, 7, 4);
    g.fill();
    g.fillStyle = left > 0.3 ? C_OK : C_ACC;
    roundRect(60, 186, 240 * left, 7, 4);
    g.fill();

    // 品
    const it = items[idx];
    if (it) drawItem(it);

    // タップの 回数
    g.fillStyle = C_TEXT;
    g.font = 'bold 15px sans-serif';
    g.fillText(taps > 0 ? `タップ ${taps}かい` : 'タップ しない？', W / 2, 424);
    if (it) {
      g.fillStyle = C_DIM;
      g.font = 'bold 12px sans-serif';
      g.fillText(
        `${it.shape === 0 ? 'まる' : '四角'}・${COLOR_NAMES[it.color]}・${it.size === 1 ? '小さい' : '大きい'}・${it.frame === 1 ? '点線' : 'ふつうの わく'}`,
        W / 2,
        448,
      );
    }

    // 判定
    if (now < markUntil) {
      g.fillStyle = mark === 1 ? C_OK : C_NG;
      g.font = 'bold 20px sans-serif';
      g.fillText(mark === 1 ? 'せいかい！' : 'ちがった…', W / 2, 480);
    }

    // すすみ ぐあい
    const dw = 22;
    const x0 = W / 2 - ((PER_ROUND - 1) * dw) / 2;
    for (let i = 0; i < PER_ROUND; i++) {
      g.beginPath();
      g.arc(x0 + i * dw, 516, i === idx ? 5.5 : 4, 0, Math.PI * 2);
      g.fillStyle = i === idx ? C_ACC : i < idx ? 'rgba(90,208,138,.8)' : 'rgba(157,146,189,.3)';
      g.fill();
    }

    g.fillStyle = C_DIM;
    g.font = 'bold 12px sans-serif';
    g.fillText('ルールは ぜんぶ 画面に 出ている（覚えなくて よい）', W / 2, 560);
    g.font = 'bold 11px sans-serif';
    g.fillText('タップの 回数が ぴったり 合っていれば せいかい', W / 2, 586);
  }

  draw(0);
  setData();

  return {
    start() {
      started = true;
      phaseUntil = ctx.now() + INTRO_MS;
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
