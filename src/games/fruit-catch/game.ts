// =============================================================
// フルーツキャッチ（No.9）: かたむき（orドラッグ）でカゴを動かして果物をキャッチ
// =============================================================
// - 端末を左右にかたむける＝カゴが動く。センサーがなくても指ドラッグで完全に遊べる
//   （optionalSensors:['motion']・createDragTilt でセンサー＋ドラッグを合成）
// - 🍎果物=得点／💣ばくだん=ライフ−1／⭐ゴールデン=高得点＋ライフ回復。時間で加速
// - 落下は spawn.ts（乱数注入）＝日替わりは全員同じ配置。時間は ctx.now・setTimeout 不使用
// - import してよいのは game-api（types / helpers）と、このフォルダ内（spawn）だけ
import type { GameContext, IGame } from '../../game-api/types';
import { clamp, createDragTilt, type DragTilt } from '../../game-api/helpers';
import { rollSpawn, FRUITS, type ItemKind } from './spawn';

const W = 360;
const H = 640;
const BW = 76; // カゴの横幅
const BH = 30; // カゴの高さ
const BY = H - 74; // カゴ上端の y
const ITEM_R = 18; // 落下物の当たり半径
const MAX_LIVES = 3;
const LEVEL_MS = 10_000; // このミリ秒ごとにレベル+1（加速）
const END_DELAY = 1300; // ゲームオーバー演出→結果画面までの余韻(ms)

interface Item {
  x: number;
  y: number;
  vy: number;
  kind: ItemKind;
  fruit: number;
}
interface Pop {
  x: number;
  y: number;
  text: string;
  color: string;
  until: number;
}

const spawnInterval = (level: number): number => Math.max(430, 950 - level * 80);
const fallSpeed = (level: number): number => Math.min(150 + level * 26, 430);

export function createGame(ctx: GameContext): IGame {
  const cv = ctx.canvas2d({ design: { w: W, h: H } });
  const g = cv.ctx;

  // ---- 状態 ----
  let playing = false; // start() 後〜ゲームオーバーまで
  let over = false;
  let ended = false;
  let lives = MAX_LIVES;
  let score = 0;
  let combo = 0;
  let maxCombo = 0;
  let totalCaught = 0;
  let bombsCaught = 0;
  let goldenCaught = 0;
  let playStart = 0;
  let spawnAt = 0;
  let endAt = 0;
  let flashUntil = 0;
  let basketX = W / 2;
  const items: Item[] = [];
  const pops: Pop[] = [];

  const tiltIn: DragTilt = createDragTilt(ctx, {
    toLocal: (p) => cv.toLocal(p),
    div: 60, // 60px ドラッグ＝端まで
    enabled: () => playing && !over,
  });

  const level = (): number => Math.floor((ctx.now() - playStart) / LEVEL_MS);
  const comboMult = (): number => Math.min(1 + Math.floor(combo / 5), 5);

  function reset(): void {
    playing = true;
    over = false;
    ended = false;
    lives = MAX_LIVES;
    score = 0;
    combo = 0;
    maxCombo = 0;
    totalCaught = 0;
    bombsCaught = 0;
    goldenCaught = 0;
    items.length = 0;
    pops.length = 0;
    basketX = W / 2;
    playStart = ctx.now();
    spawnAt = playStart + 500; // 開始直後に少し間を置く
    flashUntil = 0;
    tiltIn.reset();
    ctx.motion?.calibrate();
  }

  function spawnOne(): void {
    const s = rollSpawn(ctx.random, level());
    items.push({
      x: ITEM_R + s.xFrac * (W - ITEM_R * 2),
      y: -ITEM_R,
      vy: fallSpeed(level()),
      kind: s.kind,
      fruit: s.fruit,
    });
  }

  function addPop(x: number, y: number, text: string, color: string): void {
    pops.push({ x, y, text, color, until: ctx.now() + 700 });
  }

  function onCatch(it: Item): void {
    if (it.kind === 'bomb') {
      lives--;
      combo = 0;
      bombsCaught++;
      flashUntil = ctx.now() + 260;
      ctx.sfx('fail');
      ctx.haptic('error');
      if (lives <= 0) gameOver();
      return;
    }
    // fruit / golden
    const mult = comboMult();
    const gain = it.kind === 'golden' ? 100 : 10 * mult;
    score += gain;
    combo++;
    if (combo > maxCombo) maxCombo = combo;
    totalCaught++;
    addPop(it.x, it.y, `+${gain}`, it.kind === 'golden' ? '#ffd23f' : '#ffffff');
    if (it.kind === 'golden') {
      goldenCaught++;
      if (lives < MAX_LIVES) lives++;
      ctx.sfx('powerup');
      ctx.haptic('success');
      ctx.achieve('golden');
    } else {
      ctx.sfx('tap');
      ctx.haptic('light');
    }
    if (totalCaught === 1) ctx.achieve('first-catch');
    if (totalCaught === 50) ctx.achieve('fifty');
    // ばくだん0のまま1000点＝達したその場で解除（ゲームオーバーは💣3個が前提＝そこで判定すると恒偽になる）
    if (bombsCaught === 0 && score >= 1000) ctx.achieve('no-bomb');
    if (combo === 15) {
      ctx.sfx('combo');
      ctx.achieve('combo-15');
    }
  }

  function gameOver(): void {
    if (over) return;
    over = true;
    playing = false;
    // no-bomb はキャッチ時に live 判定済み（ここは必ず bombsCaught≥3 なので判定しても恒偽）
    ctx.sfx('fail');
    ctx.haptic('error');
    endAt = ctx.now() + END_DELAY;
  }

  // ---- 毎フレーム ----
  const offFrame = ctx.onFrame((dt) => {
    const now = ctx.now();

    if (playing && !over) {
      const lv = level();
      if (lv >= 5) ctx.achieve('survivor'); // レベル5到達＝約50秒生存

      if (now >= spawnAt) {
        spawnOne();
        spawnAt = now + spawnInterval(lv);
      }

      // カゴをかたむき（＋ドラッグ）に追従
      const tx = tiltIn.value().x;
      const target = W / 2 + tx * (W / 2 - BW / 2);
      basketX += (target - basketX) * Math.min(1, dt * 16);
      basketX = clamp(basketX, BW / 2, W - BW / 2);

      // 落下・キャッチ判定
      const catchTop = BY - 6;
      for (let i = items.length - 1; i >= 0; i--) {
        const it = items[i];
        if (!it) continue;
        it.y += it.vy * dt;
        const caught =
          it.y + ITEM_R * 0.5 >= catchTop && it.y <= BY + BH && Math.abs(it.x - basketX) <= BW / 2 + ITEM_R * 0.5;
        if (caught) {
          items.splice(i, 1);
          onCatch(it);
          if (over) break; // ばくだんでゲームオーバーした瞬間、同フレームの残り取得で加点しない
        } else if (it.y - ITEM_R > H) {
          // 取りこぼしはペナルティなし（同時に何個も落ちるので取り切れないのが自然）。
          // コンボは「ばくだんを取るまで」続く＝取りこぼしでは切れない（bombキャッチ時のみ0）
          items.splice(i, 1);
        }
      }
    }

    // 得点ポップの寿命
    for (let i = pops.length - 1; i >= 0; i--) {
      const p = pops[i];
      if (p && now >= p.until) pops.splice(i, 1);
    }

    if (over && !ended && now >= endAt) {
      ended = true;
      ctx.end({ score });
    }

    draw(now);
  });

  // ---- 描画 ----
  function draw(now: number): void {
    // 背景（空のグラデーション・固定色＝テーマ非依存の1シーン）
    const grd = g.createLinearGradient(0, 0, 0, H);
    grd.addColorStop(0, '#8fd6ff');
    grd.addColorStop(1, '#d8f3ff');
    g.fillStyle = grd;
    g.fillRect(0, 0, W, H);
    // 地面
    g.fillStyle = '#7ec850';
    g.fillRect(0, H - 42, W, 42);

    // 落下物
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = '33px serif';
    for (const it of items) {
      const emoji = it.kind === 'bomb' ? '💣' : it.kind === 'golden' ? '⭐' : FRUITS[it.fruit] ?? '🍎';
      g.fillText(emoji, it.x, it.y);
    }

    drawBasket();

    // 得点ポップ（上昇＋フェード）
    for (const p of pops) {
      const t = clamp((p.until - now) / 700, 0, 1);
      g.globalAlpha = t;
      g.fillStyle = p.color;
      g.font = 'bold 20px sans-serif';
      g.fillText(p.text, p.x, p.y - (1 - t) * 26);
    }
    g.globalAlpha = 1;

    drawHud();

    // ばくだん被弾フラッシュ
    if (now < flashUntil) {
      g.globalAlpha = ((flashUntil - now) / 260) * 0.5;
      g.fillStyle = '#ff3b3b';
      g.fillRect(0, 0, W, H);
      g.globalAlpha = 1;
    }

    if (over) {
      g.fillStyle = 'rgba(16,19,48,.72)';
      g.fillRect(0, 0, W, H);
      g.fillStyle = '#fff';
      g.textAlign = 'center';
      g.font = 'bold 40px sans-serif';
      g.fillText('おしまい！', W / 2, H / 2 - 24);
      g.font = 'bold 24px sans-serif';
      g.fillText(`${score} 点`, W / 2, H / 2 + 22);
    }
  }

  function drawBasket(): void {
    const x = basketX;
    // かご本体
    g.fillStyle = '#c8791f';
    rr(g, x - BW / 2, BY, BW, BH, 7);
    g.fill();
    // 網目
    g.strokeStyle = 'rgba(90,50,10,.5)';
    g.lineWidth = 2;
    for (let k = 1; k < 4; k++) {
      g.beginPath();
      g.moveTo(x - BW / 2 + (BW / 4) * k, BY + 3);
      g.lineTo(x - BW / 2 + (BW / 4) * k, BY + BH - 3);
      g.stroke();
    }
    // ふち
    g.fillStyle = '#8a4f14';
    rr(g, x - BW / 2 - 4, BY - 7, BW + 8, 11, 5);
    g.fill();
  }

  function drawHud(): void {
    // ライフ（左上・ポーズボタン領域=右上60×60は避ける）
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.font = '22px serif';
    for (let i = 0; i < MAX_LIVES; i++) {
      g.globalAlpha = i < lives ? 1 : 0.25;
      g.fillText('❤️', 10 + i * 26, 24);
    }
    g.globalAlpha = 1;
    // スコア
    g.fillStyle = '#123';
    g.font = 'bold 22px sans-serif';
    g.fillText(`${score}`, 10, 54);
    // コンボ（中央上）
    if (combo >= 2) {
      g.textAlign = 'center';
      g.fillStyle = '#e0501a';
      g.font = 'bold 20px sans-serif';
      g.fillText(`コンボ ×${combo}（得点×${comboMult()}）`, W / 2, 54);
    }
  }

  // 角丸矩形（Safari 互換のため自前実装）
  function rr(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
    const rad = Math.min(r, w / 2, h / 2);
    c.beginPath();
    c.moveTo(x + rad, y);
    c.arcTo(x + w, y, x + w, y + h, rad);
    c.arcTo(x + w, y + h, x, y + h, rad);
    c.arcTo(x, y + h, x, y, rad);
    c.arcTo(x, y, x + w, y, rad);
    c.closePath();
  }

  // ---- ライフサイクル ----
  return {
    start() {
      reset();
    },
    pause() {
      // onFrame と ctx.now はシェルが止める。描画も止まる（期限方式なので特別な処理は不要）
    },
    resume() {
      tiltIn.reset();
      ctx.motion?.calibrate(); // 再開時に「いまの持ち方」を水平に取り直す
    },
    resize() {
      // design 指定の Canvas は自動レターボックス＝何もしなくてよい
    },
    destroy() {
      offFrame();
      tiltIn.destroy();
    },
  };
}
