// =============================================================
// GAME100 ゲーム共通ヘルパー
// =============================================================
// ゲームが import してよいのは src/game-api/ 配下（types.ts と本ファイル）だけ。
// ここに置いてよいのは「platform / shell に依存しない純粋な DOM・数学ユーティリティ」のみ。
// 機能（音・保存・入力・時間・乱数）は必ず GameContext 経由で受け取ること。
//
// 互換性ルール（全ゲームが依存するため契約と同格に扱う）:
//   - 追加のみ可。既存関数のシグネチャ・挙動は変更しない（変更＝全ゲームの回帰確認）
//   - ここへの追加は「3ゲーム以上で重複が顕在化してから」を目安にする（早すぎる抽象化をしない）
// =============================================================
import type { GameContext } from './types';

/** v を [min, max] の範囲に収める */
export const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));

/** 小さな DOM 生成ヘルパー（クラス名とテキストだけの定番パターン） */
export function elem(tag: string, className?: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text != null) e.textContent = text;
  return e;
}

/**
 * 設定画面の「ラベル＋セグメント選択」行を作る（リバーシ〜ヒットアンドブローで共通のUIパターン）。
 * 生成するクラス名は `${prefix}-seg-row` / `${prefix}-seg-label` / `${prefix}-seg` /
 * `${prefix}-seg-btn` / 選択中 `${prefix}-on`。
 * 見た目の CSS は各ゲームが自前で持つ（prefix を合わせれば既存 CSS がそのまま効く）。
 */
export function makeSeg(
  prefix: string,
  label: string,
  opts: { v: string; t: string }[],
  get: () => string,
  set: (v: string) => void,
): HTMLElement {
  const row = elem('div', `${prefix}-seg-row`);
  row.append(elem('div', `${prefix}-seg-label`, label));
  const segEl = elem('div', `${prefix}-seg`);
  const onCls = `${prefix}-on`;
  const paint = (): void => {
    for (const child of Array.from(segEl.children) as HTMLElement[]) {
      child.classList.toggle(onCls, child.dataset.v === get());
    }
  };
  for (const o of opts) {
    const b = elem('button', `${prefix}-seg-btn`, o.t) as HTMLButtonElement;
    b.dataset.v = o.v;
    b.addEventListener('click', () => {
      set(o.v);
      paint();
    });
    segEl.append(b);
  }
  row.append(segEl);
  paint();
  return row;
}

export interface Countdown {
  /** カウントダウンを開始する（now は ctx.now()） */
  start(now: number): void;
  /** 毎フレーム呼ぶ（カウント中のみでよい）。刻みごとに onCount、0 到達で onGo が1回呼ばれる */
  tick(now: number): void;
  /** 表示用の現在の数字（steps→…→1）。開始前・終了後は 0。tick() の後に読むこと */
  readonly count: number;
  /** カウントダウン進行中か */
  readonly active: boolean;
}

/**
 * ゲーム内カウントダウン（3・2・1 → 開始）。
 * onFrame + ctx.now の期限方式なので、ポーズ中は自動で止まり再開で続きから進む。
 * 設定画面を持つゲーム（startMode:'immediate'）が自前で 3-2-1 を出すときの公式パターン。
 * 数字の描画・効果音はゲーム側が onCount / onGo で行う（Canvas でも DOM でも使える）。
 */
export function createCountdown(opts: {
  /** 0 になった瞬間（ゲーム開始）。now を渡すので開始時刻の記録に使える */
  onGo: (now: number) => void;
  /** 各刻みの表示タイミング（n = steps, …, 1） */
  onCount?: (n: number) => void;
  /** 刻み数（既定 3） */
  steps?: number;
  /** 1刻みのミリ秒（既定 650。シェルのカウントダウンと同じテンポ） */
  stepMs?: number;
}): Countdown {
  const steps = opts.steps ?? 3;
  const stepMs = opts.stepMs ?? 650;
  let count = 0;
  let nextAt = Infinity;
  let active = false;
  return {
    get count() {
      return active ? Math.min(count, steps) : 0;
    },
    get active() {
      return active;
    },
    start(now: number) {
      count = steps + 1; // 直後の tick で steps に落ちて最初の onCount が出る
      nextAt = now;
      active = true;
    },
    tick(now: number) {
      if (!active || now < nextAt) return;
      count--;
      if (count >= 1) {
        opts.onCount?.(count);
        nextAt = now + stepMs;
      } else {
        active = false;
        nextAt = Infinity;
        opts.onGo(now);
      }
    },
  };
}

export interface DragTilt {
  /** センサー傾き（ctx.motion）とドラッグ由来の仮想傾きを合成した現在値（各 -1〜1） */
  value(): { x: number; y: number };
  /** このインスタンスの生涯で一度でもドラッグ操作をしたか（「センサーだけでクリア」系の実績判定用） */
  readonly usedDrag: boolean;
  /** 仮想傾きとドラッグ状態をリセットする（ポーズ復帰・「すいへい」時。usedDrag は消えない） */
  reset(): void;
  /** 入力購読を解除する（destroy() で必ず呼ぶ） */
  destroy(): void;
}

/**
 * 「画面ドラッグ＝仮想傾き」入力（かたむきメイロで実証済みのセンサー代替操作）。
 * ドラッグ開始点からの相対オフセット ÷ div が仮想傾きになり、指を離すと 0 に戻る。
 * センサー許可がない端末でも同じゲームがそのまま遊べるようにするための共通実装。
 */
export function createDragTilt(
  ctx: Pick<GameContext, 'input' | 'motion'>,
  opts: {
    /** PointerInfo（root 基準）→ ゲーム座標系への変換（Canvas なら cv.toLocal） */
    toLocal: (p: { x: number; y: number }) => { x: number; y: number };
    /** ドラッグ量→仮想傾きの割る数（大きいほど鈍い。既定 70） */
    div?: number;
    /** false の間は新しいドラッグを受け付けない（設定画面・ポーズ中のガード用） */
    enabled?: () => boolean;
  },
): DragTilt {
  const div = opts.div ?? 70;
  const enabled = opts.enabled ?? ((): boolean => true);
  const virtual = { x: 0, y: 0 };
  let dragOrigin: { x: number; y: number } | null = null;
  let usedDrag = false;

  const offDown = ctx.input.onDown((p) => {
    if (!enabled()) return;
    dragOrigin = opts.toLocal(p);
  });
  const offMove = ctx.input.onMove((p) => {
    if (!enabled() || !dragOrigin) return;
    const l = opts.toLocal(p);
    virtual.x = clamp((l.x - dragOrigin.x) / div, -1, 1);
    virtual.y = clamp((l.y - dragOrigin.y) / div, -1, 1);
    if (virtual.x !== 0 || virtual.y !== 0) usedDrag = true;
  });
  // 指が離れたら（pointercancel の onUp 合成も含む）仮想傾きを即座に解除する
  const offUp = ctx.input.onUp(() => {
    dragOrigin = null;
    virtual.x = 0;
    virtual.y = 0;
  });

  return {
    get usedDrag() {
      return usedDrag;
    },
    value() {
      const mx = ctx.motion?.tilt.x ?? 0;
      const my = ctx.motion?.tilt.y ?? 0;
      return { x: clamp(mx + virtual.x, -1, 1), y: clamp(my + virtual.y, -1, 1) };
    },
    reset() {
      dragOrigin = null;
      virtual.x = 0;
      virtual.y = 0;
    },
    destroy() {
      offDown();
      offMove();
      offUp();
    },
  };
}

/**
 * 円を矩形の外へ押し出す（かたむきメイロで実証済みの衝突応答。
 * ボール中心が矩形内側に入った場合＝d2≈0 のときに浅い軸へ確実に押し出す対策込み）。
 * めり込んでいれば c の座標を書き換え、押し出した主軸（'x' | 'y'）を返す。触れていなければ null。
 * 速度の反射・減衰は返り値の軸に対してゲーム側で行う（ゲームごとに手触りが違うため）。
 */
export function pushOutCircleFromRect(
  c: { x: number; y: number },
  r: number,
  rect: { x: number; y: number; w: number; h: number },
): 'x' | 'y' | null {
  const nx = clamp(c.x, rect.x, rect.x + rect.w);
  const ny = clamp(c.y, rect.y, rect.y + rect.h);
  const dx = c.x - nx;
  const dy = c.y - ny;
  const d2 = dx * dx + dy * dy;
  if (d2 >= r * r) return null; // 触れていない
  if (d2 > 0.0001) {
    // 通常: 最近点からの法線方向へ押し出す
    const d = Math.sqrt(d2);
    const push = r - d;
    c.x += (dx / d) * push;
    c.y += (dy / d) * push;
    return Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
  }
  // 中心が矩形の内側（角で別の矩形に押し込まれた等）。ここを飛ばすと
  // すり抜け／はまりが起きるので、めり込みの浅い軸へ確実に押し出す
  const oL = c.x - rect.x;
  const oR = rect.x + rect.w - c.x;
  const oT = c.y - rect.y;
  const oB = rect.y + rect.h - c.y;
  if (Math.min(oL, oR) < Math.min(oT, oB)) {
    c.x += oL < oR ? -(oL + r) : oR + r;
    return 'x';
  }
  c.y += oT < oB ? -(oT + r) : oB + r;
  return 'y';
}
