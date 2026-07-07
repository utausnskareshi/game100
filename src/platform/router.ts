// ハッシュルーター（GitHub Pages でサーバ設定不要・オフラインでも履歴が機能する）
import { syncBackstack } from './backstack';

export type TabName = 'home' | 'games' | 'records' | 'settings';

export type Route = { name: 'tab'; tab: TabName } | { name: 'play'; gameId: string };

const TABS: readonly TabName[] = ['home', 'games', 'records', 'settings'];

export function parseRoute(hash: string): Route {
  const seg = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (seg[0] === 'play' && seg[1]) {
    let gameId = seg[1];
    try {
      gameId = decodeURIComponent(gameId);
    } catch {
      // 不正な%エンコーディングはそのまま扱う（未知IDとしてホームへ振られる）
    }
    return { name: 'play', gameId };
  }
  const tab = TABS.find((t) => t === seg[0]);
  return { name: 'tab', tab: tab ?? 'home' };
}

type Listener = (r: Route) => void;
const listeners: Listener[] = [];

export function initRouter(onChange: Listener): void {
  listeners.push(onChange);
  window.addEventListener('hashchange', emit);
}

export function currentRoute(): Route {
  return parseRoute(location.hash);
}

/** タブ切替は replace（戻るスタックを汚さない）、ゲーム起動は push で呼ぶ */
export function navigate(path: string, opts?: { replace?: boolean }): void {
  const target = path.startsWith('#') ? path : '#' + path;
  if (opts?.replace) {
    history.replaceState(null, '', target);
    syncBackstack(); // replaceState は popstate を発火しないため基準URLを手動同期
    emit();
  } else if (location.hash === target) {
    emit();
  } else {
    location.hash = target;
  }
}

function emit(): void {
  const r = currentRoute();
  for (const l of [...listeners]) l(r);
}
