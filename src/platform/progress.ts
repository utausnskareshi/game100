// スコア・メダル・実績・XPレベル・連続日数・お気に入り・日替わり選出のロジック。
import type { AchievementDef, GameMeta, Scoring } from '../game-api/types';
import { activeGames, bonusGames, bonusUnlocked, mainGames } from '../games/index';
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
  /** このプレイで「かくれゲーム」が解放されたか（結果画面のお祝い表示用） */
  bonusUnlocked?: boolean;
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

/** 次のメダルまでの残り。すでに金／メダル未設定／まだ記録が無いなら null */
export interface MedalGap {
  next: Medal;
  /** 次のメダルの目標スコア */
  target: number;
  /** あとどれだけ必要か（points なら点差・timeMs ならミリ秒差。どちらも正の数） */
  gap: number;
  /** 次のメダルへの近さ 0〜1（1に近いほど「あと少し」）。ゲーム間の比較に使う */
  ratio: number;
}

export function nextMedalGap(meta: GameMeta): MedalGap | null {
  const m = meta.medals;
  if (!m || meta.scoring === 'none') return null;
  const best = getDoc().games[meta.id]?.best;
  if (best == null || !Number.isFinite(best)) return null;
  const cur = medalFor(meta, best);
  const next: Medal | null = cur === 'gold' ? null : cur === 'silver' ? 'gold' : cur === 'bronze' ? 'silver' : 'bronze';
  if (!next) return null;
  const target = m[next];
  if (meta.scoring === 'timeMs') {
    // タイム型は「短いほど良い」ので best > target。近さは target/best
    const gap = Math.max(0, best - target);
    const ratio = best > 0 ? Math.min(1, target / best) : 1;
    return { next, target, gap, ratio };
  }
  const gap = Math.max(0, target - best);
  const ratio = target > 0 ? Math.min(1, best / target) : 1;
  return { next, target, gap, ratio };
}

/**
 * 「次のメダルまで あと◯」の文言。表示場所が3つ（詳細シート・ホームのカード・結果画面）
 * あるので、ここに集約して同じ言い方にする。
 * タイム型は「あと 1.20秒」だけだと“もっと時間をかける”と読めてしまうため「はやく」を付ける。
 */
export function medalGapText(meta: GameMeta, gap: MedalGap, opts?: { compact?: boolean }): string {
  const amount = opts?.compact
    ? formatScore(meta.scoring, gap.gap).replace(/\s+/g, '') // 幅の狭いカード用に数字と単位をつめる
    : formatScore(meta.scoring, gap.gap);
  const head = opts?.compact ? `${MEDAL_EMOJI[gap.next]} あと` : `${MEDAL_EMOJI[gap.next]}まで あと`;
  return meta.scoring === 'timeMs' ? `${head} ${amount} はやく` : `${head} ${amount}`;
}

/** 公開中のゲームのメダル内訳（スタンプ台紙の集計用） */
export function medalCounts(released: GameMeta[]): { bronze: number; silver: number; gold: number } {
  const out = { bronze: 0, silver: 0, gold: 0 };
  for (const g of released) {
    const m = bestMedalOf(g);
    if (m) out[m]++;
  }
  return out;
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

/** あそんだことのあるカテゴリの数（オールラウンダー実績用） */
function categoriesPlayed(released: GameMeta[]): number {
  const d = getDoc();
  const set = new Set<string>();
  for (const g of released) {
    if ((d.games[g.id]?.plays ?? 0) > 0) set.add(g.category);
  }
  return set.size;
}

/** かくれゲームのうち、あそんだ数／金メダルの数 */
function bonusProgress(): { total: number; played: number; gold: number } {
  const d = getDoc();
  const list = bonusGames();
  let played = 0;
  let gold = 0;
  for (const g of list) {
    if ((d.games[g.id]?.plays ?? 0) > 0) played++;
    if (bestMedalOf(g) === 'gold') gold++;
  }
  return { total: list.length, played, gold };
}

/**
 * かくれゲームの解放を確定する（本編を全部あそんだ瞬間に1回だけ true を返す）。
 * 解放日時を保存しておくことで、あとから本編が増えても解放が取り消されない。
 */
function settleBonusUnlock(): boolean {
  const d = getDoc();
  if (d.profile.bonusUnlockedAt) return false;
  if (!bonusUnlocked()) return false;
  d.profile.bonusUnlockedAt = new Date().toISOString();
  return true;
}

/** きょう遊んだゲームの種類数（1日にたくさん遊んだ実績用） */
function playedTodayCount(released: GameMeta[]): number {
  const d = getDoc();
  const today = todayKey();
  let n = 0;
  for (const g of released) {
    const last = d.games[g.id]?.lastPlayed;
    if (!last) continue;
    const t = new Date(last);
    if (!Number.isNaN(t.getTime()) && todayKey(t) === today) n++;
  }
  return n;
}

export const GLOBAL_ACHIEVEMENTS: GlobalAchievementDef[] = [
  { id: 'first-play', name: 'はじめの一歩', desc: 'はじめてゲームをあそんだ', when: () => getDoc().profile.totalPlays >= 1 },
  { id: 'games-5', name: 'いろいろためす', desc: '5種類のゲームをあそんだ', when: ({ released }) => playedCount(released) >= 5 },
  { id: 'games-10', name: 'あそびのたつじん', desc: '10種類のゲームをあそんだ', when: ({ released }) => playedCount(released) >= 10 },
  { id: 'games-30', name: 'あそびのけんきゅうか', desc: '30種類のゲームをあそんだ', when: ({ released }) => playedCount(released) >= 30 },
  { id: 'games-50', name: 'はんぶん せいは', desc: '50種類のゲームをあそんだ', when: ({ released }) => playedCount(released) >= 50 },
  { id: 'games-80', name: 'ゴールが見えた', desc: '80種類のゲームをあそんだ', when: ({ released }) => playedCount(released) >= 80 },
  {
    id: 'all-category',
    name: 'オールラウンダー',
    desc: '7つのカテゴリぜんぶであそんだ',
    when: ({ released }) => categoriesPlayed(released) >= 7,
  },
  {
    id: 'five-a-day',
    name: 'きょうは よくあそぶ日',
    desc: '1日に5種類のゲームをあそんだ',
    when: ({ released }) => playedTodayCount(released) >= 5,
  },
  { id: 'plays-50', name: 'ゲームずき', desc: 'あわせて50回あそんだ', when: () => getDoc().profile.totalPlays >= 50 },
  { id: 'plays-100', name: 'ひゃくせんれんま', desc: 'あわせて100回あそんだ', when: () => getDoc().profile.totalPlays >= 100 },
  { id: 'plays-300', name: 'ゲームのぬし', desc: 'あわせて300回あそんだ', when: () => getDoc().profile.totalPlays >= 300 },
  { id: 'streak-3', name: 'みっかつづき', desc: '3日連続であそんだ', when: () => getDoc().profile.streak.count >= 3 },
  { id: 'streak-7', name: 'まいにちのしゅうかん', desc: '7日連続であそんだ', when: () => getDoc().profile.streak.count >= 7 },
  { id: 'gold-5', name: 'ゴールドコレクター', desc: '金メダルを5個あつめた', when: ({ released }) => goldCount(released) >= 5 },
  { id: 'gold-15', name: 'メダルハンター', desc: '金メダルを15個あつめた', when: ({ released }) => goldCount(released) >= 15 },
  { id: 'gold-30', name: 'ゴールドラッシュ', desc: '金メダルを30個あつめた', when: ({ released }) => goldCount(released) >= 30 },
  { id: 'gold-50', name: 'きんいろのたつじん', desc: '金メダルを50個あつめた', when: ({ released }) => goldCount(released) >= 50 },
  { id: 'level-5', name: 'かけだしゲーマー', desc: 'プレイヤーレベル5になった', when: () => currentLevel() >= 5 },
  { id: 'level-10', name: 'いっぱしのゲーマー', desc: 'プレイヤーレベル10になった', when: () => currentLevel() >= 10 },
  {
    id: 'complete',
    name: 'ぜんぶあそんだ！',
    desc: '本編のゲームをぜんぶあそんだ',
    // かくれゲームが解放されると activeGames() が増えるので、ここは必ず本編だけで判定する
    // （そうしないと100本目を遊んだ瞬間に条件が130本へ動いて永久に取れなくなる）
    when: () => {
      const main = mainGames();
      return main.length >= 10 && playedCount(main) === main.length;
    },
  },
  {
    id: 'bonus-open',
    name: 'かくれゲーム はっけん',
    desc: 'かくされていたゲームを見つけた',
    when: () => bonusUnlocked(),
    secret: true,
  },
  {
    id: 'bonus-all',
    name: 'かくれゲーム せいは',
    desc: 'かくれゲームをぜんぶあそんだ',
    when: () => {
      const b = bonusProgress();
      return b.total > 0 && b.played === b.total;
    },
    secret: true,
  },
  {
    id: 'bonus-gold',
    name: 'かくれゲーム マスター',
    desc: 'かくれゲームをぜんぶ金メダルにした',
    when: () => {
      const b = bonusProgress();
      return b.total > 0 && b.gold === b.total;
    },
    secret: true,
  },
  { id: 'backup', name: 'そなえあれば', desc: 'データをバックアップした', secret: true },
];

// ---------- 称号（あそんだ種類数と金メダル数から決まる呼び名） ----------
// 上にある称号ほど下位。条件を満たしている中でいちばん下（＝上位）のものが現在の称号になる。
// 名前は保存しない（そのつど計算する）ので、あとから増やしても既存データに影響しない。

interface TitleStat {
  played: number;
  gold: number;
  bonusPlayed: number;
  bonusTotal: number;
}

const TITLES: { name: string; hint: string; when: (s: TitleStat) => boolean }[] = [
  { name: 'ゲーム いちねんせい', hint: '', when: () => true },
  { name: 'あそびの たまご', hint: '5種類あそぶ', when: (s) => s.played >= 5 },
  { name: 'あそびずき', hint: '15種類あそぶ', when: (s) => s.played >= 15 },
  { name: 'メダルあつめ', hint: '金メダル5個', when: (s) => s.gold >= 5 },
  { name: 'ゲームはかせ', hint: '30種類あそぶ', when: (s) => s.played >= 30 },
  { name: 'メダルハンター', hint: '金メダル15個', when: (s) => s.gold >= 15 },
  { name: 'たびの たつじん', hint: '50種類あそぶ', when: (s) => s.played >= 50 },
  { name: 'ゴールドマスター', hint: '金メダル30個', when: (s) => s.gold >= 30 },
  { name: 'ぜんぶの ちょうてん', hint: '100種類あそんで金メダル50個', when: (s) => s.played >= 100 && s.gold >= 50 },
  {
    name: 'かくれゲームの ぬし',
    hint: 'かくれゲームをぜんぶあそぶ',
    when: (s) => s.bonusTotal > 0 && s.bonusPlayed === s.bonusTotal,
  },
];

export interface TitleInfo {
  name: string;
  /** つぎの称号（もう最上位なら null） */
  next: { name: string; hint: string } | null;
}

export function currentTitle(): TitleInfo {
  const released = activeGames();
  const bp = bonusProgress();
  const stat: TitleStat = {
    played: playedCount(released),
    gold: goldCount(released),
    bonusPlayed: bp.played,
    bonusTotal: bp.total,
  };
  let idx = 0;
  for (let i = 0; i < TITLES.length; i++) {
    if (TITLES[i]!.when(stat)) idx = i;
  }
  let next: TitleInfo['next'] = null;
  for (let i = idx + 1; i < TITLES.length; i++) {
    if (!TITLES[i]!.when(stat)) {
      next = { name: TITLES[i]!.name, hint: TITLES[i]!.hint };
      break;
    }
  }
  return { name: TITLES[idx]!.name, next };
}

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

  // かくれゲームの解放。firstPlay との and で「このプレイで100本目がそろった」ときだけ
  // お祝いを出す（すべて遊び済みのバックアップを読み込んだ直後に出さないため）。
  // settleBonusUnlock() は解放フラグの保存も兼ねるので、必ず先に評価する。
  const bonusJustUnlocked = settleBonusUnlock() && firstPlay;

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
    bonusUnlocked: bonusJustUnlocked,
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
