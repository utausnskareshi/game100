// =============================================================
// ことばならべ（No.101・かくれゲーム）: 純ロジック（出題・並べ替え）
// =============================================================
// - バラバラのひらがなを並べて ことばを作る。絵文字がヒント。
// - 出題は rng 注入＝決定論（日替わりは全員同じ問題）。DOM 非依存。
// - ことばは「小さい文字（ゃゅょっ）と のばし棒（ー）を含まない」ものだけにしてある。
//   タイル1枚＝1文字なので、拗音・促音があると子どもには並べにくいため。
// =============================================================

export interface Word {
  /** こたえ（ひらがな3〜4文字） */
  w: string;
  /** ヒントの絵文字 */
  e: string;
}

/** 3文字のことば（やさしい順に使う） */
export const WORDS3: Word[] = [
  { w: 'りんご', e: '🍎' },
  { w: 'いちご', e: '🍓' },
  { w: 'みかん', e: '🍊' },
  { w: 'すいか', e: '🍉' },
  { w: 'ばなな', e: '🍌' },
  { w: 'たまご', e: '🥚' },
  { w: 'ぱんだ', e: '🐼' },
  { w: 'うさぎ', e: '🐰' },
  { w: 'きりん', e: '🦒' },
  { w: 'くじら', e: '🐋' },
  { w: 'ひつじ', e: '🐑' },
  { w: 'こあら', e: '🐨' },
  { w: 'かえる', e: '🐸' },
  { w: 'いるか', e: '🐬' },
  { w: 'さかな', e: '🐟' },
  { w: 'とけい', e: '⏰' },
  { w: 'かばん', e: '👜' },
  { w: 'ぼうし', e: '🧢' },
  { w: 'たいこ', e: '🥁' },
  { w: 'めがね', e: '👓' },
  { w: 'はさみ', e: '✂️' },
  { w: 'くるま', e: '🚗' },
  { w: 'でんき', e: '💡' },
  { w: 'とびら', e: '🚪' },
];

/** 4文字のことば（後半で使う） */
export const WORDS4: Word[] = [
  { w: 'ふうせん', e: '🎈' },
  { w: 'おにぎり', e: '🍙' },
  { w: 'ぺんぎん', e: '🐧' },
  { w: 'ひまわり', e: '🌻' },
  { w: 'ひこうき', e: '✈️' },
  { w: 'えんぴつ', e: '✏️' },
  { w: 'てぶくろ', e: '🧤' },
  { w: 'くつした', e: '🧦' },
  { w: 'にわとり', e: '🐓' },
  { w: 'らいおん', e: '🦁' },
  { w: 'にんじん', e: '🥕' },
  { w: 'たまねぎ', e: '🧅' },
  { w: 'ふうりん', e: '🎐' },
  { w: 'しんごう', e: '🚦' },
  { w: 'こおろぎ', e: '🦗' },
  { w: 'ありんこ', e: '🐜' },
];

/** 1プレイの問題数（前半は3文字・後半は4文字） */
export const ROUNDS = 8;
/** 3文字で出す問題数 */
export const EASY_ROUNDS = 4;

export interface Quiz {
  /** こたえ */
  answer: string;
  /** ヒントの絵文字 */
  emoji: string;
  /** バラバラにした文字（この順でタイルが並ぶ） */
  tiles: string[];
}

function shuffle<T>(a: T[], rng: () => number): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = a[i]!;
    a[i] = a[j]!;
    a[j] = t;
  }
  return a;
}

/**
 * 1プレイぶんの問題を作る（同じことばは1回しか出ない）。
 * タイルは「答えと同じ並び」にならないようにする（そのままタップして終わりにならないように）。
 */
export function makeQuizzes(rng: () => number): Quiz[] {
  const easy = shuffle(WORDS3.slice(), rng).slice(0, EASY_ROUNDS);
  const hard = shuffle(WORDS4.slice(), rng).slice(0, ROUNDS - EASY_ROUNDS);
  return [...easy, ...hard].map((word) => {
    const chars = [...word.w];
    let tiles = shuffle(chars.slice(), rng);
    // まれに元通りに並ぶので、そのときは並べ直す（同じ文字が続く語は無いので必ず抜けられる）
    for (let i = 0; i < 12 && tiles.join('') === word.w; i++) tiles = shuffle(chars.slice(), rng);
    if (tiles.join('') === word.w) {
      const t = tiles[0]!;
      tiles[0] = tiles[1]!;
      tiles[1] = t;
    }
    return { answer: word.w, emoji: word.e, tiles };
  });
}

/** タイルの並びが答えと同じ文字の集まりか（生成の検証用） */
export function sameLetters(a: string[], b: string): boolean {
  const s1 = a.slice().sort().join('');
  const s2 = [...b].sort().join('');
  return s1 === s2;
}
