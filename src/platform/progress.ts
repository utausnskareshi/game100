// スコア・メダル・実績・XPレベル・連続日数・お気に入り・日替わり選出のロジック。
import type { AchievementDef, GameMeta, Scoring } from '../game-api/types';
import { activeGames } from '../games/index';
import { commit, gameRecord, getDoc } from './storage';
import { hashString, randomSeed, todayKey } from './rng';

export type Medal = 'bronze' | 'silver' | 'gold';

export interface UnlockedInfo {
  key: string;
  name: string;
  desc: string;
  global?: boolean;
}

export interface ResultSummary {
  score: number | null;
  best: number | null;
  isNewBest: boolean;
  medal: Medal | null;
  medalUp: boolean;
  unlocked: UnlockedInfo[];
  xpGained: number;
  levelUp: { from: number; to: number } | null;
}

const XP = {
  play: 10,
  firstPlay: 15,
  newBest: 20,
  dailyFirst: 20,
  achievement: 30,
  medal: { bronze: 10, silver: 20, gold: 40 },
} as const;

export const MEDAL_LABEL: Record<Medal, string> = {
  bronze: 'どうメダル',
  silver: 'ぎんメダル',
  gold: 'きんメダル',
};

export const MEDAL_EMOJI: Record<Medal, string> = { bronze: '🥉', silver: '🥈', gold: '🥇' };

const medalRank = (m: Medal | null): number =>
  m === 'gold' ? 3 : m === 'silver' ? 2 : m === 'bronze' ? 1 : 0;

export function medalFor(meta: GameMeta, score: number): Medal | null {
  const m = meta.medals;
  if (!m || meta.scoring === 'none') return null;
  if (meta.scoring === 'points') {
    if (score >= m.gold) return 'gold';
    if (score >= m.silver) return 'silver';
    if (score >= m.bronze) return 'bronze';
  } else {
    if (score <= m.gold) return 'gold';
    if (score <= m.silver) return 'silver';
    if (score <= m.bronze) return 'bronze';
  }
  return null;
}

export function bestMedalOf(meta: GameMeta): Medal | null {
  const best = getDoc().games[meta.id]?.best;
  return best == null ? null : medalFor(meta, best);
}

export function isBetter(scoring: Scoring, a: number, b: number): boolean {
  return scoring === 'timeMs' ? a < b : a > b;
}

export function formatScore(scoring: Scoring, score: number): string {
  if (scoring === 'timeMs') return (score / 1000).toFixed(2) + ' 秒';
  return score.toLocaleString('ja-JP') + ' 点';
}

// ---------- XPレベル（Lv2まで100XP、以降必要量が+50ずつ増える） ----------

export function levelInfo(xp: number): { level: number; into: number; need: number } {
  let level = 1;
  let need = 100;
  let rest = xp;
  // level 上限は異常データ対策（インポート由来の巨大な有限 xp でループが長時間化しないように）
  while (rest >= need && level < 9999) {
    rest -= need;
    level++;
    need += 50;
  }
  return { level, into: rest, need };
}

export function currentLevel(): number {
  return levelInfo(getDoc().profile.xp).level;
}

function addXp(n: number): { from: number; to: number } | null {
  const doc = getDoc();
  const before = levelInfo(doc.profile.xp).level;
  doc.profile.xp += n;
  const after = levelInfo(doc.profile.xp).level;
  commit();
  return after > before ? { from: before, to: after } : null;
}

// ---------- 実績 ----------

export interface GlobalAchievementDef extends AchievementDef {
  /** 自動判定条件（省略時は手動解除のみ） */
  when?: (ctx: { released: GameMeta[] }) => boolean;
}

function playedCount(released: GameMeta[]): number {
  const d = getDoc();
  return released.filter((g) => (d.games[g.id]?.plays ?? 0) > 0).length;
}

function goldCount(released: GameMeta[]): number {
  return released.filter((g) => bestMedalOf(g) === 'gold').length;
}

export const GLOBAL_ACHIEVEMENTS: GlobalAchievementDef[] = [
  { id: 'first-play', name: 'はじめの一歩', desc: 'はじめてゲームをあそんだ', when: () => getDoc().profile.totalPlays >= 1 },
  { id: 'games-5', name: 'いろいろためす', desc: '5種類のゲームをあそんだ', when: ({ released }) => playedCount(released) >= 5 },
  { id: 'games-10', name: 'あそびのたつじん', desc: '10種類のゲームをあそんだ', when: ({ released }) => playedCount(released) >= 10 },
  { id: 'plays-50', name: 'ゲームずき', desc: 'あわせて50回あそんだ', when: () => getDoc().profile.totalPlays >= 50 },
  { id: 'plays-100', name: 'ひゃくせんれんま', desc: 'あわせて100回あそんだ', when: () => getDoc().profile.totalPlays >= 100 },
  { id: 'streak-3', name: 'みっかつづき', desc: '3日連続であそんだ', when: () => getDoc().profile.streak.count >= 3 },
  { id: 'streak-7', name: 'まいにちのしゅうかん', desc: '7日連続であそんだ', when: () => getDoc().profile.streak.count >= 7 },
  { id: 'gold-5', name: 'ゴールドコレクター', desc: '金メダルを5個あつめた', when: ({ released }) => goldCount(released) >= 5 },
  { id: 'level-5', name: 'かけだしゲーマー', desc: 'プレイヤーレベル5になった', when: () => currentLevel() >= 5 },
  { id: 'level-10', name: 'いっぱしのゲーマー', desc: 'プレイヤーレベル10になった', when: () => currentLevel() >= 10 },
  {
    id: 'complete',
    name: 'ぜんぶあそんだ！',
    desc: '公開中のすべてのゲームをあそんだ',
    when: ({ released }) => released.length >= 10 && playedCount(released) === released.length,
  },
  { id: 'backup', name: 'そなえあれば', desc: 'データをバックアップした', secret: true },
];

export function isUnlocked(key: string): boolean {
  return key in getDoc().achievements;
}

export function unlockedAt(key: string): string | undefined {
  return getDoc().achievements[key];
}

/** ゲーム内実績を解除。新規解除なら情報を返す（解除済み・未定義なら null） */
export function unlockGameAchievement(meta: GameMeta, id: string): UnlockedInfo | null {
  const def = meta.achievements.find((a) => a.id === id);
  if (!def) {
    if (import.meta.env.DEV) console.warn(`[GAME100] 未定義の実績ID: ${meta.id}/${id}`);
    return null;
  }
  const key = `${meta.id}/${id}`;
  const d = getDoc();
  if (d.achievements[key]) return null;
  d.achievements[key] = new Date().toISOString();
  commit();
  return { key, name: def.name, desc: def.desc };
}

export function unlockGlobalAchievement(id: string): UnlockedInfo | null {
  const def = GLOBAL_ACHIEVEMENTS.find((a) => a.id === id);
  if (!def) return null;
  const key = `global/${id}`;
  const d = getDoc();
  if (d.achievements[key]) return null;
  d.achievements[key] = new Date().toISOString();
  commit();
  return { key, name: def.name, desc: def.desc, global: true };
}

/** プレイ結果以外の場所（設定画面など）で実績を解除したときのXP付与 */
export function grantAchievementXp(): { from: number; to: number } | null {
  const up = addXp(XP.achievement);
  // このXPでレベル到達実績（level-5等）が成立していればその場で解除する
  settleGlobalAchievements();
  return up;
}

function checkGlobalAchievements(): UnlockedInfo[] {
  const released = activeGames();
  const out: UnlockedInfo[] = [];
  for (const def of GLOBAL_ACHIEVEMENTS) {
    if (!def.when || isUnlocked(`global/${def.id}`)) continue;
    let hit = false;
    try {
      hit = def.when({ released });
    } catch {
      hit = false;
    }
    if (hit) {
      const u = unlockGlobalAchievement(def.id);
      if (u) out.push(u);
    }
  }
  return out;
}

/**
 * グローバル実績を「新規解除がなくなるまで」判定し、解除分のXPを付与する。
 * （実績XPでレベルが上がり、さらにレベル到達実績を満たす連鎖に対応。有限なので必ず収束）
 * recordResult 以外のXP付与経路（中断・設定画面）からも呼ぶことで、
 * level-5 等が「条件成立済みなのに未解除」のまま残る取りこぼしを防ぐ。
 */
function settleGlobalAchievements(): { unlocked: UnlockedInfo[]; xp: number } {
  const d = getDoc();
  const unlocked: UnlockedInfo[] = [];
  let xp = 0;
  for (;;) {
    const more = checkGlobalAchievements();
    if (more.length === 0) break;
    unlocked.push(...more);
    const bonus = XP.achievement * more.length;
    d.profile.xp += bonus;
    xp += bonus;
  }
  if (xp > 0) commit();
  return { unlocked, xp };
}

// ---------- プレイ結果の記録 ----------

export function recordResult(
  meta: GameMeta,
  opts: { score: number | null; durationMs: number; unlockedInRun: UnlockedInfo[] },
): ResultSummary {
  const d = getDoc();
  const rec = gameRecord(meta.id);
  const nowIso = new Date().toISOString();
  const firstPlay = rec.plays === 0;
  const duration = Math.max(0, Math.round(opts.durationMs));
  // ゲーム側のバグで NaN/Infinity が渡っても記録（best）を恒久的に壊さない
  const score = opts.score != null && Number.isFinite(opts.score) && meta.scoring !== 'none' ? opts.score : null;

  rec.plays++;
  rec.timeMs += duration;
  rec.lastPlayed = nowIso;
  if (!rec.firstPlayed) rec.firstPlayed = nowIso;
  d.profile.totalPlays++;
  d.profile.totalTimeMs += duration;

  let xp = XP.play;
  if (firstPlay) xp += XP.firstPlay;

  // 連続プレイ日数（その日はじめてのプレイで更新）
  const today = todayKey();
  const streak = d.profile.streak;
  if (streak.lastDay !== today) {
    // 「昨日」は now-86400000 ではなくカレンダー計算で求める（夏時間の23/25時間日でずれるため）
    const now = new Date();
    const yesterday = todayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
    streak.count = streak.lastDay === yesterday ? streak.count + 1 : 1;
    streak.lastDay = today;
    xp += XP.dailyFirst;
  }

  let isNewBest = false;
  let medal: Medal | null = null;
  let medalUp = false;

  if (score != null) {
    const prevBest = rec.best;
    const prevMedal = prevBest == null ? null : medalFor(meta, prevBest);
    rec.history.unshift({ score, at: nowIso });
    if (rec.history.length > 10) rec.history.length = 10;
    if (prevBest == null || isBetter(meta.scoring, score, prevBest)) {
      rec.best = score;
      isNewBest = true;
      if (prevBest != null) xp += XP.newBest;
    }
    medal = medalFor(meta, score);
    if (medal && medalRank(medal) > medalRank(prevMedal)) {
      medalUp = true;
      xp += XP.medal[medal];
    }
  }

  touchRecent(meta.id);

  // XPを先に付与してからグローバル実績を判定する（レベル到達系の解除が1プレイ遅れないように）
  const levelBefore = levelInfo(d.profile.xp).level;
  xp += XP.achievement * opts.unlockedInRun.length;
  d.profile.xp += xp;
  const unlocked: UnlockedInfo[] = [...opts.unlockedInRun];
  const settled = settleGlobalAchievements();
  unlocked.push(...settled.unlocked);
  xp += settled.xp;
  const levelAfter = levelInfo(d.profile.xp).level;
  commit();

  return {
    score,
    best: rec.best,
    isNewBest,
    medal,
    medalUp,
    unlocked,
    xpGained: xp,
    levelUp: levelAfter > levelBefore ? { from: levelBefore, to: levelAfter } : null,
  };
}

/**
 * 中断（結果なし終了）。遊んだ時間を加算する。
 * プレイ中に解除した実績があればそのXPも付与する（リザルトまで進まないと消えてしまうため）。
 */
export function recordQuit(meta: GameMeta, durationMs: number, unlockedInRun: UnlockedInfo[] = []): void {
  const duration = Math.max(0, Math.round(durationMs));
  gameRecord(meta.id).timeMs += duration;
  getDoc().profile.totalTimeMs += duration;
  if (unlockedInRun.length > 0) addXp(XP.achievement * unlockedInRun.length);
  // 中断でも level-5 等のXP到達実績を取りこぼさない（結果画面がないため無通知解除になる）
  settleGlobalAchievements();
  touchRecent(meta.id);
  commit();
}

/**
 * 表示用の連続日数。streak.count は保存上「最後に連続していたときの値」のままなので、
 * 最後のプレイが今日でも昨日でもなければ途切れている＝0 を返す。
 */
export function currentStreak(): number {
  const s = getDoc().profile.streak;
  const now = new Date();
  const yesterday = todayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  return s.lastDay === todayKey() || s.lastDay === yesterday ? s.count : 0;
}

// ---------- お気に入り・最近あそんだ ----------

export function isFavorite(id: string): boolean {
  return getDoc().favorites.includes(id);
}

export function toggleFavorite(id: string): boolean {
  const d = getDoc();
  const i = d.favorites.indexOf(id);
  if (i >= 0) d.favorites.splice(i, 1);
  else d.favorites.push(id);
  commit();
  return i < 0;
}

function touchRecent(id: string): void {
  const d = getDoc();
  d.recent = [id, ...d.recent.filter((x) => x !== id)].slice(0, 10);
}

export function recentGames(): GameMeta[] {
  const map = new Map(activeGames().map((g) => [g.id, g] as const));
  return getDoc().recent
    .map((id) => map.get(id))
    .filter((g): g is GameMeta => g != null);
}

// ---------- 日替わり ----------

/** 今日のゲーム（日付から決定論的に選出。オフラインでも同じ結果） */
export function dailyGame(): GameMeta | null {
  const list = activeGames();
  if (list.length === 0) return null;
  const h = hashString('daily:' + todayKey());
  return list[h % list.length] ?? null;
}

/** ctx.random 用のシード。「今日のゲーム」は日替わり共通シード（全員同じ配置で遊べる） */
export function seedFor(meta: GameMeta): number {
  const daily = dailyGame();
  if (daily && daily.id === meta.id) return hashString(todayKey() + ':' + meta.id);
  return randomSeed();
}
