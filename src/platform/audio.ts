// 効果音（WebAudioでシンセ生成・音声ファイルなし）。
// iOS/Androidとも、音を出すには最初にユーザー操作の中で unlockAudio() を呼ぶ必要がある。
import type { SfxName } from '../game-api/types';
import { settings } from './settings';

let ac: AudioContext | null = null;
let master: GainNode | null = null;
let unlocked = false;

/** 無音の極小WAVを生成（iOSのサイレントスイッチ対策で <audio> を一度鳴らすため） */
function silentWavUri(): string {
  const n = 8;
  const bytes = new Uint8Array(44 + n);
  const dv = new DataView(bytes.buffer);
  const w = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) bytes[o + i] = s.charCodeAt(i);
  };
  w(0, 'RIFF');
  dv.setUint32(4, 36 + n, true);
  w(8, 'WAVE');
  w(12, 'fmt ');
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);
  dv.setUint16(22, 1, true);
  dv.setUint32(24, 8000, true);
  dv.setUint32(28, 8000, true);
  dv.setUint16(32, 1, true);
  dv.setUint16(34, 8, true);
  w(36, 'data');
  dv.setUint32(40, n, true);
  bytes.fill(0x80, 44);
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return 'data:audio/wav;base64,' + btoa(bin);
}

/**
 * running でなければ復帰を試みる。
 * iOSは通話・Siri・バックグラウンド移行で 'interrupted'（非標準の状態）になることがあり、
 * 'suspended' との比較だけでは取りこぼすため「running 以外なら resume」とする。
 */
function resumeIfNeeded(): void {
  if (ac && (ac.state as string) !== 'running') {
    void ac.resume().catch(() => undefined);
  }
}

// バックグラウンド復帰時に interrupted/suspended から自動復帰する
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') resumeIfNeeded();
});

/** 必ずユーザー操作（タップ）のハンドラ内で呼ぶこと */
export function unlockAudio(): void {
  try {
    if (!ac) {
      ac = new AudioContext();
      master = ac.createGain();
      master.gain.value = 0.5;
      master.connect(ac.destination);
    }
    resumeIfNeeded();
    if (!unlocked) {
      unlocked = true;
      const el = document.createElement('audio');
      el.setAttribute('playsinline', '');
      el.src = silentWavUri();
      el.volume = 0.01;
      void el.play().catch(() => {});
      const buf = ac.createBuffer(1, 1, 22050);
      const src = ac.createBufferSource();
      src.buffer = buf;
      src.connect(ac.destination);
      src.start(0);
    }
  } catch {
    // 音が出なくてもゲームは続行する
  }
}

interface ToneOpts {
  t?: number;
  dur?: number;
  type?: OscillatorType;
  vol?: number;
  slide?: number;
}

function tone(freq: number, opts: ToneOpts = {}): void {
  if (!ac || !master || !settings.get().sound) return;
  try {
    const dur = opts.dur ?? 0.1;
    const t0 = ac.currentTime + (opts.t ?? 0);
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = opts.type ?? 'square';
    o.frequency.setValueAtTime(freq, t0);
    if (opts.slide) o.frequency.exponentialRampToValueAtTime(opts.slide, t0 + dur);
    const v = opts.vol ?? 0.22;
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(v, t0 + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g);
    g.connect(master);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  } catch {
    /* ignore */
  }
}

/**
 * ゲーム用: 指定周波数(Hz)の音を鳴らす（ピアノ等の任意の音程演出）。
 * 内部の tone() を使うのでミュート設定(settings.sound)を自動で尊重する。
 * 音を出すには事前に unlockAudio()（シェルが「あそぶ」で実行）が必要。
 */
export function playTone(freq: number, durationMs = 400): void {
  resumeIfNeeded();
  tone(freq, { dur: Math.max(0.03, durationMs / 1000), type: 'triangle', vol: 0.26 });
}

export function playSfx(name: SfxName): void {
  resumeIfNeeded();
  switch (name) {
    case 'tap':
      tone(600, { dur: 0.05, vol: 0.15 });
      break;
    case 'tick':
      tone(1000, { dur: 0.03, vol: 0.12 });
      break;
    case 'success':
      tone(523.25, { dur: 0.09 });
      tone(659.25, { t: 0.09, dur: 0.09 });
      tone(783.99, { t: 0.18, dur: 0.16 });
      break;
    case 'fail':
      tone(220, { dur: 0.2, type: 'sawtooth', slide: 110, vol: 0.2 });
      break;
    case 'combo':
      tone(880, { dur: 0.05 });
      tone(1108.7, { t: 0.05, dur: 0.05 });
      break;
    case 'start':
      tone(440, { dur: 0.08 });
      tone(554.37, { t: 0.1, dur: 0.08 });
      tone(659.25, { t: 0.2, dur: 0.12 });
      break;
    case 'medal':
      tone(587.33, { dur: 0.1 });
      tone(739.99, { t: 0.1, dur: 0.1 });
      tone(880, { t: 0.2, dur: 0.1 });
      tone(1174.66, { t: 0.3, dur: 0.25, type: 'triangle' });
      break;
    case 'powerup':
      tone(300, { dur: 0.15, slide: 900, type: 'triangle' });
      break;
  }
}
