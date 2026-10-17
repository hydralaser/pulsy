const canvas = document.getElementById('field');
const ctx = canvas.getContext('2d');
const hud = document.getElementById('hud');
const debugBox = document.getElementById('debug');

const debugLog = [];
function logDebug(line) {
  const ts = new Date().toLocaleTimeString();
  debugLog.push(`[${ts}] ${line}`);
  while (debugLog.length > 80) debugLog.shift();
  renderDebug();
}
function renderDebug() {
  if (!debugBox) return;
  debugBox.textContent = debugLog.join('\n');
}

const DPR = window.devicePixelRatio || 1;
function resizeCanvas() {
  const { width, height } = canvas.getBoundingClientRect();
  canvas.width = Math.round(width * DPR);
  canvas.height = Math.round(height * DPR);
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

class Input {
  constructor() {
    this.keys = new Set();
    this.pressed = new Set();
    this.mouse = { x: 0, y: 0 };
  }
  isDown(code) { return this.keys.has(code); }
  consume(code) { if (this.pressed.has(code)) { this.pressed.delete(code); return true; } return false; }
  flush() { this.pressed.clear(); }
}
const input = new Input();

// Base configuration
const ORDER_DATA = {
  march:   { label: 'March',   speed: 70, accel: 7,  turnRate: 1.0, staminaUse: 0,  staminaRegen: 12, melee: 1,   defense: 1   },
  charge:  { label: 'Charge',  speed: 85, accel: 10, turnRate: 0.9, staminaUse: 25, staminaRegen: 0,  melee: 1.7, defense: 0.9 },
  ranged:  { label: 'Ranged',  speed: 60, accel: 6,  turnRate: 1.1, staminaUse: 4,  staminaRegen: 4,  melee: 0.6, defense: 0.8 },
  shielding:{label: 'Shield',  speed: 50, accel: 4,  turnRate: 0.8, staminaUse: 0,  staminaRegen: 10, melee: 0.9, defense: 1.4 },
  ward:    { label: 'Ward',    speed: 45, accel: 5,  turnRate: 1.0, staminaUse: 0,  staminaRegen: 8,  melee: 1,   defense: 1.1 }
};
const ORDER_KEYS = { Digit1: 'march', /* Digit2: 'charge' disabled: charge only via W+Shift */ Digit3: 'ranged', Digit4: 'shielding', Digit5: 'ward' };

const BLOCKED_KEYS = new Set(['KeyW','KeyA','KeyS','KeyD','ShiftLeft','ShiftRight','KeyQ','KeyE','ArrowUp','ArrowDown','Digit1','Digit2','Digit3','Digit4','Digit5','Space']);

const MELEE_RANGE = 26;
const SLOT_SPACING = 24;
const SOLDIER_SPEED = 65;
const RANGED_RANGE = 260;
const RANGED_ARC = Math.PI / 3;

// Debug-adjustable parameters
const DEBUG = {
  combatSpeed: 1,
  playerPower: 1,
  enemyPower: 1,
  charSpeed: 1,
  formSpeed: 1,
  formTurn: 1,
  chargeMult: 1.25
};

const world = { player: null, enemy: null, target: null, engagedChars: 0, selected: null, infoExpanded: false, prev: { pEnergy: 100, pMorale: 100, eEnergy: 100, eMorale: 100 } };

// Combat rules loaded from external JSON
let RULES = {
  weapons: {}, armour: {}, shields: {}
};
async function loadRules(){
  try{ const res = await fetch('combat_rules.json'); if (res.ok){ RULES = await res.json(); populateEquipSelectors(); } }
  catch(e){ /* fall back to defaults defined later if any */ }
  // Initialize shields based on two-handed weapons and shield types
  const initUnit = (form)=>{
    if (!form) return;
    form.soldiers.forEach(s=>{
      const w = RULES.weapons[s.equipment];
      if (w && w.twoHanded){ s.shieldType='none'; s.shieldHP=0; s.shieldMax=0; }
      const sh = RULES.shields[s.shieldType||'none']||{hp:0};
      if (s.shieldHP==null){ s.shieldMax = sh.hp||0; s.shieldHP = s.shieldMax; }
    });
  };
  initUnit(world.player); initUnit(world.enemy);
}
loadRules();

const contactRound = { active: false, time: 0, pushDone: false, stats: undefined };

function clamp(v, a, b){ return Math.min(b, Math.max(a, v)); }
function mix(a, b, t){ return a + (b - a) * clamp(t, 0, 1); }
function length2(v){ return Math.hypot(v.x, v.y); }
function darkenHex(hex, factor){ try{ const h=hex.replace('#',''); const r=Math.max(0,Math.min(255,Math.floor(parseInt(h.slice(0,2),16)*factor))); const g=Math.max(0,Math.min(255,Math.floor(parseInt(h.slice(2,4),16)*factor))); const b=Math.max(0,Math.min(255,Math.floor(parseInt(h.slice(4,6),16)*factor))); const to=(n)=>n.toString(16).padStart(2,'0'); return `#${to(r)}${to(g)}${to(b)}`;}catch{return hex;} }
function angleWrap(a){ while (a > Math.PI) a -= Math.PI*2; while (a < -Math.PI) a += Math.PI*2; return a; }
function mixAngle(a, b, t){ const d = angleWrap(b - a); return a + d * clamp(t, 0, 1); }
function weaponReach(s){ const w = RULES.weapons[s.equipment]; return (w && w.reach) ? w.reach : 0; }

function formationHalfExtents(f){
  // Use cached extents if available; otherwise fall back to rows/cols footprint.
  if (f.bbHalfExtents) return f.bbHalfExtents;
  const halfW = (f.cols - 1) * SLOT_SPACING * 0.5 + SLOT_SPACING * 0.4; // across (right)
  const halfD = (f.rows - 1) * SLOT_SPACING * 0.5 + SLOT_SPACING * 0.4; // forward (depth)
  return { x: halfW, y: halfD };
}

function obbOverlap(a, b){
  const ax = a.rightVec();
  const ay = a.forwardVec();
  const bx = b.rightVec();
  const by = b.forwardVec();
  const ha = formationHalfExtents(a);
  const hb = formationHalfExtents(b);
  const dx = b.center.x - a.center.x; const dy = b.center.y - a.center.y;
  const t = { x: dx * ax.x + dy * ax.y, y: dx * ay.x + dy * ay.y };
  const R00 = ax.x * bx.x + ax.y * bx.y;
  const R01 = ax.x * by.x + ax.y * by.y;
  const R10 = ay.x * bx.x + ay.y * bx.y;
  const R11 = ay.x * by.x + ay.y * by.y;
  const A=(v)=>Math.abs(v)+1e-6; const AR00=A(R00), AR01=A(R01), AR10=A(R10), AR11=A(R11);
  if (Math.abs(t.x) > ha.x + hb.x * AR00 + hb.y * AR01) return { overlap:false };
  if (Math.abs(t.y) > ha.y + hb.x * AR10 + hb.y * AR11) return { overlap:false };
  const tbx = Math.abs(t.x * R00 + t.y * R10);
  const tby = Math.abs(t.x * R01 + t.y * R11);
  if (tbx > hb.x + ha.x * AR00 + ha.y * AR10) return { overlap:false };
  if (tby > hb.y + ha.x * AR01 + ha.y * AR11) return { overlap:false };
  const px = ha.x + hb.x * AR00 + hb.y * AR01 - Math.abs(t.x);
  const py = ha.y + hb.x * AR10 + hb.y * AR11 - Math.abs(t.y);
  const pbx = hb.x + ha.x * AR00 + ha.y * AR10 - tbx;
  const pby = hb.y + ha.x * AR01 + ha.y * AR11 - tby;
  let depth = px; let nx = (t.x < 0 ? -ax.x : ax.x); let ny = (t.x < 0 ? -ax.y : ax.y);
  if (py < depth){ depth = py; nx = (t.y < 0 ? -ay.x : ay.x); ny = (t.y < 0 ? -ay.y : ay.y); }
  if (pbx < depth){ depth = pbx; const s=(t.x * R00 + t.y * R10) < 0 ? -1 : 1; nx = bx.x * s; ny = bx.y * s; }
  if (pby < depth){ depth = pby; const s=(t.x * R01 + t.y * R11) < 0 ? -1 : 1; nx = by.x * s; ny = by.y * s; }
  return { overlap:true, normal:{x:nx,y:ny}, depth };
}

class Formation {
  constructor(options){
    this.name = options.name;
    this.center = { x: options.x ?? canvas.width*0.35, y: options.y ?? canvas.height*0.5 };
    this.heading = options.heading ?? 0;
    this.rows = options.rows ?? 4;
    this.cols = options.cols ?? 5;
    this.controlled = !!options.controlled;
    this.color = options.color || '#86c5ff';
    this.accent = options.accent || '#4ea1f0';
    this.order = 'march';
    this.velocity = { x: 0, y: 0 };
    this.energy = 100; this.morale=100; this.ammo = options.ammo ?? 0;
    this.stationary = !!options.stationary;
    this.baseCount = options.count ?? this.rows*this.cols;
    this.minRows = 2; this.maxRows = 12; this.minCols = 2; this.maxCols = 16;
    this.soldiers = [];
    this.retreat = { vx:0, vy:0, t:0 };
    this.stance = options.stance || 'defensive'; // 'defensive' | 'aggressive'
    this.initSoldiers();
    this.baseTotalHP = (this.baseCount||0) * 100;
  }
  initSoldiers(){
    const namePoolA = ['Aulus','Gaius','Lucius','Marcus','Quintus','Titus','Publius','Sextus','Decimus','Gnaeus'];
    const namePoolB = ['Cassius','Brutus','Nero','Felix','Vibius','Varro','Severus','Cato','Drusus','Maximus'];
    const equips = ['spear','sword','axe','pike','gladius','falx'];
    const armours = ['linen','leather','chainmail','plate'];
    const shields = ['small','medium','large'];
    for (let i=0;i<this.baseCount;i++){
      const name = `${namePoolA[i % namePoolA.length]} ${namePoolB[Math.floor(Math.random()*namePoolB.length)]}`;
      const equipment = equips[Math.floor(Math.random()*equips.length)];
      const armourType = armours[Math.floor(Math.random()*armours.length)] || 'linen';
      let shieldType = shields[Math.floor(Math.random()*shields.length)] || 'medium';
      this.soldiers.push({
        pos:{ x:this.center.x + (Math.random()-0.5)*10, y:this.center.y + (Math.random()-0.5)*10 },
        vel:{x:0,y:0}, slotIndex:i, engagedWith:-1,
        name, equipment, armourType, shieldType,
        hp:100, energy:100, morale:100,
        alive:true, wounded:false, wounds:[], woundsTaken:0, kills:0, woundsInflicted:0, nearbyAlliesKilled:0, powerMul:1, speedMul:1,
        action:'holding position',
        wobble:Math.random()*Math.PI*2,
        fleeing:false, fled:false, recovering:false, oldSlotIndex:null, maxMorale:100
      });
    }
    this.rebuildSlots();
    this.recomputeBBFromAliveSlots();
  }
  aliveCount(){ return this.soldiers.reduce((a,s)=>a+((s.alive && !s.fleeing && !s.recovering && !s.rejoining)?1:0),0); }
  forwardVec(){ return { x: Math.cos(this.heading), y: Math.sin(this.heading) }; }
  rightVec(){ return { x: -Math.sin(this.heading), y: Math.cos(this.heading) }; }
  slotRC(index){ const r = Math.floor(index / this.cols); const c = index % this.cols; return { r, c }; }
  slotIndexFromRC(r,c){ if (r<0||r>=this.rows||c<0||c>=this.cols) return -1; return r*this.cols+c; }
  slotWorldPosition(slotIndex){ const slot = this.slots[slotIndex % this.slots.length]; const right=this.rightVec(); const forward=this.forwardVec(); return { x: this.center.x + right.x*slot.x + forward.x*slot.y, y: this.center.y + right.y*slot.x + forward.y*slot.y }; }
  rebuildSlots(){
    this.rows = clamp(this.rows, this.minRows, this.maxRows);
    this.cols = clamp(this.cols, this.minCols, this.maxCols);
    if (this.rows * this.cols < this.baseCount) this.cols = clamp(Math.ceil(this.baseCount / this.rows), this.minCols, this.maxCols);
    this.slots = generateSlots(this.rows, this.cols, SLOT_SPACING);
    this.radius = Math.max(this.rows, this.cols) * SLOT_SPACING * 0.75;
    this.remapSoldiersToClosestSlots();
    // Formation geometry changed; refresh cached bounding box once
    this.recomputeBBFromAliveSlots();
  }
  formationAlive(){ return this.soldiers.some(s=>s.alive && !s.fleeing && !s.recovering); }
  adjustDepth(delta){ this.rows = clamp(this.rows + delta, this.minRows, this.maxRows); this.cols = clamp(Math.ceil(this.baseCount / this.rows), this.minCols, this.maxCols); this.rebuildSlots(); }
  setSize(count){ const newCount=clamp(Math.floor(count),1,200); this.baseCount=newCount; if (this.soldiers.length < newCount){
      const namePoolA = ['Aulus','Gaius','Lucius','Marcus','Quintus','Titus','Publius','Sextus','Decimus','Gnaeus'];
      const namePoolB = ['Cassius','Brutus','Nero','Felix','Vibius','Varro','Severus','Cato','Drusus','Maximus'];
      const equips = ['spear','sword','axe','pike','gladius','falx'];
      const armours = ['linen','leather','chainmail','plate'];
      const shields = ['small','medium','large'];
      for (let i=this.soldiers.length;i<newCount;i++){
        const name = `${namePoolA[i % namePoolA.length]} ${namePoolB[Math.floor(Math.random()*namePoolB.length)]}`;
        const equipment = equips[Math.floor(Math.random()*equips.length)];
        const armourType = armours[Math.floor(Math.random()*armours.length)] || 'linen';
        let shieldType = shields[Math.floor(Math.random()*shields.length)] || 'medium';
        this.soldiers.push({ pos:{ x:this.center.x + (Math.random()-0.5)*10, y:this.center.y + (Math.random()-0.5)*10 }, vel:{x:0,y:0}, slotIndex:i, engagedWith:-1, name, equipment, armourType, shieldType, hp:100, energy:100, morale:100, alive:true, wounded:false, wounds:[], woundsTaken:0, kills:0, woundsInflicted:0, nearbyAlliesKilled:0, powerMul:1, speedMul:1, action:'holding position', wobble:Math.random()*Math.PI*2, fleeing:false, fled:false, recovering:false, oldSlotIndex:null, maxMorale:100 });
      }
    } else if (this.soldiers.length>newCount){ this.soldiers.length=newCount; }
    this.rebuildSlots(); this.recomputeBBFromAliveSlots(); }
  preferredSlotOrder(countLimit){ const order=[]; const halfCols=(this.cols-1)/2; for (let r=this.rows-1;r>=0;r--){ const cols=Array.from({length:this.cols},(_,c)=>c).sort((a,b)=>Math.abs(a-halfCols)-Math.abs(b-halfCols)); for (const c of cols){ order.push(this.slotIndexFromRC(r,c)); if (countLimit && order.length>=countLimit) return order; } } return order; }
  remapSoldiersToClosestSlots(){
    const active=this.soldiers.filter(s=>s.alive && !s.fleeing && !s.recovering);
    const n=active.length; const order=this.preferredSlotOrder(n);
    const available=new Set(order);
    const cache=new Map(); const getPos=(idx)=>{ if(!cache.has(idx)) cache.set(idx, this.slotWorldPosition(idx)); return cache.get(idx); };
    for (let i=0;i<active.length;i++){
      const s=active[i]; let best=-1, bestD=1e12;
      for (const idx of available){ const p=getPos(idx); const dx=p.x-s.pos.x, dy=p.y-s.pos.y; const d2=dx*dx+dy*dy; if (d2<bestD){ bestD=d2; best=idx; } }
      if (best>=0){ s.slotIndex=best; available.delete(best); } else { s.slotIndex=order[i%order.length]; }
    }
    // Fleeing soldiers shouldn't occupy formation slots
    for (const s of this.soldiers){ if (s.fleeing) s.slotIndex = -1; }
  }
  reformFrontRanks(){
    const alive = this.soldiers.filter(s=>s.alive && !s.fleeing && !s.recovering);
    const targetSlots = this.preferredSlotOrder(alive.length);
    // Assign each alive soldier to the nearest of the first N slots
    const available = new Set(targetSlots);
    const cache = new Map();
    const getPos=(idx)=>{ if(!cache.has(idx)) cache.set(idx,this.slotWorldPosition(idx)); return cache.get(idx); };
    for (const s of alive){
      let best=-1, bestD=1e12;
      for (const idx of available){ const p=getPos(idx); const dx=p.x-s.pos.x, dy=p.y-s.pos.y; const d2=dx*dx+dy*dy; if (d2<bestD){ bestD=d2; best=idx; } }
      if (best>=0){ s.slotIndex=best; available.delete(best); }
    }
  }
  onSoldierDeathByIndex(soldierIndex){ const soldier=this.soldiers[soldierIndex]; if (!soldier) return; const rc=this.slotRC(soldier.slotIndex); const r=rc.r, c=rc.c; let frontIncreasing=true; if (this.enemyRef){ const ex=this.enemyRef.center.x - this.center.x; const ey=this.enemyRef.center.y - this.center.y; const fwd=this.forwardVec(); const dot = ex*fwd.x + ey*fwd.y; frontIncreasing = dot > 0; } if (frontIncreasing){ for (let rr=r-1; rr>=0; rr--){ const from=this.slotIndexFromRC(rr,c); const to=this.slotIndexFromRC(rr+1,c); if (from<0||to<0) continue; const mover=this.soldiers.find(s=>s.alive&&s.slotIndex===from); if (mover) mover.slotIndex=to; } } else { for (let rr=r+1; rr<this.rows; rr++){ const from=this.slotIndexFromRC(rr,c); const to=this.slotIndexFromRC(rr-1,c); if (from<0||to<0) continue; const mover=this.soldiers.find(s=>s.alive&&s.slotIndex===from); if (mover) mover.slotIndex=to; } } this.recomputeBBFromAliveSlots(); }
  _moraleShock(origin, deltaNear, deltaAll){
    // Apply morale change to all alive, stronger for nearby
    const radius = 90;
    for (const s of this.soldiers){ if (!s.alive || s.fleeing) continue; const d=Math.hypot(s.pos.x-origin.x, s.pos.y-origin.y); const dd = (d<=radius) ? deltaNear : deltaAll; if (dd){ s.morale = clamp((s.morale||0) + dd, 0, (s.maxMorale||100)); } }
    this.morale = clamp((this.morale||0) + (deltaAll||0)*0.2 + (deltaNear||0)*0.3, 0, 100);
  }

  recomputeBBFromAliveSlots(){
    // Compute extents in slot/local space from alive slot indices (stable until next casualty)
    if (!this.slots || this.slots.length===0){ this.bbHalfExtents = null; return; }
    let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity; let any=false;
    for (const s of this.soldiers){
      if (!s.alive || s.fleeing || s.recovering || s.slotIndex==null || s.slotIndex<0) continue; any=true;
      const slot = this.slots[s.slotIndex % this.slots.length]; if (!slot) continue;
      if (slot.x < minX) minX = slot.x; if (slot.x > maxX) maxX = slot.x;
      if (slot.y < minY) minY = slot.y; if (slot.y > maxY) maxY = slot.y;
    }
    if (!any){ this.bbHalfExtents = { x: SLOT_SPACING*0.6, y: SLOT_SPACING*0.6 }; return; }
    const pad = SLOT_SPACING * 0.5;
    this.bbHalfExtents = { x: (maxX-minX)*0.5 + pad, y: (maxY-minY)*0.5 + pad };
  }
  isStationary(){ return length2(this.velocity) < 6; }
  applyInput(dt){ const order=ORDER_DATA[this.order];
    const wDown = input.isDown('KeyW'); const sDown = input.isDown('KeyS');
    let thrust=(wDown?1:0) + (sDown?-0.6:0);
    const turn=(input.isDown('KeyD')?1:0) + (input.isDown('KeyA')?-1:0);
    // Charge only forward (handled in key handlers); no reverse flip
    const soldierMax=SOLDIER_SPEED * DEBUG.charSpeed * (this.order==='charge'?DEBUG.chargeMult:1);
    const baseFormSpeed = soldierMax * 0.9 * DEBUG.formSpeed; // formation follows soldier speed
    let targetSpeed = thrust * baseFormSpeed;
    const forward=this.forwardVec();
    // Width-aware rotation scaling
    const he = formationHalfExtents(this); const turnScale = 1 / (1 + he.x / 80);
    this.heading = mixAngle(this.heading, this.heading + turn * order.turnRate * DEBUG.formTurn * turnScale, dt); // smooth turning, slower when wider
    const desired = { x: forward.x * targetSpeed, y: forward.y * targetSpeed };
    this.velocity.x = mix(this.velocity.x, desired.x, clamp(order.accel * dt, 0, 1));
    this.velocity.y = mix(this.velocity.y, desired.y, clamp(order.accel * dt, 0, 1)); }
  update(dt){ if (this.controlled && !this.stationary) this.applyInput(dt); if (this.controlled && this.isStationary()){ this.velocity.x=mix(this.velocity.x,0,dt*3); this.velocity.y=mix(this.velocity.y,0,dt*3); }
    // Auto-face enemy for AI units to ensure correct front/back when engaged
    if (!this.controlled && this.enemyRef) {
      const toEnemy = Math.atan2(this.enemyRef.center.y - this.center.y, this.enemyRef.center.x - this.center.x);
      this.heading = mixAngle(this.heading, toEnemy, dt * 3.0);
    }
    // Formation depth controls when stationary: ArrowUp/Down or E/Q
    if (this.controlled && this.isStationary()) {
      if (input.consume('ArrowUp') || input.consume('KeyE')) this.adjustDepth(1);
      else if (input.consume('ArrowDown') || input.consume('KeyQ')) this.adjustDepth(-1);
    }
    if (this.controlled){ const order=ORDER_DATA[this.order]; if (this.order==='charge'){ this.energy=Math.max(0,this.energy - order.staminaUse*dt); if (this.energy<=0) this.setOrder('march'); } else { this.energy=clamp(this.energy + order.staminaRegen*dt, 0, 100); } }
    if (!this.stationary){ this.center.x += this.velocity.x*dt; this.center.y += this.velocity.y*dt; }
    if (this.retreat.t>0){ this.center.x += this.retreat.vx*dt; this.center.y += this.retreat.vy*dt; this.retreat.t -= dt; if (this.retreat.t<=0){ this.retreat.vx=0; this.retreat.vy=0; this.retreat.t=0; } }
    this.center.x = clamp(this.center.x, this.radius, canvas.width - this.radius);
    this.center.y = clamp(this.center.y, this.radius, canvas.height - this.radius);
    // Frequent front-rank compression for all formations
    if (!this._compressTimer) this._compressTimer = 0;
    this._compressTimer += dt;
    if (this._compressTimer > 0.4){ this.reformFrontRanks(); this._compressTimer = 0; }
    // Mark broken if everyone is fleeing/recovering or dead
    this._broken = !this.formationAlive();
    if (this._broken && !this.disbanded){
      // Disband the unit: force everyone to flee and prevent rejoin
      this.disbanded = true;
      for (const s of this.soldiers){
        if (!s.alive) continue;
        s.fleeing = true; s.recovering=false; s.rejoining=false; s.held=false; s.fled = true; s.engagedWith=-1;
        s.meleePhase=undefined; s.meleeT=0; s.engageCooldown = Math.max(s.engageCooldown||0, 2.0);
        s.maxMorale = Math.min(s.maxMorale||100, 35); s.morale = 0;
        if (s.slotIndex!=null && s.slotIndex>=0){ s.oldSlotIndex = s.slotIndex; s.slotIndex = -1; }
      }
      this.recomputeBBFromAliveSlots();
      logDebug(`${this.name} has broken and is disbanding`);
    }
    this.soldiers.forEach(s=>this.updateSoldier(s, dt)); }
  setOrder(order){ if (!ORDER_DATA[order]) return; if (order==='charge' && this.energy < 25) return; this.order=order; }
  updateSoldier(soldier, dt){
    if (!soldier.alive){ soldier.vel.x*=0.9; soldier.vel.y*=0.9; soldier.pos.x += soldier.vel.x*dt; soldier.pos.y += soldier.vel.y*dt; return; }
    // Handle fleeing behavior
    if (soldier.fleeing){
      soldier.action = 'fleeing';
      // Run away from enemy center
      if (!soldier.held){
        let ex=0, ey=0; if (this.enemyRef){ ex=this.enemyRef.center.x; ey=this.enemyRef.center.y; } else { ex=this.center.x; ey=this.center.y; }
        const dx = soldier.pos.x - ex, dy = soldier.pos.y - ey; const len=Math.hypot(dx,dy)||1; const ux=dx/len, uy=dy/len;
        const spd = SOLDIER_SPEED * 1.2;
        soldier.vel.x = mix(soldier.vel.x, ux*spd, dt*2.0);
        soldier.vel.y = mix(soldier.vel.y, uy*spd, dt*2.0);
        soldier.pos.x += soldier.vel.x*dt; soldier.pos.y += soldier.vel.y*dt;
      } else { soldier.vel.x = 0; soldier.vel.y = 0; }
      // Morale recovery while fleeing
      const mm = soldier.maxMorale || 100;
      soldier.morale = clamp((soldier.morale||0) + 6*dt, 0, mm);
      if (soldier.held){ return; }
      // If max morale is crippled, keep fleeing forever
      if ((soldier.maxMorale||100) < 40){ return; }
      // Stop fleeing at 20 morale, but do not rejoin yet
      if (soldier.morale >= 20){ soldier.fleeing=false; soldier.recovering=true; soldier.vel.x=0; soldier.vel.y=0; soldier.action='catching breath'; }
      return;
    }
    if (soldier.recovering){
      // Stationary recovery, no rejoin until morale >= 40
      const mm = soldier.maxMorale || 100; soldier.morale = clamp((soldier.morale||0) + 4*dt, 0, mm);
      // If max morale fell below threshold, resume fleeing fully
      if (mm < 40){ soldier.recovering=false; soldier.fleeing=true; soldier.action='fleeing'; return; }
      if (soldier.morale >= 40 && this.formationAlive()){
        const used = new Set(this.soldiers.filter(s=>s.alive && !s.fleeing && !s.recovering && s.slotIndex>=0).map(s=>s.slotIndex));
        let chosen = -1; for (let idx=this.rows*this.cols-1; idx>=0; idx--){ if (!used.has(idx)){ chosen = idx; break; } }
        if (chosen>=0){ soldier.slotIndex = chosen; soldier.recovering=false; soldier.rejoining=true; soldier.engagedWith=-1; soldier.engageCooldown=Math.max(soldier.engageCooldown||0, 2.0); soldier.morale=Math.max(soldier.morale||0, 40); soldier.action='returning to unit'; }
      }
      return;
    }
    const slotTarget=this.slotWorldPosition(soldier.slotIndex>=0 ? soldier.slotIndex : 0);
    const wobble = Math.sin(soldier.wobble + performance.now()*0.0015)*2;
    if (soldier.engageCooldown==null) soldier.engageCooldown=0;
    else if (soldier.engageCooldown>0) soldier.engageCooldown=Math.max(0, soldier.engageCooldown - dt);
    let target={ x:slotTarget.x, y:slotTarget.y + wobble };
    // Aggressive stance: allow pursuit near contact
    const enemyForm = this.enemyRef;
    if (this.stance==='aggressive' && !soldier.rejoining && soldier.engagedWith<0 && !soldier.fleeing){
      // Track a nearby target to pursue
      if (soldier.pursueIdx==null || soldier.pursueIdx<0){
        let best=-1, bestD=1e9; const seek=MELEE_RANGE*2.2 + weaponReach(soldier);
        if (enemyForm){ for (let j=0;j<enemyForm.soldiers.length;j++){ const e=enemyForm.soldiers[j]; if(!e.alive||e.fleeing) continue; const d=Math.hypot(e.pos.x-soldier.pos.x, e.pos.y-soldier.pos.y); if (d<bestD && d<seek){ bestD=d; best=j; } } }
        if (best>=0) soldier.pursueIdx=best; else soldier.pursueIdx=-1;
      }
      if (soldier.pursueIdx>=0 && enemyForm){ const e=enemyForm.soldiers[soldier.pursueIdx]; if (!e || !e.alive || e.fleeing){ soldier.pursueIdx=-1; } else { target={ x:e.pos.x, y:e.pos.y }; } }
    } else {
      soldier.pursueIdx = -1;
    }
    // Per-soldier morale passive recovery when not engaged
    if (soldier.engagedWith<0 && !soldier.rejoining){ const mm = soldier.maxMorale||100; soldier.morale = clamp((soldier.morale||0) + 4*dt, 0, mm); }
    if (soldier.engagedWith>=0){ const foe=this.enemyRef?.soldiers[soldier.engagedWith]; if (foe && foe.alive){
        // Determine weapon style: thrust vs swing
        const w = RULES.weapons[soldier.equipment] || {};
        const thrust = (soldier.equipment==='spear' || soldier.equipment==='pike' || ((w.damage||{}).pierce||0) > ((w.damage||{}).slash||0));
        // Attack behavior: approach -> attack -> back
        if (!soldier.meleePhase) { soldier.meleePhase='approach'; soldier.meleeT=0; soldier.meleeDur=0.4+Math.random()*0.2; }
        soldier.meleeT += dt;
        const vx = foe.pos.x - soldier.pos.x, vy = foe.pos.y - soldier.pos.y; const len = Math.hypot(vx,vy)||1; const ux=vx/len, uy=vy/len;
        const standoff = MELEE_RANGE * 0.95;
        const standoffPoint = { x: foe.pos.x - ux * standoff, y: foe.pos.y - uy * standoff };
        const limit = 18; // body doesn't over-commit
        if (soldier.meleePhase==='approach'){
          // Close to standoff quickly
          const toward = Math.min(limit, Math.hypot(foe.pos.x-standoffPoint.x, foe.pos.y-standoffPoint.y));
          target = { x: standoffPoint.x + ux * Math.min(limit*0.2, toward), y: standoffPoint.y + uy * Math.min(limit*0.2, toward) };
          if (soldier.meleeT > soldier.meleeDur || Math.hypot(target.x - soldier.pos.x, target.y - soldier.pos.y) < 4){ soldier.meleePhase='attack'; soldier.meleeT=0; soldier.meleeDur = thrust ? (0.22+Math.random()*0.12) : (0.5+Math.random()*0.25); }
        } else if (soldier.meleePhase==='attack'){
          // Hold near standoff while weapon visual animates
          target = { x: standoffPoint.x, y: standoffPoint.y };
          if (soldier.meleeT > soldier.meleeDur){ soldier.meleePhase='back'; soldier.meleeT=0; soldier.meleeDur=0.35+Math.random()*0.2; }
        } else { // back: step to slot, then repeat
          target = { x: slotTarget.x, y: slotTarget.y };
          const backDist = Math.hypot(slotTarget.x - soldier.pos.x, slotTarget.y - soldier.pos.y);
          if (backDist <= 3){ soldier.meleePhase='approach'; soldier.meleeT=0; soldier.meleeDur=0.4+Math.random()*0.2; }
        }
        const dxs = target.x - standoffPoint.x; const dys = target.y - standoffPoint.y; const ds = Math.hypot(dxs,dys);
        if (ds > limit){ target.x = standoffPoint.x + (dxs/ds)*limit; target.y = standoffPoint.y + (dys/ds)*limit; }
        // Expose attack progress (0..1) for rendering
        const prog = (soldier.meleePhase==='attack') ? Math.min(1, soldier.meleeT / Math.max(0.001, soldier.meleeDur)) : 0;
        soldier.jabProgress = thrust ? prog : 0;
        soldier.swingProgress = thrust ? 0 : prog;
        // If formation moved far away, disengage hard and rejoin unit
        const rejoinThreshold = Math.max(100, this.radius * 0.8);
        const slotGap = Math.hypot(slotTarget.x - soldier.pos.x, slotTarget.y - soldier.pos.y);
        if (slotGap > rejoinThreshold){ soldier.engagedWith=-1; soldier.rejoining=true; soldier.engageCooldown=Math.max(soldier.engageCooldown||0, 1.0); soldier.meleePhase=undefined; soldier.meleeT=0; soldier.jabProgress=0; soldier.swingProgress=0; }
      } else { soldier.engagedWith=-1; soldier.meleePhase=undefined; soldier.meleeT=0; soldier.jabProgress=0; soldier.swingProgress=0; }
    }
    // If morale collapsed, flee
    if ((soldier.morale||0) <= 0 && !soldier.fleeing){
      soldier.fleeing = true; soldier.fled = true; soldier.recovering=false; soldier.rejoining=false; soldier.engagedWith=-1; soldier.meleePhase=undefined; soldier.meleeT=0; soldier.engageCooldown=Math.max(soldier.engageCooldown||0, 2.0); const drop = 15 + Math.random()*10; soldier.maxMorale = Math.max(20, (soldier.maxMorale||100) - drop); soldier.morale = 0;
      // ripple formation like casualty
      soldier.oldSlotIndex = soldier.slotIndex;
      soldier.slotIndex = -1;
      if (soldier.oldSlotIndex!=null && soldier.oldSlotIndex>=0) this.onSoldierDeathByIndex(soldier.oldSlotIndex);
      this.recomputeBBFromAliveSlots();
      // Morale shock to nearby allies
      this._moraleShock(soldier.pos, -6, -2);
    }
    // While rejoining, ignore engagement and return to slot
    if (soldier.rejoining){ target={ x: slotTarget.x, y: slotTarget.y }; if (Math.hypot(target.x - soldier.pos.x, target.y - soldier.pos.y) <= 5){ soldier.rejoining=false; } }
    const dx=target.x - soldier.pos.x, dy=target.y - soldier.pos.y; const dist=Math.hypot(dx,dy);
    let maxSpeed = SOLDIER_SPEED * DEBUG.charSpeed * (this.order==='charge'?DEBUG.chargeMult:1);
    if (soldier.speedMul != null) maxSpeed *= soldier.speedMul; // leg wounds slow
    if (soldier.engagedWith>=0) maxSpeed *= 0.6; // slower while engaged
    if (soldier.rejoining) maxSpeed *= 1.1; // slight urgency returning to slot
    if (soldier.pursueIdx!=null && soldier.pursueIdx>=0) maxSpeed *= 1.05; // small push when pursuing
    if (dist>1){ const desired={ x:(dx/dist)*maxSpeed, y:(dy/dist)*maxSpeed }; soldier.vel.x = mix(soldier.vel.x, desired.x, dt*1.8); soldier.vel.y = mix(soldier.vel.y, desired.y, dt*1.8); }
    else { soldier.vel.x = mix(soldier.vel.x, 0, dt*2.8); soldier.vel.y = mix(soldier.vel.y, 0, dt*2.8); }
    if (dist < 3){ soldier.pos.x = target.x; soldier.pos.y = target.y; soldier.vel.x=0; soldier.vel.y=0; }
    else { soldier.pos.x += soldier.vel.x*dt; soldier.pos.y += soldier.vel.y*dt; }
  }
}

function generateSlots(rows, cols, spacing){ const grid=[]; const halfCols=(cols-1)/2; const halfRows=(rows-1)/2; for (let r=0;r<rows;r++){ for (let c=0;c<cols;c++){ grid.push({ x:(c-halfCols)*spacing, y:(r-halfRows)*spacing }); } } return grid; }

function createPlayer(){ const p=new Formation({ name:'Player Cohort', x:canvas.width*0.35, y:canvas.height*0.55, rows:4, cols:5, controlled:true, color:'#7ec8f8', accent:'#3eb5ff', count:20 }); p.stationary=false; return p; }
function createEnemy(){ const e=new Formation({ name:'Enemy Phalanx', x:canvas.width*0.65, y:canvas.height*0.5, rows:5, cols:5, controlled:false, color:'#f4c47f', accent:'#e79b3c', count:25, stationary:true }); e.setOrder('shielding'); return e; }

world.player=createPlayer();
world.enemy=createEnemy();
world.player.enemyRef=world.enemy; world.enemy.enemyRef=world.player; world.target=world.enemy;

window.addEventListener('keydown', (event)=>{
  if (BLOCKED_KEYS.has(event.code)) event.preventDefault();
  if (event.repeat) return;
  input.keys.add(event.code); input.pressed.add(event.code);
  if (event.code==='KeyF'){
    world.player.stance = (world.player.stance==='aggressive') ? 'defensive' : 'aggressive';
    logDebug(`Player stance: ${world.player.stance}`);
  }
  if (event.code==='ShiftLeft' || event.code==='ShiftRight'){
    // Charge only allowed when moving forward (W held)
    if (input.keys.has('KeyW') && world.player.order!=='charge'){
      world.player._prevOrder=world.player.order;
      world.player.setOrder('charge');
    }
  }
  if (event.code==='KeyW'){
    // If shift already down, start charge now
    if (input.keys.has('ShiftLeft') || input.keys.has('ShiftRight')){
      if (world.player.order!=='charge'){
        world.player._prevOrder=world.player.order;
        world.player.setOrder('charge');
      }
    }
  }
  if (ORDER_KEYS[event.code]) world.player.setOrder(ORDER_KEYS[event.code]);
  if (event.code==='Space') world.target=world.enemy;
});
window.addEventListener('keyup', (event)=>{
  if (BLOCKED_KEYS.has(event.code)) event.preventDefault();
  input.keys.delete(event.code);
  if (event.code==='ShiftLeft' || event.code==='ShiftRight'){
    if (world.player.order==='charge'){
      const back=world.player._prevOrder||'march';
      world.player.setOrder(back);
      world.player._prevOrder=undefined;
    }
  }
  if (event.code==='KeyW'){
    // Releasing W cancels charge if active
    if (world.player.order==='charge'){
      const back=world.player._prevOrder||'march';
      world.player.setOrder(back);
      world.player._prevOrder=undefined;
    }
  }
});

canvas.addEventListener('mousemove', (event)=>{ const rect=canvas.getBoundingClientRect(); input.mouse.x=(event.clientX-rect.left)*(canvas.width/rect.width); input.mouse.y=(event.clientY-rect.top)*(canvas.height/rect.height); });
canvas.addEventListener('click', ()=>{
  // Try select a soldier first
  const click = { x: input.mouse.x, y: input.mouse.y };
  let bestD = 12, sel = null;
  const tryPick = (form)=>{
    for (let i=0;i<form.soldiers.length;i++){
      const s=form.soldiers[i]; if (!s.alive) continue; const d=Math.hypot(s.pos.x-click.x, s.pos.y-click.y); if (d<bestD){ bestD=d; sel={form, index:i}; }
    }
  };
  tryPick(world.player); tryPick(world.enemy);
  if (sel){ world.selected = sel; updateInfoPanel(); return; }
  world.selected = null; updateInfoPanel();
  // Fallback: select enemy unit as target by clicking near it
  const dx=world.enemy.center.x - click.x; const dy=world.enemy.center.y - click.y; if (Math.hypot(dx,dy) < world.enemy.radius*1.1) world.target=world.enemy;
});

let last=performance.now();
function loop(ts){ const dt=Math.min(0.033,(ts-last)/1000); last=ts; updateWorld(dt); drawWorld(); input.flush(); requestAnimationFrame(loop);} requestAnimationFrame(loop);

function updateWorld(dt){ world.player.update(dt); world.enemy.update(dt); const contact=resolvePush(world.player, world.enemy, dt); updateContactRound(contact, dt); clampUnit(world.player); clampUnit(world.enemy); applyWardZone(world.player, world.enemy, dt); applyWardZone(world.enemy, world.player, dt); handleMelee(world.player, world.enemy, dt); updateHUD(); updateDebugControls(); }

function updateInfoPanel(){ const box=document.getElementById('info'); if (!box){ return; } const sel=world.selected; if (!sel){ box.textContent='Click a character to inspect'; return; } const form = sel.form; const s = form.soldiers[sel.index]; if (!s){ box.textContent=''; return; }
  // derive current action
  if (s.engagedWith>=0) s.action='engaged in combat'; else if ((form.morale||100) < 55) s.action='troubled by losses'; else if ((form.morale||100) > 90) s.action='encouraged by success'; else s.action='holding position';
  const sh = (RULES.shields||{})[s.shieldType||'none'] || { hp:0, block:0 };
  const shLine = s.shieldType && s.shieldType!=='none' ? `Shield: ${s.shieldType} (${Math.round(s.shieldHP||0)}/${Math.round(s.shieldMax||sh.hp||0)} hp, block ${(Math.round((sh.block||0)*100))}%)` : 'Shield: none';
  const basic = `Name: ${s.name}\nUnit: ${form.name}\nHealth: ${Math.round(s.hp||0)}\nEnergy: ${Math.round(s.energy||0)}\nMorale: ${Math.round(s.morale||0)}\nWounded: ${s.wounded ? 'Yes' : 'No'}\nEquipment: ${s.equipment}\n${shLine}\nAction: ${s.action}`;
  const more = world.infoExpanded ? `\n\nKills: ${s.kills||0}\nWounds Inflicted: ${s.woundsInflicted||0}\nWounds Taken: ${s.woundsTaken||0}\nNearby Allies Killed: ${s.nearbyAlliesKilled||0}\nFled: ${s.fled ? 'Yes' : 'No'}\nWounds: ${(s.wounds&&s.wounds.length? s.wounds.join(', '): 'None')}` : '';
  const btnText = world.infoExpanded ? 'Less Info' : 'More Info';
  box.innerHTML = `<pre style="margin:0; white-space:pre-wrap">${basic}${more}</pre><div style="margin-top:6px"><button id="moreInfoBtn">${btnText}</button></div>`;
  const btn = document.getElementById('moreInfoBtn');
  if (btn){
    btn.addEventListener('click', (ev)=>{ ev.stopPropagation(); world.infoExpanded = !world.infoExpanded; updateInfoPanel(); }, { once: true });
  }
}

function applyWardZone(ward, opp, dt){ if (ward.order!=='ward') return; const zone=Math.min(ward.radius+40,200); opp.soldiers.forEach(s=>{ if(!s.alive) return; const dx=s.pos.x-ward.center.x; const dy=s.pos.y-ward.center.y; const dist=Math.hypot(dx,dy)||1; if (dist<zone){ const push=(zone-dist)/zone; s.vel.x*=0.5; s.vel.y*=0.5; s.pos.x += (dx/dist)*push*35*dt; s.pos.y += (dy/dist)*push*35*dt; } }); }

function resolvePush(a,b,dt){ if (a.disbanded || b.disbanded) return { overlap:false };
  const res=obbOverlap(a,b); if (!res.overlap) return res; const move=res.depth;
  // Allow flow-around when defender is sparse and attacker is wider
  const aliveA = a.soldiers.filter(s=>s.alive && !s.fleeing && !s.recovering).length; const aliveB = b.soldiers.filter(s=>s.alive && !s.fleeing && !s.recovering).length;
  const fracB = Math.max(0, Math.min(1, aliveB / Math.max(1, b.baseCount||b.soldiers.length)));
  const heA = formationHalfExtents(a); const heB = formationHalfExtents(b);
  const attackerMuchWider = heA.x > heB.x * 1.2;
  if (fracB < 0.4 && attackerMuchWider){
    // Slide along tangent and reduce backward push to create gaps
    const tx = -res.normal.y, ty = res.normal.x;
    const slide = Math.min(20, 60*dt);
    a.center.x += tx * slide; a.center.y += ty * slide;
    a.center.x -= res.normal.x * (move * 0.2); a.center.y -= res.normal.y * (move * 0.2);
    return res;
  }
  a.center.x -= res.normal.x*move; a.center.y -= res.normal.y*move; return res; }
function clampUnit(u){ u.center.x=clamp(u.center.x,u.radius, canvas.width-u.radius); u.center.y=clamp(u.center.y,u.radius, canvas.height-u.radius); }

function updateContactRound(contact, dt){ if (!contact||!contact.overlap){ if (contactRound.active){ contactRound.active=false; contactRound.time=0; contactRound.pushDone=false; contactRound.stats=undefined; } return; }
  if (!contactRound.active){ contactRound.active=true; contactRound.time=0; contactRound.pushDone=false; contactRound.stats={ playerKills:0, enemyKills:0, playerWounds:0, enemyWounds:0 }; }
  else { contactRound.time += dt; const threshold=15/Math.max(0.1,DEBUG.combatSpeed); if (contactRound.time>=threshold){ if (!contactRound.pushDone){ const s=contactRound.stats; const pScore=s.playerKills*2 + s.playerWounds; const eScore=s.enemyKills*2 + s.enemyWounds; if (pScore>eScore){ applyRoundPush(world.player,world.enemy); logDebug(`Round push: Player wins (K:${s.playerKills} W:${s.playerWounds}) vs Enemy (K:${s.enemyKills} W:${s.enemyWounds})`);} else if (eScore>pScore){ applyRoundPush(world.enemy,world.player); logDebug(`Round push: Enemy wins (K:${s.enemyKills} W:${s.enemyWounds}) vs Player (K:${s.playerKills} W:${s.playerWounds})`);} else { logDebug(`Round push: Draw (P K:${s.playerKills} W:${s.playerWounds} | E K:${s.enemyKills} W:${s.enemyWounds})`);} contactRound.pushDone=true; } contactRound.time=0; contactRound.pushDone=false; contactRound.stats={ playerKills:0, enemyKills:0, playerWounds:0, enemyWounds:0 }; } }
}
function applyRoundPush(attacker, defender){ const fwd=attacker.forwardVec(); const speed=30; defender.retreat.vx=fwd.x*speed; defender.retreat.vy=fwd.y*speed; defender.retreat.t=0.6; }

function handleMelee(a,b,dt){ if (a.disbanded || b.disbanded) return; const aAlive=a.soldiers; const bAlive=b.soldiers; const baseSeek=MELEE_RANGE*1.4;
  // opportunistic seeking
  const weapReach = (s)=>{ const w = RULES.weapons[s.equipment]; return (w && w.reach) ? w.reach : 0; };
  // capture/engagement logic follows
  const acquireTarget = (self, enemies, stance)=>{
    let best=1e9, idx=-1; const seek=baseSeek + weapReach(self) + (stance==='aggressive'?20:0);
    for (let j=0;j<enemies.length;j++){ const f=enemies[j]; if(!f.alive || f.fleeing || f.recovering) continue; const d=Math.hypot(f.pos.x-self.pos.x, f.pos.y-self.pos.y); if (d<best && d<seek){ best=d; idx=j; } }
    if (idx>=0) return idx;
    best=1e9; idx=-1;
    for (let j=0;j<enemies.length;j++){ const f=enemies[j]; if(!f.alive || !f.fleeing) continue; const d=Math.hypot(f.pos.x-self.pos.x, f.pos.y-self.pos.y); if (d<best && d<seek){ best=d; idx=j; } }
    return idx;
  };
  aAlive.forEach((s)=>{ if(!s.alive||s.engagedWith>=0||s.rejoining|| s.recovering || (s.engageCooldown>0)) return; const t=acquireTarget(s,bAlive,a.stance); if (t>=0) s.engagedWith=t; });
  bAlive.forEach((s)=>{ if(!s.alive||s.engagedWith>=0||s.rejoining|| s.recovering || (s.engageCooldown>0)) return; const t=acquireTarget(s,aAlive,b.stance); if (t>=0) s.engagedWith=t; });
  aAlive.forEach(s=>{ if (s.combatTimer==null) s.combatTimer=0; if (s.wounded==null) s.wounded=false; });
  bAlive.forEach(s=>{ if (s.combatTimer==null) s.combatTimer=0; if (s.wounded==null) s.wounded=false; });

  for (let i=0;i<aAlive.length;i++){ const sa=aAlive[i]; if(!sa.alive) continue; const j=sa.engagedWith; if (j<0) continue; const sb=bAlive[j]; if (!sb||!sb.alive){ sa.engagedWith=-1; continue; } if (sb.rejoining){ sa.engagedWith=-1; sa.combatTimer=0; continue; } const dist=Math.hypot(sb.pos.x-sa.pos.x, sb.pos.y-sa.pos.y);
    if (sb.recovering && dist < MELEE_RANGE*1.6){ sb.fleeing=true; sb.recovering=false; sb.fled=true; sb.engagedWith=-1; sb.meleePhase=undefined; sb.meleeT=0; sb.engageCooldown=Math.max(sb.engageCooldown||0,2.0); const drop=15+Math.random()*10; sb.maxMorale=Math.max(20,(sb.maxMorale||100)-drop); sb.morale=0; if (sb.slotIndex!=null && sb.slotIndex>=0){ b.onSoldierDeathByIndex(sb.slotIndex); sb.slotIndex=-1; b.recomputeBBFromAliveSlots(); } sa.engagedWith=-1; sa.combatTimer=0; continue; }
    if (sb.fleeing){ sb.held=true; sb.captureT = (sb.captureT||0) + dt; if (sb.captureDur==null) sb.captureDur = 3 + Math.random()*2; sb.vel.x=0; sb.vel.y=0; if (sb.captureT >= sb.captureDur){ sb.alive=false; sb.hp=0; b.morale=Math.max(0,(b.morale||0)-4); b.onSoldierDeathByIndex(j); sb.slotIndex=-1; sb.captureT=0; sb.captureDur=null; sb.held=false; sa.engagedWith=-1; updateInfoPanel(); } continue; }
    const aRange = MELEE_RANGE + weapReach(sa);
    const bRange = MELEE_RANGE + weapReach(sb);
    if (dist<Math.max(aRange,bRange)){
      // light bounce/repel to animate melee
      const dx = sb.pos.x - sa.pos.x, dy = sb.pos.y - sa.pos.y; const len = Math.hypot(dx,dy) || 1;
      const repel = (MELEE_RANGE - dist) / MELEE_RANGE;
      const fx = (dx/len) * repel * 20; const fy = (dy/len) * repel * 20;
      if (!sa.rejoining){ sa.vel.x -= fx * dt; sa.vel.y -= fy * dt; }
      if (!sb.rejoining){ sb.vel.x += fx * dt; sb.vel.y += fy * dt; }

      const th=15/Math.max(0.1,DEBUG.combatSpeed);
      // Weapon arcs removed: always allow timer to build when in range
      if (!sa.rejoining) sa.combatTimer+=dt; else sa.combatTimer = Math.max(0, sa.combatTimer - dt*0.5);
      if (!sb.rejoining) sb.combatTimer+=dt; else sb.combatTimer = Math.max(0, sb.combatTimer - dt*0.5);
      if (sa.combatTimer>=th){ resolveDuel(a,i,b,j); sa.combatTimer=0; }
    }
    else if (dist>MELEE_RANGE*1.6){ if (sb.engagedWith===i) sb.engagedWith=-1; sa.engagedWith=-1; sa.combatTimer=0; if (sb) sb.combatTimer=0; }
  }
  // symmetric disengage
  for (let j=0;j<bAlive.length;j++){ const sb=bAlive[j]; if(!sb.alive) continue; const i=sb.engagedWith; if (i<0) continue; const sa=aAlive[i]; if(!sa||!sa.alive){ sb.engagedWith=-1; continue; } if (sa.rejoining){ sb.engagedWith=-1; sb.combatTimer=0; continue; } const dist=Math.hypot(sa.pos.x-sb.pos.x, sa.pos.y-sb.pos.y); if (sa.recovering && dist < MELEE_RANGE*1.6){ sa.fleeing=true; sa.recovering=false; sa.fled=true; sa.engagedWith=-1; sa.meleePhase=undefined; sa.meleeT=0; sa.engageCooldown=Math.max(sa.engageCooldown||0,2.0); const drop=15+Math.random()*10; sa.maxMorale=Math.max(20,(sa.maxMorale||100)-drop); sa.morale=0; if (sa.slotIndex!=null && sa.slotIndex>=0){ a.onSoldierDeathByIndex(sa.slotIndex); sa.slotIndex=-1; a.recomputeBBFromAliveSlots(); } sb.engagedWith=-1; sb.combatTimer=0; continue; } if (sa.fleeing){ sa.held=true; sa.captureT = (sa.captureT||0) + dt; if (sa.captureDur==null) sa.captureDur = 3 + Math.random()*2; sa.vel.x=0; sa.vel.y=0; if (sa.captureT >= sa.captureDur){ sa.alive=false; sa.hp=0; a.morale=Math.max(0,(a.morale||0)-4); a.onSoldierDeathByIndex(i); sa.slotIndex=-1; sa.captureT=0; sa.captureDur=null; sa.held=false; sb.engagedWith=-1; updateInfoPanel(); } continue; } if (dist>MELEE_RANGE*1.6){ if (sa.engagedWith===j) sa.engagedWith=-1; sb.engagedWith=-1; sb.combatTimer=0; if (sa) sa.combatTimer=0; } }

  const engagedA=aAlive.filter(s=>s.alive && s.engagedWith>=0).length; const engagedB=bAlive.filter(s=>s.alive && s.engagedWith>=0).length; world.engagedChars=engagedA+engagedB;
}

function resolveDuel(aForm, ai, bForm, bj){ const a=aForm.soldiers[ai]; const b=bForm.soldiers[bj]; if(!a||!b||!a.alive||!b.alive) return; let wBothDead=0.08, wOneDead=0.28, wBothWound=0.22, wOneWound=0.28, wNoChange=0.14; if (aForm.order==='charge'){ wOneDead+=0.08; wBothDead+=0.02; } if (bForm.order==='charge'){ wOneDead-=0.04; wNoChange+=0.02; } if (aForm.order==='shielding'){ wOneDead-=0.05; wNoChange+=0.03; wOneWound+=0.02; } if (bForm.order==='shielding'){ wOneDead-=0.05; wNoChange+=0.03; wOneWound+=0.02; }
  const sum=wBothDead+wOneDead+wBothWound+wOneWound+wNoChange; let r=Math.random()*sum; const take=(w)=>{ const ok=r<w; r-=w; return ok; }; let outcome=5; if (take(wBothDead)) outcome=1; else if (take(wOneDead)) outcome=2; else if (take(wBothWound)) outcome=3; else if (take(wOneWound)) outcome=4; else outcome=5;
  const ensureStats = (s)=>{ if (s.kills==null) s.kills=0; if (s.woundsInflicted==null) s.woundsInflicted=0; if (s.wounds==null) s.wounds=[]; if (s.woundsTaken==null) s.woundsTaken=0; if (s.nearbyAlliesKilled==null) s.nearbyAlliesKilled=0; if (s.powerMul==null) s.powerMul=1; if (s.speedMul==null) s.speedMul=1; };
  const applyWoundEffect = (s, type)=>{
    if (type==='hand' || type==='arm') { s.powerMul = Math.min(s.powerMul, 0.7); }
    else if (type==='leg') { s.speedMul = Math.min(s.speedMul, 0.7); }
    else if (type==='torso') { s.energy = Math.max(0, (s.energy||100) - 15); }
    else if (type==='head') { s.morale = Math.max(0, (s.morale||100) - 20); }
  };
  const woundTypes = ['hand','arm','leg','torso','head'];
  const woundSoldier = (s, inflictedBy)=>{ ensureStats(s); s.wounded=true; s.woundsTaken += 1; s.hp=Math.min(s.hp,40); const type = woundTypes[Math.floor(Math.random()*woundTypes.length)]; s.wounds.push(type); s.lastWoundType=type; s.lastWoundAt=performance.now(); applyWoundEffect(s, type); s.morale = clamp((s.morale||0) - 8, 0, (s.maxMorale||100)); if (s.shieldType && s.shieldType!=='none'){ if (s.shieldHP==null){ const sh=shieldStats(s); s.shieldMax=sh.hp||0; s.shieldHP=s.shieldMax; } s.shieldHP = Math.max(0, (s.shieldHP||0) - (5 + Math.random()*8)); } if (inflictedBy){ ensureStats(inflictedBy); inflictedBy.woundsInflicted += 1; inflictedBy.lastInflictedAt=performance.now(); } updateInfoPanel(); };
  const killSoldier = (s, form, inflictedBy)=>{ ensureStats(s); s.alive=false; s.hp=0; s.vel.x+=(Math.random()-0.5)*40; s.vel.y+=(Math.random()-0.5)*40; form.morale=Math.max(0,form.morale-4); if (s.shieldType && s.shieldType!=='none'){ if (s.shieldHP==null){ const sh=shieldStats(s); s.shieldMax=sh.hp||0; s.shieldHP=s.shieldMax; } s.shieldHP = Math.max(0, (s.shieldHP||0) - (10 + Math.random()*10)); } if (inflictedBy){ ensureStats(inflictedBy); inflictedBy.kills += 1; inflictedBy.lastKillAt=performance.now(); inflictedBy.morale = clamp((inflictedBy.morale||0)+10, 0, (inflictedBy.maxMorale||100)); }
    // Nearby allies register the loss and lose morale
    for (const ally of form.soldiers){ if (!ally.alive) continue; ensureStats(ally); const d=Math.hypot((ally.pos.x - s.pos.x),(ally.pos.y - s.pos.y)); if (d < 80){ ally.nearbyAlliesKilled += 1; ally.lastNearbyLossAt=performance.now(); ally.morale = clamp((ally.morale||0) - 10, 0, (ally.maxMorale||100)); } else { ally.morale = clamp((ally.morale||0) - 2, 0, (ally.maxMorale||100)); } }
    // Opposing unit morale boost for seeing enemy die (nearby)
    const other = (form===world.player? world.enemy : world.player);
    for (const ally of other.soldiers){ if (!ally.alive) continue; const d=Math.hypot((ally.pos.x - s.pos.x),(ally.pos.y - s.pos.y)); if (d < 100){ ally.morale = clamp((ally.morale||0) + 4, 0, (ally.maxMorale||100)); } }
    updateInfoPanel(); };
  const weaponStats=(s)=> RULES.weapons[s.equipment] || { reach:0, twoHanded:false, damage:{impact:0.33,slash:0.33,pierce:0.34} };
  const armourStats=(s)=> RULES.armour[s.armourType||'linen'] || { resist:{impact:0,slash:0,pierce:0}, convert:{} };
  const shieldStats=(s)=> RULES.shields[s.shieldType||'none'] || { block:0, hp:0 };
  const effectiveDamage = (att, def)=>{
    const w = weaponStats(att); const a = armourStats(def); const dmg = w.damage||{};
    const conv = a.convert||{}; const types=['impact','slash','pierce'];
    // apply conversion
    const eff = { impact:0, slash:0, pierce:0 };
    types.forEach(t=>{ const v=dmg[t]||0; const to=conv[t]; if (to && eff[to]!=null) eff[to]+=v; else eff[t]+=v; });
    // apply resistances
    const res = a.resist||{}; let sum=0; types.forEach(t=>{ const v=eff[t]||0; const r=res[t]||0; sum += v * (1 - r); });
    // shields
    const sh = shieldStats(def); const shEff = (def.shieldType && (def.shieldHP==null || def.shieldHP>0)) ? (sh.block||0) : 0;
    let score = sum * (1 - shEff);
    if (w.twoHanded) score *= 1.15;
    score *= (att.powerMul!=null ? att.powerMul : 1);
    return Math.max(0.01, score);
  };
  const multiAttackFactor = (formA, idxA, formB, idxB)=>{
    let n=0; for (let i=0;i<formA.soldiers.length;i++){ const s=formA.soldiers[i]; if (!s.alive) continue; if (s.engagedWith===idxB){ n++; } }
    // Much steeper scaling so 4v1 is near-certain kill
    return Math.pow(3.0, Math.max(0, n-1));
  };
  const attackScoreA = effectiveDamage(a,b) * multiAttackFactor(aForm, ai, bForm, bj);
  const attackScoreB = effectiveDamage(b,a) * multiAttackFactor(bForm, bj, aForm, ai);
  const winProb=(formA,formB)=>{ const pA=attackScoreA; const pB=attackScoreB; const s=Math.max(0.001,pA+pB); return pA/s; };
  switch(outcome){
    case 1: killSoldier(a,aForm,b); killSoldier(b,bForm,a); if (contactRound.stats){ contactRound.stats.playerKills+=1; contactRound.stats.enemyKills+=1; } logDebug('Duel: both dead'); aForm.onSoldierDeathByIndex(ai); bForm.onSoldierDeathByIndex(bj); break;
    case 2: if (Math.random()<winProb(aForm,bForm)){ killSoldier(b,bForm,a); if (contactRound.stats) contactRound.stats.playerKills+=1; logDebug('Duel: B dead'); bForm.onSoldierDeathByIndex(bj); } else { killSoldier(a,aForm,b); if (contactRound.stats) contactRound.stats.enemyKills+=1; logDebug('Duel: A dead'); aForm.onSoldierDeathByIndex(ai); } break;
    case 3: woundSoldier(a,b); woundSoldier(b,a); if (contactRound.stats){ contactRound.stats.playerWounds+=1; contactRound.stats.enemyWounds+=1; } logDebug('Duel: both wounded'); break;
    case 4: if (Math.random()<winProb(aForm,bForm)){ woundSoldier(b,a); if (contactRound.stats) contactRound.stats.playerWounds+=1; logDebug('Duel: B wounded'); } else { woundSoldier(a,b); if (contactRound.stats) contactRound.stats.enemyWounds+=1; logDebug('Duel: A wounded'); } break;
    case 5: default: aForm.energy=Math.max(0,aForm.energy-3); bForm.energy=Math.max(0,bForm.energy-3); logDebug('Duel: no change (energy spent)'); break;
  }
}

function drawWorld(){ ctx.clearRect(0,0,canvas.width,canvas.height); drawGround();
  // Weapon arcs removed per update 21
  if (world.player.order==='ranged') drawRangeArc(world.player);
  drawFormation(world.enemy, world.target===world.enemy?'#f9d293':world.enemy.color);
  drawFormation(world.player, world.player.color);
  drawUnitBars(world.enemy);
  drawUnitBars(world.player);
}
function drawGround(){ const tile=64; ctx.fillStyle='#0b0c10'; ctx.fillRect(0,0,canvas.width,canvas.height); ctx.strokeStyle='rgba(255,255,255,0.03)'; ctx.lineWidth=1; for (let x=0;x<canvas.width;x+=tile){ ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,canvas.height); ctx.stroke(); } for (let y=0;y<canvas.height;y+=tile){ ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(canvas.width,y); ctx.stroke(); } }
function drawRangeArc(unit){ ctx.save(); ctx.translate(unit.center.x, unit.center.y); ctx.beginPath(); ctx.moveTo(0,0); ctx.arc(0,0,RANGED_RANGE, unit.heading-RANGED_ARC, unit.heading+RANGED_ARC); ctx.closePath(); ctx.fillStyle='rgba(126,200,248,0.12)'; ctx.fill(); ctx.strokeStyle='rgba(126,200,248,0.4)'; ctx.lineWidth=2; ctx.stroke(); ctx.restore(); }
function drawFormation(f, baseColor){
  if (!f) return;
  if (!f.disbanded){ ctx.save(); ctx.translate(f.center.x, f.center.y); ctx.rotate(f.heading); ctx.strokeStyle=baseColor; ctx.lineWidth=2; const he=formationHalfExtents(f); ctx.strokeRect(-he.y, -he.x, he.y*2, he.x*2); ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(he.y*0.9, 0); ctx.stroke(); ctx.restore(); }
  f.soldiers.forEach((s, idx)=>{ ctx.save(); ctx.translate(s.pos.x, s.pos.y); let fill=baseColor; if (!s.alive) fill='rgba(255,255,255,0.15)'; else if (s.wounded) fill=darkenHex(baseColor, 0.55); ctx.fillStyle=fill; ctx.beginPath(); ctx.arc(0,0,6,0,Math.PI*2); ctx.fill();
    // If dead, do not render weapon or shield visuals
    if (!s.alive){
      // selection highlight still shown if selected
      if (world.selected && world.selected.form===f && world.selected.index===idx){ ctx.strokeStyle='#fff'; ctx.lineWidth=2; ctx.beginPath(); ctx.arc(0,0,9,0,Math.PI*2); ctx.stroke(); }
      ctx.restore(); return;
    }
    // Determine facing
    let dirx=Math.cos(f.heading), diry=Math.sin(f.heading);
    let foe=null; if (s.engagedWith>=0 && f.enemyRef && f.enemyRef.soldiers){ foe=f.enemyRef.soldiers[s.engagedWith]; if (foe && foe.alive){ const dx=foe.pos.x - s.pos.x, dy=foe.pos.y - s.pos.y; const dl=Math.hypot(dx,dy)||1; dirx=dx/dl; diry=dy/dl; } }
    const r=6; // body radius
    // Weapon visuals
    const w = RULES.weapons[s.equipment] || {}; const dmg=w.damage||{}; const thrust = (s.equipment==='spear'||s.equipment==='pike'||(dmg.pierce||0)>(dmg.slash||0));
    ctx.strokeStyle = baseColor; ctx.lineWidth = 2;
    if (thrust){
      const baseLen = 14; const jabExtra = (s.jabProgress||0) * 10; ctx.beginPath(); ctx.moveTo(dirx*r, diry*r); ctx.lineTo(dirx*(r+baseLen+jabExtra), diry*(r+baseLen+jabExtra)); ctx.stroke();
    } else {
      const swing = (s.swingProgress||0);
      // Rotate a short blade around facing direction for a swing effect
      const swingArc = (Math.PI * 0.9); // ~162 degrees
      const baseAngle = Math.atan2(diry, dirx) - swingArc*0.5;
      const ang = baseAngle + swingArc * swing;
      const bx = Math.cos(ang), by = Math.sin(ang);
      const bladeLen = 14; ctx.beginPath(); ctx.moveTo(bx*r, by*r); ctx.lineTo(bx*(r+bladeLen), by*(r+bladeLen)); ctx.stroke();
    }
    // Shield visual: disk to the left of facing, size by shield type, with HP ring
    const shType = s.shieldType||'none'; const sh = (RULES.shields||{})[shType]||{hp:0,block:0};
    if (shType && shType!=='none'){
      const leftx = -diry, lefty = dirx; const off= r*0.9; const cx = leftx*off, cy = lefty*off;
      const sizeMap = { small: 5, medium: 6.5, large: 8 };
      const rad = sizeMap[shType] || 6;
      ctx.save(); ctx.translate(cx, cy);
      ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.strokeStyle = darkenHex(baseColor, 0.8); ctx.lineWidth=1.5;
      ctx.beginPath(); ctx.arc(0,0,rad,0,Math.PI*2); ctx.fill(); ctx.stroke();
      const hp = (s.shieldHP==null? sh.hp : s.shieldHP); const max = (s.shieldMax==null? sh.hp : s.shieldMax)||1; const pct = Math.max(0, Math.min(1, hp/max));
      ctx.strokeStyle = '#76ff7a'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0,0,rad+1, -Math.PI/2, -Math.PI/2 + pct*2*Math.PI); ctx.stroke();
      ctx.restore();
    }
    // selection highlight
    if (world.selected && world.selected.form===f && world.selected.index===idx){ ctx.strokeStyle='#fff'; ctx.lineWidth=2; ctx.beginPath(); ctx.arc(0,0,9,0,Math.PI*2); ctx.stroke(); }
    ctx.restore(); }); }

function drawUnitBars(form){ if (!form || form.disbanded) return;
  // Compute aggregates
  const alive = form.soldiers.filter(s=>s.alive && !s.fleeing && !s.recovering && !s.rejoining);
  const totalHP = form.soldiers.reduce((a,s)=>a + (s.alive? (s.hp||0) : 0), 0);
  const maxStart = (form.baseTotalHP|| (form.baseCount||0)*100) || 1;
  const healthPct = Math.max(0, Math.min(1, totalHP / maxStart));
  const moralePct = alive.length>0 ? (alive.reduce((a,s)=>a+(s.morale||0),0) / (alive.length*100)) : 0;
  const energyPct = alive.length>0 ? (alive.reduce((a,s)=>a+(s.energy||0),0) / (alive.length*100)) : 0;
  const x = form.center.x, y = form.center.y - Math.max(form.radius+20, 40);
  const w = 120, h = 6, pad=4;
  const drawBar = (yy, pct, color, label)=>{ ctx.fillStyle='rgba(0,0,0,0.35)'; ctx.fillRect(x - w/2, yy, w, h); ctx.fillStyle=color; ctx.fillRect(x - w/2, yy, w*pct, h); ctx.strokeStyle='rgba(255,255,255,0.15)'; ctx.strokeRect(x - w/2, yy, w, h); };
  drawBar(y, healthPct, '#66e3ff', 'HP');
  drawBar(y + h + pad, moralePct, '#ffd166', 'Morale');
  drawBar(y + (h + pad)*2, energyPct, '#7bff8a', 'Energy');
}

// Determine formation-wide melee arc type (cached)\n
function updateHUD(){ const order=ORDER_DATA[world.player.order]; const ammoText=world.player.ammo>0?`${world.player.ammo} shots`:'No ammunition'; hud.innerHTML=`Order: ${order.label} | Energy ${world.player.energy.toFixed(0)} | Morale ${world.player.morale.toFixed(0)}<br>`+
  `Formation: ${world.player.cols} wide x ${world.player.rows} deep (${world.player.aliveCount()} active) | ${ammoText}<br>`+
  `Target: ${world.target?world.target.name:'None'} | Enemy morale ${world.enemy.morale.toFixed(0)} | Stance: ${world.player.stance}`;
  const pE=Math.round(world.player.energy), pM=Math.round(world.player.morale); const eE=Math.round(world.enemy.energy), eM=Math.round(world.enemy.morale);
  if (pE!==world.prev.pEnergy){ logDebug(`Player energy: ${world.prev.pEnergy} -> ${pE}`); world.prev.pEnergy=pE; }
  if (pM!==world.prev.pMorale){ logDebug(`Player morale: ${world.prev.pMorale} -> ${pM}`); world.prev.pMorale=pM; }
  if (eE!==world.prev.eEnergy){ logDebug(`Enemy energy: ${world.prev.eEnergy} -> ${eE}`); world.prev.eEnergy=eE; }
  if (eM!==world.prev.eMorale){ logDebug(`Enemy morale: ${world.prev.eMorale} -> ${eM}`); world.prev.eMorale=eM; }
  if (debugBox){ const stats=(f)=>{ let engaged=0,wounded=0,dead=0; for (const s of f.soldiers){ if (!s.alive){ dead++; continue; } if (s.engagedWith>=0) engaged++; if (s.wounded) wounded++; } return { engaged,wounded,dead }; };
    const ps=stats(world.player), es=stats(world.enemy);
    const l0=`Engaged  P:${ps.engaged} | E:${es.engaged}`; const l1=`Wounded  P:${ps.wounded} | E:${es.wounded}`; const l2=`Dead     P:${ps.dead} | E:${es.dead}`;
    if (debugLog.length<3 || !String(debugLog[0]).startsWith('Engaged')){ debugLog.unshift(l2); debugLog.unshift(l1); debugLog.unshift(l0); while (debugLog.length>80) debugLog.pop(); } else { debugLog[0]=l0; debugLog[1]=l1; debugLog[2]=l2; }
    // Player engagement direction (front/flank/rear)
    let facing = 'None';
    if (ps.engaged>0){ const fwd = world.player.forwardVec(); const dx=world.enemy.center.x - world.player.center.x; const dy=world.enemy.center.y - world.player.center.y; const len=Math.hypot(dx,dy)||1; const ux=dx/len, uy=dy/len; const dot=fwd.x*ux + fwd.y*uy; if (dot>=0.5) facing='Front'; else if (dot<=-0.5) facing='Rear'; else facing='Flank'; }
    debugLog[3] = `Player engaged from: ${facing}`;
    renderDebug(); }
}

// Debug control wiring
function updateDebugControls(){ const byId=(id)=>document.getElementById(id); const pSize=byId('pSize'); if (!pSize) return; const eSize=byId('eSize'); const pPower=byId('pPower'); const ePower=byId('ePower'); const charSpeed=byId('charSpeed'); const formSpeed=byId('formSpeed'); const formTurn=byId('formTurn'); const combatSpeed=byId('combatSpeed'); const chargeMult=byId('chargeMult');
  if (!updateDebugControls.initialized){ pSize.value=world.player.baseCount||world.player.soldiers.length; eSize.value=world.enemy.baseCount||world.enemy.soldiers.length; pPower.value=DEBUG.playerPower; ePower.value=DEBUG.enemyPower; charSpeed.value=DEBUG.charSpeed; formSpeed.value=DEBUG.formSpeed; formTurn.value=DEBUG.formTurn; combatSpeed.value=DEBUG.combatSpeed; if (chargeMult) chargeMult.value = DEBUG.chargeMult;
    pSize.addEventListener('input',()=>world.player.setSize(parseInt(pSize.value,10)));
    eSize.addEventListener('input',()=>world.enemy.setSize(parseInt(eSize.value,10)));
    pPower.addEventListener('input',()=>{ DEBUG.playerPower=parseFloat(pPower.value); regenerateUnitFromPower(world.player, DEBUG.playerPower); });
    ePower.addEventListener('input',()=>{ DEBUG.enemyPower=parseFloat(ePower.value); regenerateUnitFromPower(world.enemy, DEBUG.enemyPower); });
    charSpeed.addEventListener('input',()=>DEBUG.charSpeed=parseFloat(charSpeed.value));
    formSpeed.addEventListener('input',()=>DEBUG.formSpeed=parseFloat(formSpeed.value));
    formTurn.addEventListener('input',()=>DEBUG.formTurn=parseFloat(formTurn.value));
    combatSpeed.addEventListener('input',()=>DEBUG.combatSpeed=parseFloat(combatSpeed.value));
    if (chargeMult) chargeMult.addEventListener('input',()=>DEBUG.chargeMult=parseFloat(chargeMult.value));
    updateDebugControls.initialized=true;
  }
}

function populateEquipSelectors(){
  const selIds = ['pWeapSel','pArmSel','eWeapSel','eArmSel','pShieldSel','eShieldSel'];
  selIds.forEach(id=>{ const el=document.getElementById(id); if (!el) return; el.innerHTML=''; });
  const fill = (id, opts)=>{ const el=document.getElementById(id); if (!el) return; for (const k of Object.keys(opts)) { const o=document.createElement('option'); o.value=k; o.textContent=k; el.appendChild(o);} };
  fill('pWeapSel', RULES.weapons); fill('eWeapSel', RULES.weapons); fill('pArmSel', RULES.armour); fill('eArmSel', RULES.armour);
  if (RULES.shields){ fill('pShieldSel', RULES.shields); fill('eShieldSel', RULES.shields); }
  // Wire buttons
  const byId=(id)=>document.getElementById(id);
  const pWeapSel=byId('pWeapSel'), eWeapSel=byId('eWeapSel'), pArmSel=byId('pArmSel'), eArmSel=byId('eArmSel');
  const pShieldSel=byId('pShieldSel'), eShieldSel=byId('eShieldSel');
  const setWeaps=(form, type)=>{ form.soldiers.forEach(s=>{ s.equipment=type; const w=RULES.weapons[type]; if (w && w.twoHanded) { s.shieldType='none'; s.shieldHP=0; s.shieldMax=0; } }); };
  const randWeaps=(form)=>{ const keys=Object.keys(RULES.weapons); form.soldiers.forEach(s=>{ const type=keys[(Math.random()*keys.length)|0]; s.equipment=type; const w=RULES.weapons[type]; if (w && w.twoHanded) { s.shieldType='none'; s.shieldHP=0; s.shieldMax=0; } }); };
  const setArms=(form, type)=>{ form.soldiers.forEach(s=>{ s.armourType=type; }); };
  const randArms=(form)=>{ const keys=Object.keys(RULES.armour); form.soldiers.forEach(s=>{ const type=keys[(Math.random()*keys.length)|0]; s.armourType=type; }); };
  const setShields=(form, type)=>{ const sh=RULES.shields[type]; form.soldiers.forEach(s=>{ const w=RULES.weapons[s.equipment]; if (w && w.twoHanded){ s.shieldType='none'; s.shieldHP=0; s.shieldMax=0; return; } s.shieldType=type; s.shieldMax = (sh&&sh.hp)||0; s.shieldHP = s.shieldMax; }); };
  const randShields=(form)=>{ const keys=Object.keys(RULES.shields||{none:1}); form.soldiers.forEach(s=>{ const w=RULES.weapons[s.equipment]; if (w && w.twoHanded){ s.shieldType='none'; s.shieldHP=0; s.shieldMax=0; return; } const type=keys[(Math.random()*keys.length)|0]; const sh=RULES.shields[type]; s.shieldType=type; s.shieldMax=(sh&&sh.hp)||0; s.shieldHP=s.shieldMax; }); };
  const repairShields=(form)=>{ form.soldiers.forEach(s=>{ if (s.shieldType && s.shieldType!=='none'){ const sh=RULES.shields[s.shieldType]||{hp:0}; s.shieldMax=sh.hp||0; s.shieldHP=s.shieldMax; } }); };
  const btn=(id,fn)=>{ const el=byId(id); if (el && !el._bound){ el.addEventListener('click', fn); el._bound=true; } };
  btn('pWeapSet', ()=> setWeaps(world.player, pWeapSel.value));
  btn('pWeapRand', ()=> randWeaps(world.player));
  btn('eWeapSet', ()=> setWeaps(world.enemy, eWeapSel.value));
  btn('eWeapRand', ()=> randWeaps(world.enemy));
  btn('pArmSet', ()=> setArms(world.player, pArmSel.value));
  btn('pArmRand', ()=> randArms(world.player));
  btn('eArmSet', ()=> setArms(world.enemy, eArmSel.value));
  btn('eArmRand', ()=> randArms(world.enemy));
  btn('pShieldSet', ()=> setShields(world.player, pShieldSel.value));
  btn('pShieldRand', ()=> randShields(world.player));
  btn('eShieldSet', ()=> setShields(world.enemy, eShieldSel.value));
  btn('eShieldRand', ()=> randShields(world.enemy));
  btn('repairShieldsBtn', ()=>{ repairShields(world.player); repairShields(world.enemy); });
}

function regenerateUnitFromPower(form, power){
  // Power ~ equipment quality and baseline stats
  const clamp01 = (x)=>Math.max(0.5, Math.min(1.5, x));
  const equipWeights = [
    { type:'sword', w: clamp01(1.0 - 0.2*(power-1)) },
    { type:'gladius', w: clamp01(1.0 + 0.1*(power-1)) },
    { type:'axe', w: clamp01(1.0) },
    { type:'spear', w: clamp01(1.0 + 0.3*(power-1)) },
    { type:'pike', w: clamp01(0.8 + 0.6*(power-1)) },
    { type:'falx', w: clamp01(0.9 + 0.2*(power-1)) }
  ];
  const sumW = equipWeights.reduce((a,e)=>a+e.w,0);
  const pickEquip = ()=>{ let r=Math.random()*sumW; for (const e of equipWeights){ if (r<e.w) return e.type; r-=e.w; } return 'spear'; };
  form.soldiers.forEach(s=>{
    s.equipment = pickEquip();
    s.energy = clamp(60 + Math.random()*60 * (0.85 + 0.3*(power-1)), 0, 120);
    s.morale = clamp(60 + Math.random()*50 * (0.9 + 0.4*(power-1)), 0, 120);
    if (s.powerMul==null) s.powerMul=1; if (s.speedMul==null) s.speedMul=1;
  });
}







