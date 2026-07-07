// =============================================================
// GAME100 ゲームプラグイン契約
// =============================================================
// ゲームのコードが import してよいのは、この src/game-api/ だけ
// （types.ts の契約型と、helpers.ts の共通ヘルパー）。
// それ以外の機能はすべて GameContext 経由で受け取る。
//
// 互換性ルール（100ゲームを壊さないための約束）:
//   - IGame のシグネチャは変更しない（全ゲームの改修になるため）
//   - GameMeta / GameContext には「省略可能なメンバーの追加」だけ許可
//   - GameMeta の id と no は一度リリースしたら変更しない（保存データのキーになる）
// =============================================================

export type Orientation = 'portrait' | 'landscape' | 'any';

export type Category = 'action' | 'puzzle' | 'reflex' | 'memory' | 'timing' | 'sensor' | 'chill';

/** スコアの種類。points=高いほど良い / timeMs=短いほど良い / none=スコアなし */
export type Scoring = 'points' | 'timeMs' | 'none';

export type SensorKind = 'motion';

export type SfxName = 'tap' | 'success' | 'fail' | 'tick' | 'combo' | 'start' | 'medal' | 'powerup';

export type HapticKind = 'light' | 'medium' | 'success' | 'error';

export type Unsubscribe = () => void;

export interface Size {
  /** 論理px（CSS px） */
  w: number;
  h: number;
  /** 実効 devicePixelRatio（性能のため上限2にクランプ済み） */
  dpr: number;
}

export interface HelpDef {
  /** ゲームの目的（1〜2文） */
  goal: string;
  /** 操作方法（箇条書き） */
  controls: string[];
  /** コツ（任意） */
  tips?: string[];
}

/**
 * メダルのスコア閾値。
 * scoring が 'points' なら bronze < silver < gold（以上で獲得）、
 * 'timeMs' なら bronze > silver > gold（以下で獲得）にすること。
 */
export interface MedalDef {
  bronze: number;
  silver: number;
  gold: number;
}

export interface AchievementDef {
  /** ゲーム内で一意。保存キーは `${gameId}/${id}` になる */
  id: string;
  name: string;
  desc: string;
  /** true なら解除するまで内容を表示しない */
  secret?: boolean;
}

export interface GameMeta {
  /** 不変のID（例: 'tap-panic'）。保存データのキーになる */
  id: string;
  /** 1〜100 のコレクション番号（スタンプ台紙の位置） */
  no: number;
  title: string;
  /** ひらがなの読み（検索用。例: 'たっぷぱにっく'） */
  kana: string;
  description: string;
  category: Category;
  orientation: Orientation;
  /** 使用するセンサー。宣言すると開始前に許可フローが自動で挟まる */
  sensors?: SensorKind[];
  /**
   * あると楽しいが必須ではないセンサー。「あそぶ」時に許可を求めるが、
   * 拒否・非対応でもゲームは開始される（その場合 ctx.motion は null のまま）。
   * タッチ操作だけでも完全に遊べるゲームで使うこと。
   */
  optionalSensors?: SensorKind[];
  scoring: Scoring;
  medals?: MedalDef;
  /** 1プレイの長さの目安（フィルタ用）。short=1分以内 */
  timeToPlay?: 'short' | 'mid' | 'long';
  help: HelpDef;
  achievements: AchievementDef[];
  /** アイコン（絵文字1文字。背景グラデはIDから自動生成される） */
  icon: { emoji: string };
  /** 追加されたアプリバージョン（NEWバッジに使われる） */
  addedIn: string;
  /** retired にすると一覧から消える（番号は欠番のまま維持） */
  status?: 'active' | 'retired';
  /**
   * 開始演出。省略時は 'countdown'（3-2-1 のあと start()）。
   * 'immediate' は反射系でないゲーム（ボード/パズル等）向けで、カウントダウンを飛ばして即 start()。
   */
  startMode?: 'countdown' | 'immediate';
  /** 動的import。コード分割され、必要になるまで読み込まれない */
  load: () => Promise<GameModule>;
}

export interface GameModule {
  createGame: (ctx: GameContext) => IGame;
}

export interface IGame {
  /** 許可取得・カウントダウンの後に1回だけ呼ばれる。リトライ時は新しいインスタンスが作られる */
  start(): void;
  /** いつでも呼ばれうる（バックグラウンド移行・回転案内・ポーズボタン）。音とループを止めること */
  pause(): void;
  resume(): void;
  /** start() 前に1回は呼ばれ、その後も回転やビューポート変化のたびに呼ばれる */
  resize(size: Size): void;
  /** 自分で登録したリスナーやタイマーをすべて解除すること */
  destroy(): void;
}

export interface PointerInfo {
  /** ctx.root 基準の論理px */
  x: number;
  y: number;
  /** マルチタッチ識別用 */
  id: number;
}

export type SwipeDir = 'up' | 'down' | 'left' | 'right';

/**
 * 統一ポインタ入力。マルチタッチでは指ごとにコールバックが届く（各 PointerInfo.id で区別できる）。
 * 単一タッチ前提のゲームは、必要なら最初の id だけを追う等 p.id でフィルタすること
 * （2本目の指で位置が飛ぶのを防ぐ）。
 */
export interface InputHelper {
  onDown(cb: (p: PointerInfo) => void): Unsubscribe;
  onMove(cb: (p: PointerInfo) => void): Unsubscribe;
  /**
   * 指が離れたとき。OSにポインターを奪われた場合（pointercancel: 通知シェード・エッジスワイプ等）も
   * 「離れた」として呼ばれる（ドラッグ状態の固着防止。ただし onTap / onSwipe は発火しない）
   */
  onUp(cb: (p: PointerInfo) => void): Unsubscribe;
  /** 短時間・小移動のタップだけ通知 */
  onTap(cb: (p: PointerInfo) => void): Unsubscribe;
  onSwipe(cb: (dir: SwipeDir, p: PointerInfo) => void): Unsubscribe;
}

export interface Canvas2DHandle {
  el: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  /** 描画座標系の幅（design 指定時は常にその値） */
  width: number;
  /** 描画座標系の高さ */
  height: number;
  /** 全面を塗りつぶす（色省略時は透明クリア） */
  clear(color?: string): void;
  /** root基準の論理px座標（PointerInfo）を、このキャンバスの描画座標系へ変換 */
  toLocal(p: { x: number; y: number }): { x: number; y: number };
}

export interface MotionHelper {
  /**
   * 画面の向きに合わせて補正済みの傾き（-1〜1）。
   * x: 画面の右が下がると正 / y: 画面の下が下がると正（キャンバスY方向と一致）
   * 1.0 は端末をおよそ40°傾けた状態（プラットフォーム側でゲイン調整済み。
   * ゲーム側のデッドゾーン等はこの単位系を前提にしてよい）
   */
  readonly tilt: { x: number; y: number };
  /** 現在の持ち方をニュートラル(0,0)として記録する */
  calibrate(): void;
  onShake(cb: () => void): Unsubscribe;
}

export interface GameResult {
  /** scoring が 'none' のゲームでは省略する */
  score?: number;
}

export interface GameContext {
  /** ゲーム描画エリア（セーフエリア調整・touch-action:none 設定済み）。DOMゲームはここに要素を作る */
  root: HTMLElement;
  /**
   * 現在の描画エリアのサイズ。リサイズのたびに同じ参照が破壊的に更新されるライブ値なので、
   * 値をコピーして持たず、必要なときに都度参照すること（保持したいなら resize(size) のスナップショットを使う）。
   */
  size: Readonly<Size>;
  meta: Readonly<GameMeta>;
  /** Canvasを使うゲームだけ呼ぶ。design 指定で固定論理解像度（自動レターボックス） */
  canvas2d(opts?: { design?: { w: number; h: number } }): Canvas2DHandle;
  input: InputHelper;
  /**
   * meta.sensors か meta.optionalSensors に 'motion' を宣言し、ユーザーが許可した場合のみ非null。
   * （sensors=必須: 拒否されるとゲーム自体が開始されない / optionalSensors=任意: 拒否でも null のまま開始する）
   */
  motion: MotionHelper | null;
  /**
   * シェル管理のゲームループ。ポーズ中は止まり、復帰時の dt（秒）はクランプされる。
   * 時間差の処理は setTimeout ではなく、これと now() の期限方式で行う（ポーズ対応のため）
   */
  onFrame(cb: (dt: number) => void): Unsubscribe;
  sfx(name: SfxName): void;
  /** バイブレーション。非対応端末（iPhone等）では自動で何もしない */
  haptic(kind: HapticKind): void;
  /** シード付き乱数 0〜1。「今日のゲーム」では日替わり共通シードになる。Math.random は使わない */
  random(): number;
  /** プレイ開始からの経過ミリ秒。ポーズ中は進まない。Date.now は使わない */
  now(): number;
  /** ゲームごとの永続保存（設定・進行度など小さなデータ用）。JSON化できる値のみ保存される */
  save<T>(key: string, value: T): void;
  load<T>(key: string): T | null;
  /** 実績を解除する（解除済みなら何もしない） */
  achieve(id: string): void;
  /** ゲーム終了 → シェルの結果画面へ。スコアはここからだけ記録される */
  end(result: GameResult): void;
  /** 結果なしで中断してホームへ戻る */
  quit(): void;
}
