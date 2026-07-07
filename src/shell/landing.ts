// ブラウザで開いたときに表示するランディング（説明＋インストール手順）。
// ホーム画面から起動（standalone）した場合は表示されない。
import { el, clear } from '../platform/dom';
import { detectPlatform, type Platform } from '../platform/env';
import { canInstall, onInstallAvailable, promptInstall } from '../platform/pwa';
import { APP_NAME, APP_URL, REPO_URL } from './strings';

// beforeinstallprompt が一度も発火しない環境（iOS等）では下の「発火時に自動解除」が
// 働かず、ガイドを開くたびに購読が溜まるため、新しいガイドを作る時点で前回分を解除する
// （ガイドは同時に1つしか表示されないので、直前の購読は常に不要）
let offPrevInstall: (() => void) | null = null;

/** インストール手順ブロック（ランディングと「せってい→インストール方法」で共用） */
export function renderInstallGuide(): HTMLElement {
  offPrevInstall?.();
  const wrap = el('div', { class: 'install-guide' });
  const seg = el('div', { class: 'seg install-tabs' });
  const body = el('div', { class: 'install-body' });

  const platforms: { key: Platform; label: string }[] = [
    { key: 'ios', label: 'iPhone・iPad' },
    { key: 'android', label: 'Android' },
    { key: 'desktop', label: 'パソコン' },
  ];
  let active: Platform = detectPlatform();

  const renderBody = (): void => {
    clear(body);
    if (active === 'ios') {
      body.appendChild(
        el(
          'div',
          { class: 'install-steps' },
          el('strong', { text: '📱 iPhone・iPad（Safari）' }),
          el(
            'ol',
            null,
            el('li', { text: 'Safari でこのページをひらく（他のブラウザで見ている場合は、URLをコピーしてSafariで開いてください）' }),
            el('li', { text: '画面下（iPadは右上）の 共有ボタン（□に↑）をタップ' }),
            el('li', { text: '「ホーム画面に追加」をタップ' }),
            el('li', { text: '右上の「追加」をタップすると、ホーム画面に GAME100 が登場！' }),
          ),
          el('p', { class: 'install-note', text: '💡 インストールすると全画面＆オフラインで快適にあそべます。ブラウザのままあそんだ記録はアプリ版に自動では引き継がれないため、先にインストールするのがおすすめです（記録は「せってい → バックアップ」で引っこしもできます）。' }),
        ),
      );
    } else if (active === 'android') {
      const installBtn = el('button', { class: 'btn btn-primary btn-large', text: '📲 アプリをインストール' });
      installBtn.addEventListener('click', () => void promptInstall());
      body.appendChild(
        el(
          'div',
          { class: 'install-steps' },
          el('strong', { text: '🤖 Android（Chrome）' }),
          canInstall() ? installBtn : null,
          el(
            'ol',
            null,
            el('li', { text: 'Chrome でこのページをひらく' }),
            el('li', { text: '右上のメニュー（⋮）をタップ' }),
            el('li', { text: '「アプリをインストール」または「ホーム画面に追加」をタップ' }),
          ),
          el('p', { class: 'install-note', text: '💡 上にインストールボタンが表示されている場合は、そこからワンタップで追加できます。' }),
        ),
      );
    } else {
      body.appendChild(
        el(
          'div',
          { class: 'install-steps install-desktop' },
          el('strong', { text: '💻 このアプリはスマートフォン・タブレット向けです' }),
          el('p', { text: 'お使いのスマホでQRコードを読み取って開いてください。' }),
          el('div', { class: 'qr-box' }, el('img', { src: import.meta.env.BASE_URL + 'qr.svg', alt: 'QRコード', width: '160', height: '160' })),
          el('p', { class: 'install-url', text: APP_URL }),
        ),
      );
    }
  };

  for (const p of platforms) {
    const btn = el('button', { text: p.label, class: p.key === active ? 'active' : '' });
    btn.addEventListener('click', () => {
      active = p.key;
      seg.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b === btn));
      renderBody();
    });
    seg.appendChild(btn);
  }

  renderBody();
  // Androidのインストールボタンは beforeinstallprompt 発火後に表示できる。
  // このガイドはシートを開くたびに作られるため、DOMから外れていたら購読を自動解除する（リーク防止）
  const offInstall = onInstallAvailable(() => {
    if (!body.isConnected) {
      offInstall();
      return;
    }
    if (active === 'android') renderBody();
  });
  offPrevInstall = offInstall;
  wrap.append(seg, body);
  return wrap;
}

export function renderLanding(container: HTMLElement, opts: { onEnter: () => void }): void {
  clear(container);

  const features = [
    { ico: '📴', label: 'オフラインでもあそべる' },
    { ico: '💯', label: '100このミニゲーム（順次追加）' },
    { ico: '🏆', label: 'メダル・実績・スタンプ集め' },
    { ico: '🆓', label: '無料・広告なし・登録なし' },
  ];

  const enterBtn = el('button', { class: 'btn btn-ghost', text: 'インストールせずにブラウザであそぶ →' });
  enterBtn.addEventListener('click', opts.onEnter);

  container.appendChild(
    el(
      'div',
      { class: 'landing' },
      el(
        'div',
        { class: 'landing-inner' },
        el('img', { class: 'landing-logo', src: import.meta.env.BASE_URL + 'icons/icon-192.png', alt: '' }),
        el('h1', { text: APP_NAME }),
        el('p', { class: 'landing-tagline', text: 'ポケットに100のミニゲーム。\nインストールすれば電波がなくてもあそべる！' }),
        el(
          'div',
          { class: 'feature-grid' },
          ...features.map((f) =>
            el('div', { class: 'feature' }, el('div', { class: 'f-ico', text: f.ico }), el('div', { text: f.label })),
          ),
        ),
        el('h2', { class: 'landing-h2', text: '📲 ホーム画面に追加してあそぶ' }),
        renderInstallGuide(),
        enterBtn,
        el(
          'p',
          { class: 'landing-foot' },
          `v${__APP_VERSION__} ・ `,
          el('a', { href: REPO_URL, target: '_blank', rel: 'noopener', text: 'GitHub' }),
        ),
      ),
    ),
  );
}
