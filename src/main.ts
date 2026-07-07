// エントリポイント: 起動処理と「ランディング / アプリ」の分岐
import './styles/main.css';
import { initStorage } from './platform/storage';
import { applyTheme, settings } from './platform/settings';
import { initBackstack } from './platform/backstack';
import { initDebugConsole } from './platform/debug';
import { initPwa } from './platform/pwa';
import { isStandalone } from './platform/env';
import { renderLanding } from './shell/landing';
import { notifyUpdateAvailable, startApp } from './shell/app';
import { toast } from './shell/ui';
import { t } from './shell/strings';

async function boot(): Promise<void> {
  applyTheme();
  initDebugConsole();
  initBackstack();
  await initStorage();

  initPwa({
    onNeedRefresh: () => notifyUpdateAvailable(),
    onOfflineReady: () => toast(t.offlineReady),
  });

  const app = document.getElementById('app');
  if (!app) throw new Error('#app not found');

  // ホーム画面から起動、または過去に「ブラウザであそぶ」を選択済み → 直接アプリへ。
  // それ以外のブラウザ閲覧 → ランディング（説明とインストール手順）。
  if (isStandalone() || settings.get().browserMode) {
    startApp(app);
  } else {
    renderLanding(app, {
      onEnter: () => {
        settings.update({ browserMode: true });
        startApp(app);
      },
    });
  }
}

void boot();
