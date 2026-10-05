// =====================================================================
//  主入口 · UI / 输入 / 菜单 / 结算
//  CSS 变量主题体系与 DOM 结算页借鉴 tokugame
// =====================================================================
import { C, GUNS, PERKS, TIER_COL, TIER_ORDER, AMMOS, ARMORS, HEALS, SCOPES } from './data.js';
import { clamp, rand, pick, TAU, AudioSys, FX } from './core.js';
import { Game, STATE, loadSettings, saveSettings } from './game.js';
import { Renderer } from './render.js';
import { MAP } from './world.js';
import { Throwable } from './entities.js';

const $ = id => document.getElementById(id);
/** 安全取元素（元素不存在时返回 null，调用方用 ?. 保护） */
const Q = id => document.getElementById(id);

const canvas = $('cv');
const game = new Game(canvas);
const renderer = new Renderer(game);
game.setRenderer(renderer);

// =====================================================================
//  输入
// =====================================================================
const Input = {
  keys: {},
  mx: 0, my: 0,
  aim: 0,
  fire: false, firePressed: false,
  reload: false,
  dash: false, dashPressed: false,
  pickup: false,
  scroll: 0
};
let lastScroll = 0;

window.addEventListener('keydown', e => {
  if (e.repeat) { return; }
  const k = e.code;
  Input.keys[k] = true;
  AudioSys.ensure();

  if (game.state === STATE.MENU) {
    if (k === 'Enter' || k === 'Space') { AudioSys.sfx('confirm'); startMatch(); }
    return;
  }
  if (game.state === STATE.RESULT) {
    if (k === 'Enter' || k === 'Space') { AudioSys.sfx('confirm'); backToMenu(); }
    if (k === 'Escape') backToMenu();
    return;
  }
  if (game.state === STATE.PAUSE) {
    if (k === 'Escape' || k === 'KeyP') togglePause();
    return;
  }
  // 游戏中
  switch (k) {
    case 'Escape': case 'KeyP': togglePause(); break;
    case 'ShiftLeft': case 'ShiftRight': Input.dashPressed = true; break;
    case 'KeyR': Input.reload = true; break;
    case 'KeyE': Input.pickup = true; break;
    case 'Digit1': useHeal(0); break;
    case 'Digit2': useHeal(1); break;
    case 'Digit3': useHeal(2); break;
    case 'Digit4': useHeal(3); break;
    case 'KeyQ': game.player.gunSlot = 1 - game.player.gunSlot; AudioSys.sfx('select'); break;
    case 'KeyG': game.player.throwCount > 0 ? doPlayerThrow() : null; break;
    case 'KeyF': cycleScope(); break;
    case 'KeyM': toggleMute(); break;
    case 'Tab': e.preventDefault(); toggleScoreboard(e.shiftKey); break;
  }
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(k)) e.preventDefault();
});

window.addEventListener('keyup', e => { Input.keys[e.code] = false; });
window.addEventListener('blur', () => { Input.keys = {}; });

canvas.addEventListener('mousemove', e => {
  const r = canvas.getBoundingClientRect();
  Input.mx = e.clientX - r.left; Input.my = e.clientY - r.top;
});
canvas.addEventListener('mousedown', e => {
  AudioSys.ensure();
  if (e.button === 0) Input.firePressed = true;
  if (e.button === 2) Input.pickup = true;
  if (e.button === 1) { cycleScope(); e.preventDefault(); }
});
window.addEventListener('mouseup', e => { if (e.button === 0) Input.fire = false; });
window.addEventListener('contextmenu', e => e.preventDefault());
canvas.addEventListener('wheel', e => {
  const d = e.deltaY;
  if (d > 0) game.player.gunSlot = 1 - game.player.gunSlot;
  AudioSys.sfx('select');
  e.preventDefault();
}, { passive: false });

// 触屏：虚拟摇杆 + 射击
let touchAim = null, touchMove = null;
canvas.addEventListener('touchstart', e => {
  AudioSys.ensure();
  for (const t of e.changedTouches) {
    if (t.clientX < window.innerWidth * 0.45 && !touchMove) {
      touchMove = { id: t.identifier, ox: t.clientX, oy: t.clientY, dx: 0, dy: 0 };
    } else if (!touchAim) {
      touchAim = { id: t.identifier };
      Input.fire = true;
    }
  }
  e.preventDefault();
}, { passive: false });
canvas.addEventListener('touchmove', e => {
  for (const t of e.changedTouches) {
    if (touchMove && t.identifier === touchMove.id) {
      touchMove.dx = t.clientX - touchMove.ox;
      touchMove.dy = t.clientY - touchMove.oy;
    } else if (touchAim && t.identifier === touchAim.id) {
      const r = canvas.getBoundingClientRect();
      Input.mx = t.clientX - r.left; Input.my = t.clientY - r.top;
    }
  }
  e.preventDefault();
}, { passive: false });
canvas.addEventListener('touchend', e => {
  for (const t of e.changedTouches) {
    if (touchMove && t.identifier === touchMove.id) touchMove = null;
    if (touchAim && t.identifier === touchAim.id) { touchAim = null; Input.fire = false; }
  }
}, { passive: false });

function useHeal(i) {
  const ids = ['medikit', 'gauze', 'tablets', 'cola'];
  const p = game.player;
  if (p.useItem(ids[i])) AudioSys.sfx('select');
}
function cycleScope() {
  const ids = Object.keys(SCOPES);
  const i = ids.indexOf(game.player.scope);
  game.player.scope = ids[(i + 1) % ids.length];
  AudioSys.sfx('select');
}
function toggleMute() {
  const m = !AudioSys.muted;
  AudioSys.setMute(m);
  game.settings.muted = m; saveSettings(game.settings);
  updateMuteUI();
}
function updateMuteUI() {
  const ico = AudioSys.muted ? '🔇' : '🔊';
  const a = $('btn-mute'); if (a) a.textContent = ico;
  const b = $('btn-mute2'); if (b) b.textContent = ico;
}

let scoreboardOn = false;
function toggleScoreboard(on) {
  scoreboardOn = on !== undefined ? on : !scoreboardOn;
  $('scoreboard').style.display = scoreboardOn ? 'flex' : 'none';
}

// =====================================================================
//  每帧读输入 → 游戏
// =====================================================================
const HEAL_IDS = ['medikit', 'gauze', 'tablets', 'cola'];

function playerInput() {
  const p = game.player;
  if (!p || !game.world) return { mx: 0, my: 0, aim: 0 };

  let ix = 0, iy = 0;
  const K = Input.keys;
  if (K['KeyW'] || K['ArrowUp']) iy -= 1;
  if (K['KeyS'] || K['ArrowDown']) iy += 1;
  if (K['KeyA'] || K['ArrowLeft']) ix -= 1;
  if (K['KeyD'] || K['ArrowRight']) ix += 1;
  // 触屏摇杆
  if (touchMove) {
    const len = Math.hypot(touchMove.dx, touchMove.dy);
    if (len > 12) { ix = touchMove.dx / len; iy = touchMove.dy / len; }
  }

  // 瞄准：从角色指向鼠标
  const cam = game.cam;
  const wx = cam.x + (Input.mx - game.vw / 2) / cam.zoom;
  const wy = cam.y + (Input.my - game.vh / 2) / cam.zoom;
  const aim = Math.atan2(wy - p.y, wx - p.x);

  const out = {
    mx: ix, my: iy, aim,
    fire: Input.fire || Input.firePressed,
    reload: Input.reload,
    dash: Input.dashPressed,
    pickup: Input.pickup,
    item: null,
    swap: false,
    throwNow: false
  };

  // 自动使用治疗：按住对应数字不再处理；这里加「H」为自动急救
  if (K['KeyH']) {
    const hpFrac = p.health / p.maxHealth;
    if (hpFrac < 0.6) {
      for (const id of HEAL_IDS) {
        if (p.heals[id] > 0 && p.usingT <= 0 && p.reloadT <= 0) {
          if (p.useItem(id)) { out.item = id; break; }
        }
      }
    }
  }

  Input.firePressed = false;
  Input.dashPressed = false;
  Input.reload = false;
  Input.pickup = false;
  return out;
}

// 玩家按 G 投掷
window.addEventListener('keydown', e => {
  if (e.code === 'KeyG' && game.state === STATE.PLAYING && game.player) {
    const p = game.player;
    if (p.throwCount > 0 && p.alive && !p.downed) {
      p.throwCount--;
      game.throwables.push(new Throwable(p.x, p.y, p.aim, p, p.throwable));
      AudioSys.sfx('pin');
    }
  }
}, true);

// =====================================================================
//  主循环
// =====================================================================
let lastT = performance.now();
function loop(tm) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (tm - lastT) / 1000);
  lastT = tm;

  // 输入喂给玩家实体（game.step 内部通过 this._playerInput 读取）
  game._playerInput = playerInput;

  if (game.state === STATE.PLAYING || game.state === STATE.DEAD) {
    game.frame(dt);            // frame 内部会自行渲染
  } else {
    renderer.render();
  }
  updateDynamicUI();
}
requestAnimationFrame(loop);

// =====================================================================
//  界面
// =====================================================================
function showScreen(id) {
  for (const el of document.querySelectorAll('.screen')) el.classList.remove('active');
  const el = $(id);
  if (el) el.classList.add('active');
  const menu = $('hud-topbtns');
  if (menu) menu.style.display = (id === 'screen-game') ? 'flex' : 'none';
}

let cfg = { bots: 39, diff: 3, perks: 3, name: '' };

function bindMenu() {
  // 人数
  $('bots-val').textContent = cfg.bots;
  $('bots').addEventListener('input', e => { cfg.bots = +e.target.value; $('bots-val').textContent = cfg.bots; });
  // 难度
  document.querySelectorAll('[data-diff]').forEach(b => {
    b.addEventListener('click', () => {
      cfg.diff = +b.dataset.diff;
      document.querySelectorAll('[data-diff]').forEach(x => x.classList.remove('on'));
      b.classList.add('on');
      AudioSys.sfx('select');
    });
  });
  // 天赋数
  document.querySelectorAll('[data-perkcnt]').forEach(b => {
    b.addEventListener('click', () => {
      cfg.perks = +b.dataset.perkcnt;
      document.querySelectorAll('[data-perkcnt]').forEach(x => x.classList.remove('on'));
      b.classList.add('on');
      AudioSys.sfx('select');
    });
  });
  // 昵称
  const nm = $('pname');
  const saved = localStorage.getItem('suroi-name');
  if (saved) nm.value = saved;
  nm.addEventListener('change', () => {
    cfg.name = nm.value.slice(0, C.nameMaxLength);
    localStorage.setItem('suroi-name', cfg.name);
  });

  $('btn-play').addEventListener('click', () => { AudioSys.ensure(); AudioSys.sfx('confirm'); startMatch(); });
  $('btn-mute').addEventListener('click', toggleMute);
  $('btn-mute2').addEventListener('click', toggleMute);
  $('btn-pause').addEventListener('click', togglePause);
  $('btn-resume').addEventListener('click', togglePause);
  $('btn-quit').addEventListener('click', () => { AudioSys.sfx('select'); backToMenu(); });
  $('btn-again').addEventListener('click', () => { AudioSys.sfx('confirm'); startMatch(); });
  $('btn-menu').addEventListener('click', () => { AudioSys.sfx('select'); backToMenu(); });
  $('btn-help').addEventListener('click', () => { AudioSys.sfx('select'); $('help-panel').classList.toggle('show'); });

  // 结算页查看天赋
  $('btn-perks').addEventListener('click', () => { AudioSys.sfx('select'); showPerks(); });

  // 画布全屏
  $('btn-full').addEventListener('click', () => {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
    else document.exitFullscreen?.();
  });

  updateMuteUI();
  AudioSys.muted = !!game.settings.muted;
  AudioSys.setMute(AudioSys.muted);
  cfg.perks = game.settings.perkCount ?? 3;
  document.querySelectorAll('[data-perkcnt]').forEach(x => x.classList.toggle('on', +x.dataset.perkcnt === cfg.perks));
}

function startMatch() {
  const pname = $('pname').value.slice(0, C.nameMaxLength);
  game.settings.perkCount = cfg.perks;
  saveSettings(game.settings);
  game.start({ bots: cfg.bots, diff: cfg.diff });
  game.player.name = pname || 'YOU';
  showScreen('screen-game');
  $('hud').style.display = 'block';
  updateHud();
}

function backToMenu() {
  game.state = STATE.MENU;
  AudioSys.stopMusic();
  $('hud').style.display = 'none';
  $('scoreboard').style.display = 'none';
  showScreen('screen-menu');
}

function togglePause() {
  if (game.state === STATE.PLAYING) {
    game.state = STATE.PAUSE;
    AudioSys.stopMusic();
    showScreen('screen-pause');
  } else if (game.state === STATE.PAUSE) {
    game.state = STATE.PLAYING;
    AudioSys.startMusic('battle');
    showScreen('screen-game');
  }
}

// 结算回调
game.onResult = data => {
  $('hud').style.display = 'none';
  $('res-title').textContent = data.win ? '🏆 VICTORY ROYALE' : '#' + data.rank + ' — ELIMINATED';
  $('res-title').style.color = data.win ? '#ffd166' : '#ff7a8a';
  $('res-sub').textContent = data.win
    ? '你是这张地图上最后站着的人'
    : `你排第 ${data.rank} / ${data.total}，存活 ${fmtTime(data.time)}`;
  $('res-stats').innerHTML = [
    ['KILLS', data.kills],
    ['DAMAGE', data.damage],
    ['SURVIVED', fmtTime(data.time)],
    ['ITEMS PICKED', data.picks],
    ['ITEMS USED', data.uses]
  ].map(([k, v]) => `<div class="stat"><div class="stat-k">${k}</div><div class="stat-v">${v}</div></div>`).join('');
  showScreen('screen-result');
  // 记录历史最佳
  const best = JSON.parse(localStorage.getItem('suroi-best') || '{}');
  if (!best.kills || data.kills > best.kills) {
    best.kills = data.kills; best.time = data.time; best.win = data.win;
    localStorage.setItem('suroi-best', JSON.stringify(best));
    $('best-line').textContent = `🏅 个人最佳：${best.kills} 杀${best.win ? '（吃鸡）' : ''}`;
  } else {
    $('best-line').textContent = `🏅 个人最佳：${best.kills} 杀${best.win ? '（吃鸡）' : ''}`;
  }
};

function fmtTime(s) {
  const m = Math.floor(s / 60), ss = Math.floor(s % 60);
  return `${m}:${String(ss).padStart(2, '0')}`;
}

function showPerks() {
  const box = $('res-perks');
  const ps = game.player.perks;
  box.innerHTML = ps.length
    ? ps.map(id => `<div class="perk-card"><div class="perk-n">${PERKS[id].n}</div><div class="perk-d">${PERKS[id].d}</div></div>`).join('')
    : '<div class="muted">本局未选择天赋</div>';
  box.style.display = 'flex';
}

// ---------- 动态 UI（天赋说明等）----------
function updateDynamicUI() {
  if (game.state !== STATE.PLAYING) return;
  // 分数板实时
  if (scoreboardOn) updateScoreboard();
}

function updateScoreboard() {
  const rows = game.players.filter(p => p.alive).sort((a, b) => b.kills - a.kills).slice(0, 12);
  $('sb-list').innerHTML = rows.map((p, i) => `
    <div class="sb-row ${p === game.player ? 'me' : ''}">
      <span class="sb-rank">${i + 1}</span>
      <span class="sb-name">${p.name}</span>
      <span class="sb-kill">${p.kills}</span>
    </div>`).join('');
}

function updateHud() { /* 预留 */ }

bindMenu();
backToMenu();

// 首次交互解锁音频
window.addEventListener('pointerdown', () => AudioSys.ensure(), { once: true });

// 暴露给调试
window.__game = game;
