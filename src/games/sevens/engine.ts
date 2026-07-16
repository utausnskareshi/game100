// =============================================================
// 七ならべ（No.57）の純ロジック（DOM非依存・乱数注入）
// =============================================================
// - 3人プレイ（あなた＋CPU2人）。開始時に 4枚の7を場に出し、残り48枚を16枚ずつ配る。
// - 場は suit ごとに 7から上（8..K）・下（6..A）へ のばす。あるカードが出せるのは、
//   同スートの となり（rank±1）がすでに場にあるとき（脱落者の一括放出で島ができても対応）。
// - パスは3回まで。4回目のパスで脱落＝手札を全部 場に放出。手札を先に無くすほど上位。
// - 乱数は 配り・CPU に rng 注入（ctx.random）。import は game-api と同一フォルダのみ。

export interface CardSR {
  s: number; // 0..3（0♠ 1♥ 2♦ 3♣）
  r: number; // 1..13
}

export const SUIT_CHARS = ['♠', '♥', '♦', '♣'];
export const RANK_CHARS = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
export const isRedSuit = (s: number): boolean => s === 1 || s === 2;

export interface Board {
  /** placed[s][r] = そのカードが場に出ているか（r は 1..13・0/14 番兵は false） */
  placed: boolean[][];
}

export function makeBoard(): Board {
  const placed: boolean[][] = [];
  for (let s = 0; s < 4; s++) {
    placed[s] = new Array<boolean>(15).fill(false);
    placed[s]![7] = true; // 7 を最初から置く
  }
  return { placed };
}

export interface DealResult {
  hands: CardSR[][]; // 3人ぶん（16枚ずつ）
  board: Board;
}

/** 52枚から4枚の7を場へ、残り48枚を3人に16枚ずつ配る（rng 注入・決定論） */
export function deal(rng: () => number, players = 3): DealResult {
  const deck: CardSR[] = [];
  for (let s = 0; s < 4; s++) for (let r = 1; r <= 13; r++) if (r !== 7) deck.push({ s, r });
  // Fisher-Yates
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = deck[i]!;
    deck[i] = deck[j]!;
    deck[j] = t;
  }
  const hands: CardSR[][] = [];
  for (let p = 0; p < players; p++) hands.push([]);
  for (let i = 0; i < deck.length; i++) hands[i % players]!.push(deck[i]!);
  // 手札は見やすいよう スート→ランク順に整列
  for (const h of hands) h.sort((a, b) => (a.s - b.s) || (a.r - b.r));
  return { hands, board: makeBoard() };
}

/** そのカードを場に出せるか（となりが置かれている・まだ出ていない） */
export function isPlaceable(board: Board, s: number, r: number): boolean {
  if (r < 1 || r > 13) return false;
  const row = board.placed[s]!;
  if (row[r]) return false;
  return !!row[r - 1] || !!row[r + 1];
}

/** 手札のうち 出せるカード */
export function playableOf(hand: CardSR[], board: Board): CardSR[] {
  return hand.filter((c) => isPlaceable(board, c.s, c.r));
}

/** 場にカードを置く（破壊的） */
export function place(board: Board, s: number, r: number): void {
  board.placed[s]![r] = true;
}

/** 手札から1枚除く（同じ s,r） */
export function removeFromHand(hand: CardSR[], s: number, r: number): void {
  const i = hand.findIndex((c) => c.s === s && c.r === r);
  if (i >= 0) hand.splice(i, 1);
}

/**
 * CPU の手（出すカード or null=パス）。基本は出せるなら出す（詰み防止）。
 * ヒューリスティック: 7から遠い端のカードを優先（早く手札を減らす）＋同点は rng。
 */
export function cpuChoose(hand: CardSR[], board: Board, rng: () => number): CardSR | null {
  const opts = playableOf(hand, board);
  if (opts.length === 0) return null;
  // 端（|r-7| が大きい）を優先、同点は乱数で
  let best = opts[0]!;
  let bestKey = -1;
  for (const c of opts) {
    const key = Math.abs(c.r - 7) * 4 + rng();
    if (key > bestKey) {
      bestKey = key;
      best = c;
    }
  }
  return best;
}

/** 脱落: 手札を全部 場に放出（島ができてよい）。手札は空になる */
export function dumpHand(board: Board, hand: CardSR[]): void {
  for (const c of hand) board.placed[c.s]![c.r] = true;
  hand.length = 0;
}

/** 全カードが場に出ているか（52枚） */
export function boardComplete(board: Board): boolean {
  for (let s = 0; s < 4; s++) for (let r = 1; r <= 13; r++) if (!board.placed[s]![r]) return false;
  return true;
}
