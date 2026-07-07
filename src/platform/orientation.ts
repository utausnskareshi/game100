// 画面の向き制御。
//  - Android: ゲーム中のみ screen.orientation.lock()（ブラウザタブでは全画面化してから）
//  - iOS: lock 非対応（2026年時点）→ 呼び出し側が回転案内オーバーレイを表示する
//  - manifest の orientation は 'any' にしてある（unlock時にmanifest設定へ戻るため）
import type { Orientation } from '../game-api/types';

export function currentOrientation(): 'portrait' | 'landscape' {
  return matchMedia('(orientation: portrait)').matches ? 'portrait' : 'landscape';
}

export function orientationSatisfied(need: Orientation): boolean {
  return need === 'any' || currentOrientation() === need;
}

interface LockableOrientation {
  lock?: (o: 'portrait' | 'landscape') => Promise<void>;
  unlock?: () => void;
}

let lockedByUs = false;
let fullscreenByUs = false;
// releaseLock() のたびに進む世代番号。tryLock の await 中に releaseLock が走った場合
// （例: ロック取得中にゲームホストが破棄された）、解決後に取得結果を巻き戻すために使う。
let epoch = 0;

/** 向きの固定を試みる。成功したら true（iOSでは常にfalse） */
export async function tryLock(need: Orientation, fullscreenEl: HTMLElement): Promise<boolean> {
  if (need === 'any') return true;
  const so = screen.orientation as unknown as LockableOrientation | undefined;
  if (!so?.lock) return false;
  const myEpoch = epoch;
  // await 中に releaseLock 済みなら、今取れたロック（と自分で入った全画面）を即座に手放す
  const undoIfStale = (exitFullscreen: boolean): boolean => {
    if (epoch === myEpoch) return false;
    try {
      so.unlock?.();
    } catch {
      /* ignore */
    }
    if (exitFullscreen) {
      try {
        if (document.fullscreenElement) void document.exitFullscreen();
      } catch {
        /* ignore */
      }
    }
    return true;
  };
  try {
    await so.lock(need);
    if (undoIfStale(false)) return false;
    lockedByUs = true;
    return true;
  } catch {
    // ブラウザタブ表示のAndroidでは全画面が前提のことがある
    try {
      if (document.fullscreenElement == null && fullscreenEl.requestFullscreen) {
        await fullscreenEl.requestFullscreen();
        if (undoIfStale(true)) return false;
        fullscreenByUs = true;
        await so.lock(need);
        if (undoIfStale(true)) {
          fullscreenByUs = false;
          return false;
        }
        lockedByUs = true;
        return true;
      }
    } catch {
      /* fall through */
    }
    if (fullscreenByUs) {
      try {
        void document.exitFullscreen();
      } catch {
        /* ignore */
      }
      fullscreenByUs = false;
    }
    return false;
  }
}

export function releaseLock(): void {
  epoch++;
  const so = screen.orientation as unknown as LockableOrientation | undefined;
  if (lockedByUs) {
    try {
      so?.unlock?.();
    } catch {
      /* ignore */
    }
    lockedByUs = false;
  }
  if (fullscreenByUs) {
    try {
      if (document.fullscreenElement) void document.exitFullscreen();
    } catch {
      /* ignore */
    }
    fullscreenByUs = false;
  }
}

export function onOrientationChange(cb: () => void): () => void {
  const mq = matchMedia('(orientation: portrait)');
  const handler = () => cb();
  mq.addEventListener('change', handler);
  return () => mq.removeEventListener('change', handler);
}
