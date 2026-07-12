// リリースごとの更新内容。新しいものを配列の先頭に追加していく。
// ここに書いた内容が「せってい → 更新履歴」に表示される。
// バージョンの真ん中の数字＝収録した本番ゲームの数（土台=0.0.0 / 1本=0.1.0 / … / 100本=1.0.0）。
export interface ChangelogEntry {
  version: string;
  date: string; // YYYY-MM-DD
  notes: string[];
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: '0.35.0',
    date: '2026-07-13',
    notes: ['15種類のゲームを追加(合計35)。', 'ゲームの難易度と見やすさを改善しました。'],
  },
  {
    version: '0.20.0',
    date: '2026-07-11',
    notes: ['15種類のゲームを追加(合計20)'],
  },
  {
    version: '0.5.0',
    date: '2026-07-07',
    notes: [
      'GAME100を公開しました。',
      'ゲームはこれから少しずつ追加していきます。',
      '100種類のミニゲームを目標としています。',
    ],
  },
];
