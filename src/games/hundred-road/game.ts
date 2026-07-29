// =============================================================
// ひゃくマスの旅（No.100）: サイコロを振らないすごろく
// =============================================================
// - 10×10＝100マスの盤（へび状）を、手札の「歩数カード」で進む。ぴったり100でクリア。全5面。
// - 盤・移動・ソルバ・生成は logic.ts（純ロジック）。こちらは描画・入力・演出だけ。
// - ソルバは3つの役に使う: ①生成の可解性と par ②「つみ」の自動検出 ③ヒント（次の一手）。
// - 操作はカードと下のボタンのタップだけ（盤はタップ対象ではないので 44px 制約の対象外）。
// - スコアは手数ベース＝時間非依存。駒が歩くアニメは見た目だけでロジックに影響しない。
// - import してよいのは game-api（types / helpers）と、このフォルダ内（logic）だけ。
import type { GameContext, IGame, PointerInfo } from '../../game-api/types';
import { clamp } from '../../game-api/helpers';
import {
  GOAL,
  STAGES,
  type Level,
  type St,
  applyCard,
  cellXY,
  initialState,
  makeLevel,
  popcount,
  solve,
} from './logic';

const W = 360;
const H = 640;
const HUD_H = 46;
const CS = 32; // マスの大きさ（タップ対象ではないので小さくてよい）
const BX = (W - CS * 10) / 2;
const BY = 56;
const BW = CS * 10;
const INFO_Y = BY + BW + 20;
const CARD_W = 78;
const CARD_H = 54;
const CARD_GAP = 8;
const CARD_X0 = (W - (CARD_W * 4 + CARD_GAP * 3)) / 2;
const CARD_Y0 = 412;
const CARD_ROW = CARD_H + 8;
const BTN_Y = 548;
const BTN_H = 50;
const BTN_W = 150;

const WARP_MS = 260;
const EFFECT_MS = 300;
const CELEBRATE_MS = 1100;
const END_DELAY = 2400;
const HINT_MS = 2600;
const SCORE_HI = 1500;

// 盤は常に暗くない紙色の固定パレット（テーマ非依存）
const C_BG = '#f3ead6';
const C_CELL_A = '#fbf5e6';
const C_CELL_B = '#ecdfc2';
const C_ROAD = 'rgba(122,100,66,.13)';
const C_LINE = 'rgba(122,100,66,.28)';
const C_TEXT = '#4a3a1e';
const C_DIM = '#8a7550';
const C_HUD = '#3d2f1a';
const C_TOKEN = '#3d7df0';
const C_STAR = '#f0b400';
const C_SPIKE = '#e0483c';
const C_WARP = '#7b5ad0';
const C_GATE = '#6b5a3a';
const C_GOAL = '#2e8f4f';

type Mode = 'play' | 'moving' | 'stuck' | 'solved' | 'done';

interface Anim {
  path: number[];
  stepMs: number;
  startAt: number;
  warpTo?: number;
  star?: number;
  lostCard?: number;
  /** 歩き終わる時刻 */
  walkEnd: number;
  /** ワープ演出の終わり */
  warpEnd: number;
  /** 効果演出の終わり（＝アニメ全体の終わり） */
  end: number;
}

/** カード1枚の「使ったらどうなるか」。状態が変わったときだけ作り直す（毎フレーム計算しない） */
interface Preview {
  owned: boolean;
  legal: boolean;
  /** 着地マス（ワープ・仕掛けの結果込み） */
  dest: number;
  warp: boolean;
  star: boolean;
  spike: boolean;
}

export function createGame(ctx: GameContext): IGame {
  const cv = ctx.canvas2d({ design: { w: W, h: H } });
  const g = cv.ctx;

  let mode: Mode = 'play';
  let started = false;
  let hostPaused = false;
  let ended = false;

  let stage = 0;
  let level: Level = makeLevel(ctx.random, 0);
  let st: St = initialState(level);
  let moves = 0;
  let score = 0;
  let clears = 0;
  let anim: Anim | null = null;
  let phaseUntil = 0;
  let gained = 0; // 直前の面で入った点（クリア演出の表示用）
  let message = '';
  let hintCard = -1;
  let hintUntil = 0;
  let hintUsedHere = false; // この面でヒントを使った（やりなおしても消えない＝抜け道封じ）
  let spikeFreeHere = true; // いまの挑戦でとげを踏んでいない（やりなおしで戻る＝点はその挑戦の内容で決まる）
  let spikeFreeRun = true; // 通しで一度もとげを踏んでいない（実績「とげ知らず」用・やりなおしても戻らない）
  let parAllRun = true; // 通しで全部の面を最少手数でクリアしている
  let lastEvent = '';
  let sparks: { x: number; y: number; r: number; a: number }[] = [];
  /** カードの着地先など「状態が変わったときだけ」計算するもの */
  let previews: Preview[] = [];
  /** いまの状態からの最短手順（空＝もう100に届かない＝つみ）。ヒント・つみ判定・DEV表示で使い回す */
  let solPath: number[] = [];

  function refresh(): void {
    previews = level.cards.map((_, i) => {
      if ((st.hand & (1 << i)) === 0) {
        return { owned: false, legal: false, dest: st.pos, warp: false, star: false, spike: false };
      }
      const mv = applyCard(level, st, i);
      if (!mv) return { owned: true, legal: false, dest: st.pos, warp: false, star: false, spike: false };
      return {
        owned: true,
        legal: true,
        dest: mv.next.pos,
        warp: mv.warpTo !== undefined,
        star: mv.star !== undefined,
        spike: mv.lostCard !== undefined,
      };
    });
    solPath = solve(level, st)?.path ?? [];
  }

  function loadStage(idx: number): void {
    stage = idx;
    level = makeLevel(ctx.random, idx);
    st = initialState(level);
    moves = 0;
    hintUsedHere = false;
    spikeFreeHere = true;
    hintCard = -1;
    hintUntil = 0;
    anim = null;
    message = '';
    mode = 'play';
    refresh();
  }

  function resetStage(): void {
    st = initialState(level);
    moves = 0;
    spikeFreeHere = true;
    hintCard = -1;
    hintUntil = 0;
    anim = null;
    message = 'やりなおし';
    mode = 'play';
    lastEvent = `reset:${stage}`;
    ctx.sfx('tap');
    refresh();
  }

  // ---------- マスと座標 ----------
  const sqX = (sq: number): number => BX + cellXY(sq).x * CS;
  const sqY = (sq: number): number => BY + cellXY(sq).y * CS;
  const sqCX = (sq: number): number => sqX(sq) + CS / 2;
  const sqCY = (sq: number): number => sqY(sq) + CS / 2;
  /** ふりだし（pos=0）は盤の左下マスのさらに下に置く */
  const startCX = BX + CS / 2;
  const startCY = BY + BW + 6;
  const posCX = (p: number): number => (p === 0 ? startCX : sqCX(p));
  const posCY = (p: number): number => (p === 0 ? startCY : sqCY(p));

  function cardRect(i: number): { x: number; y: number; w: number; h: number } {
    const col = i % 4;
    const row = Math.floor(i / 4);
    return { x: CARD_X0 + col * (CARD_W + CARD_GAP), y: CARD_Y0 + row * CARD_ROW, w: CARD_W, h: CARD_H };
  }
  const hintRect = { x: 24, y: BTN_Y, w: BTN_W, h: BTN_H };
  const retryRect = { x: W - 24 - BTN_W, y: BTN_Y, w: BTN_W, h: BTN_H };
  const inRect = (p: { x: number; y: number }, r: { x: number; y: number; w: number; h: number }): boolean =>
    p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;

  // ---------- 手を打つ ----------
  function playCard(ci: number): void {
    if (mode !== 'play') return;
    const mv = applyCard(level, st, ci);
    if (!mv) {
      ctx.sfx('fail');
      const gate = level.cells[level.gateSquare];
      if ((st.hand & (1 << ci)) !== 0) {
        message = `⭐を ${gate?.need ?? 0}こ あつめないと ゲートより先へは 行けない`;
      } else if ((level.initMask & (1 << ci)) === 0) {
        message = 'それは ⭐マスに とまると もらえる カード';
      } else {
        message = 'そのカードは もう つかったよ';
      }
      return;
    }
    const now = ctx.now();
    const steps = mv.path.length;
    const stepMs = clamp(Math.round(420 / steps), 22, 62);
    const walkEnd = now + steps * stepMs;
    const warpEnd = walkEnd + (mv.warpTo !== undefined ? WARP_MS : 0);
    const hasEffect = mv.star !== undefined || mv.lostCard !== undefined;
    anim = {
      path: mv.path,
      stepMs,
      startAt: now,
      warpTo: mv.warpTo,
      star: mv.star,
      lostCard: mv.lostCard,
      walkEnd,
      warpEnd,
      end: warpEnd + (hasEffect ? EFFECT_MS : 0),
    };
    st = mv.next;
    moves++;
    mode = 'moving';
    hintCard = -1;
    message = '';
    if (mv.lostCard !== undefined) {
      spikeFreeHere = false;
      spikeFreeRun = false;
    }
    refresh();
    ctx.sfx('tap');
    ctx.haptic('light');
    lastEvent = `move:${ci}:${mv.path[steps - 1]}${mv.warpTo !== undefined ? `w${mv.warpTo}` : ''}:${moves}`;
  }

  /** アニメが終わったあとの後片づけ（効果音・つみ判定・クリア判定） */
  function settleMove(now: number): void {
    const a = anim;
    anim = null;
    if (a?.star !== undefined) {
      message = '⭐ カードを もらった！';
      ctx.sfx('powerup');
      ctx.haptic('success');
    } else if (a?.lostCard !== undefined) {
      message = '⛔ とげ！ いちばん大きい カードを なくした';
      ctx.sfx('fail');
      ctx.haptic('error');
    } else if (a?.warpTo !== undefined) {
      message = '🌀 ワープ！';
    }
    // ゴール判定を先に見ること: 100 に着いた状態では solPath が空（もう打つ手が無い）なので、
    // 順番を逆にすると クリアが「つみ」と誤判定される
    if (st.pos === GOAL) {
      clearStage(now);
      return;
    }
    // つみ判定は refresh() で計算済みの最短手順を使う（毎回 BFS を回さない）
    if (solPath.length === 0) {
      mode = 'stuck';
      message = 'つみ！ もう 100マスには とどきません';
      ctx.sfx('fail');
      lastEvent = `stuck:${stage}:${moves}`;
      return;
    }
    mode = 'play';
  }

  function clearStage(now: number): void {
    const eff = moves <= level.par;
    const hasSpike = level.cells.some((c) => c && c.kind === 'spike');
    const starsGot = popcount(st.stars);
    let pts = 200 + Math.max(0, level.par + 2 - moves) * 15 + (eff ? 70 : 0) + starsGot * 25;
    // とげボーナスは「いまの挑戦でとげを踏まなかったか」で決まる（やりなおせば取り返せる）。
    // 実績「とげ知らず」の方は通し（spikeFreeRun）で判定するので、やりなおしでは戻らない。
    if (hasSpike && spikeFreeHere) pts += 30;
    if (hintUsedHere) pts = Math.floor(pts * 0.5);
    gained = pts;
    score += pts;
    if (!eff) parAllRun = false;
    clears++;
    if (stage === 0) ctx.achieve('first-clear');
    if (clears >= 3) ctx.achieve('clear-3');
    if (score >= SCORE_HI) ctx.achieve('score-hi');
    mode = 'solved';
    phaseUntil = now + CELEBRATE_MS;
    message = '';
    ctx.sfx('medal');
    ctx.haptic('success');
    lastEvent = `clear:${stage}:${pts}:${moves}/${level.par}`;
  }

  function makeSparks(): void {
    sparks = [];
    for (let i = 0; i < 26; i++) {
      sparks.push({
        x: 30 + ctx.random() * (W - 60),
        y: 90 + ctx.random() * 320,
        r: 4 + ctx.random() * 12,
        a: ctx.random() * Math.PI * 2,
      });
    }
  }

  function useHint(): void {
    if (mode === 'stuck') {
      message = 'もう 100マスには とどきません。やりなおしてね';
      return;
    }
    if (mode !== 'play' || solPath.length === 0) return;
    hintUsedHere = true;
    hintCard = solPath[0]!;
    hintUntil = ctx.now() + HINT_MS;
    message = 'ヒント: 光っている カード（この面は 点が はんぶん）';
    ctx.sfx('tick');
    lastEvent = `hint:${stage}:${hintCard}`;
  }

  // ---------- 入力 ----------
  const offTap = ctx.input.onTap((p: PointerInfo) => {
    if (hostPaused || !started) return;
    const l = cv.toLocal(p);
    if (inRect(l, retryRect)) {
      if (mode === 'play' || mode === 'stuck') resetStage();
      return;
    }
    if (inRect(l, hintRect)) {
      useHint();
      return;
    }
    if (mode !== 'play') return;
    for (let i = 0; i < level.cards.length; i++) {
      if (inRect(l, cardRect(i))) {
        playCard(i);
        return;
      }
    }
  });

  // ---------- 毎フレーム ----------
  const offFrame = ctx.onFrame(() => {
    if (hostPaused || !started) return;
    const now = ctx.now();
    // anim が万一 null でも 'moving' に固まらないようにする（settleMove は null 安全）
    if (mode === 'moving' && (!anim || now >= anim.end)) settleMove(now);
    else if (mode === 'solved' && now >= phaseUntil) {
      if (stage + 1 >= STAGES.length) {
        ctx.achieve('all-clear');
        if (parAllRun) ctx.achieve('par-clear');
        if (spikeFreeRun) ctx.achieve('no-spike');
        makeSparks();
        mode = 'done';
        phaseUntil = now + END_DELAY;
      } else {
        loadStage(stage + 1);
      }
    } else if (mode === 'done' && !ended && now >= phaseUntil) {
      ended = true;
      ctx.end({ score });
      return;
    }
    draw(now);
    setData();
  });

  function setData(): void {
    if (!import.meta.env.DEV) return;
    const r = ctx.root as HTMLElement;
    r.dataset.mode = mode;
    r.dataset.stage = String(stage);
    r.dataset.pos = String(st.pos);
    r.dataset.moves = String(moves);
    r.dataset.par = String(level.par);
    r.dataset.score = String(score);
    r.dataset.stars = `${popcount(st.stars)}/${level.starSquares.length}`;
    r.dataset.cards = level.cards.join(',');
    r.dataset.hand = String(st.hand);
    r.dataset.legal = previews.flatMap((pv, i) => (pv.legal ? [i] : [])).join(',');
    // カードごとの下見（- 手札に無い / g ゲートで不可 / x とげ / s ⭐ / w ワープ / . ふつう）
    r.dataset.prev = previews
      .map((pv) => (!pv.owned ? '-' : !pv.legal ? 'g' : pv.spike ? 'x' : pv.star ? 's' : pv.warp ? 'w' : '.'))
      .join('');
    r.dataset.dest = previews.map((pv) => (pv.owned && pv.legal ? pv.dest : 0)).join(',');
    r.dataset.sol = JSON.stringify(solPath);
    r.dataset.stuck = String(mode === 'stuck');
    r.dataset.last = lastEvent;
  }

  // ---------- 描画ヘルパー ----------
  function roundRect(x: number, y: number, w: number, h: number, r: number): void {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  function drawStar(cx: number, cy: number, rOut: number, color: string): void {
    g.fillStyle = color;
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const rr = i % 2 === 0 ? rOut : rOut * 0.46;
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const px = cx + Math.cos(a) * rr;
      const py = cy + Math.sin(a) * rr;
      if (i === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    }
    g.closePath();
    g.fill();
  }

  function drawSpike(cx: number, cy: number, s: number): void {
    g.fillStyle = C_SPIKE;
    g.beginPath();
    g.moveTo(cx, cy - s);
    g.lineTo(cx + s * 0.92, cy + s * 0.72);
    g.lineTo(cx - s * 0.92, cy + s * 0.72);
    g.closePath();
    g.fill();
  }

  function drawWarpMark(cx: number, cy: number, s: number): void {
    g.strokeStyle = C_WARP;
    g.lineWidth = 2.4;
    g.beginPath();
    g.arc(cx, cy, s, 0.5, Math.PI * 1.75);
    g.stroke();
    g.beginPath();
    g.arc(cx, cy, s * 0.46, Math.PI * 1.1, Math.PI * 2.4);
    g.stroke();
    g.fillStyle = C_WARP;
    g.beginPath();
    g.arc(cx, cy, 1.8, 0, Math.PI * 2);
    g.fill();
  }

  function drawGate(cx: number, cy: number, s: number, open: boolean): void {
    g.strokeStyle = open ? C_GOAL : C_GATE;
    g.lineWidth = 2.4;
    g.beginPath();
    g.arc(cx, cy - s * 0.35, s * 0.5, Math.PI, 0);
    g.stroke();
    g.fillStyle = open ? C_GOAL : C_GATE;
    roundRect(cx - s * 0.72, cy - s * 0.1, s * 1.44, s * 1.0, 2.5);
    g.fill();
  }

  function drawArrowHead(x: number, y: number, ang: number, s: number, color: string): void {
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x - Math.cos(ang - 0.42) * s, y - Math.sin(ang - 0.42) * s);
    g.lineTo(x - Math.cos(ang + 0.42) * s, y - Math.sin(ang + 0.42) * s);
    g.closePath();
    g.fill();
  }

  // ---------- 描画 ----------
  function drawBoard(now: number): void {
    // マス
    for (let sq = 1; sq <= GOAL; sq++) {
      const p = cellXY(sq);
      g.fillStyle = (p.x + p.y) % 2 === 0 ? C_CELL_A : C_CELL_B;
      g.fillRect(BX + p.x * CS, BY + p.y * CS, CS, CS);
    }
    // 道（へび状の一本道）
    g.strokeStyle = C_ROAD;
    g.lineWidth = 15;
    g.lineJoin = 'round';
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(startCX, startCY);
    for (let sq = 1; sq <= GOAL; sq++) g.lineTo(sqCX(sq), sqCY(sq));
    g.stroke();
    g.lineWidth = 1;
    g.strokeStyle = C_LINE;
    g.strokeRect(BX, BY, BW, BW);

    // マスの数字（10の倍数だけ＝小さいマスでも読める）
    g.font = '9px sans-serif';
    g.fillStyle = C_DIM;
    g.textAlign = 'left';
    g.textBaseline = 'top';
    for (let sq = 10; sq < GOAL; sq += 10) g.fillText(String(sq), sqX(sq) + 2, sqY(sq) + 2);

    // ゴール
    g.fillStyle = 'rgba(46,143,79,.18)';
    g.fillRect(sqX(GOAL), sqY(GOAL), CS, CS);
    g.strokeStyle = C_GOAL;
    g.lineWidth = 2;
    g.strokeRect(sqX(GOAL) + 1, sqY(GOAL) + 1, CS - 2, CS - 2);
    g.fillStyle = C_GOAL;
    g.font = 'bold 11px sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('100', sqCX(GOAL), sqCY(GOAL) + 7);
    g.font = 'bold 12px sans-serif';
    g.fillText('ゴール', sqCX(GOAL) + 30, sqCY(GOAL) - 6);

    // ワープの行き先を矢印で見せる（＝運まかせにしない・情報は全部見える）。
    // 行き先が「閉じたゲートの先」のワープは今は使えないので、灰色の点線にして区別する
    const gateCell = level.gateSquare > 0 ? level.cells[level.gateSquare] : undefined;
    const gateClosed = !!gateCell && gateCell.kind === 'gate' && popcount(st.stars) < (gateCell.need ?? 0);
    for (let sq = 1; sq <= GOAL; sq++) {
      const c = level.cells[sq];
      if (!c || c.kind !== 'warp' || c.to === undefined) continue;
      const blocked = gateClosed && c.to > level.gateSquare;
      const x1 = sqCX(sq);
      const y1 = sqCY(sq);
      const x2 = sqCX(c.to);
      const y2 = sqCY(c.to);
      const mx = (x1 + x2) / 2 + (y2 - y1) * 0.16;
      const my = (y1 + y2) / 2 - (x2 - x1) * 0.16;
      g.strokeStyle = blocked ? 'rgba(107,90,58,.45)' : 'rgba(123,90,208,.55)';
      g.lineWidth = 2;
      if (blocked) g.setLineDash([4, 3]);
      g.beginPath();
      g.moveTo(x1, y1);
      g.quadraticCurveTo(mx, my, x2, y2);
      g.stroke();
      g.setLineDash([]);
      drawArrowHead(x2, y2, Math.atan2(y2 - my, x2 - mx), 7, blocked ? 'rgba(107,90,58,.6)' : 'rgba(123,90,208,.85)');
      g.strokeStyle = blocked ? 'rgba(107,90,58,.5)' : 'rgba(123,90,208,.75)';
      g.lineWidth = 1.6;
      g.beginPath();
      g.arc(x2, y2, CS * 0.32, 0, Math.PI * 2);
      g.stroke();
    }

    // 仕掛け
    for (let sq = 1; sq <= GOAL; sq++) {
      const c = level.cells[sq];
      if (!c) continue;
      const cx = sqCX(sq);
      const cy = sqCY(sq);
      if (c.kind === 'warp') drawWarpMark(cx, cy, CS * 0.3);
      else if (c.kind === 'spike') drawSpike(cx, cy, CS * 0.26);
      else if (c.kind === 'star') {
        const taken = c.si !== undefined && (st.stars & (1 << c.si)) !== 0;
        if (taken) {
          g.strokeStyle = 'rgba(240,180,0,.5)';
          g.lineWidth = 1.6;
          g.beginPath();
          g.arc(cx, cy, CS * 0.26, 0, Math.PI * 2);
          g.stroke();
        } else {
          drawStar(cx, cy, CS * 0.34, C_STAR);
        }
      } else if (c.kind === 'gate') {
        const open = popcount(st.stars) >= (c.need ?? 0);
        drawGate(cx, cy, CS * 0.3, open);
        g.fillStyle = open ? C_GOAL : C_GATE;
        g.font = 'bold 9px sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(`⭐${c.need ?? 0}`, cx, cy + CS * 0.44);
      }
    }

    // ふりだし
    g.fillStyle = C_DIM;
    g.font = 'bold 10px sans-serif';
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.fillText('スタート', startCX + 10, startCY);

    // 駒（アニメ中は道すじの途中に描く）
    let tx = posCX(st.pos);
    let ty = posCY(st.pos);
    let warping = 0;
    if (anim) {
      if (now < anim.walkEnd) {
        const i = Math.min(anim.path.length - 1, Math.floor((now - anim.startAt) / anim.stepMs));
        const sq = anim.path[i] ?? st.pos;
        tx = posCX(sq);
        ty = posCY(sq);
      } else if (anim.warpTo !== undefined && now < anim.warpEnd) {
        const t = (now - anim.walkEnd) / WARP_MS;
        const sq = anim.path[anim.path.length - 1] ?? st.pos;
        const x1 = posCX(sq);
        const y1 = posCY(sq);
        tx = x1 + (posCX(anim.warpTo) - x1) * t;
        ty = y1 + (posCY(anim.warpTo) - y1) * t;
        warping = Math.sin(t * Math.PI);
      }
    }
    if (warping > 0) {
      g.strokeStyle = `rgba(123,90,208,${0.8 - warping * 0.4})`;
      g.lineWidth = 2;
      g.beginPath();
      g.arc(tx, ty, 8 + warping * 12, 0, Math.PI * 2);
      g.stroke();
    }
    g.fillStyle = 'rgba(0,0,0,.18)';
    g.beginPath();
    g.ellipse(tx, ty + 8, 9, 3.4, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = C_TOKEN;
    g.beginPath();
    g.arc(tx, ty - 2, 9.5, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#fff';
    g.lineWidth = 2;
    g.stroke();
    g.fillStyle = '#fff';
    g.font = 'bold 9px sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('100', tx, ty - 2);
  }

  function drawCards(now: number): void {
    const glow = hintCard >= 0 && now < hintUntil;
    for (let i = 0; i < level.cards.length; i++) {
      const r = cardRect(i);
      const pv = previews[i];
      const owned = pv?.owned ?? false;
      const usable = owned && (pv?.legal ?? false) && mode === 'play';
      const v = level.cards[i] ?? 0;
      if (!owned) {
        // 使ったカード / ⭐でもらえる予定のカード（位置は動かさない）
        g.setLineDash([4, 3]);
        g.strokeStyle = 'rgba(122,100,66,.4)';
        g.lineWidth = 1.4;
        roundRect(r.x, r.y, r.w, r.h, 9);
        g.stroke();
        g.setLineDash([]);
        const fromStar = (level.initMask & (1 << i)) === 0;
        g.fillStyle = C_DIM;
        g.font = '11px sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        if (fromStar) {
          drawStar(r.x + r.w / 2, r.y + r.h / 2 - 6, 8, 'rgba(240,180,0,.65)');
          g.fillText('でもらえる', r.x + r.w / 2, r.y + r.h / 2 + 13);
        } else {
          g.fillText('つかった', r.x + r.w / 2, r.y + r.h / 2);
        }
        continue;
      }
      // 札
      g.fillStyle = usable ? '#fffdf5' : '#e6dcc6';
      roundRect(r.x, r.y, r.w, r.h, 9);
      g.fill();
      g.strokeStyle = glow && i === hintCard ? '#f0b400' : usable ? '#c2ac80' : 'rgba(122,100,66,.4)';
      g.lineWidth = glow && i === hintCard ? 3.4 : 1.6;
      roundRect(r.x, r.y, r.w, r.h, 9);
      g.stroke();
      // 歩数
      g.fillStyle = usable ? C_TEXT : C_DIM;
      g.font = 'bold 24px sans-serif';
      g.textAlign = 'left';
      g.textBaseline = 'middle';
      g.fillText(String(v), r.x + 9, r.y + 20);
      g.font = '10px sans-serif';
      g.fillText('すすむ', r.x + 9 + (v >= 10 ? 30 : 17), r.y + 24);
      // 行き先（ワープ・仕掛けの結果まで込み）
      g.font = 'bold 11px sans-serif';
      g.textAlign = 'left';
      if (!pv || !pv.legal) {
        // カード幅は 78px しかないので短く（長い説明はタップ時のメッセージで出す）。
        // 「とおれない」は 55px あり、右端のマークと重なるので文字だけにする
        g.fillStyle = C_GATE;
        g.fillText('とおれない', r.x + 9, r.y + 42);
        continue;
      }
      g.fillStyle = pv.dest === GOAL ? C_GOAL : C_DIM;
      g.fillText(`→ ${pv.dest === GOAL ? 'ゴール' : `${pv.dest}マス`}`, r.x + 9, r.y + 42);
      // マークは行き先の文字（最長「→ 99マス」で 57.5px）と重ならない位置に置く
      const mx = r.x + r.w - 11;
      if (pv.warp) drawWarpMark(mx, r.y + 40, 6.5);
      else if (pv.star) drawStar(mx, r.y + 40, 7, C_STAR);
      else if (pv.spike) drawSpike(mx, r.y + 40, 6);
    }
  }

  function drawButton(
    r: { x: number; y: number; w: number; h: number },
    label: string,
    sub: string,
    on: boolean,
    accent: boolean,
  ): void {
    g.fillStyle = accent ? '#f0b400' : on ? '#fffdf5' : '#e6dcc6';
    roundRect(r.x, r.y, r.w, r.h, 12);
    g.fill();
    g.strokeStyle = accent ? '#b8860b' : 'rgba(122,100,66,.5)';
    g.lineWidth = 2;
    roundRect(r.x, r.y, r.w, r.h, 12);
    g.stroke();
    g.fillStyle = on || accent ? C_TEXT : C_DIM;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = 'bold 16px sans-serif';
    g.fillText(label, r.x + r.w / 2, r.y + (sub ? 17 : r.h / 2));
    if (sub) {
      g.font = '10px sans-serif';
      g.fillStyle = on || accent ? C_DIM : 'rgba(138,117,80,.7)';
      g.fillText(sub, r.x + r.w / 2, r.y + 35);
    }
  }

  function draw(now: number): void {
    cv.clear(C_BG);

    // HUD（右上60×60はポーズボタンの予約領域なので触らない）
    g.fillStyle = C_HUD;
    g.fillRect(0, 0, W, HUD_H);
    g.fillStyle = '#fff';
    g.font = 'bold 18px sans-serif';
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.fillText(`${score}てん`, 12, HUD_H / 2);
    g.fillStyle = '#ffe6b0';
    g.font = 'bold 12px sans-serif';
    g.fillText(`ステージ ${stage + 1}/${STAGES.length}`, 104, HUD_H / 2 - 8);
    const starTxt = level.starSquares.length > 0 ? `・⭐${popcount(st.stars)}/${level.starSquares.length}` : '';
    g.fillText(`${moves}手（さいたん ${level.par}）${starTxt}`, 104, HUD_H / 2 + 9);

    drawBoard(now);

    // いまの場所とメッセージ
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = 'bold 13px sans-serif';
    g.fillStyle = mode === 'stuck' ? C_SPIKE : C_TEXT;
    const where = st.pos === 0 ? 'スタート' : `${st.pos}マス`;
    g.fillText(message || `いまは ${where}。ぴったり 100マスに とまろう`, W / 2, INFO_Y);

    drawCards(now);
    drawButton(hintRect, 'ヒント', hintUsedHere ? 'つかった（点はんぶん）' : '点が はんぶんに', mode === 'play', false);
    drawButton(retryRect, 'やりなおし', 'この面を さいしょから', mode === 'play' || mode === 'stuck', mode === 'stuck');

    // 面クリア（カード（412px〜）に被らない高さに置く）
    if (mode === 'solved') {
      const by = INFO_Y - 60;
      g.fillStyle = 'rgba(46,143,79,.92)';
      roundRect(W / 2 - 120, by, 240, 62, 14);
      g.fill();
      g.fillStyle = '#fff';
      g.font = 'bold 22px sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(`ぴったり100！ +${gained}`, W / 2, by + 20);
      g.font = 'bold 12px sans-serif';
      g.fillText(`${moves}手（さいたん ${level.par}）${moves <= level.par ? '・むだなし！' : ''}`, W / 2, by + 46);
    }

    // 全面クリア（100本目の記念演出）
    if (mode === 'done') {
      g.fillStyle = 'rgba(61,47,26,.9)';
      g.fillRect(0, 0, W, H);
      for (const s of sparks) {
        const t = clamp((now - phaseUntil + END_DELAY) / END_DELAY, 0, 1);
        g.strokeStyle = `rgba(255,213,74,${0.85 - t * 0.7})`;
        g.lineWidth = 2;
        for (let k = 0; k < 6; k++) {
          const a = s.a + (k * Math.PI) / 3;
          const rr = s.r * (0.6 + t * 2.4);
          g.beginPath();
          g.moveTo(s.x + Math.cos(a) * rr * 0.4, s.y + Math.sin(a) * rr * 0.4);
          g.lineTo(s.x + Math.cos(a) * rr, s.y + Math.sin(a) * rr);
          g.stroke();
        }
      }
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = '#fff';
      g.font = 'bold 28px sans-serif';
      g.fillText('100マス せいは！', W / 2, H / 2 - 46);
      g.fillStyle = '#ffd54a';
      g.font = 'bold 40px sans-serif';
      g.fillText('100 / 100', W / 2, H / 2 + 2);
      g.fillStyle = '#fff';
      g.font = 'bold 24px sans-serif';
      g.fillText(`${score}てん`, W / 2, H / 2 + 48);
      g.fillStyle = '#ffe6b0';
      g.font = 'bold 14px sans-serif';
      g.fillText('ぜんめん クリア！', W / 2, H / 2 + 84);
    }
  }

  refresh(); // 1面目ぶんのカード表示・最短手順を用意してから最初の描画をする
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
      offTap();
      offFrame();
    },
  };
}
