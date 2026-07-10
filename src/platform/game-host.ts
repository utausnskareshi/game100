// =============================================================
// game-host: ゲーム実行の統括
// =============================================================
// 開始前画面（ヘルプ・自己ベスト・あそぶ）→ センサー許可 → 向き制御 →
// カウントダウン → プレイ（ポーズ・自動ポーズ・ループ管理）→ 結果画面
// までのライフサイクルをすべて引き受ける。
// ゲーム本体は「プレイ中の描画と入力」だけを実装すればよい。
// =============================================================
import type {
  Canvas2DHandle,
  GameContext,
  GameMeta,
  GameModule,
  IGame,
  InputHelper,
  PointerInfo,
  Size,
  SwipeDir,
  Unsubscribe,
} from '../game-api/types';
import { playSfx, playTone, unlockAudio } from './audio';
import { haptic } from './haptics';
import { pushGuard, type GuardHandle } from './backstack';
import { el, clear } from './dom';
import { onOrientationChange, orientationSatisfied, releaseLock, tryLock } from './orientation';
import {
  MEDAL_EMOJI,
  MEDAL_LABEL,
  formatScore,
  recordQuit,
  recordResult,
  seedFor,
  unlockGameAchievement,
  type UnlockedInfo,
} from './progress';
import { createRng } from './rng';
import { createMotionHelper, requestMotionPermission } from './sensors';
import { commit, gameRecord, getDoc } from './storage';
import { acquireWakeLock, releaseWakeLock } from './wakelock';

type HostState = 'pregame' | 'starting' | 'countdown' | 'playing' | 'paused' | 'result';

export interface GameHostHandle {
  el: HTMLElement;
  destroy(): void;
}

/** ヘルプ（あそびかた）ブロック。開始前画面とポーズ画面で共用 */
export function renderHelp(meta: GameMeta): HTMLElement {
  const box = el('div', { class: 'help-box' });
  box.append(
    el('div', { class: 'help-section' }, el('h3', { text: '🎯 もくひょう' }), el('p', { text: meta.help.goal })),
    el(
      'div',
      { class: 'help-section' },
      el('h3', { text: '🕹️ そうさ' }),
      el('ul', null, ...meta.help.controls.map((c) => el('li', { text: c }))),
    ),
  );
  if (meta.help.tips && meta.help.tips.length > 0) {
    box.append(
      el(
        'div',
        { class: 'help-section' },
        el('h3', { text: '💡 コツ' }),
        el('ul', null, ...meta.help.tips.map((t) => el('li', { text: t }))),
      ),
    );
  }
  return box;
}

export function mountGameHost(meta: GameMeta, onExit: () => void): GameHostHandle {
  // ---------- DOM ----------
  const gameRoot = el('div', { class: 'game-root' });
  const pauseBtn = el('button', {
    class: 'pause-btn',
    'aria-label': 'ポーズ',
    text: '❚❚',
    onclick: () => {
      if (state === 'playing') pauseGame('button');
    },
  });
  const toastArea = el('div', { class: 'stage-toast' });
  const overlay = el('div', { class: 'stage-overlay' });
  const stage = el('div', { class: 'game-stage' }, gameRoot, pauseBtn, toastArea, overlay);

  // ---------- 状態 ----------
  let state: HostState = 'pregame';
  let game: IGame | null = null;
  let module: GameModule | null = null;
  let motionDestroy: (() => void) | null = null;
  let motionHelper: GameContext['motion'] = null;
  let motionGranted = false;
  let optionalMotionAsked = false; // 任意センサーの許可は同一マウント内で1回だけ聞く
  let playedMs = 0; // ポーズ中は進まないプレイ時間（インスタンスごと）
  let recorded = false; // recordResult / recordQuit 済み
  let unlockedInRun: UnlockedInfo[] = [];
  let frameCbs = new Set<(dt: number) => void>();
  let canvases: { layout: () => void }[] = [];
  let rafId = 0;
  let lastT = 0;
  let countdownTimer = 0;
  let guard: GuardHandle | null = null;
  let destroyed = false;
  const cleanupFns: (() => void)[] = [];

  const size: Size = { w: 0, h: 0, dpr: 1 };

  function updateSize(): void {
    // .game-root は inset を安全域ぶん詰めてある（＝要素自体が安全域サイズ）ので、
    // clientWidth/Height がそのまま描画可能サイズになる。
    size.w = gameRoot.clientWidth;
    size.h = gameRoot.clientHeight;
    size.dpr = Math.min(window.devicePixelRatio || 1, 2);
  }

  const ro = new ResizeObserver(() => {
    updateSize();
    for (const c of canvases) c.layout();
    if (game) game.resize({ ...size });
  });
  ro.observe(gameRoot);

  // ---------- ループ ----------
  function loopStep(t: number): void {
    if (state !== 'playing') return;
    const dt = Math.min(0.05, Math.max(0, (t - lastT) / 1000)); // 復帰直後の巨大dtを防ぐ
    lastT = t;
    playedMs += dt * 1000;
    for (const cb of [...frameCbs]) cb(dt);
    rafId = requestAnimationFrame(loopStep);
  }

  function loopStart(): void {
    cancelAnimationFrame(rafId);
    lastT = performance.now();
    rafId = requestAnimationFrame(loopStep);
  }

  function loopStop(): void {
    cancelAnimationFrame(rafId);
  }

  // ---------- 入力 ----------
  function makeInput(): { input: InputHelper; destroy: () => void } {
    const downs = new Set<(p: PointerInfo) => void>();
    const moves = new Set<(p: PointerInfo) => void>();
    const ups = new Set<(p: PointerInfo) => void>();
    const taps = new Set<(p: PointerInfo) => void>();
    const swipes = new Set<(dir: SwipeDir, p: PointerInfo) => void>();
    const starts = new Map<number, { x: number; y: number; t: number }>();

    const toInfo = (e: PointerEvent): PointerInfo => {
      const r = gameRoot.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top, id: e.pointerId };
    };

    const onDown = (e: PointerEvent): void => {
      // ポインタキャプチャは「ドラッグを使うゲーム（onMove 購読あり）」のときだけ行う。
      // gameRoot にキャプチャすると、gameRoot 内に置かれた DOM ボタン（設定セグメント・
      // ゲーム盤のマス等）への click がキャプチャ側へ奪われ、実タップで反応しなくなる。
      // DOM ゲーム（reversi/speed/hit-and-blow/treasure-dig/number-place など）は onMove を
      // 使わないのでキャプチャせず、ネイティブの click をそのまま活かす。
      if (moves.size > 0) {
        try {
          gameRoot.setPointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
      }
      const p = toInfo(e);
      starts.set(e.pointerId, { x: p.x, y: p.y, t: performance.now() });
      for (const cb of [...downs]) cb(p);
    };
    const onMove = (e: PointerEvent): void => {
      if (moves.size === 0) return;
      const p = toInfo(e);
      for (const cb of [...moves]) cb(p);
    };
    const onUp = (e: PointerEvent): void => {
      const p = toInfo(e);
      for (const cb of [...ups]) cb(p);
      const s = starts.get(e.pointerId);
      starts.delete(e.pointerId);
      if (!s) return;
      const dx = p.x - s.x;
      const dy = p.y - s.y;
      const dist = Math.hypot(dx, dy);
      const dur = performance.now() - s.t;
      if (dist < 12 && dur < 350) {
        for (const cb of [...taps]) cb(p);
      } else if (dist > 30 && dur < 600) {
        const dir: SwipeDir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
        for (const cb of [...swipes]) cb(dir, p);
      }
    };
    const onCancel = (e: PointerEvent): void => {
      // キャンセルも「指が離れた」としてゲームへ通知する（ドラッグ状態の固着防止）。
      // starts を先に消すので tap / swipe 判定は走らない。
      starts.delete(e.pointerId);
      const p = toInfo(e);
      for (const cb of [...ups]) cb(p);
    };
    const onCtx = (e: Event): void => e.preventDefault();

    gameRoot.addEventListener('pointerdown', onDown);
    gameRoot.addEventListener('pointermove', onMove);
    gameRoot.addEventListener('pointerup', onUp);
    gameRoot.addEventListener('pointercancel', onCancel);
    gameRoot.addEventListener('contextmenu', onCtx);

    const sub = <T>(set: Set<T>) => (cb: T): Unsubscribe => {
      set.add(cb);
      return () => set.delete(cb);
    };

    return {
      input: {
        onDown: sub(downs),
        onMove: sub(moves),
        onUp: sub(ups),
        onTap: sub(taps),
        onSwipe: sub(swipes),
      },
      destroy() {
        gameRoot.removeEventListener('pointerdown', onDown);
        gameRoot.removeEventListener('pointermove', onMove);
        gameRoot.removeEventListener('pointerup', onUp);
        gameRoot.removeEventListener('pointercancel', onCancel);
        gameRoot.removeEventListener('contextmenu', onCtx);
        downs.clear(); moves.clear(); ups.clear(); taps.clear(); swipes.clear();
      },
    };
  }

  let inputWiring: { input: InputHelper; destroy: () => void } | null = null;

  // ---------- Canvas ----------
  function makeCanvas(opts?: { design?: { w: number; h: number } }): Canvas2DHandle {
    const canvas = el('canvas', { class: 'game-canvas' });
    gameRoot.appendChild(canvas);
    const c2d = canvas.getContext('2d');
    if (!c2d) throw new Error('canvas 2d context unavailable');
    const design = opts?.design ?? null;
    let dispScale = 1; // 表示px / 描画単位

    const handle: Canvas2DHandle = {
      el: canvas,
      ctx: c2d,
      width: design?.w ?? size.w,
      height: design?.h ?? size.h,
      clear(color?: string) {
        if (color) {
          c2d.fillStyle = color;
          c2d.fillRect(0, 0, handle.width, handle.height);
        } else {
          c2d.clearRect(0, 0, handle.width, handle.height);
        }
      },
      toLocal(p) {
        const rect = canvas.getBoundingClientRect();
        const rootRect = gameRoot.getBoundingClientRect();
        return {
          x: (p.x - (rect.left - rootRect.left)) / dispScale,
          y: (p.y - (rect.top - rootRect.top)) / dispScale,
        };
      },
    };

    const layout = (): void => {
      const dpr = size.dpr;
      if (design) {
        const s = Math.min(size.w / design.w, size.h / design.h) || 1;
        const dispW = Math.max(1, Math.floor(design.w * s));
        const dispH = Math.max(1, Math.floor(design.h * s));
        canvas.style.width = `${dispW}px`;
        canvas.style.height = `${dispH}px`;
        canvas.width = Math.round(dispW * dpr);
        canvas.height = Math.round(dispH * dpr);
        c2d.setTransform((dispW * dpr) / design.w, 0, 0, (dispH * dpr) / design.h, 0, 0);
        handle.width = design.w;
        handle.height = design.h;
        dispScale = dispW / design.w;
      } else {
        canvas.style.width = '100%';
        canvas.style.height = '100%';
        canvas.width = Math.max(1, Math.round(size.w * dpr));
        canvas.height = Math.max(1, Math.round(size.h * dpr));
        c2d.setTransform(dpr, 0, 0, dpr, 0, 0);
        handle.width = size.w;
        handle.height = size.h;
        dispScale = 1;
      }
    };
    layout();
    canvases.push({ layout });
    return handle;
  }

  // ---------- オーバーレイ ----------
  function showOverlay(content: HTMLElement | null, kind?: string): void {
    clear(overlay);
    overlay.className = 'stage-overlay' + (kind ? ` overlay-${kind}` : '');
    if (content) {
      overlay.appendChild(content);
      overlay.classList.add('visible');
    } else {
      overlay.classList.remove('visible');
    }
    pauseBtn.classList.toggle('visible', state === 'playing');
  }

  function achievementToast(u: UnlockedInfo): void {
    const t = el('div', { class: 'ach-toast' }, el('span', { text: '🏆' }), el('span', { text: `実績解除：${u.name}` }));
    toastArea.appendChild(t);
    setTimeout(() => t.classList.add('show'), 20);
    setTimeout(() => {
      t.classList.remove('show');
      setTimeout(() => t.remove(), 400);
    }, 2600);
  }

  // ---------- 戻るボタン（Android）制御: ガードは常に最大1つ ----------
  function handleBack(): void {
    guard = null;
    if (destroyed) return;
    if (state === 'playing') {
      armGuard();
      pauseGame('back');
    } else if (state === 'countdown' || state === 'starting') {
      armGuard(); // カウントダウン中の戻るは無視
    } else if (state === 'paused') {
      doQuit();
    } else if (state === 'result') {
      doExit();
    } else {
      doExit();
    }
  }

  function armGuard(): void {
    if (!guard && !destroyed) guard = pushGuard(handleBack);
  }

  // ---------- 画面: 開始前 ----------
  function showPregame(): void {
    state = 'pregame';
    const rec = gameRecord(meta.id);
    const bestLine =
      rec.best != null && meta.scoring !== 'none'
        ? `じこベスト：${formatScore(meta.scoring, rec.best)}`
        : 'はじめてのプレイ！';

    const medalInfo: HTMLElement[] = [];
    if (meta.medals && meta.scoring !== 'none') {
      const fmt = (v: number) => formatScore(meta.scoring, v);
      medalInfo.push(
        el(
          'div',
          { class: 'medal-targets' },
          el('span', { text: `🥉 ${fmt(meta.medals.bronze)}` }),
          el('span', { text: `🥈 ${fmt(meta.medals.silver)}` }),
          el('span', { text: `🥇 ${fmt(meta.medals.gold)}` }),
        ),
      );
    }

    const needRotate = !orientationSatisfied(meta.orientation);
    const dirLabel = meta.orientation === 'portrait' ? 'たて向き' : 'よこ向き';
    const orientationNote =
      meta.orientation === 'any'
        ? null
        : el('p', {
            class: 'orientation-note',
            text: `📱 ${dirLabel}のゲームです${needRotate ? '（開始時に回転してね）' : ''}`,
          });

    const startBtn = el('button', { class: 'btn btn-primary btn-large', text: 'あそぶ ▶' });
    startBtn.addEventListener('click', () => void startFlow());

    const iconEl = el('div', { class: 'pregame-icon', 'aria-hidden': 'true' });
    if (meta.icon.svg) {
      iconEl.classList.add('pregame-icon-svg');
      iconEl.innerHTML = meta.icon.svg;
    } else {
      iconEl.textContent = meta.icon.emoji;
    }

    const content = el(
      'div',
      { class: 'pregame' },
      iconEl,
      el('div', { class: 'pregame-no', text: `No.${String(meta.no).padStart(3, '0')}` }),
      el('h2', { class: 'pregame-title', text: meta.title }),
      el('p', { class: 'pregame-desc', text: meta.description }),
      renderHelp(meta),
      el('p', { class: 'pregame-best', text: bestLine }),
      ...medalInfo,
      orientationNote,
      startBtn,
      el('button', { class: 'btn btn-ghost', text: 'やめる', onclick: () => doQuit() }),
    );
    showOverlay(content, 'pregame');
  }

  // ---------- 開始フロー ----------
  async function startFlow(): Promise<void> {
    if (state !== 'pregame' && state !== 'result' && state !== 'paused') return;
    state = 'starting';
    unlockAudio();

    // 1) センサー許可（必要なゲームのみ / タップ起点で呼ぶ必要がある）
    if (meta.sensors?.includes('motion') && !motionGranted) {
      const perm = await requestMotionPermission();
      if (destroyed) return; // 許可ダイアログ中に破棄されたら以降のロック・WakeLock取得をしない
      if (perm !== 'granted') {
        showSensorDenied(perm === 'unavailable');
        return;
      }
      motionGranted = true;
    }

    // 1b) 任意センサー（optionalSensors）: 許可を求めるが、拒否・非対応でも開始する。
    //     その場合は ctx.motion が null になるだけ（タッチ等で完全に遊べるゲーム向け）
    if (meta.optionalSensors?.includes('motion') && !motionGranted && !optionalMotionAsked) {
      optionalMotionAsked = true;
      motionGranted = (await requestMotionPermission()) === 'granted';
      if (destroyed) return;
    }

    // 2) 向きの固定（Android）or 回転案内（iOS等）
    if (meta.orientation !== 'any') {
      await tryLock(meta.orientation, stage);
      if (destroyed) return; // tryLock 自体は epoch で自己復旧するが、以降の処理は進めない
      if (!orientationSatisfied(meta.orientation)) {
        await waitForOrientation();
        if (destroyed) return;
      }
    }

    // 3) スリープ防止
    void acquireWakeLock();

    // 4) ゲーム本体の読み込み（コード分割されているため初回のみ通信/キャッシュ読込）
    if (!module) {
      showOverlay(el('div', { class: 'stage-loading', text: 'よみこみ中…' }), 'loading');
      try {
        module = await meta.load();
      } catch {
        showLoadError();
        return;
      }
      if (destroyed) return;
    }

    createInstanceAndCountdown();
  }

  function showSensorDenied(unavailable: boolean): void {
    state = 'pregame';
    const msg = unavailable
      ? 'この端末ではセンサー（かたむき）が利用できないため、このゲームはあそべません。'
      : 'センサーの利用が許可されませんでした。このゲームはかたむきセンサーが必要です。\n\niPhone/iPadで一度「許可しない」を選ぶと、次回から確認が出ないことがあります。その場合はアプリを入れ直すと再度確認できます。';
    showOverlay(
      el(
        'div',
        { class: 'pregame' },
        el('div', { class: 'pregame-icon', text: '📵' }),
        el('h2', { text: 'センサーが使えません' }),
        el('p', { class: 'pregame-desc pre-line', text: msg }),
        unavailable ? null : el('button', { class: 'btn btn-primary', text: 'もういちど試す', onclick: () => void startFlow() }),
        el('button', { class: 'btn btn-ghost', text: 'もどる', onclick: () => doQuit() }),
      ),
      'sensor',
    );
  }

  function showLoadError(): void {
    state = 'pregame';
    releaseWakeLock(); // 読み込み失敗でエラー画面に留まる間、画面を点けっぱなしにしない
    showOverlay(
      el(
        'div',
        { class: 'pregame' },
        el('div', { class: 'pregame-icon', text: '⚠️' }),
        el('h2', { text: 'よみこみに失敗しました' }),
        el('p', { class: 'pregame-desc', text: '通信できる場所でもう一度お試しください。（一度読み込めばオフラインでも遊べるようになります）' }),
        el('button', { class: 'btn btn-primary', text: 'もういちど試す', onclick: () => void startFlow() }),
        el('button', { class: 'btn btn-ghost', text: 'もどる', onclick: () => doQuit() }),
      ),
      'error',
    );
  }

  function rotateOverlayContent(): HTMLElement {
    const target = meta.orientation === 'portrait' ? 'たて向き' : 'よこ向き';
    return el(
      'div',
      { class: 'rotate-guide' },
      el('div', { class: 'rotate-icon', text: '🔄' }),
      el('h2', { text: `${target}にしてください` }),
      el('p', { text: `このゲームは${target}であそびます。端末を回転してください。` }),
      el('p', { class: 'rotate-hint', text: '（画面の向きロックがONだと回転できません）' }),
    );
  }

  function waitForOrientation(): Promise<void> {
    showOverlay(rotateOverlayContent(), 'rotate');
    return new Promise((resolve) => {
      const off = onOrientationChange(() => {
        if (destroyed) {
          off();
          return;
        }
        if (orientationSatisfied(meta.orientation)) {
          off();
          resolve();
        }
      });
      cleanupFns.push(off);
    });
  }

  // ---------- インスタンス生成とカウントダウン ----------
  function makeContext(): GameContext {
    const rng = createRng(seedFor(meta));
    inputWiring = makeInput();
    motionHelper = null;
    const wantsMotion = meta.sensors?.includes('motion') || meta.optionalSensors?.includes('motion');
    if (wantsMotion && motionGranted) {
      const m = createMotionHelper();
      // onShake はプレイ中のみゲームへ届ける（ポーズ中・結果画面での誤発火防止）
      motionHelper = {
        tilt: m.helper.tilt,
        get shakeLevel() {
          return m.helper.shakeLevel ?? 0;
        },
        calibrate: () => m.helper.calibrate(),
        onShake: (cb) =>
          m.helper.onShake(() => {
            if (state === 'playing') cb();
          }),
      };
      motionDestroy = m.destroy;
    }
    const rec = gameRecord(meta.id);

    return {
      root: gameRoot,
      size,
      meta,
      canvas2d: (opts) => makeCanvas(opts),
      input: inputWiring.input,
      motion: motionHelper,
      onFrame(cb) {
        frameCbs.add(cb);
        return () => frameCbs.delete(cb);
      },
      sfx: playSfx,
      tone: (freq, ms) => playTone(freq, ms),
      haptic,
      random: rng,
      now: () => playedMs,
      save<T>(key: string, value: T) {
        // 保存ドキュメント全体は「JSON化可能かつ structured-clone 可能」が前提。
        // ゲーム側のバグでそうでない値（関数・循環参照・BigInt等）が渡っても、生のまま
        // doc に入れて localStorage / IndexedDB の保存経路を無言で殺さないよう、
        // JSONで丸めてから保存する（丸められない値は保存しない）。
        try {
          rec.saves[key] = JSON.parse(JSON.stringify(value)) as T;
        } catch {
          if (import.meta.env.DEV) console.warn(`[GAME100] ctx.save('${key}'): JSON化できない値のため保存しません`);
          return;
        }
        commit();
      },
      load<T>(key: string): T | null {
        return (rec.saves[key] as T | undefined) ?? null;
      },
      achieve(id: string) {
        const u = unlockGameAchievement(meta, id);
        if (u) {
          unlockedInRun.push(u);
          achievementToast(u);
          playSfx('combo');
          haptic('success');
        }
      },
      end(result) {
        finishGame(result?.score);
      },
      quit() {
        doQuit();
      },
    };
  }

  function teardownInstance(): void {
    loopStop();
    if (game) {
      try {
        game.destroy();
      } catch {
        /* ゲーム側の後始末エラーでシェルを壊さない */
      }
      game = null;
    }
    motionDestroy?.();
    motionDestroy = null;
    motionHelper = null;
    inputWiring?.destroy();
    inputWiring = null;
    frameCbs.clear();
    canvases = [];
    clear(gameRoot);
  }

  function createInstanceAndCountdown(): void {
    if (!module || destroyed) return;
    // 「はじめから」等で途中のランを破棄する場合も、遊んだ時間と実績XPは記録に残す
    // （playedMs が 0 でも、実績だけ解除済みならそのXPを取りこぼさない）
    if (!recorded && (playedMs > 0 || unlockedInRun.length > 0)) {
      recordQuit(meta, playedMs, unlockedInRun);
      recorded = true; // teardown中に（契約違反の）ctx.end()が呼ばれても二重記録しない
    }
    teardownInstance();
    playedMs = 0;
    recorded = false;
    unlockedInRun = [];
    updateSize();

    try {
      game = module.createGame(makeContext());
      game.resize({ ...size });
    } catch (err) {
      if (import.meta.env.DEV) console.error(err);
      // createGame が途中で throw した場合、makeContext() が張った入力/センサーリスナーや
      // ゲームが作った canvas が gameRoot に残る。エラー画面へ移る前に確実に回収する
      teardownInstance();
      showLoadError();
      return;
    }

    state = 'countdown';
    armGuard();
    // ボード/パズル系は 3-2-1 を省略して即開始（runCountdown(0) はそのまま playing へ遷移する）
    runCountdown(meta.startMode === 'immediate' ? 0 : 3);
  }

  function runCountdown(n: number): void {
    if (destroyed) return;
    if (document.hidden) {
      // バックグラウンド中はカウントダウンを止め、復帰してから再開する
      const onVis = (): void => {
        document.removeEventListener('visibilitychange', onVis);
        if (!destroyed && !document.hidden) runCountdown(n);
      };
      document.addEventListener('visibilitychange', onVis);
      cleanupFns.push(() => document.removeEventListener('visibilitychange', onVis));
      return;
    }
    if (!orientationSatisfied(meta.orientation)) {
      // カウントダウン中に回された → 向きが直ったら最初からやり直す
      // （immediate のゲームに 3-2-1 を挟まないよう startMode を尊重する）
      void waitForOrientation().then(() => {
        if (!destroyed) runCountdown(meta.startMode === 'immediate' ? 0 : 3);
      });
      return;
    }
    if (n <= 0) {
      playSfx('start');
      state = 'playing';
      showOverlay(null);
      motionHelper?.calibrate(); // 開始時点の持ち方をニュートラルにする
      loopStart();
      game?.start();
      return;
    }
    playSfx('tick');
    showOverlay(el('div', { class: 'countdown', text: String(n) }), 'countdown');
    countdownTimer = window.setTimeout(() => runCountdown(n - 1), 650);
  }

  // ---------- ポーズ ----------
  function pauseGame(reason: 'button' | 'hidden' | 'back' | 'rotate'): void {
    if (state !== 'playing') return;
    state = 'paused';
    loopStop();
    releaseWakeLock();
    try {
      game?.pause();
    } catch {
      /* ignore */
    }
    if (reason === 'rotate') {
      showOverlay(rotateOverlayContent(), 'rotate');
    } else {
      showPauseMenu();
    }
    if (reason === 'button') playSfx('tap');
  }

  function showPauseMenu(): void {
    showOverlay(
      el(
        'div',
        { class: 'pause-menu' },
        el('h2', { text: 'ポーズ' }),
        el('button', { class: 'btn btn-primary btn-large', text: 'さいかい ▶', onclick: () => resumeGame() }),
        el('button', { class: 'btn', text: 'はじめから', onclick: () => createInstanceAndCountdown() }),
        el('button', { class: 'btn', text: 'あそびかた', onclick: () => showPauseHelp() }),
        el('button', { class: 'btn btn-ghost', text: 'やめる', onclick: () => doQuit() }),
      ),
      'pause',
    );
  }

  function showPauseHelp(): void {
    showOverlay(
      el(
        'div',
        { class: 'pause-menu' },
        el('h2', { text: 'あそびかた' }),
        renderHelp(meta),
        el('button', { class: 'btn btn-primary', text: 'もどる', onclick: () => showPauseMenu() }),
      ),
      'pause',
    );
  }

  function resumeGame(): void {
    if (state !== 'paused') return;
    if (!orientationSatisfied(meta.orientation)) {
      showOverlay(rotateOverlayContent(), 'rotate');
      return;
    }
    state = 'playing';
    showOverlay(null);
    void acquireWakeLock();
    try {
      game?.resume();
    } catch {
      /* ignore */
    }
    loopStart();
  }

  // ---------- 終了 ----------
  function finishGame(score?: number): void {
    if (state !== 'playing' && state !== 'paused') return;
    if (recorded) return;
    const wasPlaying = state === 'playing';
    state = 'result';
    loopStop();
    releaseWakeLock();
    recorded = true;
    // ゲーム側の独自タイマーや音を止める（結果画面の裏で動き続けないように）。
    // 既にポーズ済み（paused からの end）なら pause() は再送しない（IGame に冪等性を要求しないため）
    if (wasPlaying) {
      try {
        game?.pause();
      } catch {
        /* ignore */
      }
    }

    const summary = recordResult(meta, {
      score: meta.scoring === 'none' ? null : score ?? null,
      durationMs: playedMs,
      unlockedInRun,
    });

    if (summary.medalUp) {
      playSfx('medal');
      haptic('success');
    } else if (summary.isNewBest) {
      playSfx('success');
      haptic('success');
    } else {
      playSfx('success');
    }

    const parts: (HTMLElement | null)[] = [];
    parts.push(el('h2', { class: 'result-title', text: 'けっか' }));
    if (summary.score != null) {
      parts.push(el('div', { class: 'result-score', text: formatScore(meta.scoring, summary.score) }));
      if (summary.isNewBest) parts.push(el('div', { class: 'result-newbest', text: '✨ じこベスト更新！ ✨' }));
      else if (summary.best != null)
        parts.push(el('div', { class: 'result-best', text: `じこベスト：${formatScore(meta.scoring, summary.best)}` }));
    } else {
      parts.push(el('div', { class: 'result-score', text: 'おつかれさま！' }));
    }
    if (summary.medal) {
      parts.push(
        el('div', {
          class: `result-medal medal-${summary.medal}` + (summary.medalUp ? ' medal-new' : ''),
          text: `${MEDAL_EMOJI[summary.medal]} ${MEDAL_LABEL[summary.medal]}${summary.medalUp ? ' GET!' : ''}`,
        }),
      );
    }
    for (const u of summary.unlocked) {
      parts.push(el('div', { class: 'result-ach', text: `🏆 ${u.name}` }));
    }
    parts.push(
      el(
        'div',
        { class: 'result-xp' },
        el('span', { text: `+${summary.xpGained} XP` }),
        summary.levelUp ? el('span', { class: 'levelup', text: ` レベルアップ！ Lv.${summary.levelUp.to}` }) : null,
      ),
    );
    parts.push(el('button', { class: 'btn btn-primary btn-large', text: 'もういちど', onclick: () => createInstanceAndCountdown() }));
    parts.push(el('button', { class: 'btn btn-ghost', text: 'ホームへ', onclick: () => doExit() }));

    showOverlay(el('div', { class: 'result' }, ...parts), 'result');
  }

  function doQuit(): void {
    if (!recorded && (playedMs > 0 || unlockedInRun.length > 0)) {
      recordQuit(meta, playedMs, unlockedInRun);
      recorded = true;
    }
    doExit();
  }

  function doExit(): void {
    // ガード解除（履歴巻き取り）が終わってから退出ナビゲーションを行う
    const g = guard;
    guard = null;
    if (g) g.release(onExit);
    else onExit();
  }

  // ---------- グローバルイベント ----------
  const onVisibility = (): void => {
    if (document.visibilityState === 'hidden' && state === 'playing') pauseGame('hidden');
  };
  document.addEventListener('visibilitychange', onVisibility);
  cleanupFns.push(() => document.removeEventListener('visibilitychange', onVisibility));

  cleanupFns.push(
    onOrientationChange(() => {
      if (state === 'playing' && !orientationSatisfied(meta.orientation)) {
        pauseGame('rotate');
      } else if (state === 'paused' && overlay.classList.contains('overlay-rotate') && orientationSatisfied(meta.orientation)) {
        showPauseMenu();
      }
    }),
  );

  // ---------- 起動 ----------
  // 初回プレイ時はヘルプ込みの開始前画面を必ず通る（＝ヘルプが自然に目に入る）
  showPregame();

  return {
    el: stage,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      window.clearTimeout(countdownTimer);
      if (!recorded && (playedMs > 0 || unlockedInRun.length > 0)) {
        recordQuit(meta, playedMs, unlockedInRun);
        recorded = true;
      }
      teardownInstance();
      ro.disconnect();
      // ルーター経由の破棄では履歴を巻き取らない（進行中の遷移を打ち消さないため）
      guard?.disarm();
      guard = null;
      releaseLock();
      releaseWakeLock();
      for (const fn of cleanupFns) fn();
      stage.remove();
    },
  };
}

/** 開始前画面に出す統計用（他画面から使う想定はないが将来のため公開） */
export function playCountOf(meta: GameMeta): number {
  return getDoc().games[meta.id]?.plays ?? 0;
}
