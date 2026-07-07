// ゲーム一覧画面: 検索（ひらがな・番号対応）＋カテゴリフィルタ＋グリッド
import type { Category, GameMeta } from '../game-api/types';
import { el } from '../platform/dom';
import { activeGames } from '../games/index';
import { bestMedalOf, isFavorite } from '../platform/progress';
import { getDoc } from '../platform/storage';
import { gameIconTile, isNewGame } from './ui';
import { openGameDetail } from './game-detail';
import { CATEGORY_LABEL, t } from './strings';

type Filter = 'all' | 'fav' | 'new' | 'short' | Category;
type Sort = 'no' | 'new' | 'name' | 'plays';

// 画面を離れても検索条件を保持する（セッション内）
let query = '';
let filter: Filter = 'all';
let sort: Sort = 'no';

/** バージョン比較（新しい方が先）。文字列比較だと '0.10.0' < '0.9.0' になるため数値で比較する */
function cmpVersionDesc(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pb[i] ?? 0) - (pa[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** 全角英数→半角・カタカナ→ひらがな・小文字化（検索用の正規化） */
function normalize(s: string): string {
  return s
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .toLowerCase()
    .replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60))
    .trim();
}

function matches(g: GameMeta, nq: string): boolean {
  if (!nq) return true;
  // 数字だけのクエリはまず収録番号と照合し、外れても通常の部分一致へ進む
  // （「2048」のような数字タイトルのゲームを将来収録しても検索できるように）
  if (/^\d+$/.test(nq) && g.no === Number(nq)) return true;
  return normalize(g.title).includes(nq) || normalize(g.kana).includes(nq) || g.id.includes(nq);
}

function applyFilter(list: GameMeta[]): GameMeta[] {
  const doc = getDoc();
  let out = list;
  switch (filter) {
    case 'all':
      break;
    case 'fav':
      out = out.filter((g) => isFavorite(g.id));
      break;
    case 'new':
      out = out.filter(isNewGame);
      break;
    case 'short':
      out = out.filter((g) => g.timeToPlay === 'short');
      break;
    default:
      out = out.filter((g) => g.category === filter);
  }
  const nq = normalize(query);
  out = out.filter((g) => matches(g, nq));
  switch (sort) {
    case 'no':
      out = [...out].sort((a, b) => a.no - b.no);
      break;
    case 'new':
      out = [...out].sort((a, b) => cmpVersionDesc(a.addedIn, b.addedIn) || a.no - b.no);
      break;
    case 'name':
      out = [...out].sort((a, b) => a.kana.localeCompare(b.kana, 'ja'));
      break;
    case 'plays':
      out = [...out].sort((a, b) => (doc.games[b.id]?.plays ?? 0) - (doc.games[a.id]?.plays ?? 0));
      break;
  }
  return out;
}

function gameCard(meta: GameMeta, onChanged: () => void): HTMLElement {
  const medal = bestMedalOf(meta);
  const played = (getDoc().games[meta.id]?.plays ?? 0) > 0;
  return el(
    'button',
    {
      class: 'game-card' + (medal ? ` m-${medal}` : '') + (played ? '' : ' not-played'),
      // 詳細シートでお気に入りを切り替えたら、背後の一覧（⭐バッジ・絞り込み）にも反映する
      onclick: () => openGameDetail(meta, { onChange: onChanged }),
    },
    el('span', { class: 'game-no', text: String(meta.no).padStart(3, '0') }),
    isNewGame(meta) ? el('span', { class: 'badge-new', text: 'NEW' }) : null,
    isFavorite(meta.id) ? el('span', { class: 'badge-fav', text: '⭐' }) : null,
    gameIconTile(meta, 'md'),
    el('div', { class: 'game-title', text: meta.title }),
  );
}

export function renderGames(container: HTMLElement): void {
  const all = activeGames();

  // 検索バー
  const search = el('input', {
    class: 'search-input',
    type: 'search',
    placeholder: t.games.searchPlaceholder,
    enterkeyhint: 'search',
    value: query,
  });

  // フィルタチップ
  const filters: { key: Filter; label: string }[] = [
    { key: 'all', label: t.games.all },
    { key: 'fav', label: t.games.fav },
    { key: 'new', label: t.games.new },
    { key: 'short', label: t.games.short },
    ...(Object.keys(CATEGORY_LABEL) as Category[]).map((c) => ({ key: c as Filter, label: CATEGORY_LABEL[c] })),
  ];
  const chipRow = el('div', { class: 'chip-row' });

  // ソート
  const sortSel = el('select', { class: 'sort-select', 'aria-label': 'ならびかえ' });
  const sorts: { key: Sort; label: string }[] = [
    { key: 'no', label: t.games.sortNo },
    { key: 'new', label: t.games.sortNew },
    { key: 'name', label: t.games.sortName },
    { key: 'plays', label: t.games.sortPlays },
  ];
  for (const s of sorts) {
    const o = el('option', { value: s.key, text: s.label });
    if (s.key === sort) o.selected = true;
    sortSel.appendChild(o);
  }

  const grid = el('div', { class: 'game-grid' });
  const countLine = el('div', { class: 'games-count' });

  const renderGrid = (): void => {
    const list = applyFilter(all);
    grid.replaceChildren(...list.map((g) => gameCard(g, renderGrid)));
    if (all.length === 0) {
      grid.replaceChildren(el('div', { class: 'games-empty pre-line', text: t.games.empty }));
      countLine.textContent = '';
    } else if (list.length === 0) {
      grid.replaceChildren(el('div', { class: 'games-empty', text: t.games.notFound }));
      countLine.textContent = '';
    } else {
      countLine.textContent = `${list.length} こ`;
    }
  };

  const renderChips = (): void => {
    chipRow.replaceChildren(
      ...filters.map((f) =>
        el('button', {
          class: 'chip' + (filter === f.key ? ' active' : ''),
          text: f.label,
          onclick: () => {
            filter = f.key;
            renderChips();
            renderGrid();
          },
        }),
      ),
    );
  };

  search.addEventListener('input', () => {
    query = search.value;
    renderGrid();
  });
  sortSel.addEventListener('change', () => {
    sort = sortSel.value as Sort;
    renderGrid();
  });

  renderChips();
  renderGrid();

  container.append(
    el('div', { class: 'games-toolbar' }, search, sortSel),
    chipRow,
    countLine,
    grid,
  );
}
