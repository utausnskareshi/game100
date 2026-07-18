// =============================================================
// エレベーターさばき（No.71）: 行きたい階へ みんなを はこぼう！90秒の運行マネジメント
// =============================================================
// - 階（よこの列）をタップ→エレベーターがその階へ。とうちゃくすると ドアが開いて
//   おりる→のる（定員3・ならんだ順）。お客さんの あたまの数字が 行き先階。
//   がまんゲージが切れると 帰ってしまう。90秒で なん人 はこべるかな？
// - 出現抽選・定数は logic.ts（純ロジック・rng注入）。
// - 全画面 Canvas・onTap のみ。時間は ctx.now 期限方式・setTimeout 不使用。
// - import してよいのは game-api（types / helpers）と、このフォルダ内（logic）だけ
import type { GameContext, IGame } from '../../game-api/types';
import {
  CAPACITY,
  CAR_SPEED,
  DELIVER_PTS,
  DOOR_MS,
  FLOORS,
  HAPPY_PTS,
  HAPPY_RATIO,
  PATIENCE_MS,
  SESSION_MS,
  rollPassenger,
  spawnInterval,
} from './logic';

const W = 360;
const H = 640;
const HUD_H = 44;
const FLOOR_H = 94;
const TOP_Y = 64; // 5階の天井
const SHAFT_X = 22;
const SHAFT_W = 92;
const CAR_W = 76;
const CAR_H = 78;
const END_DELAY = 1800;
const SCORE_HI = 1000;
const LEAVE_ANIM_MS = 900;

type Mode = 'play' | 'over';

interface Passenger {
  id: number;
  floor: number;
  dest: number;
  face: string;
  spawnAt: number;
  state: 'wait' | 'ride' | 'leaving';
  leaveAt: number;
  /** 乗った時点のがまん残り（ごきげん判定用） */
  patienceLeft: number;
}

export function createGame(ctx: GameContext): IGame {
  const cv = ctx.canvas2d({ design: { w: W, h: H } });
  const g = cv.ctx;

  let mode: Mode = 'play';
  let hostPaused = false;
  let t0 = 0;
  let nextSpawnAt = 0;
  let nextId = 1;
  let waiting: Passenger[] = []; // 全階のならび（spawnAt順）
  let riders: Passenger[] = [];
  let leaving: Passenger[] = [];
  let carFloor = 1; // 連続値（1..5）
  let targetFloor = 1;
  let doorUntil = 0;
  let delivered = 0;
  let happyCount = 0;
  let leaves = 0;
  let score = 0;
  let popup: { text: string; x: number; y: number; until: number } | null = null;
  let endAt = 0;
  let ended = false;

  /** 階の中央 y（描画・タップ共通） */
  const floorMidY = (f: number): number => TOP_Y + (FLOORS - f) * FLOOR_H + FLOOR_H / 2;
  const floorBaseY = (f: number): number => TOP_Y + (FLOORS - f + 1) * FLOOR_H;

  function addScore(n: number): void {
    score += n;
    if (score >= SCORE_HI) ctx.achieve('score-hi');
  }

  function patienceLeftOf(p: Passenger, now: number): number {
    return Math.max(0, 1 - (now - p.spawnAt) / PATIENCE_MS);
  }

  function openDoorAt(f: number, now: number): void {
    doorUntil = now + DOOR_MS;
    // おりる
    const out = riders.filter((r) => r.dest === f);
    riders = riders.filter((r) => r.dest !== f);
    for (const p of out) {
      delivered++;
      const happy = p.patienceLeft >= HAPPY_RATIO;
      const pts = DELIVER_PTS + (happy ? HAPPY_PTS : 0);
      if (happy) {
        happyCount++;
        if (happyCount >= 5) ctx.achieve('happy-5');
      }
      addScore(pts);
      ctx.achieve('first-ride');
      if (delivered >= 10) ctx.achieve('deliver-10');
      if (delivered >= 15 && leaves === 0) ctx.achieve('no-leave');
      popup = { text: `+${pts}`, x: SHAFT_X + SHAFT_W + 30, y: floorMidY(f), until: now + 700 };
      ctx.sfx('success');
      ctx.haptic('light');
    }
    // のる（ならんだ順・定員まで）
    const queue = waiting.filter((p) => p.floor === f);
    for (const p of queue) {
      if (riders.length >= CAPACITY) break;
      p.state = 'ride';
      p.patienceLeft = patienceLeftOf(p, now);
      riders.push(p);
      ctx.sfx('tap');
    }
    waiting = waiting.filter((p) => p.state === 'wait');
    if (riders.length >= CAPACITY) ctx.achieve('full-car');
  }

  // ---- 入力（階をタップ）----
  const offTap = ctx.input.onTap((p) => {
    if (hostPaused || mode !== 'play') return;
    const l = cv.toLocal(p);
    if (l.y < TOP_Y || l.y > TOP_Y + FLOORS * FLOOR_H) return;
    const f = FLOORS - Math.floor((l.y - TOP_Y) / FLOOR_H);
    if (f < 1 || f > FLOORS) return;
    const now = ctx.now();
    // いまいる階を再タップ＝ドアを開けて 乗り降り（1階スタートのお客も拾える）
    if (f === targetFloor && Math.abs(carFloor - f) < 0.02 && now >= doorUntil) {
      openDoorAt(f, now);
      return;
    }
    if (f !== targetFloor) {
      targetFloor = f;
      ctx.sfx('tick');
    }
  });

  // ---- 毎フレーム ----
  const offFrame = ctx.onFrame((dt) => {
    if (hostPaused) return;
    const now = ctx.now();
    const t = now - t0;
    if (mode === 'play') {
      // 出現
      if (now >= nextSpawnAt) {
        const roll = rollPassenger(ctx.random);
        waiting.push({
          id: nextId++,
          floor: roll.floor,
          dest: roll.dest,
          face: roll.face,
          spawnAt: now,
          state: 'wait',
          leaveAt: 0,
          patienceLeft: 1,
        });
        nextSpawnAt = now + spawnInterval(t);
      }
      // がまん切れ
      for (const p of waiting) {
        if (now - p.spawnAt >= PATIENCE_MS) {
          p.state = 'leaving';
          p.leaveAt = now;
          leaves++;
          leaving.push(p);
          ctx.sfx('fail');
        }
      }
      waiting = waiting.filter((p) => p.state === 'wait');
      leaving = leaving.filter((p) => now - p.leaveAt < LEAVE_ANIM_MS);
      // エレベーター移動（ドアが閉まっているとき）
      if (now >= doorUntil) {
        const diff = targetFloor - carFloor;
        if (Math.abs(diff) < 0.02) {
          if (carFloor !== targetFloor) carFloor = targetFloor;
          // ちょうど到着した瞬間だけドアを開ける
        } else {
          const step = Math.sign(diff) * CAR_SPEED * dt;
          const before = carFloor;
          carFloor += step;
          if ((before < targetFloor && carFloor >= targetFloor) || (before > targetFloor && carFloor <= targetFloor)) {
            carFloor = targetFloor;
            openDoorAt(targetFloor, now);
          }
        }
      }
      // 時間切れ
      if (t >= SESSION_MS) {
        mode = 'over';
        endAt = now + END_DELAY;
        ctx.sfx('medal');
      }
    } else if (mode === 'over') {
      if (!ended && now >= endAt) {
        ended = true;
        ctx.end({ score });
        return;
      }
    }
    draw(now);
    setData(now);
  });

  function setData(now: number): void {
    if (!import.meta.env.DEV) return;
    const r = ctx.root as HTMLElement;
    r.dataset.mode = mode;
    r.dataset.score = String(score);
    r.dataset.delivered = String(delivered);
    r.dataset.happy = String(happyCount);
    r.dataset.leaves = String(leaves);
    r.dataset.carfloor = carFloor.toFixed(2);
    r.dataset.target = String(targetFloor);
    r.dataset.dooropen = now < doorUntil ? '1' : '0';
    r.dataset.riders = riders.map((p) => `${p.dest}:${p.patienceLeft.toFixed(2)}`).join(',');
    r.dataset.waiting = waiting.map((p) => `${p.floor}>${p.dest}@${patienceLeftOf(p, now).toFixed(2)}`).join(';');
    r.dataset.timeleft = String(Math.max(0, Math.round(SESSION_MS - (now - t0))));
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
    // そとがわ
    g.fillStyle = '#cfe4f2';
    g.fillRect(0, 0, W, H);
    // ビル
    g.fillStyle = '#f4ede0';
    g.fillRect(8, TOP_Y - 10, W - 16, FLOORS * FLOOR_H + 20);
    g.fillStyle = '#e0d6c4';
    g.fillRect(8, TOP_Y - 10, W - 16, 10);

    // 各階
    for (let f = FLOORS; f >= 1; f--) {
      const yTop = TOP_Y + (FLOORS - f) * FLOOR_H;
      const base = floorBaseY(f);
      // ゆか
      g.fillStyle = '#c8b898';
      g.fillRect(8, base - 6, W - 16, 6);
      // かべ色（交互）
      g.fillStyle = f % 2 === 0 ? 'rgba(90,140,190,.06)' : 'rgba(190,150,90,.06)';
      g.fillRect(SHAFT_X + SHAFT_W, yTop, W - SHAFT_X - SHAFT_W - 10, FLOOR_H - 6);
      // 階数プレート
      g.fillStyle = targetFloor === f ? '#e08a2a' : '#8a9ab0';
      roundRect(SHAFT_X + SHAFT_W + 6, yTop + 8, 40, 24, 6);
      g.fill();
      g.fillStyle = '#fff';
      g.font = 'bold 14px sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(`${f}F`, SHAFT_X + SHAFT_W + 26, yTop + 20);
      if (targetFloor === f) {
        g.fillStyle = '#e08a2a';
        g.font = 'bold 12px sans-serif';
        g.fillText('▶ いくよ', SHAFT_X + SHAFT_W + 80, yTop + 20);
      }
    }

    // シャフト
    g.fillStyle = '#3a4252';
    g.fillRect(SHAFT_X, TOP_Y - 10, SHAFT_W, FLOORS * FLOOR_H + 20);
    g.strokeStyle = 'rgba(255,255,255,.18)';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(SHAFT_X + 10, TOP_Y - 6);
    g.lineTo(SHAFT_X + 10, TOP_Y + FLOORS * FLOOR_H + 6);
    g.moveTo(SHAFT_X + SHAFT_W - 10, TOP_Y - 6);
    g.lineTo(SHAFT_X + SHAFT_W - 10, TOP_Y + FLOORS * FLOOR_H + 6);
    g.stroke();

    // エレベーターかご
    const carBase = floorBaseY(carFloor) - 6;
    const carX = SHAFT_X + (SHAFT_W - CAR_W) / 2;
    const carY = carBase - CAR_H;
    g.fillStyle = '#dfe6ee';
    roundRect(carX, carY, CAR_W, CAR_H, 8);
    g.fill();
    g.strokeStyle = '#9aa8ba';
    g.lineWidth = 2.5;
    roundRect(carX, carY, CAR_W, CAR_H, 8);
    g.stroke();
    // ドア（開閉）
    const doorOpen = now < doorUntil;
    const slide = doorOpen ? Math.min(1, (doorUntil - now) / DOOR_MS < 0.15 ? (doorUntil - now) / DOOR_MS / 0.15 : 1) : 0;
    g.fillStyle = '#b8c4d4';
    const half = CAR_W / 2 - 3;
    g.fillRect(carX + 3 - slide * half, carY + 8, half, CAR_H - 16);
    g.fillRect(carX + CAR_W / 2 + slide * half, carY + 8, half, CAR_H - 16);
    // 乗客（かごの中）
    g.font = '20px sans-serif';
    g.textAlign = 'center';
    for (let i = 0; i < riders.length; i++) {
      const rx = carX + 16 + i * 22;
      const ry = carY + CAR_H - 20;
      g.fillText(riders[i]!.face, rx, ry);
      g.fillStyle = '#e05a2a';
      g.font = 'bold 11px sans-serif';
      g.fillText(String(riders[i]!.dest), rx + 9, ry - 16);
      g.font = '20px sans-serif';
      g.fillStyle = '#000';
    }

    // まっているお客さん
    for (let f = 1; f <= FLOORS; f++) {
      const q = waiting.filter((p) => p.floor === f);
      const base = floorBaseY(f) - 8;
      for (let i = 0; i < Math.min(q.length, 4); i++) {
        const p = q[i]!;
        const x = SHAFT_X + SHAFT_W + 42 + i * 52;
        g.font = '26px sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'alphabetic';
        g.fillText(p.face, x, base);
        // 行き先バブル
        g.fillStyle = '#fff';
        g.strokeStyle = '#8a9ab0';
        g.lineWidth = 1.5;
        g.beginPath();
        g.arc(x + 14, base - 30, 9, 0, Math.PI * 2);
        g.fill();
        g.stroke();
        g.fillStyle = '#3a5a8c';
        g.font = 'bold 12px sans-serif';
        g.textBaseline = 'middle';
        g.fillText(String(p.dest), x + 14, base - 29);
        // がまんゲージ
        const left = patienceLeftOf(p, now);
        g.fillStyle = 'rgba(0,0,0,.15)';
        g.fillRect(x - 16, base + 4, 32, 4);
        g.fillStyle = left > 0.5 ? '#66bb6a' : left > 0.25 ? '#e8b23c' : '#e05a4e';
        g.fillRect(x - 16, base + 4, 32 * left, 4);
      }
      if (q.length > 4) {
        g.fillStyle = '#6a7a90';
        g.font = 'bold 13px sans-serif';
        g.fillText(`+${q.length - 4}`, SHAFT_X + SHAFT_W + 42 + 4 * 52, base - 8);
      }
    }

    // 帰ってしまうお客さん
    for (const p of leaving) {
      const t = (now - p.leaveAt) / LEAVE_ANIM_MS;
      const base = floorBaseY(p.floor) - 8;
      g.globalAlpha = 1 - t;
      g.font = '26px sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'alphabetic';
      g.fillText(p.face, W - 40 + t * 30, base);
      g.font = '14px sans-serif';
      g.fillText('💢', W - 24 + t * 30, base - 24);
      g.globalAlpha = 1;
    }

    // ポップアップ
    if (popup && now < popup.until) {
      const pr = (popup.until - now) / 700;
      g.globalAlpha = Math.min(1, pr * 2);
      g.fillStyle = '#e05a2a';
      g.font = 'bold 18px sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(popup.text, popup.x, popup.y - (1 - pr) * 18);
      g.globalAlpha = 1;
    }

    // 下のヒント
    g.fillStyle = 'rgba(40,60,90,.75)';
    g.font = 'bold 14px sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('いきたい「かい」をタップ → おむかえ＆おとどけ！', W / 2, 604);
    g.font = 'bold 12px sans-serif';
    g.fillText('あたまの数字が 行き先。ゲージが切れると 帰っちゃう…', W / 2, 624);

    // HUD
    g.fillStyle = 'rgba(24,36,56,.9)';
    g.fillRect(0, 0, W, HUD_H);
    g.textAlign = 'left';
    g.fillStyle = '#fff';
    g.font = 'bold 19px sans-serif';
    g.fillText(`${score}てん`, 12, HUD_H / 2);
    const remain = Math.max(0, Math.ceil((SESSION_MS - (now - t0)) / 1000));
    g.fillStyle = remain <= 10 ? '#ff9a8a' : '#cfe0ff';
    g.font = 'bold 17px sans-serif';
    g.fillText(`⏱${remain}`, 122, HUD_H / 2);
    g.fillStyle = '#ffe0b0';
    g.fillText(`🙂${delivered}人`, 200, HUD_H / 2);

    if (mode === 'over') {
      g.fillStyle = 'rgba(14,24,40,.74)';
      g.fillRect(0, 0, W, H);
      g.fillStyle = '#fff';
      g.textAlign = 'center';
      g.font = 'bold 30px sans-serif';
      g.fillText('おつかれさま！', W / 2, H / 2 - 40);
      g.font = 'bold 22px sans-serif';
      g.fillText(`${delivered}人 はこんで ${score}てん`, W / 2, H / 2 + 6);
    }
  }

  draw(0);
  setData(0);

  return {
    start() {
      t0 = ctx.now();
      nextSpawnAt = t0 + 900;
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
