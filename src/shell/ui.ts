// 共通UI部品: トースト・確認ダイアログ・ボトムシート・ゲームアイコン・トグル
import type { GameMeta } from '../game-api/types';
import { el } from '../platform/dom';
import { pushGuard, type GuardHandle } from '../platform/backstack';
import { hashString } from '../platform/rng';
import { t } from './strings';

/**
 * NEW バッジ・新着の判定。バージョン方式は「真ん中の数字＝収録ゲーム数」なので、
 * major.minor が一致すれば同じ収録世代（＝最新の追加分）とみなす。
 * addedIn との完全一致にすると、ゲーム追加を伴わないパッチ（0.5.0→0.5.1）で
 * NEW 表示が全部消えてしまうため、パッチ部分は比較しない。
 */
export function isNewGame(meta: GameMeta): boolean {
  const cur = __APP_VERSION__.split('.');
  const added = meta.addedIn.split('.');
  return added[0] === cur[0] && added[1] === cur[1];
}

// ---------- トースト ----------

let toastArea: HTMLElement | null = null;

function ensureToastArea(): HTMLElement {
  if (!toastArea || !toastArea.isConnected) {
    toastArea = el('div', { id: 'toast-area' });
    document.body.appendChild(toastArea);
  }
  return toastArea;
}

export function toast(
  message: string,
  opts?: { actionLabel?: string; onAction?: () => void; duration?: number },
): void {
  const area = ensureToastArea();
  const node = el('div', { class: 'toast' }, el('span', { text: message }));
  if (opts?.actionLabel) {
    node.appendChild(
      el('button', {
        text: opts.actionLabel,
        onclick: () => {
          opts.onAction?.();
          hide();
        },
      }),
    );
  }
  area.appendChild(node);
  requestAnimationFrame(() => node.classList.add('show'));
  const hide = (): void => {
    node.classList.remove('show');
    setTimeout(() => node.remove(), 350);
  };
  setTimeout(hide, opts?.duration ?? (opts?.actionLabel ? 8000 : 2800));
}

// ---------- 確認ダイアログ ----------

// 開くボタンの連打で同じダイアログが多重に積まれるのを防ぐ（bottomSheet の sheetShowing と同様）
let dialogShowing = false;

export function confirmDialog(opts: {
  title: string;
  message: string;
  okLabel?: string;
  danger?: boolean;
}): Promise<boolean> {
  return new Promise((resolve) => {
    if (dialogShowing) {
      resolve(false); // 既に開いている場合はキャンセル扱い
      return;
    }
    dialogShowing = true;
    let guard: GuardHandle | null = null;
    let settled = false;
    // 閉じたときにフォーカスを返す先（開く操作をしたボタン等）
    const prevFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const done = (v: boolean): void => {
      if (settled) return; // ボタン連打・背景タップの二重発火は最初の1回だけ有効
      settled = true;
      dialogShowing = false;
      backdrop.classList.remove('show');
      setTimeout(() => {
        backdrop.remove();
        // フォーカスが行き場を失った場合のみ返す（既に別のUIへ移っていれば奪わない）
        const ae = document.activeElement;
        if ((ae === null || ae === document.body) && prevFocus?.isConnected) {
          prevFocus.focus({ preventScroll: true });
        }
      }, 250);
      const g = guard;
      guard = null;
      if (g) g.release(() => resolve(v));
      else resolve(v);
    };
    const backdrop = el('div', { class: 'modal-backdrop' });
    const box = el(
      'div',
      { class: 'modal card', role: 'dialog', 'aria-modal': 'true', tabindex: '-1' },
      el('h3', { class: 'modal-title', text: opts.title }),
      el('p', { class: 'modal-msg pre-line', text: opts.message }),
      el(
        'div',
        { class: 'modal-actions' },
        el('button', { class: 'btn btn-ghost', text: t.common.cancel, onclick: () => done(false) }),
        el('button', {
          class: 'btn ' + (opts.danger ? 'btn-danger' : 'btn-primary'),
          text: opts.okLabel ?? t.common.ok,
          onclick: () => done(true),
        }),
      ),
    );
    backdrop.appendChild(box);
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) done(false);
    });
    document.body.appendChild(backdrop);
    requestAnimationFrame(() => {
      if (settled) return; // 表示前に閉じられていたら .show を付け直さない（除去までの間だけ再表示されるのを防ぐ）
      backdrop.classList.add('show');
      // フォーカスをダイアログへ移す（ハードウェアキーボードで背後を操作させない）
      box.focus({ preventScroll: true });
    });
    guard = pushGuard(() => {
      guard = null;
      done(false);
    });
  });
}

// ---------- ボトムシート ----------

// 現在開いているシートがあるか（開くボタンの連打で同じシートが多重に積まれるのを防ぐ）
let sheetShowing = false;

/** close(after?) — 閉じたあとに画面遷移する場合は必ず after コールバックで行う（履歴巻き取りとの競合防止） */
export function bottomSheet(build: (close: (after?: () => void) => void) => HTMLElement): void {
  if (sheetShowing) return;
  sheetShowing = true;
  // 閉じたときにフォーカスを返す先（開く操作をしたボタン等）
  const prevFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  let guard: GuardHandle | null = null;
  let closed = false;
  const backdrop = el('div', { class: 'sheet-backdrop' });
  const sheet = el('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', tabindex: '-1' }, el('div', { class: 'sheet-grip' }));

  const close = (after?: () => void): void => {
    // 閉じアニメーション中の2回目の close は無視する。
    // （ここで after を即時実行すると、1回目の履歴巻き取り(history.back)と競合して遷移が壊れる）
    if (closed) return;
    closed = true;
    sheetShowing = false;
    // onclick: close のようにイベントハンドラへ直接渡されると after に Event が入るため、関数以外は無視する
    const fn = typeof after === 'function' ? after : undefined;
    backdrop.classList.remove('show');
    sheet.classList.remove('show');
    setTimeout(() => {
      backdrop.remove();
      sheet.remove();
      // フォーカスが行き場を失った場合のみ、開いたときの要素へ返す
      // （300ms以内に別のシート等へフォーカスが移っていたら奪わない）
      const ae = document.activeElement;
      if ((ae === null || ae === document.body) && prevFocus?.isConnected) {
        prevFocus.focus({ preventScroll: true });
      }
    }, 300);
    const g = guard;
    guard = null;
    if (g) g.release(fn);
    else fn?.();
  };

  let built: HTMLElement;
  try {
    built = build(close);
  } catch (err) {
    // build が失敗したらフラグを戻す（戻さないと以後すべてのシートが開けなくなる）
    sheetShowing = false;
    throw err;
  }
  if (closed) return; // build が同期的に close() を呼んだ場合は表示しない
  sheet.appendChild(built);
  backdrop.addEventListener('click', () => close());
  document.body.append(backdrop, sheet);
  requestAnimationFrame(() => {
    if (closed) return; // 表示前に閉じられていたら .show を付け直さない（除去までの間だけ再表示されるのを防ぐ）
    backdrop.classList.add('show');
    sheet.classList.add('show');
    // フォーカスをシートへ移す（ハードウェアキーボードで背後を操作させない）
    sheet.focus({ preventScroll: true });
  });
  guard = pushGuard(() => {
    guard = null;
    close();
  });
}

// ---------- シンプルな情報モーダル（What's New等） ----------

export function infoSheet(title: string, body: HTMLElement): void {
  bottomSheet((close) =>
    el(
      'div',
      { class: 'info-sheet' },
      el('h2', { class: 'sheet-title', text: title }),
      body,
      el('button', { class: 'btn btn-primary btn-large', text: 'とじる', onclick: close }),
    ),
  );
}

// ---------- ゲームアイコン（絵文字 + ID由来のグラデ背景） ----------

export function gameIconTile(meta: GameMeta, size: 'sm' | 'md' | 'lg' = 'md'): HTMLElement {
  const h = hashString(meta.id);
  const hue = h % 360;
  const hue2 = (hue + 45) % 360;
  const tile = el('div', { class: `game-icon game-icon-${size}`, text: meta.icon.emoji, 'aria-hidden': 'true' });
  tile.style.background = `linear-gradient(135deg, hsl(${hue} 55% 42%), hsl(${hue2} 65% 55%))`;
  return tile;
}

// ---------- 設定行（トグル・セグメント） ----------

export function toggleRow(
  label: string,
  get: () => boolean,
  set: (v: boolean) => void,
  note?: string,
  opts?: { disabled?: boolean },
): HTMLElement {
  const sw = el('button', {
    class: 'switch' + (get() ? ' on' : ''),
    role: 'switch',
    'aria-label': label,
    disabled: opts?.disabled === true,
  });
  sw.addEventListener('click', () => {
    const v = !get();
    set(v);
    sw.classList.toggle('on', v);
  });
  return el(
    'div',
    { class: 'setting-row' },
    el('div', null, el('div', { class: 'setting-label', text: label }), note ? el('div', { class: 'setting-note', text: note }) : null),
    sw,
  );
}

export function segRow<T extends string>(
  label: string,
  options: { value: T; label: string }[],
  get: () => T,
  set: (v: T) => void,
): HTMLElement {
  const seg = el('div', { class: 'seg' });
  const rerender = (): void => {
    seg.replaceChildren(
      ...options.map((o) =>
        el('button', {
          class: o.value === get() ? 'active' : '',
          text: o.label,
          onclick: () => {
            set(o.value);
            rerender();
          },
        }),
      ),
    );
  };
  rerender();
  return el('div', { class: 'setting-row setting-row-col' }, el('div', { class: 'setting-label', text: label }), seg);
}

export function buttonRow(label: string, onClick: () => void, opts?: { danger?: boolean; note?: string }): HTMLElement {
  // 行全体（右端の › まで）が見た目どおりタップできるよう、行そのものをボタンにする
  return el(
    'button',
    { class: 'setting-row row-btn', onclick: onClick },
    el(
      'div',
      null,
      el('span', {
        class: 'link-btn' + (opts?.danger ? ' danger' : ''),
        text: label,
      }),
      opts?.note ? el('div', { class: 'setting-note', text: opts.note }) : null,
    ),
    el('span', { class: 'row-arrow', text: '›' }),
  );
}

export function sectionTitle(text: string): HTMLElement {
  return el('h2', { class: 'section-h', text });
}
