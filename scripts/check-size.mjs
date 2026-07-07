// ビルド成果物の合計サイズを検査する。
// 全ファイルを Service Worker で事前キャッシュする方針のため、
// 上限を超えたらデプロイを失敗させて「キャッシュの肥大化」に早めに気づけるようにする。
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2] ?? 'dist';
const limitMb = Number(process.argv[3] ?? 15);
if (!Number.isFinite(limitMb) || limitMb <= 0) {
  // NaN のまま比較すると常に合格扱いになり、チェックが無効化されてしまう
  console.error(`サイズ上限の指定が不正です: ${process.argv[3]}`);
  process.exit(2);
}

let total = 0;
const walk = (d) => {
  for (const name of readdirSync(d)) {
    const p = join(d, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p);
    else total += st.size;
  }
};
walk(dir);

const mb = total / 1024 / 1024;
console.log(`build size: ${mb.toFixed(2)} MB (limit: ${limitMb} MB)`);
if (mb > limitMb) {
  console.error('ビルドサイズが上限を超えました。事前キャッシュが重くなりすぎです。画像・音声などの大きなアセットを見直してください。');
  process.exit(1);
}
