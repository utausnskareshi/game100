// =============================================================
// のんびりさかなつり（No.17）のロジック（DOM非依存・乱数注入）
// =============================================================
// - つりば（かわ/いけ/うみ）ごとの魚テーブルと重み付き抽選、アタリまでの待ち時間・
//   アタリ窓の長さ・フェイント（にせアタリ）の計画を注入 rng から決める
//   （「今日のゲーム」では全員同じ引き）。
// - 図鑑（ずかん）は全つりば横断で一意な id を集める（ゲーム側が ctx.save で永続化）。
// - import してよいのは game-api（types/helpers）と同一フォルダのみ（このファイルは依存なし）。

export type SpotKey = 'river' | 'pond' | 'sea';

export interface Fish {
  /** 図鑑キー（つりば跨ぎで一意） */
  id: string;
  name: string;
  emoji: string;
  /** 得点（仮・playtest調整前提） */
  points: number;
  /** 出現の重み（相対値。合計は任意） */
  weight: number;
  /** おおもの（「おおものGET」判定） */
  big?: boolean;
  /** レア（ヌシ・特別。「レアなさかな」判定） */
  rare?: boolean;
}

export interface Spot {
  key: SpotKey;
  label: string;
  fish: Fish[];
}

// アタリまでの待ち時間・アタリ窓（ms）。待ちは広め（リズム押し対策）・窓は短め。
export const BITE_DELAY_MIN = 900;
export const BITE_DELAY_MAX = 3200;
export const BITE_WINDOW_MIN = 500;
export const BITE_WINDOW_MAX = 800;
// 大物・レアほどアタリ窓が短い（高得点の魚ほど反射勝負になる）
export const WINDOW_FACTOR_BIG = 0.8;
export const WINDOW_FACTOR_RARE = 0.7;
// フェイント（にせアタリ）: ウキが「浅く」沈むが「！」は出ない。ひっかかると すっぽ抜け
export const FEINT_MS = 550; // 1回のフェイントで沈んでいる時間
export const FEINT_START_MIN = 350; // キャスト直後はフェイントしない
export const FEINT_GAP_MS = 350; // フェイント同士の最小間隔
export const FEINT_END_GAP = 450; // 本アタリのこの時間前までにフェイントを終える

export const SPOTS: Record<SpotKey, Spot> = {
  river: {
    key: 'river',
    label: 'かわ',
    fish: [
      { id: 'kozakana', name: 'こざかな', emoji: '🐟', points: 10, weight: 42 },
      { id: 'funa', name: 'フナ', emoji: '🐟', points: 20, weight: 28 },
      { id: 'ayu', name: 'アユ', emoji: '🐟', points: 35, weight: 20 },
      { id: 'namazu', name: 'ナマズ', emoji: '🐡', points: 90, weight: 9, big: true },
      { id: 'nushi-river', name: 'かわのぬし', emoji: '🐲', points: 400, weight: 1, big: true, rare: true },
    ],
  },
  pond: {
    key: 'pond',
    label: 'いけ',
    fish: [
      { id: 'medaka', name: 'メダカ', emoji: '🐟', points: 10, weight: 42 },
      { id: 'kingyo', name: 'キンギョ', emoji: '🐠', points: 30, weight: 27 },
      { id: 'koi', name: 'ニシキゴイ', emoji: '🎏', points: 65, weight: 20, big: true },
      { id: 'suppon', name: 'スッポン', emoji: '🐢', points: 110, weight: 9, big: true },
      { id: 'nushi-pond', name: 'いけのぬし', emoji: '🐉', points: 500, weight: 2, big: true, rare: true },
    ],
  },
  sea: {
    key: 'sea',
    label: 'うみ',
    fish: [
      { id: 'iwashi', name: 'イワシ', emoji: '🐟', points: 10, weight: 40 },
      { id: 'tai', name: 'タイ', emoji: '🐠', points: 50, weight: 27 },
      { id: 'tako', name: 'タコ', emoji: '🐙', points: 70, weight: 18 },
      { id: 'maguro', name: 'マグロ', emoji: '🐟', points: 130, weight: 12, big: true },
      { id: 'same', name: 'サメ', emoji: '🦈', points: 220, weight: 2.5, big: true, rare: true },
      { id: 'takarabako', name: 'たからばこ', emoji: '🎁', points: 300, weight: 0.5, rare: true },
    ],
  },
};

/** 図鑑にのる全魚 id（つりば順・重複なし） */
export const ALL_FISH_IDS: string[] = (Object.keys(SPOTS) as SpotKey[]).flatMap((k) => SPOTS[k].fish.map((f) => f.id));

/** min〜max の実数（rng 由来） */
function rrange(rng: () => number, min: number, max: number): number {
  return min + rng() * (max - min);
}

/** つりばの魚を重み付きで1匹えらぶ（rng 注入＝今日のゲームは全員同じ） */
export function pickFish(rng: () => number, spotKey: SpotKey): Fish {
  const list = SPOTS[spotKey].fish;
  const total = list.reduce((s, f) => s + f.weight, 0);
  let r = rng() * total;
  for (const f of list) {
    r -= f.weight;
    if (r <= 0) return f;
  }
  return list[0]!; // 到達しない（重み合計 > 0 のため）保険
}

/** アタリまでの待ち時間(ms) */
export function biteDelay(rng: () => number): number {
  return rrange(rng, BITE_DELAY_MIN, BITE_DELAY_MAX);
}

/**
 * アタリ窓の長さ(ms)。大物(big)は×0.8・レア(rare)は×0.7＝高得点の魚ほど一瞬で判断が要る
 * （big かつ rare の魚は rare 扱い。係数は掛け合わせない）。
 */
export function biteWindowFor(rng: () => number, fish: Fish): number {
  const base = rrange(rng, BITE_WINDOW_MIN, BITE_WINDOW_MAX);
  const factor = fish.rare ? WINDOW_FACTOR_RARE : fish.big ? WINDOW_FACTOR_BIG : 1;
  return base * factor;
}

export interface FeintWindow {
  /** キャスト時点からのオフセット(ms) */
  start: number;
  end: number;
}

/**
 * フェイント（にせアタリ）の計画。回数の目安はつりばで差をつける
 * （かわ 0〜1 / いけ 0〜2 / うみ 1〜2 ＝ 高得点の釣り場ほどフェイントが多い）。
 * すべて本アタリ（delayMs）の FEINT_END_GAP 手前までに収まるように前から順へ置き、
 * 待ちが短いキャストでは入りきる数まで減る（0回になることもある）。
 * rng 注入＝「今日のゲーム」では全員同じフェイント。
 */
export function feintPlan(rng: () => number, spotKey: SpotKey, delayMs: number): FeintWindow[] {
  const r = rng(); // 回数の抽選（必ず1回消費）
  let n: number;
  if (spotKey === 'river') n = r < 0.5 ? 0 : 1;
  else if (spotKey === 'pond') n = r < 0.3 ? 0 : r < 0.75 ? 1 : 2;
  else n = r < 0.55 ? 1 : 2;

  // 使える区間（先頭 FEINT_START_MIN・末尾 FEINT_END_GAP を除く）に収まる数へ切り詰める
  const span = delayMs - FEINT_START_MIN - FEINT_END_GAP;
  while (n > 0 && n * FEINT_MS + (n - 1) * FEINT_GAP_MS > span) n--;

  // 前から順に「残りのフェイントが必ず置ける」範囲でランダム配置（順序・最小間隔・末尾余白を保証）
  const out: FeintWindow[] = [];
  let t = FEINT_START_MIN;
  for (let i = 0; i < n; i++) {
    const rest = (n - 1 - i) * (FEINT_MS + FEINT_GAP_MS);
    const hi = FEINT_START_MIN + span - FEINT_MS - rest;
    const start = t + rng() * Math.max(0, hi - t);
    out.push({ start, end: start + FEINT_MS });
    t = start + FEINT_MS + FEINT_GAP_MS;
  }
  return out;
}
