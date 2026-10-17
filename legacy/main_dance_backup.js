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
    this.initSoldiers();
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
        wobble:Math.random()*Math.PI*2
      });
    }
    this.rebuildSlots();
    this.recomputeBBFromAliveSlots();
  }
  aliveCount(){ return this.soldiers.reduce((a,s)=>a+(s.alive?1:0),0); }
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
        this.soldiers.push({ pos:{ x:this.center.x + (Math.random()-0.5)*10, y:this.center.y + (Math.random()-0.5)*10 }, vel:{x:0,y:0}, slotIndex:i, engagedWith:-1, name, equipment, armourType, shieldType, hp:100, energy:100, morale:100, alive:true, wounded:false, wounds:[], woundsTaken:0, kills:0, woundsInflicted:0, nearbyAlliesKilled:0, powerMul:1, speedMul:1, action:'holding position', wobble:Math.random()*Math.PI*2 });
      }
    } else if (this.soldiers.length>newCount){ this.soldiers.length=newCount; }
    this.rebuildSlots(); this.recomputeBBFromAliveSlots(); }
  preferredSlotOrder(countLimit){ const order=[]; const halfCols=(this.cols-1)/2; for (let r=this.rows-1;r>=0;r--){ const cols=Array.from({length:this.cols},(_,c)=>c).sort((a,b)=>Math.abs(a-halfCols)-Math.abs(b-halfCols)); for (const c of cols){ order.push(this.slotIndexFromRC(r,c)); if (countLimit && order.length>=countLimit) return order; } } return order; }
  remapSoldiersToClosestSlots(){ const alive=this.soldiers; const n=alive.length; const order=this.preferredSlotOrder(n); const available=new Set(order); const cache=new Map(); const getPos=(idx)=>{ if(!cache.has(idx)) cache.set(idx, this.slotWorldPosition(idx)); return cache.get(idx); }; for (let i=0;i<alive.length;i++){ const s=alive[i]; let best=-1, bestD=1e12; for (const idx of available){ const p=getPos(idx); const dx=p.x-s.pos.x, dy=p.y-s.pos.y; const d2=dx*dx+dy*dy; if (d2<bestD){ bestD=d2; best=idx; } } if (best>=0){ s.slotIndex=best; available.delete(best); } else { s.slotIndex=order[i%order.length]; } } }
  reformFrontRanks(){
    const alive = this.soldiers.filter(s=>s.alive);
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

  recomputeBBFromAliveSlots(){
    // Compute extents in slot/local space from alive slot indices (stable until next casualty)
    if (!this.slots || this.slots.length===0){ this.bbHalfExtents = null; return; }
    let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity; let any=false;
    for (const s of this.soldiers){
      if (!s.alive) continue; any=true;
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
    // If stationary and no one engaged, reform to fill the front ranks
    if (!this._reformTimer) this._reformTimer = 0;
    const anyEngaged = this.soldiers.some(s => s.alive && s.engagedWith >= 0);
    if (this.isStationary() && !anyEngaged) {
      this._reformTimer += dt;
      if (this._reformTimer > 0.5) { this.reformFrontRanks(); this._reformTimer = 0; }
    } else {
      this._reformTimer = 0;
    }
    this.soldiers.forEach(s=>this.updateSoldier(s, dt)); }
  setOrder(order){ if (!ORDER_DATA[order]) return; if (order==='charge' && this.energy < 25) return; this.order=order; }
  updateSoldier(soldier, dt){ if (!soldier.alive){ soldier.vel.x*=0.9; soldier.vel.y*=0.9; soldier.pos.x += soldier.vel.x*dt; soldier.pos.y += soldier.vel.y*dt; return; }
    const slotTarget=this.slotWorldPosition(soldier.slotIndex);
    const wobble = Math.sin(soldier.wobble + performance.now()*0.0015)*2;
    let target={ x:slotTarget.x, y:slotTarget.y + wobble };
    if (soldier.engagedWith>=0){ const foe=this.enemyRef?.soldiers[soldier.engagedWith]; if (foe && foe.alive){
        // Deliberate melee phases: size up -> dash -> retreat
        if (!soldier.meleePhase) { soldier.meleePhase='size'; soldier.meleeT=0; soldier.meleeDur=0.9+Math.random()*0.9; }
        soldier.meleeT += dt;
        const vx = foe.pos.x - soldier.pos.x, vy = foe.pos.y - soldier.pos.y; const len = Math.hypot(vx,vy)||1; const ux=vx/len, uy=vy/len;
        const standoff = MELEE_RANGE * 0.95;
        const standoffPoint = { x: foe.pos.x - ux * standoff, y: foe.pos.y - uy * standoff };
        const limit = 24; // max displacement from standoff (twice diameter)
        if (soldier.meleePhase==='size'){
          // hover around standoff with slight lateral sway
          const px=-uy, py=ux; const sway = Math.sin(performance.now()*0.002 + soldier.wobble)*5;
          target = { x: standoffPoint.x + px*sway, y: standoffPoint.y + py*sway };
          if (soldier.meleeT > soldier.meleeDur){ soldier.meleePhase='dash'; soldier.meleeT=0; soldier.meleeDur=0.28+Math.random()*0.25; }
        } else if (soldier.meleePhase==='dash'){
          const toward = Math.min(limit, Math.hypot(foe.pos.x-standoffPoint.x, foe.pos.y-standoffPoint.y));
          target = { x: standoffPoint.x + ux * toward, y: standoffPoint.y + uy * toward };
          if (soldier.meleeT > soldier.meleeDur){ soldier.meleePhase='retreat'; soldier.meleeT=0; soldier.meleeDur=0.4+Math.random()*0.35; }
        } else { // retreat & evaluate: return to formation slot
          target = { x: slotTarget.x, y: slotTarget.y };
          const backDist = Math.hypot(slotTarget.x - soldier.pos.x, slotTarget.y - soldier.pos.y);
          if (backDist <= 3){ soldier.meleePhase='size'; soldier.meleeT=0; soldier.meleeDur=0.9+Math.random()*0.9; }
        }
        const dxs = target.x - standoffPoint.x; const dys = target.y - standoffPoint.y; const ds = Math.hypot(dxs,dys);
        if (ds > limit){ target.x = standoffPoint.x + (dxs/ds)*limit; target.y = standoffPoint.y + (dys/ds)*limit; }
      } else { soldier.engagedWith=-1; soldier.meleePhase=undefined; soldier.meleeT=0; }
    }
    const dx=target.x - soldier.pos.x, dy=target.y - soldier.pos.y; const dist=Math.hypot(dx,dy);
    let maxSpeed = SOLDIER_SPEED * DEBUG.charSpeed * (this.order==='charge'?DEBUG.chargeMult:1);
    if (soldier.speedMul != null) maxSpeed *= soldier.speedMul; // leg wounds slow
    if (soldier.engagedWith>=0) maxSpeed *= 0.6; // slower while engaged
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
  const basic = `Name: ${s.name}\nUnit: ${form.name}\nHealth: ${Math.round(s.hp||0)}\nEnergy: ${Math.round(s.energy||0)}\nMorale: ${Math.round(s.morale||0)}\nWounded: ${s.wounded ? 'Yes' : 'No'}\nEquipment: ${s.equipment}\nAction: ${s.action}`;
  const more = world.infoExpanded ? `\n\nKills: ${s.kills||0}\nWounds Inflicted: ${s.woundsInflicted||0}\nWounds Taken: ${s.woundsTaken||0}\nNearby Allies Killed: ${s.nearbyAlliesKilled||0}\nWounds: ${(s.wounds&&s.wounds.length? s.wounds.join(', '): 'None')}` : '';
  const btnText = world.infoExpanded ? 'Less Info' : 'More Info';
  box.innerHTML = `<pre style="margin:0; white-space:pre-wrap">${basic}${more}</pre><div style="margin-top:6px"><button id="moreInfoBtn">${btnText}</button></div>`;
  const btn = document.getElementById('moreInfoBtn');
  if (btn){
    btn.addEventListener('click', (ev)=>{ ev.stopPropagation(); world.infoExpanded = !world.infoExpanded; updateInfoPanel(); }, { once: true });
  }
}

function applyWardZone(ward, opp, dt){ if (ward.order!=='ward') return; const zone=Math.min(ward.radius+40,200); opp.soldiers.forEach(s=>{ if(!s.alive) return; const dx=s.pos.x-ward.center.x; const dy=s.pos.y-ward.center.y; const dist=Math.hypot(dx,dy)||1; if (dist<zone){ const push=(zone-dist)/zone; s.vel.x*=0.5; s.vel.y*=0.5; s.pos.x += (dx/dist)*push*35*dt; s.pos.y += (dy/dist)*push*35*dt; } }); }

function resolvePush(a,b,dt){ const res=obbOverlap(a,b); if (!res.overlap) return res; const move=res.depth; a.center.x -= res.normal.x*move; a.center.y -= res.normal.y*move; return res; }
function clampUnit(u){ u.center.x=clamp(u.center.x,u.radius, canvas.width-u.radius); u.center.y=clamp(u.center.y,u.radius, canvas.height-u.radius); }

function updateContactRound(contact, dt){ if (!contact||!contact.overlap){ if (contactRound.active){ contactRound.active=false; contactRound.time=0; contactRound.pushDone=false; contactRound.stats=undefined; } return; }
  if (!contactRound.active){ contactRound.active=true; contactRound.time=0; contactRound.pushDone=false; contactRound.stats={ playerKills:0, enemyKills:0, playerWounds:0, enemyWounds:0 }; }
  else { contactRound.time += dt; const threshold=15/Math.max(0.1,DEBUG.combatSpeed); if (contactRound.time>=threshold){ if (!contactRound.pushDone){ const s=contactRound.stats; const pScore=s.playerKills*2 + s.playerWounds; const eScore=s.enemyKills*2 + s.enemyWounds; if (pScore>eScore){ applyRoundPush(world.player,world.enemy); logDebug(`Round push: Player wins (K:${s.playerKills} W:${s.playerWounds}) vs Enemy (K:${s.enemyKills} W:${s.enemyWounds})`);} else if (eScore>pScore){ applyRoundPush(world.enemy,world.player); logDebug(`Round push: Enemy wins (K:${s.enemyKills} W:${s.enemyWounds}) vs Player (K:${s.playerKills} W:${s.playerWounds})`);} else { logDebug(`Round push: Draw (P K:${s.playerKills} W:${s.playerWounds} | E K:${s.enemyKills} W:${s.enemyWounds})`);} contactRound.pushDone=true; } contactRound.time=0; contactRound.pushDone=false; contactRound.stats={ playerKills:0, enemyKills:0, playerWounds:0, enemyWounds:0 }; } }
}
function applyRoundPush(attacker, defender){ const fwd=attacker.forwardVec(); const speed=30; defender.retreat.vx=fwd.x*speed; defender.retreat.vy=fwd.y*speed; defender.retreat.t=0.6; }

function handleMelee(a,b,dt){ const aAlive=a.soldiers; const bAlive=b.soldiers; const baseSeek=MELEE_RANGE*1.4;
  // opportunistic seeking
  const weapReach = (s)=>{ const w = RULES.weapons[s.equipment]; return (w && w.reach) ? w.reach : 0; };
  aAlive.forEach((s)=>{ if(!s.alive||s.engagedWith>=0) return; let best=1e9, ci=-1; const seekRadius=baseSeek + weapReach(s); for (let j=0;j<bAlive.length;j++){ const f=bAlive[j]; if(!f.alive) continue; const d=Math.hypot(f.pos.x-s.pos.x, f.pos.y-s.pos.y); if (d<best && d<seekRadius){ best=d; ci=j; } } if (ci>=0) s.engagedWith=ci; });
  bAlive.forEach((s)=>{ if(!s.alive||s.engagedWith>=0) return; let best=1e9, ci=-1; const seekRadius=baseSeek + weapReach(s); for (let j=0;j<aAlive.length;j++){ const f=aAlive[j]; if(!f.alive) continue; const d=Math.hypot(f.pos.x-s.pos.x, f.pos.y-s.pos.y); if (d<best && d<seekRadius){ best=d; ci=j; } } if (ci>=0) s.engagedWith=ci; });
  aAlive.forEach(s=>{ if (s.combatTimer==null) s.combatTimer=0; if (s.wounded==null) s.wounded=false; });
  bAlive.forEach(s=>{ if (s.combatTimer==null) s.combatTimer=0; if (s.wounded==null) s.wounded=false; });

  for (let i=0;i<aAlive.length;i++){ const sa=aAlive[i]; if(!sa.alive) continue; const j=sa.engagedWith; if (j<0) continue; const sb=bAlive[j]; if (!sb||!sb.alive){ sa.engagedWith=-1; continue; } const dist=Math.hypot(sb.pos.x-sa.pos.x, sb.pos.y-sa.pos.y);
    const aRange = MELEE_RANGE + weapReach(sa);
    const bRange = MELEE_RANGE + weapReach(sb);
    if (dist<Math.max(aRange,bRange)){
      // light bounce/repel to animate melee
      const dx = sb.pos.x - sa.pos.x, dy = sb.pos.y - sa.pos.y; const len = Math.hypot(dx,dy) || 1;
      const repel = (MELEE_RANGE - dist) / MELEE_RANGE;
      const fx = (dx/len) * repel * 20; const fy = (dy/len) * repel * 20;
      sa.vel.x -= fx * dt; sa.vel.y -= fy * dt; sb.vel.x += fx * dt; sb.vel.y += fy * dt;

      const th=15/Math.max(0.1,DEBUG.combatSpeed); sa.combatTimer+=dt; sb.combatTimer+=dt; if (sa.combatTimer>=th && sb.combatTimer>=th){ resolveDuel(a,i,b,j); sa.combatTimer=0; sb.combatTimer=0; }
    }
    else if (dist>MELEE_RANGE*1.6){ if (sb.engagedWith===i) sb.engagedWith=-1; sa.engagedWith=-1; sa.combatTimer=0; if (sb) sb.combatTimer=0; }
  }
  // symmetric disengage
  for (let j=0;j<bAlive.length;j++){ const sb=bAlive[j]; if(!sb.alive) continue; const i=sb.engagedWith; if (i<0) continue; const sa=aAlive[i]; if(!sa||!sa.alive){ sb.engagedWith=-1; continue; } const dist=Math.hypot(sa.pos.x-sb.pos.x, sa.pos.y-sb.pos.y); if (dist>MELEE_RANGE*1.6){ if (sa.engagedWith===j) sa.engagedWith=-1; sb.engagedWith=-1; sb.combatTimer=0; if (sa) sa.combatTimer=0; } }

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
  const woundSoldier = (s, inflictedBy)=>{ ensureStats(s); s.wounded=true; s.woundsTaken += 1; s.hp=Math.min(s.hp,40); const type = woundTypes[Math.floor(Math.random()*woundTypes.length)]; s.wounds.push(type); s.lastWoundType=type; s.lastWoundAt=performance.now(); applyWoundEffect(s, type); if (s.shieldType && s.shieldType!=='none'){ if (s.shieldHP==null){ const sh=shieldStats(s); s.shieldMax=sh.hp||0; s.shieldHP=s.shieldMax; } s.shieldHP = Math.max(0, (s.shieldHP||0) - (5 + Math.random()*8)); } if (inflictedBy){ ensureStats(inflictedBy); inflictedBy.woundsInflicted += 1; inflictedBy.lastInflictedAt=performance.now(); } updateInfoPanel(); };
  const killSoldier = (s, form, inflictedBy)=>{ ensureStats(s); s.alive=false; s.hp=0; s.vel.x+=(Math.random()-0.5)*40; s.vel.y+=(Math.random()-0.5)*40; form.morale=Math.max(0,form.morale-2); if (s.shieldType && s.shieldType!=='none'){ if (s.shieldHP==null){ const sh=shieldStats(s); s.shieldMax=sh.hp||0; s.shieldHP=s.shieldMax; } s.shieldHP = Math.max(0, (s.shieldHP||0) - (10 + Math.random()*10)); } if (inflictedBy){ ensureStats(inflictedBy); inflictedBy.kills += 1; inflictedBy.lastKillAt=performance.now(); }
    // Nearby allies register the loss
    for (const ally of form.soldiers){ if (!ally.alive) continue; ensureStats(ally); const d=Math.hypot((ally.pos.x - s.pos.x),(ally.pos.y - s.pos.y)); if (d < 80){ ally.nearbyAlliesKilled += 1; ally.lastNearbyLossAt=performance.now(); } }
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
    return Math.pow(1.3, Math.max(0, n-1));
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

function drawWorld(){ ctx.clearRect(0,0,canvas.width,canvas.height); drawGround(); if (world.player.order==='ranged') drawRangeArc(world.player); drawFormation(world.enemy, world.target===world.enemy?'#f9d293':world.enemy.color); drawFormation(world.player, world.player.color); }
function drawGround(){ const tile=64; ctx.fillStyle='#0b0c10'; ctx.fillRect(0,0,canvas.width,canvas.height); ctx.strokeStyle='rgba(255,255,255,0.03)'; ctx.lineWidth=1; for (let x=0;x<canvas.width;x+=tile){ ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,canvas.height); ctx.stroke(); } for (let y=0;y<canvas.height;y+=tile){ ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(canvas.width,y); ctx.stroke(); } }
function drawRangeArc(unit){ ctx.save(); ctx.translate(unit.center.x, unit.center.y); ctx.beginPath(); ctx.moveTo(0,0); ctx.arc(0,0,RANGED_RANGE, unit.heading-RANGED_ARC, unit.heading+RANGED_ARC); ctx.closePath(); ctx.fillStyle='rgba(126,200,248,0.12)'; ctx.fill(); ctx.strokeStyle='rgba(126,200,248,0.4)'; ctx.lineWidth=2; ctx.stroke(); ctx.restore(); }
function drawFormation(f, baseColor){ ctx.save(); ctx.translate(f.center.x, f.center.y); ctx.rotate(f.heading); ctx.strokeStyle=baseColor; ctx.lineWidth=2; const he=formationHalfExtents(f); ctx.strokeRect(-he.y, -he.x, he.y*2, he.x*2); ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(he.y*0.9, 0); ctx.stroke(); ctx.restore();
  f.soldiers.forEach((s, idx)=>{ ctx.save(); ctx.translate(s.pos.x, s.pos.y); let fill=baseColor; if (!s.alive) fill='rgba(255,255,255,0.15)'; else if (s.wounded) fill=darkenHex(baseColor, 0.55); ctx.fillStyle=fill; ctx.beginPath(); ctx.arc(0,0,6,0,Math.PI*2); ctx.fill();
    // selection highlight
    if (world.selected && world.selected.form===f && world.selected.index===idx){ ctx.strokeStyle='#fff'; ctx.lineWidth=2; ctx.beginPath(); ctx.arc(0,0,9,0,Math.PI*2); ctx.stroke(); }
    ctx.restore(); }); }

function updateHUD(){ const order=ORDER_DATA[world.player.order]; const ammoText=world.player.ammo>0?`${world.player.ammo} shots`:'No ammunition'; hud.innerHTML=`Order: ${order.label} | Energy ${world.player.energy.toFixed(0)} | Morale ${world.player.morale.toFixed(0)}<br>`+
  `Formation: ${world.player.cols} wide x ${world.player.rows} deep (${world.player.aliveCount()} active) | ${ammoText}<br>`+`Target: ${world.target?world.target.name:'None'} | Enemy morale ${world.enemy.morale.toFixed(0)}`;
  const pE=Math.round(world.player.energy), pM=Math.round(world.player.morale); const eE=Math.round(world.enemy.energy), eM=Math.round(world.enemy.morale);
  if (pE!==world.prev.pEnergy){ logDebug(`Player energy: ${world.prev.pEnergy} -> ${pE}`); world.prev.pEnergy=pE; }
  if (pM!==world.prev.pMorale){ logDebug(`Player morale: ${world.prev.pMorale} -> ${pM}`); world.prev.pMorale=pM; }
  if (eE!==world.prev.eEnergy){ logDebug(`Enemy energy: ${world.prev.eEnergy} -> ${eE}`); world.prev.eEnergy=eE; }
  if (eM!==world.prev.eMorale){ logDebug(`Enemy morale: ${world.prev.eMorale} -> ${eM}`); world.prev.eMorale=eM; }
  if (debugBox){ const stats=(f)=>{ let engaged=0,wounded=0,dead=0; for (const s of f.soldiers){ if (!s.alive){ dead++; continue; } if (s.engagedWith>=0) engaged++; if (s.wounded) wounded++; } return { engaged,wounded,dead }; };
    const ps=stats(world.player), es=stats(world.enemy); const l0=`Engaged  P:${ps.engaged} | E:${es.engaged}`; const l1=`Wounded  P:${ps.wounded} | E:${es.wounded}`; const l2=`Dead     P:${ps.dead} | E:${es.dead}`; if (debugLog.length<3 || !String(debugLog[0]).startsWith('Engaged')){ debugLog.unshift(l2); debugLog.unshift(l1); debugLog.unshift(l0); while (debugLog.length>80) debugLog.pop(); } else { debugLog[0]=l0; debugLog[1]=l1; debugLog[2]=l2; } renderDebug(); }
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
  const selIds = ['pWeapSel','pArmSel','eWeapSel','eArmSel'];
  selIds.forEach(id=>{ const el=document.getElementById(id); if (!el) return; el.innerHTML=''; });
  const fill = (id, opts)=>{ const el=document.getElementById(id); if (!el) return; for (const k of Object.keys(opts)) { const o=document.createElement('option'); o.value=k; o.textContent=k; el.appendChild(o);} };
  fill('pWeapSel', RULES.weapons); fill('eWeapSel', RULES.weapons); fill('pArmSel', RULES.armour); fill('eArmSel', RULES.armour);
  // Wire buttons
  const byId=(id)=>document.getElementById(id);
  const pWeapSel=byId('pWeapSel'), eWeapSel=byId('eWeapSel'), pArmSel=byId('pArmSel'), eArmSel=byId('eArmSel');
  const setWeaps=(form, type)=>{ form.soldiers.forEach(s=>{ s.equipment=type; const w=RULES.weapons[type]; if (w && w.twoHanded) { s.shieldType='none'; s.shieldHP=0; s.shieldMax=0; } }); };
  const randWeaps=(form)=>{ const keys=Object.keys(RULES.weapons); form.soldiers.forEach(s=>{ const type=keys[(Math.random()*keys.length)|0]; s.equipment=type; const w=RULES.weapons[type]; if (w && w.twoHanded) { s.shieldType='none'; s.shieldHP=0; s.shieldMax=0; } }); };
  const setArms=(form, type)=>{ form.soldiers.forEach(s=>{ s.armourType=type; }); };
  const randArms=(form)=>{ const keys=Object.keys(RULES.armour); form.soldiers.forEach(s=>{ const type=keys[(Math.random()*keys.length)|0]; s.armourType=type; }); };
  const btn=(id,fn)=>{ const el=byId(id); if (el && !el._bound){ el.addEventListener('click', fn); el._bound=true; } };
  btn('pWeapSet', ()=> setWeaps(world.player, pWeapSel.value));
  btn('pWeapRand', ()=> randWeaps(world.player));
  btn('eWeapSet', ()=> setWeaps(world.enemy, eWeapSel.value));
  btn('eWeapRand', ()=> randWeaps(world.enemy));
  btn('pArmSet', ()=> setArms(world.player, pArmSel.value));
  btn('pArmRand', ()=> randArms(world.player));
  btn('eArmSet', ()=> setArms(world.enemy, eArmSel.value));
  btn('eArmRand', ()=> randArms(world.enemy));
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
