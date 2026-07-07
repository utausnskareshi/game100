import type { HapticKind } from '../game-api/types';
import { settings } from './settings';

const PATTERNS: Record<HapticKind, number | number[]> = {
  light: 10,
  medium: 25,
  success: [15, 40, 20],
  error: [40, 60, 40],
};

export function hapticsSupported(): boolean {
  return 'vibrate' in navigator;
}

/** バイブレーション。iOS等の非対応端末では何もしない */
export function haptic(kind: HapticKind): void {
  if (!settings.get().haptics) return;
  try {
    navigator.vibrate?.(PATTERNS[kind]);
  } catch {
    /* ignore */
  }
}
