// ホーム画面: 今日のゲーム・ランダム・最近あそんだ・新着・スタンプ進捗
import { el } from '../platform/dom';
import { activeGames } from '../games/index';
import { dailyGame, recentGames, currentLevel } from '../platform/progress';
import { getDoc } from '../platform/storage';
import { isStandalone, detectPlatform } from '../platform/env';
import { navigate } from '../platform/router';
import { bottomSheet, gameIconTile, isNewGame, sectionTitle } from './ui';
import { openGameDetail } from './game-detail';
import { openGamePlay } from './nav';
import { renderInstallGuide } from './landing';
import { APP_NAME, t } from './strings';

function miniCard(meta: Parameters<typeof gameIconTile>[0]): HTMLElement {
  const card = el(
    'button',
    { class: 'mini-card', onclick: () => openGameDetail(meta) },
    gameIconTile(meta, 'md'),
    el('div', { class: 'mini-title', text: meta.title }),
  );
  return card;
}

export function renderHome(container: HTMLElement): void {
  const list = activeGames();
  const doc = getDoc();

  // ヘッダー
  container.appendChild(
    el(
      'div',
      { class: 'home-head' },
      el('img', { class: 'home-logo', src: import.meta.env.BASE_URL + 'icons/icon-192.png', alt: '' }),
      el('h1', { class: 'home-title', text: APP_NAME }),
      el('span', { class: 'level-chip', text: `Lv.${currentLevel()}` }),
    ),
  );

  // インストール誘導（ブラウザモードのモバイルのみ）
  if (!isStandalone() && detectPlatform() !== 'desktop') {
    container.appendChild(
      el(
        'button',
        {
          class: 'install-hint',
          onclick: () =>
            bottomSheet((close) =>
              el(
                'div',
                { class: 'info-sheet' },
                el('h2', { class: 'sheet-title', text: '📲 ホーム画面に追加' }),
                renderInstallGuide(),
                el('button', { class: 'btn btn-primary btn-large', text: 'とじる', onclick: close }),
              ),
            ),
        },
        '📲 ホーム画面に追加すると、全画面＆オフラインでもっと快適！ ',
        el('span', { class: 'install-hint-link', text: 'ほうほうを見る ›' }),
      ),
    );
  }

  // 今日のゲーム
  const daily = dailyGame();
  if (daily) {
    container.appendChild(sectionTitle(`☀️ ${t.home.daily}`));
    container.appendChild(
      el(
        'button',
        { class: 'daily-card', onclick: () => openGamePlay(daily.id) },
        gameIconTile(daily, 'lg'),
        el(
          'div',
          { class: 'daily-text' },
          el('div', { class: 'daily-title', text: daily.title }),
          el('div', { class: 'daily-desc', text: daily.description }),
          el('div', { class: 'daily-note', text: t.home.dailyNote }),
        ),
        el('div', { class: 'daily-play', text: '▶' }),
      ),
    );
    const randomBtn = el('button', {
      class: 'btn random-btn',
      text: t.home.random,
      onclick: () => {
        const g = list[Math.floor(Math.random() * list.length)];
        if (g) openGamePlay(g.id);
      },
    });
    container.appendChild(randomBtn);
  } else {
    // ゲーム0個のとき（リリース直後）の案内
    container.appendChild(
      el(
        'div',
        { class: 'coming-soon card' },
        el('div', { class: 'coming-ico', text: '🚧' }),
        el('h2', { text: t.home.comingSoonTitle }),
        el('p', { text: t.home.comingSoonBody }),
        el('div', { class: 'coming-slots', text: '0 / 100' }),
      ),
    );
  }

  // 最近あそんだ
  const recent = recentGames();
  if (recent.length > 0) {
    container.appendChild(sectionTitle(`🕘 ${t.home.recent}`));
    container.appendChild(el('div', { class: 'h-scroll' }, ...recent.map(miniCard)));
  }

  // 新着（今のバージョンで追加されたゲーム）
  const fresh = list.filter(isNewGame);
  if (fresh.length > 0) {
    container.appendChild(sectionTitle(`🆕 ${t.home.newGames}`));
    container.appendChild(el('div', { class: 'h-scroll' }, ...fresh.map(miniCard)));
  }

  // スタンプ進捗
  const played = list.filter((g) => (doc.games[g.id]?.plays ?? 0) > 0).length;
  const bar = el('div', { class: 'xp-bar' }, el('div', { class: 'xp-fill' }));
  (bar.firstElementChild as HTMLElement).style.width = `${played}%`;
  container.appendChild(sectionTitle(`📖 ${t.home.progress}`));
  container.appendChild(
    el(
      'button',
      { class: 'progress-card card', onclick: () => navigate('#/records', { replace: true }) },
      el('div', { class: 'progress-nums' }, el('strong', { text: String(played) }), el('span', { text: ' / 100' })),
      bar,
      el('div', { class: 'progress-note', text: `こうかい中: ${list.length}こ ・ スタンプだいしを見る ›` }),
    ),
  );
}
