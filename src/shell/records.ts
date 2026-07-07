// きろく画面: プレイヤーレベル・10×10スタンプ台紙・実績・統計
import type { GameMeta } from '../game-api/types';
import { el } from '../platform/dom';
import { activeGames } from '../games/index';
import {
  GLOBAL_ACHIEVEMENTS,
  bestMedalOf,
  currentStreak,
  isUnlocked,
  levelInfo,
} from '../platform/progress';
import { getDoc } from '../platform/storage';
import { gameIconTile, sectionTitle } from './ui';
import { openGameDetail } from './game-detail';
import { t } from './strings';

function fmtDuration(ms: number): string {
  const min = Math.floor(ms / 60000);
  if (min < 60) return `${min} 分`;
  return `${Math.floor(min / 60)} 時間 ${min % 60} 分`;
}

function levelCard(): HTMLElement {
  const doc = getDoc();
  const lv = levelInfo(doc.profile.xp);
  const bar = el('div', { class: 'xp-bar' }, el('div', { class: 'xp-fill' }));
  (bar.firstElementChild as HTMLElement).style.width = `${Math.min(100, Math.round((lv.into / lv.need) * 100))}%`;

  return el(
    'div',
    { class: 'level-card card' },
    el(
      'div',
      { class: 'level-main' },
      el('div', { class: 'level-num' }, el('span', { class: 'level-lv', text: 'Lv.' }), el('span', { class: 'level-val', text: String(lv.level) })),
      el('div', { class: 'level-xp', text: `${lv.into} / ${lv.need} XP` }),
    ),
    bar,
    el(
      'div',
      { class: 'level-stats' },
      el('div', null, el('strong', { text: String(doc.profile.totalPlays) }), el('span', { text: ` 回` }), el('div', { class: 'setting-note', text: t.records.totalPlays })),
      el('div', null, el('strong', { text: `🔥 ${currentStreak()}` }), el('span', { text: ' 日' }), el('div', { class: 'setting-note', text: t.records.streak })),
      el('div', null, el('strong', { text: fmtDuration(doc.profile.totalTimeMs) }), el('div', { class: 'setting-note', text: t.records.totalTime })),
    ),
  );
}

function stampBoard(list: GameMeta[]): HTMLElement {
  const doc = getDoc();
  const byNo = new Map(list.map((g) => [g.no, g] as const));
  const board = el('div', { class: 'stamp-board' });
  for (let no = 1; no <= 100; no++) {
    const g = byNo.get(no);
    if (!g) {
      board.appendChild(el('div', { class: 'stamp-cell empty', text: String(no) }));
      continue;
    }
    const played = (doc.games[g.id]?.plays ?? 0) > 0;
    const gold = bestMedalOf(g) === 'gold';
    const cell = el('button', {
      class: 'stamp-cell' + (played ? ' played' : ' unplayed') + (gold ? ' gold' : ''),
      text: g.icon.emoji,
      'aria-label': `No.${no} ${g.title}`,
      onclick: () => openGameDetail(g),
    });
    board.appendChild(cell);
  }
  return board;
}

function achRow(opts: { name: string; desc: string; unlocked: boolean; secret?: boolean }): HTMLElement {
  const hidden = opts.secret && !opts.unlocked;
  return el(
    'div',
    { class: 'ach-row' + (opts.unlocked ? '' : ' ach-locked') },
    el('span', { class: 'ach-ico', text: opts.unlocked ? '🏆' : '🔒' }),
    el(
      'div',
      null,
      el('div', { class: 'ach-name', text: hidden ? t.records.secretName : opts.name }),
      el('div', { class: 'ach-desc', text: hidden ? t.records.secretDesc : opts.desc }),
    ),
  );
}

export function renderRecords(container: HTMLElement): void {
  const list = activeGames();
  const doc = getDoc();

  container.appendChild(levelCard());

  // スタンプ台紙
  const played = list.filter((g) => (doc.games[g.id]?.plays ?? 0) > 0).length;
  container.appendChild(sectionTitle(`📖 ${t.records.stampTitle}（${played} / 100）`));
  container.appendChild(el('p', { class: 'stamp-note', text: t.records.stampNote }));
  container.appendChild(stampBoard(list));

  // 実績
  const gameAchTotal = list.reduce((n, g) => n + g.achievements.length, 0);
  const gameAchUnlocked = list.reduce(
    (n, g) => n + g.achievements.filter((a) => isUnlocked(`${g.id}/${a.id}`)).length,
    0,
  );
  const globalUnlocked = GLOBAL_ACHIEVEMENTS.filter((a) => isUnlocked(`global/${a.id}`)).length;
  container.appendChild(
    sectionTitle(
      `🏆 ${t.records.achievements}（${globalUnlocked + gameAchUnlocked} / ${GLOBAL_ACHIEVEMENTS.length + gameAchTotal}）`,
    ),
  );

  const achBox = el('div', { class: 'card ach-list' });
  achBox.appendChild(el('div', { class: 'ach-group-title', text: `🌏 ${t.records.globalSection}` }));
  for (const a of GLOBAL_ACHIEVEMENTS) {
    achBox.appendChild(achRow({ name: a.name, desc: a.desc, secret: a.secret, unlocked: isUnlocked(`global/${a.id}`) }));
  }
  for (const g of list) {
    if (g.achievements.length === 0) continue;
    achBox.appendChild(el('div', { class: 'ach-group-title' }, gameIconTile(g, 'sm'), el('span', { text: g.title })));
    for (const a of g.achievements) {
      achBox.appendChild(achRow({ name: a.name, desc: a.desc, secret: a.secret, unlocked: isUnlocked(`${g.id}/${a.id}`) }));
    }
  }
  container.appendChild(achBox);
}
