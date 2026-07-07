// ゲーム詳細のボトムシート（説明・自己ベスト・メダル・実績・あそぶ）
import type { GameMeta } from '../game-api/types';
import { el } from '../platform/dom';
import {
  MEDAL_EMOJI,
  bestMedalOf,
  formatScore,
  isFavorite,
  isUnlocked,
  toggleFavorite,
} from '../platform/progress';
import { getDoc } from '../platform/storage';
import { bottomSheet, gameIconTile } from './ui';
import { CATEGORY_LABEL, TIME_LABEL, t } from './strings';
import { openGamePlay } from './nav';

export function openGameDetail(meta: GameMeta, opts?: { onChange?: () => void }): void {
  bottomSheet((close) => {
    const rec = getDoc().games[meta.id];
    const box = el('div', { class: 'detail' });

    // ヘッダー
    box.appendChild(
      el(
        'div',
        { class: 'detail-head' },
        gameIconTile(meta, 'lg'),
        el(
          'div',
          { class: 'detail-head-text' },
          el('div', { class: 'detail-no', text: `No.${String(meta.no).padStart(3, '0')}` }),
          el('h2', { class: 'detail-title', text: meta.title }),
          el(
            'div',
            { class: 'detail-chips' },
            el('span', { class: 'chip chip-static', text: CATEGORY_LABEL[meta.category] }),
            meta.timeToPlay ? el('span', { class: 'chip chip-static', text: `⏱ ${TIME_LABEL[meta.timeToPlay]}` }) : null,
            meta.orientation !== 'any'
              ? el('span', { class: 'chip chip-static', text: meta.orientation === 'portrait' ? '📱たて' : '📱よこ' })
              : null,
            meta.sensors?.length || meta.optionalSensors?.length
              ? el('span', { class: 'chip chip-static', text: '📡センサー' })
              : null,
          ),
        ),
      ),
    );

    box.appendChild(el('p', { class: 'detail-desc', text: meta.description }));

    // 記録
    const stats = el('div', { class: 'detail-stats card' });
    if (meta.scoring !== 'none') {
      stats.appendChild(
        el(
          'div',
          { class: 'stat-line' },
          el('span', { text: 'じこベスト' }),
          el('strong', { text: rec?.best != null ? formatScore(meta.scoring, rec.best) : '—' }),
        ),
      );
    }
    stats.appendChild(
      el(
        'div',
        { class: 'stat-line' },
        el('span', { text: 'あそんだ回数' }),
        el('strong', { text: `${rec?.plays ?? 0} 回` }),
      ),
    );
    if (meta.medals && meta.scoring !== 'none') {
      const got = bestMedalOf(meta);
      const gotRank = got === 'gold' ? 3 : got === 'silver' ? 2 : got === 'bronze' ? 1 : 0;
      const medalLine = el('div', { class: 'medal-targets' });
      ([
        ['bronze', meta.medals.bronze, 1],
        ['silver', meta.medals.silver, 2],
        ['gold', meta.medals.gold, 3],
      ] as const).forEach(([m, v, rank]) => {
        medalLine.appendChild(
          el('span', {
            class: 'medal-target' + (gotRank >= rank ? ' achieved' : ''),
            text: `${MEDAL_EMOJI[m]} ${formatScore(meta.scoring, v)}`,
          }),
        );
      });
      stats.appendChild(medalLine);
    }
    box.appendChild(stats);

    // 実績
    if (meta.achievements.length > 0) {
      const achBox = el('div', { class: 'detail-ach card' });
      const unlockedCount = meta.achievements.filter((a) => isUnlocked(`${meta.id}/${a.id}`)).length;
      achBox.appendChild(
        el('div', { class: 'detail-ach-head', text: `🏆 じっせき（${unlockedCount} / ${meta.achievements.length}）` }),
      );
      for (const a of meta.achievements) {
        const unlocked = isUnlocked(`${meta.id}/${a.id}`);
        const hidden = a.secret && !unlocked;
        achBox.appendChild(
          el(
            'div',
            { class: 'ach-row' + (unlocked ? '' : ' ach-locked') },
            el('span', { class: 'ach-ico', text: unlocked ? '🏆' : '🔒' }),
            el(
              'div',
              null,
              el('div', { class: 'ach-name', text: hidden ? t.records.secretName : a.name }),
              el('div', { class: 'ach-desc', text: hidden ? t.records.secretDesc : a.desc }),
            ),
          ),
        );
      }
      box.appendChild(achBox);
    }

    // ボタン
    const favBtn = el('button', { class: 'btn', text: isFavorite(meta.id) ? '⭐ お気に入り解除' : '☆ お気に入り' });
    favBtn.addEventListener('click', () => {
      const on = toggleFavorite(meta.id);
      favBtn.textContent = on ? '⭐ お気に入り解除' : '☆ お気に入り';
      opts?.onChange?.(); // 呼び出し元の画面（一覧の⭐バッジ等）を更新させる
    });
    const playBtn = el('button', {
      class: 'btn btn-primary btn-large',
      text: `${t.common.play} ▶`,
      // 履歴巻き取り完了後に遷移する（close直後にhashを変えると競合するため）
      onclick: () => close(() => openGamePlay(meta.id)),
    });
    box.appendChild(el('div', { class: 'detail-actions' }, favBtn, playBtn));

    return box;
  });
}
