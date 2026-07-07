// Service Worker の更新通知・オフライン準備・インストール誘導のまとめ役。
import { registerSW } from 'virtual:pwa-register';

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

const OFFLINE_KEY = 'game100:offline-ready';

let updateFn: ((reload?: boolean) => Promise<void>) | null = null;
let installEvt: InstallPromptEvent | null = null;
let needRefresh = false;

const installCbs = new Set<() => void>();

export function initPwa(cb: { onNeedRefresh: () => void; onOfflineReady: () => void }): void {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installEvt = e as InstallPromptEvent;
    installCbs.forEach((f) => f());
  });

  updateFn = registerSW({
    immediate: true,
    onNeedRefresh() {
      needRefresh = true;
      cb.onNeedRefresh();
    },
    onOfflineReady() {
      try {
        localStorage.setItem(OFFLINE_KEY, '1');
      } catch {
        /* ignore */
      }
      cb.onOfflineReady();
    },
    onRegisteredSW(_url, reg) {
      if (!reg) return;
      // フォアグラウンド復帰時と1時間おきに更新チェック（適用はユーザー操作で）
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void reg.update().catch(() => {});
      });
      setInterval(() => void reg.update().catch(() => {}), 60 * 60 * 1000);
    },
  });
}

export function updateAvailable(): boolean {
  return needRefresh;
}

/** 新バージョンを適用してリロードする */
export function applyUpdate(): void {
  void updateFn?.(true);
}

export function canInstall(): boolean {
  return installEvt != null;
}

export function onInstallAvailable(cb: () => void): () => void {
  installCbs.add(cb);
  return () => installCbs.delete(cb);
}

/** Android のインストールダイアログを開く */
export async function promptInstall(): Promise<boolean> {
  const evt = installEvt;
  if (!evt) return false;
  // prompt() は同一イベントに対して一度しか呼べない（2回目は例外になる）ため、
  // 結果にかかわらず消費済みとして破棄する。再度可能になればブラウザがイベントを再発火する。
  installEvt = null;
  try {
    await evt.prompt();
    const choice = await evt.userChoice;
    return choice.outcome === 'accepted';
  } catch {
    return false;
  } finally {
    installCbs.forEach((f) => f()); // ボタン表示を更新させる（canInstall が false になった）
  }
}

/** 過去に「オフライン準備完了」に到達したか */
export function offlineReadyStored(): boolean {
  try {
    return localStorage.getItem(OFFLINE_KEY) === '1';
  } catch {
    return false;
  }
}

/** SWとキャッシュを消して入れ直す（表示が壊れたときの復旧用。保存データは消さない） */
export async function repairCaches(): Promise<void> {
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
    localStorage.removeItem(OFFLINE_KEY);
  } catch {
    /* ignore */
  }
  location.reload();
}
