// Android の戻るボタン / ブラウザバックを安全に扱う仕組み。
// pushGuard() すると履歴に1段積まれ、「戻る」で onBack が1回呼ばれる（ページ遷移はしない）。
// ゲーム中の戻る→ポーズ、シート表示中の戻る→閉じる、に使う。
//
// 解除は2種類ある:
//  - release(after?): 積んだ履歴を history.back() で巻き取る（通常の閉じ・退出）。
//    back() は非同期のため、解除直後に location.hash を変えると競合する。
//    「解除後に遷移する」場合は必ず after コールバックで行うこと。
//  - disarm(): 履歴は巻き取らず、ガードだけ無効化する。
//    ルーター側の遷移でコンポーネントが破棄されるときに使う（ここで back() すると
//    進行中の遷移を打ち消してしまうため）。残った履歴エントリは同一URLなので無害。

interface Guard {
  onBack: () => void;
}

export interface GuardHandle {
  release(after?: () => void): void;
  disarm(): void;
}

const stack: Guard[] = [];
let swallow = 0;
const afterQueue: (() => void)[] = [];
let lastHref = '';

export function initBackstack(): void {
  lastHref = location.href;
  window.addEventListener('popstate', () => {
    const href = location.href;
    if (swallow > 0) {
      swallow--;
      lastHref = href;
      const cb = afterQueue.shift();
      cb?.();
      return;
    }
    // 注意: location.hash の変更（push）でも popstate は発火する。
    // ガードの履歴エントリは常に「同じURL」で積むため、URLが変わった popstate は
    // ハッシュ遷移（ルーターの担当）であり、ガードの「戻る」ではない。
    if (href !== lastHref) {
      lastHref = href;
      return;
    }
    const g = stack.pop();
    if (g) g.onBack();
  });
  window.addEventListener('hashchange', () => {
    lastHref = location.href;
  });
}

/** replaceState 等で popstate を伴わずURLを変えた直後に呼び、基準URLを同期する */
export function syncBackstack(): void {
  lastHref = location.href;
}

export function pushGuard(onBack: () => void): GuardHandle {
  const g: Guard = { onBack };
  let pushed = false;
  try {
    history.pushState({ g100Guard: true }, '');
    pushed = true;
  } catch {
    // Safariの連続pushState制限などは無視して動作継続
  }
  // 履歴エントリを積めなかった場合はスタックにも登録しない。
  // （登録すると対応エントリのない残留ガードになり、後続の同一URL popstate を誤って食う）
  if (pushed) stack.push(g);
  let done = false;
  return {
    release(after?: () => void): void {
      // release がイベントハンドラに直接渡されると after に Event が入ることがある。
      // 関数以外を後で呼び出すと TypeError になるため、ここで正規化する。
      const fn = typeof after === 'function' ? after : undefined;
      if (done) {
        fn?.();
        return;
      }
      done = true;
      const i = stack.indexOf(g);
      if (i >= 0) stack.splice(i, 1);
      if (pushed && i >= 0) {
        swallow++;
        afterQueue.push(fn ?? (() => undefined));
        history.back();
      } else {
        fn?.();
      }
    },
    disarm(): void {
      if (done) return;
      done = true;
      const i = stack.indexOf(g);
      if (i >= 0) stack.splice(i, 1);
    },
  };
}
