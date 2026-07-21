// =============================================================
// コマずもう（No.85）の物理・CPU・採点（DOM非依存・純ロジック）
// =============================================================
// - まわるコマ同士の土俵ずもう3番勝負。スワイプ＝体当たりの推進力。ただし
//   体当たりのたびに回転力（いのち）を消費＝連打すると自分が先に止まる。
// - 回転力は「重さ」でもある: 衝突は回転力に応じた有効質量の弾性衝突
//   （回転力が多いほど どっしり押し勝つ）＋回転量に応じた接線カーブ。
//   運動量（有効質量つき）は厳密に保存（プロパティテスト対象）。
// - CPU の意思決定は cpuDecide() だけが rng を消費し、1回の呼び出しで
//   ちょうど2消費（分岐に関係なく）＝ミラー再現が容易な決定論。
// - import してよいのは game-api と同一フォルダのみ（このファイルは依存なし）。

export const W = 360;
export const H = 640;

/** 土俵（中心・半径） */
export const RING = { x: 180, y: 278, r: 148 } as const;
export const TOP_R = 21;
/** コマの中心がこれを越えたら「おしだし」（少し食み出しただけでは粘れる） */
export const OUT_R = RING.r - TOP_R * 0.4;

export const SPIN_MAX = 100;
/** 自然減衰（/秒）。なにもしなくても約33秒で回転切れ＝試合の自然な時計 */
export const SPIN_DECAY = 3.0;
/**
 * 速度の指数減衰（/秒）。体当たりの滑走距離 ≒ 初速/FRICTION なので、
 * 全力（IMPULSE_MAX）でも滑走 ≒ 125px（土俵半径139px）＝
 * 中央付近からの全力1発が即自滅にならないように調整してある。
 */
export const FRICTION = 2.4;

export const IMPULSE_MIN = 110;
export const IMPULSE_MAX = 300;
/** 体当たり1回の回転力コスト = BASE + K×強さ（最大12） */
export const SWIPE_COST_BASE = 4;
export const SWIPE_COST_K = 8;

export const RESTITUTION = 0.88;
/** 衝突時の接線カーブの強さ（回転の合計に比例＝順序対称） */
export const CURVE_K = 0.22;
/** 衝突のけずり合い（両者同量）: BASE + 接近速度×K（上限あり） */
export const GRIND_BASE = 1.0;
export const GRIND_K = 0.01;
export const GRIND_MAX = 6;

export interface Top {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** 回転力 0〜100。0で回転切れ＝まけ */
  spin: number;
}

/** 回転力→有効質量（0.7〜1.3）。回転が多いほど押し勝つ */
export function effMass(spin: number): number {
  return 0.7 + 0.6 * (Math.max(0, Math.min(SPIN_MAX, spin)) / SPIN_MAX);
}

export function swipeCost(power01: number): number {
  return SWIPE_COST_BASE + SWIPE_COST_K * Math.min(1, Math.max(0, power01));
}

/** 体当たりできるか（使い切り自滅はさせない: コスト+2 のこる場合のみ可） */
export function canSwipe(t: Top, power01: number): boolean {
  return t.spin > swipeCost(power01) + 2;
}

/** 体当たり: 方向 (dx,dy)・強さ power01 の推進力を与え、回転力を消費する */
export function applySwipe(t: Top, dx: number, dy: number, power01: number): void {
  const d = Math.hypot(dx, dy);
  if (d < 1e-6) return;
  const p = Math.min(1, Math.max(0, power01));
  const imp = IMPULSE_MIN + (IMPULSE_MAX - IMPULSE_MIN) * p;
  t.vx += (dx / d) * imp;
  t.vy += (dy / d) * imp;
  t.spin = Math.max(0, t.spin - swipeCost(p));
}

/** 1ステップの積分（位置・摩擦・自然減衰）。dt は秒 */
export function stepTop(t: Top, dt: number): void {
  t.x += t.vx * dt;
  t.y += t.vy * dt;
  const f = Math.exp(-FRICTION * dt);
  t.vx *= f;
  t.vy *= f;
  if (Math.hypot(t.vx, t.vy) < 3) {
    t.vx = 0;
    t.vy = 0;
  }
  t.spin = Math.max(0, t.spin - SPIN_DECAY * dt);
}

/**
 * 衝突の解決。触れていなければ null、解決したら接近速度（>0）を返す。
 * - めり込みは半分ずつ押し戻す
 * - 法線方向: 有効質量つき弾性衝突（衝突前の回転力で質量を決める）
 * - 接線方向: 回転の合計に比例したカーブ（順序対称・運動量保存）
 * - 最後に両者の回転力を同量けずる
 */
export function collide(a: Top, b: Top): number | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d = Math.hypot(dx, dy);
  if (d >= TOP_R * 2) return null;
  let nx = 1;
  let ny = 0;
  if (d > 1e-4) {
    nx = dx / d;
    ny = dy / d;
  }
  const half = (TOP_R * 2 - d) / 2;
  a.x -= nx * half;
  a.y -= ny * half;
  b.x += nx * half;
  b.y += ny * half;
  const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
  if (rel >= 0) return null; // 離れつつある（位置の分離だけ）
  const closing = -rel;
  const ma = effMass(a.spin);
  const mb = effMass(b.spin);
  // 法線インパルス（大きさ）: j = (1+e)·closing / (1/ma + 1/mb)
  const j = ((1 + RESTITUTION) * closing) / (1 / ma + 1 / mb);
  a.vx -= (j / ma) * nx;
  a.vy -= (j / ma) * ny;
  b.vx += (j / mb) * nx;
  b.vy += (j / mb) * ny;
  // 接線カーブ（合計回転に比例＝スワップ対称。J_t を等・逆向きに付与）
  const tx = -ny;
  const ty = nx;
  const jt = CURVE_K * ((a.spin + b.spin) / (2 * SPIN_MAX)) * Math.min(closing, 500);
  a.vx -= (jt / ma) * tx;
  a.vy -= (jt / ma) * ty;
  b.vx += (jt / mb) * tx;
  b.vy += (jt / mb) * ty;
  // けずり合い（衝突後に適用＝上のインパルス計算は衝突前の質量）
  const grind = Math.min(GRIND_MAX, GRIND_BASE + closing * GRIND_K);
  a.spin = Math.max(0, a.spin - grind);
  b.spin = Math.max(0, b.spin - grind);
  return closing;
}

export const distC = (t: Top): number => Math.hypot(t.x - RING.x, t.y - RING.y);

export function isOut(t: Top): boolean {
  return distC(t) > OUT_R;
}

/** おしだし判定。両方外なら深く出ているほうが負け・完全同値はプレイヤー救済 */
export function outVerdict(player: Top, cpu: Top): 'none' | 'player' | 'cpu' {
  const po = isOut(player);
  const co = isOut(cpu);
  if (!po && !co) return 'none';
  if (po && co) return distC(player) > distC(cpu) ? 'player' : 'cpu';
  return po ? 'player' : 'cpu';
}

/** 回転切れ判定。両方同時ならプレイヤー救済 */
export function spinVerdict(player: Top, cpu: Top): 'none' | 'player' | 'cpu' {
  const p0 = player.spin <= 0;
  const c0 = cpu.spin <= 0;
  if (!p0 && !c0) return 'none';
  if (p0 && c0) return 'cpu';
  return p0 ? 'player' : 'cpu';
}

// ---- CPU ----

export interface CpuLevel {
  name: string;
  /** 意思決定の周期（ms） */
  cadenceMs: number;
  /** ねらいのブレ（rad・±） */
  jitter: number;
  powMin: number;
  powMax: number;
  /** これ以下の回転力では攻めない（縁からの退避だけ） */
  reserve: number;
  /** 相手の未来位置の先読み（秒） */
  lead: number;
  /** 相手が縁ぎわのとき押し切りを強めるか */
  edgeSense: boolean;
}

export const CPU_LEVELS: CpuLevel[] = [
  { name: 'こごま', cadenceMs: 620, jitter: 0.55, powMin: 0.3, powMax: 0.62, reserve: 34, lead: 0, edgeSense: false },
  { name: 'あにごま', cadenceMs: 460, jitter: 0.3, powMin: 0.42, powMax: 0.8, reserve: 24, lead: 0.1, edgeSense: true },
  { name: 'おやかたゴマ', cadenceMs: 330, jitter: 0.15, powMin: 0.52, powMax: 0.95, reserve: 16, lead: 0.18, edgeSense: true },
];

export interface CpuAction {
  dx: number;
  dy: number;
  power01: number;
}

/**
 * CPU の意思決定（cadence ごとに1回呼ぶ）。
 * rng は毎回ちょうど2消費（分岐に関係なく）＝ミラー同期が容易。
 * 「むだ撃ちしない」設計: すでに狙い方向へ滑っている・遠くて勢いがある間は滑走する。
 */
export function cpuDecide(cpu: Top, foe: Top, lv: CpuLevel, rng: () => number): CpuAction | null {
  const j1 = rng();
  const j2 = rng();
  const cd = distC(cpu);
  const myEdge = cd / OUT_R;
  const spd = Math.hypot(cpu.vx, cpu.vy);
  // 回転力が少ない: 縁にいるときだけ最小コストで中央へ（それ以外は温存）
  if (cpu.spin <= lv.reserve) {
    if (myEdge > 0.55 && spd < 90 && canSwipe(cpu, 0.2)) {
      return { dx: RING.x - cpu.x, dy: RING.y - cpu.y, power01: 0.2 };
    }
    return null;
  }
  // 自分が縁ぎわ → まず中央へもどる（外向きに流されているほど強く）
  if (myEdge > 0.7) {
    const outward = cd > 1 ? ((cpu.x - RING.x) * cpu.vx + (cpu.y - RING.y) * cpu.vy) / cd : 0;
    if (outward > -40) {
      return {
        dx: RING.x - cpu.x,
        dy: RING.y - cpu.y,
        power01: Math.min(1, 0.45 + Math.max(0, outward) / 300),
      };
    }
  }
  const dx = foe.x + foe.vx * lv.lead - cpu.x;
  const dy = foe.y + foe.vy * lv.lead - cpu.y;
  const distF = Math.hypot(dx, dy);
  // すでに相手方向へ十分すべっている・遠くて勢いがある → 滑走（むだ撃ちしない）
  const vAlong = distF > 1 ? (cpu.vx * dx + cpu.vy * dy) / distF : 0;
  if (vAlong > 110) return null;
  if (distF > 170 && spd > 70) return null;
  const ang = Math.atan2(dy, dx) + (j1 - 0.5) * 2 * lv.jitter;
  let pow = lv.powMin + (lv.powMax - lv.powMin) * j2;
  if (lv.edgeSense && distC(foe) / OUT_R > 0.52) {
    pow = Math.min(1, pow + 0.25); // 縁ぎわの相手は押し切る
  }
  return { dx: Math.cos(ang), dy: Math.sin(ang), power01: pow };
}

// ---- 採点 ----

/** 取組勝利の基本点（1〜3番） */
export const WIN_BASE = [120, 180, 240] as const;
export const PUSHOUT_BONUS = 40;
export const SPINOUT_BONUS = 20;
export const CHAMPION_BONUS = 100;
/** 実績: よこづな の閾値（プランナーボット実証値で較正） */
export const SCORE_HI = 800;

/** 勝利時の残り回転力ボーナス（最大60） */
export function spinBonus(spin: number): number {
  return Math.round((Math.max(0, Math.min(SPIN_MAX, spin)) / SPIN_MAX) * 60);
}

/** はやさボーナス（取組開始→決着ms）。18秒を切った分×3点/秒（最大45） */
export function speedBonus(ms: number): number {
  return 3 * Math.min(15, Math.max(0, Math.ceil((18_000 - ms) / 1000)));
}

/** 1取組の得点（勝ちのみ。負けは0） */
export function boutScore(bout: number, cause: 'push' | 'spin', spinLeft: number, ms: number): number {
  return (
    (WIN_BASE[bout] ?? 0) +
    (cause === 'push' ? PUSHOUT_BONUS : SPINOUT_BONUS) +
    spinBonus(spinLeft) +
    speedBonus(ms)
  );
}
