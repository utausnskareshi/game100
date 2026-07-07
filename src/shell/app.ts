// アプリシェル: 下部タブ・画面切替・ゲームホストのマウント・更新トースト
import { el, clear } from '../platform/dom';
import { syncBackstack } from '../platform/backstack';
import { currentRoute, initRouter, navigate, type Route, type TabName } from '../platform/router';
import { mountGameHost, type GameHostHandle } from '../platform/game-host';
import { gameById } from '../games/index';
import { applyUpdate, updateAvailable } from '../platform/pwa';
import { renderHome } from './home';
import { renderGames } from './games';
import { renderRecords } from './records';
import { renderSettings } from './settings';
import { exitGamePlay } from './nav';
import { toast } from './ui';
import { t } from './strings';

const TAB_DEF: { key: TabName; ico: string; label: string }[] = [
  { key: 'home', ico: '🏠', label: t.tabs.home },
  { key: 'games', ico: '🎮', label: t.tabs.games },
  { key: 'records', ico: '🏅', label: t.tabs.records },
  { key: 'settings', ico: '⚙️', label: t.tabs.settings },
];

let updateToastShown = false;

function maybeShowUpdateToast(): void {
  if (updateToastShown || !updateAvailable()) return;
  if (currentRoute().name === 'play') return; // ゲーム中は出さない（ホームに戻ったとき表示）
  updateToastShown = true;
  toast(t.update.available, {
    actionLabel: t.update.apply,
    onAction: () => applyUpdate(),
    duration: 15000,
  });
}

/** SW更新の通知（main.tsのinitPwaから呼ばれる） */
export function notifyUpdateAvailable(): void {
  maybeShowUpdateToast();
}

export function startApp(root: HTMLElement): void {
  clear(root);

  const screen = el('main', { class: 'screen' });
  const inner = el('div', { class: 'screen-inner' });
  screen.appendChild(inner);

  const tabbar = el('nav', { class: 'tabbar' });
  const tabBtns = new Map<TabName, HTMLButtonElement>();
  for (const d of TAB_DEF) {
    const btn = el(
      'button',
      { class: 'tab-btn', onclick: () => navigate(`#/${d.key}`, { replace: true }) },
      el('span', { class: 'tab-ico', text: d.ico }),
      el('span', { text: d.label }),
    );
    tabBtns.set(d.key, btn);
    tabbar.appendChild(btn);
  }

  const shell = el('div', { class: 'app-shell' }, screen, tabbar);
  root.appendChild(shell);

  let host: GameHostHandle | null = null;

  const renderTab = (tab: TabName): void => {
    clear(inner);
    for (const [key, btn] of tabBtns) btn.classList.toggle('active', key === tab);
    switch (tab) {
      case 'home':
        renderHome(inner);
        break;
      case 'games':
        renderGames(inner);
        break;
      case 'records':
        renderRecords(inner);
        break;
      case 'settings':
        renderSettings(inner);
        break;
    }
    screen.scrollTop = 0;
  };

  const renderRoute = (r: Route): void => {
    if (r.name === 'play') {
      const meta = gameById(r.gameId);
      if (!meta || meta.status === 'retired') {
        navigate('#/home', { replace: true });
        return;
      }
      host?.destroy();
      shell.classList.add('in-game');
      host = mountGameHost(meta, exitGamePlay);
      root.appendChild(host.el);
      return;
    }
    if (host) {
      host.destroy();
      host = null;
    }
    shell.classList.remove('in-game');
    renderTab(r.tab);
    maybeShowUpdateToast();
  };

  initRouter(renderRoute);
  if (!location.hash) {
    history.replaceState(null, '', '#/home');
    syncBackstack(); // replaceState は popstate を発火しないため基準URLを手動同期
  }
  renderRoute(currentRoute());
}
