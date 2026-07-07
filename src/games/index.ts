// =============================================================
// ゲーム登録所（レジストリ）
// =============================================================
// 新しいゲームはこの配列に1エントリ追記するだけで追加できる。
// 手順は docs/ADDING_A_GAME.md を参照。
//
// ルール:
//   - 追記専用（並べ替え・削除はしない）
//   - id と no は一度リリースしたら変更しない（保存データのキー）
//   - 公開をやめるときは削除せず status: 'retired' にする
// =============================================================
import type { GameMeta } from '../game-api/types';

export const games: GameMeta[] = [
  // === ここに新しいゲームを追記 ===
  {
    id: 'reversi',
    no: 1,
    title: 'リバーシ',
    kana: 'りばーし',
    description: 'CPUと対戦！ばんをはさんで自分の色をふやすボードゲーム。先攻・後攻とつよさがえらべる。',
    category: 'puzzle',
    orientation: 'any',
    scoring: 'points',
    medals: { bronze: 33, silver: 44, gold: 55 },
    timeToPlay: 'mid',
    startMode: 'immediate',
    help: {
      goal: 'ばんをはさんで自分の色をふやそう。おわりに石が多いほうがかち！',
      controls: ['あきマスをタップ：石をおく', 'おけるところは・でひかる', '「まった」でひとつ前にもどる'],
      tips: ['かどは取られない強い場所', 'とちゅうの数より、終わりに多いほうが大事'],
    },
    achievements: [
      { id: 'first-win', name: 'はつしょうり', desc: 'CPUにはじめて勝った' },
      { id: 'beat-hard', name: 'つよいをたおした', desc: 'つよいCPUに勝った' },
      { id: 'shutout', name: 'かんぷう', desc: '相手を0まいにして勝った' },
      { id: 'four-corners', name: 'すみせいあつ', desc: '四すみをぜんぶ取って勝った', secret: true },
      { id: 'comeback', name: '大ぎゃくてん', desc: 'おわりぎわの劣勢から逆転で勝った', secret: true },
    ],
    icon: { emoji: '⚫' },
    addedIn: '0.5.0',
    load: () => import('./reversi/game'),
  },
  {
    id: 'block-break',
    no: 2,
    title: 'ブロックくずし',
    kana: 'ぶろっくくずし',
    description: 'バーでボールをはねかえしてブロックをこわそう。アイテムでパワーアップ！',
    category: 'action',
    orientation: 'portrait',
    optionalSensors: ['motion'],
    scoring: 'points',
    medals: { bronze: 800, silver: 1800, gold: 3200 },
    timeToPlay: 'mid',
    help: {
      goal: 'バーでボールをはねかえして、ブロックをぜんぶこわそう！ボールを下におとすとライフがへるよ。',
      controls: [
        'ゆびで左右になぞる：バーがうごく',
        '端末をかたむけてもうごく（つかわなくてもOK）',
        'おちてくる四角いアイテムをバーでとる：パワーアップ！',
        'タップ：ボールをはっしゃ',
      ],
      tips: [
        'バーのはしに当てると、ななめにとばせるよ',
        '★のブロックはかならずアイテムをおとす',
        'ボールがふえたら、ぜんぶは追わなくてだいじょうぶ',
      ],
    },
    achievements: [
      { id: 'first-clear', name: 'はじめてクリア', desc: 'ステージ1をクリアした' },
      { id: 'no-miss', name: 'ノーミス', desc: 'ボールを1こもおとさずにステージをクリアした' },
      { id: 'triple', name: 'トリプルボール', desc: 'ボールを3こ同時にとばした' },
      { id: 'all-clear', name: 'ぜんめんクリア', desc: 'ステージ5までぜんぶクリアした' },
      { id: 'combo-10', name: 'コンボめいじん', desc: 'バーにふれずに10れんぞくでブロックをこわした', secret: true },
      { id: 'item-8', name: 'あつめめいじん', desc: '1プレイでアイテムを8こキャッチした', secret: true },
    ],
    icon: { emoji: '🧱' },
    addedIn: '0.5.0',
    load: () => import('./block-break/game'),
  },
  {
    id: 'speed',
    no: 3,
    title: 'スピード',
    kana: 'すぴーど',
    description: 'CPUとリアルタイム対戦のトランプスピード。ローカルルールもえらべる！',
    category: 'reflex',
    orientation: 'portrait',
    scoring: 'points',
    medals: { bronze: 120, silver: 230, gold: 300 },
    timeToPlay: 'short',
    startMode: 'immediate',
    help: {
      goal: 'まん中の2つの台に、数字がとなり（1ちがい）のカードをどんどん重ねよう。先に手もちのカードがなくなったほうのかち！',
      controls: [
        'ひかっているカードをタップ：台に出す',
        '両方の台に出せるときは、いいほうへ自動でとぶよ',
        'おたがい出せないときは「せーの！」で自動的に1まいめくる',
      ],
      tips: [
        'KとAはつながっているよ（ループ）',
        'CPUのカードも見える。つぎの手を先よみしよう',
        'ローカルルール（同じ数字・ジョーカーなど）は開始前にえらべる',
      ],
    },
    achievements: [
      { id: 'first-win', name: 'はつしょうり', desc: 'CPUにはじめて勝った' },
      { id: 'beat-hard', name: 'つよいをたおした', desc: 'つよいCPUに勝った' },
      { id: 'speed-45', name: 'スピードスター', desc: '45びょう以内に勝った' },
      { id: 'combo-5', name: 'れんぞくだし', desc: 'CPUより先に5まいれんぞくで出した' },
      { id: 'no-seno', name: 'ノンストップ', desc: '「せーの」なしで勝った', secret: true },
      { id: 'joker-fin', name: 'ジョーカーじまい', desc: 'さいごの1まいがジョーカーだった', secret: true },
    ],
    icon: { emoji: '🃏' },
    addedIn: '0.5.0',
    load: () => import('./speed/game'),
  },
  {
    id: 'maze',
    no: 4,
    title: 'かたむきメイロ',
    kana: 'かたむきめいろ',
    description: 'スマホをかたむけてボールをころがし、ゴールをめざすランダム迷路。毎回ちがう迷路！',
    category: 'sensor',
    orientation: 'landscape',
    optionalSensors: ['motion'],
    scoring: 'timeMs',
    medals: { bronze: 60_000, silver: 40_000, gold: 25_000 },
    timeToPlay: 'short',
    startMode: 'immediate',
    help: {
      goal: 'スタートからゴール🏁まで、ボールをはこぼう。はやくゴールするほど高評価！',
      controls: [
        'スマホをかたむける：ボールがころがる',
        '画面をドラッグ：かたむきの代わりに動かせる（センサーがなくてもOK）',
        '左上の「すいへい」：今の持ち方を水平にリセット',
      ],
      tips: ['かたむけすぎると壁にぶつかってスピードダウン。少しずつ！', 'まよったら「ヒント」ありで正解ルートが見えるよ'],
    },
    achievements: [
      { id: 'first-goal', name: 'はじめてゴール', desc: 'めいろをクリアした' },
      { id: 'speedy', name: 'すいすい', desc: '15びょう以内にクリアした' },
      { id: 'big-clear', name: 'だいめいろ突破', desc: '「おおきい」めいろをクリアした' },
      { id: 'tilt-master', name: 'かたむきマスター', desc: 'ドラッグを使わずにクリアした', secret: true },
      { id: 'all-sizes', name: 'ぜんサイズ制覇', desc: 'ちいさい・ふつう・おおきいをぜんぶクリアした', secret: true },
    ],
    icon: { emoji: '🌀' },
    addedIn: '0.5.0',
    load: () => import('./maze/game'),
  },
  {
    id: 'hit-and-blow',
    no: 5,
    title: 'えもじヒットアンドブロー',
    kana: 'えもじひっとあんどぶろー',
    description: 'かくれた絵文字のならびを推理してあてよう。ヒントは「ズバリ」と「おしい」の数だけ！',
    category: 'puzzle',
    orientation: 'portrait',
    scoring: 'points',
    medals: { bronze: 120, silver: 240, gold: 360 },
    timeToPlay: 'short',
    startMode: 'immediate',
    help: {
      goal: 'かくれた絵文字のならび（あんごう）をあてよう。「こたえあわせ」でヒントが出るよ。',
      controls: [
        'パレットの絵文字をタップ：左のマスから置く',
        'おいたマスをタップ：けす（「やりなおし」で全部けす）',
        'そろったら「こたえあわせ」：⭕ズバリと🔶おしいの数が出る',
        '「メモ」ON中にパレットをタップ：ちがう絵文字に✕印（じぶん用メモ）',
      ],
      tips: [
        '⭕ズバリ＝絵も場所も合ってる。🔶おしい＝絵はあるけど場所ちがい',
        'どの絵が✕かをメモしながら、少しずつ場所をしぼろう',
        'まよったら設定で「ヒント」ありにすると1マスだけ教えてくれる',
      ],
    },
    achievements: [
      { id: 'first-solve', name: 'はじめてのすいり', desc: 'あんごうをはじめて当てた' },
      { id: 'sharp', name: 'するどいすいり', desc: '4かい以内で当てた' },
      { id: 'big-clear', name: 'だいすいり', desc: '「5もじ」で当てた' },
      { id: 'dup-clear', name: 'かぶりマスター', desc: '「かぶりあり」で当てた', secret: true },
      { id: 'no-hint', name: 'じぶんの力で', desc: 'ヒントなしで当てた' },
      { id: 'speedy', name: 'はやときめいじん', desc: '60びょう以内に当てた', secret: true },
    ],
    icon: { emoji: '🎯' },
    addedIn: '0.5.0',
    load: () => import('./hit-and-blow/game'),
  },
];

// 検証用ゲーム（開発ビルド限定。本番ビルドには一切含まれない）
if (import.meta.env.DEV) {
  const dev = await import('./dev/index');
  games.push(...dev.devGames);
}

/** 公開中のゲーム（retired を除き、番号順） */
export function activeGames(): GameMeta[] {
  return games.filter((g) => g.status !== 'retired').sort((a, b) => a.no - b.no);
}

export function gameById(id: string): GameMeta | undefined {
  return games.find((g) => g.id === id);
}
