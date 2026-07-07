// 検証用ゲーム一覧（開発ビルドのみ読み込まれる。src/games/index.ts 参照）
// 本番リリース前の枠組み検証のためのもので、dist には含まれない。
import type { GameMeta } from '../../game-api/types';

export const devGames: GameMeta[] = [
  {
    id: 'dev-tap',
    no: 98,
    title: 'タップテスト',
    kana: 'たっぷてすと',
    description: 'ふくらむシャボンを消えるまえにタップ！（枠組み検証用・開発ビルド限定）',
    category: 'reflex',
    orientation: 'portrait',
    scoring: 'points',
    medals: { bronze: 10, silver: 18, gold: 26 },
    timeToPlay: 'short',
    help: {
      goal: '30秒のあいだに、できるだけ多くのシャボンをタップして消そう。3回消しそこねると終了！',
      controls: ['シャボンをタップ：消す'],
      tips: ['シャボンはだんだん小さくなる。早めにタップしよう'],
    },
    achievements: [
      { id: 'first-pop', name: 'はじめてのポン', desc: 'シャボンを1こ消した' },
      { id: 'pop-25', name: 'ポンポンポン', desc: '1プレイで25こ消した' },
    ],
    icon: { emoji: '🫧' },
    addedIn: '0.1.0',
    load: () => import('./tap'),
  },
  {
    id: 'dev-tilt',
    no: 99,
    title: 'かたむきテスト',
    kana: 'かたむきてすと',
    description: '端末をかたむけてボールをゴールへ運ぶタイムアタック！（枠組み検証用・開発ビルド限定）',
    category: 'sensor',
    orientation: 'landscape',
    sensors: ['motion'],
    scoring: 'timeMs',
    medals: { bronze: 25_000, silver: 15_000, gold: 9_000 },
    timeToPlay: 'short',
    help: {
      goal: 'ボールをかたむきで転がして、旗のゴールまで運ぼう。タイムが短いほど高評価！',
      controls: ['端末をかたむける：ボールが転がる', '画面をドラッグ：かたむきの代わりに操作できる'],
      tips: ['かたむけすぎると壁にぶつかって減速する。少しずつ！'],
    },
    achievements: [
      { id: 'goal', name: 'ゴール！', desc: 'はじめてゴールした' },
      { id: 'speed-6', name: 'スピードスター', desc: '6秒以内にゴールした', secret: true },
    ],
    icon: { emoji: '🎱' },
    addedIn: '0.1.0',
    load: () => import('./tilt'),
  },
  {
    id: 'dev-quiz',
    no: 100,
    title: 'けいさんテスト',
    kana: 'けいさんてすと',
    description: '10問の計算をすばやく解こう。はやく答えるとボーナス！（枠組み検証用・開発ビルド限定）',
    category: 'puzzle',
    orientation: 'any',
    scoring: 'points',
    medals: { bronze: 60, silver: 100, gold: 130 },
    timeToPlay: 'short',
    help: {
      goal: '10問の計算に答えよう。正解+10点、2秒以内の正解はさらに+5点！',
      controls: ['4つの選択肢から答えをタップ'],
      tips: ['まちがえても減点はない。テンポよく！'],
    },
    achievements: [
      { id: 'perfect', name: 'パーフェクト', desc: '10問ぜんぶ正解した' },
      { id: 'fast-25', name: 'そくとう', desc: '25秒以内にクリアした', secret: true },
    ],
    icon: { emoji: '🧮' },
    addedIn: '0.1.0',
    load: () => import('./quiz'),
  },
];
