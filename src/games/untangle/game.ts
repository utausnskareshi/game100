// =============================================================
// ひもを ほどく（No.127・かくれゲーム）: 点を うごかして 交差を ゼロに
// =============================================================
// - グラフは「円に ならべると 交差しない」ように 作っているので **かならず ほどける**。
// - 時間制限も しっぱいも ない のんびり系。うまさは「ドラッグの 回数」で 出る。
// - import してよいのは game-api（types / helpers）と、このフォルダ内（logic）だけ。
import type { GameContext, IGame, PointerInfo } from '../../game-api/types';
import {
  FIELD,
  type Graph,
  type Layout,
  NODE_R,
  SPECS,
  STAGE_COUNT,
  crossings,
  makeGraph,
  scramble,
  segCross,
  stageScore,
} from './logic';

const W = 360;
const H = 640;
const HUD_H = 46;

const CLEAR_MS = 1800;
const END_DELAY = 2600;
const SCORE_HI = 570;

const C_BG = '#0f1a1c';
const C_FIELD = '#15262a';
const C_LINE = '#4f8f96';
const C_CROSS = '#e0704a';
const C_NODE = '#ffd54a';
const C_NODE_HELD = '#fff3c4';
const C_TEXT = '#e8f4f4';
const C_DIM = '#8ab0b4';
const C_OK = '#5ad08a';

type Mode = 'play' | 'cleared' | 'done';

export function createGame(ctx: GameContext): IGame {
  const cv = ctx.canvas2d({ design: { w: W, h: H } });
  const g = cv.ctx;

  let stageIdx = 0;
  let graph: Graph = makeGraph(ctx.random, SPECS[0]!);
  let lay: Layout = scramble(ctx.random, graph);
  let held = -1;
  let drags = 0;
  let mode: Mode = 'play';
  let started = false;
  let hostPaused = false;
  let ended = false;
  let score = 0;
  let cleared = 0;
  let neatRuns = 0;
  let bigDone = 0;
  let phaseUntil = 0;
  let lastEvent = '';

  function loadStage(i: number): void {
    stageIdx = i;
    graph = makeGraph(ctx.random, SPECS[i]!);
    lay = scramble(ctx.random, graph);
    held = -1;
    drags = 0;
    mode = 'play';
    lastEvent = `stage:${i}:cross${crossings(graph, lay)}`;
  }

  // ---------- 入力 ----------
  const nearest = (p: { x: number; y: number }): number => {
    let best = -1;
    let bd = NODE_R + 14;
    for (let i = 0; i < graph.n; i++) {
      const d = Math.hypot(p.x - lay.x[i]!, p.y - lay.y[i]!);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return best;
  };
  const offDown = ctx.input.onDown((p: PointerInfo) => {
    if (hostPaused || !started || mode !== 'play') return;
    const i = nearest(cv.toLocal(p));
    if (i < 0) return;
    held = i;
    drags++;
    ctx.sfx('tap');
    lastEvent = `grab:${i}:${drags}`;
  });
  const offMove = ctx.input.onMove((p: PointerInfo) => {
    if (hostPaused || !started || mode !== 'play' || held < 0) return;
    const l = cv.toLocal(p);
    lay.x[held] = Math.max(FIELD.x0 + NODE_R, Math.min(FIELD.x1 - NODE_R, l.x));
    lay.y[held] = Math.max(FIELD.y0 + NODE_R, Math.min(FIELD.y1 - NODE_R, l.y));
  });
  const offUp = ctx.input.onUp(() => {
    if (held < 0) return;
    held = -1;
    if (mode !== 'play') return;
    if (crossings(graph, lay) === 0) {
      const pts = stageScore(drags, graph.n);
      score += pts;
      cleared++;
      if (drags <= graph.n * 2) {
        neatRuns++;
        ctx.achieve('few-drags');
      }
      if (graph.n >= 10) {
        bigDone++;
        ctx.achieve('big-graph');
      }
      if (cleared === 1) ctx.achieve('first-clear');
      if (cleared >= 2) ctx.achieve('half');
      mode = 'cleared';
      phaseUntil = ctx.now() + CLEAR_MS;
      ctx.sfx('medal');
      ctx.haptic('success');
      lastEvent = `clear:${stageIdx}:${pts}:${drags}`;
    }
  });

  // ---------- 毎フレーム ----------
  const offFrame = ctx.onFrame(() => {
    if (hostPaused || !started) return;
    const now = ctx.now();
    if (mode === 'cleared' && now >= phaseUntil) {
      if (stageIdx + 1 >= STAGE_COUNT) finish(now);
      else loadStage(stageIdx + 1);
    } else if (mode === 'done' && !ended && now >= phaseUntil) {
      ended = true;
      ctx.end({ score });
      return;
    }
    draw();
    setData();
  });

  function finish(now: number): void {
    if (neatRuns >= STAGE_COUNT) ctx.achieve('all-neat');
    if (score >= SCORE_HI) ctx.achieve('score-hi');
    mode = 'done';
    phaseUntil = now + END_DELAY;
    ctx.sfx('medal');
    lastEvent = `finish:${score}:${cleared}`;
  }

  function setData(): void {
    if (!import.meta.env.DEV) return;
    const r = ctx.root as HTMLElement;
    r.dataset.mode = mode;
    r.dataset.stage = String(stageIdx);
    r.dataset.n = String(graph.n);
    r.dataset.edges = graph.edges.map((e) => e.join('-')).join(',');
    r.dataset.pos = lay.x.map((x, i) => `${x.toFixed(1)},${lay.y[i]!.toFixed(1)}`).join(';');
    r.dataset.cross = String(crossings(graph, lay));
    r.dataset.drags = String(drags);
    r.dataset.held = String(held);
    r.dataset.score = String(score);
    r.dataset.cleared = String(cleared);
    r.dataset.neat = String(neatRuns);
    r.dataset.big = String(bigDone);
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

  /** その ひもが どこかと 交差しているか（色分けの ため） */
  function isCrossed(k: number): boolean {
    const [a, b] = graph.edges[k]!;
    for (let j = 0; j < graph.edges.length; j++) {
      if (j === k) continue;
      const [c, d] = graph.edges[j]!;
      if (a === c || a === d || b === c || b === d) continue;
      if (segCross(lay.x[a]!, lay.y[a]!, lay.x[b]!, lay.y[b]!, lay.x[c]!, lay.y[c]!, lay.x[d]!, lay.y[d]!)) return true;
    }
    return false;
  }

  function draw(): void {
    cv.clear(C_BG);
    const cross = crossings(graph, lay);

    // HUD
    g.fillStyle = '#0a1315';
    g.fillRect(0, 0, W, HUD_H);
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.fillStyle = C_TEXT;
    g.font = 'bold 18px sans-serif';
    g.fillText(`${score}てん`, 12, HUD_H / 2);
    g.fillStyle = C_DIM;
    g.font = 'bold 13px sans-serif';
    g.fillText(`もんだい ${Math.min(stageIdx + 1, STAGE_COUNT)}/${STAGE_COUNT}`, 116, HUD_H / 2 - 8);
    g.fillText(`うごかした ${drags}かい`, 116, HUD_H / 2 + 9);

    g.textAlign = 'center';

    if (mode === 'done') {
      g.fillStyle = C_TEXT;
      g.font = 'bold 26px sans-serif';
      g.fillText('ぜんぶ ほどけた！', W / 2, 280);
      g.font = 'bold 34px sans-serif';
      g.fillStyle = C_NODE;
      g.fillText(`${score}てん`, W / 2, 336);
      g.fillStyle = C_DIM;
      g.font = 'bold 14px sans-serif';
      g.fillText(`むだのない ほどき ${neatRuns} / ${STAGE_COUNT} もん`, W / 2, 380);
      return;
    }

    // といかけ
    g.fillStyle = C_DIM;
    g.font = 'bold 13px sans-serif';
    g.fillText('点を うごかして、ひもの 交差を ゼロに しよう', W / 2, 72);
    g.fillStyle = cross === 0 ? C_OK : C_CROSS;
    g.font = 'bold 22px sans-serif';
    g.fillText(cross === 0 ? '交差 ゼロ！' : `交差 ${cross}こ`, W / 2, 104);

    // ばん
    g.fillStyle = C_FIELD;
    roundRect(FIELD.x0 - 6, FIELD.y0 - 6, FIELD.x1 - FIELD.x0 + 12, FIELD.y1 - FIELD.y0 + 12, 14);
    g.fill();

    // ひも
    for (let k = 0; k < graph.edges.length; k++) {
      const [a, b] = graph.edges[k]!;
      const bad = isCrossed(k);
      g.strokeStyle = bad ? C_CROSS : C_LINE;
      g.lineWidth = bad ? 3.4 : 2.6;
      g.beginPath();
      g.moveTo(lay.x[a]!, lay.y[a]!);
      g.lineTo(lay.x[b]!, lay.y[b]!);
      g.stroke();
    }

    // 点
    for (let i = 0; i < graph.n; i++) {
      g.fillStyle = held === i ? C_NODE_HELD : C_NODE;
      g.beginPath();
      g.arc(lay.x[i]!, lay.y[i]!, NODE_R, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = 'rgba(0,0,0,.35)';
      g.lineWidth = 2;
      g.beginPath();
      g.arc(lay.x[i]!, lay.y[i]!, NODE_R, 0, Math.PI * 2);
      g.stroke();
    }

    // ようす
    g.font = 'bold 15px sans-serif';
    if (mode === 'cleared') {
      g.fillStyle = C_OK;
      g.fillText(`ほどけた！ +${stageScore(drags, graph.n)}てん`, W / 2, 540);
    } else if (held >= 0) {
      g.fillStyle = C_NODE;
      g.fillText('うごかしている… はなすと 判定', W / 2, 540);
    } else {
      g.fillStyle = C_DIM;
      g.font = 'bold 13px sans-serif';
      g.fillText('赤い ひもが 交差している ところ', W / 2, 540);
    }
    g.fillStyle = C_DIM;
    g.font = 'bold 12px sans-serif';
    g.fillText('じかん制限も しっぱいも ない。ゆっくり どうぞ', W / 2, 578);
    g.font = 'bold 11px sans-serif';
    g.fillText(`うごかす 回数が ${graph.n * 2}かい までなら まんてん`, W / 2, 604);
  }

  draw();
  setData();

  return {
    start() {
      started = true;
    },
    pause() {
      hostPaused = true;
      held = -1;
    },
    resume() {
      hostPaused = false;
    },
    resize() {
      draw();
    },
    destroy() {
      offDown();
      offMove();
      offUp();
      offFrame();
    },
  };
}
