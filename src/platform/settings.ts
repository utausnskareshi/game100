export interface Settings {
  sound: boolean;
  haptics: boolean;
  theme: 'auto' | 'light' | 'dark';
  /** 「インストールせずにあそぶ」を選んだ（次回以降ランディングを飛ばす） */
  browserMode: boolean;
}

const KEY = 'game100:settings';

const defaults: Settings = {
  sound: true,
  haptics: true,
  theme: 'auto',
  browserMode: false,
};

type Listener = (s: Settings) => void;
const listeners: Listener[] = [];

function read(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...defaults };
    // インポートや手編集で型の崩れた値が入っていても既定値へ落とす
    // （例: sound が文字列だと truthy 判定で「OFFのつもりがON」になる）
    const p = JSON.parse(raw) as Partial<Record<keyof Settings, unknown>>;
    return {
      sound: typeof p.sound === 'boolean' ? p.sound : defaults.sound,
      haptics: typeof p.haptics === 'boolean' ? p.haptics : defaults.haptics,
      theme: p.theme === 'auto' || p.theme === 'light' || p.theme === 'dark' ? p.theme : defaults.theme,
      browserMode: typeof p.browserMode === 'boolean' ? p.browserMode : defaults.browserMode,
    };
  } catch {
    return { ...defaults };
  }
}

let cache: Settings = read();

export const settings = {
  get(): Settings {
    return cache;
  },
  update(patch: Partial<Settings>): Settings {
    cache = { ...cache, ...patch };
    try {
      localStorage.setItem(KEY, JSON.stringify(cache));
    } catch {
      // プライベートモード等では保存できないが動作は続ける
    }
    for (const l of listeners) l(cache);
    return cache;
  },
  onChange(cb: Listener): () => void {
    listeners.push(cb);
    return () => {
      const i = listeners.indexOf(cb);
      if (i >= 0) listeners.splice(i, 1);
    };
  },
};

/** テーマ設定を <html data-theme> に反映する */
export function applyTheme(): void {
  document.documentElement.dataset.theme = settings.get().theme;
}
