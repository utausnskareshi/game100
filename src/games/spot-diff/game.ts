// =============================================================
// まちがいさがし（No.62）: 上と下の絵を くらべて、ちがいを 5つ 見つけよう！
// =============================================================
// - 上=お手本 / 下=まちがい入り。ちがう場所を（どちらの絵でも）タップ。全3シーン。
//   まちがいは すり替え/鏡がえし/大きさ/回転/消える の5種（logic.ts でプロシージャル生成
//   ＝毎回ちがう絵・日替わりは全員同じ）。おてつきは 時間ペナルティ＋ちょっと入力ロック。
// - スコア＝見つけた数×40＋シーンごとの速さボーナス＋ノーヒントボーナス。ゲームオーバーなし。
// - 全画面 Canvas・タップのみ（onTap）。時間は ctx.now・setTimeout 不使用。
// - import してよいのは game-api（types / helpers）と、このフォルダ内（logic）だけ
import type { GameContext, IGame } from '../../game-api/types';
import {
  FIND_PTS,
  NO_HINT_BONUS,
  PANEL_H,
  PANEL_W,
  type RenderParams,
  type Scene,
  alteredParams,
  baseParams,
  bonusFor,
  hitDiff,
  makeScene,
} from './logic';

const W = 360;
const H = 640;
const PANEL_A = { x: 10, y: 64 };
const PANEL_B = { x: 10, y: 312 };
const HINT_BTN = { x: 105, y: 556, w: 150, h: 46 };
const ROUNDS = 3;
const LOCK_MS = 400;
const PENALTY_MS = 4000;
const HINT_MS = 2600;
const BETWEEN_MS = 1700;
const END_DELAY = 1700;
const SCORE_HI = 1000;
const THEME_NAME = { park: 'こうえん', room: 'へや', sea: 'うみ' } as const;

type Phase = 'play' | 'between' | 'over';

export function createGame(ctx: GameContext): IGame {
  const cv = ctx.canvas2d({ design: { w: W, h: H } });
  const g = cv.ctx;

  let phase: Phase = 'play';
  let hostPaused = false;
  let round = 0;
  let scene: Scene = makeScene(0, ctx.random);
  let found: boolean[] = new Array<boolean>(scene.diffs.length).fill(false);
  let score = 0;
  let sceneStartAt = 0;
  let penaltyMs = 0;
  let wrongTaps = 0;
  let hintUsedThisScene = false;
  let hintsUsedTotal = 0;
  let hintUntil = 0;
  let hintDiffIdx = -1;
  let lockUntil = 0;
  let wrongMark: { x: number; y: number; until: number } | null = null;
  let lastBonus = 0;
  let phaseUntil = 0;
  let endAt = 0;
  let ended = false;

  const foundCount = (): number => found.filter(Boolean).length;

  function setData(): void {
    if (!import.meta.env.DEV) return;
    const r = ctx.root as HTMLElement;
    r.dataset.phase = phase;
    r.dataset.round = String(round);
    r.dataset.found = String(foundCount());
    r.dataset.score = String(score);
    r.dataset.wrong = String(wrongTaps);
    r.dataset.hint = String(hintsUsedTotal);
    r.dataset.penalty = String(penaltyMs);
    r.dataset.diffs = scene.diffs
      .map((d, i) => {
        const o = scene.objects[d.idx]!;
        return `${o.x.toFixed(0)},${o.y.toFixed(0)},${found[i] ? 1 : 0},${d.type[0]}`;
      })
      .join(';');
  }

  function startScene(n: number, now: number): void {
    round = n;
    scene = makeScene(n, ctx.random);
    found = new Array<boolean>(scene.diffs.length).fill(false);
    sceneStartAt = now;
    penaltyMs = 0;
    hintUsedThisScene = false;
    hintUntil = 0;
    hintDiffIdx = -1;
    wrongMark = null;
    phase = 'play';
  }

  function completeScene(now: number): void {
    const elapsed = now - sceneStartAt + penaltyMs;
    lastBonus = bonusFor(elapsed);
    score += lastBonus;
    if (!hintUsedThisScene) score += NO_HINT_BONUS;
    ctx.achieve('scene-clear');
    if (score >= SCORE_HI) ctx.achieve('score-hi');
    ctx.sfx('medal');
    ctx.haptic('success');
    if (round >= ROUNDS - 1) {
      ctx.achieve('all-clear');
      if (hintsUsedTotal === 0) ctx.achieve('no-hint');
      if (wrongTaps === 0) ctx.achieve('sharp-eye');
      phase = 'over';
      endAt = now + BETWEEN_MS + END_DELAY;
    } else {
      phase = 'between';
      phaseUntil = now + BETWEEN_MS;
    }
  }

  // ---- 入力 ----
  const offTap = ctx.input.onTap((p) => {
    if (phase !== 'play' || hostPaused) return;
    const now = ctx.now();
    const l = cv.toLocal(p);
    // ヒントボタン
    if (l.x >= HINT_BTN.x && l.x <= HINT_BTN.x + HINT_BTN.w && l.y >= HINT_BTN.y && l.y <= HINT_BTN.y + HINT_BTN.h) {
      if (!hintUsedThisScene && foundCount() < scene.diffs.length) {
        hintUsedThisScene = true;
        hintsUsedTotal++;
        hintDiffIdx = found.findIndex((f) => !f);
        hintUntil = now + HINT_MS;
        ctx.sfx('tick');
      }
      return;
    }
    // どちらのパネルか
    let local: { x: number; y: number } | null = null;
    for (const pn of [PANEL_A, PANEL_B]) {
      if (l.x >= pn.x && l.x <= pn.x + PANEL_W && l.y >= pn.y && l.y <= pn.y + PANEL_H) {
        local = { x: l.x - pn.x, y: l.y - pn.y };
        break;
      }
    }
    if (!local) return;
    if (now < lockUntil) return;
    const di = hitDiff(scene, local.x, local.y);
    if (di >= 0 && !found[di]) {
      found[di] = true;
      score += FIND_PTS;
      ctx.achieve('first-find');
      if (score >= SCORE_HI) ctx.achieve('score-hi');
      ctx.sfx('success');
      ctx.haptic('light');
      if (foundCount() >= scene.diffs.length) completeScene(now);
    } else if (di < 0) {
      // おてつき: 時間ペナルティ＋入力ロック（連打さがし防止）
      wrongTaps++;
      penaltyMs += PENALTY_MS;
      lockUntil = now + LOCK_MS;
      wrongMark = { x: local.x, y: local.y, until: now + 600 };
      ctx.sfx('fail');
      ctx.haptic('error');
    }
  });

  // ---- 毎フレーム ----
  const offFrame = ctx.onFrame(() => {
    if (hostPaused) return;
    const now = ctx.now();
    if (phase === 'between' && now >= phaseUntil) startScene(round + 1, now);
    else if (phase === 'over' && !ended && now >= endAt) {
      ended = true;
      ctx.end({ score });
      return;
    }
    draw(now);
    setData();
  });

  // ---- 描画 ----
  function draw(now: number): void {
    g.fillStyle = '#20304a';
    g.fillRect(0, 0, W, H);

    // HUD
    g.fillStyle = '#fff';
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.font = 'bold 20px sans-serif';
    g.fillText(`${score}てん`, 12, 30);
    g.textAlign = 'center';
    g.font = 'bold 15px sans-serif';
    g.fillText(`だい${round + 1}もん（${THEME_NAME[scene.theme]}）  ${foundCount()}/${scene.diffs.length}`, 172, 54);
    g.font = 'bold 13px sans-serif';
    g.fillStyle = '#9fb4d8';
    g.fillText('うえと したで ちがうところを タップ！', 172, 30);

    // パネル
    drawPanel(PANEL_A.x, PANEL_A.y, false, now);
    drawPanel(PANEL_B.x, PANEL_B.y, true, now);

    // ヒントボタン
    const hintLeft = hintUsedThisScene ? 0 : 1;
    g.fillStyle = hintLeft ? '#7c6cf0' : 'rgba(124,108,240,.35)';
    roundRect(HINT_BTN.x, HINT_BTN.y, HINT_BTN.w, HINT_BTN.h, 12);
    g.fill();
    g.fillStyle = '#fff';
    g.font = 'bold 16px sans-serif';
    g.textAlign = 'center';
    g.fillText(`💡 ヒント（のこり${hintLeft}）`, HINT_BTN.x + HINT_BTN.w / 2, HINT_BTN.y + HINT_BTN.h / 2 + 1);

    // シーンクリア／おわり
    if (phase === 'between' || phase === 'over') {
      g.fillStyle = 'rgba(10,16,30,.55)';
      g.fillRect(0, 0, W, H);
      g.fillStyle = '#ffe08a';
      g.textAlign = 'center';
      g.font = 'bold 28px sans-serif';
      const noHintTxt = hintUsedThisScene ? '' : ` +${NO_HINT_BONUS}`;
      g.fillText(phase === 'over' && now >= endAt - END_DELAY ? 'ぜんぶ みつけた！' : 'シーンクリア！', W / 2, H / 2 - 34);
      g.fillStyle = '#fff';
      g.font = 'bold 20px sans-serif';
      g.fillText(`はやさボーナス +${lastBonus}${noHintTxt}`, W / 2, H / 2 + 4);
      if (phase === 'over') {
        g.font = 'bold 24px sans-serif';
        g.fillText(`ごうけい ${score}てん`, W / 2, H / 2 + 42);
      }
    }
  }

  function drawPanel(px: number, py: number, altered: boolean, now: number): void {
    g.save();
    g.translate(px, py);
    g.beginPath();
    g.rect(0, 0, PANEL_W, PANEL_H);
    g.clip();
    drawBackground();
    // オブジェクト
    for (let i = 0; i < scene.objects.length; i++) {
      const o = scene.objects[i]!;
      const d = altered ? scene.diffs.find((dd) => dd.idx === i) : undefined;
      const prm: RenderParams = altered ? alteredParams(o, d) : baseParams(o);
      if (prm.hidden) continue;
      g.save();
      g.translate(o.x, o.y);
      if (prm.rot !== 0) g.rotate(prm.rot);
      if (prm.flip) g.scale(-1, 1);
      g.font = `${prm.size}px sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(prm.emoji, 0, 0);
      g.restore();
    }
    // 見つけたまちがいの丸
    for (let i = 0; i < scene.diffs.length; i++) {
      if (!found[i]) continue;
      const o = scene.objects[scene.diffs[i]!.idx]!;
      g.strokeStyle = '#ff4a4a';
      g.lineWidth = 3.5;
      g.beginPath();
      g.arc(o.x, o.y, Math.max(24, o.size * 0.75), 0, Math.PI * 2);
      g.stroke();
    }
    // ヒントの光る輪
    if (hintDiffIdx >= 0 && !found[hintDiffIdx] && now < hintUntil) {
      const o = scene.objects[scene.diffs[hintDiffIdx]!.idx]!;
      g.strokeStyle = `rgba(255,213,74,${0.5 + 0.4 * Math.sin(now / 90)})`;
      g.lineWidth = 5;
      g.beginPath();
      g.arc(o.x, o.y, 34 + Math.sin(now / 140) * 4, 0, Math.PI * 2);
      g.stroke();
    }
    // おてつきの✖
    if (wrongMark && now < wrongMark.until) {
      g.strokeStyle = '#ff6b6b';
      g.lineWidth = 4;
      g.lineCap = 'round';
      const { x, y } = wrongMark;
      g.beginPath();
      g.moveTo(x - 10, y - 10);
      g.lineTo(x + 10, y + 10);
      g.moveTo(x + 10, y - 10);
      g.lineTo(x - 10, y + 10);
      g.stroke();
    }
    g.restore();
    // 枠
    g.strokeStyle = '#e8ecf8';
    g.lineWidth = 2;
    g.strokeRect(px, py, PANEL_W, PANEL_H);
  }

  function drawBackground(): void {
    if (scene.theme === 'park') {
      const sky = g.createLinearGradient(0, 0, 0, PANEL_H * 0.62);
      sky.addColorStop(0, '#aadcf7');
      sky.addColorStop(1, '#d8f0fb');
      g.fillStyle = sky;
      g.fillRect(0, 0, PANEL_W, PANEL_H * 0.62);
      g.fillStyle = '#9fd08a';
      g.fillRect(0, PANEL_H * 0.62, PANEL_W, PANEL_H * 0.38);
      // おひさま・くも・さく（かざり＝両パネル共通）
      g.fillStyle = '#ffd54a';
      g.beginPath();
      g.arc(34, 28, 15, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = 'rgba(255,255,255,.85)';
      for (const [cx, cy] of [[120, 26], [240, 40]] as const) {
        g.beginPath();
        g.ellipse(cx, cy, 26, 10, 0, 0, Math.PI * 2);
        g.fill();
      }
      g.strokeStyle = '#b98a4a';
      g.lineWidth = 3;
      for (let x = 20; x < PANEL_W; x += 45) {
        g.beginPath();
        g.moveTo(x, PANEL_H - 26);
        g.lineTo(x, PANEL_H - 6);
        g.stroke();
      }
    } else if (scene.theme === 'room') {
      g.fillStyle = '#f4e6cc';
      g.fillRect(0, 0, PANEL_W, PANEL_H * 0.68);
      g.fillStyle = '#c9995e';
      g.fillRect(0, PANEL_H * 0.68, PANEL_W, PANEL_H * 0.32);
      // まど・ラグ
      g.fillStyle = '#bfe3f7';
      g.fillRect(24, 18, 70, 52);
      g.strokeStyle = '#8a6a3a';
      g.lineWidth = 4;
      g.strokeRect(24, 18, 70, 52);
      g.beginPath();
      g.moveTo(59, 18);
      g.lineTo(59, 70);
      g.stroke();
      g.fillStyle = 'rgba(224,72,60,.35)';
      g.beginPath();
      g.ellipse(PANEL_W / 2, PANEL_H - 26, 84, 20, 0, 0, Math.PI * 2);
      g.fill();
    } else {
      const sky = g.createLinearGradient(0, 0, 0, PANEL_H * 0.4);
      sky.addColorStop(0, '#aadcf7');
      sky.addColorStop(1, '#e2f4fc');
      g.fillStyle = sky;
      g.fillRect(0, 0, PANEL_W, PANEL_H * 0.4);
      const seaG = g.createLinearGradient(0, PANEL_H * 0.4, 0, PANEL_H * 0.78);
      seaG.addColorStop(0, '#3aa5dd');
      seaG.addColorStop(1, '#1f7db2');
      g.fillStyle = seaG;
      g.fillRect(0, PANEL_H * 0.4, PANEL_W, PANEL_H * 0.38);
      g.fillStyle = '#eed9a0';
      g.fillRect(0, PANEL_H * 0.78, PANEL_W, PANEL_H * 0.22);
      g.strokeStyle = 'rgba(255,255,255,.55)';
      g.lineWidth = 2;
      for (const wy of [PANEL_H * 0.5, PANEL_H * 0.62]) {
        g.beginPath();
        for (let x = 0; x <= PANEL_W; x += 24) {
          g.moveTo(x, wy);
          g.quadraticCurveTo(x + 6, wy - 4, x + 12, wy);
        }
        g.stroke();
      }
    }
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

  draw(0);
  setData();

  return {
    start() {
      // シーンは createGame 時に生成済み（rng を二重消費しない）。タイマーだけ開始
      sceneStartAt = ctx.now();
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
