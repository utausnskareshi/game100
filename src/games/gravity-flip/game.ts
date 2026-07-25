// =============================================================
// じゅうりょくスイッチ（No.96）: タップで重力反転して縦コリドーを登るランナー
// =============================================================
// - キャラは左右どちらかの壁に張り付いて登っていく。タップで重力(左右)を反転＝反対の壁へ移る。
//   壁から出るトゲを、反対の壁にいる（or 横断中で中央にいる）ことでかわす。1ヒットでおしまい。
// - 物理・スクロールは固定サブステップ(1/120s)＝実時間で決定論。トゲ列は rng 固定順で生成（日替わり共通）。
// - トゲの画面Yは worldScroll から計算（born 時の worldScroll からの差分）＝フレーム非依存。
// - import してよいのは game-api（types / helpers）と、このフォルダ内（logic）だけ。
import type { GameContext, IGame, PointerInfo } from '../../game-api/types';
import {
  CHAR_R,
  CHAR_Y,
  GRAV,
  H,
  REST_L,
  REST_R,
  type Side,
  SPIKE_DEPTH,
  SPIKE_H,
  W,
  WALL_L,
  WALL_R,
  nextSpike,
  scoreOf,
  speedAt,
} from './logic';

const HUD_H = 38;
const SUB = 1 / 120;
const START_LEAD = 360; // 最初のトゲまでの距離(px)
const END_DELAY = 1600;
const SCORE_HI = 200;

type Mode = 'play' | 'over';

interface Spike {
  side: Side;
  spawnScroll: number;
}

export function createGame(ctx: GameContext): IGame {
  const cv = ctx.canvas2d({ design: { w: W, h: H } });
  const g = cv.ctx;

  let mode: Mode = 'play';
  let started = false;
  let hostPaused = false;
  let ended = false;

  let grav = -1; // -1=左へ / +1=右へ
  let charX = REST_L;
  let vx = 0;
  let worldScroll = 0;
  let nextSpawnScroll = START_LEAD;
  let spikes: Spike[] = [];
  let flips = 0;
  let subAccum = 0;
  let phaseUntil = 0;
  let flipFx = 0; // 反転演出の残り
  let lastEvent = '';

  const spikeY = (s: Spike): number => -SPIKE_H + (worldScroll - s.spawnScroll);

  function toOver(now: number): void {
    if (mode !== 'play') return;
    mode = 'over';
    phaseUntil = now + END_DELAY;
    ctx.sfx('fail');
    ctx.haptic('error');
    lastEvent = 'over';
  }

  function hitTest(): boolean {
    for (const s of spikes) {
      const y = spikeY(s) + SPIKE_H / 2; // トゲ中心Y
      if (Math.abs(y - CHAR_Y) >= SPIKE_H / 2 + CHAR_R) continue; // Yが重ならない
      if (s.side === 'L' && charX - CHAR_R < WALL_L + SPIKE_DEPTH) return true;
      if (s.side === 'R' && charX + CHAR_R > WALL_R - SPIKE_DEPTH) return true;
    }
    return false;
  }

  function step(sub: number): void {
    worldScroll += speedAt(worldScroll) * sub;
    // トゲ出現
    while (worldScroll >= nextSpawnScroll) {
      const sp = nextSpike(ctx.random, worldScroll);
      spikes.push({ side: sp.side, spawnScroll: nextSpawnScroll });
      nextSpawnScroll += sp.gapDist;
    }
    // 物理（横方向の重力）
    vx += grav * GRAV * sub;
    charX += vx * sub;
    if (charX <= REST_L) {
      charX = REST_L;
      if (vx < 0) vx = 0;
    } else if (charX >= REST_R) {
      charX = REST_R;
      if (vx > 0) vx = 0;
    }
    // 衝突
    if (hitTest()) {
      toOver(ctx.now());
      return;
    }
    // 画面外へ流れたトゲを捨てる
    spikes = spikes.filter((s) => spikeY(s) <= H + SPIKE_H);
  }

  // ---- 入力（タップで重力反転） ----
  const offDown = ctx.input.onDown((_p: PointerInfo) => {
    if (hostPaused || !started || mode !== 'play') return;
    grav = -grav;
    flips += 1;
    flipFx = 1;
    if (flips >= 40) ctx.achieve('flips-40');
    if (flips >= 90) ctx.achieve('flips-90');
    ctx.sfx('tap');
    ctx.haptic('light');
    lastEvent = `flip:${flips}`;
  });

  // ---- 毎フレーム ----
  const offFrame = ctx.onFrame((dt: number) => {
    if (hostPaused || !started) return;
    const now = ctx.now();
    if (mode === 'play') {
      subAccum += dt;
      let guard = 0;
      while (subAccum >= SUB && guard++ < 400) {
        subAccum -= SUB;
        step(SUB);
        if (mode !== 'play') break;
      }
      const sc = scoreOf(worldScroll);
      if (sc >= 60) ctx.achieve('run-60');
      if (sc >= 120) ctx.achieve('run-120');
      if (sc >= SCORE_HI) ctx.achieve('run-200');
      if (worldScroll > START_LEAD) ctx.achieve('first-run');
      if (flipFx > 0) flipFx = Math.max(0, flipFx - dt * 5);
    } else if (mode === 'over' && !ended && now >= phaseUntil) {
      ended = true;
      ctx.end({ score: scoreOf(worldScroll) });
      return;
    }
    draw(now);
    setData();
  });

  function setData(): void {
    if (!import.meta.env.DEV) return;
    const r = ctx.root as HTMLElement;
    r.dataset.mode = mode;
    r.dataset.score = String(scoreOf(worldScroll));
    r.dataset.dist = worldScroll.toFixed(1);
    r.dataset.flips = String(flips);
    r.dataset.grav = grav < 0 ? 'L' : 'R';
    r.dataset.charx = charX.toFixed(1);
    // 迫ってくるトゲ（画面内・キャラより上）を近い順に
    const list = spikes
      .map((s) => ({ side: s.side, y: +spikeY(s).toFixed(1) }))
      .filter((s) => s.y < CHAR_Y + 20 && s.y > -SPIKE_H - 1)
      .sort((a, b) => b.y - a.y); // 下(=キャラに近い)ほど先
    r.dataset.spikes = JSON.stringify(list);
    r.dataset.last = lastEvent;
  }

  // ---- 描画 ----
  function draw(now: number): void {
    cv.clear('#10142a');
    // 背景（登っている感じのスクロール線）
    g.strokeStyle = 'rgba(255,255,255,.05)';
    g.lineWidth = 2;
    const off = worldScroll % 60;
    for (let i = -1; i < H / 60 + 1; i++) {
      const y = i * 60 + off;
      g.beginPath();
      g.moveTo(WALL_L, y);
      g.lineTo(WALL_R, y);
      g.stroke();
    }
    // 壁
    g.fillStyle = '#2a3358';
    g.fillRect(0, 0, WALL_L, H);
    g.fillRect(WALL_R, 0, W - WALL_R, H);
    g.fillStyle = '#3a4680';
    g.fillRect(WALL_L - 4, 0, 4, H);
    g.fillRect(WALL_R, 0, 4, H);

    // トゲ
    for (const s of spikes) {
      const y = spikeY(s);
      g.fillStyle = '#ff5a6a';
      const teeth = 3;
      for (let t = 0; t < teeth; t++) {
        const ty = y + (t * SPIKE_H) / teeth;
        const th = SPIKE_H / teeth;
        g.beginPath();
        if (s.side === 'L') {
          g.moveTo(WALL_L, ty);
          g.lineTo(WALL_L + SPIKE_DEPTH, ty + th / 2);
          g.lineTo(WALL_L, ty + th);
        } else {
          g.moveTo(WALL_R, ty);
          g.lineTo(WALL_R - SPIKE_DEPTH, ty + th / 2);
          g.lineTo(WALL_R, ty + th);
        }
        g.closePath();
        g.fill();
      }
      g.fillStyle = '#c83a4a';
      g.fillRect(s.side === 'L' ? WALL_L - 2 : WALL_R - 2, y, 4, SPIKE_H);
    }

    // キャラ
    {
      g.save();
      g.translate(charX, CHAR_Y);
      if (flipFx > 0) {
        g.strokeStyle = `rgba(127,224,255,${flipFx * 0.6})`;
        g.lineWidth = 3;
        g.beginPath();
        g.arc(0, 0, CHAR_R + (1 - flipFx) * 18, 0, Math.PI * 2);
        g.stroke();
      }
      // しっぽ（進行方向＝上へ流れる残像）
      g.fillStyle = 'rgba(140,220,255,.25)';
      g.beginPath();
      g.ellipse(0, 12, CHAR_R * 0.8, CHAR_R * 1.4, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = mode === 'over' ? '#8a90a8' : '#7fe0ff';
      g.beginPath();
      g.arc(0, 0, CHAR_R, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = '#1a2340';
      g.lineWidth = 2;
      g.stroke();
      // 目（重力の向きを見る）
      g.fillStyle = '#1a2340';
      const ex = grav < 0 ? -4 : 4;
      g.beginPath();
      g.arc(ex, -3, 3, 0, Math.PI * 2);
      g.arc(ex + (grav < 0 ? -0.5 : 0.5), -3, 3, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }

    // HUD
    g.fillStyle = 'rgba(16,20,42,.85)';
    g.fillRect(0, 0, W, HUD_H);
    g.fillStyle = '#fff';
    g.font = 'bold 19px sans-serif';
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.fillText(`${scoreOf(worldScroll)} m`, 12, HUD_H / 2);
    g.fillStyle = '#9fe3ff';
    g.font = 'bold 13px sans-serif';
    g.textAlign = 'right';
    g.fillText(`はんてん ${flips}`, W - 12, HUD_H / 2);

    if (mode === 'play' && worldScroll < START_LEAD * 0.7 && flips === 0) {
      g.fillStyle = 'rgba(255,255,255,.85)';
      g.font = 'bold 16px sans-serif';
      g.textAlign = 'center';
      g.fillText('タップで じゅうりょく反転！', W / 2, CHAR_Y - 70);
      g.fillText('トゲのない かべへ うつろう', W / 2, CHAR_Y - 46);
    }

    if (mode === 'over') {
      g.fillStyle = 'rgba(16,20,42,.82)';
      g.fillRect(0, 0, W, H);
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = '#fff';
      g.font = 'bold 30px sans-serif';
      g.fillText('ゲームオーバー', W / 2, H / 2 - 44);
      g.font = 'bold 30px sans-serif';
      g.fillText(`${scoreOf(worldScroll)} m`, W / 2, H / 2 + 2);
      g.fillStyle = '#9fe3ff';
      g.font = 'bold 15px sans-serif';
      g.fillText(`はんてん ${flips}回`, W / 2, H / 2 + 36);
    }
    void now;
  }

  draw(ctx.now());
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
      offDown();
      offFrame();
    },
  };
}
