// ゲームの起動・終了のナビゲーション（履歴を正しく巻き戻すための小さなモジュール）
import { navigate } from '../platform/router';

let openedFromApp = false;

/** アプリ内の操作からゲームを開く（履歴にpushされる） */
export function openGamePlay(id: string): void {
  openedFromApp = true;
  navigate(`#/play/${encodeURIComponent(id)}`);
}

/** ゲームから出る。アプリ内から開いた場合は履歴を戻し、直リンクの場合はホームへ */
export function exitGamePlay(): void {
  if (openedFromApp) {
    openedFromApp = false;
    history.back();
  } else {
    navigate('#/home', { replace: true });
  }
}
