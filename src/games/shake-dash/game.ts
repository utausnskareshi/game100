// =============================================================
// シャカシャカ・ダッシュ（No.10）: スマホをふって走る 50m 徒競走（タイムアタック）
// =============================================================
// - ctx.motion.shakeLevel（連続シェイク強度）が速いほど加速。センサーがなくても
//   「タップ連打」で同じように走れる（optionalSensors:['motion']）。
// - 🥉🥈🥇 のライバルと同時に走り、タイムを競う（scoring:'timeMs'＝短いほど良い＝maze と同型）。
// - ⚡ダッシュゾーン（日替わりで位置がかわる＝ctx.random）を通ると加速。
// - 時間はすべて ctx.now 期限方式（setTimeout 不使用）。開始演出はシェルの 3-2-1。
// - import してよいのは game-api（types / helpers）と、このフォルダ内だけ
import type { GameContext, IGame } from '../../game-api/types';
import { clamp } from '../../game-api/helpers';

const W = 360;
const H = 640;
const TOTAL = 50; // ゴールまでの距離（m）
const BASE = 1.6; // 何もしなくても進む速さ（m/s）＝詰み防止
const GAIN = 7.0; // shakeLevel=1 での上のせ速さ（m/s）
const DASH_MULT = 1.5; // ダッシュゾーンの倍率
const END_DELAY = 1600; // ゴール演出→結果画面までの余韻(ms)
const TAP_ADD = 0.4; // タップ1回で足すパワー（センサーなし用）
const TAP_DECAY = 3.5; // タップパワーの減衰（毎秒）

const TRACK_L = 44; // トラック左端 x
const TRACK_R = 316; // ゴールライン x

interface Rival {
  dist: number;
  speed: number;
  y: number;
  emoji: string;
}
interface Zone {
  start: number;
  end: number;
}

export function createGame(ctx: GameContext): IGame {
  const cv = ctx.canvas2d({ design: { w: W, h: H } });
  const g = cv.ctx;

  type Mode = 'idle' | 'race' | 'over';
  let mode: Mode = 'idle';
  let started = 0; // レース開始時刻（ctx.now）
  let finishMs = 0;
  let ended = false;
  let endAt = 0;
  let yourDist = 0;
  let tapLevel = 0;
  let curLevel = 0; // 表示用の現在パワー（平滑後）
  let minLevelSince = 1; // グレース後の最小パワー（ノンストップ実績用）
  let dashFlash = 0;
  const you = { y: 168, emoji: '🏃' };
  const rivals: Rival[] = [
    { dist: 0, speed: 3.4, y: 236, emoji: '🥉' },
    { dist: 0, speed: 4.3, y: 304, emoji: '🥈' },
    { dist: 0, speed: 5.4, y: 372, emoji: '🥇' },
  ];
  let zones: Zone[] = [];

  const offDown = ctx.input.onDown(() => {
    if (mode === 'race') tapLevel = Math.min(1, tapLevel + TAP_ADD);
  });

  function reset(): void {
    mode = 'race';
    started = ctx.now();
    finishMs = 0;
    ended = false;
    endAt = 0;
    yourDist = 0;
    tapLevel = 0;
    curLevel = 0;
    minLevelSince = 1;
    dashFlash = 0;
    for (const r of rivals) r.dist = 0;
    // ダッシュゾーン2つ（日替わり＝全員同じ位置）
    const z1 = 8 + ctx.random() * 10;
    const z2 = 26 + ctx.random() * 10;
    zones = [
      { start: z1, end: z1 + 7 },
      { start: z2, end: z2 + 7 },
    ];
  }

  function inZone(d: number): boolean {
    for (const z of zones) if (d >= z.start && d <= z.end) return true;
    return false;
  }

  function finish(now: number): void {
    if (mode !== 'race') return;
    mode = 'over';
    finishMs = now - started;
    ctx.achieve('first-goal');
    // 🥉どう=一番おそい / 🥈ぎん / 🥇きん=一番はやい。ゴール時点で相手がまだTOTAL未満なら勝ち
    const silver = rivals[1];
    const gold = rivals[2];
    if (silver && silver.dist < TOTAL) ctx.achieve('beat-silver');
    if (gold && gold.dist < TOTAL) {
      ctx.achieve('beat-gold');
      if (gold.dist < TOTAL * 0.7) ctx.achieve('big-lead');
    }
    if (finishMs <= 10_000) ctx.achieve('speedy');
    if (minLevelSince >= 0.2) ctx.achieve('no-stop');
    ctx.sfx('medal');
    ctx.haptic('success');
    endAt = now + END_DELAY;
  }

  const offFrame = ctx.onFrame((dt) => {
    const now = ctx.now();

    if (mode === 'race') {
      // パワー = センサーのシェイク強度 ＋ タップ連打（どちらでも走れる）
      tapLevel = Math.max(0, tapLevel - dt * TAP_DECAY);
      const raw = clamp((ctx.motion?.shakeLevel ?? 0) + tapLevel, 0, 1);
      curLevel += (raw - curLevel) * Math.min(1, dt * 12); // 表示の平滑化
      const elapsed = now - started;
      if (elapsed > 1000) minLevelSince = Math.min(minLevelSince, curLevel);

      const dash = inZone(yourDist);
      if (dash) dashFlash = now + 120;
      const speed = (BASE + curLevel * GAIN) * (dash ? DASH_MULT : 1);
      yourDist += speed * dt;

      for (const r of rivals) r.dist = Math.min(TOTAL, r.dist + r.speed * dt);

      if (yourDist >= TOTAL) {
        yourDist = TOTAL;
        finish(now);
      }
    }

    if (mode === 'over' && !ended && now >= endAt) {
      ended = true;
      ctx.end({ score: finishMs });
    }

    draw(now);
  });

  // ---- 描画 ----
  function xOf(dist: number): number {
    return TRACK_L + (clamp(dist, 0, TOTAL) / TOTAL) * (TRACK_R - TRACK_L);
  }

  function draw(now: number): void {
    // 背景
    const grd = g.createLinearGradient(0, 0, 0, H);
    grd.addColorStop(0, '#fff2c9');
    grd.addColorStop(1, '#ffe0a3');
    g.fillStyle = grd;
    g.fillRect(0, 0, W, H);

    // トラック（レーン）
    const lanes = [you.y, rivals[0]?.y ?? 0, rivals[1]?.y ?? 0, rivals[2]?.y ?? 0];
    for (const ly of lanes) {
      g.fillStyle = '#e46a3d';
      g.fillRect(TRACK_L - 8, ly - 26, TRACK_R - TRACK_L + 16, 52);
      g.strokeStyle = 'rgba(255,255,255,.55)';
      g.setLineDash([8, 8]);
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(TRACK_L, ly);
      g.lineTo(TRACK_R, ly);
      g.stroke();
      g.setLineDash([]);
    }

    // ダッシュゾーン（あなたのレーン上に⚡帯）
    for (const z of zones) {
      const x0 = xOf(z.start);
      const x1 = xOf(z.end);
      g.fillStyle = 'rgba(124,108,240,.28)';
      g.fillRect(x0, you.y - 26, x1 - x0, 52);
    }

    // ゴールライン（チェッカー）
    for (let i = 0; i < 8; i++) {
      g.fillStyle = i % 2 === 0 ? '#222' : '#fff';
      g.fillRect(TRACK_R, 150 + i * 30, 8, 15);
      g.fillStyle = i % 2 === 0 ? '#fff' : '#222';
      g.fillRect(TRACK_R, 165 + i * 30, 8, 15);
    }

    // ランナー
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = '30px serif';
    const bob = mode === 'race' ? Math.sin(now / 55) * curLevel * 5 : 0;
    g.fillText(you.emoji, xOf(yourDist), you.y - 4 + bob);
    for (const r of rivals) g.fillText(r.emoji, xOf(r.dist), r.y - 4);

    // 「きみ」ラベル
    g.fillStyle = '#1a3d2f';
    g.font = 'bold 12px sans-serif';
    g.fillText('きみ', xOf(yourDist), you.y + 20);

    drawHud(now);

    if (mode === 'over') {
      g.fillStyle = 'rgba(16,19,48,.72)';
      g.fillRect(0, 0, W, H);
      g.fillStyle = '#fff';
      g.textAlign = 'center';
      g.font = 'bold 40px sans-serif';
      g.fillText('ゴール！', W / 2, H / 2 - 26);
      g.font = 'bold 26px sans-serif';
      g.fillText(fmt(finishMs), W / 2, H / 2 + 22);
    }
  }

  function drawHud(now: number): void {
    // 残り距離＋タイム（左上・右上60×60のポーズ領域は避ける）
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.fillStyle = '#5a3210';
    g.font = 'bold 20px sans-serif';
    g.fillText(`ゴールまで ${Math.ceil(TOTAL - yourDist)}m`, 12, 26);
    g.font = 'bold 26px sans-serif';
    g.fillText(fmt(mode === 'over' ? finishMs : now - started), 12, 58);

    // パワーメーター（下部）
    const mx = 24;
    const mw = W - mx * 2;
    const my = H - 70;
    g.fillStyle = 'rgba(0,0,0,.15)';
    rr(mx, my, mw, 26, 13);
    g.fill();
    const flashing = now < dashFlash;
    g.fillStyle = flashing ? '#7c6cf0' : '#ff7a3d';
    rr(mx, my, Math.max(26, mw * curLevel), 26, 13);
    g.fill();
    g.fillStyle = '#5a3210';
    g.textAlign = 'center';
    g.font = 'bold 14px sans-serif';
    g.fillText(mode === 'race' ? 'スマホをふって！（タップ連打でもOK）' : 'パワー', W / 2, my + 44);
  }

  function fmt(ms: number): string {
    const s = ms / 1000;
    return `${s.toFixed(2)} びょう`;
  }

  // 角丸矩形（現在パスに追加。fill は呼び出し側）
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

  return {
    start() {
      reset();
    },
    pause() {
      /* onFrame と ctx.now はシェルが止める＝期限方式なので処理不要 */
    },
    resume() {
      tapLevel = 0;
    },
    resize() {
      /* design 指定 Canvas は自動レターボックス */
    },
    destroy() {
      offDown();
      offFrame();
    },
  };
}
