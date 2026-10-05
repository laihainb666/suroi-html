// =====================================================================
//  实体 · Player / Bullet / Throwable / Explosion
//  移动与射击严格对齐原版公式（adrenSpeedMod / 散布 / 后坐）
// =====================================================================
import {
  C, GUNS, MELEES, THROWABLES, AMMOS, ARMORS, PACKS, HEALS, SCOPES, EXPLOSIONS,
  adrenSpeedMod, adrenRegen, TIER_COL
} from './data.js';
import { clamp, rand, randi, pick, dist, dist2, angDiff, TAU, FX, AudioSys, segCircle, segAABB } from './core.js';
import { MAP, OB, perkMods } from './world.js';

const BOT_NAMES = [
  'Viper', 'Nomad', 'Cipher', 'Rook', 'Onyx', 'Juno', 'Blitz', 'Haven', 'Quill', 'Drift',
  'Ash', 'Cobalt', 'Dusk', 'Echo', 'Flint', 'Gale', 'Husk', 'Iris', 'Jinx', 'Kilo',
  'Lumen', 'Mako', 'Nyx', 'Opal', 'Pyre', 'Quartz', 'Raven', 'Slate', 'Talon', 'Umbra',
  'Vandal', 'Wisp', 'Xeno', 'Yara', 'Zephyr', 'Basilisk', 'Cinder', 'Dozer', 'Ember', 'Frost'
];

export class Player {
  constructor(x, y, isBot, name) {
    this.x = x; this.y = y;
    this.vx = 0; this.vy = 0;
    this.isBot = isBot;
    this.name = name || (isBot ? pick(BOT_NAMES) : 'YOU');
    this.r = C.playerRadius;

    // 战斗属性
    this.maxHealth = C.defaultHealth;
    this.health = C.defaultHealth;
    this.maxAdren = C.maxAdrenaline;
    this.adren = C.maxAdrenaline;
    this.alive = true;
    this.downed = false;
    this.downTimer = 0;
    this.reviveProgress = 0;

    // 装备
    this.guns = [null, null];       // 两个主武器槽
    this.gunSlot = 0;
    this.melee = 'kbar';
    this.throwable = 'frag_grenade';
    this.throwCount = 1;
    this.armorHead = null;
    this.armorBody = null;
    this.pack = 'bag';
    this.scope = 's1';
    this.ammo = {};                 // 弹药存量
    this.heals = { gauze: 0, medikit: 0, cola: 0, tablets: 0, vaccine_syringe: 0 };
    this.perks = [];

    // 状态
    this.reloadT = 0; this.reloadDur = 0;
    this.usingT = 0; this.usingDur = 0; this.usingItem = null;
    this.lastFire = -9999;
    this.burstLeft = 0;
    this.altFire = false;
    this.recoil = 0; this.recoilAng = 0;
    this.aim = 0;
    this.moving = false;
    this.lastDamageT = -9999;
    this.lastDamageFrom = null;
    this.kills = 0; this.damageDealt = 0;
    this.uses = 0;

    // 冲刺（新增增强机制，原版无）
    this.dashT = 0; this.dashCd = 0; this.dashDir = 0;
    this.dashMaxCd = 3;

    // 视觉
    this.hitFlash = 0;
    this.walkPhase = rand(TAU);
    this.deadT = 0;
    this.boostKills = 0; // 连杀计数
    this.boostT = 0;

    this.mods = perkMods([]);
    this.refreshMods();
    for (const k in AMMOS) this.ammo[k] = 0;
    // 出生自带
    this.guns[0] = { id: 'g19', ammo: 15 };
    this.throwCount = 1;
    this.heals.cola = 1;
  }

  refreshMods() {
    const m = perkMods(this.perks);
    this.mods = m;
    const newMax = C.defaultHealth + m.maxHealth;
    if (newMax !== this.maxHealth) {
      const ratio = this.health / this.maxHealth;
      this.maxHealth = newMax;
      this.health = clamp(this.health * 0 + newMax * ratio, 1, newMax);
    }
    this.maxAdren = C.maxAdrenaline + m.adrenMax;
    this.adren = clamp(this.adren, 0, this.maxAdren);
  }

  get gun() { return this.guns[this.gunSlot]; }
  get gunDef() { return this.gun ? GUNS[this.gun.id] : null; }

  get speedModBase() {
    let s = C.speedModMelee;
    if (this.gun) s = C.speedModGun;
    else if (this.throwable && this.throwCount > 0) s = C.speedModThrowable;
    if (this.downed) s *= 0.5;
    if (this.usingT > 0) s *= 0.55;
    if (this.mods.spd && this.perks.includes('second_wind')) {
      if (this.health / this.maxHealth < 0.5) s *= 1.4;
    }
    return s;
  }

  /** 当前速度（units/ms） */
  get speed() {
    if (this.dashT > 0) return C.baseSpeed * 3.4;
    let s = C.baseSpeed * this.speedModBase * this.mods.spd;
    s *= adrenSpeedMod(this.adren);
    if (this.gun) s *= (GUNS[this.gun.id].sm || 1);
    if (this.perks.includes('low_profile')) { /* 仅减伤 */ }
    return s;
  }

  addPerk(id) {
    if (this.perks.length >= C.maxPerks) return false;
    this.perks.push(id);
    this.refreshMods();
    return true;
  }

  // ---------- 射击 ----------
  canFire(game) {
    if (!this.gun || !this.alive || this.downed) return false;
    if (this.reloadT > 0 || this.usingT > 0 || this.dashT > 0) return false;
    const def = this.gunDef;
    if (this.magOf() <= 0) return false;
    return true;
  }

  magOf() { return this.gun ? this.gun.ammo : 0; }
  magMax() {
    if (!this.gun) return 0;
    const d = GUNS[this.gun.id];
    const hasExt = this.perks.includes('extended_capacity') || this.guns.some(g => g && GUNS[g.id].mag === d.mag * 2);
    if (d.dual) return d.mag;
    return hasExt ? d.ext || d.mag : d.mag;
  }
  reserveOf() { return this.gun ? (this.ammo[GUNS[this.gun.id].ammo] || 0) : 0; }

  fire(game, time) {
    if (!this.canFire(game)) return false;
    const def = this.gunDef;
    const isShotgun = (def.bc || 1) > 3;

    if (def.mode === 'burst' && this.burstLeft <= 0) this.burstLeft = def.burst;
    else if (def.mode !== 'burst') this.burstLeft = 0;

    const delay = def.mode === 'burst' && this.burstLeft > 0
      ? (this.burstLeft === def.burst ? (def.bcd || def.f) : def.f * this.mods.fireMod)
      : def.f * this.mods.fireMod;

    if (time - this.lastFire < delay) return false;

    this.lastFire = time;
    if (!this.mods.infAmmo) this.gun.ammo--;
    if (def.mode === 'burst') { this.burstLeft--; if (this.burstLeft <= 0) this.burstLeft = 0; }

    // 散布（对齐原版 gunItem.ts:144）
    let spreadDeg = def.spd;
    const fsaOk = def.fsa && (time - this.lastFire) >= def.fsa / 1000;
    const now = time - this.lastFire;
    spreadDeg = this.moving ? def.mspd : def.spd;
    if (def.fsa && now <= 0.001) spreadDeg = def.spd;

    // 后坐
    this.recoil = Math.min(1, this.recoil + 0.35);
    const rc = def.rc;
    this.recoilAng = (this.recoilAng + rand(-1, 1) * rc * 0.06) * 0.7;

    const shots = def.bc || 1;
    for (let i = 0; i < shots; i++) {
      let a = this.aim + (this.recoilAng || 0) + (rand(-1, 1) * spreadDeg * Math.PI / 180);
      if (def.jit) {
        a += rand(-def.jit, def.jit) * 0.02;
      }
      let ox = Math.cos(this.aim) * def.len;
      let oy = Math.sin(this.aim) * def.len;
      if (def.dual) {
        const off = def.dual;
        const px = Math.cos(this.aim + Math.PI / 2) * (this.altFire ? off : -off);
        const py = Math.sin(this.aim + Math.PI / 2) * (this.altFire ? off : -off);
        ox += px; oy += py;
        this.altFire = !this.altFire;
      }
      game.bullets.push(new Bullet(
        this.x + ox, this.y + oy, a,
        def.sp, def.rng, def.dmg * this.mods.dmgMod, this,
        def.ammo, def.obs, def.tier || 'D'
      ));
    }

    AudioSys[isShotgun ? 'shotgun' : 'shot'](def.tier);
    FX.spark(this.x + Math.cos(this.aim) * def.len, this.y + Math.sin(this.aim) * def.len,
      ['#ffe9a8', '#ffd166'], 4, 0.7);
    return true;
  }

  startReload() {
    if (!this.gun || this.reloadT > 0) return;
    const def = this.gunDef;
    const need = this.magMax() - this.gun.ammo;
    if (need <= 0) return;
    if (this.reserveOf() <= 0) return;
    let dur = def.r * 1000;
    if (def.rf && this.gun.ammo === 0) dur = (def.frt || def.r * 2) * 1000;
    if (this.mods.cutoff && this.meleeTarget) dur /= this.mods.reloadMod;
    else dur /= this.mods.reloadMod;
    this.reloadDur = dur;
    this.reloadT = dur;
    AudioSys.sfx('reload');
  }

  finishReload() {
    if (!this.gun) return;
    const def = this.gunDef;
    const need = this.magMax() - this.gun.ammo;
    if (need <= 0) return;
    const res = this.ammo[def.ammo] || 0;
    const spr = def.spr || 1; // 每次装填的子弹数（霰弹枪=1/2）
    const take = Math.min(need, Math.floor(res / spr)) * spr;
    this.gun.ammo += take;
    if (!this.mods.infAmmo) this.ammo[def.ammo] = res - take;
  }

  useItem(id) {
    if (this.usingT > 0 || this.reloadT > 0) return false;
    const h = HEALS[id];
    if (!h || (this.heals[id] || 0) <= 0) return false;
    const cap = PACKS[this.pack];
    const capKey = { gauze: 'gauze', medikit: 'medikit', cola: 'cola', tablets: 'tablets', vaccine_syringe: 'syringe' }[id];
    if (id !== 'vaccine_syringe' && this.heals[id] >= (cap[capKey] || 0)) return false;
    this.usingDur = h.time * 1000 / this.mods.healMod;
    this.usingT = this.usingDur;
    this.usingItem = id;
    return true;
  }

  finishItem() {
    const id = this.usingItem;
    if (!id) return;
    const h = HEALS[id];
    if (h.type === 'hp') this.health = Math.min(this.maxHealth, this.health + h.amt);
    else if (h.type === 'adren') this.adren = Math.min(this.maxAdren, this.adren + h.amt);
    else if (h.type === 'special') { this.adren = Math.min(this.maxAdren, this.adren + 50); this.infected = false; }
    this.heals[id]--;
    this.uses++;
    this.usingItem = null;
    AudioSys.sfx('heal');
  }

  // ---------- 受伤 ----------
  damage(amount, from, world, time, opts = {}) {
    if (!this.alive || this.downed) return 0;

    // Last Stand：致命伤免疫一次
    if (this.mods.lastStand && !this._lsUsed && amount >= this.health) {
      this._lsUsed = true;
      this.health = 40;
      FX.rtext(this.x, this.y - 6, 'LAST STAND', '#ffd166', 14);
      FX.ring(this.x, this.y, '#ffd166', 30, .5);
      AudioSys.sfx('warn');
      return 0;
    }

    let dmg = amount;
    // 护甲减伤
    if (this.armorBody) dmg *= (1 - ARMORS[this.armorBody].dr);
    if (this.armorHead) dmg *= (1 - ARMORS[this.armorHead].dr * 0.5);
    // Low Profile：远距离减伤
    if (from && this.mods.longReduce && dist(this.x, this.y, from.x, from.y) > 250) {
      dmg *= (1 - this.mods.longReduce);
    }
    // Executioner：残血增伤
    if (from && from.mods && from.mods.exec > 1 && this.health / this.maxHealth < 0.4) {
      dmg *= from.mods.exec;
    }

    this.health -= dmg;
    this.lastDamageT = time;
    this.lastDamageFrom = from;
    this.hitFlash = 0.18;
    this.boostKills = 0; this.boostT = 0;

    if (from && from !== this) from.damageDealt += dmg;

    // 肾上腺素受击激励
    this.adren = Math.min(this.maxAdren, this.adren + dmg * 0.12);

    const dir = from ? Math.atan2(this.y - from.y, this.x - from.x) : 0;
    FX.blood(this.x, this.y, dir);
    FX.rtext(this.x, this.y - 4, Math.round(dmg).toString(), dmg > 30 ? '#ff6b5a' : '#ffd9d0', dmg > 30 ? 15 : 11);
    AudioSys.sfx(this.armorBody ? 'hitArmor' : 'hit');

    if (this.health <= 0) {
      this.die(from, world, time);
      return dmg;
    }
    return dmg;
  }

  die(from, world, time) {
    if (this.downed) { this.alive = false; this.deadT = time; return; }
    this.downed = true;
    this.downed = true;
    this.downTimer = C.bleedOutDPMs > 0 ? 8000 : 8000;
    this.health = 1;
    // 掉落全部装备
    this.dropAll(world);
    AudioSys.sfx('hurt');
  }

  dropAll(world) {
    const drop = (x, y, kind, id, count = 1) => world.pushLoot(x, y, kind, id, count);
    const jx = rand(-8, 8), jy = rand(-8, 8);
    for (let i = 0; i < 2; i++) if (this.guns[i]) drop(this.x + jx, this.y + jy, 'gun', this.guns[i].id);
    drop(this.x + jx, this.y + jy, 'melee', this.melee);
    if (this.throwCount > 0) drop(this.x + jx, this.y + jy, 'throwable', this.throwable);
    if (this.armorHead) drop(this.x + jx, this.y + jy, 'armor', this.armorHead);
    if (this.armorBody) drop(this.x + jx, this.y + jy, 'armor', this.armorBody);
    for (const k in this.heals) if (this.heals[k] > 0) drop(this.x + jx, this.y + jy, 'heal', k, this.heals[k]);
    for (const k in this.ammo) if (this.ammo[k] > 0) drop(this.x + jx, this.y + jy, 'ammo', k, this.ammo[k]);
    this.guns = [null, null]; this.armorHead = null; this.armorBody = null;
  }

  // ---------- 每帧更新 ----------
  update(dt, world, time, input) {
    if (!this.alive) { this.deadT = time; return; }

    // 肾上腺素衰减
    let drain = C.adrenDecay * this.mods.adrenDrain * (this.perks.includes('experimental_treatment') ? 0 : 1);
    this.adren = Math.max(0, this.adren - drain * dt * 1000);

    // 回血
    let regen = adrenRegen(this.adren) * 0.012;
    if (this.mods.constRegen) regen += this.mods.constRegen * 0.01;
    if (regen > 0 && this.health < this.maxHealth && time - this.lastDamageT > 4) {
      this.health = Math.min(this.maxHealth, this.health + regen * dt * 1000);
    }

    // 换弹
    if (this.reloadT > 0) {
      this.reloadT -= dt * 1000;
      if (this.reloadT <= 0) { this.reloadT = 0; this.finishReload(); }
    }
    // 使用物品
    if (this.usingT > 0) {
      this.usingT -= dt * 1000;
      if (this.usingT <= 0) { this.usingT = 0; this.finishItem(); }
    }
    // 冲刺冷却
    if (this.dashCd > 0) this.dashCd -= dt;
    if (this.dashT > 0) this.dashT -= dt;
    // 后坐衰减
    this.recoil = Math.max(0, this.recoil - dt * 2.2);
    this.recoilAng *= (1 - dt * 6);
    this.hitFlash = Math.max(0, this.hitFlash - dt);

    // 连杀加速
    if (this.boostT > 0) { this.boostT -= dt; if (this.boostT <= 0) this.boostKills = 0; }

    // 倒地倒计时
    if (this.downed) {
      this.downTimer -= dt * 1000;
      if (this.downTimer <= 0) { this.alive = false; this.deadT = time; }
      return;
    }

    // 移动
    const sp = this.speed;
    if (this.dashT > 0) {
      this.vx = Math.cos(this.dashDir) * sp;
      this.vy = Math.sin(this.dashDir) * sp;
    } else {
      let ix = input.mx || 0, iy = input.my || 0;
      const m = Math.hypot(ix, iy);
      if (m > 1) { ix /= m; iy /= m; }
      this.moving = m > 0.05;
      const iceMod = world.inIce(this.x, this.y) ? 0.45 : 1;
      const waterMod = world.inRiver(this.x, this.y) ? 0.62 : 1;
      this.vx = ix * sp * iceMod * waterMod;
      this.vy = iy * sp * iceMod * waterMod;
      if (this.moving) this.walkPhase += dt * 13;
    }

    this.x += this.vx * dt * 1000;
    this.y += this.vy * dt * 1000;

    // 边界（对齐 oceanSize，锁在可行走内陆内）
    const B = C.oceanSize + C.beachSize + 4;
    this.x = clamp(this.x, B, MAP - B);
    this.y = clamp(this.y, B, MAP - B);

    // 障碍碰撞
    world.resolveCollision(this, this.r);

    // 灌木隐身
    this.hidden = false;
    for (const o of world.grid.query(this.x, this.y, 8)) {
      if (o.hide && dist2(this.x, this.y, o.x + o.w / 2, o.y + o.h / 2) < 16) { this.hidden = true; break; }
    }
  }

  tryDash(input) {
    if (this.dashCd > 0 || this.dashT > 0 || !this.alive || this.downed) return false;
    let dx = input.mx || 0, dy = input.my || 0;
    if (Math.hypot(dx, dy) < 0.1) { dx = Math.cos(this.aim); dy = Math.sin(this.aim); }
    this.dashDir = Math.atan2(dy, dx);
    this.dashT = 0.16;
    this.dashCd = this.dashMaxCd * this.mods.dashCd;
    AudioSys.sfx('dash');
    FX.ring(this.x, this.y, '#8fe3ff', 14, .25);
    return true;
  }
}

// =====================================================================
//  子弹
// =====================================================================
export class Bullet {
  constructor(x, y, ang, speed, range, dmg, owner, ammoType, obstacleMult, tier) {
    this.x = x; this.y = y;
    this.ox = x; this.oy = y;
    this.ang = ang;
    this.speed = speed;      // units/ms
    this.range = range;
    this.dmg = dmg;
    this.owner = owner;
    this.ammoType = ammoType;
    this.obsMult = obstacleMult || 1;
    this.tier = tier || 'D';
    this.travelled = 0;
    this.dead = false;
    this.px = x; this.py = y;
  }
  update(dt, world, players, time) {
    if (this.dead) return;
    const step = this.speed * dt * 1000;
    this.px = this.x; this.py = this.y;
    let nx = this.x + Math.cos(this.ang) * step;
    let ny = this.y + Math.sin(this.ang) * step;

    this.travelled += step;
    if (this.travelled > this.range) { this.dead = true; return; }

    // 障碍阻挡
    const ob = world.bulletBlocked(this.x, this.y, nx, ny);
    if (ob) {
      FX.impact(nx, ny, '#cfd6e4');
      // 障碍物可能被击碎
      if (ob.breakable) {
        const broke = world.damageObstacle(ob, this.dmg * this.obsMult);
        if (broke && ob.expl) pendingBarrelBlasts.push({ x: ob.x + ob.w / 2, y: ob.y + ob.h / 2, owner: this.owner });
        else if (broke) FX.smoke(nx, ny, 4);
      }
      this.dead = true;
      return;
    }

    // 玩家命中（用线段-圆检测避免高速穿透）
    const rad = step + 4;
    const cand = world.grid.query(this.x, this.y, rad + 8).concat(
      players.filter(p => !world.grid.query(this.x, this.y, 1).includes(p) && dist2(p.x, p.y, this.x, this.y) < 400)
    );
    let hit = null, hitT = 2;
    for (const p of cand) {
      if (p === this.owner || !p.alive || p.downed) continue;
      if (p.team !== undefined && p.team === this.owner.team && this.owner.team !== null) continue;
      if (segCircle(this.x, this.y, nx, ny, p.x, p.y, p.r + 0.6)) {
        const t = tParamOnSeg(this.x, this.y, nx, ny, p.x, p.y);
        if (t < hitT) { hitT = t; hit = p; }
      }
    }
    if (hit) {
      const hx = lerp(this.x, nx, hitT), hy = lerp(this.y, ny, hitT);
      this.x = hx; this.y = hy;
      hit.damage(this.dmg, this.owner, world, time);
      this.dead = true;
      return;
    }

    this.x = nx; this.y = ny;
    FX.trail(this.x, this.y, TIER_COL[this.tier] || '#ffe9a8');
  }
}

function tParamOnSeg(x1, y1, x2, y2, px, py) {
  const dx = x2 - x1, dy = y2 - y1;
  const l2 = dx * dx + dy * dy;
  if (l2 < 1e-9) return 0;
  return clamp(((px - x1) * dx + (py - y1) * dy) / l2, 0, 1);
}
function lerp(a, b, t) { return a + (b - a) * t; }

// =====================================================================
//  投掷物
// =====================================================================
export class Throwable {
  constructor(x, y, ang, owner, id) {
    this.x = x; this.y = y;
    this.z = 0.5;
    this.vz = 4;
    const d = Math.min(C.maxThrowDistance, 30);
    this.vx = Math.cos(ang) * d * 0.055;
    this.vy = Math.sin(ang) * d * 0.055;
    this.ang = ang;
    this.owner = owner;
    this.id = id;
    this.def = THROWABLES[id];
    this.fuse = this.def.fuse;
    this.dead = false;
    this.zone = rand(TAU);
  }
  update(dt, world, time) {
    if (this.dead) return;
    this.fuse -= dt * 1000;
    this.z += this.vz * dt;
    this.vz -= C.projectileGravity * dt;
    if (this.z <= 0) { this.z = 0; this.vz = Math.abs(this.vz) * 0.32; }
    this.x += this.vx * dt * 60 * 0.6;
    this.y += this.vy * dt * 60 * 0.6;
    this.vx *= 0.965; this.vy *= 0.965;
    const B = C.oceanSize + C.beachSize;
    this.x = clamp(this.x, B, MAP - B); this.y = clamp(this.y, B, MAP - B);
    world.resolveCollision(this, 1);
    if (this.fuse <= 0) this.dead = true;
  }
}

// =====================================================================
//  爆炸结算
// =====================================================================
export function doExplosion(game, world, players, x, y, explId, owner, time) {
  const e = EXPLOSIONS[explId] || EXPLOSIONS.frag;
  if (!e || e.dmg <= 0) {
    if (explId === 'smoke') { FX.smoke(x, y, 30, 'rgba(200,205,215,.5)'); return; }
    return;
  }
  const R = rand(e.min, e.max);
  AudioSys.explosion();
  FX.explosionBig(x, y);
  // 障碍破坏
  for (const o of world.grid.query(x, y, R + 12)) {
    if (!o.breakable) continue;
    const d = dist(x, y, o.x + o.w / 2, o.y + o.h / 2);
    if (d < R + 6) world.damageObstacle(o, e.dmg);
  }
  // 伤害玩家
  for (const p of players) {
    if (!p.alive || p.downed) continue;
    const d = dist(x, y, p.x, p.y);
    if (d > R) continue;
    // 遮挡检测
    const dirx = (p.x - x) / (d || 1), diry = (p.y - y) / (d || 1);
    if (world.bulletBlocked(x, y, x + dirx * d, y + diry * d)) continue;
    let dmg = e.dmg * (1 - d / R);
    if (p === owner) dmg *= (owner.mods ? owner.mods.selfBlast : 1);
    p.damage(dmg, owner, world, time);
  }
  // 破片
  if (e.shards > 0) {
    for (let i = 0; i < e.shards; i++) {
      const a = rand(TAU);
      game.bullets.push(new Bullet(x, y, a, e.sspd * 2, e.srng, e.sdmg, owner, 'shard', 1, 'D'));
    }
  }
}

export const pendingBarrelBlasts = [];
