import { TUNING, HORSE, WEAPONS, LIGHT } from './rules.js';
import { isFormed, isGone, isRunning, dist, clamp, fwdOf, rightOf, angleWrap, shiftNerve, logEvent } from './core.js';
import { resolveBlow, reachTo, shieldCover, attackersOf } from './combat.js';
import { depthAt } from './unit.js';
import { throwJavelin } from './light.js';
import { SIDES } from './names.js';

// Cavalry: squadrons of horsemen on the wings. They are not knights and will not ride into a
// hedge of spears. What they can do is go fast: they fight the enemy's horse first, since
// while it is about nothing else is safe, and once it is beaten or far away they ride down
// light troops caught in the open, or fall on the flank and rear of a phalanx locked in the
// fight, strike, and are away before they can be caught. Caught standing among the enemy, a
// horseman is in trouble: he has no shield and no ranks, and his horse is a big target.
//
// A side's cavalry on one wing is one body under one commander, however many contingents it
// is made of; a contingent only says who rides with whom.

const RIDING_STATES = new Set(['riding', 'charging', 'melee', 'wheeling']);
export function isRiding(s) {
  return RIDING_STATES.has(s.state);
}

export function createWing(id, side, wing, contingents, bothWings) {
  const roster = SIDES[side];
  const where = bothWings ? ` on the ${wing}` : '';
  return {
    id,
    side,
    wing, // 'right' | 'left', as the side faces the enemy
    name: `${roster.adjective} horse${where}`,
    short: `${roster.adjective} horse`,
    contingents: contingents.map((c) => ({ name: c.name, quality: c.quality, index: c.index, members: [] })),
    members: [],
    mode: 'form', // form | engage | screen | hunt | raid | pursue | rest | broken | leave
    modeT: 0,
    decideT: 0,
    target: null, // the enemy wing it is going for, when engaging
    raid: null, // { phase: 'approach' | 'charge' | 'out', t, point, out }
    anchor: { x: 0, y: 0 },
    heading: 0,
    speed: 0,
    present: 0,
    running: 0,
    nerve: 1,
    stamina: 1,
    cohesion: 0.6,
    momentum: 0,
    sinceBlow: 0,
    causes: {},
    stats: { killed: 0, killedPursuit: 0, wounds: 0, fled: 0 },
  };
}

// Where a wing forms up: out beyond its own phalanx's end, a little back from the front.
export function wingPost(world, b) {
  const u = world.units[b.side];
  const fw = fwdOf(u.heading);
  const rt = rightOf(u.heading);
  const out = (u.files / 2) * TUNING.fileSpacing + 10 + blockWidth(b) / 2;
  const sign = b.wing === 'right' ? 1 : -1;
  // Drawn back out of javelin range, if it has had to.
  const shift = b.mode === 'form' && b.postShift ? b.postShift : { x: 0, y: 0 };
  return { x: u.anchor.x + rt.x * sign * out - fw.x * 4 + shift.x, y: u.anchor.y + rt.y * sign * out - fw.y * 4 + shift.y };
}

function blockShape(b) {
  const n = Math.max(1, b.members.length);
  const ranks = n >= 12 ? 3 : n >= 4 ? 2 : 1;
  return { ranks, files: Math.ceil(n / ranks) };
}

function blockWidth(b) {
  return (blockShape(b).files - 1) * HORSE.spaceX;
}

// A rider's place in the squadron's block, around its anchor.
function placePoint(b, s) {
  const { files } = blockShape(b);
  const f = s.place % files;
  const r = Math.floor(s.place / files);
  const fw = fwdOf(b.heading);
  const rt = rightOf(b.heading);
  const x = (f - (files - 1) / 2) * HORSE.spaceX;
  const y = -r * HORSE.spaceY;
  return { x: b.anchor.x + rt.x * x + fw.x * y, y: b.anchor.y + rt.y * x + fw.y * y };
}

export function placeWing(world, b) {
  const u = world.units[b.side];
  b.present = b.members.length;
  b.heading = u.heading;
  b.anchor = wingPost(world, b);
  b.members.forEach((id, k) => {
    const s = world.soldiers[id];
    s.place = k;
    s.pos = placePoint(b, s);
    s.prev = { ...s.pos };
    s.lag = { ...s.pos };
    s.facing = b.heading;
  });
}

function centroid(world, ids, ok) {
  let n = 0;
  let x = 0;
  let y = 0;
  for (const id of ids) {
    const s = world.soldiers[id];
    if (!ok(s)) continue;
    n++;
    x += s.pos.x;
    y += s.pos.y;
  }
  return n ? { x: x / n, y: y / n, n } : null;
}

function enemyWings(world, b) {
  return world.horse.filter((o) => o.side !== b.side);
}

// The commander's decisions, twice a second.
export function stepWing(world, b, dt) {
  b.modeT += dt;
  b.decideT -= dt;
  moveAnchor(world, b, dt);
  if (b.decideT > 0 || !b.members.length) return;
  b.decideT = 0.5;
  let present = 0;
  let running = 0;
  let nerve = 0;
  let stamina = 0;
  for (const id of b.members) {
    const s = world.soldiers[id];
    if (isRiding(s)) {
      present++;
      nerve += s.nerve;
      stamina += s.stamina;
    } else if (s.state === 'fleeing') running++;
  }
  b.present = present;
  b.running = running;
  // How hard javelins are coming in on it: throws at its riders, per second.
  const fire = ((b.underFire || 0) - (b.lastFire || 0)) / 0.5;
  b.lastFire = b.underFire || 0;
  b.fireRate = 0.8 * (b.fireRate || 0) + 0.2 * fire;
  b.nerve = present ? nerve / present : 0;
  b.stamina = present ? stamina / present : 0;
  const u = world.units[b.side];
  const e = world.units[1 - b.side];
  const set = (mode, text) => {
    if (b.mode === mode) return;
    b.mode = mode;
    b.modeT = 0;
    b.raid = null;
    if (mode !== 'engage') b.target = null;
    if (text) logEvent(world, 'horse', text, { unit: b.side });
  };
  if (b.mode === 'leave') return;
  if (u.mode === 'routed') {
    set('leave', `With their phalanx broken, the ${b.name} ride off the field.`);
    return;
  }
  if (b.mode !== 'broken' && (running / Math.max(1, present + running) > 0.25 || present <= Math.round(0.25 * b.members.length)
    || (b.nerve < HORSE.breakNerve && (b.mode === 'engage' || b.mode === 'screen')))) {
    set('broken', `The ${b.name} are routed and gallop for the rear.`);
    b.beaten = (b.beaten || 0) + 1;
    // The whole squadron goes: horsemen do not stand once the men beside them turn.
    for (const id of b.members) {
      const s = world.soldiers[id];
      if (!isRiding(s)) continue;
      s.state = 'fleeing';
      s.stateT = 0;
      s.target = -1;
      s.aggressor = false;
      s.record.fled++;
      b.stats.fled++;
      if (s.fledAt == null) s.fledAt = world.t;
    }
    return;
  }
  if (b.mode === 'broken') {
    if (b.modeT > 30 && b.nerve > 0.6 && present >= Math.round(0.4 * b.members.length)) set(b.ai ? 'rest' : 'form', `The ${b.name} rally behind their own line.`);
    return;
  }
  // Commanded by the player: he says what they are about.
  if (!b.ai) {
    if (b.mode === 'engage') b.target = nearestEnemyWing(world, b);
    return;
  }
  if (e.mode === 'routed') {
    if (b.mode === 'pursue' && (b.modeT > HORSE.pursuitTime || b.stamina < 0.3)) set('rest', `The ${b.name} draw rein and come back.`);
    else if (b.mode !== 'rest' && b.stamina > 0.3) set('pursue', `The ${b.name} ride down the fleeing enemy.`);
    return;
  }
  if (b.stamina < HORSE.restStamina && b.mode !== 'rest') {
    set('rest', `Their horses blown, the ${b.name} pull back to rest them.`);
    return;
  }
  if (b.mode === 'rest' && b.stamina < HORSE.readyStamina) return;

  // The enemy's horse first: while it is about, nothing else can be done safely.
  // A beaten squadron sheltering behind its own foot is no use to attack, but it is still
  // there, and may come out again.
  const foes = enemyWings(world, b).filter((o) => o.present > 0 && o.mode !== 'broken' && o.mode !== 'leave' && !sheltering(world, o));
  if (foes.length) {
    const here = centroid(world, b.members, isRiding) || b.anchor;
    let t = null;
    let td = Infinity;
    for (const o of foes) {
      const c = centroid(world, o.members, isRiding);
      const d = c ? dist(c, here) : Infinity;
      if (d < td) {
        td = d;
        t = o;
      }
    }
    // A commander does not change his mind every moment.
    if ((b.mode === 'engage' || b.mode === 'screen') && b.modeT < 6) {
      b.target = t;
      return;
    }
    // Once hanging back, it takes a clear advantage to go in again; once beaten, more still.
    const need = b.beaten ? 1.3 : b.mode === 'screen' ? 0.9 : 0.6;
    if (power(b) < need * power(t)) {
      if (b.mode !== 'screen') set('screen', `Outnumbered by the ${t.name}, the ${b.name} hang back and cover their flank.`);
      b.target = t;
    } else {
      if (b.mode !== 'engage' || b.target !== t) set('engage', `The ${b.name} ride at the ${t.name}.`);
      b.target = t;
    }
    return;
  }

  // No enemy horse to stop them. The commander picks his prey.
  // Standing to be picked off by javelin men is no use to anyone: go for them if they can be
  // got at, and if they cannot, get out of their reach.
  if (b.fireRate > 0.15 && b.mode !== 'raid' && b.mode !== 'hunt' && !(b.backLogged && world.t - b.backLogged < 15)) {
    const here = centroid(world, b.members, isRiding) || b.anchor;
    const g = world.lights[1 - b.side];
    const throwers = (g ? g.members : []).map((id) => world.soldiers[id])
      .filter((o) => (o.state === 'skirmishing' || o.state === 'retiring' || o.state === 'resting') && dist(o.pos, here) < LIGHT.range + 8);
    const open = throwers.filter((o) => !covered(world, o, 1 - b.side, HORSE.shelter));
    if (open.length && b.stamina > 0.4 && b.present >= open.length / 2) {
      set('hunt', `Stung by the javelins, the ${b.name} ride at the light troops throwing at them.`);
      return;
    }
    if (throwers.length) {
      // Out of reach, directly away from them.
      const c = throwers.reduce((a, o) => ({ x: a.x + o.pos.x / throwers.length, y: a.y + o.pos.y / throwers.length }), { x: 0, y: 0 });
      const v = { x: here.x - c.x, y: here.y - c.y };
      const l = Math.hypot(v.x, v.y) || 1;
      const need = LIGHT.range + 10 - l;
      if (need > 0) {
        const prev = b.postShift || { x: 0, y: 0 };
        b.postShift = { x: prev.x + (v.x / l) * need, y: prev.y + (v.y / l) * need };
        if (b.mode !== 'form') set('form');
        if (!b.backLogged || world.t - b.backLogged > 30) {
          b.backLogged = world.t;
          logEvent(world, 'horse', `Unable to get at the javelin men, the ${b.name} draw back out of their reach.`, { unit: b.side });
        }
        return;
      }
    }
  }
  const busy = (b.mode === 'raid' && b.raid && b.modeT < 60) || (b.mode === 'hunt' && b.modeT < 25);
  if (busy) return;
  const here = centroid(world, b.members, isRiding) || b.anchor;
  // Enemy horsemen that have been beaten may come back; how long would they take to get here?
  // A handful of beaten men is no threat to a whole squadron.
  let threat = Infinity;
  for (const o of enemyWings(world, b)) {
    if (o.mode === 'leave' || power(o) < 0.5 * power(b)) continue;
    const c = centroid(world, o.members, (s) => isRiding(s) || s.state === 'rallying');
    if (c) threat = Math.min(threat, dist(c, here));
  }
  const exposed = exposedLights(world, b.side, here, 90).filter((o) => catchable(world, o, here)).length;
  const locked = world.contactT != null && e.inContact;
  const end = raidEnd(world, b);
  const raidValue = threat > HORSE.safeRaid && (locked || e.mode === 'withdrawing') && end ? 6 : 0;
  if (raidValue > 0 && raidValue >= exposed) {
    set('raid', `With the enemy's horse out of the way, the ${b.name} ride round to fall on the ${e.short}' flank and rear.`);
    b.raid = { phase: 'approach', t: 0, end };
  } else if ((locked || e.mode === 'withdrawing') && threat > HORSE.safeRaid && !end && !b.deterLogged) {
    b.deterLogged = true;
    logEvent(world, 'horse', `The ${b.name} would fall on the ${e.short}' rear, but with their light troops watching both ends they think better of it.`, { unit: b.side });
  } else if (exposed >= 2) {
    set('hunt', `The ${b.name} ride at the enemy's light troops in the open.`);
  } else if (b.mode !== 'form') {
    set('form', `The ${b.name} form up again beside their phalanx.`);
  }
}

// A squadron pulled back behind the end of its own line, among its own foot.
function sheltering(world, w) {
  if (w.mode !== 'screen') return false;
  const c = centroid(world, w.members, isRiding);
  return !!c && covered(world, { pos: c }, w.side, 16);
}

// Whether a light man can be ridden down before he gets to the cover of his own hoplites:
// a horse at the gallop goes more than twice as fast as a man running.
function catchable(world, o, from) {
  const e = world.units[o.side];
  let cover = Infinity;
  for (const hid of e.members) {
    const h = world.soldiers[hid];
    if (isFormed(h)) cover = Math.min(cover, dist(h.pos, o.pos));
  }
  return dist(from, o.pos) < (cover - HORSE.shelter) * 2;
}

// Whether a man is within reach of the cover of his own side's formed hoplites.
function covered(world, o, side, range) {
  for (const hid of world.units[side].members) {
    const h = world.soldiers[hid];
    if (isFormed(h) && Math.abs(h.pos.x - o.pos.x) < range && dist(h.pos, o.pos) < range) return true;
  }
  return false;
}

function power(w) {
  return w.present * w.nerve * (0.5 + 0.5 * w.stamina);
}

// The enemy squadron nearest this one, beaten or not.
function nearestEnemyWing(world, b) {
  const here = centroid(world, b.members, isRiding) || b.anchor;
  let best = null;
  let bd = Infinity;
  for (const o of enemyWings(world, b)) {
    if (o.mode === 'leave') continue;
    const c = centroid(world, o.members, (s) => isRiding(s) || s.state === 'fleeing');
    if (c && dist(c, here) < bd) {
      bd = dist(c, here);
      best = o;
    }
  }
  return best;
}

const HORSE_ORDERS = {
  engage: (b) => `The ${b.name} ride at the enemy horse.`,
  raid: (b) => `The ${b.name} ride round to fall on the enemy's rear.`,
  hunt: (b) => `The ${b.name} ride at the enemy's light troops.`,
  form: (b) => `The ${b.name} form up beside their phalanx.`,
  screen: (b) => `The ${b.name} pull back behind the end of their line.`,
  pursue: (b) => `The ${b.name} ride after the fleeing enemy.`,
};

// An order from the player to his squadron. Routed, or leaving the field, it is past orders.
export function horseOrder(world, b, name) {
  if (!b || !HORSE_ORDERS[name] || !b.present || b.mode === 'broken' || b.mode === 'leave') return false;
  b.mode = name;
  b.modeT = 0;
  b.raid = name === 'raid' ? { phase: 'approach', t: 0, end: raidEnd(world, b, true) } : null;
  b.target = name === 'engage' ? nearestEnemyWing(world, b) : null;
  logEvent(world, 'horse', HORSE_ORDERS[name](b), { unit: b.side });
  return true;
}

// Enemy light troops out in the open, too far from their own hoplites to be covered by them.
function exposedLights(world, side, from, range) {
  const g = world.lights[1 - side];
  const out = [];
  if (!g) return out;
  for (const id of g.members) {
    const o = world.soldiers[id];
    if (isGone(o) || dist(o.pos, from) > range) continue;
    if (!covered(world, o, 1 - side, HORSE.shelter)) out.push(o);
  }
  return out;
}

// Where the squadron as a body is going, and how fast.
function moveAnchor(world, b, dt) {
  let goal = wingPost(world, b);
  let pace = HORSE.trot;
  if (b.mode === 'engage' || b.mode === 'screen') {
    const c = b.target && centroid(world, b.target.members, isRiding);
    if (c || b.mode === 'screen') {
      const d = c ? dist(c, b.anchor) : 0;
      if (b.mode === 'screen') {
        // Back to the end of their own line, under the cover of their own foot, whose spears
        // and javelins the enemy horse will not want to ride into.
        const u = world.units[b.side];
        const fw = fwdOf(u.heading);
        const rt = rightOf(u.heading);
        const sign = b.wing === 'right' ? 1 : -1;
        const out = (u.files / 2) * TUNING.fileSpacing - 2;
        goal = { x: u.anchor.x + rt.x * sign * out - fw.x * (u.ranks * TUNING.rankSpacing + 5), y: u.anchor.y + rt.y * sign * out - fw.y * (u.ranks * TUNING.rankSpacing + 5) };
        pace = HORSE.canter;
      } else {
        goal = c;
        pace = d > 50 ? HORSE.trot : HORSE.canter;
      }
    }
  } else if (b.mode === 'raid' && b.raid) {
    stepRaid(world, b, dt);
    if (b.raid) {
      goal = b.raid.goal || goal;
      pace = b.raid.phase === 'approach' ? HORSE.canter : HORSE.trot;
    }
  } else if (b.mode === 'hunt' || b.mode === 'pursue') {
    // The riders go after their own men; the body follows them.
    const c = centroid(world, b.members, isRiding);
    if (c) goal = c;
    pace = HORSE.canter;
  } else if (b.mode === 'rest' || b.mode === 'form') {
    pace = b.mode === 'rest' ? HORSE.walk : HORSE.trot;
  } else if (b.mode === 'broken' || b.mode === 'leave') {
    const u = world.units[b.side];
    const fw = fwdOf(u.heading);
    goal = { x: u.anchor.x - fw.x * 40, y: u.anchor.y - fw.y * 40 };
  }
  const dx = goal.x - b.anchor.x;
  const dy = goal.y - b.anchor.y;
  const d = Math.hypot(dx, dy);
  // Going out to the enemy he faces where he rides; at his post he faces the enemy line.
  const want = d > 3 ? Math.atan2(dy, dx) : (b.mode === 'form' || b.mode === 'rest' ? world.units[b.side].heading : b.heading);
  b.heading += clamp(angleWrap(want - b.heading), -1.2 * dt, 1.2 * dt);
  b.speed = Math.min(pace, d / 1.5);
  if (d > 0.05) {
    b.anchor.x += (dx / d) * b.speed * dt;
    b.anchor.y += (dy / d) * b.speed * dt;
  }
}

// The end of the enemy line to ride round: the nearer one, unless his light troops are out
// there in numbers. Horsemen will not ride into a crowd of javelin men, though a big
// squadron will ride through a few.
function raidEnd(world, b, regardless = false) {
  const e = world.units[1 - b.side];
  const g = world.lights[1 - b.side];
  const fw = fwdOf(e.heading);
  const rt = rightOf(e.heading);
  const halfW = (e.files / 2) * TUNING.fileSpacing;
  const back = e.ranks * TUNING.rankSpacing;
  const ends = [1, -1].map((end) => {
    const corner = { x: e.anchor.x + rt.x * end * halfW - fw.x * back, y: e.anchor.y + rt.y * end * halfW - fw.y * back };
    let watching = 0;
    for (const id of g ? g.members : []) {
      const o = world.soldiers[id];
      if ((o.state === 'skirmishing' || o.state === 'retiring' || o.state === 'resting') && o.javelins > 0 && dist(o.pos, corner) < 30) watching++;
    }
    return { end, d: dist(corner, b.anchor), watching };
  }).filter((x) => regardless || x.watching < Math.max(4, HORSE.raidDeterred * b.present)).sort((x, y) => x.d - y.d);
  return ends.length ? ends[0].end : 0;
}

// Falling on the flank and rear of a phalanx locked in the fight: ride round wide, come in
// from behind its end, strike, and pull out before they can turn on you.
function stepRaid(world, b, dt) {
  const e = world.units[1 - b.side];
  const r = b.raid;
  r.t += dt;
  const fw = fwdOf(e.heading);
  const rt = rightOf(e.heading);
  const halfW = (e.files / 2) * TUNING.fileSpacing;
  const back = e.ranks * TUNING.rankSpacing;
  const corner = { x: e.anchor.x + rt.x * r.end * halfW - fw.x * back, y: e.anchor.y + rt.y * r.end * halfW - fw.y * back };
  if (r.phase === 'approach') {
    // Come round wide, out of reach of the end files, to a point behind the enemy's rear.
    r.goal = { x: corner.x + rt.x * r.end * 14 - fw.x * 22, y: corner.y + rt.y * r.end * 14 - fw.y * 22 };
    // Arriving to find the enemy's light troops gathered there, they think better of it.
    if (b.ai && dist(b.anchor, r.goal) < 25 && raidEnd(world, b) !== r.end) {
      r.phase = 'out';
      r.t = 0;
      logEvent(world, 'horse', `Finding the enemy's light troops waiting, the ${b.name} turn away.`, { unit: b.side });
    } else if (dist(b.anchor, r.goal) < 8 || r.t > 40) {
      r.phase = 'charge';
      r.t = 0;
      logEvent(world, 'horse', `The ${b.name} fall on the rear of the ${e.short}!`, { unit: b.side });
    }
  } else if (r.phase === 'charge') {
    r.goal = corner;
    if (r.t > HORSE.raidTime) {
      r.phase = 'out';
      r.t = 0;
      logEvent(world, 'horse', `The ${b.name} wheel away before they can be caught.`, { unit: b.side });
    }
  } else if (r.phase === 'out') {
    r.goal = { x: corner.x + rt.x * r.end * 22 - fw.x * 30, y: corner.y + rt.y * r.end * 22 - fw.y * 30 };
    if (r.t > HORSE.regroup + 6) {
      // Ready to go again, if it is still worth it; the commander decides afresh.
      b.mode = 'form';
      b.modeT = 0;
      b.raid = null;
    }
  }
}

// ---- Each rider ----

export function stepRider(world, s, dt) {
  const b = world.horse[s.wing];
  s.stateT += dt;
  s.throwT -= dt;
  const speed = Math.hypot(s.vel.x, s.vel.y);
  // The horse tires at the gallop and gets its wind back at a walk.
  if (speed > HORSE.canter + 0.5) s.stamina = Math.max(0, s.stamina - HORSE.gallopCost * dt);
  else if (speed > HORSE.trot + 0.5) s.stamina = Math.max(0, s.stamina - HORSE.canterCost * dt);
  else s.stamina = Math.min(s.staminaCap, s.stamina + HORSE.recover * dt);

  if (s.state === 'fleeing' || s.state === 'rallying') {
    stepRunningRider(world, s, b, dt);
    return;
  }
  if (b.mode === 'leave') {
    s.state = 'riding';
    s.target = -1;
    s.goal = offField(world, s);
    s.gallop = true;
    if (offEdge(s)) s.state = 'escaped';
    return;
  }

  riderNerve(world, s, b, dt, speed);
  if (s.nerve < TUNING.nerveFlee) {
    s.state = 'fleeing';
    s.stateT = 0;
    s.target = -1;
    s.aggressor = false;
    s.record.fled++;
    b.stats.fled++;
    if (s.fledAt == null) s.fledAt = world.t;
    return;
  }

  // Wheeling away after a pass: out, then round again.
  if (s.state === 'wheeling') {
    s.wheelT -= dt;
    s.gallop = true;
    s.aggressor = false;
    s.target = -1;
    if (s.wheelT <= 0) {
      s.state = 'riding';
      s.meleeT = 0;
    }
    return;
  }

  // Shaken, he hangs back with the squadron's rear rather than go in again.
  if (s.nerve < HORSE.shaken && (b.mode === 'engage' || b.mode === 'hunt' || b.mode === 'raid')) {
    s.state = 'riding';
    s.target = -1;
    s.aggressor = false;
    s.goal = wingPost(world, b);
    s.gallop = dist(s.pos, s.goal) > 12;
    return;
  }
  const t = pickTarget(world, s, b);
  if (!t) {
    // With the squadron, in his place.
    s.state = 'riding';
    s.target = -1;
    s.aggressor = false;
    s.meleeT = 0;
    s.goal = placePoint(b, s);
    s.gallop = dist(s.pos, s.goal) > 12;
    // In the screen, or waiting, he throws at enemy horsemen who come close.
    if (s.javelins > 0 && s.throwT <= 0) {
      const g = world.lights[1 - s.side];
      const o = nearestRider(world, s, 1 - s.side, HORSE.throwMax, (o) => isRiding(o))
        || riderNearestOf(world, s, g ? g.members : [], HORSE.throwMax, (o) => o.state === 'skirmishing' || o.state === 'retiring' || o.state === 'resting');
      if (o && dist(o.pos, s.pos) >= HORSE.throwMin) throwJavelin(world, s, o);
    }
    return;
  }
  attack(world, s, b, t, dt);
}

// At a man: throw on the way in, ride into him, strike; against hoplites, away again quickly.
function attack(world, s, b, t, dt) {
  const d = dist(s.pos, t.pos);
  const reach = reachTo(s, t);
  s.aggressor = true;
  if (s.javelins > 0 && s.throwT <= 0 && d >= HORSE.throwMin && d <= HORSE.throwMax) throwJavelin(world, s, t);
  if (d > reach) {
    s.state = 'charging';
    s.target = t.id;
    s.gallop = true;
    // Ride a little past where he is going to be.
    s.goal = { x: t.pos.x + t.vel.x * 0.4, y: t.pos.y + t.vel.y * 0.4 };
    s.meleeT = 0;
    return;
  }
  const speed = Math.hypot(s.vel.x, s.vel.y);
  if (s.state === 'charging') {
    // Arriving at the gallop: the first blow lands harder, and being ridden into is terrifying.
    s.state = 'melee';
    s.stateT = 0;
    s.attackT = WEAPONS[s.weapon].interval * world.rng.range(0.6, 1.2);
    if (speed > HORSE.trot) {
      resolveBlow(world, s, t, false, HORSE.impact);
      if (t.kind === 'hoplite' && !isGone(t)) {
        shiftNerve(world, t, -HORSE.shock * (1.3 - shieldCover(t, s.pos)) * (1.2 - t.courage), 'cavalry');
        for (const { o, d: dd } of t.friends) if (dd < 3 && o.kind === 'hoplite' && isFormed(o)) shiftNerve(world, o, -HORSE.shock * 0.3, 'cavalry');
      }
    }
  }
  s.state = 'melee';
  s.target = t.id;
  s.gallop = false;
  // Keep at spear's length, moving: a horse standing still among the enemy is a dead horse.
  const away = { x: s.pos.x - t.pos.x, y: s.pos.y - t.pos.y };
  const l = Math.hypot(away.x, away.y) || 1;
  s.goal = { x: t.pos.x + (away.x / l) * reach * 0.8 - (away.y / l) * 1.5, y: t.pos.y + (away.y / l) * reach * 0.8 + (away.x / l) * 1.5 };
  // Against hoplites he is away again before they can close round him; against horsemen
  // he rides through, wheels, and comes again.
  s.meleeT += dt;
  if ((t.kind === 'hoplite' && isFormed(t) && s.meleeT > HORSE.hitAndRun) || (t.kind === 'horse' && s.meleeT > HORSE.pass)) {
    wheelAway(s, t);
  }
}

function wheelAway(s, from) {
  s.state = 'wheeling';
  s.stateT = 0;
  s.wheelT = HORSE.wheelOut;
  s.target = -1;
  s.aggressor = false;
  const v = { x: s.pos.x - from.pos.x, y: s.pos.y - from.pos.y };
  const l = Math.hypot(v.x, v.y) || 1;
  s.goal = { x: s.pos.x + (v.x / l) * 30, y: s.pos.y + (v.y / l) * 30 };
  if (from.kind === 'horse') s.wheelT = HORSE.wheelOut * 0.6;
}

// Whom this rider goes for, given what the squadron is about.
function pickTarget(world, s, b) {
  const cur = s.target >= 0 ? world.soldiers[s.target] : null;
  if (b.mode === 'engage' && b.target) {
    // Into the enemy squadron once it is close; until then, ride with his own.
    const c = centroid(world, b.target.members, isRiding);
    if (!c || dist(c, b.anchor) > 35) return null;
    // Not into the cover of the enemy's hoplites, though.
    const open = (o) => !covered(world, o, 1 - s.side, HORSE.shelter + 3);
    if (cur && cur.kind === 'horse' && !isGone(cur) && (isRiding(cur) || dist(cur.pos, s.pos) < 20) && open(cur)) return cur;
    return nearestRider(world, s, b.target.side, 60, (o) => isRiding(o) && o.wing === b.target.id && open(o))
      || nearestRider(world, s, b.target.side, 8, (o) => o.state === 'fleeing' && open(o));
  }
  if (b.mode === 'hunt') {
    if (cur && cur.kind === 'light' && !isGone(cur) && dist(cur.pos, s.pos) < 40 && exposedLights(world, s.side, cur.pos, 0.5).length) return cur;
    let best = null;
    let bd = 60;
    // Light troops he can ride down before they reach cover, or that are close enough to try.
    for (const o of exposedLights(world, s.side, s.pos, 60).filter((o) => catchable(world, o, s.pos) || dist(o.pos, s.pos) < 30)) {
      const d = dist(o.pos, s.pos);
      if (d < bd) {
        bd = d;
        best = o;
      }
    }
    return best;
  }
  if (b.mode === 'pursue') {
    if (cur && !isGone(cur) && isRunning(cur) && cur.side !== s.side) return cur;
    return riderNearestOf(world, s, world.units[1 - s.side].members, 80, (o) => isRunning(o) || o.state === 'fleeing')
      || riderNearestOf(world, s, world.lights[1 - s.side].members, 50, (o) => o.state === 'fleeing');
  }
  if (b.mode === 'raid' && b.raid && b.raid.phase === 'charge') {
    // A man whose back or unshielded side is towards him: the rear ranks and the end files.
    if (cur && cur.kind === 'hoplite' && isFormed(cur) && shieldCover(cur, s.pos) < 0.5 && dist(cur.pos, s.pos) < 25) return cur;
    return riderNearestOf(world, s, world.units[1 - s.side].members, 35, (o) => isFormed(o) && shieldCover(o, s.pos) < 0.5);
  }
  return null;
}

function riderNearestOf(world, s, ids, range, ok) {
  let best = null;
  let bd = range;
  for (const id of ids) {
    const o = world.soldiers[id];
    if (isGone(o) || !ok(o)) continue;
    const d = dist(o.pos, s.pos);
    if (d < bd) {
      bd = d;
      best = o;
    }
  }
  return best;
}

export function nearestRider(world, s, side, range, ok) {
  let best = null;
  let bd = range;
  for (const w of world.horse) {
    if (w.side !== side) continue;
    for (const id of w.members) {
      const o = world.soldiers[id];
      if (isGone(o) || !ok(o)) continue;
      const d = dist(o.pos, s.pos);
      if (d < bd) {
        bd = d;
        best = o;
      }
    }
  }
  return best;
}

// A rider's nerve: friends galloping off beside him, being set on by several at once, and
// worst of all being stuck among the enemy with his horse at a stand.
function riderNerve(world, s, b, dt, speed) {
  let fleeing = 0;
  for (const { o, d } of s.friends) if (o.kind === 'horse' && o.state === 'fleeing' && d < 9) fleeing++;
  if (fleeing) shiftNerve(world, s, -Math.min(0.08, 0.02 * fleeing) * (1.2 - s.courage) * dt, 'panic');
  // In the thick of it, every man down from his own squadron weighs on him: horsemen have no
  // ranks to hold them.
  if ((s.state === 'charging' || s.state === 'melee') && (b.mode === 'engage' || b.mode === 'screen')) {
    let lost = 0;
    for (const id of b.members) {
      const o = world.soldiers[id];
      if (o.state === 'dead' || o.state === 'fleeing' || o.state === 'escaped') lost++;
    }
    shiftNerve(world, s, -HORSE.losses * (lost / b.members.length) * (1.3 - s.courage) * dt, 'casualties');
  }
  const att = attackersOf(world, s).length;
  if (att > 1) shiftNerve(world, s, -0.02 * (att - 1) * dt, 'exposure');
  if (s.state === 'melee' && speed < 1.5) {
    let foot = 0;
    for (const { o, d } of s.enemies) if (o.kind === 'hoplite' && isFormed(o) && d < 3.5) foot++;
    if (foot >= 2) shiftNerve(world, s, -HORSE.bogged * (1.3 - s.courage) * dt, 'bogged');
  }
  // Enemy horsemen coming at him faster than he is going: whoever meets a charge standing
  // has already half lost.
  for (const { o, d } of s.enemies) {
    if (o.kind !== 'horse' || o.state !== 'charging' || o.target !== s.id) continue;
    if (Math.hypot(o.vel.x, o.vel.y) > speed + 2) shiftNerve(world, s, -HORSE.chargeFear * (1.3 - s.courage) * dt, 'charge');
    break;
  }
  if (world.t - s.lastHitT > 6 && !att) shiftNerve(world, s, 0.01 * dt);
}

function stepRunningRider(world, s, b, dt) {
  s.target = -1;
  s.aggressor = false;
  s.gallop = s.state === 'fleeing';
  if (offEdge(s)) {
    s.state = 'escaped';
    return;
  }
  const foe = nearestRider(world, s, 1 - s.side, 40, (o) => isRiding(o));
  if (s.state === 'fleeing') {
    s.goal = offField(world, s);
    if (!foe && s.stateT > 4) {
      s.state = 'rallying';
      s.stateT = 0;
    }
    return;
  }
  // Rallying: well behind his own line, getting his nerve back.
  const u = world.units[s.side];
  const fw = fwdOf(u.heading);
  s.goal = { x: u.anchor.x - fw.x * 35 + (s.place % 5 - 2) * 3, y: u.anchor.y - fw.y * 35 };
  shiftNerve(world, s, 0.03 * dt);
  if (foe && dist(foe.pos, s.pos) < 20) {
    s.state = 'fleeing';
    s.stateT = 0;
  } else if (s.nerve > 0.55 && b.mode !== 'leave') {
    s.state = 'riding';
    s.stateT = 0;
  }
}

function offField(world, s) {
  const u = world.units[s.side];
  const fw = fwdOf(u.heading);
  return { x: s.pos.x - fw.x * 60, y: s.pos.y - fw.y * 60 };
}

function offEdge(s) {
  return Math.abs(s.pos.x) > TUNING.fieldHalfW || Math.abs(s.pos.y) > TUNING.fieldHalfH;
}

// Horses do not stop or turn on the spot.
export function moveRider(world, s, dt) {
  let dv = { x: 0, y: 0 };
  if (s.goal && s.state !== 'dead') {
    const dx = s.goal.x - s.pos.x;
    const dy = s.goal.y - s.pos.y;
    const d = Math.hypot(dx, dy);
    const b = world.horse[s.wing];
    let top;
    if (s.gallop) top = HORSE.gallop * (0.55 + 0.45 * s.stamina);
    else if (s.state === 'melee') top = HORSE.trot;
    else top = Math.min(HORSE.canter, (b.speed || 0) + 2.5);
    top *= s.speedMul;
    const sp = Math.min(top, d / 0.6);
    if (d > 0.05) dv = { x: (dx / d) * sp, y: (dy / d) * sp };
  }
  const k = Math.min(1, 2.5 * dt);
  s.vel.x += (dv.x - s.vel.x) * k;
  s.vel.y += (dv.y - s.vel.y) * k;
  if (s.state === 'dead') {
    s.vel.x *= 0.7;
    s.vel.y *= 0.7;
  }
  s.pos.x += s.vel.x * dt;
  s.pos.y += s.vel.y * dt;
  s.lag.x = s.pos.x;
  s.lag.y = s.pos.y;
  const sp = Math.hypot(s.vel.x, s.vel.y);
  const t = s.target >= 0 ? world.soldiers[s.target] : null;
  let want = s.facing;
  if (sp > 0.8) want = Math.atan2(s.vel.y, s.vel.x);
  else if (t) want = Math.atan2(t.pos.y - s.pos.y, t.pos.x - s.pos.x);
  else if (s.state === 'riding') want = world.horse[s.wing].heading;
  s.facing += clamp(angleWrap(want - s.facing), -3 * dt, 3 * dt);
}
