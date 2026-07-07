// 公開URLのQRコードをSVGで生成して public/ に置く（ビルド時依存のみ・実行時依存ゼロ）。
// URLを変えたときは `npm run gen:qr` で作り直すこと。
import { writeFileSync, mkdirSync } from 'node:fs';
import QRCode from 'qrcode';

const url = 'https://utausnskareshi.github.io/game100/';
const svg = await QRCode.toString(url, {
  type: 'svg',
  margin: 1,
  color: { dark: '#12142b', light: '#ffffff' },
});
mkdirSync('public', { recursive: true });
writeFileSync('public/qr.svg', svg);
console.log('generated public/qr.svg for', url);
