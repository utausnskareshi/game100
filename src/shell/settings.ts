// せってい画面: 音・バイブ・テーマ・データ管理・アプリ情報・メンテナンス
import { el } from '../platform/dom';
import { applyTheme, settings } from '../platform/settings';
import { hapticsSupported, haptic } from '../platform/haptics';
import { playSfx, unlockAudio } from '../platform/audio';
import { exportJson, importJson, resetAll } from '../platform/storage';
import { todayKey } from '../platform/rng';
import { grantAchievementXp, unlockGlobalAchievement } from '../platform/progress';
import { offlineReadyStored, repairCaches } from '../platform/pwa';
import { bottomSheet, buttonRow, confirmDialog, infoSheet, sectionTitle, segRow, toast, toggleRow } from './ui';
import { renderInstallGuide } from './landing';
import { CHANGELOG } from './changelog';
import { REPO_URL, t } from './strings';

function openExportSheet(): void {
  // 隠し実績はエクスポートJSONを作る前に解除する（バックアップ自身に含めるため）
  const unlocked = unlockGlobalAchievement('backup');
  if (unlocked) {
    grantAchievementXp();
    toast(`🏆 実績解除：${unlocked.name}`);
  }
  const json = exportJson();
  bottomSheet((close) => {
    const ta = el('textarea', { class: 'data-textarea', readonly: true }) as HTMLTextAreaElement;
    ta.value = json;
    const copyBtn = el('button', {
      class: 'btn btn-primary',
      text: '📋 コピーする',
      onclick: () => {
        void navigator.clipboard
          ?.writeText(json)
          .then(() => toast('コピーしました。メモアプリなどに貼り付けて保存してね'))
          .catch(() => {
            ta.select();
            toast('全選択しました。手動でコピーしてください');
          });
      },
    });
    const dlBtn = el('button', {
      class: 'btn',
      text: '💾 ファイルに保存',
      onclick: () => {
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        // ファイル名の日付はローカル時刻基準（toISOStringだと日本の朝9時前は前日になってしまう）
        const a = el('a', { href: url, download: `game100-backup-${todayKey()}.json` });
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
      },
    });

    return el(
      'div',
      { class: 'info-sheet' },
      el('h2', { class: 'sheet-title', text: '💾 バックアップ' }),
      el('p', { class: 'setting-note pre-line', text: 'この文字データがあなたの全記録です。\n機種変更やアプリの入れ直しのときは、これを新しい環境で「データの読み込み」に貼り付けてください。' }),
      ta,
      el('div', { class: 'detail-actions' }, dlBtn, copyBtn),
      el('button', { class: 'btn btn-ghost', text: t.common.close, onclick: close }),
    );
  });
}

function openImportSheet(): void {
  bottomSheet((close) => {
    const ta = el('textarea', { class: 'data-textarea', placeholder: 'ここにバックアップデータを貼り付け' }) as HTMLTextAreaElement;
    const file = el('input', { type: 'file', accept: '.json,application/json', class: 'file-input' }) as HTMLInputElement;
    file.addEventListener('change', () => {
      const f = file.files?.[0];
      if (!f) return;
      void f.text().then((txt) => {
        ta.value = txt;
      });
    });
    const importBtn = el('button', {
      class: 'btn btn-primary',
      text: '読み込む',
      onclick: () => {
        const text = ta.value.trim();
        if (!text) {
          toast('データを貼り付けてください');
          return;
        }
        void confirmDialog({
          title: 'データの読み込み',
          message: '現在の記録はすべて上書きされます。よろしいですか？',
          okLabel: '上書きする',
          danger: true,
        }).then((ok) => {
          if (!ok) return;
          const r = importJson(text);
          if (r.ok) {
            close();
            toast('読み込みました！');
            setTimeout(() => location.reload(), 600);
          } else {
            toast(`❌ ${r.error}`);
          }
        });
      },
    });
    return el(
      'div',
      { class: 'info-sheet' },
      el('h2', { class: 'sheet-title', text: '📥 データの読み込み' }),
      el('p', { class: 'setting-note', text: 'バックアップした文字データを貼り付けるか、ファイルを選んでください。' }),
      ta,
      file,
      el('div', { class: 'detail-actions' }, el('button', { class: 'btn btn-ghost', text: t.common.cancel, onclick: close }), importBtn),
    );
  });
}

function openWhatsNew(): void {
  const body = el('div', { class: 'whatsnew' });
  for (const c of CHANGELOG) {
    body.appendChild(
      el(
        'div',
        { class: 'whatsnew-entry' },
        el('div', { class: 'whatsnew-ver', text: `v${c.version}` }, el('span', { class: 'whatsnew-date', text: `（${c.date}）` })),
        el('ul', null, ...c.notes.map((n) => el('li', { text: n }))),
      ),
    );
  }
  infoSheet("📣 更新履歴", body);
}

export function renderSettings(container: HTMLElement): void {
  // サウンド・バイブ
  container.appendChild(sectionTitle('🔊 サウンド・バイブ'));
  const soundHapticsCard = el('div', { class: 'card settings-card' });
  soundHapticsCard.appendChild(
    toggleRow(
      t.settings.sound,
      () => settings.get().sound,
      (v) => {
        settings.update({ sound: v });
        if (v) {
          unlockAudio();
          playSfx('success');
        }
      },
    ),
  );
  soundHapticsCard.appendChild(
    hapticsSupported()
      ? toggleRow(
          t.settings.haptics,
          () => settings.get().haptics,
          (v) => {
            settings.update({ haptics: v });
            if (v) haptic('success');
          },
        )
      : toggleRow(t.settings.haptics, () => false, () => undefined, t.settings.hapticsUnsupported, { disabled: true }),
  );
  container.appendChild(soundHapticsCard);

  // テーマ
  container.appendChild(sectionTitle('🎨 みため'));
  const themeCard = el('div', { class: 'card settings-card' });
  themeCard.appendChild(
    segRow(
      t.settings.theme,
      [
        { value: 'auto', label: t.settings.themeAuto },
        { value: 'light', label: t.settings.themeLight },
        { value: 'dark', label: t.settings.themeDark },
      ],
      () => settings.get().theme,
      (v) => {
        settings.update({ theme: v });
        applyTheme();
      },
    ),
  );
  container.appendChild(themeCard);

  // データ
  container.appendChild(sectionTitle(`💾 ${t.settings.dataSection}`));
  const dataCard = el('div', { class: 'card settings-card' });
  dataCard.appendChild(buttonRow(t.settings.export, openExportSheet, { note: '機種変更・iPhoneのアプリ削除にそなえて' }));
  dataCard.appendChild(buttonRow(t.settings.import, openImportSheet));
  dataCard.appendChild(
    buttonRow(
      t.settings.reset,
      () => {
        void confirmDialog({
          title: 'データをぜんぶ消す',
          message: 'スコア・実績・スタンプがすべて消えます。\n本当に消しますか？（この操作はもどせません）',
          okLabel: '消す',
          danger: true,
        }).then((ok) => {
          if (!ok) return;
          resetAll();
          toast('データを消しました');
          setTimeout(() => location.reload(), 600);
        });
      },
      { danger: true },
    ),
  );
  container.appendChild(dataCard);

  // アプリについて
  container.appendChild(sectionTitle(`ℹ️ ${t.settings.aboutSection}`));
  const aboutCard = el('div', { class: 'card settings-card' });
  aboutCard.appendChild(buttonRow(t.settings.whatsNew, openWhatsNew));
  aboutCard.appendChild(
    buttonRow(t.settings.installGuide, () =>
      bottomSheet((close) =>
        el(
          'div',
          { class: 'info-sheet' },
          el('h2', { class: 'sheet-title', text: '📲 インストール方法' }),
          renderInstallGuide(),
          el('button', { class: 'btn btn-primary btn-large', text: t.common.close, onclick: close }),
        ),
      ),
    ),
  );
  aboutCard.appendChild(
    el(
      'div',
      { class: 'setting-row' },
      el(
        'div',
        null,
        el('div', { class: 'setting-label', text: `${t.settings.version} v${__APP_VERSION__}` }),
        el('div', { class: 'setting-note', text: offlineReadyStored() ? t.settings.offlineOk : t.settings.offlineNot }),
      ),
    ),
  );
  // buttonRow と同じく「行のどこを押しても開く」よう、行そのものをリンクにする
  const ghRow = el(
    'a',
    { class: 'setting-row row-link', href: REPO_URL, target: '_blank', rel: 'noopener' },
    el('span', { class: 'link-btn', text: 'GitHub（ソースコード）' }),
    el('span', { class: 'row-arrow', text: '↗' }),
  );
  aboutCard.appendChild(ghRow);
  container.appendChild(aboutCard);

  // メンテナンス
  container.appendChild(sectionTitle('🔧 こまったときは'));
  const maintCard = el('div', { class: 'card settings-card' });
  maintCard.appendChild(buttonRow(t.settings.reload, () => location.reload()));
  maintCard.appendChild(
    buttonRow(
      t.settings.repair,
      () => {
        // オフラインで実行するとキャッシュ削除後に再取得できず、アプリが開けなくなる
        if (!navigator.onLine) {
          toast('オフラインのようです。電波のある場所でお試しください');
          return;
        }
        void confirmDialog({
          title: '表示の修復',
          message: 'アプリの表示データを入れ直します。\nスコアなどの記録は消えません。\n（通信できる場所で行ってください）',
          okLabel: '修復する',
        }).then((ok) => {
          if (ok) void repairCaches();
        });
      },
      { note: '画面がおかしい・更新されないときに' },
    ),
  );
  container.appendChild(maintCard);
}
