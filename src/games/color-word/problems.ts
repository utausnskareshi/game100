// =============================================================
// いろよみチャレンジ（No.26）の出題ロジック（DOM非依存・乱数注入）
// =============================================================
// - ストループ課題: 「ことば（あか等）」を「べつの いろ」で表示し、
//   指示（いろ／ことば）に合うほうをタップさせる。
// - rng は1問につき必ず4回消費（word / conflict / inkOffset / flip）。
//   種類にかかわらず消費数を一定に保ち、日替わりの問題列を全端末で一致させる。
// - import してよいのは game-api（types/helpers）と同一フォルダのみ（このファイルは依存なし）。

export type ModeKey = 'easy' | 'normal' | 'hard';
export type Ask = 'color' | 'word';

export interface ColorDef {
  /** ひらがなの色ことば（表示・読み上げ兼用） */
  label: string;
  /** インク色（固定ダーク地カードの上に置く前提の明るめ4色） */
  css: string;
}

/** 4色（インデックスが「色の概念」のID。ボタン順もこの順で固定） */
export const COLORS: ColorDef[] = [
  { label: 'あか', css: '#ff5a64' },
  { label: 'あお', css: '#4a9bff' },
  { label: 'きいろ', css: '#ffd234' },
  { label: 'みどり', css: '#3ed36a' },
];

export interface Question {
  /** 書かれている ことば（COLORS index） */
  word: number;
  /** 表示するインク色（COLORS index） */
  ink: number;
  /** この問題で答えるもの */
  ask: Ask;
  /** 直前で指示が切り替わった問題（演出・実績用） */
  switched: boolean;
}

/** ことば≠いろ になる確率（むずかしいほど混乱する） */
const CONFLICT_P: Record<ModeKey, number> = { easy: 0.55, normal: 0.75, hard: 0.85 };
/** 指示（いろ⇔ことば）が切り替わる確率。easy は切り替えなし */
const FLIP_P: Record<ModeKey, number> = { easy: 0, normal: 0.28, hard: 0.38 };
/** 切り替え後、最低この問数は同じ指示をつづける（毎問コロコロ変わる理不尽の防止） */
const MIN_BLOCK = 3;

/** むずかしいモードの1問の制限時間(ms)。時間切れはミス扱いで次の問題へ */
export const HARD_Q_TIME = 3000;

/** 1問の基本点（コンボ加点は別。playtest調整前提の仮値） */
export const BASE_POINTS: Record<ModeKey, number> = { easy: 10, normal: 15, hard: 20 };

export interface AskState {
  ask: Ask;
  /** いまの指示が何問つづいたか */
  block: number;
}

export const initialAskState = (): AskState => ({ ask: 'color', block: 0 });

/**
 * 次の1問をつくる（st は破壊的に更新される）。
 * rng 消費は常に4回: word → conflict → inkOffset → flip。
 */
export function nextQuestion(rng: () => number, mode: ModeKey, st: AskState): Question {
  const word = Math.floor(rng() * 4) % 4;
  const conflict = rng() < CONFLICT_P[mode];
  const off = 1 + Math.floor(rng() * 3);
  const ink = conflict ? (word + off) % 4 : word;
  const flipRoll = rng();
  let switched = false;
  if (st.block >= MIN_BLOCK && flipRoll < FLIP_P[mode]) {
    st.ask = st.ask === 'color' ? 'word' : 'color';
    st.block = 0;
    switched = true;
  }
  st.block++;
  return { word, ink, ask: st.ask, switched };
}

/** この問題の正解（COLORS index） */
export const answerOf = (q: Question): number => (q.ask === 'color' ? q.ink : q.word);
