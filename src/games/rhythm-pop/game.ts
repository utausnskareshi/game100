// =============================================================
// リズムでポン（No.32）: 落ちてくる音符を判定リングでぴったりタップ！
// =============================================================
// - 2レーン。画面の左半分／右半分をタップ＝そのレーンの判定（ボタン相当の巨大タップ域）。
// - ぴったり(±60ms)=100点／ナイス(±140ms)=60点＋コンボボーナス。遠いタップは空振り＝コンボ0。
//   ノートが判定を140ms過ぎたら「みのがし」＝コンボ0（減点はなし）。
// - テンポ3段（ゆっくり88/ふつう104/はやい122 BPM）。譜面は notes.ts（rng注入＝日替わり同一）。
// - ヒット時に ctx.tone で音程が鳴る（左=ド・右=ソ）。ミュートでも遊べる視覚優先設計。
// - 時間はすべて ctx.now の期限方式。startMode:'immediate'＝設定→自前3-2-1（createCountdown）。
// - import してよいのは game-api（types / helpers）と、このフォルダ内（notes）だけ
import type { GameContext, IGame } from '../../game-api/types';
import { elem, makeSeg, createCountdown, type Countdown } from '../../game-api/helpers';
import {
  TEMPOS,
  WINDOW_NICE,
  POINT_PERFECT,
  POINT_NICE,
  makeChart,
  judge,
  type Note,
  type TempoKey,
} from './notes';

type Mode = 'setup' | 'count' | 'play' | 'over';

interface Config {
  tempo: TempoKey;
}

const W = 360;
const H = 640;
const JUDGE_Y = 508; // 判定リングの y
const LANE_X: readonly [number, number] = [92, 268];
const NOTE_R = 23;
const COMBO_STEP = 2;
const COMBO_CAP = 5; // +2×min(combo-1,5)＝最大+10
const END_TAIL = 900; // 最後のノートのあと結果表示までの間(ms)
const END_DELAY = 2000; // 結果表示→結果画面までの余韻(ms)
const SCORE_HI = 4500; // 「リズムチャンピオン」実績のしきい値（仮）
const LANE_FREQ: readonly [number, number] = [262, 392]; // ド・ソ
const LANE_COLOR: readonly [string, string] = ['#58c7ff', '#ffd234'];

interface LiveNote extends Note {
  hit: boolean;
  missed: boolean;
}
interface Flash {
  lane: 0 | 1;
  text: string;
  color: string;
  until: number;
}

export function createGame(ctx: GameContext): IGame {
  const cv = ctx.canvas2d({ design: { w: W, h: H } });
  const g = cv.ctx;

  // ---- 設定（前回テンポ復元。既定ゆっくり）----
  const savedCfg = ctx.load<Partial<Config>>('config');
  const config: Config = {
    tempo: savedCfg?.tempo === 'normal' || savedCfg?.tempo === 'fast' ? savedCfg.tempo : 'slow',
  };

  // ---- 状態 ----
  let mode: Mode = 'setup';
  let hostPaused = false;
  let tempo: TempoKey = config.tempo;
  let notes: LiveNote[] = [];
  let chartStart = 0;
  let score = 0;
  let combo = 0;
  let maxCombo = 0;
  let perfects = 0;
  let nices = 0;
  let misses = 0;
  let whiffs = 0;
  let endAt = 0;
  let ended = false;
  let cd: Countdown | null = null;
  const flashes: Flash[] = [];

  // ---- DOM（設定画面のみ。プレイは全Canvas）----
  const style = document.createElement('style');
  style.textContent = CSS;
  const setupEl = elem('div', 'rp-setup');
  ctx.root.append(style, setupEl);

  function devState(): void {
    if (!import.meta.env.DEV) return;
    const ds = ctx.root.dataset;
    ds.st = mode;
    ds.score = String(score);
    ds.combo = String(combo);
    ds.perfect = String(perfects);
    ds.nice = String(nices);
    ds.miss = String(misses);
    ds.whiff = String(whiffs);
    ds.cs = String(chartStart);
  }

  // ---- 設定画面 ----
  function showSetup(): void {
    mode = 'setup';
    devState();
    setupEl.style.display = '';
    const box = elem('div', 'rp-box');
    box.append(elem('h2', 'rp-h2', 'リズムに のって ポン！'));
    box.append(
      makeSeg(
        'rp',
        'テンポ',
        [
          { v: 'slow', t: 'ゆっくり' },
          { v: 'normal', t: 'ふつう' },
          { v: 'fast', t: 'はやい' },
        ],
        () => config.tempo,
        (v) => {
          config.tempo = v as TempoKey;
        },
      ),
    );
    box.append(
      elem(
        'p',
        'rp-note',
        '上から おちてくる 音符が、下のリングに ぴったり重なった しゅんかんにタップ！左の音符は 画面の左はんぶん、右の音符は 右はんぶんを たたこう。',
      ),
    );
    const start = elem('button', 'rp-btn rp-btn-primary rp-btn-lg', 'はじめる ▶') as HTMLButtonElement;
    start.addEventListener('click', () => startMatch());
    box.append(start);
    setupEl.replaceChildren(box);
  }

  // ---- 開始 ----
  function startMatch(): void {
    ctx.save('config', { ...config });
    tempo = config.tempo;
    notes = makeChart(ctx.random, tempo).map((n) => ({ ...n, hit: false, missed: false }));
    score = 0;
    combo = 0;
    maxCombo = 0;
    perfects = 0;
    nices = 0;
    misses = 0;
    whiffs = 0;
    ended = false;
    flashes.length = 0;
    setupEl.style.display = 'none';
    mode = 'count';
    devState();
    cd = createCountdown({
      onCount: () => ctx.sfx('tick'),
      onGo: (now) => {
        mode = 'play';
        chartStart = now;
        ctx.sfx('start');
        devState();
      },
    });
    cd.start(ctx.now());
  }

  // ---- タップ判定 ----
  const offDown = ctx.input.onDown((p) => {
    if (mode !== 'play' || hostPaused) return;
    const local = cv.toLocal(p);
    const lane: 0 | 1 = local.x < W / 2 ? 0 : 1;
    const now = ctx.now();
    // そのレーンで「判定窓に入っている いちばん早いノート」を探す。
    // 最近傍で選ぶと、連続ノートで遅れタップが次のノートに吸われ、
    // まだ叩けたはずの前のノートが みのがしになる（音ゲーの標準は早い者から消費）。
    let best: LiveNote | null = null;
    let bestAbs = Infinity;
    for (const n of notes) {
      if (n.lane !== lane || n.hit || n.missed) continue;
      const dt = now - (chartStart + n.t); // 正=遅れ
      if (dt > WINDOW_NICE) continue; // 窓を過ぎたノート（みのがし処理待ち）は対象外
      if (dt < -WINDOW_NICE) break; // これ以降は未来すぎる（t昇順なので打ち切り）
      best = n;
      bestAbs = Math.abs(dt);
      break;
    }
    const tier = best ? judge(bestAbs) : null;
    if (!best || !tier) {
      // 空振り: コンボが切れるだけ（減点なし）
      whiffs++;
      combo = 0;
      flashes.push({ lane, text: '', color: 'rgba(255,255,255,.25)', until: now + 160 });
      ctx.haptic('light');
      devState();
      return;
    }
    best.hit = true;
    combo++;
    if (combo > maxCombo) maxCombo = combo;
    const base = tier === 'perfect' ? POINT_PERFECT : POINT_NICE;
    const gain = base + COMBO_STEP * Math.min(combo - 1, COMBO_CAP);
    score += gain;
    if (tier === 'perfect') {
      perfects++;
      ctx.achieve('first-pon');
      if (perfects === 20) ctx.achieve('perfect-20');
    } else {
      nices++;
    }
    const hits = perfects + nices;
    if (tempo === 'fast' && hits === 30) ctx.achieve('fast-clear');
    if (combo === 20) ctx.achieve('combo-20');
    if (score >= SCORE_HI) ctx.achieve('score-hi');
    flashes.push({
      lane,
      text: tier === 'perfect' ? `ぴったり！ +${gain}` : `ナイス +${gain}`,
      color: tier === 'perfect' ? '#ffe27a' : '#bfe7ff',
      until: now + 420,
    });
    ctx.tone?.(LANE_FREQ[lane], tier === 'perfect' ? 160 : 110);
    ctx.haptic(tier === 'perfect' ? 'medium' : 'light');
    if (combo > 0 && combo % 10 === 0) ctx.sfx('combo');
    devState();
  });

  // ---- 終了 ----
  function finish(now: number): void {
    mode = 'over';
    // フルコンボ＝全ノートをヒット・みのがし0・空振り0
    if (misses === 0 && whiffs === 0 && perfects + nices === notes.length && notes.length > 0) {
      ctx.achieve('full-combo');
    }
    endAt = now + END_DELAY;
    ctx.sfx('medal');
    ctx.haptic('success');
    devState();
  }

  // ---- 毎フレーム ----
  const offFrame = ctx.onFrame(() => {
    const now = ctx.now();
    if (mode === 'count') {
      cd?.tick(now);
      draw(now);
      return;
    }
    if (mode === 'play') {
      // みのがし判定
      for (const n of notes) {
        if (n.hit || n.missed) continue;
        if (now > chartStart + n.t + WINDOW_NICE) {
          n.missed = true;
          misses++;
          combo = 0;
          flashes.push({ lane: n.lane, text: 'みのがし…', color: '#ff9aa8', until: now + 380 });
          devState();
        }
      }
      const last = notes[notes.length - 1];
      if (last && now > chartStart + last.t + WINDOW_NICE + END_TAIL) finish(now);
    }
    if (mode === 'over' && !ended && now >= endAt) {
      ended = true;
      ctx.end({ score });
    }
    // フラッシュ寿命
    for (let i = flashes.length - 1; i >= 0; i--) {
      if (now >= flashes[i]!.until) flashes.splice(i, 1);
    }
    draw(now);
  });

  // ---- 描画（固定色のステージ＝テーマ非依存）----
  function draw(now: number): void {
    if (mode === 'setup') return; // 設定画面はDOM
    const p = TEMPOS[tempo];
    const bg = g.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#141833');
    bg.addColorStop(1, '#232b5e');
    g.fillStyle = bg;
    g.fillRect(0, 0, W, H);
    // 中央のレーン区切り
    g.strokeStyle = 'rgba(255,255,255,.12)';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(W / 2, 70);
    g.lineTo(W / 2, H - 46);
    g.stroke();

    // 進行バー
    if (mode !== 'count' && notes.length > 0) {
      const total = notes[notes.length - 1]!.t + WINDOW_NICE + END_TAIL;
      const prog = Math.max(0, Math.min(1, (now - chartStart) / total));
      g.fillStyle = 'rgba(255,255,255,.16)';
      g.fillRect(0, 64, W, 4);
      g.fillStyle = '#7ec6ff';
      g.fillRect(0, 64, W * prog, 4);
    }

    // 判定リング
    for (const lane of [0, 1] as const) {
      g.strokeStyle = LANE_COLOR[lane];
      g.globalAlpha = 0.9;
      g.lineWidth = 4;
      g.beginPath();
      g.arc(LANE_X[lane], JUDGE_Y, NOTE_R + 6, 0, Math.PI * 2);
      g.stroke();
      g.globalAlpha = 1;
    }

    // ノート（判定リングへ落ちてくる）
    if (mode === 'play') {
      for (const n of notes) {
        if (n.hit || n.missed) continue;
        const dt = chartStart + n.t - now; // 正=まだ上
        const y = JUDGE_Y - (dt / p.approachMs) * (JUDGE_Y + NOTE_R + 10);
        if (y < -NOTE_R || y > H + NOTE_R) continue;
        g.fillStyle = LANE_COLOR[n.lane];
        g.beginPath();
        g.arc(LANE_X[n.lane], y, NOTE_R, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = 'rgba(255,255,255,.85)';
        g.beginPath();
        g.arc(LANE_X[n.lane], y, 7, 0, Math.PI * 2);
        g.fill();
      }
    }

    // ヒットフラッシュ・判定テキスト
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const f of flashes) {
      const t = Math.max(0, (f.until - now) / 420);
      if (f.text) {
        g.globalAlpha = t;
        g.fillStyle = f.color;
        g.font = 'bold 19px sans-serif';
        g.fillText(f.text, LANE_X[f.lane], JUDGE_Y - 64 - (1 - t) * 16);
      } else {
        g.globalAlpha = t * 0.5;
        g.strokeStyle = '#ffffff';
        g.lineWidth = 3;
        g.beginPath();
        g.arc(LANE_X[f.lane], JUDGE_Y, NOTE_R + 14, 0, Math.PI * 2);
        g.stroke();
      }
      g.globalAlpha = 1;
    }

    // タップ域のヒント（下部）
    g.fillStyle = 'rgba(255,255,255,.08)';
    g.fillRect(0, JUDGE_Y + 44, W / 2 - 2, H - JUDGE_Y - 52);
    g.fillRect(W / 2 + 2, JUDGE_Y + 44, W / 2 - 2, H - JUDGE_Y - 52);
    g.fillStyle = 'rgba(255,255,255,.55)';
    g.font = 'bold 15px sans-serif';
    g.fillText('ひだり', W * 0.25, (JUDGE_Y + 44 + H - 8) / 2);
    g.fillText('みぎ', W * 0.75, (JUDGE_Y + 44 + H - 8) / 2);

    // HUD（左上・右上60×60は避ける）
    g.textAlign = 'left';
    g.fillStyle = '#fff';
    g.font = 'bold 19px sans-serif';
    g.fillText(`スコア ${score}`, 12, 30);
    if (combo >= 2) {
      g.fillStyle = '#ffd76a';
      g.font = 'bold 17px sans-serif';
      g.fillText(`コンボ ×${combo}`, 12, 56);
    }

    // カウントダウン
    if (mode === 'count' && cd) {
      const c = cd.count;
      if (c > 0) {
        g.fillStyle = '#fff';
        g.textAlign = 'center';
        g.font = 'bold 96px sans-serif';
        g.fillText(String(c), W / 2, H / 2 - 40);
      }
    }

    // 結果
    if (mode === 'over') {
      g.fillStyle = 'rgba(10,14,38,.8)';
      g.fillRect(0, 0, W, H);
      g.textAlign = 'center';
      g.fillStyle = '#fff';
      g.font = 'bold 32px sans-serif';
      g.fillText('えんそう おわり！ 🎵', W / 2, H / 2 - 78);
      g.font = 'bold 21px sans-serif';
      g.fillStyle = '#ffe27a';
      g.fillText(`スコア ${score}`, W / 2, H / 2 - 30);
      g.fillStyle = '#dfe6ff';
      g.font = 'bold 17px sans-serif';
      g.fillText(`ぴったり ${perfects}・ナイス ${nices}・みのがし ${misses}`, W / 2, H / 2 + 8);
      g.fillText(`さいだいコンボ ×${maxCombo}`, W / 2, H / 2 + 38);
      if (misses === 0 && whiffs === 0 && perfects + nices === notes.length) {
        g.fillStyle = '#7ef29a';
        g.fillText('✨ フルコンボ！ ✨', W / 2, H / 2 + 72);
      }
    }
  }

  // ---- 起動（startMode:'immediate'。設定画面から始まる）----
  showSetup();

  return {
    start() {
      // シェルのカウントダウンは省略。設定画面（showSetup）から開始する
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
      style.remove();
      setupEl.remove();
    },
  };
}

// =============================================================
// スタイル（.rp- プレフィックス。設定画面のみDOM）
// =============================================================
const CSS = `
.rp-setup{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:safe center;
  padding:20px 16px;box-sizing:border-box;overflow-y:auto;user-select:none;-webkit-user-select:none;z-index:1}
.rp-box{display:flex;flex-direction:column;align-items:center;gap:14px;width:100%}
.rp-h2{margin:4px 0;font-size:22px;text-align:center}
.rp-seg-row{width:min(92vw,420px);display:flex;flex-direction:column;gap:6px}
.rp-seg-label{font-size:13px;color:var(--text-dim);font-weight:800}
.rp-seg{display:flex;background:var(--bg-elev2);border-radius:12px;padding:3px;gap:2px}
.rp-seg-btn{flex:1;border:none;background:none;color:var(--text-dim);padding:10px 2px;border-radius:9px;
  font-size:13px;font-weight:800;min-height:44px}
.rp-seg-btn.rp-on{background:var(--accent);color:#fff}
.rp-note{font-size:12px;color:var(--text-dim);text-align:center;max-width:min(92vw,420px);margin:0;line-height:1.7}
.rp-btn{appearance:none;border:none;border-radius:12px;padding:12px 18px;font-size:15px;font-weight:800;font-family:inherit;
  background:var(--bg-elev2);color:var(--text);min-height:44px}
.rp-btn-primary{background:var(--accent-grad);color:#fff}
.rp-btn-lg{width:100%;max-width:300px;font-size:18px}
`;
