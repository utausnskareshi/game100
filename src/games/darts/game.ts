// =============================================================
// ダーツ（No.75）: 2タップで狙って ダーツを投げよう！全9投の合計点
// =============================================================
// - まず横に動く「たての線」をタップでX確定→次にたてに動く「よこの線」をタップでY確定→
//   その交点に ダーツが刺さる。ブル(まん中)や トリプルをねらって 高得点。
// - ボード幾何・採点は logic.ts（純ロジック・乱数不使用＝完全決定論）。
// - 全画面 Canvas・タップ（onDown）のみ。時間は ctx.now 期限方式・setTimeout 不使用。
// - import してよいのは game-api（types / helpers）と、このフォルダ内（logic）だけ
import type { GameContext, IGame } from '../../game-api/types';
import {
  BOARD,
  DARTS_TOTAL,
  DOUBLE_IN,
  DOUBLE_OUT,
  type HitResult,
  INNER_BULL,
  OUTER_BULL,
  ROUND_SIZE,
  TRIPLE_IN,
  TRIPLE_OUT,
  W,
  WEDGE_ORDER,
  scoreAt,
  triWave,
} from './logic';

const H = 640;
const HUD_H = 40;
const SWEEP_MS = 1150; // 掃引の周期（普通の速さ）
const STICK_MS = 750; // 刺さった演出→次へ
const END_DELAY = 2200;
const SCORE_HI = 360;
const ROUND_TON = 100; // 1ラウンド(3投)100点以上
// 掃引の範囲（ボードの少し外まで＝ミスもありうる）
const SX0 = BOARD.cx - BOARD.r - 8;
const SX1 = BOARD.cx + BOARD.r + 8;
const SY0 = BOARD.cy - BOARD.r - 8;
const SY1 = BOARD.cy + BOARD.r + 8;

type Phase = 'aimX' | 'aimY' | 'stick' | 'over';

interface Dart {
  x: number;
  y: number;
  ring: HitResult['ring'];
}

export function createGame(ctx: GameContext): IGame {
  const cv = ctx.canvas2d({ design: { w: W, h: H } });
  const g = cv.ctx;

  let phase: Phase = 'aimX';
  let hostPaused = false;
  let sweepT = 0; // 掃引の位相（dtで進める＝決定論）
  let lockedX = BOARD.cx;
  let dartsThrown = 0;
  let score = 0;
  let roundScore = 0;
  let onBoardCount = 0;
  const darts: Dart[] = [];
  let last: HitResult | null = null;
  let stickUntil = 0;
  let endAt = 0;
  let ended = false;

  const roundNo = (): number => Math.floor(dartsThrown / ROUND_SIZE) + 1;

  function sweepX(): number {
    return SX0 + triWave(sweepT / (SWEEP_MS / 1000)) * (SX1 - SX0);
  }
  function sweepY(): number {
    return SY0 + triWave(sweepT / (SWEEP_MS / 1000)) * (SY1 - SY0);
  }

  function addScore(n: number): void {
    score += n;
    if (score >= SCORE_HI) ctx.achieve('score-hi');
  }

  function throwDart(x: number, y: number, now: number): void {
    const hit = scoreAt(x, y);
    last = hit;
    darts.push({ x, y, ring: hit.ring });
    addScore(hit.points);
    roundScore += hit.points;
    dartsThrown++;
    ctx.achieve('first-throw');
    if (hit.ring !== 'miss') onBoardCount++;
    if (hit.ring === 'bull50') ctx.achieve('bull');
    if (hit.ring === 'triple') ctx.achieve('triple');
    ctx.sfx(hit.ring === 'miss' ? 'fail' : hit.ring === 'bull50' || hit.ring === 'triple' ? 'medal' : 'tap');
    ctx.haptic(hit.ring === 'miss' ? 'error' : 'light');
    // ラウンド完了チェック
    if (dartsThrown % ROUND_SIZE === 0) {
      if (roundScore >= ROUND_TON) ctx.achieve('round-100');
      roundScore = 0;
    }
    phase = 'stick';
    stickUntil = now + STICK_MS;
  }

  // ---- 入力（タップで掃引を止める）----
  const offDown = ctx.input.onDown(() => {
    if (hostPaused) return;
    if (phase === 'aimX') {
      lockedX = sweepX();
      sweepT = 0;
      phase = 'aimY';
      ctx.sfx('tick');
    } else if (phase === 'aimY') {
      throwDart(lockedX, sweepY(), ctx.now());
    }
  });

  // ---- 毎フレーム ----
  const offFrame = ctx.onFrame((dt) => {
    if (hostPaused) return;
    const now = ctx.now();
    if (phase === 'aimX' || phase === 'aimY') {
      sweepT += dt;
    } else if (phase === 'stick') {
      if (now >= stickUntil) {
        if (dartsThrown >= DARTS_TOTAL) {
          if (onBoardCount >= DARTS_TOTAL) ctx.achieve('no-miss');
          phase = 'over';
          endAt = now + END_DELAY;
        } else {
          sweepT = 0;
          phase = 'aimX';
        }
      }
    } else if (phase === 'over') {
      if (!ended && now >= endAt) {
        ended = true;
        ctx.end({ score });
        return;
      }
    }
    draw();
    setData();
  });

  function setData(): void {
    if (!import.meta.env.DEV) return;
    const r = ctx.root as HTMLElement;
    r.dataset.phase = phase;
    r.dataset.score = String(score);
    r.dataset.thrown = String(dartsThrown);
    r.dataset.round = String(roundNo());
    r.dataset.roundscore = String(roundScore);
    r.dataset.onboard = String(onBoardCount);
    r.dataset.sweepx = sweepX().toFixed(1);
    r.dataset.sweepy = sweepY().toFixed(1);
    r.dataset.lockedx = lockedX.toFixed(1);
    r.dataset.last = last ? `${last.points}:${last.ring}` : '';
    r.dataset.darts = darts.map((d) => `${d.x.toFixed(0)},${d.y.toFixed(0)},${d.ring}`).join(';');
  }

  // ---- 描画 ----
  const WEDGE_FILL = ['#f4ead2', '#20241c']; // クリーム / 黒（交互）
  const RING_HI = ['#d34a3c', '#3a9d54']; // 赤 / 緑（ダブル・トリプル）

  function draw(): void {
    g.fillStyle = '#161a2e';
    g.fillRect(0, 0, W, H);

    const { cx, cy, r } = BOARD;
    // 外周の黒フチ
    g.fillStyle = '#0c0e18';
    g.beginPath();
    g.arc(cx, cy, r + 12, 0, Math.PI * 2);
    g.fill();
    // 20ウェッジ（角度は上=0 から 時計回りに 18°ずつ）
    const seg = Math.PI / 10;
    for (let i = 0; i < 20; i++) {
      // 画面角度: 上向き(-90°)を基準に、時計回り。i番目のウェッジ中心 = i*18°、幅 ±9°
      const a0 = -Math.PI / 2 + (i - 0.5) * seg;
      const a1 = -Math.PI / 2 + (i + 0.5) * seg;
      // シングル（内側の広い帯）
      g.fillStyle = WEDGE_FILL[i % 2]!;
      wedge(cx, cy, OUTER_BULL * r, DOUBLE_OUT * r, a0, a1);
      // トリプルリング
      g.fillStyle = RING_HI[i % 2]!;
      wedge(cx, cy, TRIPLE_IN * r, TRIPLE_OUT * r, a0, a1);
      // ダブルリング
      wedge(cx, cy, DOUBLE_IN * r, DOUBLE_OUT * r, a0, a1);
    }
    // ブル
    g.fillStyle = '#3a9d54';
    g.beginPath();
    g.arc(cx, cy, OUTER_BULL * r, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#d34a3c';
    g.beginPath();
    g.arc(cx, cy, INNER_BULL * r, 0, Math.PI * 2);
    g.fill();
    // 数字
    g.fillStyle = '#f2f2ea';
    g.font = 'bold 13px sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (let i = 0; i < 20; i++) {
      const a = -Math.PI / 2 + i * seg;
      const rr = r + 2;
      const tx = cx + Math.cos(a) * rr;
      const ty = cy + Math.sin(a) * rr;
      g.fillText(String(WEDGE_ORDER[i]), tx, ty);
    }

    // 刺さったダーツ
    for (const d of darts) drawDart(d.x, d.y);

    // 掃引ライン
    if (phase === 'aimX') {
      const x = sweepX();
      g.strokeStyle = '#ffd54a';
      g.lineWidth = 2.5;
      g.setLineDash([6, 6]);
      g.beginPath();
      g.moveTo(x, cy - r - 14);
      g.lineTo(x, cy + r + 14);
      g.stroke();
      g.setLineDash([]);
      arrowMarker(x, cy - r - 20, 0);
    } else if (phase === 'aimY') {
      // 確定した X の縦線（固定）
      g.strokeStyle = 'rgba(255,213,74,.5)';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(lockedX, cy - r - 14);
      g.lineTo(lockedX, cy + r + 14);
      g.stroke();
      const y = sweepY();
      g.strokeStyle = '#ff8a4a';
      g.lineWidth = 2.5;
      g.setLineDash([6, 6]);
      g.beginPath();
      g.moveTo(cx - r - 14, y);
      g.lineTo(cx + r + 14, y);
      g.stroke();
      g.setLineDash([]);
      arrowMarker(cx - r - 20, y, 1);
      // 交点プレビュー
      g.fillStyle = 'rgba(255,255,255,.5)';
      g.beginPath();
      g.arc(lockedX, y, 3, 0, Math.PI * 2);
      g.fill();
    }

    // HUD
    g.fillStyle = 'rgba(8,10,24,.9)';
    g.fillRect(0, 0, W, HUD_H);
    g.textBaseline = 'middle';
    g.textAlign = 'left';
    g.fillStyle = '#fff';
    g.font = 'bold 19px sans-serif';
    g.fillText(`${score}てん`, 12, HUD_H / 2);
    g.fillStyle = '#cdd6f5';
    g.font = 'bold 15px sans-serif';
    g.fillText(`ラウンド${roundNo()}/3`, 128, HUD_H / 2);
    // 投げたダーツのしるし
    g.textAlign = 'right';
    let pips = '';
    for (let i = 0; i < DARTS_TOTAL; i++) pips += i < dartsThrown ? '●' : '○';
    g.font = 'bold 12px sans-serif';
    g.fillStyle = '#ffd54a';
    g.fillText(pips, W - 12, HUD_H / 2);

    // 下部: 指示・結果
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    if (phase === 'aimX') {
      g.fillStyle = '#ffd54a';
      g.font = 'bold 18px sans-serif';
      g.fillText('タップで よこ位置を きめる', W / 2, 470);
    } else if (phase === 'aimY') {
      g.fillStyle = '#ff8a4a';
      g.font = 'bold 18px sans-serif';
      g.fillText('タップで たて位置を きめる → 投げる！', W / 2, 470);
    } else if (phase === 'stick' && last) {
      g.fillStyle = last.ring === 'miss' ? '#ff8a8a' : '#8affc0';
      g.font = 'bold 26px sans-serif';
      const lbl =
        last.ring === 'bull50'
          ? 'ブル！ +50'
          : last.ring === 'bull25'
            ? 'アウターブル +25'
            : last.ring === 'miss'
              ? 'ミス…'
              : `${last.mult === 3 ? 'トリプル' : last.mult === 2 ? 'ダブル' : ''}${last.value} +${last.points}`;
      g.fillText(lbl, W / 2, 468);
    }
    g.fillStyle = 'rgba(205,214,245,.75)';
    g.font = 'bold 13px sans-serif';
    g.fillText('ブル(まん中)＝50 / トリプルリング＝3倍 をねらえ！', W / 2, 508);

    if (phase === 'over') {
      g.fillStyle = 'rgba(8,10,24,.8)';
      g.fillRect(0, 0, W, H);
      g.fillStyle = '#fff';
      g.font = 'bold 30px sans-serif';
      g.fillText('おわり！', W / 2, H / 2 - 34);
      g.font = 'bold 26px sans-serif';
      g.fillText(`${score}てん`, W / 2, H / 2 + 8);
    }
  }

  function wedge(cx: number, cy: number, r0: number, r1: number, a0: number, a1: number): void {
    g.beginPath();
    g.arc(cx, cy, r1, a0, a1);
    g.arc(cx, cy, r0, a1, a0, true);
    g.closePath();
    g.fill();
  }

  function arrowMarker(x: number, y: number, dir: number): void {
    g.fillStyle = dir === 0 ? '#ffd54a' : '#ff8a4a';
    g.beginPath();
    if (dir === 0) {
      g.moveTo(x, y + 8);
      g.lineTo(x - 6, y);
      g.lineTo(x + 6, y);
    } else {
      g.moveTo(x + 8, y);
      g.lineTo(x, y - 6);
      g.lineTo(x, y + 6);
    }
    g.closePath();
    g.fill();
  }

  function drawDart(x: number, y: number): void {
    g.fillStyle = '#e8ecf6';
    g.beginPath();
    g.arc(x, y, 3.2, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#2a3350';
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + 8, y - 8);
    g.stroke();
    g.fillStyle = '#ff6b6b';
    g.beginPath();
    g.moveTo(x + 8, y - 8);
    g.lineTo(x + 12, y - 6);
    g.lineTo(x + 10, y - 11);
    g.closePath();
    g.fill();
  }

  draw();
  setData();

  return {
    start() {
      /* immediate: aimX からスタート */
    },
    pause() {
      hostPaused = true;
    },
    resume() {
      hostPaused = false;
    },
    resize() {
      draw();
    },
    destroy() {
      offDown();
      offFrame();
    },
  };
}
