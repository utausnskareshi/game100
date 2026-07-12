// =============================================================
// もぐらポンポン（No.22）: 穴から出てくるもぐらをタップ！60秒のスコアアタック
// =============================================================
// - 🐹もぐら=得点＋コンボ／✨金もぐら=大得点／💣ばくだん=たたくとコンボ0（減点なし・calc-rush方針）
// - 時間経過で出現が速く・同時数が増える。出現列は spawn.ts（rng注入＝日替わり同一）
// - もぐらの絵は端末非依存の自作SVG（もぐら絵文字が存在しないため。slide-puzzle の内蔵SVG方式）
// - 時間はすべて ctx.now 期限方式（setTimeout 不使用）
// - import してよいのは game-api（types / helpers）と、このフォルダ内(spawn)だけ
import type { GameContext, IGame } from '../../game-api/types';
import { elem, makeSeg, createCountdown, type Countdown } from '../../game-api/helpers';
import { rollSpawn, type MoleKind } from './spawn';

type PresetKey = 'easy' | 'normal' | 'hard';
type Mode = 'setup' | 'count' | 'play' | 'over';

interface Config {
  diff: PresetKey;
}

const HOLES = 9; // 3×3
const DURATION = 60_000;
const END_DELAY = 1800;
const LEVEL_MS = 10_000; // このミリ秒ごとにレベル+1（最大5）
const MOLE_PTS = 10;
const GOLD_PTS = 50;
const COMBO_STEP = 2; // +2×min(コンボ-1,5)＝最大+10（calc-rush と同式）
const COMBO_CAP = 5;
const SCORE_HI = 1000; // score-hi 実績のしきい値（仮）
const NO_BOMB_COUNT = 25; // no-bomb 実績: 💣0でこの匹数

// むずかしさ別パラメータ（playtest調整前提の仮値）
const DIFFS: Record<
  PresetKey,
  { interval: (lv: number) => number; uptime: (lv: number) => number; maxSimul: (lv: number) => number }
> = {
  easy: {
    interval: (lv) => Math.max(560, 900 - lv * 66),
    uptime: (lv) => Math.max(820, 1150 - lv * 66),
    maxSimul: (lv) => (lv >= 3 ? 2 : 1),
  },
  normal: {
    interval: (lv) => Math.max(450, 760 - lv * 60),
    uptime: (lv) => Math.max(660, 990 - lv * 66),
    maxSimul: (lv) => 1 + (lv >= 2 ? 1 : 0) + (lv >= 4 ? 1 : 0),
  },
  hard: {
    interval: (lv) => Math.max(380, 640 - lv * 52),
    uptime: (lv) => Math.max(560, 860 - lv * 60),
    maxSimul: (lv) => 2 + (lv >= 3 ? 1 : 0),
  },
};

// ---- 自作SVG（データURI・端末非依存） ----
const svgUri = (s: string): string => `url("data:image/svg+xml,${encodeURIComponent(s)}")`;
const MOLE_SVG = svgUri(
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><ellipse cx='50' cy='58' rx='36' ry='36' fill='#8a5a3b'/><ellipse cx='50' cy='72' rx='20' ry='14' fill='#a97c54'/><circle cx='38' cy='48' r='5' fill='#241a12'/><circle cx='62' cy='48' r='5' fill='#241a12'/><ellipse cx='50' cy='60' rx='8' ry='6' fill='#f2a0ae'/><path d='M28 36 L18 30 M30 46 L18 44 M72 36 L82 30 M70 46 L82 44' stroke='#241a12' stroke-width='2.5' stroke-linecap='round'/></svg>",
);
const GOLD_SVG = svgUri(
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><ellipse cx='50' cy='58' rx='36' ry='36' fill='#e0a92f'/><ellipse cx='50' cy='72' rx='20' ry='14' fill='#f4d478'/><circle cx='38' cy='48' r='5' fill='#403010'/><circle cx='62' cy='48' r='5' fill='#403010'/><ellipse cx='50' cy='60' rx='8' ry='6' fill='#ffce9e'/><polygon points='50,6 54,16 64,16 56,22 59,32 50,26 41,32 44,22 36,16 46,16' fill='#ffe27a'/></svg>",
);
const BOMB_SVG = svgUri(
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><circle cx='50' cy='62' r='30' fill='#23252e'/><circle cx='40' cy='52' r='8' fill='#3d4152'/><rect x='44' y='26' width='12' height='12' rx='3' fill='#5a5f6e'/><path d='M50 26 Q56 12 70 14' stroke='#8a5a3b' stroke-width='4' fill='none' stroke-linecap='round'/><polygon points='70,14 76,6 78,14 86,12 79,19 84,24 74,22 72,30 68,20' fill='#ffd23f'/></svg>",
);

export function createGame(ctx: GameContext): IGame {
  const saved = ctx.load<Partial<Config>>('config');
  const config: Config = {
    diff: saved?.diff === 'easy' || saved?.diff === 'hard' ? saved.diff : 'normal',
  };

  // ---- 状態 ----
  let mode: Mode = 'setup';
  let hostPaused = false;
  let diff: PresetKey = config.diff;
  let score = 0;
  let combo = 0;
  let moleCount = 0; // たたいた もぐら＋金
  let bombsHit = 0;
  let playStart = 0;
  let nextSpawnAt = 0;
  let lastSec = -1;
  let endAt = 0;
  let ended = false;
  let cd: Countdown | null = null;
  // 穴ごとの出現状態（null=空）
  const active: ({ kind: MoleKind; hideAt: number } | null)[] = new Array(HOLES).fill(null);

  // ---- DOM ----
  const style = document.createElement('style');
  style.textContent = CSS;
  const wrap = elem('div', 'mp-wrap');
  ctx.root.append(style, wrap);

  let timeEl: HTMLElement | null = null;
  let scoreEl: HTMLElement | null = null;
  let comboEl: HTMLElement | null = null;
  let fieldEl: HTMLElement | null = null;
  let countEl: HTMLElement | null = null;
  let holeBtns: HTMLButtonElement[] = [];
  let moleEls: HTMLElement[] = [];

  const level = (): number => Math.min(5, Math.floor((ctx.now() - playStart) / LEVEL_MS));

  // ---- 設定画面 ----
  function showSetup(): void {
    mode = 'setup';
    if (import.meta.env.DEV) wrap.dataset.st = 'setup';
    const box = elem('div', 'mp-setup');
    box.append(elem('h2', 'mp-h2', 'もぐらを ポンポン たたこう！'));
    box.append(
      makeSeg(
        'mp',
        'むずかしさ',
        [
          { v: 'easy', t: 'やさしい' },
          { v: 'normal', t: 'ふつう' },
          { v: 'hard', t: 'むずかしい' },
        ],
        () => config.diff,
        (v) => {
          config.diff = v as PresetKey;
        },
      ),
    );
    box.append(
      elem(
        'p',
        'mp-note',
        '60びょうのあいだに、穴から出てくる🐹もぐらをタップ！✨金もぐらは大得点。💣ばくだんを たたくと コンボが0になるよ（へらないから あんしん）。れんぞくで たたくと コンボボーナス！',
      ),
    );
    const start = elem('button', 'mp-btn mp-btn-primary mp-btn-lg', 'はじめる ▶') as HTMLButtonElement;
    start.addEventListener('click', () => startMatch());
    box.append(start);
    wrap.replaceChildren(box);
  }

  // ---- 開始 ----
  function startMatch(): void {
    ctx.save('config', { ...config });
    diff = config.diff;
    score = 0;
    combo = 0;
    moleCount = 0;
    bombsHit = 0;
    ended = false;
    endAt = 0;
    lastSec = -1;
    active.fill(null);
    buildPlay();
    mode = 'count';
    if (import.meta.env.DEV) wrap.dataset.st = 'count';
    cd = createCountdown({
      onCount: (n) => {
        if (countEl) countEl.textContent = String(n);
        ctx.sfx('tick');
      },
      onGo: (now) => {
        countEl?.remove();
        countEl = null;
        mode = 'play';
        if (import.meta.env.DEV) wrap.dataset.st = 'play';
        playStart = now;
        nextSpawnAt = now + 350;
        ctx.sfx('start');
        paintHud();
      },
    });
    cd.start(ctx.now());
  }

  function buildPlay(): void {
    const play = elem('div', 'mp-play');

    const hud = elem('div', 'mp-hud');
    timeEl = elem('span', 'mp-hud-item', '⏱ のこり 60');
    scoreEl = elem('span', 'mp-hud-item', 'スコア 0');
    comboEl = elem('span', 'mp-hud-item mp-combo', '');
    hud.append(timeEl, scoreEl, comboEl);

    const fieldWrap = elem('div', 'mp-field-wrap');
    fieldEl = elem('div', 'mp-field');
    holeBtns = [];
    moleEls = [];
    for (let i = 0; i < HOLES; i++) {
      const idx = i;
      const b = elem('button', 'mp-hole') as HTMLButtonElement;
      const m = elem('div', 'mp-mole');
      b.append(elem('div', 'mp-dirt'), m);
      b.addEventListener('click', () => whack(idx));
      holeBtns.push(b);
      moleEls.push(m);
      fieldEl.append(b);
    }
    countEl = elem('div', 'mp-count', '');
    fieldWrap.append(fieldEl, countEl);

    play.append(hud, fieldWrap);
    wrap.replaceChildren(play);
  }

  // ---- 出現/退場 ----
  function popUp(hole: number, kind: MoleKind, now: number): void {
    active[hole] = { kind, hideAt: now + DIFFS[diff].uptime(level()) };
    const m = moleEls[hole];
    const b = holeBtns[hole];
    if (m && b) {
      m.style.backgroundImage = kind === 'gold' ? GOLD_SVG : kind === 'bomb' ? BOMB_SVG : MOLE_SVG;
      m.classList.add('mp-up');
      if (import.meta.env.DEV) b.dataset.kind = kind; // 検証用（開発ビルド限定）
    }
  }

  function hideMole(hole: number): void {
    active[hole] = null;
    const m = moleEls[hole];
    const b = holeBtns[hole];
    if (m) m.classList.remove('mp-up');
    if (b && import.meta.env.DEV) delete b.dataset.kind;
  }

  // ---- たたく ----
  function whack(hole: number): void {
    if (mode !== 'play' || hostPaused) return;
    const a = active[hole];
    if (!a) return;
    hideMole(hole);
    if (a.kind === 'bomb') {
      bombsHit++;
      combo = 0;
      ctx.sfx('fail');
      ctx.haptic('error');
      popText(hole, '💥', '#ff5d5d');
      paintHud();
      return;
    }
    combo++;
    const bonus = COMBO_STEP * Math.min(Math.max(combo - 1, 0), COMBO_CAP);
    const gain = (a.kind === 'gold' ? GOLD_PTS : MOLE_PTS) + bonus;
    score += gain;
    moleCount++;
    if (a.kind === 'gold') {
      ctx.achieve('golden');
      ctx.sfx('powerup');
      ctx.haptic('medium');
    } else {
      ctx.sfx('tap');
      ctx.haptic('light');
    }
    if (combo === 10) {
      ctx.sfx('combo');
      ctx.achieve('combo-10');
    }
    if (moleCount === 10) ctx.achieve('debut-10');
    if (moleCount === 30) ctx.achieve('count-30');
    // 単調マイルストーンは達したその場で解除（確立ポリシー）
    if (bombsHit === 0 && moleCount >= NO_BOMB_COUNT) ctx.achieve('no-bomb');
    if (score >= SCORE_HI) ctx.achieve('score-hi');
    popText(hole, `+${gain}`, a.kind === 'gold' ? '#ffd23f' : '#ffffff');
    paintHud();
  }

  function popText(hole: number, text: string, color: string): void {
    const b = holeBtns[hole];
    if (!b) return;
    const p = elem('span', 'mp-pop', text);
    p.style.color = color;
    p.addEventListener('animationend', () => p.remove());
    b.append(p);
  }

  // ---- 描画 ----
  function paintHud(): void {
    if (scoreEl) scoreEl.textContent = `スコア ${score}`;
    if (comboEl) comboEl.textContent = combo >= 2 ? `🔥 ×${combo}` : '';
  }

  // ---- タイムアップ ----
  function timeUp(now: number): void {
    mode = 'over';
    if (import.meta.env.DEV) wrap.dataset.st = 'over';
    for (let i = 0; i < HOLES; i++) hideMole(i);
    if (timeEl) timeEl.textContent = '⏱ のこり 0';
    const over = elem('div', 'mp-over');
    over.append(
      elem('div', 'mp-over-t', '⏰ タイムアップ！'),
      elem('div', 'mp-over-s', `${moleCount}ひき たたいた`),
    );
    fieldEl?.parentElement?.append(over);
    ctx.sfx('success');
    ctx.haptic('success');
    endAt = now + END_DELAY;
  }

  // ---- 毎フレーム（カウントダウン・出現/退場・残り時間・結果遷移。すべて ctx.now 基準）----
  const offFrame = ctx.onFrame(() => {
    const now = ctx.now();
    if (mode === 'count') {
      cd?.tick(now);
      return;
    }
    if (mode === 'play') {
      const left = DURATION - (now - playStart);
      if (left <= 0) {
        timeUp(now);
        return;
      }
      const sec = Math.ceil(left / 1000);
      if (sec !== lastSec) {
        lastSec = sec;
        if (timeEl) {
          timeEl.textContent = `⏱ のこり ${sec}`;
          timeEl.classList.toggle('mp-low', sec <= 10);
        }
        if (sec <= 5) ctx.sfx('tick');
      }
      // 退場（にげた＝コンボは切れない・fruit-catch と同方針）
      for (let i = 0; i < HOLES; i++) {
        const a = active[i];
        if (a && now >= a.hideAt) hideMole(i);
      }
      // 出現
      const lv = level();
      const activeCount = active.filter(Boolean).length;
      if (now >= nextSpawnAt && activeCount < DIFFS[diff].maxSimul(lv)) {
        const free: number[] = [];
        for (let i = 0; i < HOLES; i++) if (!active[i]) free.push(i);
        const s = rollSpawn(ctx.random, lv, free);
        if (s) popUp(s.hole, s.kind, now);
        nextSpawnAt = now + DIFFS[diff].interval(lv) * (0.75 + ctx.random() * 0.5);
      }
      return;
    }
    if (mode === 'over' && !ended && now >= endAt) {
      ended = true;
      ctx.end({ score });
    }
  });

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
      // grid + aspect-ratio のみ＝計測なし
    },
    destroy() {
      offFrame();
      style.remove();
      wrap.remove();
    },
  };
}

// =============================================================
// スタイル（.mp- プレフィックス。芝生と土の固定パレット・UIはテーマ変数）
// =============================================================
const CSS = `
.mp-wrap{position:absolute;inset:0;overflow:hidden}

/* 設定画面 */
.mp-setup{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:safe center;
  gap:14px;padding:20px 16px;box-sizing:border-box;overflow-y:auto;user-select:none;-webkit-user-select:none}
.mp-h2{margin:4px 0;font-size:22px;text-align:center}
.mp-seg-row{width:min(92vw,420px);display:flex;flex-direction:column;gap:6px}
.mp-seg-label{font-size:13px;color:var(--text-dim);font-weight:800}
.mp-seg{display:flex;background:var(--bg-elev2);border-radius:12px;padding:3px;gap:2px}
.mp-seg-btn{flex:1;border:none;background:none;color:var(--text-dim);padding:10px 2px;border-radius:9px;
  font-size:14px;font-weight:800;min-height:44px}
.mp-seg-btn.mp-on{background:var(--accent);color:#fff}
.mp-note{font-size:12px;color:var(--text-dim);text-align:center;max-width:min(92vw,420px);margin:0;line-height:1.7}
.mp-btn{appearance:none;border:none;border-radius:12px;padding:12px 18px;font-size:15px;font-weight:800;font-family:inherit;
  background:var(--bg-elev2);color:var(--text);min-height:44px}
.mp-btn-primary{background:var(--accent-grad);color:#fff}
.mp-btn-lg{width:100%;max-width:300px;font-size:18px}

/* プレイ画面 */
.mp-play{position:absolute;inset:0;display:flex;flex-direction:column;padding:6px 10px 12px;box-sizing:border-box;
  user-select:none;-webkit-user-select:none}
.mp-hud{display:flex;justify-content:center;align-items:center;gap:16px;padding:2px 64px 4px;flex-wrap:wrap;min-height:54px}
.mp-hud-item{font-size:15px;font-weight:800;white-space:nowrap}
.mp-combo{color:var(--accent-2)}
.mp-time.mp-low,.mp-hud-item.mp-low{color:var(--danger)}

/* 芝生フィールド（固定パレット＝両テーマ共通） */
.mp-field-wrap{flex:1 1 auto;min-height:0;display:flex;align-items:center;justify-content:center;position:relative;
  background:linear-gradient(180deg,#7ec850,#5aa845);border-radius:18px}
.mp-field{display:grid;grid-template-columns:repeat(3,1fr);gap:4vmin;width:min(92%,440px);padding:10px;box-sizing:border-box}
.mp-hole{position:relative;aspect-ratio:1;border:none;margin:0;padding:0;background:transparent;overflow:hidden;
  font-family:inherit;border-radius:12px}
.mp-dirt{position:absolute;left:8%;right:8%;bottom:6%;height:26%;background:#5c3d24;border-radius:50%;
  box-shadow:inset 0 4px 8px rgba(0,0,0,.45)}
.mp-mole{position:absolute;left:14%;right:14%;bottom:10%;height:78%;background-repeat:no-repeat;background-position:center bottom;
  background-size:contain;transform:translateY(105%);transition:transform .09s ease-out;will-change:transform;pointer-events:none}
.mp-mole.mp-up{transform:translateY(0)}
.mp-pop{position:absolute;left:50%;top:12%;transform:translateX(-50%);font-size:20px;font-weight:900;pointer-events:none;
  text-shadow:0 1px 3px rgba(0,0,0,.5);animation:mp-float .6s ease-out forwards}
@keyframes mp-float{from{opacity:1;top:12%}to{opacity:0;top:-6%}}

/* カウントダウン・タイムアップ */
.mp-count{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:96px;font-weight:900;
  color:#fff;text-shadow:0 2px 10px rgba(0,0,0,.4);pointer-events:none}
.mp-over{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;
  background:rgba(16,19,48,.82);border-radius:18px;color:#fff;animation:mp-in .2s ease-out;padding:12px}
.mp-over-t{font-size:26px;font-weight:900}
.mp-over-s{font-size:18px;font-weight:800}
@keyframes mp-in{from{opacity:0;transform:scale(.94)}to{opacity:1;transform:scale(1)}}
`;
