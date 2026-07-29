// きろく画面: プレイヤーレベル・10×10スタンプ台紙・実績・統計
import type { GameMeta } from '../game-api/types';
import { el } from '../platform/dom';
import { activeGames, bonusGames, bonusUnlocked, mainGames } from '../games/index';
import {
  GLOBAL_ACHIEVEMENTS,
  MEDAL_LABEL,
  bestMedalOf,
  currentStreak,
  currentTitle,
  isUnlocked,
  levelInfo,
  medalCounts,
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

  const title = currentTitle();
  return el(
    'div',
    { class: 'level-card card' },
    el(
      'div',
      { class: 'level-main' },
      el('div', { class: 'level-num' }, el('span', { class: 'level-lv', text: 'Lv.' }), el('span', { class: 'level-val', text: String(lv.level) })),
      el('div', { class: 'level-xp', text: `${lv.into} / ${lv.need} XP` }),
    ),
    el(
      'div',
      { class: 'level-title' },
      el('span', { class: 'level-title-name', text: `🎖 ${title.name}` }),
      title.next ? el('span', { class: 'level-title-next', text: `つぎ: ${title.next.name}（${title.next.hint}）` }) : null,
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
    const medal = bestMedalOf(g);
    const cell = el('button', {
      class: 'stamp-cell' + (played ? ' played' : ' unplayed') + (medal ? ` ${medal}` : ''),
      text: g.icon.emoji,
      'aria-label': `No.${no} ${g.title}${medal ? ` ${MEDAL_LABEL[medal]}` : ''}`,
      onclick: () => openGameDetail(g),
    });
    board.appendChild(cell);
  }
  return board;
}

/**
 * かくれゲームの台紙（5×6＝30マス想定）。本編の10×10とは別に並べる。
 * まだ30本そろっていない間は、残りを空きマスで埋めて枠の形を保つ。
 */
function bonusBoard(list: GameMeta[]): HTMLElement {
  const doc = getDoc();
  const board = el('div', { class: 'stamp-board bonus-board' });
  const slots = Math.max(30, Math.ceil(list.length / 5) * 5);
  for (let i = 0; i < slots; i++) {
    const g = list[i];
    if (!g) {
      board.appendChild(el('div', { class: 'stamp-cell empty', text: '?' }));
      continue;
    }
    const played = (doc.games[g.id]?.plays ?? 0) > 0;
    const medal = bestMedalOf(g);
    board.appendChild(
      el('button', {
        class: 'stamp-cell' + (played ? ' played' : ' unplayed') + (medal ? ` ${medal}` : ''),
        text: g.icon.emoji,
        'aria-label': `${g.title}${medal ? ` ${MEDAL_LABEL[medal]}` : ''}`,
        onclick: () => openGameDetail(g),
      }),
    );
  }
  return board;
}

/** 台紙の集計（あそんだ数とメダルの内訳）＋「まだのマスを光らせる」切り替え */
function stampSummary(list: GameMeta[], board: HTMLElement): HTMLElement {
  const doc = getDoc();
  const played = list.filter((g) => (doc.games[g.id]?.plays ?? 0) > 0).length;
  const c = medalCounts(list);
  // あそんだ数は見出し（スタンプだいし（◯/100））に出ているので、ここではメダルの内訳だけ見せる
  const box = el(
    'div',
    { class: 'stamp-summary' },
    el('span', { text: 'あつめたメダル' }),
    el('span', { class: 'stamp-medals', text: `🥇${c.gold} 🥈${c.silver} 🥉${c.bronze}` }),
  );
  // 「まだのマス」を光らせる切り替え。1つも遊んでいない／全部遊んだ状態では
  // 光らせても意味がない（全点灯・全消灯になるだけ）ので出さない
  if (played > 0 && played < list.length) {
    const toggle = el('button', {
      class: 'chip',
      text: '💡 まだのマス',
      'aria-pressed': 'false',
      onclick: () => {
        const on = board.classList.toggle('highlight-todo');
        toggle.setAttribute('aria-pressed', String(on));
        toggle.classList.toggle('active', on);
      },
    });
    box.appendChild(toggle);
  }
  return box;
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

// 実績グループの開閉状態（セッション中だけ記憶。保存データには入れない＝再起動で全部とじるに戻る）
const openAchGroups = new Set<string>();

/** グループ見出しの進捗「n/m」。全解除は金色＋👑でコンプが一目でわかる */
function achProgress(unlocked: number, total: number): HTMLElement {
  const comp = total > 0 && unlocked >= total;
  return el('span', {
    class: 'ach-prog' + (comp ? ' ach-comp' : ''),
    text: comp ? `👑 ${unlocked}/${total}` : `${unlocked}/${total}`,
  });
}

/**
 * 折りたたみ実績グループ（ネイティブ details/summary）。
 * 中身の実績行は「はじめて開いたとき」に生成する＝100ゲーム時代でも初期描画は1グループ1行。
 */
function achGroup(key: string, summaryParts: HTMLElement[], buildRows: () => HTMLElement[]): HTMLElement {
  const details = el('details', { class: 'ach-group' }) as HTMLDetailsElement;
  const body = el('div', { class: 'ach-body' });
  let built = false;
  const populate = (): void => {
    if (built) return;
    built = true;
    for (const row of buildRows()) body.appendChild(row);
  };
  details.append(
    el('summary', { class: 'ach-sum' }, ...summaryParts, el('span', { class: 'ach-chev', text: '▸', 'aria-hidden': 'true' })),
    body,
  );
  if (openAchGroups.has(key)) {
    populate();
    details.open = true;
  }
  details.addEventListener('toggle', () => {
    if (details.open) {
      populate();
      openAchGroups.add(key);
    } else {
      openAchGroups.delete(key);
    }
  });
  return details;
}

export function renderRecords(container: HTMLElement): void {
  const list = activeGames();
  const doc = getDoc();
  // 台紙は本編（No.1〜100）だけを対象にする。かくれゲームと検証用ゲームは別枠
  const main = mainGames();

  container.appendChild(levelCard());

  // スタンプ台紙（本編100マス）
  const played = main.filter((g) => (doc.games[g.id]?.plays ?? 0) > 0).length;
  container.appendChild(sectionTitle(`📖 ${t.records.stampTitle}（${played} / 100）`));
  container.appendChild(el('p', { class: 'stamp-note', text: t.records.stampNote }));
  const board = stampBoard(main);
  container.appendChild(stampSummary(main, board));
  container.appendChild(board);
  // 100マスすべてあそんだ人へのごほうび表示。
  // ※ 判定は bonusUnlocked() と同じ「いま遊べる本編ぜんぶ」基準にする（100 決め打ちにすると、
  //   あとで1本 retired にしたとき この お祝いが 永久に出なくなる）
  if (main.length > 0 && played >= main.length) {
    const gold = medalCounts(main).gold;
    container.appendChild(
      el(
        'div',
        { class: 'stamp-complete card' },
        el('div', { class: 'stamp-complete-emoji', text: '🎉' }),
        el('div', { class: 'stamp-complete-title', text: t.records.stampComplete }),
        el('div', { class: 'stamp-complete-note', text: `100マスぜんぶに スタンプがそろいました！ 金メダルは ${gold} / ${main.length}` }),
      ),
    );
  }

  // かくれゲームの台紙（解放後だけ・本編とは別の台紙にする）
  const bonus = bonusGames();
  if (bonusUnlocked() && bonus.length > 0) {
    const bPlayed = bonus.filter((g) => (doc.games[g.id]?.plays ?? 0) > 0).length;
    const bc = medalCounts(bonus);
    container.appendChild(sectionTitle(`🔓 ${t.records.bonusTitle}（${bPlayed} / ${bonus.length}）`));
    container.appendChild(el('p', { class: 'stamp-note', text: t.records.bonusNote }));
    container.appendChild(
      el(
        'div',
        { class: 'stamp-summary' },
        el('span', { text: 'あつめたメダル' }),
        el('span', { class: 'stamp-medals', text: `🥇${bc.gold} 🥈${bc.silver} 🥉${bc.bronze}` }),
      ),
    );
    const bBoard = bonusBoard(bonus);
    // 30本ぜんぶ あそんだら 台紙を 金色に して お祝いを 出す（30本そろって はじめて 意味を持つ）
    const bAllPlayed = bPlayed >= bonus.length;
    if (bAllPlayed) bBoard.classList.add('bonus-complete');
    container.appendChild(bBoard);
    if (bAllPlayed) {
      const allGold = bc.gold >= bonus.length;
      container.appendChild(
        el(
          'div',
          { class: 'stamp-complete bonus-complete-card card' },
          el('div', { class: 'stamp-complete-emoji', text: allGold ? '👑' : '🎊' }),
          el('div', {
            class: 'stamp-complete-title',
            text: allGold ? t.records.bonusMaster : t.records.bonusComplete,
          }),
          el('div', {
            class: 'stamp-complete-note',
            text: allGold
              ? `かくれゲーム ${bonus.length}本 ぜんぶ 金メダル！ ぜんぶで ${bonus.length + 100}本 やりきりました`
              : `かくれゲーム ${bonus.length}本 ぜんぶ あそびました！ 金メダルは ${bc.gold} / ${bonus.length}`,
          }),
        ),
      );
    }
  }

  // 実績
  const gameAchTotal = list.reduce((n, g) => n + g.achievements.length, 0);
  const gameAchUnlocked = list.reduce(
    (n, g) => n + g.achievements.filter((a) => isUnlocked(`${g.id}/${a.id}`)).length,
    0,
  );
  const globalUnlocked = GLOBAL_ACHIEVEMENTS.filter((a) => isUnlocked(`global/${a.id}`)).length;

  // 見出し行＝タイトル＋「すべてひらく／とじる」（ゲームが増えても1タップで全体を見渡せる）
  const toggleAllBtn = el('button', { class: 'ach-toggle-all', type: 'button' }) as HTMLButtonElement;
  container.appendChild(
    el(
      'div',
      { class: 'section-row' },
      sectionTitle(
        `🏆 ${t.records.achievements}（${globalUnlocked + gameAchUnlocked} / ${GLOBAL_ACHIEVEMENTS.length + gameAchTotal}）`,
      ),
      toggleAllBtn,
    ),
  );

  // ゲームごとの折りたたみリスト（既定はすべてとじる。開いた場所はセッション中だけ記憶）
  const achBox = el('div', { class: 'card ach-list' });
  achBox.appendChild(
    achGroup(
      'global',
      [
        el('span', { class: 'ach-sum-emoji', text: '🌏' }),
        el('span', { class: 'ach-sum-title', text: t.records.globalSection }),
        achProgress(globalUnlocked, GLOBAL_ACHIEVEMENTS.length),
      ],
      () =>
        GLOBAL_ACHIEVEMENTS.map((a) =>
          achRow({ name: a.name, desc: a.desc, secret: a.secret, unlocked: isUnlocked(`global/${a.id}`) }),
        ),
    ),
  );
  for (const g of list) {
    if (g.achievements.length === 0) continue;
    const unlocked = g.achievements.filter((a) => isUnlocked(`${g.id}/${a.id}`)).length;
    achBox.appendChild(
      achGroup(
        g.id,
        [gameIconTile(g, 'sm'), el('span', { class: 'ach-sum-title', text: g.title }), achProgress(unlocked, g.achievements.length)],
        () =>
          g.achievements.map((a) =>
            achRow({ name: a.name, desc: a.desc, secret: a.secret, unlocked: isUnlocked(`${g.id}/${a.id}`) }),
          ),
      ),
    );
  }
  container.appendChild(achBox);

  // すべてひらく／とじる（1つでも閉じていれば「ひらく」動作）
  const allGroups = (): HTMLDetailsElement[] => Array.from(achBox.querySelectorAll('details.ach-group'));
  const refreshToggleAll = (): void => {
    const anyClosed = allGroups().some((d) => !d.open);
    toggleAllBtn.textContent = anyClosed ? `▾ ${t.records.openAll}` : `▴ ${t.records.closeAll}`;
  };
  toggleAllBtn.addEventListener('click', () => {
    const anyClosed = allGroups().some((d) => !d.open);
    for (const d of allGroups()) d.open = anyClosed;
    refreshToggleAll();
  });
  // 個別の開閉にもラベルを追従させる（toggle はバブリングしないため capture で拾う）
  achBox.addEventListener('toggle', () => refreshToggleAll(), true);
  refreshToggleAll();
}
