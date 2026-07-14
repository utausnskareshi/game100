// =============================================================
// ぬりえタッチ（No.47）のドット絵データ（DOM非依存・純ロジック）
// =============================================================
// - 10×10のドット絵。'0'=ぬらないマス、'1'〜'4'=パレット番号。
// - 絵はすべて自作（著作物の引き写しなし）。
// - 乱数は注入（ctx.random）。お絵かきの選択で1回だけ消費（日替わりで全員同じ絵）。
// - import してよいのは game-api（types/helpers）と同一フォルダのみ（このファイルは依存なし）。

export type Rng = () => number;

export interface PaletteColor {
  n: number;
  color: string;
  name: string;
}

export interface ArtDef {
  key: string;
  title: string;
  rows: string[]; // 10行×10文字
  palette: PaletteColor[]; // 4色
}

export const GRID = 10;

export const ARTS: ArtDef[] = [
  {
    key: 'apple',
    title: 'りんご',
    rows: [
      '0000300000',
      '0022300000',
      '0011111000',
      '0111111110',
      '0141111110',
      '0141111110',
      '0111111110',
      '0111111110',
      '0011111100',
      '0000000000',
    ],
    palette: [
      { n: 1, color: '#e0524a', name: 'あか' },
      { n: 2, color: '#3ea34d', name: 'みどり' },
      { n: 3, color: '#8a5a33', name: 'ちゃいろ' },
      { n: 4, color: '#ffd9d4', name: 'ももいろ' },
    ],
  },
  {
    key: 'butterfly',
    title: 'ちょうちょ',
    rows: [
      '0300000030',
      '0030000300',
      '0110330110',
      '0111331110',
      '0121331210',
      '0111331110',
      '0044334400',
      '0044334400',
      '0000330000',
      '0000000000',
    ],
    palette: [
      { n: 1, color: '#f08ab0', name: 'ピンク' },
      { n: 2, color: '#f5a623', name: 'オレンジ' },
      { n: 3, color: '#5a4636', name: 'こげちゃ' },
      { n: 4, color: '#7cc4e8', name: 'みずいろ' },
    ],
  },
  {
    key: 'house',
    title: 'おうち',
    rows: [
      '0000110000',
      '0001111000',
      '0011111100',
      '0111111110',
      '0222222220',
      '0244224420',
      '0244224420',
      '0222332220',
      '0222332220',
      '0222332220',
    ],
    palette: [
      { n: 1, color: '#e0524a', name: 'あか' },
      { n: 2, color: '#ffd23e', name: 'きいろ' },
      { n: 3, color: '#8a5a33', name: 'ちゃいろ' },
      { n: 4, color: '#7cc4e8', name: 'みずいろ' },
    ],
  },
];

/** 今日の1枚をえらぶ（乱数消費は常に1回） */
export function pickArt(rng: Rng): number {
  return Math.min(ARTS.length - 1, Math.floor(rng() * ARTS.length));
}

/** マス番号 → そのマスの数字（0=ぬらない） */
export function cellNum(art: ArtDef, idx: number): number {
  const row = art.rows[(idx / GRID) | 0]!;
  return row.charCodeAt(idx % GRID) - 48;
}

/** ぬるマスの総数 */
export function paintableCount(art: ArtDef): number {
  let c = 0;
  for (let i = 0; i < GRID * GRID; i++) if (cellNum(art, i) > 0) c++;
  return c;
}

/** 完成スコア: 200 + はやさ max(0,150-秒) + せいかくさ max(0,60-まちがい×5) */
export function artScore(sec: number, mistakes: number): number {
  return 200 + Math.max(0, 150 - sec) + Math.max(0, 60 - mistakes * 5);
}
