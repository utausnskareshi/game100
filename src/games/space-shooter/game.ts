// =============================================================
// うちゅうシューティング（No.20）: 自動連射で敵をたおす縦シューティング
// =============================================================
// - 自機は下部・弾は自動連射（撃つ操作は不要＝子ども向け）。敵はウェーブで降下。
//   敵に当たる/敵に下端まで抜けられる/敵弾に当たる＝ライフ−1。パワーアップ＆ボスあり。
// - 操作: 画面の左半分/右半分を押しているあいだ移動（onMove は購読しない＝キャプチャ問題なし）
//   ＋かたむき任意（optionalSensors:['motion']）。
// - スポーンは logic.ts（rng注入＝今日のゲームは全員同じ）。時間は ctx.now・setTimeout不使用。
// - import してよいのは game-api（types/helpers）と、このフォルダ内（logic）だけ
import type { GameContext, IGame } from '../../game-api/types';
import { clamp, elem, makeSeg } from '../../game-api/helpers';
import { ENEMY, enemySpeed, spawnInterval, waveSize, isBossWave, rollEnemyType, overlap, type Diff, type EnemyType } from './logic';

const W = 360;
const H = 640;
const SHIP_W = 34;
const SHIP_H = 30;
const SHIP_Y = H - 64;
const STEER_SPEED = 400;
const FIRE_MS = 240; // 自動連射の間隔
const PB_VY = -560; // 自機弾の速度
const EB_VY = 210; // 敵弾の速度
const SPREAD_MS = 8000; // 3way の持続
const INV_MS = 1200; // 被弾後の無敵
const WAVE_BONUS = 60;
const DROP_CHANCE = 0.14; // 撃墜時のパワーアップ出現率
const SCORE_HI = 3000; // score-hi 実績のしきい値（仮）
const END_DELAY = 1500;

type Mode = 'setup' | 'play' | 'over';
type PowKind = 'spread' | 'shield';
interface Config {
  diff: Diff;
}
interface Enemy {
  type: EnemyType;
  x: number;
  y: number;
  w: number;
  h: number;
  hp: number;
  shootAt: number;
  vx: number; // ボスの横移動
  entering: boolean; // ボスが定位置へ入るまで
}
interface Bullet {
  x: number;
  y: number;
  vx: number;
  vy: number;
  w: number;
  h: number;
}
interface Pow {
  kind: PowKind;
  x: number;
  y: number;
}
interface Pop {
  x: number;
  y: number;
  text: string;
  color: string;
  until: number;
}

export function createGame(ctx: GameContext): IGame {
  const cv = ctx.canvas2d({ design: { w: W, h: H } });
  const g = cv.ctx;

  const saved = ctx.load<Partial<Config>>('config');
  const config: Config = { diff: saved?.diff === 'easy' || saved?.diff === 'hard' ? saved.diff : 'normal' };

  // ---- 状態 ----
  let mode: Mode = 'setup';
  let hostPaused = false;
  let diff: Diff = config.diff;
  let shipX = W / 2;
  let steer = 0;
  let steerId = -1;
  let lives = 3;
  let score = 0;
  let kills = 0;
  let wave = 0;
  let toSpawn = 0;
  let spawnAt = 0;
  let fireAt = 0;
  let hitThisWave = false;
  let invUntil = 0;
  let shield = false;
  let spreadUntil = 0;
  let endAt = 0;
  let ended = false;
  const enemies: Enemy[] = [];
  const pbul: Bullet[] = [];
  const ebul: Bullet[] = [];
  const pows: Pow[] = [];
  const pops: Pop[] = [];

  const style = document.createElement('style');
  style.textContent = CSS;
  ctx.root.append(style);
  let setupEl: HTMLElement | null = null;

  const rand = (a: number, b: number): number => a + ctx.random() * (b - a);
  const invincible = (now: number): boolean => now < invUntil;
  const spreadOn = (now: number): boolean => now < spreadUntil;

  function setData(): void {
    // 検証用の状態公開（開発ビルド限定。本番では毎フレームの属性書き込みをしない）
    if (!import.meta.env.DEV) return;
    const r = ctx.root as HTMLElement;
    r.dataset.mode = mode;
    r.dataset.score = String(score);
    r.dataset.lives = String(lives);
    r.dataset.wave = String(wave);
    r.dataset.kills = String(kills);
    r.dataset.enemies = String(enemies.length);
    r.dataset.shipx = String(Math.round(shipX));
    r.dataset.shield = shield ? '1' : '0';
    r.dataset.spread = spreadOn(ctx.now()) ? '1' : '0';
    // 敵の中心x/yの一覧（自動プレイ検証用）
    r.dataset.enemypos = JSON.stringify(enemies.map((e) => [Math.round(e.x + e.w / 2), Math.round(e.y)]));
  }

  // ---- 設定画面 ----
  function showSetup(): void {
    mode = 'setup';
    setupEl = elem('div', 'sh-setup');
    setupEl.append(elem('h2', 'sh-h2', 'うちゅうシューティング 🚀'));
    setupEl.append(
      makeSeg(
        'sh',
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
    setupEl.append(elem('p', 'sh-note', '自機は じどうで 弾を撃つよ。画面の左半分・右半分を おして 動かし、敵👾を たおそう（かたむけてもOK）。敵に ぶつかる・下まで 通されると ライフが へる。3回で おしまい。'));
    const start = elem('button', 'sh-btn sh-btn-primary sh-btn-lg', 'スタート ▶') as HTMLButtonElement;
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
    shipX = W / 2;
    steer = 0;
    steerId = -1;
    lives = 3;
    score = 0;
    kills = 0;
    wave = 0;
    invUntil = 0;
    shield = false;
    spreadUntil = 0;
    ended = false;
    enemies.length = 0;
    pbul.length = 0;
    ebul.length = 0;
    pows.length = 0;
    pops.length = 0;
    mode = 'play';
    fireAt = ctx.now();
    beginWave(1);
    ctx.motion?.calibrate();
    setData();
  }

  function beginWave(w: number): void {
    wave = w;
    hitThisWave = false;
    if (w >= 5) ctx.achieve('wave-5');
    const now = ctx.now();
    if (isBossWave(w)) {
      const sp = ENEMY.boss;
      enemies.push({ type: 'boss', x: (W - sp.w) / 2, y: -sp.h, w: sp.w, h: sp.h, hp: sp.hp, shootAt: now + 1400, vx: 92, entering: true });
      toSpawn = 0;
    } else {
      toSpawn = waveSize(w);
    }
    spawnAt = now + 400;
  }

  function spawnEnemy(now: number): void {
    const type = rollEnemyType(ctx.random, diff, wave);
    const sp = ENEMY[type];
    enemies.push({
      type,
      x: 8 + ctx.random() * (W - 16 - sp.w),
      y: -sp.h,
      w: sp.w,
      h: sp.h,
      hp: sp.hp,
      shootAt: now + rand(1400, 3200),
      vx: 0,
      entering: false,
    });
  }

  function addPop(x: number, y: number, text: string, color: string): void {
    pops.push({ x, y, text, color, until: ctx.now() + 700 });
  }

  function fire(now: number): void {
    const cx = shipX;
    const top = SHIP_Y - 6;
    if (spreadOn(now)) {
      pbul.push({ x: cx - 3, y: top, vx: -150, vy: PB_VY, w: 6, h: 14 });
      pbul.push({ x: cx - 3, y: top, vx: 0, vy: PB_VY, w: 6, h: 14 });
      pbul.push({ x: cx - 3, y: top, vx: 150, vy: PB_VY, w: 6, h: 14 });
    } else {
      pbul.push({ x: cx - 3, y: top, vx: 0, vy: PB_VY, w: 6, h: 14 });
    }
    ctx.sfx('tick');
  }

  function enemyShoot(e: Enemy, now: number): void {
    const cx = e.x + e.w / 2;
    const y = e.y + e.h;
    if (e.type === 'boss') {
      ebul.push({ x: cx - 4, y, vx: -70, vy: EB_VY, w: 8, h: 12 });
      ebul.push({ x: cx - 4, y, vx: 0, vy: EB_VY, w: 8, h: 12 });
      ebul.push({ x: cx - 4, y, vx: 70, vy: EB_VY, w: 8, h: 12 });
      e.shootAt = now + rand(900, 1500);
    } else {
      ebul.push({ x: cx - 4, y, vx: 0, vy: EB_VY, w: 8, h: 12 });
      e.shootAt = now + rand(1800, 3600);
    }
  }

  function killEnemy(e: Enemy, idx: number): void {
    score += ENEMY[e.type].points;
    kills++;
    addPop(e.x + e.w / 2, e.y, `+${ENEMY[e.type].points}`, '#ffe27a');
    if (e.type === 'boss') {
      ctx.achieve('boss-down');
      ctx.sfx('medal');
      ctx.haptic('success');
    } else {
      ctx.sfx('tap');
    }
    if (kills >= 10) ctx.achieve('first-kill');
    if (score >= SCORE_HI) ctx.achieve('score-hi');
    if (ctx.random() < DROP_CHANCE) {
      pows.push({ kind: ctx.random() < 0.5 ? 'spread' : 'shield', x: e.x + e.w / 2 - 13, y: e.y });
    }
    enemies.splice(idx, 1);
  }

  function hitShip(now: number): void {
    if (invincible(now)) return;
    hitThisWave = true;
    if (shield) {
      shield = false;
      invUntil = now + INV_MS;
      ctx.sfx('fail');
      ctx.haptic('medium');
      return;
    }
    lives--;
    invUntil = now + INV_MS;
    ctx.sfx('fail');
    ctx.haptic('error');
    if (lives <= 0) gameOver(now);
  }

  function passLife(now: number): void {
    // 敵を下まで通した＝ライフ減（シールド/無敵は無関係）
    lives--;
    hitThisWave = true;
    ctx.sfx('fail');
    ctx.haptic('error');
    if (lives <= 0) gameOver(now);
  }

  function gameOver(now: number): void {
    if (mode !== 'play') return;
    mode = 'over';
    if (score >= SCORE_HI) ctx.achieve('score-hi');
    ctx.sfx('fail');
    ctx.haptic('error');
    endAt = now + END_DELAY;
    setData();
  }

  // ---- 入力（左右半分ホールド。onMove 非購読＝キャプチャなし）----
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
      updatePlay(dt, now);
      setData();
    }
    if (mode === 'over' && !ended && now >= endAt) {
      ended = true;
      ctx.end({ score });
    }
    draw(now);
  });

  function updatePlay(dt: number, now: number): void {
    // 自機移動
    const dir = clamp(steer + (ctx.motion?.tilt.x ?? 0), -1, 1);
    shipX = clamp(shipX + dir * STEER_SPEED * dt, SHIP_W / 2 + 4, W - SHIP_W / 2 - 4);

    // 自動連射
    if (now >= fireAt) {
      fire(now);
      fireAt = now + FIRE_MS;
    }

    // 自機弾
    for (let i = pbul.length - 1; i >= 0; i--) {
      const b = pbul[i]!;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (b.y < -20 || b.x < -20 || b.x > W + 20) pbul.splice(i, 1);
    }
    // 敵弾
    for (let i = ebul.length - 1; i >= 0; i--) {
      const b = ebul[i]!;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (b.y > H + 20) {
        ebul.splice(i, 1);
        continue;
      }
      if (overlap(shipX - SHIP_W / 2, SHIP_Y, SHIP_W, SHIP_H, b.x, b.y, b.w, b.h)) {
        ebul.splice(i, 1);
        hitShip(now);
        if (lives <= 0) return;
      }
    }

    // 敵の移動・射撃・当たり
    const spd = enemySpeed(diff, wave);
    for (let i = enemies.length - 1; i >= 0; i--) {
      const e = enemies[i]!;
      if (e.type === 'boss') {
        if (e.entering) {
          e.y += spd * dt;
          if (e.y >= 54) e.entering = false;
        } else {
          e.x += e.vx * dt;
          if (e.x <= 8) {
            e.x = 8;
            e.vx = Math.abs(e.vx);
          } else if (e.x + e.w >= W - 8) {
            e.x = W - 8 - e.w;
            e.vx = -Math.abs(e.vx);
          }
        }
      } else {
        e.y += spd * dt;
      }
      // 射撃
      if (now >= e.shootAt && e.y > 0 && e.y < H * 0.62) enemyShoot(e, now);
      // 自機との衝突
      if (overlap(shipX - SHIP_W / 2, SHIP_Y, SHIP_W, SHIP_H, e.x, e.y, e.w, e.h)) {
        if (e.type !== 'boss') enemies.splice(i, 1);
        hitShip(now);
        if (lives <= 0) return;
        continue;
      }
      // 下端に抜けた（ボス以外）
      if (e.type !== 'boss' && e.y > H) {
        enemies.splice(i, 1);
        passLife(now);
        if (lives <= 0) return;
      }
    }

    // 自機弾 vs 敵
    for (let i = pbul.length - 1; i >= 0; i--) {
      const b = pbul[i];
      if (!b) continue;
      for (let j = enemies.length - 1; j >= 0; j--) {
        const e = enemies[j]!;
        if (overlap(b.x, b.y, b.w, b.h, e.x, e.y, e.w, e.h)) {
          pbul.splice(i, 1);
          e.hp--;
          if (e.hp <= 0) killEnemy(e, j);
          break;
        }
      }
    }

    // パワーアップ
    for (let i = pows.length - 1; i >= 0; i--) {
      const p = pows[i]!;
      p.y += 120 * dt;
      if (p.y > H) {
        pows.splice(i, 1);
        continue;
      }
      if (overlap(shipX - SHIP_W / 2, SHIP_Y, SHIP_W, SHIP_H, p.x, p.y, 26, 26)) {
        if (p.kind === 'spread') spreadUntil = now + SPREAD_MS;
        else shield = true;
        addPop(p.x + 13, p.y, p.kind === 'spread' ? '3WAY!' : 'シールド!', '#7ef0c0');
        ctx.achieve('powerup');
        ctx.sfx('powerup');
        ctx.haptic('success');
        pows.splice(i, 1);
      }
    }

    // 得点ポップ寿命
    for (let i = pops.length - 1; i >= 0; i--) {
      const p = pops[i];
      if (p && now >= p.until) pops.splice(i, 1);
    }

    // ウェーブ進行（全部たおして残りスポーンもゼロ＝クリア）
    if (lives > 0 && toSpawn === 0 && enemies.length === 0) {
      score += WAVE_BONUS;
      if (score >= SCORE_HI) ctx.achieve('score-hi'); // ボーナスで閾値を跨いでも取りこぼさない
      addPop(W / 2, H / 2, `ウェーブ ${wave} クリア！ +${WAVE_BONUS}`, '#ffffff');
      if (!hitThisWave) ctx.achieve('no-hit-wave');
      beginWave(wave + 1);
    } else if (toSpawn > 0 && now >= spawnAt) {
      spawnEnemy(now);
      toSpawn--;
      spawnAt = now + spawnInterval(diff, wave);
    }
  }

  // ---- 描画 ----
  let starPhase = 0;
  function draw(now: number): void {
    // 宇宙背景（固定色＝テーマ非依存）
    const grd = g.createLinearGradient(0, 0, 0, H);
    grd.addColorStop(0, '#0a0e2a');
    grd.addColorStop(1, '#1a1040');
    g.fillStyle = grd;
    g.fillRect(0, 0, W, H);
    // 星（ゆっくり流れる）
    if (mode === 'play') starPhase = (starPhase + 40 * (1 / 60)) % 40;
    g.fillStyle = 'rgba(255,255,255,.5)';
    for (let i = 0; i < 26; i++) {
      const sx = (i * 53) % W;
      const sy = (i * 97 + starPhase * (1 + (i % 3))) % H;
      g.fillRect(sx, sy, 2, 2);
    }

    g.textAlign = 'center';
    g.textBaseline = 'middle';

    // パワーアップ
    for (const p of pows) {
      g.font = '24px serif';
      g.fillText(p.kind === 'spread' ? '💊' : '🛡️', p.x + 13, p.y + 13);
    }
    // 敵
    for (const e of enemies) {
      g.font = `${Math.round(e.h * 0.9)}px serif`;
      g.fillText(ENEMY[e.type].emoji, e.x + e.w / 2, e.y + e.h / 2);
      if (e.type === 'boss') {
        // ボスHPバー
        g.fillStyle = 'rgba(255,255,255,.25)';
        g.fillRect(e.x, e.y - 8, e.w, 4);
        g.fillStyle = '#ff5b7a';
        g.fillRect(e.x, e.y - 8, e.w * (e.hp / ENEMY.boss.hp), 4);
      }
    }
    // 自機弾
    g.fillStyle = '#ffe27a';
    for (const b of pbul) g.fillRect(b.x, b.y, b.w, b.h);
    // 敵弾
    g.fillStyle = '#ff617a';
    for (const b of ebul) g.fillRect(b.x, b.y, b.w, b.h);

    // 自機（無敵中は点滅）
    const blink = invincible(now) && Math.floor(now / 90) % 2 === 0;
    if (!blink) {
      if (shield) {
        g.strokeStyle = 'rgba(126,240,192,.9)';
        g.lineWidth = 2;
        g.beginPath();
        g.arc(shipX, SHIP_Y + SHIP_H / 2, SHIP_W, 0, Math.PI * 2);
        g.stroke();
      }
      drawShip(shipX, SHIP_Y, SHIP_W, SHIP_H);
    }

    // 得点ポップ
    for (const p of pops) {
      const t = clamp((p.until - now) / 700, 0, 1);
      g.globalAlpha = t;
      g.fillStyle = p.color;
      g.font = 'bold 18px sans-serif';
      g.fillText(p.text, p.x, p.y - (1 - t) * 22);
    }
    g.globalAlpha = 1;

    drawHud();
    drawSteerHints();

    if (mode === 'over') {
      g.fillStyle = 'rgba(10,14,42,.78)';
      g.fillRect(0, 0, W, H);
      g.fillStyle = '#fff';
      g.textAlign = 'center';
      g.font = 'bold 36px sans-serif';
      g.fillText('ゲームオーバー', W / 2, H / 2 - 24);
      g.font = 'bold 24px sans-serif';
      g.fillText(`${score} 点`, W / 2, H / 2 + 20);
      g.font = 'bold 18px sans-serif';
      g.fillText(`ウェーブ ${wave}・${kills}体`, W / 2, H / 2 + 52);
    }
  }

  function drawHud(): void {
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.font = '20px serif';
    for (let i = 0; i < 3; i++) {
      g.globalAlpha = i < lives ? 1 : 0.25;
      g.fillText('❤️', 10 + i * 24, 22);
    }
    g.globalAlpha = 1;
    g.fillStyle = '#fff';
    g.font = 'bold 20px sans-serif';
    g.fillText(`${score}`, 10, 50);
    g.font = 'bold 13px sans-serif';
    g.fillText(`ウェーブ ${Math.max(wave, 1)}`, 10, 74);
  }

  function drawSteerHints(): void {
    g.globalAlpha = 0.16;
    g.fillStyle = '#fff';
    g.textAlign = 'center';
    g.textBaseline = 'alphabetic';
    g.font = 'bold 40px sans-serif';
    g.fillText('◀', W * 0.16, H - 20);
    g.fillText('▶', W * 0.84, H - 20);
    g.globalAlpha = 1;
  }

  // 上向きの自作自機（三角のアーケード風シップ）
  function drawShip(cx: number, topY: number, w: number, h: number): void {
    const x = cx - w / 2;
    g.fillStyle = '#2f7fb8'; // 主翼
    g.beginPath();
    g.moveTo(x, topY + h);
    g.lineTo(cx, topY + h * 0.5);
    g.lineTo(x + w, topY + h);
    g.closePath();
    g.fill();
    g.fillStyle = '#5fd0ff'; // 機体（上向き）
    g.beginPath();
    g.moveTo(cx, topY);
    g.lineTo(x + w * 0.82, topY + h * 0.9);
    g.lineTo(cx, topY + h * 0.72);
    g.lineTo(x + w * 0.18, topY + h * 0.9);
    g.closePath();
    g.fill();
    g.fillStyle = '#ffffff'; // コックピット
    g.beginPath();
    g.arc(cx, topY + h * 0.42, w * 0.12, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#ffb03a'; // 噴射
    g.fillRect(cx - 3, topY + h * 0.86, 6, 6);
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
// スタイル（.sh- プレフィックス。設定画面のみDOM・プレイはCanvas）
// =============================================================
const CSS = `
.sh-setup{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:safe center;
  gap:14px;padding:20px 16px;box-sizing:border-box;overflow-y:auto;user-select:none;-webkit-user-select:none;
  background:var(--bg)}
.sh-h2{margin:4px 0;font-size:22px;text-align:center}
.sh-seg-row{width:min(92vw,420px);display:flex;flex-direction:column;gap:6px}
.sh-seg-label{font-size:13px;color:var(--text-dim);font-weight:800}
.sh-seg{display:flex;background:var(--bg-elev2);border-radius:12px;padding:3px;gap:2px}
.sh-seg-btn{flex:1;border:none;background:none;color:var(--text-dim);padding:10px 2px;border-radius:9px;
  font-size:14px;font-weight:800;min-height:44px}
.sh-seg-btn.sh-on{background:var(--accent);color:#fff}
.sh-note{font-size:12px;color:var(--text-dim);text-align:center;max-width:min(92vw,420px);margin:0;line-height:1.7}
.sh-btn{appearance:none;border:none;border-radius:12px;padding:12px 18px;font-size:15px;font-weight:800;font-family:inherit;
  background:var(--bg-elev2);color:var(--text);min-height:44px}
.sh-btn-primary{background:var(--accent-grad);color:#fff}
.sh-btn-lg{width:100%;max-width:300px;font-size:18px}
`;
