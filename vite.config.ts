import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import pkg from './package.json';

// 重要: base / manifest.scope / manifest.start_url / SW の3点は必ず「/game100/」で一致させること。
// 不一致だと「オンラインでは動くがオフラインで壊れる」「インストール後に別スコープで開く」事故になる。
export default defineConfig({
  base: '/game100/',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    target: 'es2022',
  },
  plugins: [
    VitePWA({
      registerType: 'prompt',
      manifest: {
        name: 'GAME100',
        short_name: 'GAME100',
        description: '100種類のミニゲームで遊べる、オフライン対応の無料ゲームアプリ',
        lang: 'ja',
        start_url: '/game100/',
        scope: '/game100/',
        display: 'standalone',
        // Android では unlock() 時に manifest の orientation へ戻るため 'any' 固定。
        // 向き固定はゲーム中に screen.orientation.lock() で行う（iOS は回転案内で対応）。
        orientation: 'any',
        background_color: '#12142b',
        theme_color: '#12142b',
        categories: ['games', 'entertainment'],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // 将来ゲームが追加する画像・音声・フォントもオフラインキャッシュから漏らさない
        globPatterns: ['**/*.{js,css,html,svg,png,webp,jpg,jpeg,gif,woff,woff2,mp3,ogg,wav,webmanifest}'],
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
      },
      devOptions: {
        // SW は build + preview で検証する（開発中は無効のほうがキャッシュ事故がない）
        enabled: false,
      },
    }),
  ],
});
