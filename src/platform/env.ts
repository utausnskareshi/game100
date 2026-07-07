export type Platform = 'ios' | 'android' | 'desktop';

/** ホーム画面から起動されたか（インストール済みPWAとして動いているか） */
export function isStandalone(): boolean {
  return (
    matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function detectPlatform(): Platform {
  const ua = navigator.userAgent;
  if (/Android/i.test(ua)) return 'android';
  // iPadOS は Macintosh を名乗るため、タッチ点数で判定する
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) {
    return 'ios';
  }
  return 'desktop';
}
