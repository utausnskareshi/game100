// =============================================================
// 保存データ（スコア・実績・統計・お気に入り）の管理。
// 全体をひとつのドキュメント(AppDoc)として IndexedDB に保存する。
//  - 起動時に一度読み込み、以後はメモリ上で同期的に読み書き
//  - 変更は commit() でデバウンス保存（画面が隠れるときは即時フラッシュ）
//  - IndexedDB が使えない環境では localStorage へフォールバック
//  - スキーマには版数(v)を持たせ、将来の変更は migrate() で吸収する
// =============================================================

export interface ScoreEntry {
  score: number;
  at: string; // ISO日時
}

export interface GameRecord {
  plays: number;
  timeMs: number;
  best: number | null;
  history: ScoreEntry[];
  firstPlayed?: string;
  lastPlayed?: string;
  /** ctx.save() で書かれるゲーム独自データ */
  saves: Record<string, unknown>;
}

export interface AppDoc {
  v: 1;
  /** 最終保存日時（ISO）。IndexedDB と localStorage のどちらが新しいかの判定に使う */
  savedAt?: string;
  profile: {
    xp: number;
    createdAt: string;
    streak: { count: number; lastDay: string };
    totalPlays: number;
    totalTimeMs: number;
    exportedAt?: string;
  };
  games: Record<string, GameRecord>;
  /** 実績キー（`${gameId}/${achId}` または `global/${id}`）→ 解除日時 */
  achievements: Record<string, string>;
  favorites: string[];
  recent: string[];
}

const DB_NAME = 'game100';
const DB_VERSION = 1;
const STORE = 'doc';
const DOC_KEY = 'app';
const LS_KEY = 'game100:doc';

function emptyDoc(): AppDoc {
  return {
    v: 1,
    profile: {
      xp: 0,
      createdAt: new Date().toISOString(),
      streak: { count: 0, lastDay: '' },
      totalPlays: 0,
      totalTimeMs: 0,
    },
    games: {},
    achievements: {},
    favorites: [],
    recent: [],
  };
}

let doc: AppDoc = emptyDoc();
let db: IDBDatabase | null = null;
let dirty = false;
let timer: number | null = null;

function openDb(timeoutMs = 3000): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    // 一部の iOS Safari には open がどのイベントも発火せずハングする既知の不具合がある。
    // initStorage は起動全体を await でブロックするため、時間切れを設けて
    // 既存の catch 経路（db=null・localStorage フォールバック）へ落とす（白画面固まり防止）。
    let settled = false;
    const timer = window.setTimeout(() => {
      settled = true;
      reject(new Error('indexedDB open timeout'));
    }, timeoutMs);
    const done = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      fn();
    };
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => {
      if (settled) {
        // 時間切れ後に遅れて開いた接続は使わないので閉じる
        try {
          req.result.close();
        } catch {
          /* ignore */
        }
        return;
      }
      done(() => resolve(req.result));
    };
    req.onerror = () => done(() => reject(req.error ?? new Error('indexedDB open failed')));
    req.onblocked = () => done(() => reject(new Error('indexedDB blocked')));
  });
}

function idbGet(): Promise<AppDoc | null> {
  return new Promise((resolve, reject) => {
    if (!db) return resolve(null);
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(DOC_KEY);
    req.onsuccess = () => resolve((req.result as AppDoc | undefined) ?? null);
    req.onerror = () => reject(req.error ?? new Error('idb get failed'));
  });
}

function idbPut(value: AppDoc): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!db) return reject(new Error('no db'));
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(structuredClone(value), DOC_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('idb put failed'));
    // 容量超過時などは error を経ずに abort だけが起きることがある。
    // 処理しないと Promise が永遠に未解決になり、保存失敗が握りつぶされる。
    tx.onabort = () => reject(tx.error ?? new Error('idb tx aborted'));
  });
}

function readLs(): AppDoc | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? (JSON.parse(raw) as AppDoc) : null;
  } catch {
    return null;
  }
}

function writeLs(): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(doc));
  } catch {
    // 保存先がない環境ではメモリのみで動作
  }
}

/** 有限数なら値を、そうでなければ既定値を返す（不正データで NaN/Infinity が混入するのを防ぐ） */
function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function str(v: unknown, fallback: string): string {
  return typeof v === 'string' ? v : fallback;
}

/**
 * 将来スキーマを変えるときは、ここに v1→v2 などの変換を追加していく。
 * インポートは任意のJSONを受け付けるため、型と数値の健全性もここで検証する
 * （例: xp が Infinity だと levelInfo() が無限ループして起動不能になる）。
 */
function migrate(raw: unknown): AppDoc {
  const base = emptyDoc();
  if (!raw || typeof raw !== 'object' || (raw as { v?: number }).v !== 1) return base;
  const d = raw as Partial<AppDoc>;
  const p = (d.profile && typeof d.profile === 'object' ? d.profile : {}) as Partial<AppDoc['profile']>;
  const merged: AppDoc = {
    v: 1,
    profile: {
      xp: Math.max(0, num(p.xp, 0)),
      createdAt: str(p.createdAt, base.profile.createdAt),
      streak: {
        count: Math.max(0, num(p.streak?.count, 0)),
        lastDay: str(p.streak?.lastDay, ''),
      },
      totalPlays: Math.max(0, num(p.totalPlays, 0)),
      totalTimeMs: Math.max(0, num(p.totalTimeMs, 0)),
    },
    games: {},
    achievements: {},
    favorites: Array.isArray(d.favorites) ? d.favorites.filter((x): x is string => typeof x === 'string') : [],
    recent: Array.isArray(d.recent) ? d.recent.filter((x): x is string => typeof x === 'string') : [],
  };
  if (typeof d.savedAt === 'string') merged.savedAt = d.savedAt;
  if (typeof p.exportedAt === 'string') merged.profile.exportedAt = p.exportedAt;
  if (d.games && typeof d.games === 'object') {
    for (const [id, r] of Object.entries(d.games as Record<string, Partial<GameRecord> | null>)) {
      if (!r || typeof r !== 'object') continue;
      const rec: GameRecord = {
        plays: Math.max(0, num(r.plays, 0)),
        timeMs: Math.max(0, num(r.timeMs, 0)),
        best: typeof r.best === 'number' && Number.isFinite(r.best) ? r.best : null,
        history: Array.isArray(r.history)
          ? r.history
              .filter(
                (h): h is ScoreEntry =>
                  !!h && typeof h === 'object' && Number.isFinite((h as ScoreEntry).score) && typeof (h as ScoreEntry).at === 'string',
              )
              .slice(0, 10)
          : [],
        saves: r.saves && typeof r.saves === 'object' && !Array.isArray(r.saves) ? (r.saves as Record<string, unknown>) : {},
      };
      if (typeof r.firstPlayed === 'string') rec.firstPlayed = r.firstPlayed;
      if (typeof r.lastPlayed === 'string') rec.lastPlayed = r.lastPlayed;
      merged.games[id] = rec;
    }
  }
  if (d.achievements && typeof d.achievements === 'object') {
    for (const [k, v] of Object.entries(d.achievements as Record<string, unknown>)) {
      if (typeof v === 'string') merged.achievements[k] = v;
    }
  }
  return merged;
}

/** savedAt が新しい方を返す（savedAt なしは最古扱い） */
function newerDoc(a: AppDoc | null, b: AppDoc | null): AppDoc | null {
  if (!a) return b;
  if (!b) return a;
  const ta = Date.parse(a.savedAt ?? '') || 0;
  const tb = Date.parse(b.savedAt ?? '') || 0;
  return tb > ta ? b : a;
}

export async function initStorage(): Promise<void> {
  const ls = readLs();
  try {
    db = await openDb();
    const stored = await idbGet();
    // 両方にデータがある場合は savedAt が新しい方を採用する。
    // （過去セッションで IndexedDB が開けず localStorage 側にだけ保存されていた場合の巻き戻り防止）
    const pick = newerDoc(stored, ls);
    if (pick) doc = migrate(pick);
    if (pick !== stored) await idbPut(doc); // LS採用時・初回は IndexedDB へ同期
  } catch {
    db = null;
    if (ls) doc = migrate(ls);
  }

  // ブラウザにデータの永続化を依頼（対応環境のみ。失敗しても無視）
  try {
    void navigator.storage?.persist?.();
  } catch {
    /* ignore */
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
  window.addEventListener('pagehide', flush);
}

export function getDoc(): AppDoc {
  return doc;
}

/** 変更をスケジュール保存する（300msデバウンス） */
export function commit(): void {
  dirty = true;
  if (timer != null) return;
  timer = window.setTimeout(() => {
    timer = null;
    flush();
  }, 300);
}

export function flush(): void {
  if (!dirty) return;
  dirty = false;
  doc.savedAt = new Date().toISOString();
  // localStorage には常に同期で書く。pagehide 時は IndexedDB の非同期書き込みが
  // 完了する保証がないため、同期書き込みが「最後の変更を必ず残す」保険になる。
  writeLs();
  if (db) {
    void idbPut(doc).catch(() => undefined);
  }
}

export function gameRecord(id: string): GameRecord {
  let r = doc.games[id];
  if (!r) {
    r = { plays: 0, timeMs: 0, best: null, history: [], saves: {} };
    doc.games[id] = r;
  }
  return r;
}

/** 全データを初期状態に戻す（設定は残す） */
export function resetAll(): void {
  doc = emptyDoc();
  dirty = true;
  flush();
}

// ---------- バックアップ（エクスポート / インポート） ----------

export function exportJson(): string {
  doc.profile.exportedAt = new Date().toISOString();
  commit();
  let settingsRaw: unknown = null;
  try {
    const raw = localStorage.getItem('game100:settings');
    settingsRaw = raw ? JSON.parse(raw) : null;
  } catch {
    /* ignore */
  }
  return JSON.stringify(
    {
      app: 'game100',
      version: __APP_VERSION__,
      exportedAt: doc.profile.exportedAt,
      doc,
      settings: settingsRaw,
    },
    null,
    2,
  );
}

export function importJson(text: string): { ok: true } | { ok: false; error: string } {
  try {
    const data = JSON.parse(text) as {
      app?: string;
      doc?: unknown;
      settings?: unknown;
    };
    if (data.app !== 'game100' || !data.doc || typeof data.doc !== 'object') {
      return { ok: false, error: 'GAME100のバックアップデータではありません' };
    }
    // 未知の版数を migrate() に渡すと空ドキュメントに置き換わり全記録が消えるため、先に弾く
    if ((data.doc as { v?: unknown }).v !== 1) {
      return {
        ok: false,
        error: 'このバックアップは新しいバージョンのアプリで作られたようです。アプリを更新してからもう一度お試しください',
      };
    }
    doc = migrate(data.doc);
    if (data.settings && typeof data.settings === 'object') {
      try {
        localStorage.setItem('game100:settings', JSON.stringify(data.settings));
      } catch {
        /* ignore */
      }
    }
    dirty = true;
    flush();
    return { ok: true };
  } catch {
    return { ok: false, error: 'データを読み取れませんでした（形式が不正です）' };
  }
}
