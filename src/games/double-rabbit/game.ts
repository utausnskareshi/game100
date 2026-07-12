// =============================================================
// ダブルうさぎ（No.31）: 左右の親指で2匹のうさぎを同時にあやつる欲張りアクション
// =============================================================
// - 画面が左右2つのサイドに分かれ、それぞれに2列＋うさぎ1匹。
//   左半分をタップ＝左のうさぎが列を切りかえ／右半分をタップ＝右のうさぎ。
// - 🥕にんじんは キャッチしないとライフ−1（みのがし）。🪨いわは 当たるとライフ−1。
//   ＝両サイドで同時に「とる／よける」の逆の判断を迫られるのが難しさの核。
// - ライフ3共有・時間でスピードアップ・ライフ0でおしまい（エンドレス型）。
// - 落下物は spawn.ts（サイド交互・rng注入＝日替わり全員同じ）。時間は ctx.now。
// - マルチタッチは ctx.input.onDown が指ごとに届く契約（PointerInfo.id）で対応。
// - startMode 省略＝シェルの3-2-1のあと start()。
// - import してよいのは game-api（types / helpers）と、このフォルダ内（spawn）だけ
import type { GameContext, IGame } from '../../game-api/types';
import { rollDrop, spawnInterval, fallSpeed, type ItemKind } from './spawn';

const W = 360;
const H = 640;
const MID = W / 2;
/** 各サイドの列の x 座標（[サイド][列]） */
const COL_X: [readonly [number, number], readonly [number, number]] = [
  [46, 134],
  [226, 314],
] as const;
const RY = 552; // うさぎの足もとの y
const BAND_TOP = RY - 18; // キャッチ判定バンド
const BAND_BOTTOM = RY + 26;
const ITEM_R = 17;
const MAX_LIVES = 3;
const LEVEL_MS = 10_000;
const END_DELAY = 1500;
const CARROT_BASE = 10;
const COMBO_STEP = 2;
const COMBO_CAP = 5; // +2×min(combo-1,5)＝最大+10
const SCORE_HI = 600; // 「ダブルキャッチの達人」実績のしきい値（仮）
const SURVIVE_MS = 60_000; // 「いきのこり」実績

interface FallItem {
  side: 0 | 1;
  col: 0 | 1;
  kind: ItemKind;
  y: number;
  vy: number;
  resolved: boolean; // キャッチ/ヒット/通過ずみ
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

  // ---- 状態 ----
  let playing = false;
  let over = false;
  let ended = false;
  let lives = MAX_LIVES;
  let score = 0;
  let combo = 0;
  let carrots = 0;
  let rocksHit = 0;
  let missed = 0;
  let playStart = 0;
  let spawnAt = 0;
  let nextSide: 0 | 1 = 0; // 交互に出す
  let endAt = 0;
  let flashUntil = 0;
  let survived = false;
  const rabbitCol: [0 | 1, 0 | 1] = [0, 1]; // 各サイドのうさぎの現在列
  const rabbitX: [number, number] = [COL_X[0][0], COL_X[1][1]]; // 描画用（lerp）
  const items: FallItem[] = [];
  const pops: Pop[] = [];

  const level = (): number => Math.floor((ctx.now() - playStart) / LEVEL_MS);

  function devState(): void {
    if (!import.meta.env.DEV) return;
    const ds = ctx.root.dataset;
    ds.score = String(score);
    ds.lives = String(lives);
    ds.combo = String(combo);
    ds.carrots = String(carrots);
    ds.rocks = String(rocksHit);
    ds.miss = String(missed);
    ds.lcol = String(rabbitCol[0]);
    ds.rcol = String(rabbitCol[1]);
    ds.lv = String(level());
    ds.over = over ? '1' : '0';
  }

  function reset(): void {
    playing = true;
    over = false;
    ended = false;
    lives = MAX_LIVES;
    score = 0;
    combo = 0;
    carrots = 0;
    rocksHit = 0;
    missed = 0;
    survived = false;
    items.length = 0;
    pops.length = 0;
    rabbitCol[0] = 0;
    rabbitCol[1] = 1;
    rabbitX[0] = COL_X[0][0];
    rabbitX[1] = COL_X[1][1];
    nextSide = 0;
    playStart = ctx.now();
    spawnAt = playStart + 700;
    flashUntil = 0;
  }

  function spawnOne(): void {
    const d = rollDrop(ctx.random, level());
    items.push({ side: nextSide, col: d.col, kind: d.kind, y: -ITEM_R, vy: fallSpeed(level()), resolved: false });
    nextSide = nextSide === 0 ? 1 : 0;
  }

  function addPop(x: number, y: number, text: string, color: string): void {
    pops.push({ x, y, text, color, until: ctx.now() + 650 });
  }

  function loseLife(): void {
    lives--;
    combo = 0;
    flashUntil = ctx.now() + 240;
    ctx.sfx('fail');
    ctx.haptic('error');
    if (lives <= 0) gameOver();
  }

  function onCatchCarrot(it: FallItem): void {
    combo++;
    carrots++;
    const gain = CARROT_BASE + COMBO_STEP * Math.min(combo - 1, COMBO_CAP);
    score += gain;
    addPop(COL_X[it.side][it.col], it.y, `+${gain}`, '#ffffff');
    ctx.sfx('tap');
    ctx.haptic('light');
    if (carrots === 10) ctx.achieve('carrot-10');
    if (carrots === 15 && rocksHit === 0) ctx.achieve('no-rock');
    if (carrots === 30) ctx.achieve('carrot-30');
    if (combo === 15) {
      ctx.sfx('combo');
      ctx.achieve('combo-15');
    }
    if (score >= SCORE_HI) ctx.achieve('score-hi');
  }

  function gameOver(): void {
    if (over) return;
    over = true;
    playing = false;
    endAt = ctx.now() + END_DELAY;
    ctx.sfx('fail');
  }

  // ---- 入力（半分タップ＝そのサイドのうさぎの列を切りかえ。指ごとに届く）----
  const offDown = ctx.input.onDown((p) => {
    if (!playing || over) return;
    const local = cv.toLocal(p);
    const side = local.x < MID ? 0 : 1;
    rabbitCol[side] = rabbitCol[side] === 0 ? 1 : 0;
    ctx.sfx('tick');
    devState();
  });

  // ---- 毎フレーム ----
  const offFrame = ctx.onFrame((dt) => {
    const now = ctx.now();
    if (playing && !over) {
      const lv = level();
      if (!survived && now - playStart >= SURVIVE_MS) {
        survived = true;
        ctx.achieve('survive-60');
      }
      if (now >= spawnAt) {
        spawnOne();
        spawnAt = now + spawnInterval(lv);
      }
      // うさぎの描画位置を目標列へ寄せる
      for (const s of [0, 1] as const) {
        const tx = COL_X[s][rabbitCol[s]];
        rabbitX[s] += (tx - rabbitX[s]) * Math.min(1, dt * 16);
      }
      // 落下・判定
      for (let i = items.length - 1; i >= 0; i--) {
        const it = items[i]!;
        it.y += it.vy * dt;
        if (!it.resolved && it.y >= BAND_TOP && it.y <= BAND_BOTTOM) {
          if (rabbitCol[it.side] === it.col) {
            it.resolved = true;
            if (it.kind === 'carrot') {
              onCatchCarrot(it);
              items.splice(i, 1);
              if (over) break;
              continue;
            } else {
              rocksHit++;
              addPop(COL_X[it.side][it.col], it.y, 'ゴツン!', '#ff8080');
              items.splice(i, 1);
              loseLife();
              if (over) break;
              continue;
            }
          }
        } else if (!it.resolved && it.y > BAND_BOTTOM) {
          it.resolved = true; // うさぎを通過
          if (it.kind === 'carrot') {
            missed++;
            addPop(COL_X[it.side][it.col], RY - 30, 'みのがし…', '#ffd0d8');
            loseLife();
            if (over) break;
          }
        }
        if (it.y - ITEM_R > H) items.splice(i, 1);
      }
    }
    // ポップの寿命
    for (let i = pops.length - 1; i >= 0; i--) {
      const p = pops[i]!;
      if (now >= p.until) pops.splice(i, 1);
    }
    if (over && !ended && now >= endAt) {
      ended = true;
      ctx.end({ score });
    }
    draw(now);
    devState();
  });

  // ---- 描画（固定色＝テーマ非依存）----
  function draw(now: number): void {
    // 空と草原
    const sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#9fd9ff');
    sky.addColorStop(0.72, '#c9efff');
    sky.addColorStop(0.73, '#7ec850');
    sky.addColorStop(1, '#5faa3e');
    g.fillStyle = sky;
    g.fillRect(0, 0, W, H);
    // 列ガイド
    g.strokeStyle = 'rgba(255,255,255,.35)';
    g.lineWidth = 2;
    for (const s of [0, 1] as const) {
      for (const c of [0, 1] as const) {
        g.beginPath();
        g.moveTo(COL_X[s][c], 92);
        g.lineTo(COL_X[s][c], RY + 30);
        g.stroke();
      }
    }
    // 中央のさく（サイドの区切り）
    g.fillStyle = 'rgba(90,60,20,.55)';
    g.fillRect(MID - 3, 84, 6, H - 84);

    // 落下物
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = '34px serif';
    for (const it of items) {
      g.fillText(it.kind === 'carrot' ? '🥕' : '🪨', COL_X[it.side][it.col], it.y);
    }

    // うさぎ（足もとに影）
    for (const s of [0, 1] as const) {
      g.fillStyle = 'rgba(0,0,0,.16)';
      g.beginPath();
      g.ellipse(rabbitX[s], RY + 22, 22, 7, 0, 0, Math.PI * 2);
      g.fill();
      g.font = '40px serif';
      g.fillText('🐰', rabbitX[s], RY);
    }

    // 得点ポップ
    for (const p of pops) {
      const t = Math.max(0, Math.min(1, (p.until - now) / 650));
      g.globalAlpha = t;
      g.fillStyle = p.color;
      g.font = 'bold 18px sans-serif';
      g.fillText(p.text, p.x, p.y - (1 - t) * 22);
    }
    g.globalAlpha = 1;

    // HUD（左上・右上60×60のポーズ領域は避ける）
    g.textAlign = 'left';
    g.font = '20px serif';
    for (let i = 0; i < MAX_LIVES; i++) {
      g.globalAlpha = i < lives ? 1 : 0.25;
      g.fillText('❤️', 10 + i * 24, 26);
    }
    g.globalAlpha = 1;
    g.fillStyle = '#1a3a1a';
    g.font = 'bold 20px sans-serif';
    g.fillText(`${score}`, 10, 56);
    if (combo >= 2) {
      g.textAlign = 'center';
      g.fillStyle = '#d2510f';
      g.font = 'bold 18px sans-serif';
      g.fillText(`コンボ ×${combo}`, MID, 56);
    }

    // 被弾フラッシュ
    if (now < flashUntil) {
      g.globalAlpha = ((flashUntil - now) / 240) * 0.45;
      g.fillStyle = '#ff3b3b';
      g.fillRect(0, 0, W, H);
      g.globalAlpha = 1;
    }

    if (over) {
      g.fillStyle = 'rgba(16,19,48,.72)';
      g.fillRect(0, 0, W, H);
      g.fillStyle = '#fff';
      g.textAlign = 'center';
      g.font = 'bold 38px sans-serif';
      g.fillText('おしまい！', MID, H / 2 - 26);
      g.font = 'bold 22px sans-serif';
      g.fillStyle = '#ffe27a';
      g.fillText(`🥕${carrots}本・${score}点`, MID, H / 2 + 18);
    }
  }

  return {
    start() {
      reset();
    },
    pause() {
      // onFrame と ctx.now はシェルが止める（期限方式）
    },
    resume() {
      // 特別な処理は不要（タップ操作のみ）
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
