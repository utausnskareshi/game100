// =============================================================
// ブロックくずし（No.2）
// =============================================================
// - バーは「ゆびの左右ドラッグ（画面のどこでも）」＋「端末のかたむき（任意）」で操作。
//   指が触れている間はタッチ優先。かたむきは速度マッピング（傾けている間その方向へ動く）
// - ブロックを消すと角丸四角のアイテムが落ち、バーで取るとパワーアップ
// - 5ステージ＋クリア後は速くなって周回。ライフ3
// 契約: import は game-api と同一フォルダのみ / 乱数=ctx.random / 時計=ctx.now
//       右上60×60はポーズボタン領域なのでHUDは左と中央のみ
// =============================================================
import type { GameContext, IGame } from '../../game-api/types';
import { clamp } from '../../game-api/helpers';
import { COLS, STAGES, parseStage, type BlockKind } from './levels';

const W = 360;
const H = 640;

const PADDLE_Y = 596;
const PADDLE_H = 14;
const PADDLE_W_BASE = 76; // 子ども向けに広め（playtestで調整）
const BALL_R = 7;

const BASE_SPEED = 260; // px/s
const MAX_SPEED = 560;
const SUBSTEP = 1 / 120; // 物理の固定刻み（高速時のすり抜け防止）
const MAX_BALLS = 8;

const BLOCK_W = 46;
const BLOCK_H = 20;
const GAP_X = 3;
const GAP_Y = 4;
const SIDE = (W - (COLS * BLOCK_W + (COLS - 1) * GAP_X)) / 2; // 列数は levels.ts の COLS が所有
const TOP = 76;

const ITEM_SIZE = 26;
const ITEM_FALL = 130; // px/s
const START_LIVES = 3;

// かたむき操作（速度マッピング）: デッドゾーンを超えた分に比例してバーが動く。
// tilt はプラットフォームのゲイン適用後の値（1.0 ≒ 端末を約40°傾けた状態）
const TILT_DEADZONE = 0.06;
const TILT_FULL = 0.4; // この傾きで最高速
const TILT_MAX_SPEED = 520; // px/s

type ItemType = 'multi' | 'long' | 'slow' | 'pierce';
type Mode = 'play' | 'clear' | 'over';

interface Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
  stuck: boolean; // バーの上で発射待ち
}

interface Block {
  x: number;
  y: number;
  w: number;
  h: number;
  kind: BlockKind;
  hp: number;
  color: string; // ノーマルブロックの行色（'2'/'*' は描画時に決まるので空文字）
}

interface Item {
  x: number;
  y: number;
  type: ItemType;
}

const ITEM_COLOR: Record<ItemType, string> = {
  multi: '#34d399',
  long: '#38bdf8',
  slow: '#fbbf24',
  pierce: '#c084fc',
};

// アイテムは「角丸四角」で描く（丸だとボールと見分けがつかないため）
const ITEM_LABEL: Record<ItemType, string> = {
  multi: '+2',
  long: '↔',
  slow: '🐢',
  pierce: '⚡',
};

const LONG_MS = 12_000;
const SLOW_MS = 8_000;
const PIERCE_MS = 8_000;

/** 「真上から時計回りの角度」を速度ベクトルへ（-cos が上向きの要。3箇所で共有する規約） */
const velFromUp = (ang: number, sp: number) => ({ vx: Math.sin(ang) * sp, vy: -Math.cos(ang) * sp });

export function createGame(ctx: GameContext): IGame {
  const cv = ctx.canvas2d({ design: { w: W, h: H } });
  const g = cv.ctx;

  // ---- 進行状態 ----
  let mode: Mode = 'play';
  let stageIdx = 0;
  let lap = 0; // 周回（0 = 1しゅうめ）
  let lives = START_LIVES;
  let score = 0;
  let started = false;
  let ended = false;

  let balls: Ball[] = [];
  let blocks: Block[] = [];
  let items: Item[] = [];

  // ---- バー ----
  let paddleX = W / 2;
  let paddleTargetX = W / 2;
  let paddleW = PADDLE_W_BASE;
  let touchId: number | null = null;

  // ---- アイテム効果（ctx.now 基準の期限。ポーズ中は進まない）----
  let longUntil = -1;
  let slowUntil = -1;
  let pierceUntil = -1;

  // ---- そのほか ----
  let paddleHits = 0; // 速度ランプ用
  let combo = 0; // バーにふれずに連続で壊した数
  let drought = 0; // アイテムが出ていない連続破壊数（救済用）
  let itemsCaught = 0;
  let missedInStage = false;
  let launchAt = 0; // 自動発射の時刻
  let bannerUntil = 0; // バナー（ステージ間 / ゲームオーバー）の表示終了時刻
  let bannerText = '';
  let acc = 0; // 物理サブステップの余り

  // ---- ステージ ----
  function loadStage(): void {
    const defs = parseStage(STAGES[stageIdx % STAGES.length] ?? []);
    blocks = defs.map((d) => ({
      x: SIDE + d.col * (BLOCK_W + GAP_X),
      y: TOP + d.row * (BLOCK_H + GAP_Y),
      w: BLOCK_W,
      h: BLOCK_H,
      kind: d.kind,
      hp: d.kind === '2' ? 2 : 1,
      // 行ごとの色はここで一度だけ作る（毎フレーム hsl 文字列を生成しない）
      color: d.kind === '1' ? `hsl(${(200 + d.row * 26) % 360}, 70%, 62%)` : '',
    }));
  }

  function spawnStuckBall(): void {
    balls = [{ x: paddleX, y: PADDLE_Y - BALL_R - 1, vx: 0, vy: 0, stuck: true }];
    launchAt = ctx.now() + 1500;
  }

  function launchStuck(): void {
    if (!started || mode !== 'play') return;
    if (!balls.some((b) => b.stuck)) return;
    const sp = targetSpeed(ctx.now());
    for (const b of balls) {
      if (!b.stuck) continue;
      b.stuck = false;
      const ang = ((ctx.random() * 24 - 12) * Math.PI) / 180; // 真上から少しだけランダム
      const v = velFromUp(ang, sp);
      b.vx = v.vx;
      b.vy = v.vy;
    }
    launchAt = Infinity; // 次に spawnStuckBall されるまで、毎フレームの自動発射チェックを眠らせる
    ctx.sfx('tap');
  }

  function nextStage(): void {
    stageIdx++;
    if (stageIdx >= STAGES.length) {
      stageIdx = 0;
      lap++;
    }
    missedInStage = false;
    combo = 0;
    items = [];
    loadStage();
    spawnStuckBall();
    mode = 'play';
  }

  function stageClear(now: number): void {
    mode = 'clear';
    score += 100;
    balls = []; // バナーの間にボールが落ちないように片づける
    ctx.sfx('success');
    ctx.haptic('success');
    if (!missedInStage) ctx.achieve('no-miss');
    if (stageIdx === 0) ctx.achieve('first-clear');
    if (stageIdx === STAGES.length - 1) {
      score += 300;
      ctx.achieve('all-clear');
      bannerText = `${lap + 2}しゅうめ！ はやくなるよ`;
    } else {
      bannerText = `ステージ ${stageIdx + 2}！`;
    }
    bannerUntil = now + 1400;
  }

  function gameOver(now: number): void {
    mode = 'over';
    bannerText = 'ゲームオーバー';
    bannerUntil = now + 900;
  }

  // ---- 速度・効果 ----
  function targetSpeed(now: number): number {
    const level = stageIdx + lap * STAGES.length;
    let sp = BASE_SPEED * (1 + 0.06 * level) * (1 + 0.03 * Math.floor(paddleHits / 8));
    if (slowUntil > now) sp *= 0.7;
    return Math.min(MAX_SPEED, sp);
  }

  function updateEffects(now: number, dt: number): void {
    const targetW = longUntil > now ? PADDLE_W_BASE * 1.5 : PADDLE_W_BASE;
    paddleW += (targetW - paddleW) * (1 - Math.exp(-10 * dt));
  }

  // ---- バー操作（タッチ優先・かたむきは指を離しているときだけ）----
  function updatePaddle(dt: number): void {
    if (touchId === null && ctx.motion) {
      const t = ctx.motion.tilt.x;
      const a = Math.abs(t);
      if (a > TILT_DEADZONE) {
        const ratio = Math.min(1, (a - TILT_DEADZONE) / (TILT_FULL - TILT_DEADZONE));
        paddleTargetX += Math.sign(t) * ratio * TILT_MAX_SPEED * dt;
      }
    }
    const half = paddleW / 2;
    paddleTargetX = clamp(paddleTargetX, half + 4, W - half - 4);
    paddleX += (paddleTargetX - paddleX) * (1 - Math.exp(-20 * dt));
  }

  // ---- ブロック・アイテム ----
  function damageBlock(index: number, bl: Block): void {
    bl.hp--;
    if (bl.hp > 0) {
      ctx.sfx('tap');
      return;
    }
    blocks.splice(index, 1);
    combo++;
    if (combo >= 10) ctx.achieve('combo-10');
    const base = bl.kind === '2' ? 20 : bl.kind === '*' ? 30 : 10;
    score += base + (combo - 1) * 2;
    ctx.sfx('combo');
    maybeDrop(bl);
  }

  function maybeDrop(bl: Block): void {
    drought++;
    // スターは確定 / 16連続出ていなければ救済 / それ以外は12%（短絡評価で乱数消費順を保つ）
    const drop = bl.kind === '*' || drought >= 16 || ctx.random() < 0.12;
    if (!drop) return;
    drought = 0;
    items.push({ x: bl.x + bl.w / 2, y: bl.y + bl.h / 2, type: pickItem() });
  }

  function pickItem(): ItemType {
    const r = ctx.random();
    if (r < 0.34) return 'multi';
    if (r < 0.62) return 'long';
    if (r < 0.84) return 'slow';
    return 'pierce';
  }

  function applyItem(type: ItemType, now: number): void {
    itemsCaught++;
    if (itemsCaught >= 8) ctx.achieve('item-8');
    score += 30;
    ctx.sfx('powerup');
    ctx.haptic('light');
    if (type === 'multi') {
      const src = balls.find((b) => !b.stuck) ?? balls[0] ?? null;
      const sp = targetSpeed(now);
      for (let n = 0; n < 2 && balls.length < MAX_BALLS; n++) {
        let baseAng = 0;
        if (src && !src.stuck && src.vy < 0) baseAng = Math.atan2(src.vx, -src.vy); // velFromUp の逆変換
        const { vx, vy } = velFromUp(baseAng + (n === 0 ? -0.45 : 0.45), sp);
        balls.push({
          x: src ? src.x : paddleX,
          y: src ? src.y : PADDLE_Y - BALL_R - 1,
          vx,
          vy,
          stuck: false,
        });
      }
      if (balls.length >= 3) ctx.achieve('triple');
    } else if (type === 'long') {
      longUntil = Math.max(longUntil, now) + LONG_MS;
    } else if (type === 'slow') {
      slowUntil = Math.max(slowUntil, now) + SLOW_MS;
    } else {
      pierceUntil = Math.max(pierceUntil, now) + PIERCE_MS;
    }
  }

  // ---- 物理（固定サブステップ。sp/pierce はフレームごとに update() で確定済み）----
  function physicsStep(sp: number, pierce: boolean): void {
    for (let i = balls.length - 1; i >= 0; i--) {
      const b = balls[i];
      if (!b || b.stuck) continue;

      b.x += b.vx * SUBSTEP;
      b.y += b.vy * SUBSTEP;

      // 外周の壁（下はなし）
      if (b.x < BALL_R) {
        b.x = BALL_R;
        b.vx = Math.abs(b.vx);
      } else if (b.x > W - BALL_R) {
        b.x = W - BALL_R;
        b.vx = -Math.abs(b.vx);
      }
      if (b.y < BALL_R) {
        b.y = BALL_R;
        b.vy = Math.abs(b.vy);
      }

      // バーで反射（当たった位置で角度が決まる。垂直から最大65°）
      if (
        b.vy > 0 &&
        b.y + BALL_R >= PADDLE_Y &&
        b.y - BALL_R <= PADDLE_Y + PADDLE_H &&
        Math.abs(b.x - paddleX) <= paddleW / 2 + BALL_R
      ) {
        b.y = PADDLE_Y - BALL_R;
        const off = clamp((b.x - paddleX) / (paddleW / 2 + BALL_R), -1, 1);
        const v = velFromUp(off * ((65 * Math.PI) / 180), sp);
        b.vx = v.vx;
        b.vy = v.vy;
        paddleHits++;
        combo = 0;
        ctx.sfx('tap');
      }

      // ブロック（円と矩形）。つらぬき中は反射せずに壊して進む
      for (let k = blocks.length - 1; k >= 0; k--) {
        const bl = blocks[k];
        if (!bl) continue;
        const cx = clamp(b.x, bl.x, bl.x + bl.w);
        const cy = clamp(b.y, bl.y, bl.y + bl.h);
        const dx = b.x - cx;
        const dy = b.y - cy;
        if (dx * dx + dy * dy > BALL_R * BALL_R) continue;
        damageBlock(k, bl);
        if (!pierce) {
          if (Math.abs(dx) > Math.abs(dy)) {
            b.vx = dx >= 0 ? Math.abs(b.vx) : -Math.abs(b.vx);
            b.x = dx >= 0 ? bl.x + bl.w + BALL_R : bl.x - BALL_R;
          } else {
            b.vy = dy >= 0 ? Math.abs(b.vy) : -Math.abs(b.vy);
            b.y = dy >= 0 ? bl.y + bl.h + BALL_R : bl.y - BALL_R;
          }
          break; // 1サブステップにつき1ブロックまで
        }
      }

      // 下へ落ちた
      if (b.y - BALL_R > H) balls.splice(i, 1);
    }
  }

  // ---- 毎フレーム ----
  function update(now: number, dt: number): void {
    updateEffects(now, dt);
    updatePaddle(dt);

    if (mode === 'over') {
      if (now >= bannerUntil && !ended) {
        ended = true; // 二重 end() を送らない（ホストが弾く前提に頼らない防御）
        ctx.end({ score });
      }
      return;
    }
    if (mode === 'clear') {
      if (now >= bannerUntil) nextStage();
      return;
    }

    // フレームごとに速度目標を確定し、発射待ちはバー追従・飛行中は大きさをそろえる
    // （反射は大きさを保存するので、スロー・加速の反映はフレーム1回で足りる）
    const sp = targetSpeed(now);
    const pierce = pierceUntil > now;
    for (const b of balls) {
      if (b.stuck) {
        b.x = paddleX;
        b.y = PADDLE_Y - BALL_R - 1;
      } else {
        const mag = Math.hypot(b.vx, b.vy) || 1;
        b.vx = (b.vx / mag) * sp;
        b.vy = (b.vy / mag) * sp;
      }
    }
    if (now >= launchAt) launchStuck(); // 発射待ちがなければ何もしない

    acc += dt;
    while (acc >= SUBSTEP) {
      acc -= SUBSTEP;
      physicsStep(sp, pierce);
    }

    // アイテムの落下とキャッチ
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i];
      if (!it) continue;
      it.y += ITEM_FALL * dt;
      if (
        it.y + ITEM_SIZE / 2 >= PADDLE_Y &&
        it.y - ITEM_SIZE / 2 <= PADDLE_Y + PADDLE_H + 6 &&
        Math.abs(it.x - paddleX) <= paddleW / 2 + ITEM_SIZE / 2
      ) {
        items.splice(i, 1);
        applyItem(it.type, now);
      } else if (it.y - ITEM_SIZE / 2 > H) {
        items.splice(i, 1);
      }
    }

    if (blocks.length === 0) {
      stageClear(now);
    } else if (balls.length === 0) {
      lives--;
      missedInStage = true;
      combo = 0;
      ctx.sfx('fail');
      ctx.haptic('error');
      if (lives <= 0) gameOver(now);
      else spawnStuckBall();
    }
  }

  // ---- 描画 ----
  function roundRect(x: number, y: number, w: number, h: number, r: number): void {
    // ネイティブ roundRect（ビルドターゲット es2022 と同世代。半径クランプは仕様側で行われる）
    g.beginPath();
    g.roundRect(x, y, w, h, r);
  }

  function drawBlock(bl: Block, starColor: string): void {
    let color: string;
    if (bl.kind === '2') {
      color = bl.hp >= 2 ? '#64748b' : '#94a3b8'; // かため（1発当てると色がうすくなる）
    } else if (bl.kind === '*') {
      color = starColor; // 点滅色はフレームで共通（draw() で1回だけ作る）
    } else {
      color = bl.color;
    }
    roundRect(bl.x, bl.y, bl.w, bl.h, 5);
    g.fillStyle = color;
    g.fill();
    if (bl.kind === '*') {
      g.fillStyle = 'rgba(120, 80, 0, 0.9)';
      g.font = 'bold 12px sans-serif';
      g.textAlign = 'center';
      g.fillText('★', bl.x + bl.w / 2, bl.y + bl.h / 2 + 4);
    }
  }

  function drawEffectChips(now: number): void {
    const chips: { color: string; label: string; frac: number }[] = [];
    if (longUntil > now) chips.push({ color: ITEM_COLOR.long, label: ITEM_LABEL.long, frac: (longUntil - now) / LONG_MS });
    if (slowUntil > now) chips.push({ color: ITEM_COLOR.slow, label: ITEM_LABEL.slow, frac: (slowUntil - now) / SLOW_MS });
    if (pierceUntil > now)
      chips.push({ color: ITEM_COLOR.pierce, label: ITEM_LABEL.pierce, frac: (pierceUntil - now) / PIERCE_MS });
    let x = 12;
    const y = 54;
    for (const c of chips) {
      roundRect(x, y, 46, 20, 6);
      g.fillStyle = 'rgba(255,255,255,0.14)';
      g.fill();
      g.font = 'bold 12px sans-serif';
      g.textAlign = 'left';
      g.fillStyle = c.color;
      g.fillText(c.label, x + 6, y + 15);
      g.fillRect(x + 24, y + 8, 18 * clamp(c.frac, 0, 1), 4);
      x += 52;
    }
  }

  function draw(now: number): void {
    cv.clear('#101330');

    const starColor = `rgba(250, 204, 21, ${0.72 + 0.28 * Math.sin(now / 220)})`;
    for (const bl of blocks) drawBlock(bl, starColor);

    // アイテム（角丸四角。ボールの丸と見分けがつく形にする）
    for (const it of items) {
      const s = ITEM_SIZE;
      roundRect(it.x - s / 2, it.y - s / 2, s, s, 7);
      g.fillStyle = ITEM_COLOR[it.type];
      g.fill();
      g.fillStyle = 'rgba(20, 24, 50, 0.9)';
      g.font = 'bold 14px sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(ITEM_LABEL[it.type], it.x, it.y + 1);
      g.textBaseline = 'alphabetic';
    }

    // バー（ロングバー中は青くひかる）
    roundRect(paddleX - paddleW / 2, PADDLE_Y, paddleW, PADDLE_H, 7);
    g.fillStyle = longUntil > now ? '#38bdf8' : '#e2e8f0';
    g.fill();

    // ボール（つらぬき中はむらさき）
    const pierce = pierceUntil > now;
    for (const b of balls) {
      g.beginPath();
      g.arc(b.x, b.y, BALL_R, 0, Math.PI * 2);
      g.fillStyle = pierce ? '#c084fc' : '#ffffff';
      g.fill();
    }

    // HUD（右上60×60はポーズボタン領域なので左と中央だけ使う）
    g.fillStyle = '#ffffff';
    g.font = 'bold 16px sans-serif';
    g.textAlign = 'left';
    g.fillText(`スコア ${score}`, 12, 26);
    g.fillStyle = '#f87171';
    g.font = '13px sans-serif';
    g.fillText('❤'.repeat(Math.max(0, lives)), 12, 44);

    g.fillStyle = 'rgba(255,255,255,0.85)';
    g.font = '14px sans-serif';
    g.textAlign = 'center';
    g.fillText(lap > 0 ? `ステージ ${stageIdx + 1}（${lap + 1}しゅうめ）` : `ステージ ${stageIdx + 1}`, W / 2, 26);

    if (combo >= 3 && mode === 'play') {
      g.fillStyle = '#fbbf24';
      g.font = 'bold 15px sans-serif';
      g.fillText(`コンボ ×${combo}`, W / 2, 48);
    }

    drawEffectChips(now);

    if (mode === 'play' && balls.some((b) => b.stuck)) {
      g.fillStyle = 'rgba(255,255,255,0.75)';
      g.font = '14px sans-serif';
      g.textAlign = 'center';
      g.fillText('タップで はっしゃ！', W / 2, PADDLE_Y - 26);
    }

    if (mode !== 'play') {
      g.fillStyle = 'rgba(8, 10, 30, 0.72)';
      roundRect(40, H / 2 - 44, W - 80, 88, 14);
      g.fill();
      g.fillStyle = '#ffffff';
      g.font = 'bold 24px sans-serif';
      g.textAlign = 'center';
      g.fillText(bannerText, W / 2, H / 2 + 9, W - 100); // maxWidth: 「Nしゅうめ！…」が箱からはみ出さない
    }
  }

  // ---- 入力・ループ ----
  const unsubs = [
    ctx.input.onDown((p) => {
      touchId = p.id;
      paddleTargetX = cv.toLocal(p).x;
    }),
    ctx.input.onMove((p) => {
      if (touchId === p.id) paddleTargetX = cv.toLocal(p).x;
    }),
    ctx.input.onUp((p) => {
      if (touchId === p.id) touchId = null;
    }),
    ctx.input.onTap(() => launchStuck()),
    ctx.onFrame((dt) => {
      const now = ctx.now();
      update(now, dt);
      draw(now);
    }),
  ];

  // ---- 初期化 ----
  loadStage();
  spawnStuckBall();
  draw(0); // カウントダウンの後ろにも盤面が見えるように1回だけ描いておく

  return {
    start() {
      started = true;
      launchAt = ctx.now() + 1500;
    },
    pause() {
      // 自前のタイマーはない（すべて ctx.now 基準。onFrame はシェルが止める）
    },
    resume() {
      // ポーズ中に持ち方が変わっていても、いまの持ち方をゼロ点にする
      ctx.motion?.calibrate();
    },
    resize() {
      // design 指定の Canvas は自動調整される
    },
    destroy() {
      for (const off of unsubs) off();
    },
  };
}
