// =====================================================================
//  数据层 · 移植自 HasangerGames/suroi (GPL-3.0)
//  数值全部对齐原版 constants.ts / guns.ts / armors.ts / healingItems.ts
//  单位约定：速度 units/ms，伤害点，射速 ms，散布度
// =====================================================================

export const C = {
  protocolVersion: 77,
  gridSize: 32,
  maxPosition: 1924,
  mapSize: 1632,          // normal 地图边长
  oceanSize: 128,
  beachSize: 32,

  // ---- 玩家 ----
  playerRadius: 2.25,
  baseSpeed: 0.03,         // units/ms => 30 units/s
  defaultHealth: 100,
  maxShield: 100,
  maxAdrenaline: 100,
  maxWeapons: 4,
  maxPerks: 3,             // 原版 maxPerkCount=1，这里增强为 3
  reviveTime: 8,
  maxReviveDist: 5,
  bleedOutDPMs: 0.002,
  nameMaxLength: 14,
  spawnWindow: 84,

  // ---- 持枪减速（原版 defaultSpeedModifiers） ----
  speedModGun: 0.88,
  speedModMelee: 1,
  speedModThrowable: 0.92,

  // ---- 毒圈 ----
  gasDamageScaleFactor: 0.005,
  gasUnscaledDamageDist: 12,

  // ---- 掉落物 ----
  lootDrag: 0.003,
  lootRadiusGun: 3.4,
  lootRadiusAmmo: 2,
  lootRadiusSmall: 2.5,
  lootRadiusBig: 3,

  // ---- 空投 ----
  airdropFallTime: 8000,
  airdropFlyTime: 30000,
  airdropDamage: 300,
  lootSpawnMaxJitter: 0.7,

  // ---- 投掷物 ----
  projectileMaxHeight: 5,
  projectileGravity: 10,
  projectileDistToMouse: 1.5,
  maxThrowDistance: 128,
  explosionMaxDistSquared: 128 * 128,
  explosionRayDistance: 2,

  // ---- 肾上腺素曲线（原版 player.ts 对数回归） ----
  adrenSpeed: { a: 0.944297822457, b: -0.0158132859327, c: 0.699999999995, d: 3.51269916486 },
  adrenRegen: { a: -2.2153107223876285, b: -1.9660534157593246, c: 0.14899999980029943, d: 22.5 },
  adrenDecay: 0.0005
};

/** 肾上腺素 → 速度倍率，原版公式 */
export function adrenSpeedMod(adren) {
  const m = C.adrenSpeed;
  return m.b * Math.log(Math.max(0, adren) + m.d) / Math.log(m.c) + m.a;
}

/** 肾上腺素 → 回血 hp/s，原版公式（仅 adren>=0 生效） */
export function adrenRegen(adren) {
  if (adren < 0) return 0;
  const m = C.adrenRegen;
  return m.a + m.b * Math.log(adren + m.d) / Math.log(m.c);
}

// ---------------------------------------------------------------------
//  武器 · 移植 guns.ts 全部 69 个基础定义 + 9 个 dual 变体
//  f=fireDelay(ms)  r=reloadTime(s)  dmg  sp=子弹速度  rng=射程
//  spd=shotSpread(deg)  mspd=moveSpread(deg)  rc=recoilMultiplier
//  rl=recoilLength(ms)  len=枪长  sm=speedMultiplier
//  tier: S/A/B/C/D
// ---------------------------------------------------------------------
export const GUNS = {
  g19:       { n:'G19',        tier:'D', ammo:'9mm',    mag:15, ext:24, r:1.5,  f:110,  mode:'single', dmg:13,   sp:0.22, rng:120, obs:1,    spd:4,   mspd:8,   rc:0.8,   rl:90,   len:4.8,  sm:1.136 },
  cz75a:     { n:'CZ-75A',     tier:'D', ammo:'9mm',    mag:16, ext:26, r:1.9,  f:60,   mode:'auto',   dmg:9,    sp:0.18, rng:70,  obs:1,    spd:8,   mspd:14,  rc:0.8,   rl:90,   len:5.3,  sm:1.136 },
  m1895:     { n:'M1895',      tier:'D', ammo:'762mm',  mag:7,  ext:0,  r:2.1,  f:375,  mode:'single', dmg:24.5, sp:0.26, rng:160, obs:1.5,  spd:2,   mspd:5,   rc:0.75,  rl:135,  len:5.35, sm:1.136 },
  deagle:    { n:'DEagle',     tier:'B', ammo:'50cal',  mag:7,  ext:9,  r:2.3,  f:200,  mode:'single', dmg:37,   sp:0.22, rng:130, obs:1.25, spd:3,   mspd:7,   rc:0.65,  rl:150,  len:5.4,  sm:1 },
  rsh12:     { n:'RSh-12',     tier:'A', ammo:'50cal',  mag:5,  ext:0,  r:2.4,  f:600,  mode:'single', dmg:60,   sp:0.3,  rng:120, obs:1,    spd:4,   mspd:6,   rc:0.8,   rl:600,  len:6.6,  sm:1, fsa:800 },
  mp5k:      { n:'MP5k',       tier:'D', ammo:'9mm',    mag:20, ext:30, r:1.8,  f:62,   mode:'burst',  dmg:12.75,sp:0.25, rng:100, obs:1.025,spd:4,  mspd:8,   rc:0.8,   rl:300,  len:5.6,  sm:1.136, burst:3, bcd:250 },
  psm:       { n:'PSM',        tier:'D', ammo:'545mm',  mag:8,  ext:12, r:2.1,  f:200,  mode:'single', dmg:17,   sp:0.26, rng:160, obs:1.5,  spd:2,   mspd:5,   rc:0.75,  rl:135,  len:4.8,  sm:1.136 },
  ots23:     { n:'OTs-23',     tier:'B', ammo:'545mm',  mag:15, ext:20, r:2.1,  f:100,  mode:'auto',   dmg:12.5, sp:0.26, rng:160, obs:1.5,  spd:2,   mspd:5,   rc:0.75,  rl:135,  len:5.1,  sm:1.136 },
  yesaul:    { n:'Yesaul',     tier:'B', ammo:'545mm',  mag:5,  ext:0,  r:2,    f:350,  mode:'single', dmg:35,   sp:0.375,rng:170, obs:1,    spd:3,   mspd:7,   rc:0.7,   rl:150,  len:6,    sm:1 },
  saf200:    { n:'SAF-200',    tier:'C', ammo:'9mm',    mag:30, ext:42, r:1.8,  f:75,   mode:'burst',  dmg:16,   sp:0.28, rng:140, obs:1,    spd:3,   mspd:4,   rc:0.75,  rl:300,  len:6.25, sm:1, burst:3, bcd:300 },
  micro_uzi: { n:'Micro Uzi',  tier:'C', ammo:'9mm',    mag:32, ext:50, r:1.75, f:40,   mode:'auto',   dmg:7.75, sp:0.16, rng:85,  obs:1,    spd:9,   mspd:19,  rc:0.75,  rl:60,   len:5.07, sm:1.136 },
  mpx:       { n:'MPX',        tier:'C', ammo:'9mm',    mag:32, ext:40, r:2.1,  f:90,   mode:'auto',   dmg:11,   sp:0.25, rng:130, obs:1,    spd:2,   mspd:4,   rc:0.75,  rl:150,  len:6.65, sm:1 },
  vector:    { n:'Vector',     tier:'A', ammo:'9mm',    mag:33, ext:50, r:1.7,  f:40,   mode:'auto',   dmg:9,    sp:0.27, rng:80,  obs:1,    spd:3,   mspd:7,   rc:0.75,  rl:60,   len:6.1,  sm:1 },
  pp19:     { n:'PP-19 Bizon',tier:'S', ammo:'9mm',    mag:64, ext:96, r:3.5,  f:82,   mode:'auto',   dmg:12.5, sp:0.25, rng:170, obs:1,    spd:2.75,mspd:6.25,rc:0.8,   rl:135,  len:7.3,  sm:1 },
  ak47:      { n:'AK-47',      tier:'C', ammo:'762mm',  mag:30, ext:40, r:2.5,  f:100,  mode:'auto',   dmg:14,   sp:0.26, rng:160, obs:1.5,  spd:2,   mspd:6,   rc:0.75,  rl:150,  len:7.75, sm:1 },
  mcx_spear: { n:'MCX Spear',  tier:'A', ammo:'762mm',  mag:20, ext:30, r:2.75, f:87.5, mode:'auto',   dmg:16,   sp:0.3,  rng:180, obs:1.5,  spd:2,   mspd:4,   rc:0.75,  rl:130,  len:7.9,  sm:1 },
  svu:       { n:'SVU-A',      tier:'A', ammo:'762mm',  mag:30, ext:40, r:3.2,  f:120,  mode:'auto',   dmg:19,   sp:0.3,  rng:180, obs:1.5,  spd:3,   mspd:8,   rc:0.725, rl:150,  len:8.4,  sm:1 },
  m16a2:     { n:'M16A2',      tier:'B', ammo:'556mm',  mag:20, ext:30, r:2.2,  f:75,   mode:'burst',  dmg:19,   sp:0.3,  rng:180, obs:1.5,  spd:2,   mspd:4,   rc:0.75,  rl:350,  len:8.68, sm:1, burst:3, bcd:325 },
  aug:       { n:'AUG',        tier:'C', ammo:'556mm',  mag:30, ext:42, r:2.25, f:70,   mode:'auto',   dmg:10.5, sp:0.28, rng:160, obs:1.5,  spd:4,   mspd:11,  rc:0.75,  rl:120,  len:6.8,  sm:1 },
  arx160:    { n:'ARX-160',    tier:'C', ammo:'762mm',  mag:30, ext:40, r:2.5,  f:75,   mode:'auto',   dmg:12.25,sp:0.26, rng:160, obs:1.5,  spd:5,   mspd:10,  rc:0.75,  rl:145,  len:7.3,  sm:1 },
  acr:       { n:'ACR',        tier:'S', ammo:'556mm',  mag:30, ext:45, r:3,    f:72.5, mode:'auto',   dmg:14.5, sp:0.28, rng:160, obs:1.5,  spd:2,   mspd:7,   rc:0.75,  rl:130,  len:7.5,  sm:1 },
  shak12:    { n:'ShAK-12',    tier:'A', ammo:'50cal',  mag:10, ext:15, r:3,    f:125,  mode:'auto',   dmg:17.5, sp:0.26, rng:60,  obs:1.5,  spd:6,   mspd:6,   rc:0.75,  rl:400,  len:7.2,  sm:1, bc:2 },
  aks74u:    { n:'AKs-74u',    tier:'B', ammo:'545mm',  mag:30, ext:40, r:2.5,  f:85,   mode:'auto',   dmg:10.45,sp:0.26, rng:160, obs:1.5,  spd:2,   mspd:6,   rc:0.75,  rl:150,  len:7.3,  sm:1 },
  an94:      { n:'AN-94',      tier:'A', ammo:'545mm',  mag:45, ext:60, r:2.5,  f:50,   mode:'burst',  dmg:24,   sp:0.32, rng:160, obs:1.5,  spd:2,   mspd:6,   rc:0.75,  rl:150,  len:7.8,  sm:1, burst:2, bcd:250 },
  as_val:    { n:'AS Val',     tier:'S', ammo:'9mm',    mag:30, ext:45, r:2.5,  f:120,  mode:'auto',   dmg:18,   sp:0.25, rng:160, obs:1,    spd:2.5, mspd:6,   rc:0.7,   rl:140,  len:7.2,  sm:1 },
  fn_fal:    { n:'FN FAL',     tier:'C', ammo:'762mm',  mag:50, ext:100,r:3.4,  f:115,  mode:'auto',   dmg:16.5, sp:0.3,  rng:180, obs:2,    spd:3.5, mspd:7.5, rc:0.7,   rl:200,  len:9.47, sm:0.897 },
  stoner_63: { n:'Stoner 63',  tier:'A', ammo:'556mm',  mag:75, ext:125,r:3.8,  f:90,   mode:'auto',   dmg:14.25,sp:0.28, rng:180, obs:2,    spd:3,   mspd:4.5, rc:0.7,   rl:175,  len:8,    sm:0.978 },
  mg5:       { n:'MG5',        tier:'S', ammo:'762mm',  mag:120,ext:160,r:5.2,  f:95,   mode:'auto',   dmg:16.5, sp:0.26, rng:180, obs:1.5,  spd:2,   mspd:4.5, rc:0.65,  rl:200,  len:8.6,  sm:0.87 },
  negev:     { n:'Negev SF',   tier:'S', ammo:'556mm',  mag:200,ext:250,r:5.9,  f:70,   mode:'auto',   dmg:13.25,sp:0.28, rng:160, obs:1.5,  spd:5,   mspd:8,   rc:0.675, rl:200,  len:7.15, sm:0.92 },
  mg36:      { n:'MG36',       tier:'B', ammo:'556mm',  mag:50, ext:100,r:2.75, f:75,   mode:'auto',   dmg:11,   sp:0.28, rng:180, obs:2,    spd:3.5, mspd:8,   rc:0.75,  rl:140,  len:7.8,  sm:1 },
  pk61:      { n:'PK-61',      tier:'A', ammo:'762mm',  mag:100,ext:150,r:4.8,  f:110,  mode:'auto',   dmg:17,   sp:0.32, rng:250, obs:2,    spd:2,   mspd:4,   rc:0.7,   rl:200,  len:9.45, sm:0.92 },
  rpk74:     { n:'RPK-74',     tier:'C', ammo:'545mm',  mag:45, ext:60, r:3.8,  f:100,  mode:'auto',   dmg:14,   sp:0.28, rng:180, obs:2,    spd:3,   mspd:4.5, rc:0.7,   rl:175,  len:8.3,  sm:0.978 },
  rpk16:     { n:'RPK-16',     tier:'A', ammo:'545mm',  mag:95, ext:145,r:3.8,  f:90,   mode:'auto',   dmg:13,   sp:0.35, rng:180, obs:2.25, spd:3,   mspd:4.5, rc:0.7,   rl:175,  len:8.3,  sm:0.978 },
  m3k:       { n:'M3K',        tier:'C', ammo:'12g',    mag:9,  ext:12, r:0.55, f:700,  mode:'single', dmg:9,    sp:0.2,  rng:80,  obs:1,    spd:5,   mspd:7,   rc:0.5,   rl:500,  len:8.5,  sm:1, bc:9, jit:0.5, spr:1 },
  model_37:  { n:'Model 37',   tier:'C', ammo:'12g',    mag:5,  ext:8,  r:0.75, f:900,  mode:'single', dmg:10,   sp:0.16, rng:48,  obs:1,    spd:11,  mspd:14,  rc:0.5,   rl:550,  len:8.15, sm:1, bc:10, jit:1.25, spr:1 },
  hp18:      { n:'HP-18',      tier:'C', ammo:'12g',    mag:5,  ext:8,  r:0.725,f:300,  mode:'single', dmg:4,    sp:0.12, rng:40,  obs:1,    spd:18,  mspd:22,  rc:0.6,   rl:600,  len:7.4,  sm:1, bc:18, jit:1.75, spr:1 },
  badlander: { n:'Badlander',  tier:'C', ammo:'12g',    mag:2,  ext:0,  r:2.6,  f:250,  mode:'single', dmg:10,   sp:0.16, rng:48,  obs:1,    spd:11,  mspd:14,  rc:0.5,   rl:550,  len:6,    sm:1, bc:10, jit:1.5 },
  usas12:    { n:'USAS-12',    tier:'S', ammo:'12g',    mag:10, ext:20, r:3,    f:525,  mode:'auto',   dmg:5,    sp:0.22, rng:50,  obs:1,    spd:2,   mspd:5,   rc:0.5,   rl:525,  len:7.35, sm:1 },
  vepr12:    { n:'Vepr-12',    tier:'B', ammo:'12g',    mag:5,  ext:8,  r:2.4,  f:400,  mode:'auto',   dmg:10,   sp:0.16, rng:48,  obs:1,    spd:11,  mspd:14,  rc:0.7,   rl:550,  len:7.3,  sm:1, bc:10, jit:1.25 },
  stevens_555:{n:'Stevens 555',tier:'C', ammo:'12g',    mag:2,  ext:0,  r:2.3,  f:300,  mode:'single', dmg:9,    sp:0.2,  rng:80,  obs:1,    spd:5,   mspd:7,   rc:0.6,   rl:400,  len:7.95, sm:1, bc:9, jit:0.5 },
  m590m:     { n:'M590M',      tier:'A', ammo:'12g',    mag:5,  ext:10, r:2.8,  f:900,  mode:'single', dmg:5,    sp:0.22, rng:50,  obs:1,    spd:2,   mspd:5,   rc:0.5,   rl:500,  len:8,    sm:1 },
  mp153:     { n:'MP-153',     tier:'A', ammo:'12g',    mag:8,  ext:12, r:0.45, f:400,  mode:'single', dmg:78,   sp:0.25, rng:120, obs:1,    spd:2,   mspd:5,   rc:0.6,   rl:400,  len:8.45, sm:1, fsa:600 },
  dp12:      { n:'DP-12',      tier:'B', ammo:'12g',    mag:14, ext:0,  r:1.2,  f:250,  mode:'single', dmg:10,   sp:0.165,rng:50,  obs:1,    spd:7.5, mspd:10.25,rc:0.5,  rl:550,  len:7.7,  sm:0.8, bc:7, jit:1, cyc:800, spr:2 },
  mosin_nagant:{n:'Mosin-Nagant',tier:'A',ammo:'762mm',mag:5,  ext:0,  r:0.85, f:900,  mode:'single', dmg:70,   sp:0.33, rng:250, obs:1,    spd:1,   mspd:2,   rc:0.45,  rl:750,  len:8.5,  sm:1, rf:true, frt:2.9, spr:1 },
  tango_51:  { n:'Tango 51',   tier:'A', ammo:'762mm',  mag:5,  ext:10, r:2.6,  f:900,  mode:'single', dmg:79,   sp:0.4,  rng:280, obs:1,    spd:0.3, mspd:0.6, rc:0.4,   rl:1000, len:8.85, sm:1 },
  cz600:     { n:'CZ-600',     tier:'B', ammo:'556mm',  mag:5,  ext:10, r:2.2,  f:600,  mode:'single', dmg:55,   sp:0.3,  rng:250, obs:1,    spd:0.75,mspd:1.25,rc:0.75,  rl:750,  len:8.25, sm:1 },
  l115a1:    { n:'L115A1',     tier:'S', ammo:'338lap', mag:3,  ext:5,  r:3.8,  f:1500, mode:'single', dmg:150,  sp:0.5,  rng:300, obs:1,    spd:0.2, mspd:0.4, rc:0.4,   rl:1600, len:10.6, sm:1 },
  rgs:       { n:'RG Scout',   tier:'A', ammo:'556mm',  mag:10, ext:15, r:2.6,  f:600,  mode:'single', dmg:65,   sp:0.33, rng:270, obs:1,    spd:0.5, mspd:2,   rc:0.75,  rl:600,  len:8.75, sm:1 },
  vks:       { n:'VKS Vykhlop',tier:'S', ammo:'50cal',  mag:5,  ext:10, r:3.2,  f:800,  mode:'single', dmg:95,   sp:0.27, rng:180, obs:1,    spd:1,   mspd:3,   rc:0.6,   rl:1000, len:8.95, sm:1 },
  ulr338:    { n:'ULR-338',    tier:'S', ammo:'338lap', mag:1,  ext:0,  r:4.3,  f:2000, mode:'single', dmg:185,  sp:0.45, rng:450, obs:1.5,  spd:0.1, mspd:0.7, rc:0.65,  rl:3200, len:11.68,sm:0.7 },
  ssg82:     { n:'SSG 82',     tier:'A', ammo:'545mm',  mag:5,  ext:10, r:2.5,  f:650,  mode:'single', dmg:65,   sp:0.45, rng:275, obs:1,    spd:0.65,mspd:1.1, rc:0.75,  rl:700,  len:8.6,  sm:1 },
  vss:       { n:'VSS Vintorez',tier:'B',ammo:'9mm',    mag:20, ext:30, r:2.15, f:140,  mode:'single', dmg:30,   sp:0.25, rng:160, obs:1.5,  spd:2,   mspd:3.5, rc:0.7,   rl:140,  len:7.2,  sm:1 },
  sr25:      { n:'SR-25',      tier:'B', ammo:'762mm',  mag:20, ext:30, r:2.5,  f:200,  mode:'single', dmg:33,   sp:0.3,  rng:230, obs:1.5,  spd:1,   mspd:3.5, rc:0.7,   rl:200,  len:7.85, sm:1 },
  mini14:    { n:'Mini-14',    tier:'B', ammo:'556mm',  mag:20, ext:30, r:2.4,  f:155,  mode:'single', dmg:25.5, sp:0.3,  rng:230, obs:1.5,  spd:2,   mspd:5,   rc:0.8,   rl:155,  len:7.6,  sm:1 },
  m1_garand: { n:'M1 Garand',  tier:'S', ammo:'762mm',  mag:8,  ext:0,  r:2.1,  f:250,  mode:'single', dmg:48,   sp:0.35, rng:230, obs:1.5,  spd:1,   mspd:3.5, rc:0.75,  rl:200,  len:8.65, sm:1 },
  model_89:  { n:'Model 89',   tier:'A', ammo:'50cal',  mag:7,  ext:10, r:0.4,  f:350,  mode:'single', dmg:55,   sp:0.31, rng:250, obs:1.5,  spd:1,   mspd:4,   rc:0.7,   rl:300,  len:7.3,  sm:1 },
  sks:       { n:'SKS',        tier:'C', ammo:'762mm',  mag:10, ext:20, r:0.4,  f:180,  mode:'single', dmg:23,   sp:0.27, rng:180, obs:1.5,  spd:3,   mspd:5,   rc:0.8,   rl:150,  len:7.9,  sm:1, rf:true, frt:2.4, spr:2 },
  blr:       { n:'BLR 556',    tier:'C', ammo:'556mm',  mag:5,  ext:10, r:2.1,  f:350,  mode:'single', dmg:45,   sp:0.32, rng:200, obs:1,    spd:2,   mspd:5,   rc:0.8,   rl:300,  len:7.55, sm:1 },
  mk18:      { n:'Mk-18 Mjölnir',tier:'S',ammo:'338lap',mag:5,  ext:10, r:3.8,  f:450,  mode:'single', dmg:90,   sp:0.4,  rng:250, obs:1.5,  spd:1,   mspd:4,   rc:0.65,  rl:500,  len:9.65, sm:1, fsa:700 },
  mk14:      { n:'Mk 14 EBR',  tier:'S', ammo:'762mm',  mag:10, ext:20, r:2.5,  f:130,  mode:'auto',   dmg:25,   sp:0.35, rng:200, obs:1.5,  spd:1.5, mspd:5,   rc:0.7,   rl:150,  len:9.3,  sm:1 },
  m202:      { n:'M202-F',     tier:'S', ammo:'plumpkin',mag:4,  ext:0,  r:6.3,  f:850,  mode:'auto',   dmg:20,   sp:0.15, rng:135, obs:1,    spd:0,   mspd:0,   rc:0.01,  rl:0,    len:7.35, sm:0.495 },
  seedshot:  { n:'Seedshot',   tier:'S', ammo:'seed',   mag:20, ext:30, r:2.6,  f:80,   mode:'auto',   dmg:2,    sp:0.22, rng:180, obs:1.5,  spd:3,   mspd:6.75,rc:0.8,  rl:200,  len:7.9,  sm:1 },
  firework_launcher:{n:'Firework Launcher',tier:'S',ammo:'rocket',mag:3,ext:5,r:1.25,f:1250,mode:'single',dmg:20,  sp:0.15, rng:120, obs:1,    spd:5,   mspd:14,  rc:0.5,   rl:925,  len:5.65, sm:0.707 },
  aged_seedshot:{n:'booo very scary',tier:'A',ammo:'seed',mag:12,ext:24, r:3, f:110, mode:'auto',   dmg:8,    sp:0.245,rng:180, obs:1.65, spd:1.15,mspd:5.58,rc:0.75, rl:205,  len:7.9,  sm:1, cyc:120 },
  icicle_bow:{ n:'Icicle Bow',tier:'S', ammo:'icicle', mag:1,  ext:0,  r:2.95, f:150,  mode:'single', dmg:75,   sp:0.39, rng:275, obs:0.5,  spd:0.3, mspd:1,   rc:0.9,   rl:200,  len:7,    sm:0.9 },
  death_ray: { n:'Death Ray',  tier:'S', ammo:'power_cell',mag:1,ext:0, r:1.4, f:40,   mode:'auto',   dmg:800,  sp:4,    rng:800, obs:2,    spd:0.15,mspd:0.1, rc:0.8,   rl:100,  len:8.4,  sm:1 },
  revitalizer:{n:'Revitalizer',tier:'A',ammo:'12g',    mag:5,  ext:8,  r:0.75, f:900,  mode:'single', dmg:10,   sp:0.16, rng:48,  obs:1,    spd:11,  mspd:14,  rc:0.5,   rl:550,  len:6.88, sm:1, bc:10, spr:1 },
  g17_scoped:{n:'G17 (scoped)',tier:'C',ammo:'bb',    mag:100,ext:250,r:1.5, f:35,   mode:'auto',   dmg:2,    sp:0.1,  rng:70,  obs:0.5,  spd:0.5, mspd:5,   rc:0.99,  rl:10,   len:6.7,  sm:1.63 },

  // ---- 双持变体（原版 dual 自动生成：2倍弹匣 + 更快射速 + 2倍散布） ----
  dual_g19:   { n:'Dual G19',    tier:'C', ammo:'9mm',   mag:30, ext:0, r:2.9, f:75,   mode:'auto', dmg:13,  sp:0.22, rng:120, obs:1,   spd:5,   mspd:10,  rc:0.8,  rl:90,   len:4.8,  sm:1.136, dual:1.3 },
  dual_cz75a: { n:'Dual CZ-75A', tier:'C', ammo:'9mm',   mag:32, ext:0, r:3.7, f:30,   mode:'auto', dmg:9,   sp:0.18, rng:70,  obs:1,   spd:8,   mspd:16,  rc:0.8,  rl:90,   len:5.3,  sm:1.136, dual:1.3 },
  dual_m1895: { n:'Dual M1895',  tier:'C', ammo:'762mm', mag:14, ext:0, r:4,   f:187.5,mode:'single',dmg:24.5,sp:0.26,rng:160,obs:1.5, spd:2,  mspd:7,   rc:0.75, rl:135,  len:5.35, sm:1.136, dual:1.3 },
  dual_deagle:{ n:'Dual DEagle', tier:'A', ammo:'50cal', mag:14, ext:0, r:3.8, f:115,  mode:'single',dmg:37,  sp:0.22, rng:130, obs:1.25,spd:3,  mspd:9,   rc:0.65, rl:150,  len:5.4,  sm:1, dual:1.4 },
  dual_rsh12: { n:'Dual RSh-12', tier:'S', ammo:'50cal', mag:10, ext:0, r:4.2, f:300,  mode:'single',dmg:60,  sp:0.3,  rng:120, obs:1,   spd:10,  mspd:14,  rc:0.8,  rl:600,  len:6.6,  sm:1, dual:1.3 },
  dual_mp5k:  { n:'Dual MP5k',   tier:'C', ammo:'9mm',   mag:40, ext:0, r:3.2, f:60,   mode:'burst', dmg:12.75,sp:0.25,rng:100,obs:1.025,spd:4,mspd:10,rc:0.8,  rl:300,  len:5.6,  sm:1.136, dual:1.3, burst:3, bcd:250 },
  dual_psm:   { n:'Dual PSM',    tier:'C', ammo:'545mm', mag:16, ext:0, r:4,   f:168,  mode:'single',dmg:17,  sp:0.26, rng:160, obs:1.5, spd:2,  mspd:7,   rc:0.75, rl:135,  len:4.8,  sm:1.136, dual:1.3 },
  dual_ots23: { n:'Dual OTs-23', tier:'A', ammo:'545mm', mag:30, ext:0, r:4,   f:75,   mode:'auto',   dmg:12.5,sp:0.26, rng:160, obs:1.5, spd:2,  mspd:7,   rc:0.75, rl:135,  len:5.1,  sm:1.136, dual:1.4 },
  dual_yesaul:{ n:'Dual Yesaul', tier:'A', ammo:'545mm', mag:10, ext:0, r:4,   f:175,  mode:'single',dmg:35,  sp:0.375,rng:170, obs:1,   spd:5,  mspd:9,   rc:0.7,  rl:150,  len:6,    sm:1, dual:1.3 }
};

// ---------------------------------------------------------------------
//  弹药 · 移植 ammos.ts
// ---------------------------------------------------------------------
export const AMMOS = {
  '9mm':    { n:'9mm',          max:90,  min:5, hid:false },
  '762mm':  { n:'7.62mm',       max:60,  min:5, hid:false },
  '556mm':  { n:'5.56mm',       max:60,  min:5, hid:false },
  '545mm':  { n:'5.45mm',       max:60,  min:5, hid:true  },
  '12g':    { n:'12 gauge',     max:20,  min:3, hid:false },
  '50cal':  { n:'.50 Cal',      max:9,   min:3, hid:true  },
  '338lap': { n:'.338 Lapua',   max:9,   min:3, hid:true  },
  'rocket': { n:'Firework Rkt', max:5,   min:1, hid:true  },
  'power_cell': { n:'P.O.W.E.R. cell', max:10, min:1, hid:true, eph:true },
  'bb':     { n:'6mm BB',       max:240, min:1, hid:true, eph:true },
  'seed':   { n:'Seed',         max:0,   min:0, hid:true, eph:true },
  'needle': { n:'Needle',       max:0,   min:0, hid:true, eph:true },
  'plumpkin': { n:'Plumpkin',   max:0,   min:0, hid:true, eph:true },
  'icicle': { n:'Icicle',       max:0,   min:0, hid:true, eph:true }
};

// ---------------------------------------------------------------------
//  近战 · 移植 melees.ts
// ---------------------------------------------------------------------
export const MELEES = {
  fists:        { n:'Fists',        tier:'D', dmg:20, len:1.5,  off:[2.5, 0],     cd:250, obs:1,   ice:0.01, all:false, noDrop:true },
  baseball_bat: { n:'Baseball Bat', tier:'C', dmg:34, len:4,    off:[3.8, 2.2],  cd:450, obs:1.5, ice:1,    all:true },
  fire_hatchet: { n:'Fire Hatchet', tier:'A', dmg:50, len:2.05, off:[5.2, -0.5], cd:420, obs:2,   ice:5,    all:false },
  kbar:         { n:'K-bar',        tier:'C', dmg:25, len:2.7,  off:[3.1, 0.9],  cd:225, obs:1.25,ice:0.1,  all:false },
  maul:         { n:'Maul',         tier:'S', dmg:54, len:2.7,  off:[5.4, -0.5], cd:450, obs:2,   ice:5,    all:false },
  steelfang:    { n:'Steelfang',    tier:'S', dmg:40, len:2.7,  off:[3.1, 0.9],  cd:200, obs:1,   ice:1,    all:false },
  heap_sword:   { n:'HE-AP sword',  tier:'S', dmg:75, len:4,    off:[5, 0],       cd:300, obs:2.5, ice:1,    all:true },
  ice_pick:     { n:'Ice Pick',     tier:'S', dmg:40, len:2.8,  off:[5.4, -0.5], cd:350, obs:1.9, ice:5,    all:false },
  seax:         { n:'Seax',         tier:'A', dmg:45, len:2.7,  off:[5.4, -0.5], cd:410, obs:1.5, ice:1,    all:true },
  falchion:     { n:'Falchion',     tier:'B', dmg:41, len:4.1,  off:[7.2, 0.5],  cd:450, obs:1.1, ice:1,    all:true },
  pan:          { n:'Pan',          tier:'S', dmg:42, len:2.7,  off:[5.5, 2],    cd:500, obs:1.5, ice:1,    all:false },
  kukri:        { n:'Kukri',        tier:'A', dmg:40, len:2.5,  off:[4.25, -0.8],cd:350, obs:1,   ice:0.1,  all:true },
  pipe_wrench:  { n:'Pipe Wrench',  tier:'A', dmg:36, len:2.6,  off:[4.25,-0.05],cd:450, obs:1.5, ice:1,    all:false },
  scythe:       { n:'Sythe',        tier:'A', dmg:45, len:3,    off:[6, -0.8],   cd:725, obs:2.25,ice:2,    all:false },
  gas_can:      { n:'Gas Can',      tier:'S', dmg:22, len:1.75, off:[3.1, 0.5],  cd:250, obs:1,   ice:1,    all:false }
};

// ---------------------------------------------------------------------
//  投掷物 · 移植 throwables.ts + explosions.ts
// ---------------------------------------------------------------------
export const THROWABLES = {
  frag_grenade:  { n:'Frag Grenade',   tier:'C', fuse:4000,  cook:true,  spr:1, expl:'frag' },
  smoke_grenade: { n:'Smoke Grenade',  tier:'D', fuse:2000,  cook:false, spr:1, expl:'smoke' },
  confetti_grenade:{n:'Confetti Grenade',tier:'S',fuse:4000, cook:true,  spr:1, expl:'confetti' },
  c4:            { n:'C4',             tier:'S', fuse:750,   cook:false, spr:1, expl:'c4' },
  flare:         { n:'Flare',          tier:'S', fuse:30000, cook:false, spr:0.25, expl:null },
  sm56:          { n:'S.E.E.D.',       tier:'A', fuse:3000,  cook:true,  spr:1, expl:'sm56' }
};

export const EXPLOSIONS = {
  frag:      { dmg:120, obs:1.15, min:10, max:25, shards:10,  sdmg:15, sspd:0.08, srng:20 },
  c4:        { dmg:130, obs:1.15, min:10, max:25, shards:0,   sdmg:0,  sspd:0,    srng:0 },
  sm56:      { dmg:100, obs:1.15, min:10, max:25, shards:10,  sdmg:15, sspd:0.08, srng:80 },
  smoke:     { dmg:0,   obs:0,    min:0,  max:0,  shards:0,   sdmg:0,  sspd:0,    srng:0 },
  confetti:  { dmg:97,  obs:1,    min:9,  max:19, shards:40,  sdmg:3,  sspd:0.08, srng:20 },
  rocket:    { dmg:97,  obs:1,    min:9,  max:19, shards:17,  sdmg:3,  sspd:0.06, srng:10 },
  barrel:    { dmg:130, obs:2,    min:8,  max:25, shards:10,  sdmg:2,  sspd:0.08, srng:20 },
  silo:      { dmg:500, obs:3,    min:35, max:45, shards:50,  sdmg:15, sspd:0.8,  srng:60 }
};

// ---------------------------------------------------------------------
//  治疗品 · 移植 healingItems.ts
// ---------------------------------------------------------------------
export const HEALS = {
  gauze:           { n:'Gauze',           type:'hp',    amt:20,  time:3 },
  medikit:         { n:'Medikit',         type:'hp',    amt:100, time:6 },
  cola:            { n:'Cola',            type:'adren', amt:25,  time:3 },
  tablets:         { n:'Tablets',         type:'adren', amt:50,  time:4 },
  vaccine_syringe: { n:'Vaccine Syringe', type:'special',amt:50, time:2 }
};

// ---------------------------------------------------------------------
//  护甲 · 移植 armors.ts  dr=伤害减免比例
// ---------------------------------------------------------------------
export const ARMORS = {
  basic_helmet:   { n:'Basic Helmet',    slot:'head', lvl:1, dr:0.10, col:'#9aa5b1' },
  regular_helmet: { n:'Regular Helmet',  slot:'head', lvl:2, dr:0.15, col:'#6f7d8c' },
  tactical_helmet:{ n:'Tactical Helmet', slot:'head', lvl:3, dr:0.20, col:'#4a5560' },
  power_helmet:   { n:'NTK-11 Halycon',  slot:'head', lvl:4, dr:0.25, col:'#7a5cff', perk:'ThermalGoggles' },
  basic_vest:     { n:'Basic Vest',      slot:'body', lvl:1, dr:0.20, col:'#c8c8c6' },
  regular_vest:   { n:'Regular Vest',    slot:'body', lvl:2, dr:0.35, col:'#404d2e' },
  tactical_vest:  { n:'Tactical Vest',   slot:'body', lvl:3, dr:0.45, col:'#0d0d0d' },
  power_vest:     { n:'ERV-3 Core',      slot:'body', lvl:4, dr:0.35, col:'#e8f4ff', perk:'ExperimentalForcefield' }
};

// ---------------------------------------------------------------------
//  背包 · 移植 backpacks.ts
// ---------------------------------------------------------------------
export const PACKS = {
  bag:          { n:'Bag',          lvl:0, gauze:5,  medikit:1, syringe:1, cola:2,  tablets:1, ammo:15, throwable:3 },
  basic_pack:   { n:'Basic Pack',   lvl:1, gauze:10, medikit:2, syringe:2, cola:5,  tablets:2, ammo:30, throwable:6 },
  regular_pack: { n:'Regular Pack', lvl:2, gauze:15, medikit:3, syringe:3, cola:10, tablets:3, ammo:60, throwable:9 },
  tactical_pack:{ n:'Tactical Pack',lvl:3, gauze:30, medikit:4, syringe:4, cola:15, tablets:4, ammo:90, throwable:12 }
};

// ---------------------------------------------------------------------
//  瞄准镜 · 移植 scopes.ts（zoomLevel 驱动相机缩放）
// ---------------------------------------------------------------------
export const SCOPES = {
  s1:  { n:'1x',  zoom:70,  def:true },
  s2:  { n:'2x',  zoom:100, def:true },
  s4:  { n:'4x',  zoom:130 },
  s8:  { n:'8x',  zoom:160 },
  s16: { n:'16x', zoom:220 }
};

// ---------------------------------------------------------------------
//  天赋 · 移植 perks.ts + 新增（增强）
//  cat: normal / infection / hunted
// ---------------------------------------------------------------------
export const PERKS = {
  // --- 原版 ---
  second_wind:   { n:'Second Wind',      cat:'normal',    d:'血量低于 50% 时移速 +40%', spd:1.4, cond:'lowhp' },
  sabot_rounds:  { n:'Sabot Rounds',     cat:'normal',    d:'移动速度 +50%', spd:1.5 },
  berserker:     { n:'Berserker',        cat:'normal',    d:'移速 +20%，肾上腺素消耗减半', spd:1.2, adrenDrain:0.5 },
  close_qtrs:    { n:'Close Quarters',   cat:'normal',    d:'50 距离内换弹速度 +30%', cutoff:50, reloadMod:1.3 },
  tactical_reload:{n:'Tactical Reload',  cat:'normal',    d:'换弹速度 +25%', reloadMod:1.25 },
  butterfingers: { n:'Butterfingers',    cat:'normal',    d:'换弹速度 -25%', reloadMod:0.75 },
  overclocked:   { n:'Overclocked',      cat:'normal',    d:'射速 +54%（射速间隔 ×0.65）', fireMod:0.65 },
  infinite_ammo: { n:'Infinite Ammo',    cat:'normal',    d:'无限弹药（子弹不消耗）', infAmmo:true },
  field_medic:   { n:'Field Medic',      cat:'normal',    d:'治疗物品使用速度 +50%', healMod:2 },
  advanced_ath:  { n:'Advanced Athletics',cat:'normal',   d:'最大生命 +25', maxHealth:25 },
  low_profile:   { n:'Low Profile',      cat:'normal',    d:'受到远距离伤害 -15%', longReduce:0.15 },
  hollow_points: { n:'Hollow Points',    cat:'normal',    d:'伤害 +10%', dmgMod:1.1 },
  demo_expert:   { n:'Demo Expert',      cat:'normal',    d:'爆炸伤害 -50%（自身）', selfBlast:0.5 },
  lootsense:     { n:'Loot Baron',       cat:'normal',    d:'拾取范围 +60%', lootRange:1.6 },
  topspeed:      { n:'Toploaded',        cat:'normal',    d:'移速 +12%，肾上腺素上限 +25', spd:1.12, adrenMax:25 },
  // --- 新增增强 ---
  ironlung:      { n:'Iron Lung',        cat:'normal',    d:'最大生命 +40，最大肾上腺素 +40', maxHealth:40, adrenMax:40 },
  swift:         { n:'Swift Feet',       cat:'normal',    d:'移速 +18%，冲刺冷却 -40%', spd:1.18, dashCd:0.6 },
  vampiric:      { n:'Vampiric',         cat:'normal',    d:'击杀恢复 30 生命 + 30 肾上腺素', vampiric:30 },
  scavenger:     { n:'Scavenger',        cat:'normal',    d:'击杀掉落 1 个空投补给箱', scav:1 },
  laststand:     { n:'Last Stand',       cat:'normal',    d:'受到致命伤时免疫一次并回复 40 生命', lastStand:true },
  executioner:   { n:'Executioner',      cat:'normal',    d:'对生命低于 40% 的敌人伤害 +25%', exec:1.25 },
  scavenger_ammo:{ n:'Ammo Scavenger',   cat:'normal',    d:'拾取弹药时额外获得 50%', ammoBonus:1.5 },
  zonewalker:    { n:'Zone Walker',      cat:'normal',    d:'毒圈伤害 -60%，免疫减速', gasResist:0.4 },
  medic:         { n:'Field Medic II',   cat:'normal',    d:'每秒回复 1.5 生命（不依赖肾上腺素）', constRegen:1.5 }
};

// ---------------------------------------------------------------------
//  毒圈阶段 · 移植 gasStages.ts（半径系数 / 时长秒 / dps / 空投）
// ---------------------------------------------------------------------
export const GAS_STAGES = [
  { state:'inactive', dur:0,     r:0.76, to:0.76, dps:0,  drop:false },
  { state:'waiting',  dur:75,    r:0.76, to:0.55, dps:0,  drop:false },
  { state:'advancing',dur:20,    r:0.76, to:0.55, dps:1,  drop:false },
  { state:'waiting',  dur:45,    r:0.55, to:0.43, dps:1,  drop:true },
  { state:'advancing',dur:20,    r:0.55, to:0.43, dps:1,  drop:false },
  { state:'waiting',  dur:40,    r:0.43, to:0.32, dps:2,  drop:false },
  { state:'advancing',dur:15,    r:0.43, to:0.32, dps:2,  drop:false },
  { state:'waiting',  dur:35,    r:0.32, to:0.20, dps:3,  drop:true },
  { state:'advancing',dur:15,    r:0.32, to:0.20, dps:3,  drop:false },
  { state:'waiting',  dur:30,    r:0.20, to:0.09, dps:5,  drop:false },
  { state:'advancing',dur:15,    r:0.20, to:0.09, dps:5,  drop:false },
  { state:'waiting',  dur:20,    r:0.09, to:0,    dps:10, drop:true, final:true },
  { state:'advancing',dur:60,    r:0.09, to:0,    dps:10, drop:true, final:true },
  { state:'final',    dur:0,     r:0,    to:0,    dps:10, drop:false, final:true }
];

// ---------------------------------------------------------------------
//  掉落权重 · 移植 lootTables.ts（normal 模式）
// ---------------------------------------------------------------------
export const LOOT_WEIGHTS = {
  guns: {
    g19:2, m1895:1.75, mpx:1.7, saf200:1.5, cz75a:1.5, hp18:1.25, micro_uzi:1, ak47:1,
    model_37:0.95, mp5k:0.85, aug:0.7, sks:0.7, m3k:0.3, m16a2:0.1, arx160:0.1, badlander:0.1,
    fn_fal:0.05, cz600:0.04, vss:0.02, mg36:0.015, sr25:0.01, mini14:0.01, mcx_spear:0.01,
    vepr12:0.008, stoner_63:0.005, mosin_nagant:0.005, vector:0.004, deagle:0.004,
    model_89:0.003, vks:0.003, negev:0.003, mg5:0.003, tango_51:0.002, dual_deagle:0.001
  },
  equipment: {
    basic_helmet:1, regular_helmet:0.2, tactical_helmet:0.01,
    basic_vest:1, regular_vest:0.2, tactical_vest:0.01,
    basic_pack:1, regular_pack:0.2, tactical_pack:0.01
  },
  melee: { baseball_bat:3, kbar:2, pan:0.1, scythe:0.4, kukri:0.5 },
  heals: { cola:2, tablets:1, medikit:1, gauze:1.5 },
  throwables: { frag_grenade:3, smoke_grenade:2, sm56:0.3, c4:0.1, confetti_grenade:0.1, flare:0.4 },
  // 空投专属（S 级枪不在普通表）
  airdrop_guns: { pp19:1, acr:1, as_val:1, mg5:0.6, negev:0.6, l115a1:0.35, ulr338:0.2, mk18:0.4, mk14:0.4, m1_garand:0.5, death_ray:0.06, firework_launcher:0.3, usas12:0.3, vks:0.3, rsh12:0.4, seedshot:0.2, aged_seedshot:0.3, icicle_bow:0.15, m202:0.08, revitalizer:0.3, g17_scoped:0.25, shak12:0.4, dual_rsh12:0.2, rgs:0.3 },
  // 普通地面掉落表分组权重（ground_loot）
  ground: { equipment:1, heals:1, ammo:1, guns:0.9, scopes:0.3 },
  crate:  { guns:1.25, equipment:1, heals:1, ammo:0.5, scopes:0.3, throwables:0.3, melee:0.04 }
};

// 稀有度配色
export const TIER_COL = { S:'#ffd166', A:'#ff9f43', B:'#5ec8ff', C:'#8fe388', D:'#b0b7c3' };
export const TIER_ORDER = { D:0, C:1, B:2, A:3, S:4 };

/** 按权重随机抽一个 key */
export function weightedPick(weights) {
  let total = 0;
  for (const k in weights) total += weights[k];
  let r = Math.random() * total;
  for (const k in weights) { r -= weights[k]; if (r <= 0) return k; }
  return Object.keys(weights)[0];
}
