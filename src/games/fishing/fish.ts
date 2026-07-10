// =============================================================
// のんびりさかなつり（No.17）のロジック（DOM非依存・乱数注入）
// =============================================================
// - つりば（かわ/いけ/うみ）ごとの魚テーブルと重み付き抽選、アタリまでの待ち時間・
//   アタリ窓の長さを注入 rng から決める（「今日のゲーム」では全員同じ引き）。
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

// アタリまでの待ち時間・アタリ窓（ms）。子ども向けに待ちすぎない範囲に。
export const BITE_DELAY_MIN = 900;
export const BITE_DELAY_MAX = 2200;
export const BITE_WINDOW_MIN = 750;
export const BITE_WINDOW_MAX = 1050;

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

/** アタリ窓の長さ(ms) */
export function biteWindow(rng: () => number): number {
  return rrange(rng, BITE_WINDOW_MIN, BITE_WINDOW_MAX);
}
