// =====================================================================
//  核心 · 数学工具 / 音频引擎 / 粒子系统
//  音频与粒子框架移植自 tokugame v33（WebAudio 纯合成，零外部资源）
// =====================================================================

export const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
export const lerp = (a, b, t) => a + (b - a) * t;
export const rand = (a = 1, b) => b === undefined ? Math.random() * a : a + Math.random() * (b - a);
export const randi = (a, b) => Math.floor(rand(a, b + 1));
export const pick = arr => arr[Math.floor(Math.random() * arr.length)];
export const now = () => performance.now() / 1000;
export const dist2 = (ax, ay, bx, by) => { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; };
export const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
export const angDiff = (a, b) => { let d = (a - b) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; };
export const TAU = Math.PI * 2;

// =====================================================================
//  音频引擎 · 全程序化合成，无采样文件
//  原语：tone(振荡器+ADSR) / noise(白噪声+双二阶滤波)
// =====================================================================
export const AudioSys = {
  ctx: null, master: null, muted: false, musicGain: null, sfxGain: null,
  _mus: { on: false, kind: '', step: 0, next: 0, timer: null },

  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.5;
      this.master.connect(this.ctx.destination);
      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = 0.30;
      this.musicGain.connect(this.master);
      this.sfxGain = this.ctx.createGain();
      this.sfxGain.gain.value = 0.85;
      this.sfxGain.connect(this.master);
    }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  },

  setMute(m) { this.muted = m; if (this.master) this.master.gain.value = m ? 0 : 0.5; },

  tone(o) {
    if (!this.ctx) return;
    const c = this.ctx, t0 = c.currentTime + (o.delay || 0);
    const osc = c.createOscillator(), g = c.createGain();
    osc.type = o.type || 'square';
    osc.frequency.setValueAtTime(o.f, t0);
    if (o.f2) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.f2), t0 + (o.t || .1));
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(o.v || .25, t0 + (o.attack || .006));
    g.gain.exponentialRampToValueAtTime(.0001, t0 + (o.t || .1));
    osc.connect(g);
    g.connect(o.music ? this.musicGain : (o.sfx === false ? this.master : this.sfxGain));
    osc.start(t0); osc.stop(t0 + (o.t || .1) + .05);
  },

  noise(o) {
    if (!this.ctx) return;
    const c = this.ctx, t0 = c.currentTime + (o.delay || 0), t = o.t || .15;
    const len = Math.max(1, Math.floor(c.sampleRate * t));
    const buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = c.createBufferSource(); src.buffer = buf;
    const g = c.createGain(); g.gain.value = o.v || .25;
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = o.hp || 300;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = o.lp || 6000;
    src.connect(hp); hp.connect(lp); lp.connect(g);
    g.connect(o.music ? this.musicGain : (o.sfx === false ? this.master : this.sfxGain));
    src.start(t0);
  },

  // 按枪械 tier 合成不同音色
  shot(tier) {
    if (!this.ctx || this.muted) return;
    const cfg = {
      D: { f: 420, f2: 110, t: .07, v: .16, hp: 700, lp: 4200 },
      C: { f: 330, f2: 90, t: .09, v: .20, hp: 500, lp: 3600 },
      B: { f: 250, f2: 65, t: .12, v: .26, hp: 320, lp: 3000 },
      A: { f: 190, f2: 48, t: .16, v: .32, hp: 190, lp: 2400 },
      S: { f: 150, f2: 38, t: .22, v: .38, hp: 110, lp: 2000 }
    }[tier] || { f: 300, f2: 90, t: .1, v: .2, hp: 500, lp: 3500 };
    this.noise({ t: cfg.t * 1.6, v: cfg.v, hp: cfg.hp, lp: cfg.lp });
    this.tone({ f: cfg.f, f2: cfg.f2, type: 'sawtooth', t: cfg.t, v: cfg.v * .7 });
    this.tone({ f: cfg.f * 3.2, f2: cfg.f2 * 2, type: 'square', t: cfg.t * .45, v: cfg.v * .3 });
  },

  shotgun() {
    if (!this.ctx || this.muted) return;
    this.noise({ t: .26, v: .4, hp: 70, lp: 2600 });
    this.tone({ f: 130, f2: 34, type: 'sawtooth', t: .24, v: .34 });
  },

  explosion() {
    if (!this.ctx || this.muted) return;
    this.noise({ t: .55, v: .5, hp: 50, lp: 2200 });
    this.tone({ f: 110, f2: 26, type: 'sawtooth', t: .5, v: .38 });
    this.tone({ f: 62, f2: 20, type: 'sine', t: .7, v: .3 });
  },

  sfx(n) {
    if (!this.ctx || this.muted) return;
    switch (n) {
      case 'hit':     this.noise({ t: .07, v: .22, hp: 900, lp: 5200 }); this.tone({ f: 340, f2: 180, type: 'square', t: .05, v: .1 }); break;
      case 'hitArmor':this.tone({ f: 1500, f2: 700, type: 'square', t: .08, v: .16 }); this.noise({ t: .07, v: .18, hp: 2400, lp: 9000 }); break;
      case 'hurt':    this.tone({ f: 240, f2: 90, type: 'sawtooth', t: .16, v: .24 }); this.noise({ t: .12, v: .16, hp: 200 }); break;
      case 'reload':  this.tone({ f: 900, f2: 500, type: 'square', t: .05, v: .1 }); this.tone({ f: 620, f2: 380, type: 'square', t: .06, v: .1, delay: .1 }); break;
      case 'pickup':  this.tone({ f: 880, type: 'square', t: .05, v: .11 }); this.tone({ f: 1320, type: 'square', t: .09, v: .1, delay: .05 }); break;
      case 'coin':    this.tone({ f: 988, type: 'square', t: .05, v: .1 }); this.tone({ f: 1319, type: 'square', t: .14, v: .1, delay: .05 }); break;
      case 'kill':    [523, 659, 784].forEach((f, i) => this.tone({ f, type: 'square', t: .14, v: .13, delay: i * .08 })); break;
      case 'die':     [392, 330, 262, 196].forEach((f, i) => this.tone({ f, type: 'triangle', t: .22, v: .14, delay: i * .14 })); break;
      case 'heal':    this.tone({ f: 520, f2: 900, type: 'sine', t: .3, v: .13 }); break;
      case 'dash':    this.noise({ t: .2, v: .2, hp: 700, lp: 4800 }); this.tone({ f: 300, f2: 620, type: 'sine', t: .16, v: .1 }); break;
      case 'swim':    this.noise({ t: .16, v: .1, hp: 400, lp: 2000 }); break;
      case 'pin':     this.tone({ f: 1400, f2: 500, type: 'square', t: .12, v: .12 }); break;
      case 'select':  this.tone({ f: 660, type: 'square', t: .06, v: .12 }); break;
      case 'confirm': this.tone({ f: 520, type: 'square', t: .08, v: .14 }); this.tone({ f: 780, type: 'square', t: .1, v: .14, delay: .08 }); break;
      case 'zone':    this.tone({ f: 160, f2: 110, type: 'sawtooth', t: .8, v: .2 }); this.tone({ f: 162, f2: 112, type: 'sawtooth', t: .8, v: .16 }); break;
      case 'warn':    this.tone({ f: 700, f2: 500, type: 'square', t: .18, v: .16 }); break;
      case 'airdrop': [392, 523, 659, 784, 1046].forEach((f, i) => this.tone({ f, type: 'square', t: .2, v: .13, delay: i * .1 })); break;
      case 'win':     [523, 659, 784, 1046, 1319].forEach((f, i) => this.tone({ f, type: 'square', t: .2, v: .15, delay: i * .13 })); break;
      case 'round':   this.tone({ f: 392, type: 'square', t: .16, v: .16 }); this.tone({ f: 523, type: 'square', t: .16, v: .16, delay: .16 }); this.tone({ f: 659, type: 'square', t: .3, v: .18, delay: .32 }); break;
    }
  },

  startMusic(kind) {
    this.ensure(); if (!this.ctx) return;
    if (this._mus.on && this._mus.kind === kind) return;
    this.stopMusic();
    this._mus.on = true; this._mus.kind = kind; this._mus.step = 0;
    this._mus.next = this.ctx.currentTime + .08;
    this._mus.timer = setInterval(() => this._sched(), 40);
  },

  stopMusic() {
    if (this._mus.timer) { clearInterval(this._mus.timer); this._mus.timer = null; }
    this._mus.on = false;
  },

  _sched() {
    if (!this.ctx || !this._mus.on) return;
    const m = this._mus, stepDur = m.kind === 'battle' ? 0.132 : 0.24;
    while (m.next < this.ctx.currentTime + 0.16) {
      const s = m.step, dt = m.next - this.ctx.currentTime;
      if (m.kind === 'battle') {
        const bassSeq = [82.4, 82.4, 0, 82.4, 98, 0, 82.4, 0, 73.4, 73.4, 0, 73.4, 110, 0, 98, 0];
        const arpSeq = [329.6, 392, 493.9, 392, 329.6, 392, 493.9, 587.3, 293.7, 369.9, 440, 369.9, 293.7, 369.9, 440, 587.3];
        const b = bassSeq[s % 16];
        if (b) this.tone({ f: b, type: 'sawtooth', t: stepDur * .95, v: .16, delay: dt, music: true, attack: .004 });
        const a = arpSeq[s % 16];
        if (a && (s % 2 === 0)) this.tone({ f: a, type: 'square', t: stepDur * .6, v: .05, delay: dt, music: true });
        if (s % 4 === 2) this.noise({ t: .04, v: .05, hp: 6000, lp: 12000, delay: dt, music: true });
        if (s % 8 === 0) this.noise({ t: .1, v: .09, hp: 200, lp: 900, delay: dt, music: true });
      } else {
        const chords = [[220, 261.6, 329.6], [174.6, 220, 261.6], [196, 246.9, 293.7], [164.8, 196, 246.9]];
        const ch = chords[Math.floor(s / 8) % 4];
        if (s % 8 === 0) this.tone({ f: ch[0] / 2, type: 'triangle', t: stepDur * 7, v: .13, delay: dt, music: true });
        const nt = ch[s % 3];
        if (s % 2 === 0) this.tone({ f: nt, type: 'sine', t: stepDur * 1.6, v: .07, delay: dt, music: true });
      }
      m.step++; m.next += stepDur;
    }
  }
};

// =====================================================================
//  粒子系统 · 移植 tokugame FX，重写为俯视视角
//  parts 上限 520，震屏 / 顿帧 / 闪光 屏幕特效
// =====================================================================
export const FX = {
  parts: [], shake: 0, flash: 0, hitstop: 0, flashCol: '255,255,255', vignette: 0,

  clear() { this.parts.length = 0; this.shake = 0; this.flash = 0; this.hitstop = 0; },

  spark(x, y, col, n, pw) {
    n = n || 12; pw = pw || 1;
    for (let i = 0; i < n; i++) {
      const a = rand(TAU), sp = rand(40, 190) * pw;
      this.parts.push({ type: 'spark', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        t: 0, life: rand(.14, .36), col: Array.isArray(col) ? pick(col) : col, size: rand(.8, 1.9) });
    }
  },

  // 弹道拖尾
  trail(x, y, col) {
    this.parts.push({ type: 'trail', x, y, t: 0, life: .13, col: col || '#ffe9a8', size: 1.3 });
  },

  // 弹着点
  impact(x, y, col) {
    this.parts.push({ type: 'impact', x, y, t: 0, life: .2, col: col || '#ffd9a0', size: 3 });
    this.spark(x, y, col || '#ffd9a0', 5, .7);
  },

  // 血雾
  blood(x, y, dir) {
    for (let i = 0; i < 7; i++) {
      const a = dir + rand(-.7, .7), sp = rand(20, 90);
      this.parts.push({ type: 'spark', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        t: 0, life: rand(.2, .45), col: pick(['#c0392b', '#8e2a20', '#e74c3c']), size: rand(1, 2.4) });
    }
  },

  smoke(x, y, n, col) {
    for (let i = 0; i < (n || 5); i++)
      this.parts.push({ type: 'smoke', x: x + rand(-6, 6), y: y + rand(-6, 6), vx: rand(-14, 14), vy: rand(-24, -6),
        t: 0, life: rand(.6, 1.4), col: col || 'rgba(170,175,190,.34)', size: rand(6, 15) });
  },

  flame(x, y, n, col) {
    for (let i = 0; i < (n || 6); i++)
      this.parts.push({ type: 'flame', x: x + rand(-10, 10), y: y + rand(-8, 8), vx: rand(-20, 20), vy: rand(-52, -14),
        t: 0, life: rand(.22, .5), col: col || '#ff9540', size: rand(4, 10) });
  },

  // 上浮文字（伤害数字 / 拾取提示）
  rtext(x, y, txt, col, size) {
    this.parts.push({ type: 'rtext', x, y, vx: 0, vy: -22, t: 0, life: .85, col: col || '#ffd166', txt, size: size || 11 });
  },

  ring(x, y, col, r1, life) {
    this.parts.push({ type: 'ring', x, y, t: 0, life: life || .32, col, r1: r1 || 22 });
  },

  explosion(x, y, col, scale) {
    scale = scale || 1;
    this.spark(x, y, col || ['#ffd166', '#ff9540', '#ff5a2d'], 26 * scale, 1.5);
    this.ring(x, y, (Array.isArray(col) ? col[0] : col) || '#ffb347', 34 * scale, .38);
    this.smoke(x, y, 7 * scale);
    this.flash = Math.max(this.flash, .35 * scale);
    this.flashCol = '255,190,90';
    this.shake = Math.max(this.shake, 9 * scale);
  },

  explosionBig(x, y, col) {
    this.spark(x, y, col || ['#fff', '#ffd166', '#ff5a2d'], 42, 2.2);
    this.ring(x, y, '#fff', 56, .5);
    this.ring(x, y, '#ff9540', 40, .62);
    this.smoke(x, y, 14);
    this.flash = .6; this.flashCol = '255,220,150';
    this.shake = Math.max(this.shake, 20);
  },

  update(dt) {
    if (this.parts.length > 520) this.parts.splice(0, this.parts.length - 520);
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i]; p.t += dt;
      if (p.t >= p.life) { this.parts.splice(i, 1); continue; }
      if (p.vx !== undefined) {
        p.x += p.vx * dt; p.y += p.vy * dt;
        const drag = p.type === 'trail' ? 0 : 5.2;
        p.vx -= p.vx * drag * dt; p.vy -= p.vy * drag * dt;
      }
    }
    this.shake = Math.max(0, this.shake - dt * 30);
    this.flash = Math.max(0, this.flash - dt * 2.8);
    this.vignette = Math.max(0, this.vignette - dt * 1.4);
  },

  draw(g, cam) {
    for (const p of this.parts) {
      const k = 1 - p.t / p.life;
      g.save(); g.globalAlpha = k;
      if (p.type === 'spark') {
        g.strokeStyle = p.col; g.lineWidth = p.size * k; g.lineCap = 'round';
        g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(p.x - p.vx * .045, p.y - p.vy * .045); g.stroke();
      } else if (p.type === 'trail') {
        g.fillStyle = p.col;
        g.beginPath(); g.arc(p.x, p.y, p.size * k, 0, TAU); g.fill();
      } else if (p.type === 'impact') {
        g.strokeStyle = p.col; g.lineWidth = 1.4 * k;
        g.beginPath(); g.arc(p.x, p.y, (1 - k) * 9 + 2, 0, TAU); g.stroke();
      } else if (p.type === 'ring') {
        const r = lerp(4, p.r1, 1 - k * k);
        g.strokeStyle = p.col; g.lineWidth = 2.6 * k + .6;
        g.beginPath(); g.arc(p.x, p.y, r, 0, TAU); g.stroke();
      } else if (p.type === 'smoke') {
        g.fillStyle = p.col; g.globalAlpha = k * .5;
        g.beginPath(); g.arc(p.x, p.y, p.size * (2 - k), 0, TAU); g.fill();
      } else if (p.type === 'flame') {
        g.fillStyle = p.col;
        g.beginPath(); g.arc(p.x, p.y, p.size * k, 0, TAU); g.fill();
      } else if (p.type === 'rtext') {
        g.globalAlpha = Math.min(1, k * 1.6);
        g.font = `700 ${p.size}px "Segoe UI",system-ui,sans-serif`;
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.lineWidth = 2.6; g.strokeStyle = 'rgba(0,0,0,.75)';
        g.strokeText(p.txt, p.x, p.y); g.fillStyle = p.col; g.fillText(p.txt, p.x, p.y);
      }
      g.restore();
    }
  }
};

// =====================================================================
//  空间网格 · 用于子弹/实体索敌，避免 O(n²)
// =====================================================================
export class Grid {
  constructor(w, h, cell) {
    this.cell = cell;
    this.cols = Math.ceil(w / cell) + 2;
    this.rows = Math.ceil(h / cell) + 2;
    this.buckets = new Array(this.cols * this.rows);
    for (let i = 0; i < this.buckets.length; i++) this.buckets[i] = [];
  }
  clear() { for (let i = 0; i < this.buckets.length; i++) this.buckets[i].length = 0; }
  idx(x, y) {
    const cx = clamp(Math.floor(x / this.cell) + 1, 0, this.cols - 1);
    const cy = clamp(Math.floor(y / this.cell) + 1, 0, this.rows - 1);
    return cy * this.cols + cx;
  }
  insert(o) { this.buckets[this.idx(o.x, o.y)].push(o); }
  /** 查询半径 r 内的候选对象（粗筛，调用方再做精确判定） */
  query(x, y, r) {
    const out = [];
    const c = this.cell;
    const x0 = clamp(Math.floor((x - r) / c) + 1, 0, this.cols - 1), x1 = clamp(Math.floor((x + r) / c) + 1, 0, this.cols - 1);
    const y0 = clamp(Math.floor((y - r) / c) + 1, 0, this.rows - 1), y1 = clamp(Math.floor((y + r) / c) + 1, 0, this.rows - 1);
    for (let cy = y0; cy <= y1; cy++)
      for (let cx = x0; cx <= x1; cx++) {
        const b = this.buckets[cy * this.cols + cx];
        for (let i = 0; i < b.length; i++) out.push(b[i]);
      }
    return out;
  }
}

/** 线段与圆相交检测 */
export function segCircle(x1, y1, x2, y2, cx, cy, r) {
  const dx = x2 - x1, dy = y2 - y1;
  const fx = x1 - cx, fy = y1 - cy;
  const a = dx * dx + dy * dy;
  if (a < 1e-9) return fx * fx + fy * fy <= r * r;
  const b = 2 * (fx * dx + fy * dy);
  const c = fx * fx + fy * fy - r * r;
  let disc = b * b - 4 * a * c;
  if (disc < 0) return false;
  disc = Math.sqrt(disc);
  const t1 = (-b - disc) / (2 * a), t2 = (-b + disc) / (2 * a);
  return (t1 >= 0 && t1 <= 1) || (t2 >= 0 && t2 <= 1) || (t1 < 0 && t2 > 1);
}

/** 线段与 AABB 相交（slab 法） */
export function segAABB(x1, y1, x2, y2, bx, by, bw, bh) {
  const dx = x2 - x1, dy = y2 - y1;
  let tmin = 0, tmax = 1;
  for (let axis = 0; axis < 2; axis++) {
    const d = axis === 0 ? dx : dy;
    const o = axis === 0 ? x1 : y1;
    const lo = axis === 0 ? bx : by, hi = axis === 0 ? bx + bw : by + bh;
    if (Math.abs(d) < 1e-9) { if (o < lo || o > hi) return false; }
    else {
      let t1 = (lo - o) / d, t2 = (hi - o) / d;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
      if (tmin > tmax) return false;
    }
  }
  return true;
}
