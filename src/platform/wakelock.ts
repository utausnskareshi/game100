// ゲーム中の画面スリープ防止（Screen Wake Lock API）。
// 傾き操作のゲームは画面に触れないため、これがないと途中で画面が暗くなる。
interface WakeLockLike {
  request(type: 'screen'): Promise<{ release(): Promise<void> }>;
}

let sentinel: { release(): Promise<void> } | null = null;
let wanted = false;
let requesting = false;

export async function acquireWakeLock(): Promise<void> {
  wanted = true;
  if (!('wakeLock' in navigator) || requesting || sentinel) return;
  requesting = true;
  try {
    const s = await (navigator as Navigator & { wakeLock: WakeLockLike }).wakeLock.request('screen');
    if (wanted && !sentinel) {
      sentinel = s;
    } else {
      // request() の解決前に releaseWakeLock() が呼ばれていた → 即座に手放す
      void s.release().catch(() => undefined);
    }
  } catch {
    // 低電力モード等では失敗する。致命的ではない
  } finally {
    requesting = false;
  }
}

export function releaseWakeLock(): void {
  wanted = false;
  if (sentinel) {
    void sentinel.release().catch(() => undefined);
    sentinel = null;
  }
}

// バックグラウンドから復帰したら自動で取り直す
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && wanted) {
    // 画面OFF等でOSに自動解放された分を取り直す（古い参照は既に無効なので捨てる）
    sentinel = null;
    void acquireWakeLock();
  }
});
