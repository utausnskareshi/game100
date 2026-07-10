// =============================================================
// おぼえてピアノ（No.14）の音データとシーケンス生成（DOM非依存・乱数注入）
// =============================================================
// - ドレミ…の音名・周波数(Hz)・色。左から Cメジャー C4〜C5（8音）。
// - シーケンスは 0..keyCount-1 の乱数キー。すべて注入 rng 由来＝「今日のゲーム」は全員同じメロディ。
// - import してよいのは game-api（types/helpers）と同一フォルダのみ（このファイルは依存なし）。

export interface Note {
  name: string;
  freq: number;
  color: string;
}

/** 左から順に。難易度で先頭 keyCount 個だけ使う */
export const NOTES: Note[] = [
  { name: 'ド', freq: 261.63, color: '#ff5d5d' },
  { name: 'レ', freq: 293.66, color: '#ff9f40' },
  { name: 'ミ', freq: 329.63, color: '#ffcf33' },
  { name: 'ファ', freq: 349.23, color: '#5ec86a' },
  { name: 'ソ', freq: 392.0, color: '#3ec6e0' },
  { name: 'ラ', freq: 440.0, color: '#5a7bf0' },
  { name: 'シ', freq: 493.88, color: '#a06cf0' },
  { name: 'ド', freq: 523.25, color: '#ff6ec7' },
];

/** 0..keyCount-1 の乱数キーを1つ返す（お手本の1音を足す用） */
export function randomKey(rng: () => number, keyCount: number): number {
  return Math.min(keyCount - 1, Math.floor(rng() * keyCount));
}
