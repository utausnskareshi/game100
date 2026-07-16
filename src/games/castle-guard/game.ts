// =============================================================
// まもれ！おしろ（No.66）: 道をくる敵を「まもりずきん」でむかえうつ ディフェンス
// =============================================================
// - 台をタップ→下のバーで 弓/氷/ばくだん を建てる（コイン消費・敵をたおすと回収）。
//   とりでをタップで強化（Lv3まで）。全10ウェーブ完結・城HP5。
// - 経路・ウェーブ表・とりで/敵の仕様・ターゲティングは logic.ts（純ロジック・乱数不使用）。
// - 全画面 Canvas・onTap のみ。時間は ctx.now 期限方式・setTimeout 不使用。
// - import してよいのは game-api（types / helpers）と、このフォルダ内（logic）だけ
import type { GameContext, IGame } from '../../game-api/types';
import {
  CASTLE_HP,
  CLEAR_SCORE,
  ENEMIES,
  type EnemyKind,
  HP_SCORE,
  PADS,
  PATH,
  PREP_SEC,
  START_COINS,
  TOTAL_LEN,
  TOWERS,
  type TowerType,
  WAVES,
  WAVE_COIN,
  WAVE_SCORE,
  acquireTarget,
  posAt,
} from './logic';

const W = 360;
const H = 640;
const HUD_H = 44;
const PAD_R = 20;
const PAD_TAP_R = 30;
const SCORE_HI = 1500;

type Mode = 'prep' | 'battle' | 'win' | 'lose';

interface Enemy {
  kind: EnemyKind;
  dist: number;
  hp: number;
  maxHp: number;
  slowUntil: number;
  slowF: number;
}

interface Tower {
  pad: number;
  type: TowerType;
  lv: number;
  cdReady: number;
}

const TOWER_COLOR: Record<TowerType, string> = { arrow: '#c8903c', ice: '#57b8e8', bomb: '#5a4a6a' };
const TOWER_LABEL: Record<TowerType, string> = { arrow: 'ゆみ', ice: 'こおり', bomb: 'ばくだん' };
const ENEMY_COLOR: Record<EnemyKind, string> = { slime: '#4cae52', fast: '#e8c23c', tank: '#9b6cf0', boss: '#e05050' };

const BAR = { x: 8, y: 550, w: 344, h: 82 };

export function createGame(ctx: GameContext): IGame {
  const cv = ctx.canvas2d({ design: { w: W, h: H } });
  const g = cv.ctx;

  let mode: Mode = 'prep';
  let hostPaused = false;
  let wave = 0; // 0-based
  let prepUntil = 0;
  let spawns: { at: number; kind: EnemyKind }[] = [];
  let spawnIdx = 0;
  let enemies: Enemy[] = [];
  let towers: Tower[] = [];
  let coins = START_COINS;
  let castleHp = CASTLE_HP;
  let score = 0;
  const kills: Record<EnemyKind, number> = { slime: 0, fast: 0, tank: 0, boss: 0 };
  let wavesCleared = 0;
  let builds = 0;
  let selPad = -1;
  let shots: { x1: number; y1: number; x2: number; y2: number; until: number; color: string }[] = [];
  let booms: { x: number; y: number; r: number; until: number }[] = [];
  let endAt = 0;
  let ended = false;

  function addScore(n: number): void {
    score += n;
    if (score >= SCORE_HI) ctx.achieve('score-hi');
  }

  function startPrep(w2: number, now: number): void {
    wave = w2;
    mode = 'prep';
    prepUntil = now + PREP_SEC * 1000;
    if (wave + 1 >= 5) ctx.achieve('wave-5');
  }

  function startBattle(now: number): void {
    mode = 'battle';
    spawns = [];
    let at = now;
    for (const sp of WAVES[wave]!) {
      at += sp.gap * 1000;
      spawns.push({ at, kind: sp.kind });
    }
    spawnIdx = 0;
    ctx.sfx('start');
  }

  function waveCleared(now: number): void {
    coins += WAVE_COIN;
    addScore(WAVE_SCORE);
    wavesCleared++;
    if (wave + 1 >= WAVES.length) {
      // 勝利
      addScore(castleHp * HP_SCORE + CLEAR_SCORE);
      ctx.achieve('clear-10');
      if (castleHp >= CASTLE_HP) ctx.achieve('no-damage');
      mode = 'win';
      endAt = now + 2300;
      ctx.sfx('medal');
      ctx.haptic('success');
    } else {
      ctx.sfx('success');
      startPrep(wave + 1, now);
    }
  }

  function lose(now: number): void {
    mode = 'lose';
    endAt = now + 2000;
    ctx.sfx('fail');
    ctx.haptic('error');
  }

  function towerAt(pad: number): Tower | undefined {
    return towers.find((t) => t.pad === pad);
  }

  function build(pad: number, type: TowerType): void {
    const spec = TOWERS[type];
    if (coins < spec.cost || towerAt(pad)) return;
    coins -= spec.cost;
    towers.push({ pad, type, lv: 1, cdReady: 0 });
    builds++;
    if (builds >= 5) ctx.achieve('builder-5');
    ctx.sfx('powerup');
    ctx.haptic('light');
  }

  function upgrade(tw: Tower): void {
    if (tw.lv >= 3) return;
    const cost = TOWERS[tw.type].up[(tw.lv - 1) as 0 | 1];
    if (coins < cost) return;
    coins -= cost;
    tw.lv++;
    if (tw.lv >= 3) ctx.achieve('max-up');
    ctx.sfx('powerup');
    ctx.haptic('light');
  }

  // ---- 入力 ----
  const offTap = ctx.input.onTap((p) => {
    if (hostPaused || mode === 'win' || mode === 'lose') return;
    const l = cv.toLocal(p);
    // ビルドバー
    if (selPad >= 0 && l.x >= BAR.x && l.x <= BAR.x + BAR.w && l.y >= BAR.y && l.y <= BAR.y + BAR.h) {
      const tw = towerAt(selPad);
      if (tw) {
        // 強化ボタン（中央）
        if (l.x >= 128 && l.x <= 232 && l.y >= BAR.y + 8 && l.y <= BAR.y + 72) upgrade(tw);
      } else {
        const types: TowerType[] = ['arrow', 'ice', 'bomb'];
        const i = Math.floor((l.x - 16) / 112);
        if (i >= 0 && i < 3 && l.x >= 16 + i * 112 && l.x <= 16 + i * 112 + 104) build(selPad, types[i]!);
      }
      return;
    }
    // 台の選択
    let hit = -1;
    PADS.forEach((pd, i) => {
      if (Math.hypot(pd.x - l.x, pd.y - l.y) <= PAD_TAP_R) hit = i;
    });
    selPad = hit;
    if (hit >= 0) ctx.sfx('tap');
  });

  // ---- 毎フレーム ----
  const offFrame = ctx.onFrame((dt) => {
    if (hostPaused) return;
    const now = ctx.now();
    if (mode === 'prep') {
      if (now >= prepUntil) startBattle(now);
    } else if (mode === 'battle') {
      // 出現
      while (spawnIdx < spawns.length && now >= spawns[spawnIdx]!.at) {
        const kind = spawns[spawnIdx]!.kind;
        const spec = ENEMIES[kind];
        enemies.push({ kind, dist: 0, hp: spec.hp, maxHp: spec.hp, slowUntil: 0, slowF: 1 });
        spawnIdx++;
      }
      // 前進
      for (const e of enemies) {
        const spec = ENEMIES[e.kind];
        e.dist += spec.spd * (now < e.slowUntil ? e.slowF : 1) * dt;
      }
      // 城に到達
      for (let i = enemies.length - 1; i >= 0; i--) {
        if (enemies[i]!.dist >= TOTAL_LEN) {
          castleHp -= ENEMIES[enemies[i]!.kind].dmg;
          enemies.splice(i, 1);
          ctx.sfx('fail');
          ctx.haptic('error');
        }
      }
      if (castleHp <= 0) {
        castleHp = 0;
        lose(now);
      } else {
        // とりでの攻撃
        for (const tw of towers) {
          if (now < tw.cdReady) continue;
          const spec = TOWERS[tw.type];
          const lvIdx = (tw.lv - 1) as 0 | 1 | 2;
          const pad = PADS[tw.pad]!;
          const ti = acquireTarget(enemies, pad.x, pad.y, spec.range[lvIdx]);
          if (ti < 0) continue;
          tw.cdReady = now + spec.cd[lvIdx] * 1000;
          const tp = posAt(enemies[ti]!.dist);
          if (tw.type === 'bomb') {
            const aoe = spec.aoe![lvIdx];
            for (const e of enemies) {
              const ep = posAt(e.dist);
              if ((ep.x - tp.x) ** 2 + (ep.y - tp.y) ** 2 <= aoe * aoe) e.hp -= spec.dmg[lvIdx];
            }
            booms.push({ x: tp.x, y: tp.y, r: aoe, until: now + 280 });
            ctx.sfx('combo');
          } else {
            enemies[ti]!.hp -= spec.dmg[lvIdx];
            if (tw.type === 'ice') {
              enemies[ti]!.slowUntil = now + spec.slowDur![lvIdx] * 1000;
              enemies[ti]!.slowF = spec.slowF![lvIdx];
            }
            shots.push({ x1: pad.x, y1: pad.y, x2: tp.x, y2: tp.y, until: now + 130, color: tw.type === 'ice' ? '#9fdcf5' : '#ffd76a' });
          }
        }
        // 撃破
        for (let i = enemies.length - 1; i >= 0; i--) {
          if (enemies[i]!.hp <= 0) {
            const spec = ENEMIES[enemies[i]!.kind];
            coins += spec.reward;
            addScore(spec.score);
            kills[enemies[i]!.kind]++;
            enemies.splice(i, 1);
          }
        }
        if (spawnIdx >= spawns.length && enemies.length === 0) waveCleared(now);
      }
    } else {
      if (!ended && now >= endAt) {
        ended = true;
        ctx.end({ score });
        return;
      }
    }
    shots = shots.filter((s) => now < s.until);
    booms = booms.filter((b) => now < b.until);
    draw(now);
    setData(now);
  });

  function setData(now: number): void {
    if (!import.meta.env.DEV) return;
    const r = ctx.root as HTMLElement;
    r.dataset.mode = mode;
    r.dataset.wave = String(wave + 1);
    r.dataset.coins = String(coins);
    r.dataset.hp = String(castleHp);
    r.dataset.score = String(score);
    r.dataset.kslime = String(kills.slime);
    r.dataset.kfast = String(kills.fast);
    r.dataset.ktank = String(kills.tank);
    r.dataset.kboss = String(kills.boss);
    r.dataset.wavescleared = String(wavesCleared);
    r.dataset.alive = String(enemies.length);
    r.dataset.towers = towers.map((t) => `${t.pad}:${t.type[0]}:${t.lv}`).join(',');
    r.dataset.sel = String(selPad);
    r.dataset.prepleft = mode === 'prep' ? String(Math.max(0, Math.round(prepUntil - now))) : '0';
  }

  // ---- 描画 ----
  function roundRect(x: number, y: number, w: number, h: number, rad: number): void {
    const rr = Math.min(rad, w / 2, h / 2);
    g.beginPath();
    g.moveTo(x + rr, y);
    g.arcTo(x + w, y, x + w, y + h, rr);
    g.arcTo(x + w, y + h, x, y + h, rr);
    g.arcTo(x, y + h, x, y, rr);
    g.arcTo(x, y, x + w, y, rr);
    g.closePath();
  }

  function drawTowerIcon(x: number, y: number, type: TowerType, lv: number, r: number): void {
    g.fillStyle = TOWER_COLOR[type];
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = 'rgba(0,0,0,.35)';
    g.lineWidth = 2;
    g.stroke();
    g.strokeStyle = '#fff';
    g.fillStyle = '#fff';
    if (type === 'arrow') {
      g.lineWidth = 2.5;
      g.beginPath();
      g.arc(x - 2, y, r * 0.55, -Math.PI / 2.6, Math.PI / 2.6);
      g.stroke();
      g.beginPath();
      g.moveTo(x - 2 + r * 0.5 * Math.cos(-Math.PI / 2.6), y + r * 0.55 * Math.sin(-Math.PI / 2.6));
      g.lineTo(x - 2 + r * 0.55 * Math.cos(Math.PI / 2.6), y + r * 0.55 * Math.sin(Math.PI / 2.6));
      g.stroke();
      g.beginPath();
      g.moveTo(x - 2, y);
      g.lineTo(x + r * 0.72, y);
      g.stroke();
    } else if (type === 'ice') {
      g.beginPath();
      g.moveTo(x, y - r * 0.62);
      g.lineTo(x + r * 0.5, y);
      g.lineTo(x, y + r * 0.62);
      g.lineTo(x - r * 0.5, y);
      g.closePath();
      g.fill();
    } else {
      g.fillStyle = '#1d1626';
      g.beginPath();
      g.arc(x, y + 2, r * 0.5, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = '#e8a020';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(x + r * 0.2, y - r * 0.35);
      g.quadraticCurveTo(x + r * 0.55, y - r * 0.75, x + r * 0.3, y - r * 0.9);
      g.stroke();
    }
    // レベルピップ
    g.fillStyle = '#ffd76a';
    for (let i = 0; i < lv; i++) {
      g.beginPath();
      g.arc(x - 8 + i * 8, y + r + 6, 2.6, 0, Math.PI * 2);
      g.fill();
    }
  }

  function draw(now: number): void {
    // 野原と道
    g.fillStyle = '#2c5c34';
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#254d2c';
    for (let i = 0; i < 14; i++) {
      const gx = (i * 83 + 17) % W;
      const gy = 60 + ((i * 131) % 500);
      g.fillRect(gx, gy, 3, 7);
    }
    g.strokeStyle = '#8a6f42';
    g.lineWidth = 36;
    g.lineJoin = 'round';
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(PATH[0]!.x, PATH[0]!.y);
    for (const pt of PATH) g.lineTo(pt.x, pt.y);
    g.stroke();
    g.strokeStyle = '#c8b070';
    g.lineWidth = 30;
    g.beginPath();
    g.moveTo(PATH[0]!.x, PATH[0]!.y);
    for (const pt of PATH) g.lineTo(pt.x, pt.y);
    g.stroke();

    // 城（下）
    const cx2 = 180;
    const cy2 = 604;
    g.fillStyle = '#d8d2c4';
    g.fillRect(cx2 - 52, cy2 - 16, 104, 44);
    g.fillStyle = '#b8b2a4';
    for (let i = 0; i < 5; i++) g.fillRect(cx2 - 52 + i * 22, cy2 - 26, 14, 12);
    g.fillStyle = '#8a5a3a';
    g.fillRect(cx2 - 12, cy2 - 2, 24, 30);
    g.fillStyle = '#e05050';
    g.beginPath();
    g.moveTo(cx2 - 2, cy2 - 44);
    g.lineTo(cx2 + 16, cy2 - 38);
    g.lineTo(cx2 - 2, cy2 - 32);
    g.closePath();
    g.fill();
    g.strokeStyle = '#6a4a2a';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(cx2 - 2, cy2 - 44);
    g.lineTo(cx2 - 2, cy2 - 16);
    g.stroke();
    // 城のHPハート
    g.font = '13px sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    let hearts = '';
    for (let i = 0; i < CASTLE_HP; i++) hearts += i < castleHp ? '❤' : '🖤';
    g.fillText(hearts, cx2, cy2 + 36);

    // 入り口（上）
    g.fillStyle = '#1d1626';
    g.beginPath();
    g.ellipse(50, 52, 24, 16, 0, 0, Math.PI * 2);
    g.fill();

    // 台ととりで
    PADS.forEach((pd, i) => {
      g.fillStyle = i === selPad ? '#aab2c0' : '#8a8f9a';
      g.beginPath();
      g.arc(pd.x, pd.y, PAD_R, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = 'rgba(0,0,0,.3)';
      g.lineWidth = 2;
      g.stroke();
      const tw = towerAt(i);
      if (tw) {
        drawTowerIcon(pd.x, pd.y, tw.type, tw.lv, PAD_R - 3);
        if (i === selPad) {
          const spec = TOWERS[tw.type];
          g.strokeStyle = 'rgba(255,255,255,.4)';
          g.setLineDash([6, 6]);
          g.lineWidth = 1.5;
          g.beginPath();
          g.arc(pd.x, pd.y, spec.range[(tw.lv - 1) as 0 | 1 | 2], 0, Math.PI * 2);
          g.stroke();
          g.setLineDash([]);
        }
      } else {
        g.fillStyle = 'rgba(255,255,255,.75)';
        g.font = 'bold 20px sans-serif';
        g.fillText('＋', pd.x, pd.y + 1);
      }
      if (i === selPad) {
        g.strokeStyle = '#fff';
        g.lineWidth = 2.5;
        g.beginPath();
        g.arc(pd.x, pd.y, PAD_R + 5, 0, Math.PI * 2);
        g.stroke();
      }
    });

    // ショット・爆発
    for (const s of shots) {
      g.strokeStyle = s.color;
      g.lineWidth = 2.5;
      g.globalAlpha = Math.max(0.2, (s.until - now) / 130);
      g.beginPath();
      g.moveTo(s.x1, s.y1);
      g.lineTo(s.x2, s.y2);
      g.stroke();
      g.globalAlpha = 1;
    }
    for (const b of booms) {
      const p = 1 - (b.until - now) / 280;
      g.strokeStyle = `rgba(255,150,60,${1 - p})`;
      g.lineWidth = 4;
      g.beginPath();
      g.arc(b.x, b.y, b.r * (0.4 + 0.6 * p), 0, Math.PI * 2);
      g.stroke();
    }

    // 敵
    for (const e of enemies) {
      const spec = ENEMIES[e.kind];
      const pos = posAt(e.dist);
      const slowed = now < e.slowUntil;
      g.fillStyle = slowed ? '#7ec8e8' : ENEMY_COLOR[e.kind];
      g.beginPath();
      g.ellipse(pos.x, pos.y + spec.r * 0.15, spec.r, spec.r * 0.85, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#fff';
      g.beginPath();
      g.arc(pos.x - spec.r * 0.32, pos.y - spec.r * 0.1, spec.r * 0.2, 0, Math.PI * 2);
      g.arc(pos.x + spec.r * 0.32, pos.y - spec.r * 0.1, spec.r * 0.2, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#222';
      g.beginPath();
      g.arc(pos.x - spec.r * 0.32, pos.y - spec.r * 0.06, spec.r * 0.1, 0, Math.PI * 2);
      g.arc(pos.x + spec.r * 0.32, pos.y - spec.r * 0.06, spec.r * 0.1, 0, Math.PI * 2);
      g.fill();
      if (e.kind === 'boss') {
        g.fillStyle = '#ffd76a';
        g.font = 'bold 15px sans-serif';
        g.fillText('👑', pos.x, pos.y - spec.r - 10);
      }
      if (e.hp < e.maxHp) {
        const w2 = spec.r * 2;
        g.fillStyle = 'rgba(0,0,0,.4)';
        g.fillRect(pos.x - spec.r, pos.y - spec.r - 7, w2, 4);
        g.fillStyle = '#6fe08a';
        g.fillRect(pos.x - spec.r, pos.y - spec.r - 7, (w2 * Math.max(0, e.hp)) / e.maxHp, 4);
      }
    }

    // HUD
    g.fillStyle = '#0c1426';
    g.fillRect(0, 0, W, HUD_H);
    g.textAlign = 'left';
    g.fillStyle = '#fff';
    g.font = 'bold 18px sans-serif';
    g.fillText(`${score}てん`, 10, HUD_H / 2);
    g.fillStyle = '#ffd76a';
    g.font = 'bold 15px sans-serif';
    g.fillText(`🪙${coins}`, 112, HUD_H / 2);
    g.fillStyle = '#9fb2e8';
    g.fillText(`ウェーブ${wave + 1}/10`, 190, HUD_H / 2);

    // ビルドバー
    if (selPad >= 0 && mode !== 'win' && mode !== 'lose') {
      g.fillStyle = 'rgba(8,14,30,.88)';
      roundRect(BAR.x, BAR.y, BAR.w, BAR.h, 14);
      g.fill();
      const tw = towerAt(selPad);
      g.textAlign = 'center';
      if (tw) {
        const spec = TOWERS[tw.type];
        g.fillStyle = '#fff';
        g.font = 'bold 14px sans-serif';
        g.fillText(`${TOWER_LABEL[tw.type]} Lv${tw.lv}`, 64, BAR.y + 28);
        if (tw.lv < 3) {
          const cost = spec.up[(tw.lv - 1) as 0 | 1];
          const can = coins >= cost;
          g.fillStyle = can ? '#ffd76a' : 'rgba(255,255,255,.25)';
          roundRect(128, BAR.y + 8, 104, 64, 12);
          g.fill();
          g.fillStyle = can ? '#4a3200' : 'rgba(255,255,255,.5)';
          g.font = 'bold 16px sans-serif';
          g.fillText('つよくする', 180, BAR.y + 34);
          g.font = 'bold 13px sans-serif';
          g.fillText(`🪙${cost}`, 180, BAR.y + 56);
        } else {
          g.fillStyle = '#9fb2e8';
          g.font = 'bold 15px sans-serif';
          g.fillText('さいだいレベル！', 180, BAR.y + 44);
        }
        g.fillStyle = 'rgba(255,255,255,.6)';
        g.font = '11px sans-serif';
        g.fillText('ほかを タップで とじる', 296, BAR.y + 44);
      } else {
        const types: TowerType[] = ['arrow', 'ice', 'bomb'];
        types.forEach((ty, i) => {
          const spec = TOWERS[ty];
          const bx = 16 + i * 112;
          const can = coins >= spec.cost;
          g.fillStyle = can ? 'rgba(255,255,255,.14)' : 'rgba(255,255,255,.05)';
          roundRect(bx, BAR.y + 8, 104, 64, 12);
          g.fill();
          g.globalAlpha = can ? 1 : 0.4;
          drawTowerIcon(bx + 24, BAR.y + 38, ty, 0, 14);
          g.fillStyle = '#fff';
          g.font = 'bold 13px sans-serif';
          g.fillText(TOWER_LABEL[ty], bx + 68, BAR.y + 28);
          g.fillStyle = '#ffd76a';
          g.fillText(`🪙${spec.cost}`, bx + 68, BAR.y + 50);
          g.globalAlpha = 1;
        });
      }
    }

    // プレップ表示（台をかくさないよう 上部の1行バナーにする）
    if (mode === 'prep') {
      const left = Math.ceil(Math.max(0, prepUntil - now) / 1000);
      g.fillStyle = 'rgba(5,10,26,.72)';
      roundRect(58, 48, W - 116, wave === 0 ? 52 : 32, 12);
      g.fill();
      g.textAlign = 'center';
      g.fillStyle = '#fff';
      g.font = 'bold 16px sans-serif';
      g.fillText(`ウェーブ${wave + 1} がくる…`, W / 2 - 16, 64);
      g.fillStyle = '#ffd76a';
      g.font = 'bold 20px sans-serif';
      g.fillText(String(left), W / 2 + 74, 64);
      if (wave === 0) {
        g.fillStyle = '#cfd8ff';
        g.font = 'bold 12px sans-serif';
        g.fillText('まるい台をタップ → とりでを たてよう！', W / 2, 88);
      }
    }
    if (mode === 'win' || mode === 'lose') {
      g.fillStyle = 'rgba(5,10,26,.66)';
      roundRect(40, 230, W - 80, 120, 16);
      g.fill();
      g.textAlign = 'center';
      g.fillStyle = '#fff';
      g.font = 'bold 29px sans-serif';
      g.fillText(mode === 'win' ? 'まもりきった！' : 'おしろが…', W / 2, 278);
      g.fillStyle = '#cfd8ff';
      g.font = 'bold 15px sans-serif';
      g.fillText(mode === 'win' ? `おしろHP のこり${castleHp} ボーナス！` : `ウェーブ${wave + 1}まで がんばった`, W / 2, 316);
    }
  }

  draw(0);

  return {
    start() {
      startPrep(0, ctx.now());
    },
    pause() {
      hostPaused = true;
    },
    resume() {
      hostPaused = false;
    },
    resize() {
      draw(ctx.now());
    },
    destroy() {
      offTap();
      offFrame();
    },
  };
}
