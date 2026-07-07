// =============================================================
// かたむきメイロ（No.4）: 傾き/ドラッグでボールを転がすランダム迷路
// =============================================================
// - 毎回ランダムな迷路（maze.ts）を、端末の傾き（ctx.motion）か指ドラッグで転がしてゴールへ
// - タイムアタック（timeMs・短いほど良い）。難易度＝迷路の大きさ
// - 物理は固定サブステップ＋円vs矩形の押し出し（block-break / dev-tilt と同じ実証済み手法）
// - タイマー等はすべて ctx.now 基準（Math.random/Date.now/setTimeout 不使用）
// - import してよいのは game-api（types / helpers）と、このフォルダ内（maze）だけ
// =============================================================
import type { GameContext, IGame } from '../../game-api/types';
import { createCountdown, createDragTilt, elem, makeSeg, pushOutCircleFromRect } from '../../game-api/helpers';
import { N, E, S, W, generateMaze, hasWall, type Maze } from './maze';

type Size = 'small' | 'normal' | 'big';
type Mode = 'setup' | 'count' | 'play' | 'goal';

interface Config {
  size: Size;
  hint: boolean;
}

const CANVAS_W = 640;
const CANVAS_H = 400;
const PAD_X = 16;
const PAD_TOP = 34; // タイマー表示のぶん上を空ける
const PAD_BOT = 16;
const WALL_T = 3; // 壁の太さ（描画・当たり判定共通）

const SUB = 1 / 120; // 物理サブステップ（高速時のすり抜け防止）
const ACC = 900; // 傾き1.0あたりの加速度 px/s^2
const MAX_V = 900; // 速度上限（すり抜け防止）
const DAMP = 1.4; // 減衰係数
const GOAL_WAIT = 1400;
const DRAG_DIV = 70; // ドラッグ量→仮想傾きの割る数（dev-tilt と同じ感度）

const DIMS: Record<Size, { cols: number; rows: number }> = {
  small: { cols: 7, rows: 5 },
  normal: { cols: 10, rows: 7 },
  big: { cols: 13, rows: 9 },
};

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function createGame(ctx: GameContext): IGame {
  // ---- 設定（前回を復元）----
  const saved = ctx.load<Partial<Config>>('config');
  const config: Config = {
    size: saved?.size === 'small' || saved?.size === 'big' ? saved.size : 'normal',
    hint: saved?.hint === true,
  };

  // ---- 状態 ----
  let mode: Mode = 'setup';
  let maze: Maze | null = null;
  let walls: Rect[] = [];
  // 迷路（壁・スタート印・ヒント・ゴール）は対戦中ずっと不変なので、1回だけ
  // オフスクリーンに焼いて毎フレームは drawImage で貼る（毎フレームの絵文字fillText
  // ×150回のfillRect・ヒントの再計算を避ける。低スペック端末対策）
  let staticLayer: HTMLCanvasElement | null = null;
  let cs = 40; // セルの一辺（px）
  let ox = 0; // 迷路左上のx
  let oy = 0;
  const ball = { x: 0, y: 0, vx: 0, vy: 0, r: 12 };
  let goalX = 0;
  let goalY = 0;

  // ポーズ中の入力ガード。実際はシェルのオーバーレイが入力を遮るので保険だが、
  // 契約（onFrame停止＝mode は 'play' のまま）に頼りきらないための二重防御
  let hostPaused = false;

  let t0 = 0; // プレイ開始時刻（経過タイムの起点）
  let finishMs = 0; // クリアタイム
  let acc = 0; // サブステップの余り
  let startFlashUntil = 0;
  let goalEndAt = 0;
  let ended = false;

  // ---- DOM / Canvas ----
  const cv = ctx.canvas2d({ design: { w: CANVAS_W, h: CANVAS_H } });
  const g = cv.ctx;
  const style = document.createElement('style');
  style.textContent = CSS;
  const ui = document.createElement('div');
  ui.className = 'mz-ui';
  ctx.root.append(style, ui);

  // ---- 設定画面 ----
  function showSetup(): void {
    mode = 'setup';
    const onoff = (v: boolean): string => (v ? 'on' : 'off');
    const box = elem('div', 'mz-setup');
    box.append(elem('h2', 'mz-h2', 'めいろの せってい'));
    box.append(
      makeSeg(
        'mz',
        'おおきさ',
        [
          { v: 'small', t: 'ちいさい' },
          { v: 'normal', t: 'ふつう' },
          { v: 'big', t: 'おおきい' },
        ],
        () => config.size,
        (v) => {
          config.size = v as Size;
        },
      ),
      makeSeg(
        'mz',
        'ヒント',
        [
          { v: 'off', t: 'なし' },
          { v: 'on', t: 'あり' },
        ],
        () => onoff(config.hint),
        (v) => {
          config.hint = v === 'on';
        },
      ),
    );
    box.append(elem('p', 'mz-note', 'スマホをかたむけて（or ゆびでドラッグして）ボールをゴールまではこぼう！'));
    const start = elem('button', 'mz-btn mz-btn-primary mz-btn-lg', 'スタート ▶') as HTMLButtonElement;
    start.addEventListener('click', () => startMatch());
    box.append(start);
    ui.replaceChildren(box);
    draw(0);
  }

  // ---- 迷路の準備 ----
  function layout(): void {
    if (!maze) return;
    const availW = CANVAS_W - PAD_X * 2;
    const availH = CANVAS_H - PAD_TOP - PAD_BOT;
    cs = Math.floor(Math.min(availW / maze.cols, availH / maze.rows));
    const mazeW = cs * maze.cols;
    const mazeH = cs * maze.rows;
    ox = Math.round((CANVAS_W - mazeW) / 2);
    oy = Math.round(PAD_TOP + (availH - mazeH) / 2);
    ball.r = Math.max(6, Math.round(cs * 0.3));
  }

  function cellCenter(cell: number): { x: number; y: number } {
    if (!maze) return { x: 0, y: 0 };
    const gx = cell % maze.cols;
    const gy = (cell / maze.cols) | 0;
    return { x: ox + gx * cs + cs / 2, y: oy + gy * cs + cs / 2 };
  }

  function buildWalls(): void {
    walls = [];
    if (!maze) return;
    const h = WALL_T / 2;
    for (let gy = 0; gy < maze.rows; gy++) {
      for (let gx = 0; gx < maze.cols; gx++) {
        const cell = gy * maze.cols + gx;
        const px = ox + gx * cs;
        const py = oy + gy * cs;
        // 各壁は1回だけ矩形化する（N・W は全セル、E は右端列、S は下端行）。
        // 角の隙間を埋めるため両端を WALL_T/2 ずつ伸ばす
        if (hasWall(maze, cell, N)) walls.push({ x: px - h, y: py - h, w: cs + WALL_T, h: WALL_T });
        if (hasWall(maze, cell, W)) walls.push({ x: px - h, y: py - h, w: WALL_T, h: cs + WALL_T });
        if (gx === maze.cols - 1 && hasWall(maze, cell, E))
          walls.push({ x: px + cs - h, y: py - h, w: WALL_T, h: cs + WALL_T });
        if (gy === maze.rows - 1 && hasWall(maze, cell, S))
          walls.push({ x: px - h, y: py + cs - h, w: cs + WALL_T, h: WALL_T });
      }
    }
  }

  function startMatch(): void {
    ctx.save('config', { ...config });
    const { cols, rows } = DIMS[config.size];
    maze = generateMaze(cols, rows, ctx.random);
    layout();
    buildWalls();
    const s = cellCenter(maze.start);
    ball.x = s.x;
    ball.y = s.y;
    ball.vx = 0;
    ball.vy = 0;
    const gg = cellCenter(maze.goal);
    goalX = gg.x;
    goalY = gg.y;
    buildStaticLayer();
    tiltIn.reset();
    ended = false;
    // プレイ用UI（水平リセットボタン）。右上60×60はポーズボタン予約なので左上に置く
    const reset = elem('button', 'mz-reset', '💧 すいへい') as HTMLButtonElement;
    reset.addEventListener('click', () => {
      ctx.motion?.calibrate();
      tiltIn.reset();
      ctx.sfx('tap');
    });
    ui.replaceChildren(reset);
    // カウントダウン開始
    mode = 'count';
    countdown.start(ctx.now());
  }

  const countdown = createCountdown({
    onCount: () => ctx.sfx('tick'),
    onGo: (now) => {
      ctx.motion?.calibrate(); // いまの持ち方を水平に
      ctx.sfx('start');
      t0 = now;
      startFlashUntil = now + 700;
      mode = 'play';
    },
  });

  // ---- 物理（1サブステップ）----
  function physics(dt: number): void {
    const t = tiltIn.value();
    ball.vx += t.x * ACC * dt;
    ball.vy += t.y * ACC * dt;
    const damp = Math.exp(-DAMP * dt);
    ball.vx *= damp;
    ball.vy *= damp;
    const sp = Math.hypot(ball.vx, ball.vy);
    if (sp > MAX_V) {
      ball.vx = (ball.vx / sp) * MAX_V;
      ball.vy = (ball.vy / sp) * MAX_V;
    }
    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;

    // 壁（円と矩形の押し出し・当たった軸の速度を弱める）。
    // 押し出し（d2≈0 の浅軸対策込み）は共通ヘルパー、速度応答はこのゲームの手触り
    for (const r of walls) {
      const axis = pushOutCircleFromRect(ball, ball.r, r);
      if (axis === 'x') ball.vx *= -0.2;
      else if (axis === 'y') ball.vy *= -0.2;
    }
  }

  function enterGoal(now: number): void {
    mode = 'goal';
    finishMs = now - t0;
    goalEndAt = now + GOAL_WAIT;
    ctx.sfx('success');
    ctx.haptic('success');
    ctx.achieve('first-goal');
    if (finishMs <= 15_000) ctx.achieve('speedy');
    if (config.size === 'big') ctx.achieve('big-clear');
    if (!tiltIn.usedDrag) ctx.achieve('tilt-master');
    const cleared = ctx.load<Record<string, boolean>>('cleared') ?? {};
    cleared[config.size] = true;
    ctx.save('cleared', cleared);
    if (cleared.small && cleared.normal && cleared.big) ctx.achieve('all-sizes');
  }

  // ---- 毎フレーム ----
  const offFrame = ctx.onFrame((dt) => {
    const now = ctx.now();
    if (mode === 'count') {
      countdown.tick(now);
      draw(now);
      return;
    }
    if (mode === 'goal') {
      if (now >= goalEndAt && !ended) {
        ended = true;
        ctx.end({ score: Math.round(finishMs) });
      }
      draw(now);
      return;
    }
    if (mode !== 'play') {
      draw(now);
      return;
    }

    acc += dt;
    let guard = 0;
    while (acc >= SUB && guard < 8) {
      acc -= SUB;
      guard++;
      physics(SUB);
    }
    if (Math.hypot(ball.x - goalX, ball.y - goalY) < cs * 0.34) {
      enterGoal(now);
    }
    draw(now);
  });

  // ---- 入力（ドラッグ＝仮想傾き。センサーがなくても遊べる）----
  const tiltIn = createDragTilt(ctx, {
    toLocal: (p) => cv.toLocal(p),
    div: DRAG_DIV,
    enabled: () => mode === 'play' && !hostPaused,
  });

  // ---- 迷路の静的レイヤーを1回だけ焼く（壁・スタート印・ヒント・ゴール）----
  function buildStaticLayer(): void {
    if (!maze) return;
    const scale = 2; // 2倍解像度で焼いて拡大時もくっきり（表示DPR上限2に対応）
    const off = document.createElement('canvas');
    off.width = CANVAS_W * scale;
    off.height = CANVAS_H * scale;
    const o = off.getContext('2d');
    if (!o) return;
    o.setTransform(scale, 0, 0, scale, 0, 0); // 以降は design 座標で描ける

    // ヒント（正解ルートの点線）
    if (config.hint) {
      o.strokeStyle = 'rgba(250, 204, 21, 0.5)';
      o.lineWidth = Math.max(2, cs * 0.12);
      o.setLineDash([cs * 0.18, cs * 0.22]);
      o.beginPath();
      for (let i = 0; i < maze.solution.length; i++) {
        const p = cellCenter(maze.solution[i] ?? 0);
        if (i === 0) o.moveTo(p.x, p.y);
        else o.lineTo(p.x, p.y);
      }
      o.stroke();
      o.setLineDash([]);
    }

    // スタート印
    const st = cellCenter(maze.start);
    o.fillStyle = 'rgba(56, 189, 248, 0.30)';
    o.beginPath();
    o.arc(st.x, st.y, cs * 0.32, 0, Math.PI * 2);
    o.fill();

    // ゴール（絵文字はここで1回だけラスタライズ）
    o.font = `${Math.round(cs * 0.6)}px sans-serif`;
    o.textAlign = 'center';
    o.textBaseline = 'middle';
    o.fillText('🏁', goalX, goalY);

    // 壁
    o.fillStyle = '#6b7bd6';
    for (const r of walls) o.fillRect(r.x, r.y, r.w, r.h);

    staticLayer = off;
  }

  // ---- 描画 ----
  function draw(now: number): void {
    cv.clear('#0e1230');
    if (!maze) return;

    // 迷路の静的レイヤー（焼き済み）を貼る
    if (staticLayer) g.drawImage(staticLayer, 0, 0, CANVAS_W, CANVAS_H);

    // ボール
    g.beginPath();
    g.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
    g.fillStyle = '#f8fafc';
    g.fill();
    g.beginPath();
    g.arc(ball.x - ball.r * 0.3, ball.y - ball.r * 0.3, ball.r * 0.35, 0, Math.PI * 2);
    g.fillStyle = 'rgba(255,255,255,0.7)';
    g.fill();

    // タイマー（上中央）
    g.fillStyle = '#cbd5e1';
    g.font = 'bold 20px sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'alphabetic';
    const shownMs = mode === 'goal' ? finishMs : mode === 'play' ? now - t0 : 0;
    g.fillText(`${(shownMs / 1000).toFixed(2)} 秒`, CANVAS_W / 2, 24);

    // カウントダウン / スタート / ゴール演出
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    if (mode === 'count' && countdown.count >= 1) {
      bigText(String(countdown.count), '#ffffff', 92);
    } else if (mode === 'play' && now < startFlashUntil) {
      bigText('スタート！', '#fbbf24', 48);
    } else if (mode === 'goal') {
      bigText('ゴール！', '#4ade80', 54);
    }
    g.textBaseline = 'alphabetic';
  }

  function bigText(text: string, color: string, size: number): void {
    g.font = `900 ${size}px sans-serif`;
    g.fillStyle = 'rgba(8,10,30,0.55)';
    g.fillRect(0, CANVAS_H / 2 - size * 0.7, CANVAS_W, size * 1.4);
    g.fillStyle = color;
    g.fillText(text, CANVAS_W / 2, CANVAS_H / 2);
  }

  // ---- 起動 ----
  showSetup();

  return {
    start() {
      // startMode:'immediate'。設定画面から開始する
    },
    pause() {
      hostPaused = true;
    },
    resume() {
      hostPaused = false;
      ctx.motion?.calibrate(); // ポーズ中に持ち方が変わっていても水平に取り直す
      tiltIn.reset();
    },
    resize() {
      // design 指定の Canvas は自動でレターボックス調整される
    },
    destroy() {
      offFrame();
      tiltIn.destroy();
      style.remove();
      ui.remove();
    },
  };
}

// =============================================================
// スタイル（.mz- プレフィックス）
// =============================================================
const CSS = `
.mz-ui{position:absolute;inset:0;pointer-events:none}
.mz-ui > *{pointer-events:auto}
/* justify-content:safe center + overflow-y:auto: 横向きの低い画面（ノッチ端末の
   セーフエリアで game-root がさらに縮む）でも設定が上端から見えてスクロールできる
   （margin:auto/中央寄せだと上端が見切れてスクロール不能になるのを防ぐ。.stage-overlay と同方針） */
.mz-setup{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:safe center;gap:12px;
  padding:16px;box-sizing:border-box;background:rgba(10,14,40,.82);align-items:center;overflow-y:auto;
  color:#f2f3fb;user-select:none;-webkit-user-select:none}
.mz-h2{margin:0 0 6px;font-size:20px;text-align:center}
.mz-setup .mz-seg-row{width:min(88vw,360px)}
.mz-seg-row{display:flex;flex-direction:column;gap:6px}
.mz-seg-label{font-size:13px;color:#9aa0c6}
.mz-seg{display:flex;gap:6px}
.mz-seg-btn{flex:1;padding:10px 4px;border-radius:12px;border:2px solid #9aa0c6;
  background:transparent;color:inherit;font-weight:700;font-size:14px;min-height:44px}
.mz-seg-btn.mz-on{border-color:#38bdf8;background:rgba(56,189,248,.16)}
.mz-note{font-size:12px;color:#9aa0c6;margin:2px 0 0;text-align:center;max-width:min(88vw,360px)}
.mz-btn{padding:12px;border-radius:14px;border:none;background:rgba(128,128,160,.22);color:inherit;font-weight:800;font-size:16px}
.mz-btn-primary{background:linear-gradient(135deg,#3b82f6,#22d3ee);color:#fff}
.mz-btn-lg{padding:14px 28px;font-size:18px}
.mz-reset{position:absolute;left:10px;top:8px;padding:7px 14px;border-radius:999px;border:none;
  background:rgba(128,128,160,.28);color:#f2f3fb;font-weight:700;font-size:13px;
  min-height:44px;display:inline-flex;align-items:center}
`;
