// =============================================================
// よけよけレース（No.19）: 縦スクロールの道路を車でよけながら距離をのばす
// =============================================================
// - 前から来る車🚗/コーン🚧をよけ、⭐で得点、🚀ブーストで一時加速＋無敵。ライフ3。
// - スピードは距離とともに上がる（レースの疾走感）。すれちがった車の数もカウント。
// - 操作: 画面の左半分/右半分を押しているあいだステア（onMove は購読しない＝キャプチャ問題なし）
//   ＋かたむき任意（optionalSensors:['motion']）。
// - スポーンは logic.ts（rng注入＝今日のゲームは全員同じ）。時間は ctx.now・setTimeout不使用。
// - import してよいのは game-api（types/helpers）と、このフォルダ内（logic）だけ
import type { GameContext, IGame } from '../../game-api/types';
import { clamp, elem, makeSeg } from '../../game-api/helpers';
import { rollSpawn, speedOf, intervalOf, overlap, scoreOf, type Diff, type EntKind } from './logic';

const W = 360;
const H = 640;
const ROAD_L = 30;
const ROAD_R = 330;
const ROAD_W = ROAD_R - ROAD_L;
const CAR_W = 36;
const CAR_H = 56;
const CAR_Y = H - 96; // 自車上端の y（固定）
const STEER_SPEED = 430; // 横移動の最大速度(px/s)
const MAX_LIVES = 3;
const INV_MS = 1100; // 衝突後の無敵時間(ms)
const BOOST_MS = 3000; // 🚀ブーストの持続(ms)
const BOOST_MULT = 1.7;
const END_DELAY = 1400;
const SCORE_HI = 6000; // score-hi 実績のしきい値（仮）

type Mode = 'setup' | 'play' | 'over';
interface Config {
  diff: Diff;
}
interface Ent {
  kind: EntKind;
  x: number;
  y: number;
  w: number;
  h: number;
  hit: boolean; // 当たり済み（多重加点/多重ダメージ防止）
}
interface Pop {
  x: number;
  y: number;
  text: string;
  color: string;
  until: number;
}

const SIZE: Record<EntKind, { w: number; h: number }> = {
  car: { w: 36, h: 56 },
  cone: { w: 28, h: 30 },
  star: { w: 30, h: 30 },
  boost: { w: 30, h: 32 },
};
// car は drawCar の自作描画（絵文字は向きが固定のため）。絵文字は残りの種類だけ
const EMOJI: Record<Exclude<EntKind, 'car'>, string> = { cone: '🚧', star: '⭐', boost: '🚀' };

export function createGame(ctx: GameContext): IGame {
  const cv = ctx.canvas2d({ design: { w: W, h: H } });
  const g = cv.ctx;

  const saved = ctx.load<Partial<Config>>('config');
  const config: Config = { diff: saved?.diff === 'easy' || saved?.diff === 'hard' ? saved.diff : 'normal' };

  // ---- 状態 ----
  let mode: Mode = 'setup';
  let hostPaused = false;
  let diff: Diff = config.diff;
  let carX = W / 2;
  let steer = 0; // -1/0/1（左右半分ホールド）
  let steerId = -1;
  let dist = 0;
  let overtakes = 0;
  let stars = 0;
  let lives = MAX_LIVES;
  let playStart = 0;
  let spawnAt = 0;
  let invUntil = 0;
  let boostUntil = 0;
  let roadScroll = 0; // 路面ラインのスクロール位相
  let endAt = 0;
  let ended = false;
  const ents: Ent[] = [];
  const pops: Pop[] = [];

  const style = document.createElement('style');
  style.textContent = CSS;
  ctx.root.append(style);
  let setupEl: HTMLElement | null = null;

  const level = (): number => Math.floor(dist / 500);
  const boosting = (now: number): boolean => now < boostUntil;
  const invincible = (now: number): boolean => now < invUntil || boosting(now);
  const score = (): number => scoreOf(dist, overtakes, stars);

  function setData(): void {
    // 検証用の状態公開（開発ビルド限定。本番では毎フレームの属性書き込みをしない）
    if (!import.meta.env.DEV) return;
    const r = ctx.root as HTMLElement;
    r.dataset.mode = mode;
    r.dataset.score = String(score());
    r.dataset.lives = String(lives);
    r.dataset.dist = String(Math.floor(dist));
    r.dataset.overtakes = String(overtakes);
    r.dataset.stars = String(stars);
    r.dataset.carx = String(Math.round(carX));
    r.dataset.ents = String(ents.length);
    // 障害物の中心x/yの一覧（自動プレイ検証用）
    r.dataset.obst = JSON.stringify(
      ents.filter((e) => e.kind === 'car' || e.kind === 'cone').map((e) => [Math.round(e.x + e.w / 2), Math.round(e.y)]),
    );
  }

  // ---- 設定画面 ----
  function showSetup(): void {
    mode = 'setup';
    setupEl = elem('div', 'rc-setup');
    setupEl.append(elem('h2', 'rc-h2', 'よけよけレース 🏎️'));
    setupEl.append(
      makeSeg(
        'rc',
        'むずかしさ',
        [
          { v: 'easy', t: 'やさしい' },
          { v: 'normal', t: 'ふつう' },
          { v: 'hard', t: 'むずかしい' },
        ],
        () => config.diff,
        (v) => {
          config.diff = v as Diff;
        },
      ),
    );
    setupEl.append(elem('p', 'rc-note', '車をうごかして、前から来る車🚗やコーン🚧をよけよう。⭐で得点、🚀でブースト！画面の左半分・右半分をおすとうごく（かたむけてもOK）。3回ぶつかると おしまい。'));
    const start = elem('button', 'rc-btn rc-btn-primary rc-btn-lg', 'スタート ▶') as HTMLButtonElement;
    start.addEventListener('click', () => startMatch());
    setupEl.append(start);
    ctx.root.append(setupEl);
    setData();
  }

  // ---- 開始 ----
  function startMatch(): void {
    ctx.save('config', { ...config });
    diff = config.diff;
    setupEl?.remove();
    setupEl = null;
    carX = W / 2;
    steer = 0;
    steerId = -1;
    dist = 0;
    overtakes = 0;
    stars = 0;
    lives = MAX_LIVES;
    ents.length = 0;
    pops.length = 0;
    invUntil = 0;
    boostUntil = 0;
    ended = false;
    mode = 'play';
    playStart = ctx.now();
    spawnAt = playStart + 400;
    ctx.motion?.calibrate();
    setData();
  }

  function spawnOne(): void {
    const s = rollSpawn(ctx.random, diff);
    const sz = SIZE[s.kind];
    ents.push({
      kind: s.kind,
      x: ROAD_L + s.xFrac * (ROAD_W - sz.w),
      y: -sz.h,
      w: sz.w,
      h: sz.h,
      hit: false,
    });
  }

  function addPop(x: number, y: number, text: string, color: string): void {
    pops.push({ x, y, text, color, until: ctx.now() + 700 });
  }

  function crash(now: number): void {
    lives--;
    invUntil = now + INV_MS;
    ctx.sfx('fail');
    ctx.haptic('error');
    if (lives <= 0) gameOver(now);
  }

  function gameOver(now: number): void {
    if (mode !== 'play') return;
    mode = 'over';
    // score-hi のみ最終判定も行う（最終フレームの⭐取得で閾値を跨いだ場合の保険。far-3000 は毎フレーム側で網羅）
    if (score() >= SCORE_HI) ctx.achieve('score-hi');
    ctx.sfx('fail');
    ctx.haptic('error');
    endAt = now + END_DELAY;
    setData();
  }

  // ---- 入力（左右半分ホールド。onMove は購読しない＝キャプチャなし）----
  const offDown = ctx.input.onDown((p) => {
    if (mode !== 'play' || hostPaused) return;
    steer = cv.toLocal(p).x < W / 2 ? -1 : 1;
    steerId = p.id;
  });
  const offUp = ctx.input.onUp((p) => {
    if (p.id === steerId) {
      steer = 0;
      steerId = -1;
    }
  });

  // ---- 毎フレーム ----
  const offFrame = ctx.onFrame((dt) => {
    const now = ctx.now();
    if (mode === 'play' && !hostPaused) {
      const spd = speedOf(diff, level()) * (boosting(now) ? BOOST_MULT : 1);
      dist += spd * dt;
      roadScroll = (roadScroll + spd * dt) % 40;

      // 実績（マイルストーン系は達したその場で解除＝中断しても取りこぼさない）
      if (dist >= 1000) ctx.achieve('first-drive');
      if (lives === MAX_LIVES && dist >= 2000) ctx.achieve('no-crash');
      if (dist >= 3000) ctx.achieve('far-3000');
      if (score() >= SCORE_HI) ctx.achieve('score-hi');

      // ステア（ホールド＋かたむき）
      const dir = clamp(steer + (ctx.motion?.tilt.x ?? 0), -1, 1);
      carX = clamp(carX + dir * STEER_SPEED * dt, ROAD_L + CAR_W / 2, ROAD_R - CAR_W / 2);

      // スポーン
      if (now >= spawnAt) {
        spawnOne();
        spawnAt = now + intervalOf(diff, level());
      }

      // 移動・当たり・退場
      const cx = carX - CAR_W / 2;
      for (let i = ents.length - 1; i >= 0; i--) {
        const e = ents[i];
        if (!e) continue;
        e.y += spd * dt;
        if (!e.hit && overlap(cx, CAR_Y, CAR_W, CAR_H, e.x, e.y, e.w, e.h)) {
          e.hit = true;
          if (e.kind === 'car' || e.kind === 'cone') {
            if (!invincible(now)) {
              crash(now);
              addPop(e.x + e.w / 2, e.y, 'ドン！', '#ff5b5b');
              ents.splice(i, 1);
              if (lives <= 0) break; // 同フレームでゲームオーバー→残りエンティティ処理を止める
              continue;
            }
            // 無敵中はすり抜け（当たり済みフラグで多重判定しない）
          } else if (e.kind === 'star') {
            stars++;
            addPop(e.x + e.w / 2, e.y, '+50', '#ffd23f');
            ctx.sfx('tap');
            if (stars >= 10) ctx.achieve('star-10');
            ents.splice(i, 1);
            continue;
          } else {
            // boost
            boostUntil = now + BOOST_MS;
            addPop(e.x + e.w / 2, e.y, 'ブースト！', '#5fd0ff');
            ctx.sfx('powerup');
            ctx.haptic('success');
            ents.splice(i, 1);
            continue;
          }
        }
        if (e.y > H) {
          if (e.kind === 'car' && !e.hit) {
            overtakes++;
            if (overtakes >= 20) ctx.achieve('overtake-20');
          }
          ents.splice(i, 1);
        }
      }

      for (let i = pops.length - 1; i >= 0; i--) {
        const p = pops[i];
        if (p && now >= p.until) pops.splice(i, 1);
      }
      setData();
    }

    if (mode === 'over' && !ended && now >= endAt) {
      ended = true;
      ctx.end({ score: score() });
    }

    draw(now);
  });

  // ---- 描画 ----
  function draw(now: number): void {
    // 草地
    g.fillStyle = '#5aa845';
    g.fillRect(0, 0, W, H);
    // 道路
    g.fillStyle = '#42474f';
    g.fillRect(ROAD_L, 0, ROAD_W, H);
    // 路肩
    g.fillStyle = '#e8e8ec';
    g.fillRect(ROAD_L - 4, 0, 4, H);
    g.fillRect(ROAD_R, 0, 4, H);
    // 中央/車線の破線（スクロール）
    g.fillStyle = 'rgba(255,255,255,.72)';
    for (const lx of [ROAD_L + ROAD_W / 3, ROAD_L + (ROAD_W * 2) / 3]) {
      for (let y = -40 + roadScroll; y < H; y += 40) {
        g.fillRect(lx - 3, y, 6, 22);
      }
    }

    // エンティティ（車は上/下向きの自作グラフィック・コーン/⭐/🚀は絵文字）
    for (const e of ents) {
      if (e.kind === 'car') {
        drawCar(e.x, e.y, e.w, e.h, '#4f8cff', false); // ライバル＝下向き（対向車）
      } else {
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.font = `${Math.round(e.h * 0.92)}px serif`;
        g.fillText(EMOJI[e.kind], e.x + e.w / 2, e.y + e.h / 2);
      }
    }

    // 自車（無敵中は点滅）
    const blink = now < invUntil && Math.floor(now / 90) % 2 === 0;
    if (!blink) {
      if (boosting(now)) {
        g.globalAlpha = 0.5;
        g.font = '20px serif';
        g.fillText('✨', carX, CAR_Y - 6);
        g.globalAlpha = 1;
      }
      drawCar(carX - CAR_W / 2, CAR_Y, CAR_W, CAR_H, '#ff5b5b', true); // 自車＝上向き（進行方向）
    }

    // 得点ポップ
    for (const p of pops) {
      const t = clamp((p.until - now) / 700, 0, 1);
      g.globalAlpha = t;
      g.fillStyle = p.color;
      g.font = 'bold 18px sans-serif';
      g.fillText(p.text, p.x, p.y - (1 - t) * 24);
    }
    g.globalAlpha = 1;

    drawHud();
    drawSteerHints();

    if (mode === 'over') {
      g.fillStyle = 'rgba(16,19,48,.72)';
      g.fillRect(0, 0, W, H);
      g.fillStyle = '#fff';
      g.textAlign = 'center';
      g.font = 'bold 38px sans-serif';
      g.fillText('ゴール！', W / 2, H / 2 - 26);
      g.font = 'bold 24px sans-serif';
      g.fillText(`${score()} 点`, W / 2, H / 2 + 18);
      g.font = 'bold 18px sans-serif';
      g.fillText(`きょり ${Math.floor(dist)}m・すれちがい ${overtakes}台`, W / 2, H / 2 + 52);
    }
  }

  function drawHud(): void {
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.font = '22px serif';
    for (let i = 0; i < MAX_LIVES; i++) {
      g.globalAlpha = i < lives ? 1 : 0.25;
      g.fillText('❤️', 10 + i * 26, 24);
    }
    g.globalAlpha = 1;
    g.fillStyle = '#fff';
    g.font = 'bold 20px sans-serif';
    g.fillText(`${score()}`, 10, 52);
    g.font = 'bold 13px sans-serif';
    g.fillText(`きょり ${Math.floor(dist)}m`, 10, 76);
  }

  function drawSteerHints(): void {
    g.globalAlpha = 0.16;
    g.fillStyle = '#fff';
    g.textAlign = 'center';
    g.textBaseline = 'alphabetic';
    g.font = 'bold 40px sans-serif';
    g.fillText('◀', W * 0.16, H - 24);
    g.fillText('▶', W * 0.84, H - 24);
    g.globalAlpha = 1;
  }

  // 角丸矩形
  function rr(x: number, y: number, w: number, h: number, r: number): void {
    const rad = Math.min(r, w / 2, h / 2);
    g.beginPath();
    g.moveTo(x + rad, y);
    g.arcTo(x + w, y, x + w, y + h, rad);
    g.arcTo(x + w, y + h, x, y + h, rad);
    g.arcTo(x, y + h, x, y, rad);
    g.arcTo(x, y, x + w, y, rad);
    g.closePath();
  }

  // 真上から見た自作カー（up=true で上向き＝進行方向・false で下向き＝対向）
  function drawCar(x: number, y: number, w: number, h: number, body: string, up: boolean): void {
    const ww = Math.max(4, w * 0.16);
    const wh = h * 0.24;
    g.fillStyle = '#22252e'; // タイヤ
    g.fillRect(x - 1, y + h * 0.14, ww, wh);
    g.fillRect(x + w - ww + 1, y + h * 0.14, ww, wh);
    g.fillRect(x - 1, y + h * 0.62, ww, wh);
    g.fillRect(x + w - ww + 1, y + h * 0.62, ww, wh);
    g.fillStyle = body; // 車体
    rr(x + 3, y, w - 6, h, 8);
    g.fill();
    const sw = (w - 6) * 0.6; // フロントガラス（前方寄り）
    const sx = x + 3 + ((w - 6) - sw) / 2;
    g.fillStyle = 'rgba(200,235,255,.92)';
    rr(sx, up ? y + h * 0.16 : y + h * 0.64, sw, h * 0.2, 4);
    g.fill();
    g.fillStyle = '#fff7cc'; // ヘッドライト（前方の左右）
    const ly = up ? y + 3 : y + h - 6;
    g.fillRect(x + 6, ly, 4, 3);
    g.fillRect(x + w - 10, ly, 4, 3);
  }

  showSetup();

  return {
    start() {
      /* 設定画面から開始（immediate） */
    },
    pause() {
      hostPaused = true;
      steer = 0;
      steerId = -1;
    },
    resume() {
      ctx.motion?.calibrate();
    },
    resize() {
      /* design 指定 Canvas は自動レターボックス＝何もしない */
    },
    destroy() {
      offDown();
      offUp();
      offFrame();
      style.remove();
      setupEl?.remove();
    },
  };
}

// =============================================================
// スタイル（.rc- プレフィックス。設定画面のみDOM・プレイはCanvas）
// =============================================================
const CSS = `
.rc-setup{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:safe center;
  gap:14px;padding:20px 16px;box-sizing:border-box;overflow-y:auto;user-select:none;-webkit-user-select:none;
  background:var(--bg)}
.rc-h2{margin:4px 0;font-size:22px;text-align:center}
.rc-seg-row{width:min(92vw,420px);display:flex;flex-direction:column;gap:6px}
.rc-seg-label{font-size:13px;color:var(--text-dim);font-weight:800}
.rc-seg{display:flex;background:var(--bg-elev2);border-radius:12px;padding:3px;gap:2px}
.rc-seg-btn{flex:1;border:none;background:none;color:var(--text-dim);padding:10px 2px;border-radius:9px;
  font-size:14px;font-weight:800;min-height:44px}
.rc-seg-btn.rc-on{background:var(--accent);color:#fff}
.rc-note{font-size:12px;color:var(--text-dim);text-align:center;max-width:min(92vw,420px);margin:0;line-height:1.7}
.rc-btn{appearance:none;border:none;border-radius:12px;padding:12px 18px;font-size:15px;font-weight:800;font-family:inherit;
  background:var(--bg-elev2);color:var(--text);min-height:44px}
.rc-btn-primary{background:var(--accent-grad);color:#fff}
.rc-btn-lg{width:100%;max-width:300px;font-size:18px}
`;
