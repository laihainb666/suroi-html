// =====================================================================
//  渲染 · 俯视 2D 全程序化绘制（无外部图片资源）
//  借鉴 tokugame 的 skwPath 斜切血条 / drawAnnounce 播报 / FX 层
// =====================================================================
import { C, GUNS, MELEES, THROWABLES, ARMORS, PACKS, HEALS, SCOPES, AMMOS, TIER_COL, GAS_STAGES, PERKS } from './data.js';
import { clamp, rand, lerp, TAU, FX } from './core.js';
import { MAP, OB } from './world.js';

export class Renderer {
  constructor(game) {
    this.g = game;
  }

  render() {
    const G = this.g, g = G.ctx;
    const W = G.canvas.width, H = G.canvas.height;

    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, W, H);

    // 屏幕坐标系（考虑 dpr）
    g.scale(G.dpr, G.dpr);

    if (!G.world) { this.renderIdleBg(g); return; }

    const cam = G.cam;
    // 震屏
    let shx = 0, shy = 0;
    if (FX.shake > 0) {
      shx = rand(-FX.shake, FX.shake); shy = rand(-FX.shake, FX.shake);
    }

    const sx = G.vw / 2 + shx, sy = G.vh / 2 + shy;

    // ---- 世界层 ----
    g.save();
    g.translate(sx, sy);
    g.scale(cam.zoom, cam.zoom);
    g.translate(-cam.x, -cam.y);

    this.drawGround(g);
    this.drawGas(g);
    this.drawCrates(g);
    this.drawLoot(g);
    this.drawAirdrops(g);
    this.drawObstacles(g);
    this.drawPlayers(g);
    this.drawThrowables(g);
    this.drawBullets(g);
    FX.draw(g, cam);

    g.restore();

    // ---- 屏幕层 ----
    this.drawVignette(g);
    this.drawHUD(g);
    this.drawMiniMap(g);
    this.drawKillFeed(g);
    this.drawAnnounce(g);
    this.drawDamageVignette(g);

    // 闪光
    if (FX.flash > 0) {
      g.fillStyle = `rgba(${FX.flashCol},${FX.flash * 0.5})`;
      g.fillRect(0, 0, G.vw, G.vh);
    }

    // 暗角 / 低血
    const hpFrac = G.player.alive ? G.player.health / G.player.maxHealth : 0;
    if (hpFrac < 0.35 && G.player.alive) {
      const a = (0.35 - hpFrac) / 0.35 * 0.4 * (0.6 + 0.4 * Math.sin(G.time * 8));
      const grd = g.createRadialGradient(G.vw / 2, G.vh / 2, G.vh * 0.3, G.vw / 2, G.vh / 2, G.vh * 0.75);
      grd.addColorStop(0, 'rgba(200,0,0,0)');
      grd.addColorStop(1, `rgba(200,0,0,${a})`);
      g.fillStyle = grd; g.fillRect(0, 0, G.vw, G.vh);
    }
  }

  renderIdleBg(g) {
    const G = this.g;
    g.fillStyle = '#0b0f18'; g.fillRect(0, 0, G.vw, G.vh);
    g.fillStyle = 'rgba(94,200,255,.5)';
    g.font = '600 15px system-ui'; g.textAlign = 'center';
    g.fillText('等待开始', G.vw / 2, G.vh / 2);
  }

  // ---------- 地面 ----------
  drawGround(g) {
    const w = this.g.world;
    // 地图外：深海（先铺满，避免看到空白）
    const seaOuter = g.createLinearGradient(0, 0, MAP, MAP);
    seaOuter.addColorStop(0, '#0d2438'); seaOuter.addColorStop(0.5, '#143a5c'); seaOuter.addColorStop(1, '#0d2438');
    g.fillStyle = seaOuter;
    g.fillRect(-MAP, -MAP, MAP * 3, MAP * 3);
    // 远处海面波纹
    g.strokeStyle = 'rgba(255,255,255,.03)';
    g.lineWidth = 2;
    for (let i = 0; i < 26; i++) {
      const yy = -200 + i * 120;
      g.beginPath();
      for (let xx = -MAP; xx <= MAP * 2; xx += 60) {
        const py = yy + Math.sin((xx + i * 90) * 0.006) * 14;
        xx === -MAP ? g.moveTo(xx, py) : g.lineTo(xx, py);
      }
      g.stroke();
    }

    g.save();
    g.beginPath(); g.rect(0, 0, MAP, MAP); g.clip();
    // 外圈陆地基色
    g.fillStyle = '#2f4030'; g.fillRect(0, 0, MAP, MAP);
    // 海洋（内缩一圈）
    const oc = C.oceanSize;
    const seaInner = g.createLinearGradient(oc, 0, MAP - oc, 0);
    seaInner.addColorStop(0, '#1d3f5c'); seaInner.addColorStop(0.5, '#2a5a80'); seaInner.addColorStop(1, '#1d3f5c');
    g.fillStyle = seaInner;
    g.fillRect(0, 0, MAP, MAP);
    // 内陆（海洋以内）—— 这样 ocean 只作为一圈浅水边
    g.globalCompositeOperation = 'destination-over';
    g.fillStyle = '#2f4030';
    g.fillRect(oc, oc, MAP - oc * 2, MAP - oc * 2);
    g.restore();

    // 沙滩带（在海洋与陆地交界）
    g.save();
    g.strokeStyle = '#c9b483';
    g.lineWidth = C.beachSize * 2;
    g.beginPath();
    g.rect(C.beachSize, C.beachSize, MAP - C.beachSize * 2, MAP - C.beachSize * 2);
    g.stroke();
    g.restore();

    // 草地纹理（确定性网格）—— 只画在可行走内陆
    g.save();
    g.beginPath();
    g.rect(oc + C.beachSize, oc + C.beachSize,
      MAP - (oc + C.beachSize) * 2, MAP - (oc + C.beachSize) * 2);
    g.clip();
    g.fillStyle = '#3a5140';
    g.fillRect(oc, oc, MAP - oc * 2, MAP - oc * 2);
    // 多层草地斑块（确定性网格，只在视野内绘制）
    const T = 40;
    const tx0 = Math.max(0, Math.floor((this.g.cam.x - this.g.vw / 2 / this.g.cam.zoom) / T) * T);
    const ty0 = Math.max(0, Math.floor((this.g.cam.y - this.g.vh / 2 / this.g.cam.zoom) / T) * T);
    const tx1 = Math.min(MAP, this.g.cam.x + this.g.vw / 2 / this.g.cam.zoom);
    const ty1 = Math.min(MAP, this.g.cam.y + this.g.vh / 2 / this.g.cam.zoom);
    for (let y = ty0; y <= ty1; y += T) {
      for (let x = tx0; x <= tx1; x += T) {
        const h = hash2(x, y);
        if (h > 0.88) { g.fillStyle = 'rgba(92,124,86,.5)'; g.fillRect(x, y, T, T); }
        else if (h > 0.74) { g.fillStyle = 'rgba(64,92,60,.45)'; g.fillRect(x + 5, y + 5, T - 10, T - 10); }
        else if (h > 0.62) { g.fillStyle = 'rgba(52,78,50,.4)'; g.beginPath(); g.arc(x + T / 2, y + T / 2, T * 0.34, 0, TAU); g.fill(); }
        else if (h > 0.52) { g.fillStyle = 'rgba(112,140,98,.3)'; g.fillRect(x + 12, y + 12, T - 24, T - 24); }
      }
    }
    // 乡间小路（连接镇区与空地）
    g.strokeStyle = 'rgba(150,132,96,.22)';
    g.lineWidth = 9;
    g.lineCap = 'round';
    if (w.riverPts) {
      for (let i = 6; i < w.riverPts.length - 6; i += 5) {
        const p = w.riverPts[i];
        g.beginPath();
        g.moveTo(p.x, p.y);
        g.lineTo(clamp(p.x + 90, 0, MAP), clamp(p.y - 70, 0, MAP));
        g.lineTo(clamp(p.x + 150, 0, MAP), clamp(p.y + 20, 0, MAP));
        g.stroke();
      }
    }
    g.restore();

    // 冰原（滑动区，减速）
    for (const z of w.iceZones) {
      g.save();
      const ig = g.createRadialGradient(z.x, z.y, z.r * 0.15, z.x, z.y, z.r);
      ig.addColorStop(0, 'rgba(206,238,252,.62)');
      ig.addColorStop(0.72, 'rgba(168,214,240,.44)');
      ig.addColorStop(1, 'rgba(150,205,235,.06)');
      g.fillStyle = ig;
      g.beginPath(); g.arc(z.x, z.y, z.r, 0, TAU); g.fill();
      // 裂纹
      g.strokeStyle = 'rgba(255,255,255,.34)';
      g.lineWidth = 1.6;
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * TAU;
        g.beginPath();
        g.moveTo(z.x + Math.cos(a) * z.r * 0.12, z.y + Math.sin(a) * z.r * 0.12);
        g.lineTo(z.x + Math.cos(a) * z.r * 0.92, z.y + Math.sin(a) * z.r * 0.92);
        g.stroke();
      }
      g.restore();
    }

    // 河流
    if (w.riverPts) {
      g.strokeStyle = 'rgba(60,110,150,.72)';
      g.lineCap = 'round'; g.lineJoin = 'round';
      for (const p of w.riverPts) {
        g.lineWidth = p.w;
        g.beginPath();
        g.moveTo(p.x, p.y);
        const q = w.riverPts[Math.min(w.riverPts.length - 1, w.riverPts.indexOf(p) + 1)];
        g.lineTo(q.x, q.y);
        g.stroke();
      }
      g.strokeStyle = 'rgba(120,180,220,.35)';
      for (const p of w.riverPts) {
        g.lineWidth = p.w * 0.45;
        g.beginPath();
        g.moveTo(p.x, p.y);
        const q = w.riverPts[Math.min(w.riverPts.length - 1, w.riverPts.indexOf(p) + 1)];
        g.lineTo(q.x, q.y);
        g.stroke();
      }
    }

    // 网格线（淡）
    g.strokeStyle = 'rgba(255,255,255,.035)';
    g.lineWidth = 1 / this.g.cam.zoom;
    const step = 64;
    const vx0 = Math.max(0, Math.floor((this.g.cam.x - this.g.vw / 2 / this.g.cam.zoom) / step) * step);
    const vx1 = Math.min(MAP, this.g.cam.x + this.g.vw / 2 / this.g.cam.zoom);
    const vy0 = Math.max(0, Math.floor((this.g.cam.y - this.g.vh / 2 / this.g.cam.zoom) / step) * step);
    const vy1 = Math.min(MAP, this.g.cam.y + this.g.vh / 2 / this.g.cam.zoom);
    for (let x = vx0; x <= vx1; x += step) { g.beginPath(); g.moveTo(x, vy0); g.lineTo(x, vy1); g.stroke(); }
    for (let y = vy0; y <= vy1; y += step) { g.beginPath(); g.moveTo(vx0, y); g.lineTo(vx1, y); g.stroke(); }
  }

  // ---------- 毒圈 ----------
  drawGas(g) {
    const gas = this.g.gas;
    const r = gas.curR;
    if (r <= 0.5) return;
    // 圈外暗红遮罩（用 evenodd 反向填充）
    g.save();
    g.beginPath();
    g.rect(0, 0, MAP, MAP);
    g.arc(gas.cx, gas.cy, r, 0, TAU, true);
    const grd = g.createRadialGradient(gas.cx, gas.cy, r, gas.cx, gas.cy, r + 260);
    grd.addColorStop(0, 'rgba(180,30,60,.18)');
    grd.addColorStop(0.55, 'rgba(150,20,50,.42)');
    grd.addColorStop(1, 'rgba(90,0,30,.68)');
    g.fillStyle = grd;
    g.fill('evenodd');
    // 毒圈边缘
    g.beginPath();
    g.arc(gas.cx, gas.cy, r, 0, TAU);
    g.strokeStyle = `rgba(255,90,110,${0.55 + 0.25 * Math.sin(this.g.time * 3)})`;
    g.lineWidth = 3 / this.g.cam.zoom;
    g.stroke();
    // 下一圈预览
    const nd = GAS_STAGES[gas.stage + 1];
    if (nd && gas.active) {
      g.beginPath();
      g.arc(gas.cx, gas.cy, nd.to * MAP, 0, TAU);
      g.strokeStyle = 'rgba(255,255,255,.5)';
      g.lineWidth = 1.5 / this.g.cam.zoom;
      g.setLineDash([8 / this.g.cam.zoom, 8 / this.g.cam.zoom]);
      g.stroke();
      g.setLineDash([]);
    }
    g.restore();
  }

  // ---------- 障碍 ----------
  drawObstacles(g) {
    const w = this.g.world;
    const zoom = this.g.cam.zoom;
    const vx0 = this.g.cam.x - this.g.vw / 2 / zoom - 40;
    const vx1 = this.g.cam.x + this.g.vw / 2 / zoom + 40;
    const vy0 = this.g.cam.y - this.g.vh / 2 / zoom - 40;
    const vy1 = this.g.cam.y + this.g.vh / 2 / zoom + 40;

    for (const o of w.obstacles) {
      if (o.x + o.w < vx0 || o.x > vx1 || o.y + o.h < vy0 || o.y > vy1) continue;
      if (o.dead) continue;
      if (o.type === 'bush') {
        g.fillStyle = o.hide ? 'rgba(43,74,38,.85)' : 'rgba(43,74,38,.6)';
        g.beginPath(); g.arc(o.x + o.w / 2, o.y + o.h / 2, o.w * 0.8, 0, TAU); g.fill();
        continue;
      }
      // 阴影
      g.fillStyle = 'rgba(0,0,0,.3)';
      g.fillRect(o.x + 2, o.y + 3, o.w, o.h);
      const def = OB[o.type] || OB.wall;
      g.fillStyle = def.col;
      g.fillRect(o.x, o.y, o.w, o.h);
      // 顶面高光
      g.fillStyle = def.top;
      g.fillRect(o.x, o.y, o.w, Math.min(o.h * 0.35, 6));
      // 细节
      if (o.type === 'wall') {
        g.strokeStyle = 'rgba(0,0,0,.25)';
        g.lineWidth = 1;
        const rows = Math.max(1, Math.floor(o.h / 10));
        for (let i = 1; i < rows; i++) {
          const yy = o.y + (o.h / rows) * i;
          g.beginPath(); g.moveTo(o.x, yy); g.lineTo(o.x + o.w, yy); g.stroke();
        }
      } else if (o.type === 'tree') {
        // 树冠
        g.fillStyle = '#3d6b36';
        g.beginPath(); g.arc(o.x + o.w / 2, o.y + o.h / 2, 6.5, 0, TAU); g.fill();
        g.fillStyle = '#4f8a45';
        g.beginPath(); g.arc(o.x + o.w / 2 - 1.5, o.y + o.h / 2 - 1.5, 3.6, 0, TAU); g.fill();
      } else if (o.type === 'crate') {
        g.strokeStyle = 'rgba(0,0,0,.4)'; g.lineWidth = 1.5;
        g.strokeRect(o.x + 1, o.y + 1, o.w - 2, o.h - 2);
        g.beginPath(); g.moveTo(o.x, o.y); g.lineTo(o.x + o.w, o.y + o.h); g.stroke();
      } else if (o.type === 'barrel') {
        g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 1.2;
        g.beginPath(); g.moveTo(o.x, o.y + o.h / 3); g.lineTo(o.x + o.w, o.y + o.h / 3); g.stroke();
        g.beginPath(); g.moveTo(o.x, o.y + o.h * 2 / 3); g.lineTo(o.x + o.w, o.y + o.h * 2 / 3); g.stroke();
      } else if (o.type === 'rock') {
        g.fillStyle = 'rgba(255,255,255,.08)';
        g.beginPath(); g.arc(o.x + o.w * 0.35, o.y + o.h * 0.32, o.w * 0.24, 0, TAU); g.fill();
      }
    }
  }

  // ---------- 容器 ----------
  drawCrates(g) {
    for (const c of this.g.world.crates) {
      g.save();
      g.translate(c.x, c.y);
      if (c.opened) {
        g.fillStyle = 'rgba(60,52,40,.7)';
        g.fillRect(-6, -6, 12, 12);
        g.strokeStyle = 'rgba(120,105,80,.6)'; g.lineWidth = 1;
        g.strokeRect(-6, -6, 12, 12);
      } else {
        // 呼吸光
        const p = 0.5 + 0.5 * Math.sin(this.g.time * 2.2 + c.x * 0.1);
        g.fillStyle = `rgba(255,209,102,${0.14 + p * 0.14})`;
        g.beginPath(); g.arc(0, 0, 15, 0, TAU); g.fill();
        g.fillStyle = '#9a7338';
        g.fillRect(-7, -7, 14, 14);
        g.fillStyle = '#c08f45';
        g.fillRect(-7, -7, 14, 5);
        g.strokeStyle = 'rgba(0,0,0,.4)'; g.lineWidth = 1.4;
        g.strokeRect(-7, -7, 14, 14);
        g.fillStyle = '#ffd166';
        g.fillRect(-2, -2, 4, 4);
      }
      g.restore();
    }
  }

  // ---------- 掉落物 ----------
  drawLoot(g) {
    const zoom = this.g.cam.zoom;
    const cam = this.g.cam;
    const vx0 = cam.x - this.g.vw / 2 / zoom - 20, vx1 = cam.x + this.g.vw / 2 / zoom + 20;
    const vy0 = cam.y - this.g.vh / 2 / zoom - 20, vy1 = cam.y + this.g.vh / 2 / zoom + 20;
    const t = this.g.time;

    for (const l of this.g.world.loot) {
      if (l.x < vx0 || l.x > vx1 || l.y < vy0 || l.y > vy1) continue;
      const tier = this.g.world.lootTier(l);
      const col = TIER_COL[tier] || '#e8eef7';
      const bob = Math.sin(t * 2.4 + l.x * 0.05 + l.y * 0.03) * 0.9;
      g.save();
      g.translate(l.x, l.y + bob);
      // 地面光晕
      const grd = g.createRadialGradient(0, 0, 0, 0, 0, 9);
      grd.addColorStop(0, hexA(col, 0.3));
      grd.addColorStop(1, hexA(col, 0));
      g.fillStyle = grd;
      g.beginPath(); g.arc(0, 0, 9, 0, TAU); g.fill();

      // 影子
      g.fillStyle = 'rgba(0,0,0,.32)';
      g.beginPath(); g.ellipse(0, 3 - bob, 4, 2, 0, 0, TAU); g.fill();

      // 图形
      if (l.kind === 'gun') drawGunIcon(g, GUNS[l.id], col);
      else if (l.kind === 'melee') drawMeleeIcon(g, MELEES[l.id], col);
      else if (l.kind === 'throwable') drawThrowableIcon(g, THROWABLES[l.id], col);
      else if (l.kind === 'armor') drawArmorIcon(g, ARMORS[l.id], col);
      else if (l.kind === 'pack') drawPackIcon(g, l, col);
      else if (l.kind === 'heal') drawHealIcon(g, HEALS[l.id], col);
      else if (l.kind === 'ammo') drawAmmoIcon(g, AMMOS[l.id], col);
      else if (l.kind === 'scope') drawScopeIcon(g, col);
      g.restore();
    }
  }

  // ---------- 空投 ----------
  drawAirdrops(g) {
    for (const a of this.g.airdrops) {
      g.save();
      g.translate(a.x, a.y);
      const prog = clamp(a.t / a.fall, 0, 1);
      if (!a.landed) {
        const y = lerp(-260, 0, prog);
        g.translate(0, y);
        // 降落伞
        g.strokeStyle = 'rgba(230,230,240,.7)'; g.lineWidth = 1;
        for (let i = 0; i < 4; i++) {
          g.beginPath(); g.moveTo(0, 8); g.lineTo(-14 + i * 9.3, 22); g.stroke();
        }
        g.fillStyle = 'rgba(255,120,90,.85)';
        g.beginPath(); g.arc(0, 26, 15, Math.PI, TAU); g.fill();
        g.fillStyle = 'rgba(255,255,255,.85)';
        g.beginPath(); g.arc(0, 26, 15, Math.PI, Math.PI * 1.5); g.fill();
        g.beginPath(); g.arc(0, 26, 15, Math.PI * 1.5, TAU); g.fill();
      }
      // 箱子
      g.fillStyle = 'rgba(0,0,0,.35)';
      g.fillRect(-9, -7, 18, 18);
      g.fillStyle = '#c8402f';
      g.fillRect(-9, -9, 18, 18);
      g.fillStyle = '#e05a44';
      g.fillRect(-9, -9, 18, 6);
      g.strokeStyle = '#ffd166'; g.lineWidth = 1.4;
      g.strokeRect(-9, -9, 18, 18);
      g.beginPath(); g.moveTo(-9, 0); g.lineTo(9, 0); g.stroke();
      g.restore();
    }
  }

  // ---------- 投掷物 ----------
  drawThrowables(g) {
    for (const t of this.g.throwables) {
      g.save();
      const sh = clamp(1 - t.z / 20, 0.25, 1);
      g.globalAlpha = 0.35;
      g.fillStyle = '#000';
      g.beginPath(); g.ellipse(t.x, t.y, 3.5 * sh, 2 * sh, 0, 0, TAU); g.fill();
      g.globalAlpha = 1;
      g.translate(t.x, t.y - t.z * 2.4);
      g.rotate(t.zone + this.g.time * 4);
      const d = THROWABLES[t.id];
      g.fillStyle = !d ? '#5a7a4a' : (t.id === 'flare' ? '#ff8c42' : d.tier === 'S' ? '#ffd166' : '#5a7a4a');
      g.beginPath(); g.arc(0, 0, 3.2, 0, TAU); g.fill();
      g.strokeStyle = 'rgba(0,0,0,.5)'; g.lineWidth = 1;
      g.beginPath(); g.arc(0, 0, 3.2, 0, TAU); g.stroke();
      g.restore();
      // 引信闪烁
      const remain = t.fuse / 1000;
      if (remain < 1.2 && Math.sin(this.g.time * 30) > 0) {
        FX.rtext(t.x, t.y - 10, '.', '#ff5a5a', 14);
      }
    }
  }

  // ---------- 子弹 ----------
  drawBullets(g) {
    const zoom = this.g.cam.zoom;
    const cam = this.g.cam;
    const vx0 = cam.x - this.g.vw / 2 / zoom - 30, vx1 = cam.x + this.g.vw / 2 / zoom + 30;
    const vy0 = cam.y - this.g.vh / 2 / zoom - 30, vy1 = cam.y + this.g.vh / 2 / zoom + 30;
    for (const b of this.g.bullets) {
      if (b.x < vx0 || b.x > vx1 || b.y < vy0 || b.y > vy1) continue;
      const col = TIER_COL[b.tier] || '#ffe9a8';
      g.strokeStyle = col;
      g.lineWidth = 1.5;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(b.x, b.y);
      g.lineTo(b.x - Math.cos(b.ang) * 9, b.y - Math.sin(b.ang) * 9);
      g.stroke();
      g.strokeStyle = 'rgba(255,255,255,.75)';
      g.lineWidth = 0.7;
      g.beginPath();
      g.moveTo(b.x, b.y);
      g.lineTo(b.x - Math.cos(b.ang) * 4.5, b.y - Math.sin(b.ang) * 4.5);
      g.stroke();
    }
  }

  // ---------- 玩家 ----------
  drawPlayers(g) {
    const zoom = this.g.cam.zoom;
    const cam = this.g.cam;
    const vx0 = cam.x - this.g.vw / 2 / zoom - 30, vx1 = cam.x + this.g.vw / 2 / zoom + 30;
    const vy0 = cam.y - this.g.vh / 2 / zoom - 30, vy1 = cam.y + this.g.vh / 2 / zoom + 30;

    // 按 y 排序实现遮挡
    const list = this.g.players.filter(p => p.alive && p.x > vx0 && p.x < vx1 && p.y > vy0 && p.y < vy1);
    list.sort((a, b) => a.y - b.y);

    for (const p of list) {
      const isMe = p === this.g.player;
      g.save();
      g.translate(p.x, p.y);

      // 灌木隐身：只显示轮廓
      if (p.hidden && !isMe) {
        g.globalAlpha = 0.28;
      }

      // 影子
      g.fillStyle = 'rgba(0,0,0,.34)';
      g.beginPath(); g.ellipse(0, 4, 5, 2.4, 0, 0, TAU); g.fill();

      // 护盾环
      if (p.armorBody) {
        const a = ARMORS[p.armorBody];
        g.strokeStyle = hexA(a.col, 0.55);
        g.lineWidth = 1.6;
        g.beginPath(); g.arc(0, 0, 6.4, 0, TAU); g.stroke();
      }
      // 头盔环
      if (p.armorHead) {
        const a = ARMORS[p.armorHead];
        g.strokeStyle = hexA(a.col, 0.75);
        g.lineWidth = 1.9;
        g.beginPath(); g.arc(0, 0, 4.6, 0, TAU); g.stroke();
      }

      // 连杀光环
      if (p.boostKills >= 2) {
        const r = 8 + Math.sin(this.g.time * 8) * 1.2;
        g.strokeStyle = `rgba(255,120,60,${0.3 + p.boostKills * 0.12})`;
        g.lineWidth = 2;
        g.beginPath(); g.arc(0, 0, r, 0, TAU); g.stroke();
      }

      // 冲刺残影
      if (p.dashT > 0) {
        g.fillStyle = 'rgba(140,220,255,.3)';
        g.beginPath(); g.arc(0, 0, 5, 0, TAU); g.fill();
      }

      // 身体（圆形，俯视）
      const hurt = p.hitFlash > 0;
      const bodyCol = p.downed ? '#8a8f98' : (isMe ? '#4fc3f7' : colForName(p.name));
      g.fillStyle = hurt ? '#ffffff' : bodyCol;
      g.beginPath(); g.arc(0, 0, 4.4, 0, TAU); g.fill();
      // 高光
      g.fillStyle = 'rgba(255,255,255,.28)';
      g.beginPath(); g.arc(-1.4, -1.5, 1.7, 0, TAU); g.fill();

      // 枪
      const def = p.gunDef;
      g.save();
      g.rotate(p.aim);
      if (def) {
        g.fillStyle = '#2a2e36';
        g.fillRect(3, -1.2, def.len * 1.6, 2.4);
        g.fillStyle = '#3d434e';
        g.fillRect(3, -1.2, def.len * 0.7, 1.4);
      } else if (p.melee) {
        const m = MELEES[p.melee];
        if (m) {
          g.fillStyle = '#8d99ae';
          g.fillRect(3, -0.8, m.len * 1.3, 1.6);
        }
      } else if (p.throwCount > 0) {
        g.fillStyle = '#5a7a4a';
        g.beginPath(); g.arc(4.5, 0, 2.2, 0, TAU); g.fill();
      }
      // 枪口火焰
      if (def && this.g.time - p.lastFire < 0.05) {
        g.fillStyle = '#ffd166';
        g.beginPath(); g.arc(3 + def.len * 1.6, 0, 3, 0, TAU); g.fill();
      }
      g.restore();

      // 换弹提示环
      if (p.reloadT > 0) {
        const prog = 1 - p.reloadT / p.reloadDur;
        g.strokeStyle = 'rgba(255,209,102,.9)';
        g.lineWidth = 2;
        g.beginPath(); g.arc(0, 0, 7.5, -Math.PI / 2, -Math.PI / 2 + prog * TAU); g.stroke();
      }
      // 使用物品环
      if (p.usingT > 0) {
        const prog = 1 - p.usingT / p.usingDur;
        g.strokeStyle = 'rgba(94,200,255,.9)';
        g.lineWidth = 2;
        g.beginPath(); g.arc(0, 0, 7.5, -Math.PI / 2, -Math.PI / 2 + prog * TAU); g.stroke();
      }

      // 名牌
      g.globalAlpha = p.hidden && !isMe ? 0.3 : 1;
      const nameY = -11;
      g.font = '600 6px system-ui,sans-serif';
      g.textAlign = 'center';
      g.lineWidth = 2.4; g.strokeStyle = 'rgba(0,0,0,.7)';
      g.strokeText(p.name, 0, nameY);
      g.fillStyle = isMe ? '#9fe8ff' : '#dfe6f0';
      g.fillText(p.name, 0, nameY);

      // 血条
      if (p.health < p.maxHealth || !isMe) {
        const bw = 16, frac = clamp(p.health / p.maxHealth, 0, 1);
        g.fillStyle = 'rgba(0,0,0,.55)';
        g.fillRect(-bw / 2, -8.4, bw, 2.4);
        g.fillStyle = frac > 0.5 ? '#5ed07a' : frac > 0.25 ? '#ffc44d' : '#ff5a5a';
        g.fillRect(-bw / 2, -8.4, bw * frac, 2.4);
        if (p.armorBody) {
          const shieldFrac = clamp((p.maxHealth - p.health) / p.maxHealth, 0, 1);
          g.fillStyle = hexA(ARMORS[p.armorBody].col, 0.85);
          g.fillRect(-bw / 2, -6.2, bw * shieldFrac, 1.1);
        }
      }

      // 倒地标记
      if (p.downed) {
        g.fillStyle = '#ff5a5a';
        g.beginPath();
        g.moveTo(0, -16); g.lineTo(-4, -22); g.lineTo(4, -22); g.closePath(); g.fill();
        // 救援进度
        const prog = clamp(1 - p.downTimer / 8000, 0, 1);
        g.strokeStyle = '#ff9f43'; g.lineWidth = 1.6;
        g.beginPath(); g.arc(0, 0, 9, -Math.PI / 2, -Math.PI / 2 + prog * TAU); g.stroke();
      }

      // 天赋图标（脚下小点）
      if (p.perks.length) {
        for (let i = 0; i < p.perks.length; i++) {
          g.fillStyle = '#8fe388';
          g.beginPath(); g.arc(-6 + i * 6, 8, 1.6, 0, TAU); g.fill();
        }
      }

      g.restore();
    }
  }

  // ---------- 暗角 ----------
  drawVignette(g) {
    const grd = g.createRadialGradient(this.g.vw / 2, this.g.vh / 2, this.g.vh * 0.45, this.g.vw / 2, this.g.vh / 2, this.g.vh * 0.95);
    grd.addColorStop(0, 'rgba(0,0,0,0)');
    grd.addColorStop(1, 'rgba(0,0,0,.45)');
    g.fillStyle = grd; g.fillRect(0, 0, this.g.vw, this.g.vh);
  }

  drawDamageVignette(g) {
    // 毒圈内的紫色提示
    const gas = this.g.gas;
    if (gas.dps > 0 && this.g.player.alive) {
      const d = gas.insideDist(this.g.player.x, this.g.player.y);
      if (d < 0) {
        g.fillStyle = `rgba(180,30,80,${0.1 + 0.06 * Math.sin(this.g.time * 6)})`;
        g.fillRect(0, 0, this.g.vw, this.g.vh);
      }
    }
  }

  // ---------- HUD ----------
  drawHUD(g) {
    const G = this.g, p = G.player;
    const vw = G.vw, vh = G.vh;

    // ---- 左下：血条 / 护甲 / 肾上腺素 ----
    const bx = 18, by = vh - 92;
    // 斜切平行四边形（借鉴 tokugame skwPath）
    skw(g, bx, by, 200, 16, 7);
    g.fillStyle = 'rgba(8,13,24,.72)'; g.fill();
    const hpFrac = clamp(p.health / p.maxHealth, 0, 1);
    skw(g, bx + 2, by + 2, (200 - 4) * hpFrac, 12, 5);
    const hg = g.createLinearGradient(bx, 0, bx + 200, 0);
    hg.addColorStop(0, hpFrac > 0.5 ? '#3ddc84' : hpFrac > 0.25 ? '#ffc44d' : '#ff4d5a');
    hg.addColorStop(1, hpFrac > 0.5 ? '#7ef0a8' : hpFrac > 0.25 ? '#ffe08a' : '#ff8a92');
    g.fillStyle = hg; g.fill();
    g.font = '700 10px system-ui'; g.textAlign = 'left'; g.textBaseline = 'middle';
    g.fillStyle = 'rgba(255,255,255,.92)';
    g.fillText(`${Math.max(0, Math.ceil(p.health))} / ${p.maxHealth}`, bx + 8, by + 8.5);

    // 肾上腺素
    skw(g, bx, by + 20, 200, 8, 4);
    g.fillStyle = 'rgba(8,13,24,.72)'; g.fill();
    const adFrac = clamp(p.adren / p.maxAdren, 0, 1);
    skw(g, bx + 2, by + 22, (200 - 4) * adFrac, 4, 2);
    g.fillStyle = '#5ec8ff'; g.fill();
    g.fillStyle = 'rgba(220,240,255,.8)';
    g.font = '600 7px system-ui';
    g.fillText('ADR', bx + 5, by + 24.5);
    g.fillText(Math.round(p.adren), bx + 200 - 22, by + 24.5);

    // 冲刺冷却
    const dashFrac = 1 - clamp(p.dashCd / p.dashMaxCd, 0, 1);
    skw(g, bx, by + 32, 200, 6, 3);
    g.fillStyle = 'rgba(8,13,24,.72)'; g.fill();
    if (dashFrac > 0) {
      skw(g, bx + 2, by + 33.5, (200 - 4) * dashFrac, 3, 1.5);
      g.fillStyle = dashFrac >= 1 ? '#8fe3ff' : 'rgba(143,227,255,.5)'; g.fill();
    }
    g.fillStyle = 'rgba(200,235,255,.75)'; g.font = '600 6.5px system-ui';
    g.fillText('SHIFT DASH', bx + 5, by + 35.5);

    // ---- 底部中央：弹药 ----
    const def = p.gunDef;
    const cw = 130, cx0 = vw / 2 - cw / 2, cy0 = vh - 56;
    g.fillStyle = 'rgba(8,13,24,.66)';
    roundRect(g, cx0, cy0, cw, 34, 8); g.fill();
    g.strokeStyle = 'rgba(140,170,255,.2)'; g.lineWidth = 1; g.stroke();

    if (def) {
      g.textAlign = 'left'; g.textBaseline = 'middle';
      g.font = '700 9px system-ui';
      g.fillStyle = TIER_COL[def.tier] || '#e8eef7';
      g.fillText(def.n.toUpperCase(), cx0 + 10, cy0 + 10);
      g.font = '700 18px system-ui';
      g.fillStyle = p.magOf() > 0 ? '#eef4ff' : '#ff5a5a';
      g.fillText(String(p.magOf()), cx0 + 10, cy0 + 25);
      g.font = '600 10px system-ui';
      g.fillStyle = '#93a7cf';
      g.fillText(`/ ${p.reserveOf()}`, cx0 + 10 + g.measureText(String(p.magOf())).width + 24, cy0 + 27);
      g.font = '600 8px system-ui';
      g.fillStyle = '#93a7cf';
      g.textAlign = 'right';
      g.fillText(AMMOS[def.ammo].n, cx0 + cw - 10, cy0 + 10);
      // 双持标记
      if (def.dual) {
        g.fillStyle = '#ffd166'; g.font = '700 8px system-ui'; g.textAlign = 'right';
        g.fillText('DUAL', cx0 + cw - 10, cy0 + 27);
      }
      if (p.guns[1 - p.gunSlot]) {
        g.textAlign = 'right'; g.font = '600 7px system-ui'; g.fillStyle = 'rgba(147,167,207,.6)';
        g.fillText('1/2', cx0 + cw - 10, cy0 - 6);
      }
    } else {
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = '600 11px system-ui'; g.fillStyle = '#93a7cf';
      g.fillText('徒手', vw / 2, cy0 + 17);
    }

    // ---- 右下：装备栏 ----
    const ix = vw - 18, iy = vh - 92;
    const slots = [
      { label: 'HEAD', txt: p.armorHead ? ARMORS[p.armorHead].n.split(' ')[0] : '—', col: p.armorHead ? ARMORS[p.armorHead].col : '#3a4250' },
      { label: 'BODY', txt: p.armorBody ? ARMORS[p.armorBody].n.split(' ')[0] : '—', col: p.armorBody ? ARMORS[p.armorBody].col : '#3a4250' },
      { label: 'SCOPE', txt: SCOPES[p.scope].n, col: '#8fe3ff' },
      { label: 'PACK', txt: PACKS[p.pack].n.split(' ')[0], col: '#ffd166' },
      { label: 'THROW', txt: `${p.throwCount}`, col: '#c8e6a0' },
      { label: 'PERK', txt: `${p.perks.length}`, col: '#8fe388' }
    ];
    for (let i = 0; i < slots.length; i++) {
      const col = i % 3, row = Math.floor(i / 3);
      const x = ix - 66 - col * 68, y = iy - row * 30;
      g.fillStyle = 'rgba(8,13,24,.66)';
      roundRect(g, x, y, 64, 26, 6); g.fill();
      g.strokeStyle = 'rgba(140,170,255,.16)'; g.lineWidth = 1; g.stroke();
      g.fillStyle = 'rgba(147,167,207,.7)';
      g.font = '600 6.5px system-ui'; g.textAlign = 'left'; g.textBaseline = 'top';
      g.fillText(slots[i].label, x + 6, y + 4);
      g.fillStyle = slots[i].col;
      g.font = '700 10px system-ui';
      g.fillText(slots[i].txt.slice(0, 9), x + 6, y + 13);
    }

    // 消耗品快捷栏
    const hx = vw - 18, hy = vh - 176;
    const healSlots = ['medikit', 'gauze', 'tablets', 'cola'];
    for (let i = 0; i < healSlots.length; i++) {
      const id = healSlots[i];
      const n = p.heals[id] || 0;
      const cap = p.pack === 'bag' ? 1 : p.pack === 'basic_pack' ? 2 : p.pack === 'regular_pack' ? 3 : 4;
      const x = hx - 28 - i * 30, y = hy;
      g.fillStyle = 'rgba(8,13,24,.66)';
      roundRect(g, x, y, 26, 26, 6); g.fill();
      g.strokeStyle = n > 0 ? hexA(HEALS[id].type === 'hp' ? '#5ed07a' : '#5ec8ff', .5) : 'rgba(140,170,255,.14)';
      g.lineWidth = 1; g.stroke();
      drawHealIcon(g, HEALS[id], n > 0 ? (HEALS[id].type === 'hp' ? '#5ed07a' : '#5ec8ff') : '#3a4250');
      g.translate(x, y); g.translate(-x, -y);
      g.font = '700 8px system-ui'; g.textAlign = 'right'; g.textBaseline = 'bottom';
      g.fillStyle = n > 0 ? '#eef4ff' : '#5a6473';
      g.fillText(String(n), x + 23, y + 24);
      g.font = '600 6px system-ui'; g.textAlign = 'center';
      g.fillStyle = 'rgba(147,167,207,.55)';
      g.fillText(String(i + 1), x + 13, y + -2);
    }

    // ---- 顶部中央：存活人数 / 击杀 / 计时 ----
    const alive = this.g.players.filter(p2 => p2.alive).length;
    g.textAlign = 'center'; g.textBaseline = 'top';
    g.fillStyle = 'rgba(8,13,24,.62)';
    roundRect(g, vw / 2 - 90, 12, 180, 44, 9); g.fill();
    g.strokeStyle = 'rgba(140,170,255,.18)'; g.stroke();
    g.fillStyle = '#eef4ff'; g.font = '700 17px system-ui';
    g.fillText(String(alive), vw / 2 - 52, 18);
    g.fillStyle = 'rgba(147,167,207,.75)'; g.font = '600 8px system-ui';
    g.fillText('ALIVE', vw / 2 - 52, 38);
    g.fillStyle = '#ffd166'; g.font = '700 17px system-ui';
    g.fillText(String(p.kills), vw / 2, 18);
    g.fillStyle = 'rgba(147,167,207,.75)'; g.font = '600 8px system-ui';
    g.fillText('KILLS', vw / 2, 38);
    const mm = Math.floor(this.g.time / 60), ss = Math.floor(this.g.time % 60);
    g.fillStyle = '#eef4ff'; g.font = '700 14px system-ui';
    g.fillText(`${mm}:${String(ss).padStart(2, '0')}`, vw / 2 + 52, 20);

    // ---- 顶部左：毒圈信息 ----
    const gas = this.g.gas;
    const dcur = GAS_STAGES[gas.stage];
    g.textAlign = 'left'; g.textBaseline = 'middle';
    g.fillStyle = 'rgba(8,13,24,.62)';
    roundRect(g, 18, 12, 176, 34, 8); g.fill();
    g.strokeStyle = 'rgba(255,90,110,.28)'; g.stroke();
    const inZone = gas.insideDist(p.x, p.y) > 0;
    g.font = '700 10px system-ui';
    g.fillStyle = inZone ? '#8fe388' : '#ff6b8a';
    g.fillText(inZone ? '● IN ZONE' : '● TAKING DAMAGE', 28, 24);
    g.font = '600 8.5px system-ui';
    g.fillStyle = 'rgba(200,215,240,.8)';
    const remain = dcur && dcur.dur > 0 ? Math.max(0, dcur.dur - gas.timer / 1000) : 0;
    const stateTxt = dcur && dcur.state === 'advancing' ? `CLOSING ${Math.ceil(remain)}s`
      : dcur && dcur.state === 'final' ? 'FINAL' : `NEXT ${Math.ceil(remain)}s`;
    g.fillText(`${stateTxt}${gas.dps > 0 ? `  ·  ${gas.dps} DPS` : ''}`, 28, 37);

    // 击杀数 HUD 之外：伤害统计
    g.fillStyle = 'rgba(147,167,207,.7)'; g.font = '600 8px system-ui';
    g.fillText(`DMG ${Math.round(p.damageDealt)}`, 18, 56);
  }

  // ---------- 小地图 ----------
  drawMiniMap(g) {
    const G = this.g;
    const size = 148, mx = G.vw - size - 18, my = 18;
    g.fillStyle = 'rgba(6,10,18,.74)';
    roundRect(g, mx, my, size, size, 8); g.fill();
    g.strokeStyle = 'rgba(140,170,255,.24)'; g.lineWidth = 1; g.stroke();

    const s = size / MAP;
    g.save();
    g.translate(mx, my);
    // 陆地
    g.fillStyle = 'rgba(47,64,48,.9)';
    g.fillRect(0, 0, MAP * s, MAP * s);
    // 河流
    if (G.world.riverPts) {
      g.strokeStyle = 'rgba(60,110,150,.8)'; g.lineWidth = 1.5;
      g.beginPath();
      let first = true;
      for (const p of G.world.riverPts) {
        if (first) { g.moveTo(p.x * s, p.y * s); first = false; }
        else g.lineTo(p.x * s, p.y * s);
      }
      g.stroke();
    }
    // 毒圈
    const gas = G.gas;
    if (gas.curR > 0.5) {
      g.strokeStyle = '#ff5a7a'; g.lineWidth = 1.6;
      g.beginPath(); g.arc(gas.cx * s, gas.cy * s, gas.curR * s, 0, TAU); g.stroke();
      // 圈外遮罩
      g.save();
      g.beginPath(); g.rect(0, 0, MAP * s, MAP * s);
      g.arc(gas.cx * s, gas.cy * s, gas.curR * s, 0, TAU, true);
      g.fillStyle = 'rgba(150,20,50,.25)';
      g.fill('evenodd'); g.restore();
    }
    // 空投
    for (const a of G.airdrops) {
      g.fillStyle = a.landed ? 'rgba(255,180,60,.5)' : '#ff5a5a';
      g.beginPath(); g.arc(a.x * s, a.y * s, 2.2, 0, TAU); g.fill();
    }
    // 枪声（最近）
    g.fillStyle = 'rgba(255,220,120,.5)';
    for (const b of G.bullets) {
      if (b.owner === G.player) continue;
      if (Math.random() > 0.06) continue;
      g.fillRect(b.x * s - 0.6, b.y * s - 0.6, 1.2, 1.2);
    }
    // 敌人
    for (const p of G.players) {
      if (!p.alive || p === G.player) continue;
      if (p.hidden && !G.revealed) continue;
      g.fillStyle = '#ff6b6b';
      g.beginPath(); g.arc(p.x * s, p.y * s, 1.7, 0, TAU); g.fill();
    }
    // 玩家
    const pl = G.player;
    g.fillStyle = '#8fe8ff';
    g.beginPath(); g.arc(pl.x * s, pl.y * s, 2.6, 0, TAU); g.fill();
    // 视野扇形
    g.fillStyle = 'rgba(143,232,255,.22)';
    g.beginPath();
    g.moveTo(pl.x * s, pl.y * s);
    const range = 46;
    g.arc(pl.x * s, pl.y * s, range, pl.aim - 0.55, pl.aim + 0.55);
    g.closePath(); g.fill();
    g.restore();

    g.strokeStyle = 'rgba(140,170,255,.35)'; g.lineWidth = 1;
    g.strokeRect(mx + .5, my + .5, size - 1, size - 1);
  }

  // ---------- 击杀播报 ----------
  drawKillFeed(g) {
    const G = this.g;
    const now = G.time;
    g.textAlign = 'right'; g.textBaseline = 'top';
    g.font = '600 10.5px system-ui';
    for (let i = 0; i < G.killFeed.length; i++) {
      const k = G.killFeed[i];
      const age = now - k.t;
      if (age > 7) continue;
      const a = Math.min(1, (7 - age) / 1.2) * Math.min(1, age / 0.15);
      g.globalAlpha = a;
      const x = G.vw - 176 - 0, y = 178 + i * 17;
      const txt = `${k.k}  ⌁  ${k.v}`;
      const w = g.measureText(txt).width + 16;
      g.fillStyle = 'rgba(8,13,24,.66)';
      roundRect(g, x - w, y, w, 15, 4); g.fill();
      g.fillStyle = '#e8eef7';
      g.fillText(txt, x - 8, y + 3);
      g.globalAlpha = 1;
    }
  }

  // ---------- 大字播报 ----------
  drawAnnounce(g) {
    const G = this.g;
    if (!G.announce) return;
    const a = G.announce;
    a.t += 1 / 60;
    const k = a.t / a.dur;
    if (k >= 1) { G.announce = null; return; }
    const scale = k < 0.15 ? lerp(1.5, 1, k / 0.15) : 1;
    const alpha = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;

    g.save();
    g.globalAlpha = alpha;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const cx = G.vw / 2, cy = G.vh * 0.24;
    g.translate(cx, cy); g.scale(scale, scale);
    g.font = '800 26px system-ui,sans-serif';
    g.lineWidth = 5; g.strokeStyle = 'rgba(0,0,0,.7)';
    g.strokeText(a.txt, 0, 0);
    g.shadowColor = 'rgba(94,200,255,.6)'; g.shadowBlur = 18;
    g.fillStyle = '#eef4ff';
    g.fillText(a.txt, 0, 0);
    g.restore();
  }
}

// =====================================================================
//  绘制辅助
// =====================================================================
function skw(g, x, y, w, h, sk) {
  g.beginPath();
  g.moveTo(x + sk, y);
  g.lineTo(x + w, y);
  g.lineTo(x + w - sk, y + h);
  g.lineTo(x, y + h);
  g.closePath();
}

function roundRect(g, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function hexA(hex, a) {
  if (hex.startsWith('rgba')) return hex;
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function hash2(x, y) {
  let h = x * 374761393 + y * 668265263;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) >>> 0) / 4294967296;
}

// ---------- 物品图标 ----------
function drawGunIcon(g, def, col) {
  if (!def) return;
  const len = 4 + (def.len || 5) * 0.9;
  g.fillStyle = '#2a2e36';
  g.fillRect(-len * 0.35, -1.4, len, 2.8);
  g.fillStyle = col;
  g.fillRect(-len * 0.35, -1.4, len, 0.9);
  g.fillStyle = '#4a5260';
  g.fillRect(-len * 0.35, 0.6, len * 0.35, 2);
  // 弹匣
  g.fillStyle = '#3d434e';
  g.fillRect(-1, 1.2, 1.6, 2.6);
}

function drawMeleeIcon(g, def, col) {
  if (!def) return;
  const len = 3 + (def.len || 2.5) * 0.7;
  g.save();
  g.rotate(-0.6);
  g.fillStyle = '#5a4632';
  g.fillRect(-1.4, -1, 3, 2);
  g.fillStyle = col;
  g.fillRect(1.4, -1.3, len, 2.6);
  g.restore();
}

function drawThrowableIcon(g, def, col) {
  if (!def) return;
  g.fillStyle = col;
  g.beginPath(); g.arc(0, 0, 2.8, 0, TAU); g.fill();
  g.fillStyle = '#3a3f4a';
  g.fillRect(-1, -3.6, 2, 1.4);
  g.strokeStyle = 'rgba(255,255,255,.4)'; g.lineWidth = 0.8;
  g.beginPath(); g.arc(-0.6, -0.6, 1, 0, TAU); g.stroke();
}

function drawArmorIcon(g, def, col) {
  if (!def) return;
  if (def.slot === 'head') {
    g.fillStyle = col;
    g.beginPath(); g.arc(0, 0, 3.4, Math.PI * 0.9, Math.PI * 2.1); g.fill();
    g.fillRect(-3.4, 0, 6.8, 1.6);
  } else {
    g.fillStyle = col;
    g.beginPath();
    g.moveTo(-3.4, -3); g.lineTo(3.4, -3); g.lineTo(4.4, 0);
    g.lineTo(3, 4); g.lineTo(-3, 4); g.lineTo(-4.4, 0);
    g.closePath(); g.fill();
    g.fillStyle = 'rgba(255,255,255,.25)';
    g.fillRect(-2.4, -2, 4.8, 1);
  }
}

function drawPackIcon(g, l, col) {
  g.fillStyle = '#7a5a2e';
  roundRect(g, -3.6, -4, 7.2, 8, 1.6); g.fill();
  g.fillStyle = col;
  roundRect(g, -2.4, -3, 4.8, 3, 1); g.fill();
  g.fillStyle = 'rgba(0,0,0,.25)';
  g.fillRect(-3.6, 1.4, 7.2, 0.9);
}

function drawHealIcon(g, def, col) {
  if (!def) return;
  g.fillStyle = col;
  g.fillRect(-2.4, -3.2, 4.8, 6.4);
  g.fillStyle = 'rgba(255,255,255,.3)';
  g.fillRect(-1.6, -2.4, 1.4, 4.8);
  // 十字
  g.fillStyle = def.type === 'adren' ? '#1a3d5a' : '#8a1a1a';
  g.fillRect(-2.4, -0.8, 4.8, 1.4);
  g.fillRect(-0.6, -2.6, 1.2, 5.2);
}

function drawAmmoIcon(g, def, col) {
  g.fillStyle = '#8a6a3a';
  g.fillRect(-3.4, -2.4, 6.8, 4.8);
  g.fillStyle = col;
  for (let i = 0; i < 3; i++) g.fillRect(-2.6 + i * 2, -1.6, 1.4, 3.2);
  g.fillStyle = 'rgba(0,0,0,.3)';
  g.fillRect(-3.4, -2.4, 6.8, 0.9);
}

function drawScopeIcon(g, col) {
  g.strokeStyle = col; g.lineWidth = 1.4;
  g.beginPath(); g.arc(0, 0, 3.6, 0, TAU); g.stroke();
  g.beginPath(); g.moveTo(-4.6, 0); g.lineTo(-3.4, 0); g.stroke();
  g.beginPath(); g.moveTo(3.4, 0); g.lineTo(4.6, 0); g.stroke();
  g.fillStyle = hexA(col, 0.4);
  g.beginPath(); g.arc(0, 0, 2.2, 0, TAU); g.fill();
}

// Bot 名字配色
const NAME_COLS = ['#ff8a8a', '#ffd166', '#8fe388', '#5ec8ff', '#c79bff', '#ff9f43', '#7ee0d0', '#e0a3ff'];
export function colForName(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return NAME_COLS[h % NAME_COLS.length];
}
