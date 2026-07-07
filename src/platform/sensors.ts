// 加速度センサー（傾き・シェイク）の許可フローと値の正規化。
//  - iOS はユーザー操作内での requestPermission が必須（拒否は端末に記憶される）
//  - iOS と Android で加速度の符号が逆のため、プラットフォームで補正する
//  - 画面の回転（横持ち）にも追従して、常に「画面基準」の傾きを返す
import type { MotionHelper, Unsubscribe } from '../game-api/types';
import { detectPlatform } from './env';

export type MotionPermission = 'granted' | 'denied' | 'unavailable';

interface RequestablePermission {
  requestPermission?: () => Promise<'granted' | 'denied'>;
}

export function motionAvailable(): boolean {
  return 'DeviceMotionEvent' in window;
}

/** 必ずユーザー操作（タップ）のハンドラ内で呼ぶこと */
export async function requestMotionPermission(): Promise<MotionPermission> {
  if (!motionAvailable()) return 'unavailable';
  const dme = DeviceMotionEvent as unknown as RequestablePermission;
  if (typeof dme.requestPermission === 'function') {
    try {
      const r = await dme.requestPermission();
      return r === 'granted' ? 'granted' : 'denied';
    } catch {
      return 'denied';
    }
  }
  return 'granted'; // Android 等は許可不要
}

function screenAngle(): number {
  try {
    if (screen.orientation && typeof screen.orientation.angle === 'number') {
      return screen.orientation.angle;
    }
  } catch {
    /* ignore */
  }
  const legacy = (window as Window & { orientation?: number }).orientation;
  return typeof legacy === 'number' ? legacy : 0;
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

export function createMotionHelper(): { helper: MotionHelper; destroy: () => void } {
  const tilt = { x: 0, y: 0 };
  const pre = { x: 0, y: 0 }; // キャリブレーション前の値
  const offset = { x: 0, y: 0 };
  const shakeCbs = new Set<() => void>();
  let lastShakeAt = 0;

  // iOS と Android は accelerationIncludingGravity の符号が逆という前提で正規化する
  // （Android=spec準拠の反作用ベクトル / iOS はその符号反転）。この前提が誤っていると
  // そのOSの縦持ちで tilt.x/y が両方反転するため、実機（iOS Safari / Android Chrome）での
  // 符号確認が望ましい（?debug 画面で dev-tilt の tilt 値を見る）。
  const sign = detectPlatform() === 'ios' ? 1 : -1;

  const onMotion = (e: DeviceMotionEvent) => {
    const g = e.accelerationIncludingGravity;
    if (g && g.x != null && g.y != null) {
      const gx = (g.x * sign) / 9.81; // 端末の右端が下がると正
      const gy = (g.y * sign) / 9.81; // 端末の上端が下がると正
      // 端末座標 → 画面座標（回転補正）。sx=画面の右端が下がると正 / sy=画面の上端が下がると正。
      // screen.orientation.angle は「自然向きから時計回りに回した表示角」＝端末の物理回転の逆。
      //   angle=90 ⟺ 端末を反時計回り(CCW)90°（画面右=端末の上端 / 画面上=端末の右端）→ sx=-gy, sy=gx
      //   angle=270 ⟺ 端末を時計回り(CW)90°（画面右=端末の下端 / 画面上=端末の左端）→ sx=gy, sy=-gx
      // ※各姿勢での画面各辺がどの端末辺かを割り出した幾何変換（W3C/MDN の angle 定義に基づく）。
      //   90/270 が入れ替わると横持ちゲーム(maze)で左右・上下が反転する。最終確認は実機推奨。
      const a = ((screenAngle() % 360) + 360) % 360;
      let sx = gx;
      let sy = gy;
      if (a === 90) {
        sx = -gy;
        sy = gx;
      } else if (a === 180) {
        sx = -gx;
        sy = -gy;
      } else if (a === 270) {
        sx = gy;
        sy = -gx;
      }
      // キャンバス座標（yは下向きが正）に合わせる。
      // ゲイン1.6: tilt=±1.0 ≒ 約39°の傾き（types.ts の MotionHelper ドキュメントと連動。
      // 変更すると全センサーゲームのデッドゾーン・最大傾きの体感が一斉に変わるので注意）
      pre.x = clamp(sx * 1.6, -1, 1);
      pre.y = clamp(-sy * 1.6, -1, 1);
      tilt.x = clamp(pre.x - offset.x, -1, 1);
      tilt.y = clamp(pre.y - offset.y, -1, 1);
    }

    // シェイク検出（重力抜きの加速度があれば優先）
    const acc = e.acceleration;
    let mag = 0;
    if (acc && acc.x != null && acc.y != null && acc.z != null) {
      mag = Math.hypot(acc.x, acc.y, acc.z);
    } else if (g && g.x != null && g.y != null && g.z != null) {
      mag = Math.abs(Math.hypot(g.x, g.y, g.z) - 9.81);
    }
    if (mag > 16) {
      const now = performance.now();
      if (now - lastShakeAt > 600) {
        lastShakeAt = now;
        shakeCbs.forEach((cb) => cb());
      }
    }
  };

  window.addEventListener('devicemotion', onMotion);

  const helper: MotionHelper = {
    tilt,
    calibrate() {
      offset.x = pre.x;
      offset.y = pre.y;
    },
    onShake(cb: () => void): Unsubscribe {
      shakeCbs.add(cb);
      return () => shakeCbs.delete(cb);
    },
  };

  return {
    helper,
    destroy() {
      window.removeEventListener('devicemotion', onMotion);
      shakeCbs.clear();
    },
  };
}
