// =====================================================================
//  世界 · 地图生成 / 障碍物 / 掉落物 / 毒圈
//  俯视 2D，地图 1632×1632（对齐原版 normal 地图）
// =====================================================================
import { C, GAS_STAGES, LOOT_WEIGHTS, GUNS, MELEES, THROWABLES, AMMOS, ARMORS, PACKS, HEALS, SCOPES, PERKS, weightedPick, TIER_ORDER } from './data.js';
import { clamp, rand, randi, pick, dist, dist2, TAU, Grid, segAABB, segCircle } from './core.js';

export const MAP = C.mapSize;

// 障碍物类型
export const OB = {
  wall:  { h: 34, col: '#3b4252', top: '#4b5468', solid: 1 },
  rock:  { h: 20, col: '#4a4f5c', top: '#5c6270', solid: 1 },
  tree:  { h: 46, col: '#2f4f2a', top: '#3d6b36', solid: 1 },
  crate: { h: 14, col: '#7a5a2e', top: '#9a7338', solid: 1 },
  barrel:{ h: 16, col: '#8a3b2a', top: '#a8493a', solid: 1 },
  ice:   { h: 6,  col: '#8fc9e8', top: '#b8e2f5', solid: 0, ice: 1 },
  sand:  { h: 4,  col: '#c9b483', top: '#dcc79a', solid: 0 },
  bush:  { h: 12, col: '#2b4a26', top: '#375d31', solid: 0 }
};

// 建筑模板（程序化生成街区）
const BUILDINGS = [
  { w: 46, h: 38, kind: 'wall' },
  { w: 62, h: 44, kind: 'wall' },
  { w: 38, h: 52, kind: 'wall' },
  { w: 78, h: 34, kind: 'wall' },
  { w: 34, h: 34, kind: 'wall' },
  { w: 90, h: 56, kind: 'wall' },
  { w: 54, h: 30, kind: 'wall' }
];

export class World {
  constructor(seed) {
    this.size = MAP;
    this.obstacles = [];
    this.water = [];      // 河流（不可通行减速）
    this.crates = [];      // 可搜刮容器
    this.loot = [];       // 地面掉落
    this.grid = new Grid(MAP, MAP, 64);
    this.time = 0;
    this.build(seed);
    this.grid.clear();
    for (const o of this.obstacles) if (o.solid) this.grid.insert(o);
  }

  // ---------- 地图程序化生成 ----------
  build(seed) {
    const R = mulberry32(seed >>> 0);
    // 兜底：seed 非法时退回固定种子，杜绝 NaN 传播
    const rnd = () => { const v = R(); return (isFinite(v) && v >= 0) ? v : 0.5; };
    // rr(a, b) 等价 rand(a, b)；b 省略时退化为 [a, a+1)
    const rr = (a, b) => (b === undefined ? a + rnd() : a + rnd() * (b - a));
    const rri = (a, b) => Math.floor(rr(a, b + 1));
    const S = MAP;
    // 可行走边距：海洋 + 沙滩
    const MARGIN = C.oceanSize + C.beachSize + 30;

    // 河流：一条横穿地图的带状水体（减速而非阻挡）
    const riverY = rr(S * 0.32, S * 0.68);
    const riverPts = [];
    let ry = riverY;
    for (let x = 0; x <= S; x += 64) {
      ry += rr(-18, 18);
      ry = clamp(ry, S * 0.2, S * 0.8);
      riverPts.push({ x, y: ry, w: rr(34, 58) });
    }
    this.riverPts = riverPts;

    // 沙滩带（地图四周）
    this.beach = C.beachSize;

    // 森林区块（树）
    const forests = 6 + rri(0, 3);
    for (let f = 0; f < forests; f++) {
      const cx = rr(120, S - 120), cy = rr(120, S - 120);
      const n = rri(10, 22);
      const rad = rr(50, 105);
      for (let i = 0; i < n; i++) {
        const a = rr(TAU), d = Math.sqrt(rnd()) * rad;
        const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d;
        if (this.inRiver(x, y, 30) || this.nearEdge(x, y, MARGIN)) continue;
        this.obstacles.push({ x: x - 2.5, y: y - 2.5, w: 5, h: 5, type: 'tree', r: 2.5, solid: 1 });
      }
    }

    // 岩石群
    for (let c = 0; c < 5; c++) {
      const cx = rr(150, S - 150), cy = rr(150, S - 150);
      const n = rri(6, 14), rad = rr(30, 70);
      for (let i = 0; i < n; i++) {
        const a = rr(TAU), d = Math.sqrt(rnd()) * rad;
        const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d;
        if (this.inRiver(x, y, 26) || this.nearEdge(x, y, MARGIN)) continue;
        const s = rr(3.5, 7);
        this.obstacles.push({ x: x - s, y: y - s, w: s * 2, h: s * 2, type: 'rock', r: s, solid: 1 });
      }
    }

    // 冰原（冬季区块，减速）
    const iceCX = rr(250, S - 250), iceCY = rr(250, S - 250);
    this.iceZones = [{ x: iceCX, y: iceCY, r: rr(120, 190) }];

    // 城镇：网格状街区 + 建筑
    const townCX = rr(S * 0.3, S * 0.7), townCY = rr(S * 0.3, S * 0.7);
    this.town = { x: townCX, y: townCY, r: rr(200, 280) };
    const blockN = 4 + rri(0, 2);
    const blockSize = 130;
    for (let by = 0; by < blockN; by++) {
      for (let bx = 0; bx < blockN; bx++) {
        const ox = townCX + (bx - blockN / 2) * blockSize + rr(-14, 14);
        const oy = townCY + (by - blockN / 2) * blockSize + rr(-14, 14);
        if (ox < MARGIN || oy < MARGIN || ox > S - MARGIN || oy > S - MARGIN) continue;
        if (this.inRiver(ox, oy, 70)) continue;
        // 每个街区：1~3 栋建筑 + 木箱 + 油桶
        const nb = rri(1, 3);
        for (let i = 0; i < nb; i++) {
          const t = BUILDINGS[rri(0, BUILDINGS.length - 1)];
          const px = ox + rr(-30, 30), py = oy + rr(-30, 30);
          if (px < MARGIN || py < MARGIN || px > S - MARGIN || py > S - MARGIN) continue;
          if (this.inRiver(px, py, 46)) continue;
          this.obstacles.push({ x: px - t.w / 2, y: py - t.h / 2, w: t.w, h: t.h, type: 'wall', r: 3, solid: 1 });
        }
        if (rnd() < 0.55) this.obstacles.push({ x: ox + rr(-40, 40), y: oy + rr(-40, 40), w: 9, h: 9, type: 'crate', r: 4.5, solid: 1, breakable: 1, hp: 60 });
        if (rnd() < 0.4) this.obstacles.push({ x: ox + rr(-40, 40), y: oy + rr(-40, 40), w: 8, h: 8, type: 'barrel', r: 4, solid: 1, breakable: 1, hp: 40, expl: 'barrel' });
      }
    }

    // 散落障碍（避免空旷）
    for (let i = 0; i < 60; i++) {
      const x = rr(110, S - 110), y = rr(110, S - 110);
      if (this.inRiver(x, y, 30) || this.nearEdge(x, y, MARGIN)) continue;
      const s = rr(2.5, 5);
      this.obstacles.push({ x: x - s, y: y - s, w: s * 2, h: s * 2, type: 'rock', r: s, solid: 1 });
    }
    for (let i = 0; i < 40; i++) {
      const x = rr(110, S - 110), y = rr(110, S - 110);
      if (this.inRiver(x, y, 26) || this.nearEdge(x, y, MARGIN)) continue;
      this.obstacles.push({ x: x - 2, y: y - 2, w: 4, h: 4, type: 'bush', r: 2, solid: 0, hide: 1 });
    }

    // ---- 可搜刮容器（补给箱） ----
    for (let i = 0; i < 26; i++) {
      const x = rr(MARGIN, S - MARGIN), y = rr(MARGIN, S - MARGIN);
      this.crates.push({ x, y, r: 6, opened: false, tier: 'reg' });
    }
    // 空投点固定 3 处（保证落在可行走区内）
    this.airdropSpots = [];
    for (let i = 0; i < 3; i++) {
      const a = rnd() * TAU, d = rr(180, S * 0.38);
      this.airdropSpots.push({
        x: clamp(S / 2 + Math.cos(a) * d, MARGIN, S - MARGIN),
        y: clamp(S / 2 + Math.sin(a) * d, MARGIN, S - MARGIN)
      });
    }

    // ---- 地面掉落物 ----
    this.spawnLoot();
  }

  nearEdge(x, y, m) { return x < m || y < m || x > MAP - m || y > MAP - m; }

  inRiver(x, y, pad = 0) {
    const pts = this.riverPts;
    if (!pts || !pts.length) return false;
    const i = clamp(Math.floor(x / 64), 0, pts.length - 1);
    const p = pts[i];
    if (!p) return false;
    return Math.abs(y - p.y) < p.w / 2 + pad;
  }

  inIce(x, y) {
    for (const z of this.iceZones) if (dist2(x, y, z.x, z.y) < z.r * z.r) return true;
    return false;
  }

  /** 撒初始掉落物 */
  spawnLoot() {
    const S = MAP;
    const n = 300;
    for (let i = 0; i < n; i++) {
      const M2 = C.oceanSize + C.beachSize + 20;
      const x = rand(M2, S - M2), y = rand(M2, S - M2);
      if (this.inRiver(x, y, 8)) continue;
      this.spawnOne(x, y, 'ground');
    }
  }

  /** 掉落一件物品 */
  spawnOne(x, y, from = 'ground') {
    let kind;
    if (from === 'airdrop') kind = pick(['airdrop_guns', 'airdrop_guns', 'heals', 'equipment', 'throwables', 'ammo']);
    else if (from === 'crate') kind = weightedPick(LOOT_WEIGHTS.crate);
    else kind = weightedPick(LOOT_WEIGHTS.ground);

    let id;
    if (kind === 'guns') id = weightedPick(LOOT_WEIGHTS.guns);
    else if (kind === 'airdrop_guns') id = weightedPick(LOOT_WEIGHTS.airdrop_guns);
    else if (kind === 'equipment') id = weightedPick(LOOT_WEIGHTS.equipment);
    else if (kind === 'heals') id = weightedPick(LOOT_WEIGHTS.heals);
    else if (kind === 'throwables') id = weightedPick(LOOT_WEIGHTS.throwables);
    else if (kind === 'ammo') {
      // 从常见弹药里挑
      const common = ['9mm', '762mm', '556mm', '12g', '545mm'];
      id = pick(common);
      return this.pushLoot(x, y, 'ammo', id, randi(AMMOS[id].min, AMMOS[id].min * 2.2));
    }
    else if (kind === 'scopes') {
      const list = Object.keys(SCOPES).filter(s => !SCOPES[s].def);
      if (!list.length) return;
      return this.pushLoot(x, y, 'scope', pick(list));
    }
    else if (kind === 'melee') id = weightedPick(LOOT_WEIGHTS.melee);
    else return;

    if (!id) return;
    if (GUNS[id]) return this.pushLoot(x, y, 'gun', id);
    if (MELEES[id]) return this.pushLoot(x, y, 'melee', id);
    if (THROWABLES[id]) return this.pushLoot(x, y, 'throwable', id);
    if (ARMORS[id]) return this.pushLoot(x, y, 'armor', id);
    if (PACKS[id]) return this.pushLoot(x, y, 'pack', id);
    if (HEALS[id]) return this.pushLoot(x, y, 'heal', id, randi(1, 2));
    if (SCOPES[id]) return this.pushLoot(x, y, 'scope', id);
  }

  pushLoot(x, y, kind, id, count = 1) {
    const B = C.oceanSize + C.beachSize + 12;
    const l = {
      x: clamp(x + rand(-6, 6), B, MAP - B),
      y: clamp(y + rand(-6, 6), B, MAP - B),
      kind, id, count,
      vx: rand(-.05, .05), vy: rand(-.05, .05),
      born: this.time, life: 99999
    };
    if (kind === 'gun' || kind === 'melee') l.r = C.lootRadiusGun;
    else if (kind === 'ammo') l.r = C.lootRadiusAmmo;
    else if (kind === 'heal') l.r = C.lootRadiusSmall;
    else l.r = C.lootRadiusBig;
    this.loot.push(l);
    return l;
  }

  lootRadius(kind) {
    return kind === 'gun' || kind === 'melee' ? C.lootRadiusGun
      : kind === 'ammo' ? C.lootRadiusAmmo
      : kind === 'heal' ? C.lootRadiusSmall : C.lootRadiusBig;
  }

  /** 掉落物名称 */
  lootName(l) {
    const T = { gun: GUNS, melee: MELEES, throwable: THROWABLES, armor: ARMORS, pack: PACKS, heal: HEALS, scope: SCOPES, ammo: AMMOS };
    return (T[l.kind] && T[l.kind][l.id] && T[l.kind][l.id].n) || l.id;
  }

  lootTier(l) {
    const T = { gun: GUNS, melee: MELEES, throwable: THROWABLES, armor: ARMORS, pack: PACKS, heal: HEALS, scope: SCOPES };
    if (l.kind === 'ammo') return 'D';
    return (T[l.kind] && T[l.kind][l.id] && T[l.kind][l.id].tier) || 'D';
  }

  /** 障碍物阻挡：把实体沿墙推开 */
  resolveCollision(e, radius) {
    const near = this.grid.query(e.x, e.y, radius + 16);
    for (const o of near) {
      if (!o.solid) continue;
      const cx = clamp(e.x, o.x, o.x + o.w);
      const cy = clamp(e.y, o.y, o.y + o.h);
      const dx = e.x - cx, dy = e.y - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 < radius * radius) {
        if (d2 > 1e-6) {
          const d = Math.sqrt(d2);
          e.x = cx + dx / d * radius;
          e.y = cy + dy / d * radius;
        } else {
          // 圆心在障碍内：推向最近边
          const l = e.x - o.x, rr2 = o.x + o.w - e.x, t = e.y - o.y, b = o.y + o.h - e.y;
          const m = Math.min(l, rr2, t, b);
          if (m === l) e.x = o.x - radius;
          else if (m === rr2) e.x = o.x + o.w + radius;
          else if (m === t) e.y = o.y - radius;
          else e.y = o.y + o.h + radius;
        }
        e.vx = e.vx ? e.vx * .3 : 0; e.vy = e.vy ? e.vy * .3 : 0;
      }
    }
  }

  /** 子弹是否被障碍物阻挡 */
  bulletBlocked(x1, y1, x2, y2) {
    const midx = (x1 + x2) / 2, midy = (y1 + y2) / 2;
    const span = dist(x1, y1, x2, y2);
    const near = this.grid.query(midx, midy, span / 2 + 20);
    for (const o of near) {
      if (!o.solid) continue;
      if (segAABB(x1, y1, x2, y2, o.x, o.y, o.w, o.h)) return o;
    }
    return null;
  }

  /** 破坏可破坏障碍 */
  damageObstacle(o, dmg) {
    if (!o.breakable) return false;
    o.hp -= dmg;
    if (o.hp <= 0) {
      o.dead = true;
      if (o.expl === 'barrel') return true; // 触发爆炸
      return true;
    }
    return false;
  }

  update(dt) {
    this.time += dt;
    // 掉落物物理（轻阻尼）
    for (const l of this.loot) {
      l.x += l.vx * dt * 60; l.y += l.vy * dt * 60;
      l.vx -= l.vx * C.lootDrag * 60 * dt * 6;
      l.vy -= l.vy * C.lootDrag * 60 * dt * 6;
      if (Math.abs(l.vx) < 1e-4) l.vx = 0;
      if (Math.abs(l.vy) < 1e-4) l.vy = 0;
      l.x = clamp(l.x, 12, MAP - 12); l.y = clamp(l.y, 12, MAP - 12);
    }
    // 清理
    for (let i = this.obstacles.length - 1; i >= 0; i--) if (this.obstacles[i].dead) this.obstacles.splice(i, 1);
  }
}

/** 确定性随机数发生器（mulberry32），保证同 seed 同地图 */
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// =====================================================================
//  毒圈 · 移植 gasStages.ts 13 阶段时序
// =====================================================================
export class Gas {
  constructor() {
    this.reset();
  }
  reset() {
    this.stage = 0;
    this.timer = 0;
    this.cx = MAP / 2; this.cy = MAP / 2;
    this.r = MAP * 0.76;
    this.startR = this.r; this.endR = this.r;
    this.dps = 0;
    this.dropped = false;
    this.active = false;
    this.announced = -1;
  }
  get stageDef() { return GAS_STAGES[this.stage]; }
  get curR() {
    const d = GAS_STAGES[this.stage];
    if (d.state === 'waiting') return this.endR;
    const t = clamp(this.timer / (d.dur * 1000), 0, 1);
    return lerpN(this.startR, this.endR, t);
  }
  update(dt) {
    if (this.stage >= GAS_STAGES.length - 1) { this.dps = 10; return; }
    this.timer += dt * 1000;
    const d = GAS_STAGES[this.stage];
    this.dps = d.dps;
    this.active = this.stage > 0;
    if (this.timer >= d.dur * 1000) {
      // 进入下一阶段
      this.stage++;
      const nd = GAS_STAGES[this.stage];
      this.timer = 0;
      this.startR = this.curR;
      // 新圆心在旧圈内随机，且安全区至少 75% 落在地图内
      const maxOff = Math.max(0, this.startR - nd.to * MAP * 0.75);
      const a = rand(TAU), d2 = rand(0, maxOff);
      this.cx = clamp(this.cx + Math.cos(a) * d2, nd.to * MAP * 0.5, MAP - nd.to * MAP * 0.5);
      this.cy = clamp(this.cy + Math.sin(a) * d2, nd.to * MAP * 0.5, MAP - nd.to * MAP * 0.5);
      this.endR = nd.to * MAP;
      this.dropped = false;
    }
  }
  /** 距离圈外深度（正数=在圈内安全，负数=圈外） */
  insideDist(x, y) { return this.curR - dist(x, y, this.cx, this.cy); }
  /** 每秒伤害 */
  damageAt(x, y, resist = 0) {
    const into = -this.insideDist(x, y);
    if (into <= 0) return 0;
    const extra = clamp(into - C.gasUnscaledDamageDist, 0, 1e9) * C.gasDamageScaleFactor;
    return (this.dps + extra) * (1 - resist);
  }
}

function lerpN(a, b, t) { return a + (b - a) * t; }

// =====================================================================
//  天赋选择
// =====================================================================
export const PERK_POOL = Object.keys(PERKS);

export function rollPerks(n) {
  const out = [];
  const pool = [...PERK_POOL];
  for (let i = 0; i < n && pool.length; i++) {
    out.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  }
  return out;
}

/** 把天赋合并成修正器对象 */
export function perkMods(ids) {
  const m = {
    spd: 1, fireMod: 1, reloadMod: 1, dmgMod: 1, adrenDrain: 1, adrenMax: 0,
    maxHealth: 0, lootRange: 1, infAmmo: false, vampiric: 0, scav: 0, lastStand: false,
    gasResist: 0, constRegen: 0, dashCd: 1, healMod: 1, longReduce: 0, selfBlast: 1,
    ammoBonus: 1, exec: 1, cutoff: 0
  };
  for (const id of ids) {
    const p = PERKS[id];
    if (!p) continue;
    if (p.spd) m.spd *= p.spd;
    if (p.fireMod) m.fireMod *= p.fireMod;
    if (p.reloadMod) m.reloadMod *= p.reloadMod;
    if (p.dmgMod) m.dmgMod *= p.dmgMod;
    if (p.adrenDrain) m.adrenDrain *= p.adrenDrain;
    if (p.adrenMax) m.adrenMax += p.adrenMax;
    if (p.maxHealth) m.maxHealth += p.maxHealth;
    if (p.lootRange) m.lootRange *= p.lootRange;
    if (p.infAmmo) m.infAmmo = true;
    if (p.vampiric) m.vampiric = p.vampiric;
    if (p.scav) m.scav += p.scav;
    if (p.lastStand) m.lastStand = true;
    if (p.gasResist) m.gasResist += p.gasResist;
    if (p.constRegen) m.constRegen += p.constRegen;
    if (p.dashCd) m.dashCd *= p.dashCd;
    if (p.healMod) m.healMod *= p.healMod;
    if (p.longReduce) m.longReduce += p.longReduce;
    if (p.selfBlast) m.selfBlast *= p.selfBlast;
    if (p.ammoBonus) m.ammoBonus *= p.ammoBonus;
    if (p.exec) m.exec = p.exec;
    if (p.cutoff) m.cutoff = p.cutoff;
  }
  return m;
}
