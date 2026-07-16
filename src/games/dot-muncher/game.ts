// =============================================================
// もぐもぐドット（No.53）: 迷路のドットを ぜんぶ食べよう！おばけに つかまるな
// =============================================================
// - 迷路のドットを 食べつくすと ステージクリア（つぎは 少し速く・おばけが増える）。
//   ⭐パワーエサを 食べると フィーバー＝おばけを 食べられる（大得点）。
//   ライフ3。おばけに つかまると ライフ−1。0でおしまい。
// - 迷路・ゴーストの思考は logic.ts（純ロジック・迷路は固定）。乱数は「きまぐれ」ゴーストのみ ctx.random。
// - 全画面 Canvas 描画（HUD・十字ボタンも Canvas に描く＝maze/road-race と同じ方式）。
//   操作は スワイプ（onSwipe）＋画面下の十字ボタン（onTap）。onMove は購読しない。
// - 時間は ctx.now・setTimeout 不使用。
// - import してよいのは game-api（types / helpers）と、このフォルダ内（logic）だけ
import type { GameContext, IGame, SwipeDir } from '../../game-api/types';
import { COLS, DC, DR, ROWS, buildMaze, canGo, chooseGhostDir, gi, type Dir, type MazeInfo } from './logic';

const W = 360;
const H = 640;
const TILE = 26;
const MAZE_W = COLS * TILE; // 338
const MAZE_H = ROWS * TILE; // 286
const OX = Math.round((W - MAZE_W) / 2); // 11
const OY = 60; // HUDの下
const LIVES0 = 3;
const READY_MS = 1500; // 「レディ？」の間
const DYING_MS = 1100;
const CLEAR_MS = 1400;
const END_DELAY = 1600;
const SCORE_HI = 5000;

const DOT_PTS = 10;
const POWER_PTS = 50;
const GHOST_PTS = [200, 400, 800, 1600];
const CLEAR_BONUS = 300;

const DIR_OF: Record<SwipeDir, Dir> = { up: 0, right: 1, down: 2, left: 3 };
const GHOST_COLORS = ['#ff5d5d', '#ff9ce0', '#7ce0ff'];

type Mode = 'ready' | 'play' | 'dying' | 'clear' | 'over';

interface Mover {
  c: number;
  r: number;
  dir: Dir;
  progress: number;
}
interface Ghost extends Mover {
  home: { c: number; r: number };
  eaten: boolean; // 食べられて巣で待機中（目だけ・当たらない）。フィーバー明けに復活する
  color: string;
  kind: 'chase' | 'ambush' | 'random';
  /** プレイ開始から この時間（ms）が過ぎるまで 巣で待機（動かない・つかまえない）。定番の時間差スタート */
  releaseDelay: number;
}

export function createGame(ctx: GameContext): IGame {
  const cv = ctx.canvas2d({ design: { w: W, h: H } });
  const g = cv.ctx;
  const maze: MazeInfo = buildMaze();
  const walls = maze.walls;

  let mode: Mode = 'ready';
  let hostPaused = false;
  let stage = 1;
  let score = 0;
  let lives = LIVES0;
  let dots: Uint8Array = new Uint8Array(COLS * ROWS); // 1=ドット
  let powers: Uint8Array = new Uint8Array(COLS * ROWS); // 1=パワーエサ
  let dotsLeft = 0;
  let player: Mover = { c: 0, r: 0, dir: 3, progress: 0 };
  let playerStopped = true;
  let nextDir: Dir = 3;
  let ghosts: Ghost[] = [];
  let frightenedUntil = 0;
  let ghostEatCount = 0;
  let playStartAt = 0; // 'play' に入った時刻（ゴーストの時間差スタートの基準）
  let phaseUntil = 0; // ready/dying/clear の期限
  let endAt = 0;
  let ended = false;
  let pelletPulse = 0;

  function numGhosts(): number {
    return Math.min(3, stage + 1);
  }

  function loadStageDots(): void {
    dots = new Uint8Array(COLS * ROWS);
    powers = new Uint8Array(COLS * ROWS);
    for (const i of maze.dotCells) dots[i] = 1;
    for (const i of maze.powerCells) powers[i] = 1;
    dotsLeft = maze.dotCells.length + maze.powerCells.length;
  }

  function resetPositions(): void {
    player = { c: maze.playerStart.c, r: maze.playerStart.r, dir: 0, progress: 0 };
    playerStopped = true;
    nextDir = 0;
    ghosts = [];
    const kinds: Ghost['kind'][] = ['chase', 'ambush', 'random'];
    for (let i = 0; i < numGhosts(); i++) {
      const s = maze.ghostStarts[i] ?? maze.ghostStarts[0]!;
      ghosts.push({
        c: s.c,
        r: s.r,
        dir: 0,
        progress: 0,
        home: { c: s.c, r: s.r },
        eaten: false,
        color: GHOST_COLORS[i] ?? '#fff',
        kind: kinds[i] ?? 'random',
        releaseDelay: 1500 + i * 2200, // 1匹目1.5秒→以後2.2秒おきに巣から出る
      });
    }
    frightenedUntil = 0;
    ghostEatCount = 0;
  }

  function startStage(fresh: boolean): void {
    if (fresh) loadStageDots();
    resetPositions();
    mode = 'ready';
    phaseUntil = ctx.now() + READY_MS;
  }

  function setData(): void {
    if (!import.meta.env.DEV) return;
    const r = ctx.root as HTMLElement;
    r.dataset.mode = mode;
    r.dataset.score = String(score);
    r.dataset.lives = String(lives);
    r.dataset.stage = String(stage);
    r.dataset.dotsleft = String(dotsLeft);
    r.dataset.fright = ctx.now() < frightenedUntil ? '1' : '0';
    r.dataset.pc = `${player.c},${player.r}`;
    r.dataset.pdir = String(player.dir);
    r.dataset.pstop = playerStopped ? '1' : '0';
    r.dataset.ghosts = ghosts.map((x) => `${x.c},${x.r},${x.eaten ? 1 : 0}`).join(';');
  }

  // ---- 入力 ----
  const setDir = (d: Dir): void => {
    if (mode !== 'play' || hostPaused) return;
    nextDir = d;
    // 停止中でも すぐ動けるなら動きだす
    if (playerStopped && canGo(walls, player.c, player.r, d)) {
      player.dir = d;
      playerStopped = false;
    }
  };
  const offSwipe = ctx.input.onSwipe((dir) => setDir(DIR_OF[dir]));
  const offTap = ctx.input.onTap((p) => {
    const l = cv.toLocal(p);
    const d = dpadDirAt(l.x, l.y);
    if (d != null) {
      setDir(d);
      ctx.sfx('tap');
    }
  });

  // 十字ボタンの中心と当たり判定
  const DPAD = { x: W / 2, y: 520, arm: 46, half: 26 };
  function dpadDirAt(x: number, y: number): Dir | null {
    const { x: cx, y: cy, arm, half } = DPAD;
    if (Math.abs(x - cx) <= half && y >= cy - arm - half && y < cy - half + 6) return 0; // up
    if (Math.abs(x - cx) <= half && y > cy + half - 6 && y <= cy + arm + half) return 2; // down
    if (Math.abs(y - cy) <= half && x >= cx - arm - half && x < cx - half + 6) return 3; // left
    if (Math.abs(y - cy) <= half && x > cx + half - 6 && x <= cx + arm + half) return 1; // right
    return null;
  }

  // ---- 更新 ----
  function stepPlayer(dt: number): void {
    if (playerStopped) {
      if (canGo(walls, player.c, player.r, nextDir)) {
        player.dir = nextDir;
        playerStopped = false;
      } else return;
    }
    const spd = 4.8 * (1 + (stage - 1) * 0.06);
    player.progress += spd * dt;
    if (player.progress >= 1) {
      player.progress -= 1;
      player.c += DC[player.dir]!;
      player.r += DR[player.dir]!;
      eatAt(player.c, player.r);
      if (canGo(walls, player.c, player.r, nextDir)) player.dir = nextDir;
      if (!canGo(walls, player.c, player.r, player.dir)) {
        player.progress = 0;
        playerStopped = true;
      }
    }
  }

  function eatAt(c: number, r: number): void {
    const i = gi(c, r);
    if (dots[i]) {
      dots[i] = 0;
      dotsLeft--;
      score += DOT_PTS;
      ctx.achieve('first-dot');
      ctx.sfx('tick');
    } else if (powers[i]) {
      powers[i] = 0;
      dotsLeft--;
      score += POWER_PTS;
      frightenedUntil = ctx.now() + Math.max(3000, 6000 - stage * 500);
      ghostEatCount = 0;
      for (const gh of ghosts) gh.eaten = false;
      ctx.sfx('powerup');
      ctx.haptic('medium');
    }
    if (score >= SCORE_HI) ctx.achieve('score-hi');
    if (dotsLeft <= 0) {
      score += CLEAR_BONUS;
      ctx.achieve('clear-stage');
      mode = 'clear';
      phaseUntil = ctx.now() + CLEAR_MS;
      ctx.sfx('medal');
      ctx.haptic('success');
    }
  }

  function playerDir(): Dir {
    return player.dir;
  }

  function ghostTarget(gh: Ghost): { c: number; r: number } {
    if (gh.kind === 'ambush') {
      const d = playerDir();
      return { c: player.c + DC[d]! * 2, r: player.r + DR[d]! * 2 };
    }
    return { c: player.c, r: player.r };
  }

  function ghostActive(gh: Ghost, now: number): boolean {
    return now >= playStartAt + gh.releaseDelay;
  }

  function stepGhost(gh: Ghost, dt: number, now: number): void {
    if (!ghostActive(gh, now)) return; // 巣で待機中は動かない
    if (gh.eaten) return; // 食べられた（目だけ）は巣で待機＝フィーバー明けに復活
    const frightened = ctx.now() < frightenedUntil && !gh.eaten;
    let spd = 4.0 * (1 + (stage - 1) * 0.06);
    if (frightened) spd = 2.8;
    gh.progress += spd * dt;
    if (gh.progress >= 1) {
      gh.progress -= 1;
      gh.c += DC[gh.dir]!;
      gh.r += DR[gh.dir]!;
      if (frightened || gh.kind === 'random') {
        gh.dir = chooseGhostDir(walls, gh.c, gh.r, gh.dir, 0, 0, ctx.random);
      } else {
        const t = ghostTarget(gh);
        gh.dir = chooseGhostDir(walls, gh.c, gh.r, gh.dir, t.c, t.r);
      }
    }
  }

  function rpos(m: Mover): { x: number; y: number } {
    return { x: m.c + DC[m.dir]! * m.progress, y: m.r + DR[m.dir]! * m.progress };
  }

  function checkCollisions(): void {
    const p = rpos(player);
    const now = ctx.now();
    const frightNow = now < frightenedUntil;
    for (const gh of ghosts) {
      if (!ghostActive(gh, now)) continue; // 巣で待機中は つかまえない
      const q = rpos(gh);
      const dist = Math.hypot(p.x - q.x, p.y - q.y);
      if (dist >= 0.55) continue;
      if (frightNow && !gh.eaten) {
        // 食べる
        const pts = GHOST_PTS[Math.min(ghostEatCount, GHOST_PTS.length - 1)]!;
        score += pts;
        ghostEatCount++;
        gh.eaten = true;
        gh.c = gh.home.c;
        gh.r = gh.home.r;
        gh.progress = 0;
        gh.dir = 0;
        ctx.achieve('ghost-eater');
        if (ghostEatCount >= 2) ctx.achieve('ghost-combo');
        if (score >= SCORE_HI) ctx.achieve('score-hi');
        ctx.sfx('combo');
        ctx.haptic('success');
      } else if (!gh.eaten) {
        // つかまった
        lives--;
        ctx.sfx('fail');
        ctx.haptic('error');
        if (lives <= 0) {
          mode = 'over';
          endAt = ctx.now() + END_DELAY;
        } else {
          mode = 'dying';
          phaseUntil = ctx.now() + DYING_MS;
        }
        return;
      }
    }
  }

  // ---- 毎フレーム ----
  const offFrame = ctx.onFrame((dt) => {
    if (hostPaused) return;
    const now = ctx.now();
    pelletPulse += dt;

    if (mode === 'ready') {
      if (now >= phaseUntil) {
        mode = 'play';
        playStartAt = now;
      }
    } else if (mode === 'play') {
      // フィーバーが明けたら「食べられた」印をもどして復活させる（つけっぱなしだと
      // そのおばけが次のパワーエサまで永久に すり抜け＝つかまえてこない）。
      // ただしプレイヤーがすぐ近くにいる間は復活を待つ（明けた瞬間の理不尽な接触死を防ぐ）
      if (now >= frightenedUntil) {
        const p = rpos(player);
        for (const gh of ghosts) {
          if (!gh.eaten) continue;
          const q = rpos(gh);
          if (Math.hypot(p.x - q.x, p.y - q.y) >= 1.5) gh.eaten = false;
        }
      }
      stepPlayer(dt);
      for (const gh of ghosts) stepGhost(gh, dt, now);
      checkCollisions();
    } else if (mode === 'dying') {
      if (now >= phaseUntil) {
        resetPositions();
        mode = 'ready';
        phaseUntil = now + READY_MS;
      }
    } else if (mode === 'clear') {
      if (now >= phaseUntil) {
        stage++;
        if (stage >= 3) ctx.achieve('stage-3');
        startStage(true);
      }
    } else if (mode === 'over') {
      if (!ended && now >= endAt) {
        ended = true;
        ctx.end({ score });
        return;
      }
    }
    draw(now);
    setData();
  });

  // ---- 描画 ----
  function draw(now: number): void {
    g.fillStyle = '#0b0f2e';
    g.fillRect(0, 0, W, H);

    // HUD
    g.fillStyle = '#fff';
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.font = 'bold 22px sans-serif';
    g.fillText(`${score}`, 14, 30);
    g.textAlign = 'right';
    g.font = '20px sans-serif';
    g.fillText(`ステージ${stage}`, W - 14, 30);
    // ライフ
    g.textAlign = 'left';
    for (let i = 0; i < lives; i++) {
      drawMuncher(28 + i * 26, 48, 9, 1, now);
    }

    // 迷路
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const x = OX + c * TILE;
        const y = OY + r * TILE;
        if (walls[gi(c, r)]) {
          g.fillStyle = '#26307a';
          roundRect(x + 2, y + 2, TILE - 4, TILE - 4, 6);
          g.fill();
        } else {
          const i = gi(c, r);
          if (dots[i]) {
            g.fillStyle = '#ffe08a';
            g.beginPath();
            g.arc(x + TILE / 2, y + TILE / 2, 2.6, 0, Math.PI * 2);
            g.fill();
          } else if (powers[i]) {
            const rr = 5 + Math.sin(pelletPulse * 6) * 1.6;
            g.fillStyle = '#ffd54a';
            g.beginPath();
            g.arc(x + TILE / 2, y + TILE / 2, rr, 0, Math.PI * 2);
            g.fill();
          }
        }
      }
    }

    // ゴースト
    const frightNow = now < frightenedUntil;
    const blinkSoon = frightNow && frightenedUntil - now < 1500;
    for (const gh of ghosts) {
      const p = rpos(gh);
      const gx = OX + (p.x + 0.5) * TILE;
      const gy = OY + (p.y + 0.5) * TILE;
      const edible = frightNow && !gh.eaten;
      drawGhost(gx, gy, TILE * 0.42, edible ? (blinkSoon && Math.floor(now / 200) % 2 ? '#fff' : '#3a63ff') : gh.color, gh.eaten, edible);
    }

    // プレイヤー
    const pp = rpos(player);
    drawMuncher(OX + (pp.x + 0.5) * TILE, OY + (pp.y + 0.5) * TILE, TILE * 0.42, player.dir, now);

    // 十字ボタン
    drawDpad();

    // オーバーレイ文言
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    if (mode === 'ready') {
      banner('レディ？', '#ffd54a');
    } else if (mode === 'dying') {
      banner('つかまった…', '#ff8a8a');
    } else if (mode === 'clear') {
      banner('ステージクリア！', '#8affc0');
    } else if (mode === 'over') {
      g.fillStyle = 'rgba(6,10,30,.72)';
      g.fillRect(0, 0, W, H);
      g.fillStyle = '#fff';
      g.font = 'bold 32px sans-serif';
      g.fillText('ゲームオーバー', W / 2, H / 2 - 30);
      g.font = 'bold 24px sans-serif';
      g.fillText(`${score}てん`, W / 2, H / 2 + 14);
    }
  }

  function banner(text: string, color: string): void {
    g.fillStyle = color;
    g.font = 'bold 26px sans-serif';
    g.fillText(text, W / 2, OY + MAZE_H / 2);
  }

  function drawMuncher(x: number, y: number, rad: number, dir: Dir, now: number): void {
    const open = (Math.sin(now / 70) * 0.5 + 0.5) * 0.4 + 0.05; // 口ぱくぱく
    const base = [-Math.PI / 2, 0, Math.PI / 2, Math.PI][dir] ?? 0; // 向き
    g.fillStyle = '#ffd21e';
    g.beginPath();
    g.moveTo(x, y);
    g.arc(x, y, rad, base + open * Math.PI, base - open * Math.PI + Math.PI * 2);
    g.closePath();
    g.fill();
  }

  function drawGhost(x: number, y: number, rad: number, color: string, eaten: boolean, edible: boolean): void {
    if (eaten) {
      // 目だけ（巣にもどる途中）
      g.fillStyle = '#cfe0ff';
      for (const dx of [-rad * 0.4, rad * 0.4]) {
        g.beginPath();
        g.arc(x + dx, y - rad * 0.1, rad * 0.28, 0, Math.PI * 2);
        g.fill();
      }
      return;
    }
    g.fillStyle = color;
    g.beginPath();
    g.arc(x, y - rad * 0.1, rad, Math.PI, 0);
    g.lineTo(x + rad, y + rad * 0.75);
    for (let k = 0; k < 3; k++) {
      g.lineTo(x + rad - (rad * 2 * (k * 2 + 1)) / 6, y + rad * 0.45);
      g.lineTo(x + rad - (rad * 2 * (k * 2 + 2)) / 6, y + rad * 0.75);
    }
    g.closePath();
    g.fill();
    // 目
    g.fillStyle = edible ? '#cfe0ff' : '#fff';
    for (const dx of [-rad * 0.38, rad * 0.38]) {
      g.beginPath();
      g.arc(x + dx, y - rad * 0.15, rad * 0.26, 0, Math.PI * 2);
      g.fill();
    }
    if (!edible) {
      g.fillStyle = '#1b2350';
      for (const dx of [-rad * 0.38, rad * 0.38]) {
        g.beginPath();
        g.arc(x + dx, y - rad * 0.15, rad * 0.13, 0, Math.PI * 2);
        g.fill();
      }
    }
  }

  function drawDpad(): void {
    const { x: cx, y: cy, arm, half } = DPAD;
    const tri = (dir: Dir): void => {
      g.fillStyle = 'rgba(255,255,255,.16)';
      const bx = cx + DC[dir]! * (half + 4);
      const by = cy + DR[dir]! * (half + 4);
      roundRectAt(bx, by, arm, dir);
      g.fill();
      // 矢印
      g.fillStyle = 'rgba(255,255,255,.7)';
      g.beginPath();
      const tip = { x: cx + DC[dir]! * (half + arm - 6), y: cy + DR[dir]! * (half + arm - 6) };
      const back = { x: cx + DC[dir]! * (half + 12), y: cy + DR[dir]! * (half + 12) };
      const perp = { x: DR[dir]! * 12, y: DC[dir]! * 12 };
      g.moveTo(tip.x, tip.y);
      g.lineTo(back.x + perp.x, back.y + perp.y);
      g.lineTo(back.x - perp.x, back.y - perp.y);
      g.closePath();
      g.fill();
    };
    for (const d of [0, 1, 2, 3] as Dir[]) tri(d);
  }
  function roundRectAt(bx: number, by: number, arm: number, dir: Dir): void {
    const horiz = dir === 1 || dir === 3;
    const w = horiz ? arm : 52;
    const h = horiz ? 52 : arm;
    roundRect(bx - w / 2, by - h / 2, w, h, 10);
  }

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

  // ---- 起動 ----
  startStage(true);
  draw(0);
  setData();

  return {
    start() {
      startStage(true);
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
      offSwipe();
      offTap();
      offFrame();
    },
  };
}
