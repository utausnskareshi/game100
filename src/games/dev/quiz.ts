// 検証用③: けいさんテスト（DOM構築・縦横どちらでも・ポイント制）
// 検証対象: Canvasを使わないDOMゲーム・orientation:any・スピードボーナス
import type { GameContext, IGame } from '../../game-api/types';

const TOTAL = 10;

export function createGame(ctx: GameContext): IGame {
  let qNum = 0;
  let score = 0;
  let correct = 0;
  let answer = 0;
  let qStart = 0;
  let locked = false;
  let timer = 0;

  const wrap = document.createElement('div');
  wrap.style.cssText =
    'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:20px;width:100%;height:100%;padding:24px;max-width:520px;margin:0 auto;';

  const progress = document.createElement('div');
  progress.style.cssText = 'font-size:14px;font-weight:700;color:#9aa0c6;';
  const scoreEl = document.createElement('div');
  scoreEl.style.cssText = 'font-size:15px;font-weight:800;color:#22d3ee;';
  const qEl = document.createElement('div');
  qEl.style.cssText = 'font-size:46px;font-weight:800;color:#fff;text-align:center;';
  const grid = document.createElement('div');
  grid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:12px;width:100%;';

  const btns: HTMLButtonElement[] = [];
  for (let i = 0; i < 4; i++) {
    const b = document.createElement('button');
    b.style.cssText =
      'border:none;border-radius:16px;background:#262a52;color:#fff;font-size:26px;font-weight:800;padding:20px 8px;min-height:64px;';
    b.addEventListener('click', () => pick(Number(b.dataset.v)));
    btns.push(b);
    grid.appendChild(b);
  }
  wrap.append(progress, qEl, grid, scoreEl);
  ctx.root.appendChild(wrap);

  const ri = (min: number, max: number): number => min + Math.floor(ctx.random() * (max - min + 1));

  function makeQuestion(): void {
    if (qNum >= TOTAL) {
      if (correct === TOTAL) ctx.achieve('perfect');
      if (ctx.now() <= 25_000) ctx.achieve('fast-25');
      ctx.end({ score });
      return;
    }
    qNum++;
    locked = false;
    const kind = ri(0, 2);
    let a: number;
    let b: number;
    let text: string;
    if (kind === 0) {
      a = ri(3, 49);
      b = ri(3, 49);
      answer = a + b;
      text = `${a} + ${b}`;
    } else if (kind === 1) {
      a = ri(10, 60);
      b = ri(2, a - 2);
      answer = a - b;
      text = `${a} − ${b}`;
    } else {
      a = ri(2, 9);
      b = ri(2, 9);
      answer = a * b;
      text = `${a} × ${b}`;
    }

    const choices = new Set<number>([answer]);
    while (choices.size < 4) {
      const off = [1, -1, 2, -2, 3, -3, 10, -10][ri(0, 7)] ?? 1;
      const v = answer + off;
      if (v >= 0) choices.add(v);
    }
    const list = [...choices];
    // シャッフル（ctx.random ベース）
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(ctx.random() * (i + 1));
      const t = list[i]!;
      list[i] = list[j]!;
      list[j] = t;
    }

    progress.textContent = `だい ${qNum} / ${TOTAL} もん`;
    scoreEl.textContent = `スコア ${score}`;
    qEl.textContent = `${text} = ?`;
    btns.forEach((b, i) => {
      const v = list[i] ?? 0;
      b.dataset.v = String(v);
      b.textContent = String(v);
      b.style.background = '#262a52';
    });
    qStart = ctx.now();
  }

  function pick(v: number): void {
    if (locked) return;
    locked = true;
    const hit = v === answer;
    const btn = btns.find((b) => Number(b.dataset.v) === v);
    if (hit) {
      const fast = ctx.now() - qStart <= 2000;
      score += 10 + (fast ? 5 : 0);
      correct++;
      ctx.sfx(fast ? 'combo' : 'success');
      ctx.haptic('light');
      if (btn) btn.style.background = '#1e8f5a';
    } else {
      ctx.sfx('fail');
      ctx.haptic('error');
      if (btn) btn.style.background = '#a33';
      const right = btns.find((b) => Number(b.dataset.v) === answer);
      if (right) right.style.background = '#1e8f5a';
    }
    scoreEl.textContent = `スコア ${score}`;
    timer = window.setTimeout(makeQuestion, hit ? 260 : 650);
  }

  return {
    start() {
      makeQuestion();
    },
    pause() {
      window.clearTimeout(timer);
    },
    resume() {
      // ポーズで止めた「次の問題へ」のタイマーを再開（回答済みで止まっていた場合）
      if (locked) timer = window.setTimeout(makeQuestion, 300);
    },
    resize() {},
    destroy() {
      window.clearTimeout(timer);
      wrap.remove();
    },
  };
}
