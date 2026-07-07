// UI文言の一元管理。将来の多言語対応はこのファイルの差し替えで行える。
import type { Category } from '../game-api/types';

export const APP_NAME = 'GAME100';
export const APP_URL = 'https://utausnskareshi.github.io/game100/';
export const REPO_URL = 'https://github.com/utausnskareshi/game100';

export const CATEGORY_LABEL: Record<Category, string> = {
  action: 'アクション',
  puzzle: 'パズル',
  reflex: 'はんしゃ',
  memory: 'きおく',
  timing: 'タイミング',
  sensor: 'センサー',
  chill: 'のんびり',
};

export const TIME_LABEL: Record<'short' | 'mid' | 'long', string> = {
  short: '1分',
  mid: '3分',
  long: 'じっくり',
};

export const t = {
  tabs: { home: 'ホーム', games: 'ゲーム', records: 'きろく', settings: 'せってい' },
  common: {
    play: 'あそぶ',
    close: 'とじる',
    cancel: 'キャンセル',
    ok: 'OK',
    back: 'もどる',
  },
  update: {
    available: '新しいバージョンがあります',
    apply: '更新する',
  },
  offlineReady: 'オフラインでもあそべる準備ができました 🎉',
  home: {
    daily: 'きょうのゲーム',
    dailyNote: '今日はみんな同じ配置！ハイスコアをきそってみよう',
    random: '🎲 ランダムにあそぶ',
    recent: 'さいきんあそんだ',
    newGames: 'あたらしいゲーム',
    progress: 'スタンプのすすみぐあい',
    comingSoonTitle: 'ゲームは じゅんび中！',
    comingSoonBody: 'ここに100このミニゲームが少しずつ追加されていきます。アップデートをおたのしみに！',
  },
  games: {
    searchPlaceholder: 'なまえ・ひらがな・番号でさがす',
    all: 'すべて',
    fav: '⭐ お気に入り',
    new: '🆕 あたらしい',
    short: '⏱ 1分だけ',
    sortNo: '番号順',
    sortNew: '新着順',
    sortName: '名前順',
    sortPlays: 'よくあそぶ順',
    empty: '🚧 ゲームはこれから追加されます\n100このゲームがここにならぶ予定です。おたのしみに！',
    notFound: 'みつかりませんでした',
  },
  records: {
    level: 'プレイヤーレベル',
    streak: 'れんぞく',
    totalPlays: 'プレイ回数',
    totalTime: 'プレイ時間',
    stampTitle: 'スタンプだいし',
    stampNote: 'あそぶとスタンプ、金メダルで金わくになるよ',
    achievements: 'じっせき',
    globalSection: 'ぜんたい',
    secretName: '？？？',
    secretDesc: 'かくされた実績',
  },
  settings: {
    sound: '効果音',
    haptics: 'バイブレーション',
    hapticsUnsupported: 'この端末では使えません（iPhoneは非対応）',
    theme: 'テーマ',
    themeAuto: '自動',
    themeLight: 'ライト',
    themeDark: 'ダーク',
    dataSection: 'データ',
    export: 'バックアップ（書き出し）',
    import: 'データの読み込み',
    reset: 'データをぜんぶ消す',
    aboutSection: 'アプリについて',
    whatsNew: '更新履歴（What’s New）',
    installGuide: 'インストール方法',
    reload: '再読み込み',
    repair: '表示の修復（キャッシュを入れ直す）',
    version: 'バージョン',
    offlineOk: 'オフライン対応：準備完了 ✅',
    offlineNot: 'オフライン対応：準備中…（電波のある場所で少し待ってね）',
  },
} as const;
