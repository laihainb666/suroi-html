// =====================================================================
//  游戏主循环 · 固定步长累加器 + 状态机
//  借鉴 tokugame 的状态机与顿帧/慢动作/震屏手感，改用固定步长以保证
//  16+ AI 与数百弹丸下的一致性
// =====================================================================
import {
  C, GUNS, MELEES, THROWABLES, AMMOS, ARMORS, PACKS, HEALS, SCOPES,
  TIER_COL, TIER_ORDER, GAS_STAGES
} from './data.js';
import { clamp, rand, randi, pick, dist, dist2, lerp, angDiff, TAU, FX, AudioSys, Grid } from './core.js';
import { World, Gas, MAP, rollPerks, perkMods } from './world.js';
import { Player, Bullet, Throwable, doExplosion, pendingBarrelBlasts } from './entities.js';
import { AIController, aiParams } from './ai.js';

export const STATE = { MENU: 'menu', PLAYING: 'playing', PAUSE: 'pause', RESULT: 'result', DEAD: 'dead' };

const FIXED_DT = 1 / 120;

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.state = STATE.MENU;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.cam = { x: MAP / 2, y: MAP / 2, zoom: 1, targetZoom: 1 };
    this.killFeed = [];
    this.announce = null;
    this.shakeT = 0;
    this.timeScale = 1;
    this.hitstop = 0;
    this.fps = 60;
    this.settings = loadSettings();
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.canvas.width = Math.floor(w * this.dpr);
    this.canvas.height = Math.floor(h * this.dpr);
    this.vw = w; this.vh = h;
  }

  // ---------- 开局 ----------
  start(opts = {}) {
    const botCount = clamp(opts.bots ?? 39, 1, 79);
    const diff = clamp(opts.diff ?? 3, 1, 5);
    const seed = (Math.random() * 0xffffffff) >>> 0;

    this.world = new World(seed);
    this.gas = new Gas();
    this.bullets = [];
    this.throwables = [];
    this.players = [];
    this.ais = [];
    this.time = 0;
    this.acc = 0;
    this.killFeed = [];
    this.announce = null;
    this.hitstop = 0;
    this.timeScale = 1;
    this.stats = { kills: 0, damage: 0, survived: 0, rank: 0, total: botCount + 1, uses: 0, picks: 0 };
    this.perkChoices = null;
    this.resultData = null;
    this.matchOver = false;
    this.airdropT = 0;
    this.airdrops = [];
    this.lowHpWarned = false;
    this.zoneWarned = -1;

    // 玩家出生：优先地图中部（保证不贴边、视野开阔）
    const pcx = MAP * 0.5, pcy = MAP * 0.5;
    let ps = null;
    for (let k = 0; k < 60; k++) {
      const a = rand(TAU), d = k < 20 ? rand(0, 60) : rand(0, MAP * 0.22);
      const x = clamp(pcx + Math.cos(a) * d, MAP * 0.22, MAP * 0.78);
      const y = clamp(pcy + Math.sin(a) * d, MAP * 0.22, MAP * 0.78);
      if (this.world.inRiver(x, y, 30)) continue;
      let blocked = false;
      for (const o of this.world.grid.query(x, y, 10)) {
        if (!o.solid) continue;
        if (x > o.x - 6 && x < o.x + o.w + 6 && y > o.y - 6 && y < o.y + o.h + 6) { blocked = true; break; }
      }
      if (blocked) continue;
      ps = { x, y }; break;
    }
    if (!ps) ps = { x: pcx, y: pcy };
    this.player = new Player(ps.x, ps.y, false, 'YOU');
    this.player.perks = rollPerks(this.settings.perkCount ?? 3);
    this.player.refreshMods();
    this.players.push(this.player);

    // Bot 出生
    for (let i = 0; i < botCount; i++) {
      const s = this.findSpawn(2);
      const p = new Player(s.x, s.y, true);
      const lvl = clamp(Math.round(diff + rand(-1, 1)), 1, 5);
      p.perks = rollPerks(randi(1, 3));
      p.refreshMods();
      this.players.push(p);
      this.ais.push(new AIController(p, this.world, lvl));
    }

    // 每队 1 人（solo）
    for (const p of this.players) p.team = null;

    this.state = STATE.PLAYING;
    this.snapCam();
    AudioSys.ensure();
    AudioSys.startMusic('battle');
    this.announceMsg('SPEC OPS DEPLOYED', 1.6);
  }

  findSpawn(tryMax = 200) {
    // 可行走内陆范围（避开海洋圈）
    const lo = C.oceanSize + C.beachSize + 24;
    const hi = MAP - lo;
    const midLo = MAP * 0.18, midHi = MAP * 0.82;
    for (let i = 0; i < tryMax; i++) {
      // 85% 概率在中部 18%~82% 区域刷，15% 允许全境
      let x, y;
      if (Math.random() < 0.85) {
        x = rand(midLo, midHi); y = rand(midLo, midHi);
      } else {
        x = rand(lo, hi); y = rand(lo, hi);
      }
      if (this.world.inRiver(x, y, 30)) continue;
      if (this.world.nearEdge(x, y, lo)) continue;
      // 不要落在障碍物里
      let blocked = false;
      for (const o of this.world.grid.query(x, y, 10)) {
        if (!o.solid) continue;
        if (x > o.x - 5 && x < o.x + o.w + 5 && y > o.y - 5 && y < o.y + o.h + 5) { blocked = true; break; }
      }
      if (blocked) continue;
      let ok = true;
      for (const p of this.players) if (dist2(x, y, p.x, p.y) < 110 * 110) { ok = false; break; }
      if (ok) return { x, y };
    }
    // 兜底：中部均匀网格取点（仍在可行走区内）
    const cells = Math.ceil(Math.sqrt(this.players.length + 1));
    const n = Math.floor(Math.random() * cells * cells);
    const gx = n % cells, gy = Math.floor(n / cells);
    const step = (midHi - midLo) / cells;
    return { x: midLo + step * (gx + 0.5), y: midLo + step * (gy + 0.5) };
  }

  /** 由 main.js 注入的渲染器 */
  setRenderer(r) { this._renderer = r; }

  // ---------- 固定步长循环 ----------
  frame(dtRaw) {
    // FPS 计数
    this.fps = this.fps * 0.92 + (1 / Math.max(1e-4, dtRaw)) * 0.08;

    // 顿帧（tokugame hitstop）
    let scale = this.timeScale;
    if (this.hitstop > 0) { this.hitstop -= dtRaw; scale = 0.05; }
    let dt = dtRaw * scale;

    if (this.state === STATE.PLAYING) {
      this.acc += Math.min(dtRaw, 0.1);
      let steps = 0;
      while (this.acc >= FIXED_DT && steps < 8) {
        this.step(FIXED_DT);
        this.acc -= FIXED_DT;
        steps++;
      }
      if (steps >= 8) this.acc = 0;
    } else if (this.world) {
      // 菜单/暂停时世界静止但特效继续
      FX.update(dtRaw * 0.4);
    }

    // 渲染（由 main.js 注入的 Renderer 负责）
    if (this._renderer) this._renderer.render();
    else if (this.ctx) { /* 无渲染器时跳过 */ }
  }

  step(dt) {
    this.time += dt;
    const w = this.world, gas = this.gas;

    // ---- 毒圈推进 ----
    const prevStage = gas.stage;
    gas.update(dt);
    if (gas.stage !== prevStage) {
      const d = GAS_STAGES[gas.stage];
      if (d.state === 'waiting' && d.drop && !gas.dropped) {
        gas.dropped = true;
        this.spawnAirdrop();
      }
      if (gas.stage >= 1) {
        const msg = d.state === 'advancing' ? `ZONE CLOSING · ${d.dps} DPS` : `ZONE SHRINKS IN ${d.dur}s`;
        this.announceMsg(msg, 2.0);
        AudioSys.sfx('zone');
      }
    }
    // 新阶段倒计时播报
    const dcur = GAS_STAGES[gas.stage];
    if (dcur && dcur.state === 'waiting' && dcur.dur > 0) {
      const remain = dcur.dur - gas.timer / 1000;
      if (remain < 10 && Math.floor(remain) !== this.zoneWarned && remain > 0) {
        this.zoneWarned = Math.floor(remain);
        this.announceMsg(`ZONE ${Math.ceil(remain)}s`, 0.8);
        AudioSys.sfx('warn');
      }
    }

    // ---- 世界 ----
    w.update(dt);

    // ---- AI 决策 & 玩家输入 ----
    for (let i = 0; i < this.players.length; i++) {
      const p = this.players[i];
      if (!p.alive) continue;
      let input;
      if (p.isBot) {
        const ai = this.ais[i];
        input = ai ? ai.think(dt, this.players, gas, this.time) : { mx: 0, my: 0, fire: false };
        this.applyAIInput(p, input, dt);
      } else {
        input = this._playerInput ? this._playerInput() : { mx: 0, my: 0, aim: 0 };
        this.applyPlayerInput(p, input, dt);
      }
      p.update(dt, w, this.time, input);
    }

    // ---- 子弹 ----
    for (const b of this.bullets) b.update(dt, w, this.players, this.time);
    for (let i = this.bullets.length - 1; i >= 0; i--) if (this.bullets[i].dead) this.bullets.splice(i, 1);

    // ---- 投掷物 ----
    for (const t of this.throwables) {
      t.update(dt, w, this.time);
      if (t.dead && !t._done) {
        t._done = true;
        const eid = t.def.expl;
        if (eid) doExplosion(this, w, this.players, t.x, t.y, eid, t.owner, this.time);
      }
    }
    this.throwables = this.throwables.filter(t => !t._done);

    // ---- 油桶连锁爆炸 ----
    while (pendingBarrelBlasts.length) {
      const b = pendingBarrelBlasts.shift();
      doExplosion(this, w, this.players, b.x, b.y, 'barrel', b.owner, this.time);
    }

    // ---- 空投 ----
    this.updateAirdrops(dt);

    // ---- 毒圈伤害 ----
    for (const p of this.players) {
      if (!p.alive || p.downed) continue;
      const resist = p.mods.gasResist || 0;
      const dmg = gas.damageAt(p.x, p.y, resist);
      if (dmg > 0) {
        p.health -= dmg * dt;
        p.hitFlash = Math.max(p.hitFlash, 0.1);
        if (p.health <= 0) { p.die(null, w, this.time); this.onDeath(p, null, 'zone'); }
      }
    }

    // ---- 倒地玩家 ----
    for (const p of this.players) {
      if (p.downed && p.alive) {
        // 自动救援（单人模式：无人救则倒计时结束）
      }
    }

    // ---- 拾取 ----
    this.updatePickups(dt);

    // ---- 击杀处理 ----
    this.checkDeaths();

    // ---- 特效 ----
    FX.update(dt);

    // ---- 相机 ----
    this.updateCamera(dt);

    // ---- 胜负判定 ----
    const alive = this.players.filter(p => p.alive);
    if (!this.player.alive && !this.matchOver) {
      this.matchOver = true;
      this.stats.survived = this.time;
      this.stats.rank = alive.length + 1;
      this.endMatch(false);
    } else if (alive.length <= 1 && !this.matchOver) {
      this.matchOver = true;
      this.stats.survived = this.time;
      this.stats.rank = 1;
      this.endMatch(this.player.alive);
    }
  }

  // ---------- 输入应用 ----------
  applyPlayerInput(p, input, dt) {
    if (!p.alive) return;
    p.aim = input.aim;
    if (input.fire) p.fire(this, this.time);
    if (input.reload) p.startReload();
    if (input.dash) p.tryDash(input);
    if (input.swap) p.gunSlot = 1 - p.gunSlot;
    if (input.item) p.useItem(input.item);
    if (input.throwNow && p.throwCount > 0) this.doThrow(p, input.aim);
    // 拾取
    if (input.pickup) this.tryPickup(p);
  }

  applyAIInput(p, input, dt) {
    if (!p.alive) return;
    input.aim = p.aim;
    if (input.fire) p.fire(this, this.time);
    if (input.reload) p.startReload();
    if (input.dash) p.tryDash(input);
    if (input.swap) p.gunSlot = 1 - p.gunSlot;
    if (input.item) p.useItem(input.item);
    if (input.throwAt && p.throwCount > 0) {
      const a = Math.atan2(input.throwAt.y - p.y, input.throwAt.x - p.x);
      this.doThrow(p, a);
    }
    // AI 顺带拾取
    if (Math.random() < 0.35) this.tryPickup(p);
  }

  doThrow(p, ang) {
    p.throwCount--;
    this.throwables.push(new Throwable(p.x, p.y, ang, p, p.throwable));
    AudioSys.sfx('pin');
  }

  // ---------- 拾取 ----------
  updatePickups(dt) {
    const w = this.world;
    for (const p of this.players) {
      if (!p.alive || p.downed) continue;
      const range = this.lootRangeOf(p);
      // 倒序遍历：takeLoot 内部会 splice 掉已拾取的元素，正序会读到 undefined
      for (let i = w.loot.length - 1; i >= 0; i--) {
        const l = w.loot[i];
        if (!l) continue;
        const d2 = dist2(p.x, p.y, l.x, l.y);
        const r = Math.max(l.r, 4) + range;
        if (d2 < r * r) this.takeLoot(p, l);
      }
      // 搜刮容器
      for (const c of w.crates) {
        if (c.opened) continue;
        if (dist2(p.x, p.y, c.x, c.y) < 12 * 12) {
          c.opened = true;
          const n = randi(2, 4);
          for (let i = 0; i < n; i++) w.spawnOne(c.x + rand(-10, 10), c.y + rand(-10, 10), 'crate');
          FX.rtext(c.x, c.y - 4, 'CRATE', '#ffd166', 11);
          AudioSys.sfx('pickup');
        }
      }
    }
  }

  lootRangeOf(p) {
    const base = 3.5 * (p.mods.lootRange || 1);
    return base;
  }

  tryPickup(p) {
    // 计数统一在 takeLoot 内完成，这里只负责触发
    for (let i = this.world.loot.length - 1; i >= 0; i--) {
      const l = this.world.loot[i];
      if (!l) continue;
      if (dist2(p.x, p.y, l.x, l.y) < 9 * 9) this.takeLoot(p, l);
    }
  }

  /** 拾取一件物品：返回是否成功 */
  takeLoot(p, l) {
    const idx = this.world.loot.indexOf(l);
    if (idx < 0) return false;
    let taken = false;

    if (l.kind === 'gun') {
      const slot = p.guns.findIndex(g => !g);
      if (slot >= 0) {
        const d = GUNS[l.id];
        const res = p.ammo[d.ammo] || 0;
        p.guns[slot] = { id: l.id, ammo: d.mag };
        if (res > 0) p.ammo[d.ammo] -= Math.min(res, d.mag * 2);
        taken = true;
      } else if (p.guns[0] && GUNS[p.guns[0].id].ammo === GUNS[l.id].ammo) {
        // 同弹药：补备弹
        const d = GUNS[l.id];
        const cap = AMMOS[d.ammo].max;
        if ((p.ammo[d.ammo] || 0) < cap) { p.ammo[d.ammo] = Math.min(cap, (p.ammo[d.ammo] || 0) + d.mag); taken = true; }
      }
    }
    else if (l.kind === 'melee') {
      if (p.melee !== l.id || MELEES[l.id].tier > TIER_ORDER[MELEES[p.melee]?.tier || 'D']) {
        if (p.melee && p.melee !== 'fists' && l.id !== 'fists') this.world.pushLoot(p.x, p.y, 'melee', p.melee);
        p.melee = l.id; taken = true;
      }
    }
    else if (l.kind === 'throwable') {
      if (p.throwCount < 4) { p.throwCount++; p.throwable = l.id; taken = true; }
    }
    else if (l.kind === 'armor') {
      const a = ARMORS[l.id];
      if (a.slot === 'head') {
        if (!p.armorHead || a.lvl > ARMORS[p.armorHead].lvl) {
          if (p.armorHead) this.world.pushLoot(p.x, p.y, 'armor', p.armorHead);
          p.armorHead = l.id; taken = true;
        }
      } else {
        if (!p.armorBody || a.lvl > ARMORS[p.armorBody].lvl) {
          if (p.armorBody) this.world.pushLoot(p.x, p.y, 'armor', p.armorBody);
          p.armorBody = l.id; taken = true;
        }
      }
    }
    else if (l.kind === 'pack') {
      const a = PACKS[l.id];
      const cur = PACKS[p.pack];
      if (a.lvl > cur.lvl) { p.pack = l.id; taken = true; }
    }
    else if (l.kind === 'heal') {
      const h = HEALS[l.id];
      const cap = PACKS[p.pack];
      const capKey = { gauze: 'gauze', medikit: 'medikit', cola: 'cola', tablets: 'tablets', vaccine_syringe: 'syringe' }[l.id];
      const capV = l.id === 'vaccine_syringe' ? cap.syringe : cap[capKey];
      if (p.heals[l.id] < capV) {
        const add = Math.min(l.count, capV - p.heals[l.id]);
        p.heals[l.id] += add;
        if (add < l.count) l.count -= add; else taken = true;
      }
    }
    else if (l.kind === 'ammo') {
      const a = AMMOS[l.id];
      const cur = p.ammo[l.id] || 0;
      let amt = l.count;
      if (p.mods.ammoBonus > 1) amt = Math.floor(amt * p.mods.ammoBonus);
      if (a.max === 0) { taken = true; } // ephemeral
      else if (cur < a.max) {
        const add = Math.min(amt, a.max - cur);
        p.ammo[l.id] = cur + add;
        if (add < amt) l.count -= add; else taken = true;
      }
    }
    else if (l.kind === 'scope') {
      const cur = SCOPES[p.scope];
      if (SCOPES[l.id].zoom > cur.zoom) { p.scope = l.id; taken = true; }
    }

    if (taken) {
      this.world.loot.splice(idx, 1);
      if (p === this.player) {
        AudioSys.sfx('pickup');
        FX.rtext(p.x, p.y - 5, this.world.lootName(l), TIER_COL[this.world.lootTier(l)] || '#e8eef7', 11);
        this.stats.picks++;
      }
    }
    return taken;
  }

  // ---------- 击杀结算 ----------
  checkDeaths() {
    for (const p of this.players) {
      if (!p.alive) continue;
      if (p.downed && p.downTimer <= 0) {
        p.alive = false;
        this.onDeath(p, p.lastDamageFrom, p.lastDamageFrom ? 'gun' : 'bleed');
      }
    }
  }

  onDeath(victim, killer, cause) {
    if (victim._deathHandled) return;
    victim._deathHandled = true;
    victim.alive = false;

    if (killer && killer !== victim && killer.alive) {
      killer.kills++;
      killer.boostKills++;
      killer.boostT = 12;
      // Vampiric
      if (killer.mods.vampiric) {
        killer.health = Math.min(killer.maxHealth, killer.health + killer.mods.vampiric);
        killer.adren = Math.min(killer.maxAdren, killer.adren + killer.mods.vampiric);
        FX.rtext(killer.x, killer.y - 6, 'VAMPIRIC', '#ff6b8a', 12);
      }
      // Scavenger：掉空投
      if (killer.mods.scav && Math.random() < killer.mods.scav) this.spawnAirdrop(true, killer);
      // 连杀播报
      if (killer.boostKills >= 3 && killer === this.player) {
        this.announceMsg(`${killer.boostKills} KILL STREAK`, 1.4);
        AudioSys.sfx('warn');
      }
    }

    this.addKillFeed(victim, killer, cause);
    AudioSys.sfx(victim === this.player ? 'die' : 'kill');
    if (victim === this.player) {
      this.hitstop = 0.14;
      this.timeScale = 0.25;
      setTimeout(() => { if (this.state === STATE.PLAYING) this.timeScale = 1; }, 320);
      FX.flash = 0.5; FX.flashCol = '255,60,60';
    }
  }

  addKillFeed(victim, killer, cause) {
    const kn = killer ? killer.name : (cause === 'zone' ? '毒圈' : '环境');
    this.killFeed.unshift({ k: kn, v: victim.name, vc: victim.isBot ? '#9aa5b1' : '#5ec8ff', t: this.time, cause });
    if (this.killFeed.length > 7) this.killFeed.pop();
  }

  // ---------- 空投 ----------
  spawnAirdrop(silent = false, near = null) {
    const w = this.world;
    const B = C.oceanSize + C.beachSize + 20;
    let x, y;
    if (near) {
      const a = rand(TAU), d = rand(60, 220);
      x = clamp(near.x + Math.cos(a) * d, B, MAP - B);
      y = clamp(near.y + Math.sin(a) * d, B, MAP - B);
    } else {
      const s = pick(w.airdropSpots);
      x = s.x; y = s.y;
    }
    this.airdrops.push({ x, y, t: 0, fall: C.airdropFallTime / 1000, landed: false, chute: true });
    if (!silent) {
      this.announceMsg('SUPPLY DROP INBOUND', 1.6);
      AudioSys.sfx('airdrop');
    }
  }

  updateAirdrops(dt) {
    for (let i = this.airdrops.length - 1; i >= 0; i--) {
      const a = this.airdrops[i];
      a.t += dt;
      if (!a.landed) {
        if (a.t >= a.fall) {
          a.landed = true;
          // 散落物品
          const n = randi(3, 5);
          for (let k = 0; k < n; k++) this.world.spawnOne(a.x + rand(-16, 16), a.y + rand(-16, 16), 'airdrop');
          FX.ring(a.x, a.y, '#ffd166', 40, .5);
          FX.smoke(a.x, a.y, 6);
        }
      } else if (a.t > a.fall + 999) {
        this.airdrops.splice(i, 1);
      }
    }
  }

  // ---------- 相机 ----------
  snapCam() {
    this.cam.x = this.player.x; this.cam.y = this.player.y;
  }

  updateCamera(dt) {
    const p = this.player;
    const def = SCOPES[p.scope];
    // 目标缩放：以屏幕高度为基准。镜倍率越大视野越远，
    // 但用 sqrt 压缩，避免高倍镜把画面缩到看不见角色
    const zoomK = Math.sqrt(def.zoom / 70);
    const baseScale = this.vh / (70 * 14) * Math.pow(zoomK, 0.85);
    this.cam.targetZoom = clamp(baseScale, 0.22, 3.2);
    // 指数缓动（借鉴 tokugame 相机弹簧）
    const k = 1 - Math.exp(-dt * 5.5);
    this.cam.zoom = lerp(this.cam.zoom, this.cam.targetZoom, k);

    // 瞄准偏移
    let tx = p.x, ty = p.y;
    const def2 = p.gunDef;
    if (def2) {
      const lead = clamp(def2.len * 2.2, 8, 42);
      tx += Math.cos(p.aim) * lead;
      ty += Math.sin(p.aim) * lead;
    }
    const kx = 1 - Math.exp(-dt * 9);
    this.cam.x = lerp(this.cam.x, tx, kx);
    this.cam.y = lerp(this.cam.y, ty, kx);
  }

  // ---------- 结束 ----------
  endMatch(win) {
    this.stats.kills = this.player.kills;
    this.stats.damage = Math.round(this.player.damageDealt);
    this.stats.uses = this.player.uses;
    this.stats.picks = this.stats.picks;
    this.stats.win = win;
    this.resultData = { ...this.stats, time: this.time };
    this.state = STATE.RESULT;
    AudioSys.stopMusic();
    if (win) AudioSys.sfx('win'); else AudioSys.sfx('die');
    this.onResult && this.onResult(this.resultData);
  }

  announceMsg(txt, dur = 2) {
    this.announce = { txt, t: 0, dur };
  }
}

export function loadSettings() {
  try { return JSON.parse(localStorage.getItem('suroi-settings') || '{}'); }
  catch { return {}; }
}
export function saveSettings(s) {
  try { localStorage.setItem('suroi-settings', JSON.stringify(s)); } catch {}
}
