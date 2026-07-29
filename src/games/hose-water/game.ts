// =============================================================
// みずまき ホース（No.114・かくれゲーム）: かたむきで 水の放物線を ねらう
// =============================================================
// - ねらい: 傾き＝「打ち出す角度」。とどく きょりは sin(2θ) なので まっすぐ比例せず、
//   45度を こえると また 手前に もどる。狙いの付け方そのものが 遊びになる。
// - 水は かぎりがあるので「出しっぱなしで さがす」ことが できない（タップで 出す／止める）。
// - センサー無し端末でも ドラッグで 同じ角度を 作れる（createDragTilt）。
// - import してよいのは game-api（types / helpers）と、このフォルダ内（logic）だけ。
import type { GameContext, IGame, PointerInfo } from '../../game-api/types';
import { clamp, createDragTilt } from '../../game-api/helpers';
import {
  ANG_MAX,
  ANG_MIN,
  FILL_RATE,
  GROUND_Y,
  HIT_W,
  HOSE_X,
  HOSE_Y,
  STAGES,
  STAGE_COUNT,
  TANK_COST,
  WET_COOL,
  WET_PENALTY,
  type Stage,
  angleOf,
  pointAt,
  shotOf,
  stageScore,
} from './logic';

const W = 360;
const H = 640;
const HUD_H = 46;

const CLEAR_MS = 1500;
const FAIL_MS = 1600;
const END_DELAY = 2400;
const SCORE_HI = 740;

const CALIB = { x: 12, y: 566, w: 84, h: 40 };
/**
 * すいへいボタンの **タップ判定** は 見た目より 少し 大きくする（40px では 指に 小さい）。
 * まわりに ほかの ボタンは 無く、画面(640)にも 収まる（566-2 〜 566+40+2 ＝ 564〜608）。
 */
const CALIB_HIT = { x: CALIB.x - 6, y: CALIB.y - 4, w: CALIB.w + 12, h: CALIB.h + 8 };

const C_SKY = '#dff1fb';
const C_GROUND = '#8fbf6a';
const C_SOIL = '#6b4f32';
const C_TEXT = '#20323c';
const C_DIM = '#5d7683';
const C_WATER = '#3aa6e0';
const C_OK = '#2e8f4f';
const C_NG = '#d94a3c';
const C_PANEL = 'rgba(255,255,255,.72)';

type Mode = 'play' | 'cleared' | 'failed' | 'done';

export function createGame(ctx: GameContext): IGame {
  const cv = ctx.canvas2d({ design: { w: W, h: H } });
  const g = cv.ctx;

  let stageIdx = 0;
  let stage: Stage = STAGES[0]!;
  let tank = 0;
  /** 花の 水やり ぐあい（0〜100） */
  let fill: number[] = [];
  let spraying = false;
  let wets = 0;
  let stageWets = 0;
  let attempts = 1;
  let mode: Mode = 'play';
  let started = false;
  let hostPaused = false;
  let ended = false;
  let score = 0;
  let cleared = 0;
  let dryStages = 0;
  let angle = 45;
  /** ぬらした ものの 最後の 時こく（連続で 数えないため） */
  const wetAt: number[] = [];
  let flashUntil = 0;
  let phaseUntil = 0;
  let lastEvent = '';

  const tiltIn = createDragTilt(ctx, {
    toLocal: (p) => cv.toLocal(p),
    div: 120,
    enabled: () => started && !hostPaused,
  });

  function resetStage(countAttempt: boolean): void {
    stage = STAGES[stageIdx]!;
    tank = stage.tank;
    fill = stage.flowers.map(() => 0);
    wetAt.length = 0;
    for (let i = 0; i < stage.noWet.length; i++) wetAt.push(-9999);
    spraying = false;
    stageWets = 0;
    if (countAttempt) attempts++;
    mode = 'play';
  }

  function loadStage(i: number): void {
    stageIdx = i;
    attempts = 1;
    resetStage(false);
    lastEvent = `stage:${i}`;
  }
  loadStage(0);

  // ---------- 入力 ----------
  const offTap = ctx.input.onTap((p: PointerInfo) => {
    if (hostPaused || !started || mode !== 'play') return;
    const l = cv.toLocal(p);
    if (l.x >= CALIB_HIT.x && l.x <= CALIB_HIT.x + CALIB_HIT.w && l.y >= CALIB_HIT.y && l.y <= CALIB_HIT.y + CALIB_HIT.h) {
      ctx.motion?.calibrate();
      tiltIn.reset();
      ctx.sfx('tap');
      lastEvent = 'calibrate';
      return;
    }
    spraying = !spraying;
    ctx.sfx('tap');
    lastEvent = spraying ? 'on' : 'off';
  });

  // ---------- 毎フレーム ----------
  const offFrame = ctx.onFrame((dt) => {
    if (hostPaused || !started) return;
    const now = ctx.now();
    const step = Math.min(0.1, dt);
    angle = angleOf(clamp(tiltIn.value().x, -1, 1));

    if (mode === 'play') {
      if (spraying && tank > 0) {
        tank = Math.max(0, tank - TANK_COST * step);
        const shot = shotOf(stage, angle);
        if (!shot.blocked) {
          // 花に かかっているか
          for (let i = 0; i < stage.flowers.length; i++) {
            if (Math.abs(shot.x - stage.flowers[i]!.x) <= HIT_W / 2 && fill[i]! < 100) {
              // ほんの わずか（0.1%）を のこして 水を そらしても「満タン」にする。
              // ※ 99.9% で 止まると、見た目は いっぱいなのに いつまでも クリアにならない
              const v = fill[i]! + FILL_RATE * step;
              fill[i] = v >= 99.9 ? 100 : v;
              if (fill[i]! >= 100) {
                ctx.sfx('combo');
                ctx.achieve('first-flower');
                lastEvent = `full:${stageIdx}:${i}`;
              }
            }
          }
          // ぬらしては いけない ものに かかっていないか
          for (let i = 0; i < stage.noWet.length; i++) {
            if (Math.abs(shot.x - stage.noWet[i]!.x) <= HIT_W / 2 && now - wetAt[i]! > WET_COOL) {
              wetAt[i] = now;
              wets++;
              stageWets++;
              flashUntil = now + 700;
              ctx.sfx('fail');
              ctx.haptic('error');
              lastEvent = `wet:${stageIdx}:${i}`;
            }
          }
        }
        if (tank <= 0) spraying = false;
      }
      if (fill.every((v) => v >= 100)) {
        clearStage(now);
      } else if (tank <= 0) {
        mode = 'failed';
        phaseUntil = now + FAIL_MS;
        ctx.sfx('fail');
        lastEvent = `empty:${stageIdx}:${attempts}`;
      }
    } else if (mode === 'cleared' && now >= phaseUntil) {
      if (stageIdx + 1 >= STAGE_COUNT) finish(now);
      else loadStage(stageIdx + 1);
    } else if (mode === 'failed' && now >= phaseUntil) {
      resetStage(true);
    } else if (mode === 'done' && !ended && now >= phaseUntil) {
      ended = true;
      ctx.end({ score });
      return;
    }
    draw(now);
    setData();
  });

  function clearStage(now: number): void {
    const pts = stageScore(tank, stageWets);
    score += pts;
    cleared++;
    spraying = false;
    if (stageWets === 0) {
      dryStages++;
      ctx.achieve('dry-cat');
    }
    if (cleared >= 2) ctx.achieve('half');
    mode = 'cleared';
    phaseUntil = now + CLEAR_MS;
    ctx.sfx('medal');
    ctx.haptic('success');
    lastEvent = `clear:${stageIdx}:${pts}:${Math.round(tank)}`;
  }

  function finish(now: number): void {
    if (cleared >= STAGE_COUNT) ctx.achieve('all-clear');
    if (wets === 0) ctx.achieve('never-wet');
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
    r.dataset.angle = angle.toFixed(2);
    r.dataset.tank = tank.toFixed(1);
    r.dataset.spray = spraying ? '1' : '0';
    r.dataset.fill = fill.map((v) => v.toFixed(1)).join(',');
    r.dataset.land = shotOf(stage, angle).x.toFixed(1);
    r.dataset.blocked = shotOf(stage, angle).blocked ? '1' : '0';
    r.dataset.wets = String(wets);
    r.dataset.attempts = String(attempts);
    r.dataset.score = String(score);
    r.dataset.cleared = String(cleared);
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

  function drawFlower(x: number, v: number): void {
    const y = GROUND_Y;
    // くき
    g.strokeStyle = v >= 100 ? '#2e8f4f' : '#6f8f52';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x, y - 26 - (v / 100) * 10);
    g.stroke();
    // 花
    const cy = y - 30 - (v / 100) * 10;
    const petals = v >= 100 ? 6 : 5;
    g.fillStyle = v >= 100 ? '#ff7ab0' : '#c9a3b4';
    for (let i = 0; i < petals; i++) {
      const a = (i / petals) * Math.PI * 2;
      g.beginPath();
      g.arc(x + Math.cos(a) * 8, cy + Math.sin(a) * 8, 6, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = v >= 100 ? '#ffd54a' : '#d8d0b0';
    g.beginPath();
    g.arc(x, cy, 5.5, 0, Math.PI * 2);
    g.fill();
    // 水の たまり ぐあい
    g.fillStyle = 'rgba(255,255,255,.75)';
    roundRect(x - 14, y + 6, 28, 7, 3.5);
    g.fill();
    g.fillStyle = v >= 100 ? C_OK : C_WATER;
    roundRect(x - 14, y + 6, 28 * (v / 100), 7, 3.5);
    g.fill();
  }

  function drawNoWet(x: number, kind: 'cat' | 'wash', wet: boolean): void {
    const y = GROUND_Y;
    if (kind === 'cat') {
      g.fillStyle = wet ? '#b08a72' : '#e0c3a0';
      g.beginPath();
      g.ellipse(x, y - 12, 15, 11, 0, 0, Math.PI * 2);
      g.fill();
      g.beginPath();
      g.arc(x + 11, y - 22, 9, 0, Math.PI * 2);
      g.fill();
      g.beginPath();
      g.moveTo(x + 5, y - 29);
      g.lineTo(x + 8, y - 36);
      g.lineTo(x + 12, y - 29);
      g.closePath();
      g.fill();
      g.fillStyle = '#3a2b20';
      g.beginPath();
      g.arc(x + 9, y - 23, 1.6, 0, Math.PI * 2);
      g.arc(x + 15, y - 23, 1.6, 0, Math.PI * 2);
      g.fill();
    } else {
      g.strokeStyle = '#9aa7ad';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(x - 20, y - 44);
      g.lineTo(x + 20, y - 44);
      g.stroke();
      g.fillStyle = wet ? '#9fb6c4' : '#f4f7f8';
      roundRect(x - 14, y - 44, 28, 30, 3);
      g.fill();
      g.strokeStyle = '#c3ced3';
      g.lineWidth = 1.5;
      roundRect(x - 14, y - 44, 28, 30, 3);
      g.stroke();
    }
    g.fillStyle = C_NG;
    g.font = 'bold 12px sans-serif';
    g.textAlign = 'center';
    g.fillText('ぬらさない', x, y + 14);
  }

  function draw(now: number): void {
    cv.clear(C_SKY);

    // じめん
    g.fillStyle = C_GROUND;
    g.fillRect(0, GROUND_Y, W, H - GROUND_Y);
    g.fillStyle = C_SOIL;
    g.fillRect(0, GROUND_Y + 26, W, H - GROUND_Y - 26);

    // HUD
    g.fillStyle = '#0e2a38';
    g.fillRect(0, 0, W, HUD_H);
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.fillStyle = '#eef7fb';
    g.font = 'bold 18px sans-serif';
    g.fillText(`${score}てん`, 12, HUD_H / 2);
    g.fillStyle = '#9dc0d0';
    g.font = 'bold 13px sans-serif';
    g.fillText(`ステージ ${Math.min(stageIdx + 1, STAGE_COUNT)}/${STAGE_COUNT}`, 116, HUD_H / 2 - 8);
    g.fillText(`ぬらした ${wets}・ちょうせん ${attempts}`, 116, HUD_H / 2 + 9);

    g.textAlign = 'center';

    if (mode === 'done') {
      g.fillStyle = C_PANEL;
      roundRect(30, 210, 300, 200, 18);
      g.fill();
      g.fillStyle = C_TEXT;
      g.font = 'bold 24px sans-serif';
      g.fillText('みずやり おわり！', W / 2, 262);
      g.font = 'bold 34px sans-serif';
      g.fillStyle = C_WATER;
      g.fillText(`${score}てん`, W / 2, 314);
      g.fillStyle = C_DIM;
      g.font = 'bold 14px sans-serif';
      g.fillText(`クリア ${cleared} / ${STAGE_COUNT}・ぬらした ${wets}かい`, W / 2, 358);
      return;
    }

    // 水のタンク
    g.fillStyle = 'rgba(255,255,255,.7)';
    roundRect(20, 58, 320, 16, 8);
    g.fill();
    const ratio = tank / stage.tank;
    g.fillStyle = ratio > 0.3 ? C_WATER : C_NG;
    roundRect(20, 58, 320 * ratio, 16, 8);
    g.fill();
    g.fillStyle = C_TEXT;
    g.font = 'bold 11px sans-serif';
    g.fillText(`のこりの 水 ${Math.round(tank)}`, W / 2, 66);

    // かべ
    if (stage.wall) {
      g.fillStyle = '#a2836a';
      g.fillRect(stage.wall.x - 9, stage.wall.topY, 18, GROUND_Y - stage.wall.topY);
      g.fillStyle = '#8a6d56';
      g.fillRect(stage.wall.x - 12, stage.wall.topY - 8, 24, 8);
    }

    // 花・ぬらしては いけない もの
    for (let i = 0; i < stage.flowers.length; i++) drawFlower(stage.flowers[i]!.x, fill[i]!);
    for (let i = 0; i < stage.noWet.length; i++) {
      drawNoWet(stage.noWet[i]!.x, stage.noWet[i]!.kind, now - wetAt[i]! < 900);
    }

    // ホース
    const r = (angle * Math.PI) / 180;
    g.strokeStyle = '#4a5b64';
    g.lineWidth = 9;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(HOSE_X - 8, HOSE_Y + 34);
    g.lineTo(HOSE_X, HOSE_Y);
    g.lineTo(HOSE_X + Math.cos(r) * 24, HOSE_Y - Math.sin(r) * 24);
    g.stroke();

    // 水
    const shot = shotOf(stage, angle);
    if (spraying && tank > 0) {
      g.strokeStyle = C_WATER;
      g.lineWidth = 5;
      g.globalAlpha = 0.85;
      g.beginPath();
      const steps = 26;
      for (let i = 0; i <= steps; i++) {
        const p = pointAt(angle, (shot.t * i) / steps);
        if (i === 0) g.moveTo(p.x, p.y);
        else g.lineTo(p.x, p.y);
      }
      g.stroke();
      g.globalAlpha = 1;
      // 着地の しぶき
      g.fillStyle = shot.blocked ? C_NG : C_WATER;
      g.beginPath();
      g.arc(shot.x, shot.y, 6, 0, Math.PI * 2);
      g.fill();
    } else {
      // 出していない ときは 向きだけ 見せる（どこに落ちるかは 見せない）
      g.strokeStyle = 'rgba(58,166,224,.5)';
      g.lineWidth = 3;
      g.setLineDash([5, 6]);
      g.beginPath();
      g.moveTo(HOSE_X + Math.cos(r) * 26, HOSE_Y - Math.sin(r) * 26);
      g.lineTo(HOSE_X + Math.cos(r) * 78, HOSE_Y - Math.sin(r) * 78);
      g.stroke();
      g.setLineDash([]);
    }

    // ようす
    g.fillStyle = C_PANEL;
    roundRect(20, 86, 320, 26, 10);
    g.fill();
    g.font = 'bold 14px sans-serif';
    if (mode === 'cleared') {
      g.fillStyle = C_OK;
      g.fillText(`ぜんぶ さいた！ +${stageScore(tank, stageWets)}てん`, W / 2, 99);
    } else if (mode === 'failed') {
      g.fillStyle = C_NG;
      g.fillText('水が なくなった… もう一度', W / 2, 99);
    } else if (now < flashUntil) {
      g.fillStyle = C_NG;
      g.fillText(`ぬらしちゃった！ -${WET_PENALTY}てん`, W / 2, 99);
    } else {
      g.fillStyle = C_TEXT;
      g.fillText(spraying ? '水を 出している（タップで 止める）' : 'タップで 水を 出す', W / 2, 99);
    }

    // かたむきの めやす
    g.fillStyle = C_DIM;
    g.font = 'bold 11px sans-serif';
    g.textAlign = 'right';
    g.fillText(`角度 ${Math.round(angle)}度（${ANG_MIN}〜${ANG_MAX}）`, W - 14, 578);
    g.fillText('中くらいの 角度で いちばん 遠くへ とどく', W - 14, 596);
    g.textAlign = 'center';

    // すいへいボタン
    g.fillStyle = 'rgba(255,255,255,.8)';
    roundRect(CALIB.x, CALIB.y, CALIB.w, CALIB.h, 10);
    g.fill();
    g.strokeStyle = '#9aa7ad';
    g.lineWidth = 1.6;
    roundRect(CALIB.x, CALIB.y, CALIB.w, CALIB.h, 10);
    g.stroke();
    g.fillStyle = C_TEXT;
    g.font = 'bold 14px sans-serif';
    g.fillText('すいへい', CALIB.x + CALIB.w / 2, CALIB.y + CALIB.h / 2);
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
      tiltIn.destroy();
    },
  };
}
