// =============================================================
// つみあげタワー（No.23）: 左右にうごくブロックをタップで落として高く積む（timing）
// =============================================================
// - 重なった部分だけが残り、はみ出しはカット＝どんどん細くなる。完全に外すと終了。
// - 誤差ε以内の「ぴったり」はカットなし＋ボーナス＋幅すこし回復（上限=初期幅）。
// - 高さでスライドが速くなる。エンドレス型（ぴったりストップの10ラウンド型と差別化）。
// - 位置は ctx.now から算出（logic.slideX）＝ポーズで自動停止・setTimeout 不使用。
// - import してよいのは game-api（types / helpers）と、このフォルダ内（logic）だけ
import type { GameContext, IGame } from '../../game-api/types';
import { clamp } from '../../game-api/helpers';
import { landBlock, speedOf, recoverWidth, slideX } from './logic';

const W = 360;
const H = 640;
const BLOCK_H = 26;
const INIT_W = 180;
const LANE_PAD = 10; // スライド可動域の左右マージン
const EPS = 6; // 「ぴったり」判定の許容ズレ(px)
const MIN_W = 10; // これ未満に細くなったら終了
const FLOOR_PTS = 10;
const PERFECT_PTS = 30;
const SCORE_HI = 1500; // score-hi 実績のしきい値（仮）
const END_DELAY = 1700;
const GROUND_Y = H - 84;
const CAM_KEEP = 300; // タワー上端をこの高さに保つようスクロール
const DROP_COOLDOWN = 160; // 連続タップの誤爆防止(ms)

const COLORS = ['#f0524a', '#f39a2e', '#f4c81e', '#4bd267', '#25d0e6', '#4a74f0', '#a860f0', '#ff6ec7'];

interface Block {
  x: number;
  w: number;
}
interface Piece {
  x: number;
  w: number;
  y: number;
  vy: number;
  color: string;
}

export function createGame(ctx: GameContext): IGame {
  const cv = ctx.canvas2d({ design: { w: W, h: H } });
  const g = cv.ctx;

  type Mode = 'play' | 'over';
  let mode: Mode = 'play';
  let hostPaused = false;
  let tower: Block[] = [];
  let floors = 0; // 積んだ段数（ベースを除く）
  let score = 0;
  let cuts = 0; // カットが発生した回数
  let perfStreak = 0;
  let floorStart = 0; // 現在のブロックが動き始めた時刻
  let flashUntil = 0; // ぴったり演出
  let endAt = 0;
  let ended = false;
  let lastDropAt = -Infinity; // 連続drop防止（reset で初期化）
  const pieces: Piece[] = []; // 切り落とし片（演出）

  const curW = (): number => tower[tower.length - 1]?.w ?? INIT_W;
  const colorOf = (i: number): string => COLORS[i % COLORS.length] ?? '#888';

  function reset(): void {
    mode = 'play';
    tower = [{ x: (W - INIT_W) / 2, w: INIT_W }];
    floors = 0;
    score = 0;
    cuts = 0;
    perfStreak = 0;
    pieces.length = 0;
    ended = false;
    endAt = 0;
    flashUntil = 0;
    lastDropAt = -Infinity;
    floorStart = ctx.now();
  }

  /** いまのアクティブブロックの左端 x（三角波・段ごとに開始方向を交互に） */
  function activeX(now: number): number {
    const w = curW();
    const range = W - LANE_PAD * 2 - w;
    const raw = slideX(now - floorStart, speedOf(floors), range);
    const x = floors % 2 === 1 ? range - raw : raw;
    return LANE_PAD + x;
  }

  // ---- 落とす ----
  function drop(): void {
    if (mode !== 'play' || hostPaused) return;
    const now = ctx.now();
    if (now - lastDropAt < DROP_COOLDOWN) return; // マルチタッチ/二度タップの連続drop事故を防ぐ
    lastDropAt = now;
    const top = tower[tower.length - 1];
    if (!top) return;
    const x = activeX(now);
    const land = landBlock(top.x, top.w, x, top.w, EPS);
    if (land.miss || land.w < MIN_W) {
      // 全部落ちる演出
      pieces.push({ x, w: top.w, y: towerScreenY(tower.length), vy: -60, color: colorOf(tower.length) });
      gameOver(now);
      return;
    }
    floors++;
    let gain = FLOOR_PTS;
    if (land.perfect) {
      perfStreak++;
      gain += PERFECT_PTS;
      flashUntil = now + 350;
      ctx.sfx('combo');
      ctx.haptic('medium');
      if (perfStreak === 3) ctx.achieve('pittari-3');
    } else {
      perfStreak = 0;
      cuts++;
      ctx.sfx('tap');
      ctx.haptic('light');
      // 切り落とし片（はみ出した側から落ちる）
      const px = x < top.x ? x : land.x + land.w;
      pieces.push({ x: px, w: land.cut, y: towerScreenY(tower.length), vy: 0, color: colorOf(tower.length) });
    }
    score += gain;
    const newW = land.perfect ? recoverWidth(land.w, INIT_W) : land.w;
    tower.push({ x: land.x, w: newW });
    // マイルストーン実績は達したその場で解除（確立ポリシー）
    if (floors >= 10) ctx.achieve('tower-10');
    if (floors >= 20) ctx.achieve('tower-20');
    if (floors >= 30) ctx.achieve('tower-30');
    if (floors >= 10 && cuts === 0) ctx.achieve('no-cut-10');
    if (score >= SCORE_HI) ctx.achieve('score-hi');
    floorStart = now;
  }

  function gameOver(now: number): void {
    if (mode !== 'play') return;
    mode = 'over';
    ctx.sfx('fail');
    ctx.haptic('error');
    endAt = now + END_DELAY;
  }

  // ---- 座標（カメラ＝タワーが高くなると下へずらす）----
  function camOffset(): number {
    return Math.max(0, tower.length * BLOCK_H - CAM_KEEP);
  }
  /** タワー i 段目（0=ベース）の画面上の上端 y */
  function towerScreenY(i: number): number {
    return GROUND_Y - (i + 1) * BLOCK_H + camOffset();
  }

  // ---- 入力（どこをタップしても落とす）----
  const offDown = ctx.input.onDown(() => drop());

  // ---- 毎フレーム ----
  const offFrame = ctx.onFrame((dt) => {
    const now = ctx.now();
    // 切り落とし片の落下（演出）
    for (let i = pieces.length - 1; i >= 0; i--) {
      const p = pieces[i]!;
      p.vy += 1300 * dt;
      p.y += p.vy * dt;
      if (p.y > H + 40) pieces.splice(i, 1);
    }
    if (mode === 'over' && !ended && now >= endAt) {
      ended = true;
      ctx.end({ score });
    }
    draw(now);
    if (import.meta.env.DEV) {
      const r = ctx.root as HTMLElement;
      r.dataset.mode = mode;
      r.dataset.floors = String(floors);
      r.dataset.score = String(score);
      r.dataset.cuts = String(cuts);
      const top = tower[tower.length - 1];
      r.dataset.topx = String(Math.round(top?.x ?? 0));
      r.dataset.topw = String(Math.round(top?.w ?? 0));
      r.dataset.curx = String(Math.round(activeX(now)));
    }
  });

  // ---- 描画 ----
  function draw(now: number): void {
    // 空（高さで少しずつ夕方に）
    const t = clamp(floors / 40, 0, 1);
    const grd = g.createLinearGradient(0, 0, 0, H);
    grd.addColorStop(0, t < 0.5 ? '#8fd6ff' : '#b393e8');
    grd.addColorStop(1, '#dff0ff');
    g.fillStyle = grd;
    g.fillRect(0, 0, W, H);

    const cam = camOffset();
    // 地面（カメラで下がる）
    g.fillStyle = '#7ec850';
    g.fillRect(0, GROUND_Y + BLOCK_H + cam - BLOCK_H, W, H);

    // タワー
    for (let i = 0; i < tower.length; i++) {
      const b = tower[i]!;
      const y = towerScreenY(i);
      if (y > H || y < -BLOCK_H) continue;
      g.fillStyle = colorOf(i);
      g.fillRect(b.x, y, b.w, BLOCK_H - 2);
      g.fillStyle = 'rgba(255,255,255,.22)';
      g.fillRect(b.x, y, b.w, 5);
    }

    // 切り落とし片
    for (const p of pieces) {
      g.fillStyle = p.color;
      g.globalAlpha = 0.85;
      g.fillRect(p.x, p.y, p.w, BLOCK_H - 2);
      g.globalAlpha = 1;
    }

    // アクティブブロック
    if (mode === 'play') {
      const x = activeX(now);
      const y = towerScreenY(tower.length);
      g.fillStyle = colorOf(tower.length);
      g.fillRect(x, y, curW(), BLOCK_H - 2);
      g.fillStyle = 'rgba(255,255,255,.35)';
      g.fillRect(x, y, curW(), 5);
      // ぴったりガイド（直下の端の点線）
      const top = tower[tower.length - 1]!;
      g.strokeStyle = 'rgba(0,0,0,.25)';
      g.setLineDash([4, 4]);
      g.beginPath();
      g.moveTo(top.x, y - 4);
      g.lineTo(top.x, y + BLOCK_H);
      g.moveTo(top.x + top.w, y - 4);
      g.lineTo(top.x + top.w, y + BLOCK_H);
      g.stroke();
      g.setLineDash([]);
    }

    // ぴったり演出
    if (now < flashUntil) {
      g.fillStyle = '#ff9800';
      g.textAlign = 'center';
      g.font = 'bold 26px sans-serif';
      g.fillText('ぴったり！', W / 2, towerScreenY(tower.length) - 14);
    }

    // HUD（左上・右上60×60のポーズ領域は避ける）
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.fillStyle = '#1a3d2f';
    g.font = 'bold 22px sans-serif';
    g.fillText(`${floors} だん`, 12, 26);
    g.font = 'bold 16px sans-serif';
    g.fillText(`スコア ${score}`, 12, 52);

    if (mode === 'play' && floors === 0) {
      g.textAlign = 'center';
      g.fillStyle = 'rgba(0,0,0,.55)';
      g.font = 'bold 17px sans-serif';
      g.fillText('タップで ブロックを おとそう！', W / 2, H - 40);
    }

    if (mode === 'over') {
      g.fillStyle = 'rgba(16,19,48,.72)';
      g.fillRect(0, 0, W, H);
      g.fillStyle = '#fff';
      g.textAlign = 'center';
      g.font = 'bold 38px sans-serif';
      g.fillText('おしまい！', W / 2, H / 2 - 26);
      g.font = 'bold 24px sans-serif';
      g.fillText(`${floors} だん・${score} 点`, W / 2, H / 2 + 18);
    }
  }

  // ---- ライフサイクル ----
  return {
    start() {
      reset();
    },
    pause() {
      hostPaused = true;
    },
    resume() {
      hostPaused = false;
    },
    resize() {
      // design 指定の Canvas は自動レターボックス
    },
    destroy() {
      offDown();
      offFrame();
    },
  };
}
