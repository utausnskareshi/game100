// =============================================================
// でんしゃポイントさばき（No.76）: ポイントを切りかえて 電車を同じ色のホームへ！
// =============================================================
// - 操作はタップだけ: 分岐（ポイント）をタップすると 進路が切りかわる。
//   電車は「分岐を通過した瞬間」のポイント向きへ進む。90秒・ライフ3。
// - 誤配（ちがう色のホーム）と追突（同じ線路で近づきすぎ）でライフ−1。
//   スポーナーの公平性ルール（logic.ts）により、正しくさばけば追突は起きない。
// - 線路・スポーナー・採点は logic.ts（乱数は ctx.random 注入＝完全決定論）。
// - 全画面 Canvas・時間は ctx.now 期限方式・setTimeout 不使用。
// - import してよいのは game-api（types / helpers）と、このフォルダ内（logic）だけ
import type { GameContext, IGame } from '../../game-api/types';
import {
  CRASH_GAP,
  ENTRY_SPEED,
  EXPRESS_SPEED,
  GAME_SEC,
  H,
  JUNCTIONS,
  LIVES,
  LOCAL_SPEED,
  NEXT,
  NO_MISS_BONUS,
  PLATFORM_X,
  SEGS,
  SPAWN_UNTIL,
  type SegId,
  W,
  deliveryPoints,
  pointAt,
  rollSpawn,
  spawnInterval,
} from './logic';

const HUD_H = 40;
const END_DELAY = 2200;
const SCORE_HI = 900; // 実績「たつじん」の閾値（ボット較正済み・実機要調整）
const DELIVER_ACH = 15;
const COMBO_ACH = 8;
const TAP_R = 44; // 分岐のタップ判定半径

const COLORS = ['#e0483c', '#3d7df0', '#f2b63c', '#3a9d54'];

type Phase = 'play' | 'over';

interface Train {
  seg: SegId;
  dist: number;
  color: number;
  kind: 'local' | 'express';
  gold: boolean;
  done?: boolean;
}

interface FloatFx {
  x: number;
  y: number;
  text: string;
  color: string;
  until: number;
  big?: boolean;
}

export function createGame(ctx: GameContext): IGame {
  const cv = ctx.canvas2d({ design: { w: W, h: H } });
  const g = cv.ctx;

  let phase: Phase = 'play';
  let started = false;
  let hostPaused = false;
  let t0 = 0;
  let trains: Train[] = [];
  const sw: [number, number, number] = [0, 0, 0]; // 0=ひだり / 1=みぎ
  let nextSpawnAt = 0.8;
  let prevSpawn: { color: number; kind: 'local' | 'express'; at: number } | null = null;
  let score = 0;
  let combo = 0;
  let delivered = 0;
  let wrongCount = 0;
  let crashCount = 0;
  let lives = LIVES;
  let noMissBonus = 0;
  let effects: FloatFx[] = [];
  const flashUntil: [number, number, number] = [0, 0, 0];
  const platPulse: [number, number, number, number] = [0, 0, 0, 0];
  let endAt = 0;
  let ended = false;
  let lastEvent = '';

  const elapsed = (): number => (started ? (ctx.now() - t0) / 1000 : 0);

  function addScore(n: number): void {
    score += n;
    if (score >= SCORE_HI) ctx.achieve('score-hi');
  }

  function gameOver(now: number): void {
    phase = 'over';
    endAt = now + END_DELAY;
  }

  function resolveDock(tr: Train, p: number, now: number): void {
    tr.done = true;
    const px = PLATFORM_X[p] ?? 0;
    if (tr.color === p) {
      combo++;
      const pts = deliveryPoints(tr.kind, tr.gold, combo);
      addScore(pts);
      delivered++;
      ctx.achieve('first-delivery');
      if (delivered >= DELIVER_ACH) ctx.achieve('deliver-15');
      if (combo >= COMBO_ACH) ctx.achieve('combo-8');
      if (tr.gold) ctx.achieve('gold-train');
      effects.push({ x: px, y: 540, text: `+${pts}`, color: tr.gold ? '#ffd54a' : '#8affc0', until: now + 900 });
      platPulse[p as 0 | 1 | 2 | 3] = now + 450;
      ctx.sfx(tr.gold ? 'medal' : combo >= 5 ? 'combo' : 'success');
      ctx.haptic('light');
      lastEvent = `dock:${p}:ok:${pts}`;
    } else {
      lives--;
      combo = 0;
      wrongCount++;
      effects.push({ x: px, y: 534, text: '❌ いきさきちがい', color: '#ff8a8a', until: now + 1100, big: true });
      ctx.sfx('fail');
      ctx.haptic('error');
      lastEvent = `dock:${p}:ng`;
    }
  }

  function update(dt: number, now: number): void {
    const t = elapsed();
    // スポーン（判定は「予定時刻 < SPAWN_UNTIL」＝フレーム割りに依存しない）
    while (nextSpawnAt < SPAWN_UNTIL && t >= nextSpawnAt) {
      const spec = rollSpawn(ctx.random, nextSpawnAt, prevSpawn, nextSpawnAt);
      trains.push({ seg: 'E', dist: 0, color: spec.color, kind: spec.kind, gold: spec.gold });
      prevSpawn = { color: spec.color, kind: spec.kind, at: nextSpawnAt };
      nextSpawnAt += spawnInterval(ctx.random, nextSpawnAt);
    }
    // 電車を進める（分岐は通過した瞬間のポイント向き）
    for (const tr of trains) {
      const v = tr.seg === 'E' ? ENTRY_SPEED : tr.kind === 'express' ? EXPRESS_SPEED : LOCAL_SPEED;
      tr.dist += v * dt;
      while (!tr.done && tr.dist >= SEGS[tr.seg].len) {
        const nx = NEXT[tr.seg];
        if ('platform' in nx) {
          resolveDock(tr, nx.platform, now);
        } else {
          tr.dist -= SEGS[tr.seg].len;
          tr.seg = sw[nx.j] === 0 ? nx.left : nx.right;
        }
      }
    }
    // 追突（同一区間で近づきすぎ）
    const bySeg = new Map<SegId, Train[]>();
    for (const tr of trains) {
      if (tr.done) continue;
      const list = bySeg.get(tr.seg);
      if (list) list.push(tr);
      else bySeg.set(tr.seg, [tr]);
    }
    for (const [, list] of bySeg) {
      list.sort((a, b) => a.dist - b.dist);
      for (let i = 0; i < list.length - 1; i++) {
        const rear = list[i]!;
        const front = list[i + 1]!;
        if (!rear.done && !front.done && front.dist - rear.dist < CRASH_GAP) {
          rear.done = true;
          front.done = true;
          crashCount++;
          lives--;
          combo = 0;
          const p = pointAt(SEGS[front.seg], front.dist);
          effects.push({ x: p.x, y: p.y, text: '💥 がっしゃん！', color: '#ff8a8a', until: now + 1100, big: true });
          ctx.sfx('fail');
          ctx.haptic('error');
          lastEvent = 'crash';
        }
      }
    }
    trains = trains.filter((tr) => !tr.done);
    if (lives <= 0) {
      gameOver(now);
      return;
    }
    if (t >= GAME_SEC && trains.length === 0) {
      if (lives === LIVES) {
        noMissBonus = NO_MISS_BONUS;
        addScore(NO_MISS_BONUS);
        ctx.achieve('no-miss');
      }
      gameOver(now);
    }
  }

  // ---- 入力（分岐タップで切替）----
  const offDown = ctx.input.onDown((p) => {
    if (hostPaused || !started || phase !== 'play') return;
    const l = cv.toLocal(p);
    let hit = -1;
    for (let j = 0; j < JUNCTIONS.length; j++) {
      const jp = JUNCTIONS[j]!;
      if (Math.hypot(l.x - jp.x, l.y - jp.y) <= TAP_R) {
        hit = j;
        break;
      }
    }
    if (hit >= 0) {
      const idx = hit as 0 | 1 | 2;
      sw[idx] = sw[idx] === 0 ? 1 : 0;
      flashUntil[idx] = ctx.now() + 260;
      ctx.sfx('tick');
      ctx.haptic('light');
    }
  });

  // ---- 毎フレーム ----
  const offFrame = ctx.onFrame((dt) => {
    if (hostPaused) return;
    const now = ctx.now();
    if (started && phase === 'play') update(dt, now);
    if (phase === 'over' && !ended && now >= endAt) {
      ended = true;
      ctx.end({ score });
      return;
    }
    effects = effects.filter((e) => e.until > now);
    draw(now);
    setData();
  });

  function setData(): void {
    if (!import.meta.env.DEV) return;
    const r = ctx.root as HTMLElement;
    r.dataset.phase = phase;
    r.dataset.score = String(score);
    r.dataset.lives = String(lives);
    r.dataset.combo = String(combo);
    r.dataset.delivered = String(delivered);
    r.dataset.wrong = String(wrongCount);
    r.dataset.crashed = String(crashCount);
    r.dataset.timeleft = String(Math.ceil(Math.max(0, GAME_SEC - elapsed())));
    r.dataset.sw = sw.join(',');
    r.dataset.trains = trains
      .map((tr) => `${tr.seg}:${tr.dist.toFixed(1)}:${tr.color}:${tr.kind === 'express' ? 'x' : 'l'}:${tr.gold ? 1 : 0}`)
      .join(';');
    r.dataset.last = lastEvent;
    r.dataset.t = elapsed().toFixed(2);
  }

  // ---- 描画 ----
  // 静的レイヤー（草地・線路・ホーム）は オフスクリーンに1回だけ焼く（maze 方式）
  const off = document.createElement('canvas');
  off.width = W * 2;
  off.height = H * 2;
  const og = off.getContext('2d');

  function roundRectPath(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  function drawShape(c: CanvasRenderingContext2D, kind: number, x: number, y: number, s: number, color: string): void {
    c.fillStyle = color;
    c.beginPath();
    if (kind === 0) {
      c.arc(x, y, s, 0, Math.PI * 2);
    } else if (kind === 1) {
      c.moveTo(x, y - s);
      c.lineTo(x + s, y + s * 0.85);
      c.lineTo(x - s, y + s * 0.85);
      c.closePath();
    } else if (kind === 2) {
      c.rect(x - s * 0.9, y - s * 0.9, s * 1.8, s * 1.8);
    } else {
      // ほし（5角）
      for (let i = 0; i < 10; i++) {
        const rr = i % 2 === 0 ? s * 1.15 : s * 0.5;
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const px = x + Math.cos(a) * rr;
        const py = y + Math.sin(a) * rr;
        if (i === 0) c.moveTo(px, py);
        else c.lineTo(px, py);
      }
      c.closePath();
    }
    c.fill();
  }

  function strokeSegPath(c: CanvasRenderingContext2D, id: SegId): void {
    const pts = SEGS[id].pts;
    c.beginPath();
    c.moveTo(pts[0]!.x, pts[0]!.y);
    for (let i = 1; i < pts.length; i++) c.lineTo(pts[i]!.x, pts[i]!.y);
    c.stroke();
  }

  function bakeStatic(): void {
    if (!og) return;
    og.setTransform(2, 0, 0, 2, 0, 0);
    // 草地
    const grad = og.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#5b9440');
    grad.addColorStop(1, '#3f7a31');
    og.fillStyle = grad;
    og.fillRect(0, 0, W, H);
    // 草のドット（うっすら）
    og.fillStyle = 'rgba(255,255,255,.05)';
    for (let i = 0; i < 60; i++) {
      const x = (i * 97) % W;
      const y = 60 + ((i * 173) % (H - 120));
      og.fillRect(x, y, 3, 3);
    }
    const ids: SegId[] = ['E', 'A', 'B', 'C', 'D', 'F', 'G'];
    // 路盤
    og.lineCap = 'round';
    og.lineJoin = 'round';
    og.strokeStyle = '#46403a';
    og.lineWidth = 13;
    for (const id of ids) strokeSegPath(og, id);
    // まくら木ふう（破線）
    og.strokeStyle = '#2c2723';
    og.lineWidth = 9;
    og.setLineDash([4, 9]);
    for (const id of ids) strokeSegPath(og, id);
    og.setLineDash([]);
    // レール
    og.strokeStyle = '#cfd5e2';
    og.lineWidth = 2.5;
    for (const id of ids) strokeSegPath(og, id);
    // 入口トンネル
    og.fillStyle = '#1d2438';
    roundRectPath(og, 180 - 24, 40, 48, 26, 10);
    og.fill();
    og.fillStyle = '#0f1424';
    og.beginPath();
    og.arc(180, 66, 13, Math.PI, 0);
    og.fill();
    // ホーム（色＋かたちの二重表示。色弱の子でも見分けられる）
    for (let p = 0; p < 4; p++) {
      const x = PLATFORM_X[p] ?? 0;
      og.fillStyle = COLORS[p] ?? '#888';
      roundRectPath(og, x - 33, 552, 66, 64, 10);
      og.fill();
      og.fillStyle = 'rgba(255,255,255,.3)';
      og.fillRect(x - 33, 552, 66, 9);
      // 入口のくぼみ
      og.fillStyle = '#10182e';
      og.fillRect(x - 9, 552, 18, 12);
      drawShape(og, p, x, 590, 11, '#fff');
    }
  }

  bakeStatic();

  function drawStar(x: number, y: number, s: number, color: string): void {
    drawShape(g, 3, x, y, s, color);
  }

  function drawTrain(tr: Train): void {
    const p = pointAt(SEGS[tr.seg], tr.dist);
    const len = tr.kind === 'express' ? 38 : 32;
    g.save();
    g.translate(p.x, p.y);
    g.rotate(p.ang);
    // 急行のスピード線
    if (tr.kind === 'express') {
      g.strokeStyle = 'rgba(255,255,255,.5)';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(-len / 2 - 10, -5);
      g.lineTo(-len / 2 - 3, -5);
      g.moveTo(-len / 2 - 12, 3);
      g.lineTo(-len / 2 - 5, 3);
      g.stroke();
    }
    // 車体
    g.fillStyle = COLORS[tr.color] ?? '#888';
    roundRectPath(g, -len / 2, -9, len, 18, 6);
    g.fill();
    g.strokeStyle = tr.gold ? '#ffd54a' : 'rgba(16,24,46,.55)';
    g.lineWidth = tr.gold ? 3 : 1.5;
    roundRectPath(g, -len / 2, -9, len, 18, 6);
    g.stroke();
    // まど・ライト
    g.fillStyle = 'rgba(255,255,255,.85)';
    g.fillRect(-len / 2 + 5, -4.5, 7, 9);
    g.fillRect(-len / 2 + 15, -4.5, 7, 9);
    g.beginPath();
    g.arc(len / 2 - 4, 0, 2.6, 0, Math.PI * 2);
    g.fill();
    g.restore();
    // 行き先のかたち（回転させず車体の上に重ねる）
    drawShape(g, tr.color, p.x, p.y, 4.5, '#fff');
    g.strokeStyle = 'rgba(16,24,46,.6)';
    g.lineWidth = 1;
    g.beginPath();
    g.arc(p.x, p.y, 6.5, 0, Math.PI * 2);
    g.stroke();
    if (tr.gold) drawStar(p.x, p.y - 17, 5.5, '#ffd54a');
  }

  function junctionBranch(j: number): SegId {
    if (j === 0) return sw[0] === 0 ? 'A' : 'B';
    if (j === 1) return sw[1] === 0 ? 'C' : 'D';
    return sw[2] === 0 ? 'F' : 'G';
  }

  const FEEDER: SegId[] = ['E', 'A', 'B'];

  function draw(now: number): void {
    g.drawImage(off, 0, 0, W, H);

    // 分岐（ポイント）: えらばれている進路をハイライト＋矢印
    for (let j = 0; j < 3; j++) {
      const jp = JUNCTIONS[j]!;
      const branch = junctionBranch(j);
      const tgt = pointAt(SEGS[branch], 34);
      const ang = Math.atan2(tgt.y - jp.y, tgt.x - jp.x);
      // えらばれている進路の光
      g.strokeStyle = 'rgba(255,213,74,.4)';
      g.lineWidth = 9;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(jp.x, jp.y);
      g.lineTo(jp.x + Math.cos(ang) * 34, jp.y + Math.sin(ang) * 34);
      g.stroke();
      // 電車が近づいてきたら やわらかく点滅
      const feeder = FEEDER[j]!;
      let approaching = false;
      for (const tr of trains) {
        if (tr.seg === feeder && SEGS[feeder].len - tr.dist < 130) approaching = true;
      }
      if (approaching) {
        g.strokeStyle = `rgba(255,213,74,${0.3 + 0.2 * Math.sin(now / 110)})`;
        g.lineWidth = 3;
        g.beginPath();
        g.arc(jp.x, jp.y, 25, 0, Math.PI * 2);
        g.stroke();
      }
      // 本体ボタン
      const flashing = now < (flashUntil[j] ?? 0);
      g.fillStyle = flashing ? '#ffd54a' : '#10182e';
      g.beginPath();
      g.arc(jp.x, jp.y, 16, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = '#ffd54a';
      g.lineWidth = 2;
      g.beginPath();
      g.arc(jp.x, jp.y, 16, 0, Math.PI * 2);
      g.stroke();
      // 矢印
      g.save();
      g.translate(jp.x, jp.y);
      g.rotate(ang);
      g.fillStyle = flashing ? '#10182e' : '#ffd54a';
      g.beginPath();
      g.moveTo(9, 0);
      g.lineTo(-4, -6);
      g.lineTo(-4, 6);
      g.closePath();
      g.fill();
      g.restore();
    }

    // ホームのよろこび（配達パルス）
    for (let p = 0; p < 4; p++) {
      const until = platPulse[p as 0 | 1 | 2 | 3];
      if (now < until) {
        const a = (until - now) / 450;
        g.strokeStyle = `rgba(255,255,255,${0.85 * a})`;
        g.lineWidth = 3.5;
        const x = PLATFORM_X[p] ?? 0;
        roundRectPath(g, x - 36, 549, 72, 70, 12);
        g.stroke();
      }
    }

    // 電車
    for (const tr of trains) drawTrain(tr);

    // うかぶ得点・メッセージ
    for (const e of effects) {
      const a = Math.max(0, Math.min(1, (e.until - now) / 900));
      g.globalAlpha = a;
      g.fillStyle = e.color;
      g.font = `bold ${e.big ? 17 : 15}px sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(e.text, e.x, e.y - (1 - a) * 26);
      g.globalAlpha = 1;
    }

    // HUD（over 中は描かない＝オーバーレイ下で時計が動き続けて見えるのを防ぐ。情報は over 画面にある）
    if (phase !== 'over') {
      g.fillStyle = 'rgba(8,10,24,.9)';
      g.fillRect(0, 0, W, HUD_H);
      g.textBaseline = 'middle';
      g.textAlign = 'left';
      g.fillStyle = '#fff';
      g.font = 'bold 19px sans-serif';
      g.fillText(`${score}てん`, 12, HUD_H / 2);
      g.fillStyle = '#cdd6f5';
      g.font = 'bold 15px sans-serif';
      g.fillText(`のこり${Math.ceil(Math.max(0, GAME_SEC - elapsed()))}びょう`, 118, HUD_H / 2);
      for (let i = 0; i < LIVES; i++) {
        g.fillStyle = i < lives ? '#ff6b8a' : 'rgba(255,255,255,.22)';
        g.font = 'bold 16px sans-serif';
        g.fillText('♥', 242 + i * 18, HUD_H / 2);
      }
    }
    // コンボ表示
    if (phase === 'play' && combo >= 2) {
      g.fillStyle = 'rgba(8,10,24,.55)';
      roundRectPath(g, 8, 48, 104, 24, 12);
      g.fill();
      g.fillStyle = '#ffd54a';
      g.font = 'bold 13px sans-serif';
      g.textAlign = 'center';
      g.fillText(`れんぞく ×${combo}`, 60, 60);
    }

    if (phase === 'over') {
      g.fillStyle = 'rgba(8,10,24,.8)';
      g.fillRect(0, 0, W, H);
      g.textAlign = 'center';
      g.fillStyle = '#fff';
      g.font = 'bold 30px sans-serif';
      g.fillText('おわり！', W / 2, H / 2 - 56);
      g.font = 'bold 26px sans-serif';
      g.fillText(`${score}てん`, W / 2, H / 2 - 14);
      g.fillStyle = '#cdd6f5';
      g.font = 'bold 16px sans-serif';
      g.fillText(`とどけた電車 ${delivered}本`, W / 2, H / 2 + 22);
      if (noMissBonus > 0) {
        g.fillStyle = '#8affc0';
        g.fillText(`ノーミスうんこう +${noMissBonus}`, W / 2, H / 2 + 50);
      }
    }
  }

  draw(ctx.now());
  setData();

  return {
    start() {
      started = true;
      t0 = ctx.now();
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
      offDown();
      offFrame();
    },
  };
}
