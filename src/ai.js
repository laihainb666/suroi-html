// =====================================================================
//  AI · 借鉴 tokugame 的参数化难度曲线（14039-14053）
//  但重写整个决策层：状态机 + 掩体寻找 + 毒圈赶路 + 听声辨位
//  架构沿用「AI 输出伪装成玩家输入」——AI 走与玩家完全相同的代码路径
// =====================================================================
import { GUNS, MELEES, C } from './data.js';
import { clamp, rand, randi, pick, dist, dist2, angDiff, TAU } from './core.js';
import { MAP } from './world.js';

/** 难度 1..5 的参数曲线 */
export function aiParams(level) {
  const t = (level - 1) / 4;
  return {
    level,
    react: lerp(0.55, 0.10, t),      // 反应延迟（秒）
    aggr: lerp(0.30, 0.98, t),       // 进攻欲望
    aimErr: lerp(0.42, 0.055, t),    // 瞄准误差（弧度）
    aimTrack: lerp(1.6, 9.0, t),     // 瞄准跟随速度
    burstDiscipline: lerp(0.35, 0.95, t), // 纪律性（越高越会点射控枪）
    seekCover: lerp(0.15, 0.9, t),   // 找掩体倾向
    zoneSense: lerp(0.4, 1.0, t),    // 毒圈意识
    reactRange: lerp(160, 460, t),   // 索敌范围
    kite: lerp(0.10, 0.55, t),       // 拉扯倾向
    reloadSense: lerp(0.5, 1.0, t),  // 换弹时机
    throwSkill: lerp(0.05, 0.6, t),
    lootDrive: lerp(0.5, 0.25, t)    // 贪心程度
  };
}
function lerp(a, b, t) { return a + (b - a) * t; }

export const AI_STATE = {
  LOOT: 'loot',      // 搜集物资
  ROTATE: 'rotate',  // 向安全区移动
  ENGAGE: 'engage',  // 交战
  HUNT: 'hunt',      // 追击残血
  COVER: 'cover',    // 找掩体回复
  FLEE: 'flee'       // 逃跑（血量低且孤立）
};

/**
 * AI 的理想交战距离：按武器有效射程推算
 * 自动/霰弹枪贴脸，单发栓动远程狙击
 */
function idealRange(p) {
  const def = p.gunDef;
  if (!def) return 45;
  if ((def.bc || 1) > 3) return 32;          // 霰弹枪
  if (def.mode === 'burst') return 130;
  if (def.tier === 'S' && def.mode === 'single' && def.rng > 200) return 260;
  if (def.mode === 'auto') return 165;
  return 190;
}

export class AIController {
  constructor(player, world, level) {
    this.p = player;
    this.world = world;
    this.pp = aiParams(level);
    this.state = AI_STATE.LOOT;
    this.stateT = 0;
    this.decideT = rand(0.2, 0.8);
    this.target = null;
    this.lastSeenT = -99;
    this.lastSeenX = 0; this.lastSeenY = 0;
    this.strafeDir = pick([-1, 1]);
    this.strafeT = rand(.6, 1.6);
    this.aimTarget = 0;
    this.aimNoise = rand(TAU);
    this.burstShots = 0;
    this.lootTarget = null;
    this.coverPt = null;
    this.heardShots = [];   // 听声辨位记录
    this.wanderPt = null;
    this.wanderT = 0;
    this.lastHpFrac = 1;
  }

  /** 生成一份与玩家同构的输入 */
  think(dt, players, gas, time) {
    const p = this.p;
    if (!p.alive || p.downed) return { mx: 0, my: 0, fire: false, reload: false, dash: false, item: null, swap: false };

    this.stateT += dt;
    this.decideT -= dt;
    this.strafeT -= dt;
    if (this.strafeT <= 0) { this.strafeDir *= -1; this.strafeT = rand(.5, 1.5); }

    // ---- 感知：索敌 ----
    let best = null, bestD = Infinity;
    for (const o of players) {
      if (o === p || !o.alive || o.downed) continue;
      if (o.team !== undefined && o.team === p.team && p.team !== null) continue;
      const d = dist(p.x, p.y, o.x, o.y);
      const range = this.pp.reactRange * (p.gun && GUNS[p.gun.id].mode === 'single' && GUNS[p.gun.id].tier === 'S' ? 1.25 : 1);
      if (d > range) continue;
      // 灌木隐身：距离越远越难发现
      if (o.hidden && d > 90) continue;
      // 视野需在瞄准方向附近（简化：360 度感知 + 距离衰减）
      if (d < bestD) { bestD = d; best = o; }
    }
    if (best) {
      this.target = best;
      this.lastSeenT = time;
      this.lastSeenX = best.x; this.lastSeenY = best.y;
    }

    // ---- 决策状态机 ----
    if (this.decideT <= 0) {
      this.decideT = this.pp.react * rand(.7, 1.4);
      this.decide(players, gas, time, best, bestD);
    }

    // ---- 瞄准 ----
    let aimTarget;
    if (this.target && time - this.lastSeenT < 3.5) {
      aimTarget = Math.atan2(this.lastSeenY - p.y, this.lastSeenX - p.x);
      // 目标移动预测
      const lead = clamp(dist(p.x, p.y, this.lastSeenX, this.lastSeenY) / 300, 0, .28);
      aimTarget += (this.target.vx || 0) * lead * 0.02 + (this.target.vy || 0) * lead * 0.02;
    } else if (this.lootTarget) {
      aimTarget = Math.atan2(this.lootTarget.y - p.y, this.lootTarget.x - p.x);
    } else {
      this.aimNoise += rand(-.5, .5) * dt;
      aimTarget = this.aimNoise;
    }
    // 瞄准误差 + 平滑跟随
    this.aimNoise += rand(-1, 1) * dt * 3;
    const err = this.pp.aimErr * (this.state === AI_STATE.ENGAGE ? 1 : 1.4);
    const desired = aimTarget + rand(-1, 1) * err * 0.35;
    p.aim = p.aim + angDiff(desired, p.aim) * clamp(this.pp.aimTrack * dt, 0, 1);

    // ---- 移动 ----
    let mx = 0, my = 0;
    let dash = false;

    switch (this.state) {
      case AI_STATE.ENGAGE: {
        const t = this.target;
        if (t) {
          const d = dist(p.x, p.y, t.x, t.y);
          const ideal = idealRange(p);
          const ang = Math.atan2(t.y - p.y, t.x - p.x);
          const angPerp = ang + Math.PI / 2 * this.strafeDir;
          // 保持理想距离 + 侧移
          if (d > ideal * 1.25) { mx += Math.cos(ang); my += Math.sin(ang); }
          else if (d < ideal * 0.55) { mx -= Math.cos(ang); my -= Math.sin(ang); }
          const kite = this.pp.kite;
          mx += Math.cos(angPerp) * kite * 1.3;
          my += Math.sin(angPerp) * kite * 1.3;
          // 残血且换弹 → 拉远
          if ((p.reloadT > 0 || p.gun && p.magOf() <= 0) && d < 140) { mx -= Math.cos(ang) * 0.9; my -= Math.sin(ang) * 0.9; }
          // 紧急规避
          if (p.hitFlash > 0 && Math.random() < 0.12) { dash = true; }
        }
        break;
      }
      case AI_STATE.COVER: {
        if (this.coverPt) {
          const d = dist(p.x, p.y, this.coverPt.x, this.coverPt.y);
          if (d < 10) { mx = 0; my = 0; }
          else { mx = (this.coverPt.x - p.x) / d; my = (this.coverPt.y - p.y) / d; }
        }
        break;
      }
      case AI_STATE.FLEE: {
        const t = this.target || { x: this.lastSeenX, y: this.lastSeenY };
        const d = dist(p.x, p.y, t.x, t.y) || 1;
        mx = -(t.x - p.x) / d; my = -(t.y - p.y) / d;
        // 远离地图边缘
        if (p.x < 120) mx += 1; if (p.x > MAP - 120) mx -= 1;
        if (p.y < 120) my += 1; if (p.y > MAP - 120) my -= 1;
        dash = this.strafeT > 1.1 && Math.random() < 0.1;
        break;
      }
      case AI_STATE.HUNT: {
        const d = dist(p.x, p.y, this.lastSeenX, this.lastSeenY);
        if (d > 6) { mx = (this.lastSeenX - p.x) / d; my = (this.lastSeenY - p.y) / d; }
        dash = d > 90 && Math.random() < 0.03;
        break;
      }
      case AI_STATE.ROTATE: {
        const d = dist(p.x, p.y, gas.cx, gas.cy);
        const r = gas.curR;
        if (d > r * 0.78) {
          const a = Math.atan2(gas.cy - p.y, gas.cx - p.x);
          // 加一点随机偏移，避免排队
          const jitter = Math.sin(time * 0.7 + p.walkPhase) * 0.35;
          mx = Math.cos(a + jitter); my = Math.sin(a + jitter);
          dash = d > r && Math.random() < 0.03;
        }
        break;
      }
      case AI_STATE.LOOT: {
        // 找最近的有用战利品
        if (!this.lootTarget || !this.lootTarget.alive || dist2(p.x, p.y, this.lootTarget.x, this.lootTarget.y) > 2500) {
          this.lootTarget = this.findLoot();
        }
        if (this.lootTarget) {
          const d = dist(p.x, p.y, this.lootTarget.x, this.lootTarget.y);
          if (d > 3) { mx = (this.lootTarget.x - p.x) / d; my = (this.lootTarget.y - p.y) / d; }
        } else {
          this.wanderT -= dt;
          if (!this.wanderPt || this.wanderT <= 0 || dist2(p.x, p.y, this.wanderPt.x, this.wanderPt.y) < 900) {
            this.wanderPt = { x: rand(120, MAP - 120), y: rand(120, MAP - 120) };
            this.wanderT = rand(4, 9);
          }
          const d = dist(p.x, p.y, this.wanderPt.x, this.wanderPt.y) || 1;
          mx = (this.wanderPt.x - p.x) / d; my = (this.wanderPt.y - p.y) / d;
        }
        break;
      }
    }

    // ---- 避障：探测前方，前方有墙则侧滑 ----
    const m = Math.hypot(mx, my);
    if (m > 0.05) {
      const lookX = p.x + (mx / m) * 14, lookY = p.y + (my / m) * 14;
      if (this.world.bulletBlocked(p.x, p.y, lookX, lookY)) {
        // 尝试左右绕
        const a = Math.atan2(my, mx);
        const tryL = a + 0.9, tryR = a - 0.9;
        if (!this.world.bulletBlocked(p.x, p.y, p.x + Math.cos(tryL) * 16, p.y + Math.sin(tryL) * 16)) {
          mx = Math.cos(tryL); my = Math.sin(tryL);
        } else if (!this.world.bulletBlocked(p.x, p.y, p.x + Math.cos(tryR) * 16, p.y + Math.sin(tryR) * 16)) {
          mx = Math.cos(tryR); my = Math.sin(tryR);
        } else { mx = Math.cos(a + Math.PI / 2); my = Math.sin(a + Math.PI / 2); }
      }
    }

    // ---- 开火决策 ----
    let fire = false;
    if (this.state === AI_STATE.ENGAGE && this.target && time - this.lastSeenT < 0.9) {
      const t = this.target;
      const d = dist(p.x, p.y, t.x, t.y);
      const def = p.gunDef;
      if (def) {
        const inRange = d < def.rng * 0.92;
        const facing = Math.abs(angDiff(p.aim, Math.atan2(t.y - p.y, t.x - p.x))) < 0.28;
        const aligned = facing && inRange;
        // 纪律性：越低越容易长按扫射
        if (aligned && Math.random() < this.pp.burstDiscipline * (def.mode === 'auto' ? 1 : 0.9)) {
          // 距离很远时不开火
          if (d > 60 || this.stateT > this.pp.react * 1.2) fire = true;
        }
        // 霰弹枪要求更近
        if ((def.bc || 1) > 3 && d > 90) fire = false;
      } else if (d < 60) {
        // 近战
        fire = Math.abs(angDiff(p.aim, Math.atan2(t.y - p.y, t.x - p.x))) < 0.4;
      }
      // 投掷物
      if (Math.random() < this.pp.throwSkill * dt * 2 && d > 70 && d < 220 && p.throwCount > 0) {
        // 用投掷物
        return { mx, my, fire: false, reload: false, dash, item: 'throw', swap: false, throwAt: { x: t.x, y: t.y } };
      }
    }

    // ---- 换弹 ----
    let reload = false;
    const def = p.gunDef;
    if (def && p.reloadT <= 0) {
      const magPct = p.magOf() / p.magMax();
      const reserve = p.reserveOf();
      const noAmmo = p.magOf() === 0;
      if (noAmmo || (reserve > 0 && magPct < 0.25 && (!this.target || dist(p.x, p.y, this.target.x, this.target.y) > 120 * this.pp.reloadSense)))
        reload = true;
    }

    // ---- 治疗 ----
    let item = null;
    const hpFrac = p.health / p.maxHealth;
    if (hpFrac < 0.55 && p.usingT <= 0 && time - p.lastDamageT > 3.5) {
      if (p.heals.medikit > 0) item = 'medikit';
      else if (p.heals.gauze > 0) item = 'gauze';
    } else if (p.adren < p.maxAdren * 0.5 && p.usingT <= 0 && time - p.lastDamageT > 2) {
      if (p.heals.tablets > 0) item = 'tablets';
      else if (p.heals.cola > 0) item = 'cola';
    }

    // ---- 换枪 ----
    let swap = false;
    if (def && this.target && p.reserveOf() === 0 && p.magOf() === 0) {
      if (p.guns[1 - p.gunSlot]) swap = true;
    }

    this.lastHpFrac = hpFrac;
    return { mx, my, fire, reload, dash, item, swap, throwAt: null };
  }

  // ---------- 状态决策 ----------
  decide(players, gas, time, seen, seenD) {
    const p = this.p;
    const hpFrac = p.health / p.maxHealth;
    const prev = this.state;

    // 1) 毒圈紧急 → ROTATE（最高优先级）
    const gd = gas.insideDist(p.x, p.y);
    const urgent = gd < gas.curR * 0.12;
    const gasDps = gas.dps;
    if (urgent && this.pp.zoneSense > 0.5) { this.state = AI_STATE.ROTATE; }

    // 2) 血量低 + 有威胁 → COVER / FLEE
    else if (hpFrac < 0.28 && (this.target || time - this.lastSeenT < 4)) {
      const canHeal = p.heals.medikit > 0 || p.heals.gauze > 0 || p.heals.tablets > 0 || p.heals.cola > 0;
      if (canHeal && this.pp.seekCover > Math.random()) {
        this.coverPt = this.findCover();
        this.state = AI_STATE.COVER;
      } else if (hpFrac < 0.16) this.state = AI_STATE.FLEE;
    }

    // 3) 有目标 → ENGAGE / HUNT
    else if (seen && seenD < this.pp.reactRange) {
      const tHp = seen.health / seen.maxHealth;
      if (tHp < 0.3 && seenD > 60 && Math.random() < this.pp.aggr) this.state = AI_STATE.HUNT;
      else this.state = AI_STATE.ENGAGE;
    }

    // 4) 需要舔包（换枪/护甲/弹药）
    else if (this.needsLoot() && Math.random() < this.pp.lootDrive + 0.3) {
      this.state = AI_STATE.LOOT;
    }

    // 5) 圈内待命 / 巡逻
    else if (gas.active && gd < gas.curR * 0.3 && Math.random() < 0.7) {
      this.state = AI_STATE.LOOT;
    }
    else this.state = AI_STATE.ROTATE;

    if (prev !== this.state) this.stateT = 0;
  }

  needsLoot() {
    const p = this.p;
    if (!p.guns[0] || !p.guns[1]) return true;
    if (!p.armorBody || ARMOR_LVL(p.armorBody) < 3) return true;
    if (!p.armorHead || ARMOR_LVL(p.armorHead) < 3) return true;
    if (p.reserveOf() < 12) return true;
    if (p.heals.medikit + p.heals.gauze < 2) return true;
    return false;
  }

  findLoot() {
    const p = this.p;
    let best = null, bestScore = -Infinity;
    const reach = 260 + this.pp.reactRange;
    for (const l of this.world.loot) {
      const d2 = dist2(p.x, p.y, l.x, l.y);
      if (d2 > reach * reach) continue;
      const d = Math.sqrt(d2);
      let score = 0;
      if (l.kind === 'gun') {
        const tier = TIER_RANK(l.id);
        if (p.guns[0] && p.guns[1]) score = tier * 4; else score = 120 + tier * 30;
      } else if (l.kind === 'armor') {
        const cur = l.id.includes('helmet') ? p.armorHead : p.armorBody;
        const curLvl = cur ? ARMOR_LVL(cur) : 0;
        score = 60 + (ARMOR_LVL(l.id) - curLvl) * 40;
      } else if (l.kind === 'ammo') {
        const need = p.gun ? GUNS[p.gun.id].ammo : '9mm';
        score = l.id === need ? 90 : 4;
      } else if (l.kind === 'heal') {
        score = (p.heals[l.id] || 0) < 2 ? 55 : 6;
      } else if (l.kind === 'throwable') {
        score = p.throwCount < 3 ? 40 : 4;
      } else if (l.kind === 'pack') {
        score = 25;
      } else if (l.kind === 'melee') {
        score = 8;
      }
      if (score <= 0) continue;
      // 距离惩罚 + 稀有度偏好
      score = score - d * 0.25;
      if (score > bestScore) { bestScore = score; best = l; }
    }
    return best;
  }

  findCover() {
    const p = this.p;
    let best = null, bestD = Infinity;
    for (const o of this.world.obstacles) {
      if (!o.solid || o.w < 10) continue;
      const d = dist2(p.x, p.y, o.x + o.w / 2, o.y + o.h / 2);
      if (d > 260 * 260) continue;
      // 掩体另一侧（背对威胁）
      const tx = this.lastSeenX, ty = this.lastSeenY;
      const ax = o.x + o.w / 2, ay = o.y + o.h / 2;
      const away = Math.hypot(ax - tx, ay - ty);
      const travel = Math.sqrt(d);
      if (travel > 200) continue;
      const score = away - travel * 0.5;
      if (travel < bestD && score > 40) { bestD = travel; best = { x: ax, y: ay }; }
    }
    if (best) return best;
    // 退向圈中心
    return { x: lerpN(p.x, this.world ? 0 : 0, 0), y: 0 };
  }
}

function ARMOR_LVL(id) {  return { basic_helmet: 1, regular_helmet: 2, tactical_helmet: 3, power_helmet: 4,
    basic_vest: 1, regular_vest: 2, tactical_vest: 3, power_vest: 4 }[id] || 0;
}
function TIER_RANK(id) {
  const g = GUNS[id];
  return g ? { D: 1, C: 2, B: 3, A: 4, S: 5 }[g.tier] || 1 : 1;
}
function lerpN(a, b, t) { return a + (b - a) * t; }
